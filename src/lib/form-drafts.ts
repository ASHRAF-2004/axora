export const FORM_DRAFT_SCHEMA_VERSION = 1;
export const FORM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const FORM_DRAFT_PREFIX = "axora:form-draft:v1:";

const sensitiveName = /(?:password|passphrase|token|secret|credential|cookie|csrf|api[-_]?key|private[-_]?key|webhook|payment[-_]?secret)/i;
const excludedTypes = new Set(["password", "hidden", "file", "submit", "button", "reset", "image"]);

export interface FormDraftContext {
  userId: string;
  scopeKey: string;
  route: string;
  formId: string;
}

export interface StoredFormDraft {
  schemaVersion: number;
  savedAt: number;
  expiresAt: number;
  submittedAt?: number;
  fields: Record<string, string[]>;
  fileFields: string[];
}

export function isSafeDraftField(name: string, type = "text") {
  const normalizedName = name.trim();
  const normalizedType = type.trim().toLowerCase();
  return normalizedName.length > 0 && normalizedName.length <= 160
    && !sensitiveName.test(normalizedName)
    && !excludedTypes.has(normalizedType);
}

export function isDraftableFormMethod(method: string) {
  return method.trim().toLowerCase() !== "get";
}

function boundedSegment(value: string) {
  return encodeURIComponent(value.trim().slice(0, 512));
}

export function formDraftStorageKey(context: FormDraftContext) {
  return `${FORM_DRAFT_PREFIX}${[
    context.userId,
    context.scopeKey,
    context.route,
    context.formId,
  ].map(boundedSegment).join(":")}`;
}

export function parseStoredFormDraft(raw: string | null, now = Date.now()) {
  if (!raw || raw.length > 150_000) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<StoredFormDraft>;
    if (candidate.schemaVersion !== FORM_DRAFT_SCHEMA_VERSION
      || !Number.isFinite(candidate.savedAt)
      || !Number.isFinite(candidate.expiresAt)
      || Number(candidate.expiresAt) <= now
      || !candidate.fields || Array.isArray(candidate.fields)
      || typeof candidate.fields !== "object"
      || !Array.isArray(candidate.fileFields)
      || candidate.fileFields.length > 20) return null;
    const fields: Record<string, string[]> = {};
    const entries = Object.entries(candidate.fields);
    if (entries.length > 100) return null;
    let totalLength = 0;
    for (const [name, values] of entries) {
      if (!isSafeDraftField(name) || !Array.isArray(values) || values.length > 50
        || values.some((value) => typeof value !== "string" || value.length > 20_000)) {
        return null;
      }
      totalLength += values.reduce((sum, value) => sum + value.length, 0);
      if (totalLength > 100_000) return null;
      fields[name] = values;
    }
    const fileFields = candidate.fileFields.filter((name): name is string => (
      typeof name === "string" && name.length > 0 && name.length <= 160
      && !sensitiveName.test(name)
    ));
    return {
      schemaVersion: FORM_DRAFT_SCHEMA_VERSION,
      savedAt: Number(candidate.savedAt),
      expiresAt: Number(candidate.expiresAt),
      ...(Number.isFinite(candidate.submittedAt)
        ? { submittedAt: Number(candidate.submittedAt) } : {}),
      fields,
      fileFields,
    } satisfies StoredFormDraft;
  } catch {
    return null;
  }
}

export function createStoredFormDraft(
  fields: Record<string, string[]>,
  fileFields: string[],
  options: { now?: number; submitted?: boolean } = {},
) {
  const now = options.now ?? Date.now();
  return {
    schemaVersion: FORM_DRAFT_SCHEMA_VERSION,
    savedAt: now,
    expiresAt: now + FORM_DRAFT_TTL_MS,
    ...(options.submitted ? { submittedAt: now } : {}),
    fields,
    fileFields,
  } satisfies StoredFormDraft;
}
