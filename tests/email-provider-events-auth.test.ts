import { beforeEach, describe, expect, it } from "vitest";
import {
  emailRecipientFingerprint,
  signEmailProviderEventRequest,
  verifyEmailProviderEventRequest,
} from "@/lib/email-provider-events";

const secret = "test-only-email-events-webhook-secret-abcdefghijklmnopqrstuvwxyz";
const now = Date.UTC(2026, 7, 2, 12, 0, 0);
const pathname = "/api/email/provider-events/cloudflare";

describe("email provider-event webhook authentication", () => {
  beforeEach(() => {
    process.env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET = secret;
  });

  it("matches normalized recipient fingerprint behavior", () => {
    expect(emailRecipientFingerprint("  Person@Example.Test "))
      .toBe(emailRecipientFingerprint("person@example.test"));
    expect(emailRecipientFingerprint("person@example.test"))
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds HMAC authentication to timestamp, route and exact body", () => {
    const body = JSON.stringify({ eventId: "event" });
    const headers = signEmailProviderEventRequest("POST", pathname, body, { now });
    const request = { method: "POST", pathname, body, headers, now };
    expect(verifyEmailProviderEventRequest(request)).toBe(true);
    expect(verifyEmailProviderEventRequest({ ...request, body: `${body} ` })).toBe(false);
    expect(verifyEmailProviderEventRequest({
      ...request,
      pathname: "/api/email/provider-events/other",
    })).toBe(false);
    expect(verifyEmailProviderEventRequest({ ...request, now: now + 91_000 })).toBe(false);
  });

  it("never accepts a missing or weak secret", () => {
    process.env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET = "short";
    expect(() => signEmailProviderEventRequest("POST", pathname, "{}", { now }))
      .toThrow(/unavailable/i);
  });
});
