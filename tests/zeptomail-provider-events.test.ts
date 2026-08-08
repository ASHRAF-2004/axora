import { describe, expect, it } from "vitest";
import {
  normalizeZeptoMailWebhookEvent,
  parseZeptoMailWebhookForm,
  signZeptoMailWebhookEventForTest,
  verifyZeptoMailWebhookRequest,
  zeptoMailProviderEventInternals,
} from "@/lib/zeptomail-provider-events";

const secret = "zeptomail-webhook-authentication-key-for-tests";
const now = Date.parse("2026-08-08T12:00:00.000Z");
const env = {
  NODE_ENV: "test" as const,
  ZEPTOMAIL_WEBHOOK_AUTH_KEY: secret,
  ZEPTOMAIL_AUTH_AGENT_KEY: "agent-auth",
  ZEPTOMAIL_PROCUREMENT_AGENT_KEY: "agent-procurement",
  ZEPTOMAIL_BUDGET_AGENT_KEY: "agent-budget",
  ZEPTOMAIL_DELIVERY_AGENT_KEY: "agent-delivery",
  ZEPTOMAIL_DOCUMENTS_AGENT_KEY: "agent-documents",
  ZEPTOMAIL_PLATFORM_AGENT_KEY: "agent-platform",
};

function fixture(eventName = "hard bounce") {
  return {
    event_name: eventName,
    mailagent_key: "agent-auth",
    webhook_request_id: `webhook-${eventName.replaceAll(" ", "-")}`,
    event_message: {
      request_id: "zeptomail-request-1901",
      email_info: {
        client_reference: "30000000-0000-4000-8000-000000000901",
        processed_time: "2026-08-08T11:58:00.000Z",
        to: [{ email_address: { address: "Person@Example.test", name: "Person" } }],
      },
      event_data: { details: { time: "2026-08-08T11:59:00.000Z" } },
    },
  };
}

describe("ZeptoMail signed provider events", () => {
  it("verifies the producer signature over the decoded form event", () => {
    const eventRaw = JSON.stringify(fixture());
    const parsed = parseZeptoMailWebhookForm(new URLSearchParams({ event: eventRaw }).toString());
    const headers = {
      "producer-signature": signZeptoMailWebhookEventForTest(eventRaw, secret, now),
    };
    expect(verifyZeptoMailWebhookRequest({
      method: "POST",
      pathname: zeptoMailProviderEventInternals.webhookPath,
      eventRaw: parsed.eventRaw,
      event: parsed.event,
      headers,
      now,
      env,
    })).toBe(true);
    expect(verifyZeptoMailWebhookRequest({
      method: "POST",
      pathname: zeptoMailProviderEventInternals.webhookPath,
      eventRaw: `${parsed.eventRaw} `,
      event: parsed.event,
      headers,
      now,
      env,
    })).toBe(false);
    expect(verifyZeptoMailWebhookRequest({
      method: "POST",
      pathname: zeptoMailProviderEventInternals.webhookPath,
      eventRaw: parsed.eventRaw,
      event: parsed.event,
      headers,
      now: now + 5 * 60 * 1_000 + 1,
      env,
    })).toBe(false);
  });

  it.each([
    ["delivered", "MESSAGE_DELIVERED", undefined],
    ["soft bounce", "MESSAGE_BOUNCED", "SOFT"],
    ["hard bounce", "MESSAGE_BOUNCED", "HARD"],
    ["feedback loop", "MESSAGE_COMPLAINED", undefined],
  ])("normalizes %s without retaining sensitive content", (name, type, bounceType) => {
    const normalized = normalizeZeptoMailWebhookEvent(fixture(name), {
      signatureTimestamp: now,
    });
    expect(normalized).toMatchObject({
      eventType: type,
      terminal: true,
      ...(bounceType ? { bounceType } : {}),
    });
    expect(normalized.recipientFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(normalized.messageFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(normalized)).not.toContain("Person@Example.test");
    expect(JSON.stringify(normalized)).not.toContain("client_reference");
  });

  it("rejects duplicate form fields and an unknown Agent before persistence", () => {
    const event = fixture();
    const eventRaw = JSON.stringify(event);
    expect(() => parseZeptoMailWebhookForm(`event=${encodeURIComponent(eventRaw)}&event=${encodeURIComponent(eventRaw)}`)).toThrow();
    expect(verifyZeptoMailWebhookRequest({
      method: "POST",
      pathname: zeptoMailProviderEventInternals.webhookPath,
      eventRaw,
      event: { ...event, mailagent_key: "unknown-agent" },
      headers: { "producer-signature": signZeptoMailWebhookEventForTest(eventRaw, secret, now) },
      now,
      env,
    })).toBe(false);
  });
});
