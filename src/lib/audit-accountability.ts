import type { PoolClient } from "pg";
import { isDemoMode, withAuditTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

export type AccountabilityAccessEvent =
  | "AUDIT_EXPORT"
  | "REQUEST_EXPORT"
  | "ATTACHMENT_DOWNLOAD"
  | "SUPPLIER_DOCUMENT_DOWNLOAD";

export async function recordAccountabilityAccessWithClient(
  client: PoolClient,
  actor: SessionUser,
  event: AccountabilityAccessEvent,
  targetId: string | null = null,
  rowCount: number | null = null,
): Promise<void> {
  await client.query(
    `SELECT public.axora_record_accountability_access($1::uuid, $2::uuid, $3::text, $4::uuid, $5::integer, clock_timestamp())`,
    [actor.id, actor.roleAssignmentId ?? null, event, targetId, rowCount],
  );
}

export async function recordAccountabilityAccess(
  actor: SessionUser,
  event: AccountabilityAccessEvent,
  targetId: string | null = null,
  rowCount: number | null = null,
): Promise<void> {
  if (isDemoMode()) return;
  await withAuditTransaction(
    {
      actor,
      reason: `Record ${event.toLowerCase()}`,
      reasonCode: event,
      outcome: "SUCCESS",
    },
    (client) => recordAccountabilityAccessWithClient(client, actor, event, targetId, rowCount),
  );
}
