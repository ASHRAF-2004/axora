import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
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

import {
  ContactVerificationError,
  submitPublicContact,
} from "@/lib/public-contact";

const turnstile = {
  success: true as const,
  challengeTimestamp: new Date().toISOString(),
  hostname: "axora.management",
  action: "contact" as const,
};

describe("validated public contact persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "https://axora.management";
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-contact-email-service-key-abcdefghijklmnopqrstuvwxyz";
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public_request_rate_buckets")) {
        return { rowCount: 1, rows: [{ request_count: 1 }] };
      }
      if (sql.includes("INSERT INTO public_contact_submissions")) {
        return { rowCount: 1, rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
      }
      if (sql.includes("INSERT INTO transactional_email_outbox")) {
        return { rowCount: 1, rows: [{ id: "00000000-0000-4000-8000-000000000002" }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it("stores validated fields and only keyed network and sender fingerprints", async () => {
    const rawNetwork = "203.0.113.41";
    const result = await submitPublicContact({
      locale: "en",
      name: "  Aisha Rahman  ",
      email: "AISHA@EXAMPLE.TEST",
      company: "  Example Industries ",
      phone: " +60 12 345 6789 ",
      subject: " Procurement workflow ",
      message: " We would like to discuss a controlled purchasing rollout. ",
      privacyAccepted: true,
    }, turnstile, rawNetwork);

    expect(result.submissionId).toBe("00000000-0000-4000-8000-000000000001");
    const contactInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public_contact_submissions"));
    expect(contactInsert?.[1]).toEqual(expect.arrayContaining([
      "en",
      "Aisha Rahman",
      "aisha@example.test",
      "Example Industries",
      "+60 12 345 6789",
    ]));
    expect(contactInsert?.[1]?.[7]).toMatch(/^[0-9a-f]{64}$/);
    expect(contactInsert?.[1]?.[8]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(rawNetwork);
    expect(mocks.client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO public_request_rate_buckets"))).toHaveLength(2);
  });

  it("rejects stale or wrong-host verification before any database work", async () => {
    await expect(submitPublicContact({
      locale: "en",
      name: "Aisha Rahman",
      email: "aisha@example.test",
      company: "Example Industries",
      subject: "Procurement workflow",
      message: "We would like to discuss a controlled purchasing rollout.",
      privacyAccepted: true,
    }, {
      ...turnstile,
      challengeTimestamp: new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
    }, "203.0.113.41")).rejects.toBeInstanceOf(ContactVerificationError);

    await expect(submitPublicContact({
      locale: "en",
      name: "Aisha Rahman",
      email: "aisha@example.test",
      company: "Example Industries",
      subject: "Procurement workflow",
      message: "We would like to discuss a controlled purchasing rollout.",
      privacyAccepted: true,
    }, { ...turnstile, hostname: "attacker.example" }, "203.0.113.41"))
      .rejects.toBeInstanceOf(ContactVerificationError);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("rejects control characters in single-line contact fields before persistence", async () => {
    await expect(submitPublicContact({
      locale: "en",
      name: "Aisha Rahman",
      email: "aisha@example.test",
      company: "Example Industries",
      subject: "Procurement\nBcc: attacker@example.test",
      message: "We would like to discuss a controlled purchasing rollout.",
      privacyAccepted: true,
    }, turnstile, "203.0.113.41")).rejects.toThrow();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("normalizes malformed verification payloads to the same verification error", async () => {
    await expect(submitPublicContact({
      locale: "en",
      name: "Aisha Rahman",
      email: "aisha@example.test",
      company: "Example Industries",
      subject: "Procurement workflow",
      message: "We would like to discuss a controlled purchasing rollout.",
      privacyAccepted: true,
    }, {
      ...turnstile,
      action: "login",
    } as never, "203.0.113.41")).rejects.toBeInstanceOf(ContactVerificationError);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("rolls back before persistence when either hourly bucket is exhausted", async () => {
    mocks.client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(submitPublicContact({
      locale: "en",
      name: "Aisha Rahman",
      email: "aisha@example.test",
      company: "Example Industries",
      subject: "Procurement workflow",
      message: "We would like to discuss a controlled purchasing rollout.",
      privacyAccepted: true,
    }, turnstile, "203.0.113.41")).rejects.toThrow(/rate limited/i);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO public_contact_submissions"))).toBe(false);
  });
});
