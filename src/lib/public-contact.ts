import { z } from "zod";
import { isDemoMode, withAuditTransaction } from "./db";
import {
  consumePublicRequestRateLimit,
  insertContactEmailOutbox,
  publicRequestRateKey,
  type SupportedEmailLocale,
} from "./transactional-email";

const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const singleLine = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine((value) => !SINGLE_LINE_CONTROL_PATTERN.test(value));

const contactSubmissionSchema = z.object({
  locale: z.enum(["en", "ar", "ms"]),
  name: singleLine(2, 200),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  company: singleLine(1, 200),
  phone: z.string().trim().max(40)
    .refine((value) => !SINGLE_LINE_CONTROL_PATTERN.test(value))
    .optional().transform((value) => value || undefined),
  subject: singleLine(3, 200),
  message: z.string().trim().min(10).max(5_000)
    .refine((value) => !MULTILINE_CONTROL_PATTERN.test(value)),
  privacyAccepted: z.literal(true),
}).strict();

const verifiedTurnstileSchema = z.object({
  success: z.literal(true),
  challengeTimestamp: z.string().max(80),
  hostname: z.string().trim().min(1).max(253),
  action: z.literal("contact"),
}).strict();

export interface PublicContactSubmissionInput {
  locale: SupportedEmailLocale;
  name: string;
  email: string;
  company: string;
  phone?: string;
  subject: string;
  message: string;
  privacyAccepted: true;
}

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
    // Keep all verification failures indistinguishable to the public caller.
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

/**
 * Persist a contact enquiry and its notification atomically. The caller must
 * pass only a result returned by a server-side Turnstile Siteverify request;
 * the Turnstile response token itself is never accepted or stored here.
 */
export async function submitPublicContact(
  input: PublicContactSubmissionInput,
  turnstile: VerifiedContactTurnstileResult,
  networkIdentifier: string,
) {
  if (isDemoMode()) throw new Error("Contact submission is unavailable in demo mode.");
  const parsed = contactSubmissionSchema.parse(input);
  const verified = validateTurnstileResult(turnstile);
  const networkRateKey = publicRequestRateKey("network", networkIdentifier);
  const senderRateKey = publicRequestRateKey("identifier", parsed.email);

  return withAuditTransaction(
    { reason: "Public contact submission received" },
    async (client) => {
      await consumePublicRequestRateLimit(client, "CONTACT", [
        { kind: "NETWORK", hash: networkRateKey, hourlyLimit: 6 },
        { kind: "IDENTIFIER", hash: senderRateKey, hourlyLimit: 4 },
      ]);
      const submission = await client.query<{ id: string }>(
        `INSERT INTO public_contact_submissions(
           locale,contact_name,contact_email,company_name,phone,subject,message,
           privacy_accepted_at,network_rate_key,sender_rate_key,
           turnstile_success,turnstile_challenge_at,
           turnstile_verified_at,turnstile_hostname,turnstile_action
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,now(),$8,$9,true,$10,now(),$11,'contact'
         ) RETURNING id::text`,
        [
          parsed.locale,
          parsed.name,
          parsed.email,
          parsed.company,
          parsed.phone ?? null,
          parsed.subject,
          parsed.message,
          networkRateKey,
          senderRateKey,
          verified.challengeAt,
          verified.hostname.toLowerCase(),
        ],
      );
      await insertContactEmailOutbox(
        client,
        submission.rows[0].id,
        parsed.locale,
      );
      return { submissionId: submission.rows[0].id };
    },
  );
}

export const publicContactInternals = {
  expectedTurnstileHostname,
  validateTurnstileResult,
};
