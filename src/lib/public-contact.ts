import { z } from "zod";
import { isDemoMode, withAuditTransaction } from "./db";
import { recordPublicCompanyLead } from "./company-leads";
import {
  consumePublicRequestRateLimit,
  publicRequestRateKey,
  type SupportedEmailLocale,
} from "./transactional-email";

const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PHONE_PATTERN = /^[+0-9() .-]+$/;
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

function validIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

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
  contactName: singleLine(2, 200),
  contactEmail: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  companyName: singleLine(2, 200),
  companyLegalName: singleLine(2, 300),
  registrationNumber: optionalSingleLine(160),
  phoneCountryCode: z.string().trim().min(1).max(12).regex(/^\+[0-9]{1,4}$/),
  phone: z.string().trim().min(3).max(40).regex(PHONE_PATTERN)
    .transform((value) => value.replace(/\s+/g, " ")),
  country: singleLine(2, 120),
  region: singleLine(2, 160),
  city: singleLine(2, 160),
  industry: singleLine(2, 200),
  employeeRange: z.enum(["1_10", "11_50", "51_200", "201_500", "501_1000", "1001_PLUS"]),
  branchRange: z.enum(["1", "2_5", "6_20", "21_50", "51_PLUS"]),
  spendRange: z.enum(["UNDER_10K", "10K_50K", "50K_250K", "250K_1M", "OVER_1M", "UNDISCLOSED"]),
  contactMethod: z.enum(["EMAIL", "PHONE", "WHATSAPP", "VIDEO_CALL"]),
  contactTime: optionalSingleLine(160),
  contactTimezone: singleLine(1, 80).refine(validIanaTimezone),
  subject: singleLine(3, 200),
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
  const senderRateKey = publicRequestRateKey("identifier", parsed.contactEmail);
  const idempotencyKey = publicRequestRateKey(
    "identifier",
    `company-lead:${parsed.idempotencyToken}:${parsed.contactEmail}`,
  );
  const sourceMetadata = Object.fromEntries(
    Object.entries(parsed.campaign).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return withAuditTransaction(
    { reason: "Public company enquiry received" },
    async (client) => {
      await consumePublicRequestRateLimit(client, "CONTACT", [
        { kind: "NETWORK", hash: networkRateKey, hourlyLimit: 6 },
        { kind: "IDENTIFIER", hash: senderRateKey, hourlyLimit: 4 },
      ]);
      const mutation = await recordPublicCompanyLead(client, {
        idempotencyKey,
        locale: parsed.locale,
        contactName: parsed.contactName,
        contactEmail: parsed.contactEmail,
        companyName: parsed.companyName,
        companyLegalName: parsed.companyLegalName,
        registrationNumber: parsed.registrationNumber,
        phoneCountryCode: parsed.phoneCountryCode,
        phone: parsed.phone,
        country: parsed.country,
        region: parsed.region,
        city: parsed.city,
        industry: parsed.industry,
        employeeRange: parsed.employeeRange,
        branchRange: parsed.branchRange,
        spendRange: parsed.spendRange,
        contactMethod: parsed.contactMethod,
        contactTime: parsed.contactTime,
        contactTimezone: parsed.contactTimezone,
        subject: parsed.subject,
        message: parsed.message,
        privacyPolicyVersion: "public-enquiry-2026-08-08",
        sourcePage: `/${parsed.locale}/contact`,
        sourceMetadata,
        networkRateKey,
        senderRateKey,
        turnstileChallengeAt: verified.challengeAt.toISOString(),
        turnstileHostname: verified.hostname.toLowerCase(),
      }, parsed.locale as SupportedEmailLocale, capturedAt);
      return { submissionId: mutation.submissionId, leadId: mutation.leadId };
    },
  );
}

export const publicContactInternals = {
  contactSubmissionSchema,
  expectedTurnstileHostname,
  validateTurnstileResult,
  validIanaTimezone,
};
