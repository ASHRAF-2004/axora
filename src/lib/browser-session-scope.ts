const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export interface BrowserSessionScope {
  userId: string;
  companyId?: string;
}

function normalizedIdentifier(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : undefined;
}

export function validBrowserSessionScope(
  value: unknown,
): value is BrowserSessionScope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserSessionScope>;
  return Boolean(
    normalizedIdentifier(candidate.userId)
      && (!candidate.companyId || normalizedIdentifier(candidate.companyId)),
  );
}

export function browserSessionScopeFromDocument(): BrowserSessionScope | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector<HTMLElement>("[data-session-user-id]");
  const userId = normalizedIdentifier(root?.dataset.sessionUserId);
  const companyId = normalizedIdentifier(root?.dataset.sessionCompanyId);
  return userId ? { userId, ...(companyId ? { companyId } : {}) } : null;
}

export function scopedBrowserStorageKey(
  prefix: string,
  explicitScope?: BrowserSessionScope | null,
) {
  const scope = explicitScope ?? browserSessionScopeFromDocument();
  if (!scope || !validBrowserSessionScope(scope)) return null;
  return `${prefix}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(
    scope.companyId ?? "no-company",
  )}`;
}

export const browserSessionScopeInternals = {
  identifierPattern: IDENTIFIER_PATTERN,
  normalizedIdentifier,
};
