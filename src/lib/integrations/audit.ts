import type { IntegrationScope } from "./scopes";
import { withIntegrationTransaction } from "./database";

export type IntegrationAuditResult =
  | "SUCCESS"
  | "DENIED"
  | "INVALID"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "ERROR";

export async function recordIntegrationAudit(input: {
  requestId: string;
  applicationId?: string;
  connectionId?: string;
  companyId?: string;
  grantId?: string;
  delegatingUserId?: string;
  scopes?: readonly IntegrationScope[];
  route: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  result: IntegrationAuditResult;
  httpStatus: number;
  networkHash?: string;
  details?: Record<string, string | number | boolean | null>;
}) {
  await withIntegrationTransaction({
    systemIdentity: input.route.startsWith("/oauth/")
      ? "integration-oauth" : "integration-api",
    reason: "External integration security audit",
    correlationId: input.requestId,
    resultCode: input.result,
    outcome: input.result === "SUCCESS" ? "SUCCESS" : "FAILURE",
  }, (client) => client.query(`
    INSERT INTO public.integration_api_audit(
      request_id,application_id,connection_id,company_id,grant_id,
      delegating_user_id,scopes,route,action,resource_type,resource_id,
      result,http_status,network_hash,details
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb
    )
  `, [
    input.requestId,
    input.applicationId ?? null,
    input.connectionId ?? null,
    input.companyId ?? null,
    input.grantId ?? null,
    input.delegatingUserId ?? null,
    input.scopes ?? [],
    input.route.slice(0, 240),
    input.action,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.result,
    input.httpStatus,
    input.networkHash ?? null,
    JSON.stringify(input.details ?? {}),
  ]));
}
