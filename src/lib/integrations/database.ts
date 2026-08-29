import type { PoolClient } from "pg";
import type { AuthenticatedSessionUser } from "../auth";
import { withAuditTransaction } from "../db";

export type IntegrationSystemIdentity =
  | "integration-management"
  | "integration-oauth"
  | "integration-api"
  | "integration-maintenance";

export function withIntegrationTransaction<T>(
  input: {
    systemIdentity: IntegrationSystemIdentity;
    reason: string;
    actor?: AuthenticatedSessionUser;
    correlationId?: string;
    commandId?: string;
    resultCode?: string;
    outcome?: "SUCCESS" | "FAILURE";
  },
  work: (client: PoolClient) => Promise<T>,
) {
  return withAuditTransaction({
    systemIdentity: input.systemIdentity,
    reason: input.reason,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    ...(input.resultCode ? { resultCode: input.resultCode } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
  }, work);
}
