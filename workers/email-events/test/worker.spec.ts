import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailEventWorkerInternals,
  providerMessageFingerprint,
  recipientFingerprint,
  sanitizeProviderEvent,
  signEventBody,
} from "../src/index";

const eventId = "0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6";
const occurredAt = "2026-08-02T10:00:00.000Z";
const environment: Env = {
  AXORA_EMAIL_EVENTS_ENDPOINT_URL:
    "https://axora.management/api/email/provider-events/cloudflare",
  AXORA_EMAIL_EVENTS_EXPECTED_DOMAIN: "axora.management",
  AXORA_EMAIL_EVENTS_WEBHOOK_SECRET:
    "test-only-email-events-webhook-secret-abcdefghijklmnopqrstuvwxyz",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type EventFixture =
  | "delivered"
  | "deferred"
  | "hard"
  | "soft"
  | "failed"
  | "rejected"
  | "complained";

function event(type: EventFixture) {
  const providerType = type === "hard" || type === "soft" ? "bounced" : type;
  return {
    type: `cf.email.sending.message.${providerType}`,
    source: { type: "email.sending", domain: "axora.management" },
    payload: {
      eventId,
      messageId: "0101018f7d0c4d9a-msg-privacy-fixture",
      sender: "noreply@axora.management",
      recipient: "  Person@Example.test ",
      terminal: type !== "deferred",
      subject: "This must never be forwarded",
      delivery: {
        status: providerType,
        smtpResponse: "This must never be forwarded",
      },
      ...(type === "complained" ? { complaint: { type: "abuse" } } : {}),
      ...(type === "hard" || type === "soft" || type === "deferred"
        ? { bounce: { type: type === "hard" ? "hard" : "soft" } }
        : {}),
      ...(type === "failed" ? { failure: { reason: "delivery_failed" } } : {}),
      ...(type === "rejected" ? {
        rejection: {
          reason: "suppressed",
          party: "recipient",
          detail: "This must never be forwarded",
        },
      } : {}),
    },
    metadata: { eventSchemaVersion: 1, eventTimestamp: occurredAt },
  };
}

describe("Axora Email Sending event consumer", () => {
  it("minimizes hard-bounce data to an address fingerprint", async () => {
    const result = await sanitizeProviderEvent(event("hard"), "axora.management");
    expect(result).toEqual({
      schemaVersion: 1,
      eventId,
      eventType: "MESSAGE_BOUNCED",
      recipientFingerprint: await recipientFingerprint("person@example.test"),
      messageFingerprint: await providerMessageFingerprint(
        "0101018f7d0c4d9a-msg-privacy-fixture",
      ),
      terminal: true,
      bounceType: "HARD",
      occurredAt,
    });
    expect(JSON.stringify(result)).not.toContain("Person@Example.test");
    expect(JSON.stringify(result)).not.toContain("0101018f7d0c4d9a-msg");
    expect(JSON.stringify(result)).not.toContain("subject");
    expect(JSON.stringify(result)).not.toContain("smtp");
  });

  it("preserves soft bounce semantics without converting it to a suppression", async () => {
    await expect(sanitizeProviderEvent(event("soft"), "axora.management"))
      .resolves.toMatchObject({
        eventType: "MESSAGE_BOUNCED",
        bounceType: "SOFT",
      });
  });

  it("validates and minimizes every official lifecycle event type", async () => {
    const cases = [
      ["delivered", "MESSAGE_DELIVERED", true],
      ["deferred", "MESSAGE_DEFERRED", false],
      ["hard", "MESSAGE_BOUNCED", true],
      ["failed", "MESSAGE_FAILED", true],
      ["rejected", "MESSAGE_REJECTED", true],
      ["complained", "MESSAGE_COMPLAINED", true],
    ] as const;
    for (const [providerType, eventType, terminal] of cases) {
      const result = await sanitizeProviderEvent(
        event(providerType),
        "axora.management",
      );
      expect(result).toMatchObject({ eventType, terminal });
      expect(result.messageFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(result)).not.toContain("subject");
      expect(JSON.stringify(result)).not.toContain("smtp");
    }
  });

  it("accepts complaints and rejects the wrong domain or unsupported event", async () => {
    const complaint = event("complained");
    complaint.payload.complaint = { type: "abuse report" };
    await expect(sanitizeProviderEvent(complaint, "axora.management"))
      .resolves.toMatchObject({ eventType: "MESSAGE_COMPLAINED" });
    await expect(sanitizeProviderEvent({
      ...event("hard"),
      source: { type: "email.sending", domain: "other.example" },
    }, "axora.management"))
      .rejects.toThrow("invalid_provider_event");
    await expect(sanitizeProviderEvent({ ...event("hard"), type: "message.unknown" }, "axora.management"))
      .rejects.toThrow("unsupported_provider_event");
  });

  it("rejects semantically inconsistent terminal events before suppression", async () => {
    await expect(sanitizeProviderEvent({
      ...event("hard"),
      payload: { ...event("hard").payload, terminal: false },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("hard"),
      payload: {
        ...event("hard").payload,
        delivery: { status: "delivered" },
      },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("complained"),
      payload: {
        ...event("complained").payload,
        sender: "noreply@other.test",
      },
    }, "axora.management")).rejects.toThrow("invalid_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("deferred"),
      payload: { ...event("deferred").payload, terminal: true },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("failed"),
      payload: { ...event("failed").payload, failure: undefined },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("rejected"),
      payload: { ...event("rejected").payload, rejection: undefined },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
    await expect(sanitizeProviderEvent({
      ...event("rejected"),
      payload: {
        ...event("rejected").payload,
        rejection: { reason: "   ", party: "recipient" },
      },
    }, "axora.management")).rejects.toThrow("unsupported_provider_event");
  });

  it("rejects a missing or unsafe provider message identifier", async () => {
    await expect(sanitizeProviderEvent({
      ...event("delivered"),
      payload: { ...event("delivered").payload, messageId: "bad\nidentifier" },
    }, "axora.management")).rejects.toThrow("invalid_message_id");
  });

  it("fails closed for an unexpected configured sending domain", async () => {
    await expect(sanitizeProviderEvent(event("hard"), "other.test"))
      .rejects.toThrow("invalid_domain_configuration");
  });

  it("binds the HMAC to timestamp, path and exact body", async () => {
    const secret = "test-only-email-events-webhook-secret-abcdefghijklmnopqrstuvwxyz";
    const signature = await signEventBody("{\"ok\":true}", "/events", "1785664800", secret);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(signEventBody("{\"ok\":false}", "/events", "1785664800", secret))
      .resolves.not.toBe(signature);
  });

  it("does not log source payload fields during validation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await sanitizeProviderEvent(event("hard"), "axora.management");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("acknowledges one successful message and retries one transient failure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const accepted = {
      body: event("hard"),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await emailEventWorkerInternals.processMessage(accepted, environment);
    expect(accepted.ack).toHaveBeenCalledOnce();
    expect(accepted.retry).not.toHaveBeenCalled();

    const transient = {
      body: event("hard"),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await emailEventWorkerInternals.processMessage(transient, environment);
    expect(transient.ack).not.toHaveBeenCalled();
    expect(transient.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("acknowledges a non-retriable malformed provider event without forwarding it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      body: { ...event("hard"), source: { type: "email.sending", domain: "other.test" } },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await emailEventWorkerInternals.processMessage(message, environment);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
