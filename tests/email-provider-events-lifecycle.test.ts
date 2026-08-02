import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  return {
    query,
    withAuditTransaction: vi.fn(async (
      _context: unknown,
      callback: (client: { query: typeof query }) => Promise<unknown>,
    ) => callback({ query })),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import {
  emailProviderEventInternals,
  recordCloudflareEmailProviderEvent,
  type CloudflareEmailProviderEvent,
} from "@/lib/email-provider-events";

const common = {
  schemaVersion: 1,
  eventId: "0190d0c4-7e9a-7b3c-9f12-1a2b3c4d5e6f",
  recipientFingerprint: "a".repeat(64),
  messageFingerprint: "b".repeat(64),
  occurredAt: "2026-08-02T10:00:00.000Z",
} as const;

const events: CloudflareEmailProviderEvent[] = [
  { ...common, eventType: "MESSAGE_DELIVERED", terminal: true },
  { ...common, eventType: "MESSAGE_DEFERRED", terminal: false },
  { ...common, eventType: "MESSAGE_BOUNCED", terminal: true, bounceType: "SOFT" },
  { ...common, eventType: "MESSAGE_FAILED", terminal: true },
  { ...common, eventType: "MESSAGE_REJECTED", terminal: true },
  { ...common, eventType: "MESSAGE_COMPLAINED", terminal: true },
];

describe("application Email Sending lifecycle recorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ recorded: true, suppressed: false }] });
  });

  it("accepts all six terminal shapes and passes only minimized fields to SQL", async () => {
    for (const event of events) {
      await expect(recordCloudflareEmailProviderEvent(event)).resolves.toEqual({
        recorded: true,
        suppressed: false,
      });
      const [sql, parameters] = mocks.query.mock.calls.at(-1)!;
      expect(String(sql)).toContain(
        "axora_record_cloudflare_email_event($1,$2,$3,$4,$5,$6,$7,$8)",
      );
      expect(parameters).toEqual([
        event.eventId,
        event.eventType,
        event.recipientFingerprint,
        event.messageFingerprint,
        event.bounceType ?? null,
        event.terminal,
        event.occurredAt,
        event.schemaVersion,
      ]);
      expect(JSON.stringify(parameters)).not.toContain("@example");
    }
  });

  it("rejects wrong terminal, bounce and fingerprint shapes before persistence", () => {
    const validate = emailProviderEventInternals.validateProviderEvent;
    expect(() => validate({
      ...events[1]!,
      terminal: true,
    })).toThrow(/invalid/i);
    expect(() => validate({
      ...events[0]!,
      bounceType: "HARD",
    })).toThrow(/invalid/i);
    expect(() => validate({
      ...events[0]!,
      messageFingerprint: "invalid",
    })).toThrow(/invalid/i);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
