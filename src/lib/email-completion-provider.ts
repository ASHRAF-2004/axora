export const EMAIL_COMPLETION_PROVIDER_NAMES = [
  "resend",
  "zeptomail",
  "cloudflare-email-service",
  "test",
  "unconfigured",
] as const;

export type EmailCompletionProviderName =
  (typeof EMAIL_COMPLETION_PROVIDER_NAMES)[number];

export function normalizeEmailCompletionProviderName(
  value: string | undefined,
  invalidMessage: string,
): EmailCompletionProviderName {
  const normalized = value?.trim() || "unconfigured";
  if (!(EMAIL_COMPLETION_PROVIDER_NAMES as readonly string[]).includes(normalized)) {
    throw new Error(invalidMessage);
  }
  return normalized as EmailCompletionProviderName;
}
