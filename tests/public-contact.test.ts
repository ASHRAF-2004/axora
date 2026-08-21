import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  submission: "52000000-0000-4000-8000-000000000002",
};

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    recordPublicContactSubmission: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));
vi.mock("@/lib/company-leads", () => ({
  recordPublicContactSubmission: mocks.recordPublicContactSubmission,
}));

import {
  ContactVerificationError,
  submitPublicContact,
  type PublicContactSubmissionInput,
} from "@/lib/public-contact";

const turnstile = {
  success: true as const,
  challengeTimestamp: new Date().toISOString(),
  hostname: "axora.management",
  action: "contact" as const,
};

function validInput(overrides: Partial<PublicContactSubmissionInput> = {}): PublicContactSubmissionInput {
  return {
    locale: "en",
    idempotencyToken: "52000000-0000-4000-8000-000000000003",
    contactName: "Aisha Rahman",
    companyName: "Example Industries",
    companyLegalName: "Example Industries Sdn Bhd",
    city: "Shah Alam",
    industry: "Manufacturing",
    employeeRange: "51_200",
    branchRange: "2_5",
    spendRange: "50K_250K",
    contactMethod: "EMAIL",
    contactTimezone: "Asia/Kuala_Lumpur",
    subject: "Procurement workflow",
    message: "We would like to discuss a controlled purchasing rollout.",
    campaign: { source: "meeting", campaign: "august-2026" },
    privacyAccepted: true,
    ...overrides,
  };
}

