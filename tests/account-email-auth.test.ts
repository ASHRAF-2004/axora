import { beforeEach, describe, expect, it } from "vitest";
import {
  accountEmailInternals,
  signEmailServiceRequest,
  verifyEmailServiceRequest,
} from "@/lib/account-email";
import {
  emailSenderInternals,
  signServiceRequest,
  verifyServiceRequest,
// @ts-expect-error The production mailer is intentionally native ESM JavaScript.
} from "../server-tools/email-sender.mjs";

const secret = "test-only-account-email-service-key-abcdefghijklmnopqrstuvwxyz";
const secretFile = "/run/secrets/axora_email_service_auth_key";
const now = Date.UTC(2026, 7, 2, 12, 0, 0);

function lowerCaseHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

describe("private account-email service authentication", () => {
  beforeEach(() => {
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY = secret;
    accountEmailInternals.replayCache.clear();
    emailSenderInternals.replayCache.clear();
  });

  it("lets the mailer verify an app-signed body and rejects replay or tampering", async () => {
    const pathname = "/v1/account-setup";
    const body = JSON.stringify({ deliveryId: "00000000-0000-4000-8000-000000000001" });
    const headers = lowerCaseHeaders(signEmailServiceRequest("POST", pathname, body, {
      now,
      requestId: "00000000-0000-4000-8000-000000000002",
    }));
    const options = {
      method: "POST",
      pathname,
      body,
      headers,
      env: { AXORA_EMAIL_SERVICE_AUTH_KEY_FILE: secretFile },
      readFileImpl: async () => secret,
      now,
    };

    await expect(verifyServiceRequest(options)).resolves.toBe(true);
    await expect(verifyServiceRequest(options)).resolves.toBe(false);
    emailSenderInternals.replayCache.clear();
    await expect(verifyServiceRequest({ ...options, body: `${body} ` })).resolves.toBe(false);
  });

  it("lets the app verify a mailer-signed outbox request and enforces freshness", async () => {
    const pathname = "/account/email-outbox";
    const body = JSON.stringify({ action: "claim" });
    const headers = await signServiceRequest("POST", pathname, body, {
      env: { AXORA_EMAIL_SERVICE_AUTH_KEY_FILE: secretFile },
      readFileImpl: async () => secret,
      now,
      requestId: "00000000-0000-4000-8000-000000000003",
    });

    expect(verifyEmailServiceRequest({
      method: "POST",
      pathname,
      body,
      headers,
      now,
    })).toBe(true);
    accountEmailInternals.replayCache.clear();
    expect(verifyEmailServiceRequest({
      method: "POST",
      pathname,
      body,
      headers,
      now: now + 91_000,
    })).toBe(false);
  });
});
