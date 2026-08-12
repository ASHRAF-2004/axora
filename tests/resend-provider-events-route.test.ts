import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signResendWebhookForTest } from "@/lib/resend-provider-events";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  failure: vi.fn(),
}));

vi.mock("@/lib/resend-provider-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resend-provider-events")>(
    "@/lib/resend-provider-events",
  );
  return { ...actual, recordResendProviderEvent: mocks.record };
});
vi.mock("@/lib/email-operations", () => ({
  recordEmailWebhookProcessingFailure: mocks.failure,
}));

import { POST } from "@/app/api/email/provider-events/resend/route";

const secret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
function payload(type = "email.delivered") {
  return {
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: "resend-route-synthetic-id",
      to: ["route-recipient@example.invalid"],
    },
  };
}

function request(event = payload(), options: { tamper?: boolean } = {}) {
  const signedBody = JSON.stringify(event);
  const body = options.tamper ? `${signedBody} ` : signedBody;
  return new Request("https://axora.management/api/email/provider-events/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signResendWebhookForTest(signedBody, secret, "msg_route_synthetic"),
    },
    body,
  });
}

describe("Resend provider event route", () => {
  beforeEach(() => {
    mocks.record.mockReset().mockResolvedValue({ recorded: true, suppressed: false });
    mocks.failure.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("AXORA_EMAIL_PROVIDER", "resend");
    vi.stubEnv("AXORA_EMAIL_EVENTS_ENABLED", "true");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    vi.stubEnv("RESEND_WEBHOOK_SECRET_FILE", "");
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists a valid signed lifecycle event and accepts duplicate delivery idempotently", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    mocks.record.mockResolvedValueOnce({ recorded: false, suppressed: false });
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ accepted: true, recorded: false });
  });

  it("fails closed with zero persistence while events are disabled", async () => {
    vi.stubEnv("AXORA_EMAIL_EVENTS_ENABLED", "false");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("rejects missing or tampered signatures and oversized bodies", async () => {
    const unsigned = new Request("https://axora.management/api/email/provider-events/resend", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()),
    });
    expect((await POST(unsigned)).status).toBe(401);
    expect((await POST(request(payload(), { tamper: true }))).status).toBe(401);
    const oversized = new Request("https://axora.management/api/email/provider-events/resend", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
      body: "{}",
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("safely ignores a valid signed unsupported tracking event", async () => {
    const response = await POST(request(payload("email.opened")));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true, ignored: true });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
