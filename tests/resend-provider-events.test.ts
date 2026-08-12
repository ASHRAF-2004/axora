import { describe, expect, it } from "vitest";
import {
  isSupportedResendEvent,
  normalizeResendWebhookEvent,
  resendProviderEventInternals,
  signResendWebhookForTest,
  verifyResendWebhookRequest,
} from "@/lib/resend-provider-events";

const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const env = { NODE_ENV: "test", RESEND_WEBHOOK_SECRET: secret } as NodeJS.ProcessEnv;

function fixture(type = "email.delivered") {
  return {
    type,
    created_at: "2026-08-12T02:00:00.000Z",
    data: {
      email_id: "resend-synthetic-email-id",
      created_at: "2026-08-12T01:59:59.000Z",
      from: "noreply@axora.management",
      to: ["recipient@example.invalid"],
      subject: "synthetic subject is never persisted",
      ...(type === "email.bounced" ? {
        bounce: { type: "Permanent", subType: "General", message: "synthetic" },
      } : {}),
    },
  };
}

function signed(payload = fixture(), options: { id?: string; timestamp?: number } = {}) {
  const rawBody = JSON.stringify(payload);
  const id = options.id ?? "msg_synthetic_event_identity";
  return {
    rawBody,
    headers: signResendWebhookForTest(rawBody, secret, id, options.timestamp),
  };
}

describe("Resend signed provider events", () => {
  it("verifies Svix headers against the exact raw body", () => {
    const request = signed();
    expect(verifyResendWebhookRequest({
      method: "POST",
      pathname: resendProviderEventInternals.webhookPath,
      ...request,
      env,
    })).toMatchObject({ eventIdentity: "msg_synthetic_event_identity" });
    expect(verifyResendWebhookRequest({
      method: "POST",
      pathname: resendProviderEventInternals.webhookPath,
      rawBody: `${request.rawBody} `,
      headers: request.headers,
      env,
    })).toBeUndefined();
  });

  it.each([
    ["email.sent", "MESSAGE_SUBMITTED", false, undefined],
    ["email.delivered", "MESSAGE_DELIVERED", true, undefined],
    ["email.delivery_delayed", "MESSAGE_DEFERRED", false, undefined],
    ["email.bounced", "MESSAGE_BOUNCED", true, "HARD"],
    ["email.complained", "MESSAGE_COMPLAINED", true, undefined],
    ["email.failed", "MESSAGE_FAILED", true, undefined],
    ["email.suppressed", "MESSAGE_SUPPRESSED", true, undefined],
  ])("normalizes %s without retaining content", (providerType, eventType, terminal, bounceType) => {
    const normalized = normalizeResendWebhookEvent(
      fixture(providerType),
      `msg_${providerType}`,
    );
    expect(normalized).toMatchObject({ eventType, terminal, ...(bounceType ? { bounceType } : {}) });
    expect(JSON.stringify(normalized)).not.toContain("recipient@example.invalid");
    expect(JSON.stringify(normalized)).not.toContain("synthetic subject");
    expect(normalized.recipientFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(normalized.messageFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps temporary bounces non-suppressing through SOFT normalization", () => {
    const payload = fixture("email.bounced");
    (payload.data.bounce as { type: string }).type = "Temporary";
    expect(normalizeResendWebhookEvent(payload, "msg_temporary")).toMatchObject({
      eventType: "MESSAGE_BOUNCED",
      bounceType: "SOFT",
    });
  });

  it("rejects missing headers, bad signatures, stale signatures, tampering, and oversized bodies", () => {
    const request = signed();
    expect(verifyResendWebhookRequest({
      method: "POST", pathname: resendProviderEventInternals.webhookPath,
      rawBody: request.rawBody, headers: {}, env,
    })).toBeUndefined();
    expect(verifyResendWebhookRequest({
      method: "POST", pathname: resendProviderEventInternals.webhookPath,
      rawBody: request.rawBody,
      headers: signResendWebhookForTest(request.rawBody, secret, "msg_wrong"),
      env: { ...env, RESEND_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 8).toString("base64")}` },
    })).toBeUndefined();
    const stale = signed(fixture(), { timestamp: Math.floor(Date.now() / 1_000) - 600 });
    expect(verifyResendWebhookRequest({
      method: "POST", pathname: resendProviderEventInternals.webhookPath,
      ...stale, env,
    })).toBeUndefined();
    expect(verifyResendWebhookRequest({
      method: "POST", pathname: resendProviderEventInternals.webhookPath,
      rawBody: JSON.stringify({ ...fixture(), tampered: true }),
      headers: request.headers, env,
    })).toBeUndefined();
    expect(verifyResendWebhookRequest({
      method: "POST", pathname: resendProviderEventInternals.webhookPath,
      rawBody: "x".repeat(16 * 1024 + 1), headers: request.headers, env,
    })).toBeUndefined();
  });

  it("rejects malformed supported events and recognizes unsupported signed event types", () => {
    expect(() => normalizeResendWebhookEvent({
      ...fixture(), data: { ...fixture().data, to: [] },
    }, "msg_empty_recipient")).toThrow("recipient");
    expect(() => normalizeResendWebhookEvent({
      ...fixture(), data: { ...fixture().data, to: ["a@example.invalid", "b@example.invalid"] },
    }, "msg_multiple_recipient")).toThrow("recipient");
    expect(isSupportedResendEvent({ type: "email.opened" })).toBe(false);
  });
});
