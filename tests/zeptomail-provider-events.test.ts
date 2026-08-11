import { describe, expect, it } from "vitest";
import {
  normalizeZeptoMailWebhookEvent,
  normalizeZeptoMailWebhookEnvelope,
  isZeptoMailProviderAgentKey,
  parseZeptoMailWebhookForm,
  parseZeptoMailWebhookPayload,
  signZeptoMailWebhookEventForTest,
  verifyZeptoMailWebhookRequest,
  verifyZeptoMailWebhookBootstrapEvent,
  zeptoMailWebhookBootstrapState,
  zeptoMailProviderEventInternals,
} from "@/lib/zeptomail-provider-events";

const secret = "zeptomail-webhook-authentication-key-for-tests";
const now = Date.parse("2026-08-08T12:00:00.000Z");
const providerAgentKey = "2d6f.2f584a3cd668e3a6.synthetic_agent-key";
const env = {
  NODE_ENV: "test" as const,
  ZEPTOMAIL_WEBHOOK_AUTH_KEY: secret,
  AXORA_EMAIL_PROVIDER: "zeptomail",
  AXORA_EMAIL_DELIVERY_ENABLED: "false",
  AXORA_EMAIL_EVENTS_ENABLED: "true",
  ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "false",
  ZEPTOMAIL_MAIL_AGENT_KEY: providerAgentKey,
};

function fixture(eventName = "hardbounce") {
  return {
    event_name: [eventName],
    mailagent_key: providerAgentKey,
    webhook_request_id: `webhook-${eventName.replaceAll(" ", "-")}`,
    event_message: [{
      request_id: "zeptomail-request-1901",
      email_info: {
        client_reference: "30000000-0000-4000-8000-000000000901",
        processed_time: "2026-08-08T11:58:00.000Z",
        to: [{ email_address: { address: "Person@Example.test", name: "Person" } }],
      },
      event_data: [{ details: [{ time: "2026-08-08T11:59:00.000Z" }] }],
    }],
  };
}

function legacyFixture(eventName = "hard bounce") {
  const current = fixture(eventName);
  const message = current.event_message[0];
  const data = message.event_data[0];
  return {
    ...current,
    event_name: eventName,
    event_message: {
      ...message,
      event_data: { ...data, details: data.details[0] },
    },
  };
}

describe("ZeptoMail signed provider events", () => {
  it("verifies the producer signature over exact direct JSON and decoded form event bytes", () => {
    const eventRaw = JSON.stringify(fixture());
    const parsed = parseZeptoMailWebhookPayload(eventRaw, "application/json");
    const formParsed = parseZeptoMailWebhookForm(new URLSearchParams({ event: eventRaw }).toString());
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
    expect(formParsed.eventRaw).toBe(eventRaw);
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
      headers: { "producer-signature": signZeptoMailWebhookEventForTest(eventRaw, "wrong-secret", now) },
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
    ["softbounce", "MESSAGE_BOUNCED", "SOFT"],
    ["hardbounce", "MESSAGE_BOUNCED", "HARD"],
    ["feedbackloop", "MESSAGE_COMPLAINED", undefined],
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

  it("strictly normalizes the current nested arrays and the documented legacy representation", () => {
    expect(normalizeZeptoMailWebhookEnvelope(fixture("softbounce"))).toMatchObject({
      eventName: "softbounce",
      mailAgentKey: providerAgentKey,
      requestId: "zeptomail-request-1901",
    });
    expect(normalizeZeptoMailWebhookEvent(legacyFixture("hard bounce"))).toMatchObject({
      eventType: "MESSAGE_BOUNCED",
      bounceType: "HARD",
    });
  });

  it.each([
    ["empty event names", { event_name: [] }],
    ["multiple event names", { event_name: ["softbounce", "hardbounce"] }],
    ["empty messages", { event_message: [] }],
    ["multiple messages", { event_message: [{}, {}] }],
    ["empty event data", { event_message: [{ ...fixture().event_message[0], event_data: [] }] }],
    ["multiple details", {
      event_message: [{
        ...fixture().event_message[0],
        event_data: [{ details: [{}, {}] }],
      }],
    }],
  ])("rejects malformed current schema: %s", (_name, replacement) => {
    expect(() => normalizeZeptoMailWebhookEnvelope({ ...fixture(), ...replacement })).toThrow(
      "The ZeptoMail webhook",
    );
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

  it.each([
    "2d6f..synthetic",
    ".2d6f.synthetic",
    "2d6f.synthetic.",
    "2d6f/synthetic",
    "2d6f synthetic",
    "2d6f\nsynthetic",
    "2d6f;synthetic",
    "2d6f:synthetic",
    "2d6f$synthetic",
    "x".repeat(201),
  ])("rejects malformed or unsafe provider Agent keys", (value) => {
    expect(isZeptoMailProviderAgentKey(value)).toBe(false);
    expect(() => zeptoMailProviderEventInternals.configuredAgentKeys({
      ...env,
      ZEPTOMAIL_MAIL_AGENT_KEY: value,
    })).toThrow("Agent identity configuration is unavailable");
  });

  it("accepts only bounded period-separated opaque provider Agent keys", () => {
    expect(isZeptoMailProviderAgentKey(providerAgentKey)).toBe(true);
    expect(isZeptoMailProviderAgentKey("segment_with-compatibility")).toBe(true);
  });

  it("accepts only a side-effect-free provider-shaped probe in explicit bootstrap mode", () => {
    const bootstrapEnv = {
      ...env,
      AXORA_EMAIL_EVENTS_ENABLED: "false",
      ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true",
    };
    expect(zeptoMailWebhookBootstrapState(bootstrapEnv)).toBe("enabled");
    expect(verifyZeptoMailWebhookBootstrapEvent(fixture("softbounce"), bootstrapEnv)).toBe(true);
    expect(verifyZeptoMailWebhookBootstrapEvent({
      ...fixture("softbounce"),
      mailagent_key: "unknown-agent",
    }, bootstrapEnv)).toBe(false);
    expect(zeptoMailWebhookBootstrapState({
      ...bootstrapEnv,
      AXORA_EMAIL_DELIVERY_ENABLED: "true",
    })).toBe("invalid");
  });

  it("rejects oversized direct JSON without disclosing payload content", () => {
    expect(() => parseZeptoMailWebhookPayload(
      JSON.stringify({ marker: "sensitive@example.test", padding: "x".repeat(16 * 1024) }),
      "application/json",
    )).toThrow("The ZeptoMail webhook body is invalid.");
  });
});
