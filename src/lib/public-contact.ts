import { z } from "zod";
import { isDemoMode, withAuditTransaction } from "./db";
import { requiredPhoneNumberSchema } from "./phone-number";
import {
  consumePublicRequestRateLimit,
  publicRequestRateKey,
  type SupportedEmailLocale,
} from "./transactional-email";
import { recordPublicContactSubmission } from "./public-contact-persistence";

const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const singleLine = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine((value) => !SINGLE_LINE_CONTROL_PATTERN.test(value))
  .transform((value) => value.replace(/\s+/g, " "));
const optionalSingleLine = (maximum: number) => z.string()
  .trim()
  .max(maximum)
  .refine((value) => !SINGLE_LINE_CONTROL_PATTERN.test(value))
  .transform((value) => value.replace(/\s+/g, " "));

const campaignSchema = z.object({
  source: optionalSingleLine(160).optional(),
  medium: optionalSingleLine(160).optional(),
  campaign: optionalSingleLine(200).optional(),
  term: optionalSingleLine(200).optional(),
  content: optionalSingleLine(200).optional(),
}).strict();

const contactSubmissionSchema = z.object({
  locale: z.enum(["en", "ar", "ms"]),
  idempotencyToken: z.string().uuid(),
  fullName: singleLine(2, 200),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: requiredPhoneNumberSchema,
  message: z.string().trim().min(10).max(5_000)
    .refine((value) => !MULTILINE_CONTROL_PATTERN.test(value)),
  campaign: campaignSchema,
  privacyAccepted: z.literal(true),
}).strict();

const verifiedTurnstileSchema = z.object({
  success: z.literal(true),
  challengeTimestamp: z.string().max(80),
  hostname: z.string().trim().min(1).max(253),
  action: z.literal("contact"),
}).strict();

export type PublicContactSubmissionInput = z.input<typeof contactSubmissionSchema>;

export interface VerifiedContactTurnstileResult {
  success: true;
  challengeTimestamp: string;
  hostname: string;
  action: "contact";
}

export class ContactVerificationError extends Error {
  constructor() {
    super("The contact verification is invalid or expired.");
    this.name = "ContactVerificationError";
  }
}

function expectedTurnstileHostname() {
  const configured = process.env.AXORA_TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
  if (configured) return configured;
  try {
    return new URL(process.env.APP_BASE_URL ?? "https://axora.management").hostname.toLowerCase();
  } catch {
    throw new ContactVerificationError();
  }
}

function validateTurnstileResult(
  input: VerifiedContactTurnstileResult,
  now = new Date(),
) {
  let result: z.infer<typeof verifiedTurnstileSchema>;
  try {
    result = verifiedTurnstileSchema.parse(input);
  } catch {
    throw new ContactVerificationError();
  }
  const challengeAt = new Date(result.challengeTimestamp);
  const age = now.getTime() - challengeAt.getTime();
  if (!Number.isFinite(challengeAt.getTime())
    || result.hostname.toLowerCase() !== expectedTurnstileHostname()
    || age < -60 * 1_000 || age > 5 * 60 * 1_000) {
    throw new ContactVerificationError();
  }
  return { ...result, challengeAt };
}

export async function submitPublicContact(
  input: PublicContactSubmissionInput,
  turnstile: VerifiedContactTurnstileResult,
  networkIdentifier: string,
) {
  if (isDemoMode()) throw new Error("Contact submission is unavailable in demo mode.");
  const parsed = contactSubmissionSchema.parse(input);
  const capturedAt = new Date();
  const verified = validateTurnstileResult(turnstile, capturedAt);
  const networkRateKey = publicRequestRateKey("network", networkIdentifier);
  const senderRateKey = publicRequestRateKey(
    "identifier",
    parsed.email,
  );
  const idempotencyKey = publicRequestRateKey(
    "identifier",
    `public-contact:${parsed.idempotencyToken}`,
  );
  const sourceMetadata = Object.fromEntries(
    Object.entries(parsed.campaign).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return withAuditTransaction(
    { reason: "Public contact enquiry received" },
    async (client) => {
      await consumePublicRequestRateLimit(client, "CONTACT", [
        { kind: "NETWORK", hash: networkRateKey, hourlyLimit: 6 },
        { kind: "IDENTIFIER", hash: senderRateKey, hourlyLimit: 4 },
      ]);
      const mutation = await recordPublicContactSubmission(client, {
        idempotencyKey,
        locale: parsed.locale,
        fullName: parsed.fullName,
        email: parsed.email,
        phone: parsed.phone,
        message: parsed.message,
        privacyPolicyVersion: "privacy-policy-2026-08-28",
        sourcePage: `/${parsed.locale}/contact`,
        sourceMetadata,
        networkRateKey,
        senderRateKey,
        turnstileChallengeAt: verified.challengeAt.toISOString(),
        turnstileHostname: verified.hostname.toLowerCase(),
      }, parsed.locale as SupportedEmailLocale, capturedAt);
      return { submissionId: mutation.submissionId };
    },
  );
}

export const publicContactInternals = {
  contactSubmissionSchema,
  expectedTurnstileHostname,
  validateTurnstileResult,
};
