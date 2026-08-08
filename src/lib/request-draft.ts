import {
  scopedBrowserStorageKey,
  type BrowserSessionScope,
} from "./browser-session-scope";

const REQUEST_DRAFT_PREFIX = "axora-request-draft:v1";
const REQUEST_TYPES = new Set(["Standard", "Ad-hoc", "Recurring"]);
const URGENCIES = new Set(["Low", "Normal", "High", "Urgent"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestDraftState {
  branchId: string;
  department: string;
  neededByDate: string;
  requestType: "Standard" | "Ad-hoc" | "Recurring";
  urgency: "Low" | "Normal" | "High" | "Urgent";
  notes: string;
  submissionKey: string;
  updatedAt: string;
}

function requestDraftStorageKey(scope?: BrowserSessionScope | null) {
  return scopedBrowserStorageKey(REQUEST_DRAFT_PREFIX, scope);
}

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validDraft(value: unknown): value is RequestDraftState {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RequestDraftState>;
  return Boolean(
    typeof draft.branchId === "string"
      && draft.branchId.length <= 160
      && typeof draft.department === "string"
      && draft.department.length <= 200
      && validDate(draft.neededByDate)
      && REQUEST_TYPES.has(String(draft.requestType))
      && URGENCIES.has(String(draft.urgency))
      && typeof draft.notes === "string"
      && draft.notes.length <= 3_000
      && typeof draft.submissionKey === "string"
      && UUID_PATTERN.test(draft.submissionKey)
      && typeof draft.updatedAt === "string"
      && Number.isFinite(Date.parse(draft.updatedAt)),
  );
}

export function newRequestSubmissionKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Secure browser randomness is unavailable.");
}

export function readRequestDraft(scope?: BrowserSessionScope | null) {
  if (typeof window === "undefined") return null;
  const key = requestDraftStorageKey(scope);
  if (!key) return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return validDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRequestDraft(
  draft: Omit<RequestDraftState, "updatedAt">,
  scope?: BrowserSessionScope | null,
) {
  if (typeof window === "undefined") return;
  const key = requestDraftStorageKey(scope);
  if (!key) return;
  const value: RequestDraftState = {
    ...draft,
    branchId: draft.branchId.slice(0, 160),
    department: draft.department.slice(0, 200),
    notes: draft.notes.slice(0, 3_000),
    updatedAt: new Date().toISOString(),
  };
  if (!validDraft(value)) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled storage area must not block request entry.
  }
}

export function clearRequestDraft(scope?: BrowserSessionScope | null) {
  if (typeof window === "undefined") return;
  const key = requestDraftStorageKey(scope);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Explicit sign-out and successful submission still proceed.
  }
}

export const requestDraftInternals = {
  requestDraftStorageKey,
  validDraft,
};
