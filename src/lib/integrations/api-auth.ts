import type { QueryResultRow } from "pg";
import { loadCurrentAuthorizationIdentity, type AuthenticatedSessionUser } from "../auth";
import type { EffectiveAccessSnapshot } from "../effective-access";
import { loadEffectiveAccess } from "../effective-access";
import { hashIntegrationSecret } from "./crypto";
import { integrationApplicationEnabled } from "./config";
import { withIntegrationTransaction } from "./database";
import { INTEGRATION_SCOPES, type IntegrationScope } from "./scopes";

const accessTokenPattern = /^axora_at_[A-Za-z0-9_-]{43}$/;

interface PrincipalRow extends QueryResultRow {
  accessTokenId: string;
  applicationId: string;
  applicationSlug: string;
  clientId: string;
  connectionId: string;
  companyId: string;
  grantId: string;
  userId: string;
  roleAssignmentId: string;
  authVersion: number;
  scopes: string[];
  expiresAt: string;
}

export interface IntegrationPrincipal {
  accessTokenId: string;
  applicationId: string;
  clientId: string;
  connectionId: string;
  companyId: string;
  grantId: string;
  scopes: readonly IntegrationScope[];
  expiresAt: Date;
  actor: AuthenticatedSessionUser;
  effectiveAccess: EffectiveAccessSnapshot;
}

export type IntegrationAuthenticationResult =
  | { ok: true; principal: IntegrationPrincipal }
  | { ok: false; reason: "MISSING" | "INVALID" };

function bearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  if (!value) return { present: false as const };
  const match = /^Bearer ([^\s,]+)$/.exec(value);
  return match ? { present: true as const, token: match[1] }
    : { present: true as const, token: "" };
}

function validatedScopes(values: readonly string[]) {
  const allowed = new Set<string>(INTEGRATION_SCOPES);
  if (!values.length || values.some((value) => !allowed.has(value))) return null;
  return [...new Set(values)] as IntegrationScope[];
}

export async function authenticateIntegrationRequest(
  request: Request,
  requestId: string,
): Promise<IntegrationAuthenticationResult> {
  const bearer = bearerToken(request);
  if (!bearer.present) return { ok: false, reason: "MISSING" };
  if (!accessTokenPattern.test(bearer.token)) return { ok: false, reason: "INVALID" };
  const tokenHash = hashIntegrationSecret("access-token", bearer.token);
  const principalRow = await withIntegrationTransaction({
    systemIdentity: "integration-api",
    reason: "Resolve external API principal",
    correlationId: requestId,
  }, async (client) => {
    const result = await client.query<PrincipalRow>(`
      SELECT
        principal.access_token_id::text AS "accessTokenId",
        principal.application_id::text AS "applicationId",
        application.slug AS "applicationSlug",
        principal.client_id AS "clientId",
        principal.connection_id::text AS "connectionId",
        principal.company_id::text AS "companyId",
        principal.grant_id::text AS "grantId",
        principal.user_id::text AS "userId",
        principal.role_assignment_id::text AS "roleAssignmentId",
        principal.auth_version::int AS "authVersion",
        principal.scopes,
        principal.expires_at::text AS "expiresAt"
      FROM public.axora_integration_principal_by_token_hash($1,now()) principal
      JOIN public.integration_applications application
        ON application.id=principal.application_id
    `, [tokenHash]);
    if (result.rowCount === 1
      && integrationApplicationEnabled(result.rows[0]!.applicationSlug)) {
      await client.query(`
        UPDATE public.integration_oauth_access_tokens
        SET last_used_at=now()
        WHERE id=$1 AND revoked_at IS NULL
          AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')
      `, [result.rows[0]!.accessTokenId]);
    }
    const principal = result.rows[0];
    return principal && integrationApplicationEnabled(principal.applicationSlug)
      ? principal
      : undefined;
  });
  if (!principalRow) return { ok: false, reason: "INVALID" };
  const scopes = validatedScopes(principalRow.scopes);
  const actor = await loadCurrentAuthorizationIdentity(principalRow.userId);
  if (!scopes || !actor
    || actor.roleAssignmentId !== principalRow.roleAssignmentId
    || actor.authVersion !== principalRow.authVersion) {
    return { ok: false, reason: "INVALID" };
  }
  try {
    const effectiveAccess = await loadEffectiveAccess(actor);
    return {
      ok: true,
      principal: {
        accessTokenId: principalRow.accessTokenId,
        applicationId: principalRow.applicationId,
        clientId: principalRow.clientId,
        connectionId: principalRow.connectionId,
        companyId: principalRow.companyId,
        grantId: principalRow.grantId,
        scopes,
        expiresAt: new Date(principalRow.expiresAt),
        actor,
        effectiveAccess,
      },
    };
  } catch {
    return { ok: false, reason: "INVALID" };
  }
}

export function principalHasScope(
  principal: IntegrationPrincipal,
  scope: IntegrationScope,
) {
  return principal.scopes.includes(scope);
}
