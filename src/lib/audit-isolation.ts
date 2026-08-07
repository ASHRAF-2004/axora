import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import {
  auditRecordMatchesFilters,
  normalizeAuditRecordFilters,
  type AuditRecordFilters,
} from "./audit-filters";
import { getDemoOperations } from "./demo-operations";
import { isDemoMode, query } from "./db";
import { listAuthorizedAttachments } from "./document-isolation";
import { canAccess } from "./permissions";
import { listAuthorizedRequests } from "./request-reader";
import type { AuditRecord } from "./types";

interface AuditRow extends QueryResultRow {
  id: string;
  entityType: string;
  recordId?: string;
  action: string;
  actorName?: string;
  reason?: string;
  occurredAt: string;
}

export class AuditAccessUnavailableError extends Error {
  constructor() {
    super("The requested audit evidence is unavailable.");
    this.name = "AuditAccessUnavailableError";
  }
}

function isPlatformAuditActor(actor: AuthenticatedSessionUser) {
  return actor.isOwner
    || (actor.accountKind === "PLATFORM" && actor.scopeType === "PLATFORM");
}

function demoAuditVisible(
  record: AuditRecord,
  platformView: boolean,
  visibleAttachmentIds: ReadonlySet<string>,
) {
  if (platformView) return true;
  if (record.entityType === "quotations") return false;
  if (record.entityType === "attachments") {
    return Boolean(record.recordId && visibleAttachmentIds.has(record.recordId));
  }
  return true;
}

export async function listAuthorizedAuditRecords(
  actor: AuthenticatedSessionUser,
  rawFilters: AuditRecordFilters = {},
): Promise<AuditRecord[]> {
  if (!canAccess(actor, "view_audit")) {
    throw new AuditAccessUnavailableError();
  }
  const filters = normalizeAuditRecordFilters(rawFilters);
  const platformView = isPlatformAuditActor(actor);

  try {
    if (isDemoMode()) {
      const attachments = await listAuthorizedAttachments(actor);
      const attachmentIds = new Set(attachments.map((item) => item.id));
      return getDemoOperations().audit
        .filter((record) => demoAuditVisible(
          record,
          platformView,
          attachmentIds,
        ))
        .filter((record) => auditRecordMatchesFilters(record, filters));
    }

    const values: unknown[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const predicates: string[] = [];

    if (!platformView) {
      if (!actor.companyId) throw new AuditAccessUnavailableError();
      const [requests, attachments] = await Promise.all([
        listAuthorizedRequests(actor),
        listAuthorizedAttachments(actor),
      ]);
      const requestIds = requests.map((request) => request.id);
      const requestLineIds = requests.flatMap((request) =>
        request.lines.map((line) => line.id));
      const attachmentIds = attachments.map((attachment) => attachment.id);

      const company = bind(actor.companyId);
      const branch = actor.branchId ? bind(actor.branchId) : undefined;
      const requestsParameter = bind(requestIds);
      const linesParameter = bind(requestLineIds);
      const attachmentsParameter = bind(attachmentIds);
      const branchCompanyScope = branch
        ? `AND scoped_branch.id=${branch}`
        : "";
      const userBranchScope = branch
        ? `AND scoped_user.branch_id=${branch}`
        : "";

      predicates.push(`(
        a.company_id=${company}
        AND (
          (a.entity_type='companies' AND a.record_id=${company})
          OR (a.entity_type='branches' AND EXISTS (
            SELECT 1 FROM branches scoped_branch
            WHERE scoped_branch.id=a.record_id
              AND scoped_branch.company_id=${company}
              ${branchCompanyScope}
          ))
          OR (a.entity_type='users' AND EXISTS (
            SELECT 1 FROM users scoped_user
            WHERE scoped_user.id=a.record_id
              AND scoped_user.company_id=${company}
              ${userBranchScope}
          ))
          OR (
            a.entity_type='requests'
            AND a.record_id=ANY(${requestsParameter}::uuid[])
          )
          OR (
            a.entity_type='request_lines'
            AND a.record_id=ANY(${linesParameter}::uuid[])
          )
          OR (a.entity_type='approvals' AND EXISTS (
            SELECT 1 FROM approvals scoped_approval
            WHERE scoped_approval.id=a.record_id
              AND scoped_approval.request_id=ANY(
                ${requestsParameter}::uuid[]
              )
          ))
          OR (a.entity_type='deliveries' AND EXISTS (
            SELECT 1 FROM deliveries scoped_delivery
            WHERE scoped_delivery.id=a.record_id
              AND scoped_delivery.request_line_id=ANY(
                ${linesParameter}::uuid[]
              )
          ))
          OR (a.entity_type='invoices' AND EXISTS (
            SELECT 1 FROM invoices scoped_invoice
            WHERE scoped_invoice.id=a.record_id
              AND scoped_invoice.direction='CUSTOMER'
              AND scoped_invoice.request_id=ANY(
                ${requestsParameter}::uuid[]
              )
          ))
          OR (a.entity_type='invoice_allocations' AND EXISTS (
            SELECT 1 FROM invoice_allocations scoped_allocation
            WHERE scoped_allocation.id=a.record_id
              AND scoped_allocation.request_line_id=ANY(
                ${linesParameter}::uuid[]
              )
          ))
          OR (a.entity_type='payments' AND EXISTS (
            SELECT 1 FROM payments scoped_payment
            JOIN invoices scoped_invoice
              ON scoped_invoice.id=scoped_payment.invoice_id
            WHERE scoped_payment.id=a.record_id
              AND scoped_invoice.direction='CUSTOMER'
              AND scoped_invoice.request_id=ANY(
                ${requestsParameter}::uuid[]
              )
          ))
          OR (
            a.entity_type='attachments'
            AND a.record_id=ANY(${attachmentsParameter}::uuid[])
          )
        )
      )`);
    }

    if (filters.entityType) {
      predicates.push(`a.entity_type=${bind(filters.entityType)}`);
    }
    if (filters.action) {
      predicates.push(`upper(a.action)=${bind(filters.action)}`);
    }
    if (filters.actor) {
      predicates.push(
        `strpos(lower(COALESCE(actor.display_name,'')),lower(${bind(filters.actor)}))>0`,
      );
    }
    if (filters.recordId) {
      predicates.push(`a.record_id=${bind(filters.recordId)}::uuid`);
    }
    if (filters.from) {
      predicates.push(`a.occurred_at>=${bind(filters.from)}::date`);
    }
    if (filters.to) {
      predicates.push(
        `a.occurred_at<(${bind(filters.to)}::date + interval '1 day')`,
      );
    }

    const where = predicates.length
      ? `WHERE ${predicates.join(" AND ")}`
      : "";
    const result = await query<AuditRow>(`
      SELECT
        a.id::text,
        a.entity_type AS "entityType",
        a.record_id::text AS "recordId",
        a.action,
        actor.display_name AS "actorName",
        a.reason,
        a.occurred_at::text AS "occurredAt"
      FROM audit_logs a
      LEFT JOIN users actor ON actor.id=a.actor_id
      ${where}
      ORDER BY a.occurred_at DESC
      LIMIT 500
    `, values);
    return result.rows;
  } catch (error) {
    if (error instanceof AuditAccessUnavailableError) throw error;
    throw new AuditAccessUnavailableError();
  }
}

export const auditIsolationInternals = {
  demoAuditVisible,
  isPlatformAuditActor,
};
