import { canAccess, type AccessSubject, type Permission } from "./permissions";

const AXORA_ORIGIN = "https://axora.management";
const MAX_RETURN_PATH_LENGTH = 2_048;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export const SESSION_RETURN_HEADER = "x-axora-return-to";
export const SESSION_RETURN_STORAGE_KEY = "axora-session-return:v1";

export type SessionReturnReason =
  | "required"
  | "expired"
  | "access-changed";

interface ReturnRule {
  pattern: RegExp;
  permission?: Permission;
}

// Keep the most specific routes before their parent routes. Exact resource
// authorization still occurs in the destination page; this list prevents a
// return target from granting access to an entire workspace the actor cannot
// enter at all.
const RETURN_RULES: readonly ReturnRule[] = [
  { pattern: /^\/products\/[^/]+\/edit(?:\/|$)/, permission: "manage_catalog" },
  { pattern: /^\/requests\/new(?:\/|$)/, permission: "create_requests" },
  { pattern: /^\/dashboard(?:\/|$)/, permission: "view_dashboard" },
  { pattern: /^\/driver(?:\/|$)/, permission: "view_delivery_portal" },
  { pattern: /^\/receiving(?:\/|$)/, permission: "view_receiving" },
  { pattern: /^\/companies(?:\/|$)/, permission: "manage_companies" },
  { pattern: /^\/products(?:\/|$)/, permission: "view_catalog" },
  { pattern: /^\/requests(?:\/|$)/, permission: "view_requests" },
  { pattern: /^\/approvals(?:\/|$)/, permission: "view_approvals" },
  { pattern: /^\/budgets(?:\/|$)/, permission: "view_budgets" },
  { pattern: /^\/deliveries(?:\/|$)/, permission: "view_deliveries" },
  { pattern: /^\/finance(?:\/|$)/, permission: "view_invoices" },
  { pattern: /^\/branches(?:\/|$)/, permission: "view_branches" },
  { pattern: /^\/users(?:\/|$)/, permission: "manage_users" },
  { pattern: /^\/reports(?:\/|$)/, permission: "view_reports" },
  { pattern: /^\/audit(?:\/|$)/, permission: "view_audit" },
  { pattern: /^\/support(?:\/|$)/, permission: "view_system_diagnostics" },
  { pattern: /^\/(?:account|profile|notifications|settings|help)(?:\/|$)/ },
];

function parsedInternalPath(raw: string | null | undefined) {
  const candidate = String(raw ?? "").trim();
  if (!candidate
    || candidate.length > MAX_RETURN_PATH_LENGTH
    || CONTROL_CHARACTERS.test(candidate)
    || candidate.includes("\\")
    || candidate.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(candidate, AXORA_ORIGIN);
    if (parsed.origin !== AXORA_ORIGIN
      || parsed.username
      || parsed.password
      || !parsed.pathname.startsWith("/")
      || parsed.pathname.startsWith("//")) {
      return null;
    }

    const safe = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const decoded = decodeURIComponent(safe);
    if (CONTROL_CHARACTERS.test(decoded)
      || decoded.includes("\\")
      || decoded.startsWith("//")) {
      return null;
    }

    return safe.length <= MAX_RETURN_PATH_LENGTH ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecognizedProtectedPath(pathname: string) {
  return RETURN_RULES.some((rule) => rule.pattern.test(pathname));
}

export function safeInternalReturnPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
) {
  const parsed = parsedInternalPath(raw);
  if (!parsed || !isRecognizedProtectedPath(parsed.pathname)) {
    const safeFallback = parsedInternalPath(fallback);
    return safeFallback && isRecognizedProtectedPath(safeFallback.pathname)
      ? `${safeFallback.pathname}${safeFallback.search}${safeFallback.hash}`
      : "/dashboard";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function authorizedSessionReturnPath(
  actor: AccessSubject,
  raw: string | null | undefined,
  fallback: string,
) {
  const safe = safeInternalReturnPath(raw, fallback);
  const parsed = parsedInternalPath(safe);
  if (!parsed) return safeInternalReturnPath(fallback, "/dashboard");
  const rule = RETURN_RULES.find((candidate) => (
    candidate.pattern.test(parsed.pathname)
  ));
  if (!rule || (rule.permission && !canAccess(actor, rule.permission))) {
    return safeInternalReturnPath(fallback, "/dashboard");
  }
  return safe;
}

export function mergeStoredReturnHash(
  candidate: string | null | undefined,
  stored: string | null | undefined,
  fallback = "/dashboard",
) {
  const safeCandidate = safeInternalReturnPath(candidate, fallback);
  const safeStored = safeInternalReturnPath(stored, safeCandidate);
  const candidateUrl = parsedInternalPath(safeCandidate);
  const storedUrl = parsedInternalPath(safeStored);
  if (!candidateUrl || !storedUrl || candidateUrl.hash) return safeCandidate;
  if (candidateUrl.pathname !== storedUrl.pathname
    || candidateUrl.search !== storedUrl.search
    || !storedUrl.hash) {
    return safeCandidate;
  }
  return `${candidateUrl.pathname}${candidateUrl.search}${storedUrl.hash}`;
}

export function browserReturnPath() {
  if (typeof window === "undefined") return null;
  try {
    return safeInternalReturnPath(
      window.sessionStorage.getItem(SESSION_RETURN_STORAGE_KEY),
      "/dashboard",
    );
  } catch {
    return null;
  }
}

export function recordBrowserReturnPath(raw?: string) {
  if (typeof window === "undefined") return;
  const candidate = raw
    ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const parsed = parsedInternalPath(candidate);
  if (!parsed || !isRecognizedProtectedPath(parsed.pathname)) return;
  try {
    window.sessionStorage.setItem(
      SESSION_RETURN_STORAGE_KEY,
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
    );
  } catch {
    // Route recovery remains best-effort when browser storage is unavailable.
  }
}

export function clearBrowserReturnPath() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_RETURN_STORAGE_KEY);
  } catch {
    // Explicit sign-out still succeeds if browser storage is unavailable.
  }
}

export const sessionReturnInternals = {
  maxLength: MAX_RETURN_PATH_LENGTH,
  parsedInternalPath,
  returnRules: RETURN_RULES,
};