describe("validated public contact intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "https://axora.management";
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-contact-email-service-key-abcdefghijklmnopqrstuvwxyz";
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public_request_rate_buckets")) {
        return { rowCount: 1, rows: [{ request_count: 1 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mocks.recordPublicContactSubmission.mockResolvedValue({
      created: true,
      submissionId: ids.submission,
    });
  });

  it("normalizes the complete form and stores only keyed abuse fingerprints", async () => {
    const rawNetwork = "203.0.113.41";
    const result = await submitPublicContact(validInput({
      contactName: "  Aisha   Rahman  ",
      companyName: "  Example   Industries ",
    }), turnstile, rawNetwork);

    expect(result).toEqual({ submissionId: ids.submission });
    const payload = mocks.recordPublicContactSubmission.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      contactName: "Aisha Rahman",
      companyName: "Example Industries",
      privacyPolicyVersion: "public-enquiry-2026-08-08",
      sourcePage: "/en/contact",
      sourceMetadata: { source: "meeting", campaign: "august-2026" },
    });
    expect(payload.networkRateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.senderRateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    for (const removedField of [
      "registrationNumber", "contactEmail", "phoneCountryCode", "phone",
      "country", "region", "contactTime",
    ]) {
      expect(payload).not.toHaveProperty(removedField);
    }
    expect(JSON.stringify(mocks.recordPublicContactSubmission.mock.calls)).not.toContain(rawNetwork);
    expect(mocks.client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO public_request_rate_buckets"))).toHaveLength(2);
  });

  it("derives a stable idempotency key for repeat clicks and a new key for a new form", async () => {
    await submitPublicContact(validInput(), turnstile, "203.0.113.41");
    const firstKey = mocks.recordPublicContactSubmission.mock.calls[0]?.[1]?.idempotencyKey;
    vi.clearAllMocks();
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{ request_count: 1 }] });
    mocks.recordPublicContactSubmission.mockResolvedValue({
      created: false, submissionId: ids.submission,
    });
    await submitPublicContact(validInput(), turnstile, "203.0.113.41");
    const secondKey = mocks.recordPublicContactSubmission.mock.calls[0]?.[1]?.idempotencyKey;
    await submitPublicContact(validInput({
      idempotencyToken: "52000000-0000-4000-8000-000000000004",
    }), turnstile, "203.0.113.41");
    const thirdKey = mocks.recordPublicContactSubmission.mock.calls[1]?.[1]?.idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(thirdKey).not.toBe(firstKey);
  });

  it("rejects stale or wrong-host bot verification before database work", async () => {
    await expect(submitPublicContact(validInput(), {
      ...turnstile,
      challengeTimestamp: new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
    }, "203.0.113.41")).rejects.toBeInstanceOf(ContactVerificationError);
    await expect(submitPublicContact(validInput(), {
      ...turnstile, hostname: "attacker.example",
    }, "203.0.113.41")).rejects.toBeInstanceOf(ContactVerificationError);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid timezone, control characters, and overlong fields", async () => {
    await expect(submitPublicContact(validInput({
      contactTimezone: "Not/A_Timezone",
    }), turnstile, "203.0.113.41")).rejects.toThrow();
    await expect(submitPublicContact(validInput({
      subject: "Procurement\nBcc: attacker@example.test",
    }), turnstile, "203.0.113.41")).rejects.toThrow();
    await expect(submitPublicContact(validInput({
      message: "x".repeat(5_001),
    }), turnstile, "203.0.113.41")).rejects.toThrow();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("rejects legacy contact fields instead of silently persisting them", async () => {
    await expect(submitPublicContact({
      ...validInput(),
      contactEmail: "legacy@example.test",
      registrationNumber: "MY-LEGACY",
      phoneCountryCode: "+60",
      phone: "123456789",
      country: "Malaysia",
      region: "Selangor",
      contactTime: "Weekday mornings",
    } as PublicContactSubmissionInput, turnstile, "203.0.113.41")).rejects.toThrow();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("preserves hostile markup as plain data for escaped renderers", async () => {
    const message = "<script>alert('stored-xss')</script> Procurement details";
    await submitPublicContact(validInput({ message }), turnstile, "203.0.113.41");
    expect(mocks.recordPublicContactSubmission.mock.calls[0]?.[1]?.message).toBe(message);
  });

  it("stops before persistence when either durable hourly bucket is exhausted", async () => {
    mocks.client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(submitPublicContact(
      validInput(), turnstile, "203.0.113.41",
    )).rejects.toThrow(/rate limited/i);
    expect(mocks.recordPublicContactSubmission).not.toHaveBeenCalled();
  });
});

describe("public contact surfaces", () => {
  const source = (path: string) =>
    readFile(new URL(`../${path}`, import.meta.url), "utf8");

  it("omits retired fields from acquisition, onboarding, and lead workspaces", async () => {
    const [page, action, leads, copy, onboardingPage, onboardingAction] = await Promise.all([
      source("src/app/[locale]/contact/page.tsx"),
      source("src/app/[locale]/contact/actions.ts"),
      source("src/app/(portal)/companies/leads/page.tsx"),
      source("src/lib/company-leads-i18n.ts"),
      source("src/app/(portal)/companies/[companyId]/onboarding/page.tsx"),
      source("src/app/(portal)/companies/[companyId]/onboarding/actions.ts"),
    ]);
    for (const field of [
      "registrationNumber", "contactEmail", "phoneCountryCode", "phone",
      "country", "region", "contactTime",
    ]) {
      expect(page).not.toContain(`name=\"${field}\"`);
      expect(action).not.toContain(`formData.get(\"${field}\")`);
    }
    expect(leads).not.toContain('name="region"');
    for (const expression of [
      "lead.registrationNumber", "lead.contactEmail", "lead.phoneCountryCode",
      "lead.phone", "lead.country", "lead.region", "lead.preferredContactTime",
      "lead.usesPersonalEmail",
    ]) expect(leads).not.toContain(expression);
    for (const retiredLabel of [
      "Registration number", "Business email", "Country code", "Phone number",
      "Preferred contact time",
    ]) expect(copy).not.toContain(retiredLabel);
    expect(onboardingPage).not.toContain('name="billingContactPhone"');
    expect(onboardingAction).not.toContain('readFormText(formData, "billingContactPhone")');
  });
});
