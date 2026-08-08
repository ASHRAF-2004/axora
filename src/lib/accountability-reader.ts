import { isDemoMode, query } from "@/lib/db";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { AuditRecord } from "@/lib/types";

export interface AccountabilityAuditFilters {
  entityType?: string;
  action?: string;
  actor?: string;
  recordId?: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  requestId?: string;
  deliveryId?: string;
  outcome?: string;
  from?: string;
  to?: string;
}

interface AuditCapabilityRow {
  id: string;
  event_type: string;
  entity_type: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  company_id: string | null;
  branch_id: string | null;
  department_id: string | null;
  related_request_id: string | null;
  related_delivery_id: string | null;
  outcome: string;
  reason_code: string | null;
  reason: string | null;
  safe_diff: Record<string, unknown> | null;
  correlation_id: string | null;
  integrity_hash: string | null;
  occurred_at: Date | string;
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function listScopedAuditRecords(
  actor: AuthenticatedSessionUser,
  filters: AccountabilityAuditFilters = {},
): Promise<AuditRecord[]> {
  if (isDemoMode()) {
    const legacy = await import("@/lib/audit-isolation");
    return legacy.listAuthorizedAuditRecords(actor, filters);
  }

  const result = await query<AuditCapabilityRow>(
    `SELECT *
       FROM public.axora_audit_rows(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
         $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
         $11::uuid, $12::text, $13::timestamptz, $14::timestamptz, $15::integer
       )`,
    [
      actor.id,
      actor.roleAssignmentId ?? null,
      optional(filters.entityType) ?? null,
      optional(filters.action) ?? null,
      optional(filters.actor) ?? null,
      optional(filters.recordId) ?? null,
      optional(filters.companyId) ?? null,
      optional(filters.branchId) ?? null,
      optional(filters.departmentId) ?? null,
      optional(filters.requestId) ?? null,
      optional(filters.deliveryId) ?? null,
      optional(filters.outcome) ?? null,
      optional(filters.from) ? `${optional(filters.from)}T00:00:00.000Z` : null,
      optional(filters.to) ? `${optional(filters.to)}T23:59:59.999Z` : null,
      500,
    ],
  );

  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    ...(row.record_id ? { recordId: row.record_id } : {}),
    action: row.action,
    ...(row.actor_name ? { actorName: row.actor_name } : {}),
    ...(row.actor_role ? { actorRole: row.actor_role } : {}),
    ...(row.company_id ? { companyId: row.company_id } : {}),
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    ...(row.department_id ? { departmentId: row.department_id } : {}),
    ...(row.related_request_id ? { relatedRequestId: row.related_request_id } : {}),
    ...(row.related_delivery_id ? { relatedDeliveryId: row.related_delivery_id } : {}),
    outcome: row.outcome,
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.safe_diff ? { safeDiff: row.safe_diff } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.integrity_hash ? { integrityHash: row.integrity_hash } : {}),
    occurredAt: new Date(row.occurred_at).toISOString(),
  }));
}
