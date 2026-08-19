const SAFE_ERROR_DIGEST = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;

/**
 * Converts a framework-provided digest into the only diagnostic identifier
 * that may be rendered to end users. Raw exception messages, routes, IDs, and
 * stack information must never be used as the browser-visible reference.
 */
export function safeErrorReference(digest: unknown) {
  if (typeof digest !== "string") return undefined;
  const value = digest.trim();
  if (!SAFE_ERROR_DIGEST.test(value)) return undefined;
  return `AX-${value}`;
}
