import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { encodeCsvCell } from "@/lib/csv";
import { listScopedAuditRecords, type AccountabilityAuditFilters } from "@/lib/accountability-reader";
import { recordAccountabilityAccess } from "@/lib/audit-accountability";

function filtersFrom(request: Request): AccountabilityAuditFilters {
  const search = new URL(request.url).searchParams;
  const value = (key: string) => search.get(key)?.trim() || undefined;
  return {
    entityType: value("entityType"),
    action: value("action"),
    actor: value("actor"),
    recordId: value("recordId"),
    companyId: value("companyId"),
    branchId: value("branchId"),
    departmentId: value("departmentId"),
    requestId: value("requestId"),
    deliveryId: value("deliveryId"),
    outcome: value("outcome"),
    from: value("from"),
    to: value("to"),
  };
}

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_audit")) {
    return Response.json({ error: "You do not have permission to export audit evidence." }, { status: 403 });
  }

  const records = await listScopedAuditRecords(actor, filtersFrom(request));
  const rows = [
    ["Event ID", "Event type", "Action", "Actor", "Actor role", "Company", "Branch", "Department", "Record", "Request", "Delivery", "Outcome", "Reason code", "Reason", "Correlation ID", "Integrity hash", "Occurred at (UTC)"],
    ...records.map((record) => [
      record.id,
      record.eventType ?? record.entityType,
      record.action,
      record.actorName ?? "System",
      record.actorRole ?? "",
      record.companyId ?? "",
      record.branchId ?? "",
      record.departmentId ?? "",
      record.recordId ?? "",
      record.relatedRequestId ?? "",
      record.relatedDeliveryId ?? "",
      record.outcome ?? "",
      record.reasonCode ?? "",
      record.reason ?? "",
      record.correlationId ?? "",
      record.integrityHash ?? "",
      record.occurredAt,
    ]),
  ];
  const body = `\uFEFF${rows.map((row) => row.map(encodeCsvCell).join(",")).join("\r\n")}`;
  await recordAccountabilityAccess(actor, "AUDIT_EXPORT", actor.companyId ?? null, records.length);

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=axora-audit-evidence.csv",
      "Cache-Control": "no-store",
    },
  });
}
