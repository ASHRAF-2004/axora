const FILTER_TOKEN = /^[a-z][a-z0-9_.-]{0,79}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditRecordFilters {
  entityType?: string;
  action?: string;
  actor?: string;
  recordId?: string;
  from?: string;
  to?: string;
}

type AuditFilterInput = Partial<Record<keyof AuditRecordFilters, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function token(value: string | string[] | undefined, casing: "lower" | "upper") {
  const normalized = one(value)?.trim();
  if (!normalized || !FILTER_TOKEN.test(normalized)) return undefined;
  return casing === "lower" ? normalized.toLowerCase() : normalized.toUpperCase();
}

function validDate(value: string | string[] | undefined) {
  const normalized = one(value)?.trim();
  if (!normalized || !ISO_DATE.test(normalized)) return undefined;
  const instant = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== normalized
    ? undefined
    : normalized;
}

function actorName(value: string | string[] | undefined) {
  const normalized = one(value)?.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length < 2 || normalized.length > 100
    || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

export function normalizeAuditRecordFilters(input: AuditFilterInput): AuditRecordFilters {
  const recordIdInput = one(input.recordId)?.trim();
  const from = validDate(input.from);
  const to = validDate(input.to);
  return {
    entityType: token(input.entityType, "lower"),
    action: token(input.action, "upper"),
    actor: actorName(input.actor),
    recordId: recordIdInput && UUID.test(recordIdInput) ? recordIdInput.toLowerCase() : undefined,
    ...(from && to && from > to ? {} : { from, to }),
  };
}

/** Escape a literal fragment before placing it inside a parameterized ILIKE pattern. */
export function escapeAuditLikeFragment(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function auditRecordMatchesFilters(
  record: {
    entityType: string;
    action: string;
    actorName?: string;
    recordId?: string;
    occurredAt: string;
  },
  filters: AuditRecordFilters,
) {
  if (filters.entityType && record.entityType.toLowerCase() !== filters.entityType) return false;
  if (filters.action && record.action.toUpperCase() !== filters.action) return false;
  if (filters.actor && !record.actorName?.toLocaleLowerCase().includes(filters.actor.toLocaleLowerCase())) return false;
  if (filters.recordId && record.recordId?.toLowerCase() !== filters.recordId) return false;
  const date = record.occurredAt.slice(0, 10);
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  return true;
}
