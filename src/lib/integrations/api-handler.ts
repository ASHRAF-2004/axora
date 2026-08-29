import { authenticateIntegrationRequest, principalHasScope, type IntegrationPrincipal } from "./api-auth";
import { recordIntegrationAudit, type IntegrationAuditResult } from "./audit";
import { externalApiEnabled } from "./config";
import { externalDataResponse, externalErrorResponse, externalRequestId, type ExternalErrorCode } from "./http";
import { integrationNetworkHash } from "./network";
import { consumeIntegrationRateLimit, integrationRateHeaders } from "./rate-limit";
import type { IntegrationScope } from "./scopes";

export class ExternalApiProblem extends Error {
  constructor(
    public readonly code: ExternalErrorCode,
    public readonly status: number,
    public readonly auditResult: IntegrationAuditResult,
    public readonly field?: string,
    public readonly resourceType?: string,
    public readonly resourceId?: string,
  ) {
    super(code);
    this.name = "ExternalApiProblem";
  }
}

export interface ExternalApiSuccess {
  data: unknown;
  status?: number;
  meta?: Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
  /** A mutation may atomically insert its audit with its logical effect. */
  auditRecorded?: boolean;
}

export async function handleExternalApiRequest(
  request: Request,
  config: {
    scope?: IntegrationScope;
    action: string;
    routeClass?: "API_READ" | "API_WRITE";
    resourceType?: string;
  },
  handler: (principal: IntegrationPrincipal, requestId: string) => Promise<ExternalApiSuccess>,
) {
  const requestId = externalRequestId(request);
  if (!externalApiEnabled()) return new Response(null, { status: 404 });
  let networkHash: string;
  try {
    networkHash = integrationNetworkHash(request);
  } catch {
    return externalErrorResponse("temporarily_unavailable", 503, requestId);
  }
  const route = new URL(request.url).pathname;
  let principal: IntegrationPrincipal | undefined;
  let rateHeaders: HeadersInit | undefined;
  try {
    const authentication = await authenticateIntegrationRequest(request, requestId);
    if (!authentication.ok) {
      await recordIntegrationAudit({
        requestId,route,action: config.action,
        result: "DENIED",httpStatus: 401,networkHash,
        details: { category: authentication.reason.toLowerCase() },
      });
      return externalErrorResponse(
        authentication.reason === "MISSING" ? "unauthorized" : "invalid_token",
        401,
        requestId,
        { headers: { "WWW-Authenticate": 'Bearer realm="Axora API", error="invalid_token"' } },
      );
    }
    principal = authentication.principal;
    const rate = await consumeIntegrationRateLimit({
      routeClass: config.routeClass ?? "API_READ",
      correlationId: requestId,
      scopes: [
        { kind: "TOKEN", identifier: principal.accessTokenId, limit: config.routeClass === "API_WRITE" ? 30 : 120 },
        { kind: "CONNECTION", identifier: principal.connectionId, limit: config.routeClass === "API_WRITE" ? 120 : 600 },
        { kind: "CLIENT", identifier: principal.applicationId, limit: config.routeClass === "API_WRITE" ? 300 : 1200 },
      ],
    });
    rateHeaders = integrationRateHeaders(rate);
    if (!rate.allowed) {
      await recordIntegrationAudit({
        requestId,applicationId: principal.applicationId,
        connectionId: principal.connectionId,companyId: principal.companyId,
        grantId: principal.grantId,delegatingUserId: principal.actor.id,
        scopes: principal.scopes,route,action: config.action,
        result: "RATE_LIMITED",httpStatus: 429,networkHash,
      });
      return externalErrorResponse("rate_limited", 429, requestId, { headers: rateHeaders });
    }
    if (config.scope && !principalHasScope(principal, config.scope)) {
      await recordIntegrationAudit({
        requestId,applicationId: principal.applicationId,
        connectionId: principal.connectionId,companyId: principal.companyId,
        grantId: principal.grantId,delegatingUserId: principal.actor.id,
        scopes: principal.scopes,route,action: config.action,
        result: "DENIED",httpStatus: 403,networkHash,
        details: { category: "scope" },
      });
      return externalErrorResponse("insufficient_scope", 403, requestId, {
        headers: {
          ...rateHeaders,
          "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${config.scope}"`,
        },
      });
    }
    const result = await handler(principal, requestId);
    const status = result.status ?? 200;
    if (!result.auditRecorded) {
      await recordIntegrationAudit({
        requestId,applicationId: principal.applicationId,
        connectionId: principal.connectionId,companyId: principal.companyId,
        grantId: principal.grantId,delegatingUserId: principal.actor.id,
        scopes: principal.scopes,route,action: config.action,
        resourceType: result.resourceType ?? config.resourceType,
        resourceId: result.resourceId,
        result: "SUCCESS",httpStatus: status,networkHash,
      });
    }
    return externalDataResponse(result.data, requestId, {
      status,
      meta: result.meta,
      headers: rateHeaders,
    });
  } catch (error) {
    if (error instanceof ExternalApiProblem) {
      if (principal) {
        try {
          await recordIntegrationAudit({
            requestId,applicationId: principal.applicationId,
            connectionId: principal.connectionId,companyId: principal.companyId,
            grantId: principal.grantId,delegatingUserId: principal.actor.id,
            scopes: principal.scopes,route,action: config.action,
            resourceType: error.resourceType ?? config.resourceType,
            resourceId: error.resourceId,result: error.auditResult,
            httpStatus: error.status,networkHash,
          });
        } catch {
          return externalErrorResponse("temporarily_unavailable", 503, requestId);
        }
      }
      return externalErrorResponse(error.code, error.status, requestId, {
        field: error.field,
        headers: rateHeaders,
      });
    }
    return externalErrorResponse("temporarily_unavailable", 503, requestId, {
      headers: rateHeaders,
    });
  }
}
