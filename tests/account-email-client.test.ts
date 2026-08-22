import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/account-setup", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/account-setup")>();
  return {
    ...original,
    authorizeAccountSetupDelivery: mocks.authorize,
  };
});

import { sendAccountSetupEmail } from "@/lib/account-email";
import type { AccountSetupInvitationResult } from "@/lib/account-setup";

const invitation: AccountSetupInvitationResult = {
  invitationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  recipientName: "Aisha Rahman",
  recipientEmail: "aisha@example.com",
  companyName: "Example Industries",
  role: "APPROVER",
  branchName: "Kuala Lumpur",
  expiresAt: "2026-08-03T06:00:00.000Z",
  locale: "en",
  rawToken: "abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "AXORA_EMAIL_SERVICE_AUTH_KEY",
    "test-only-account-email-service-key-abcdefghijklmnopqrstuvwxyz",
  );
  mocks.authorize.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("account setup email delivery client", () => {
  it("does not make a network request while delivery is disabled", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({ succeeded: false, status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("sends only to the private mailer and returns a safe status", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://axora.management");
    vi.stubEnv("AXORA_EMAIL_SENDER_URL", "http://email-sender:3100");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ succeeded: true, status: "queued" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({ succeeded: true, status: "sent" });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("http://email-sender:3100/v1/account-setup");
    const body = JSON.parse(request.body);
    expect(body.setupUrl).toContain("https://axora.management/account/setup#token=");
    expect(body.setupUrl).toContain(invitation.rawToken);
    expect(new URL(body.setupUrl).search).toBe("");
    expect(body.deliveryId).toBe(invitation.invitationId);
    expect(body).not.toHaveProperty("userId");
    expect(request.headers["X-Axora-Email-Signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.authorize).toHaveBeenCalledWith(
      invitation.invitationId,
      invitation.rawToken,
    );
  });

  it("rejects an externally configured sender endpoint", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "true");
    vi.stubEnv("AXORA_EMAIL_SENDER_URL", "https://attacker.example");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({ succeeded: false, status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an optional valid provider message id", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "true");
    vi.stubEnv("AXORA_EMAIL_SENDER_URL", "http://email-sender:3100");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ succeeded: true, status: "queued", messageId: "email-message-123", providerName: "resend" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({
      succeeded: true,
      providerMessageId: "email-message-123",
      providerName: "resend",
      status: "sent",
    });
  });

  it("rejects a malformed optional provider message id", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "true");
    vi.stubEnv("AXORA_EMAIL_SENDER_URL", "http://email-sender:3100");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ succeeded: true, status: "delivered", messageId: "bad\nidentifier" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({
      succeeded: false,
      status: "uncertain",
    });
  });

  it("fails closed before sending when the current invitation is no longer authorized", async () => {
    vi.stubEnv("AXORA_EMAIL_DELIVERY_ENABLED", "true");
    mocks.authorize.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAccountSetupEmail(invitation)).resolves.toEqual({
      succeeded: false,
      status: "failed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
