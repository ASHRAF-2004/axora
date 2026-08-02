import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  verify: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/email-provider-events", () => ({
  emailProviderEventsEnabled: mocks.enabled,
  verifyEmailProviderEventRequest: mocks.verify,
  recordCloudflareEmailProviderEvent: mocks.record,
}));

import { POST } from "@/app/api/email/provider-events/cloudflare/route";

const eventId = "0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6";
const validEvent = {
  schemaVersion: 1,
  eventId,
  eventType: "MESSAGE_BOUNCED",
  recipientFingerprint: "a".repeat(64),
  messageFingerprint: "b".repeat(64),
  terminal: true,
  bounceType: "HARD",
  occurredAt: "2026-08-02T10:00:00.000Z",
} as const;

function request(body: unknown, contentType = "application/json") {
  return new Request(
    "https://axora.management/api/email/provider-events/cloudflare",
    {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("Cloudflare Email Sending event endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.verify.mockReturnValue(true);
    mocks.record.mockResolvedValue({ recorded: true, suppressed: true });
  });

  it("records a strictly validated event and accepts idempotent duplicates", async () => {
    const created = await POST(request(validEvent));
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toEqual({
      accepted: true,
      recorded: true,
      suppressed: true,
    });
    expect(mocks.record).toHaveBeenCalledWith(validEvent);

    mocks.record.mockResolvedValueOnce({ recorded: false, suppressed: true });
    const duplicate = await POST(request(validEvent));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      accepted: true,
      recorded: false,
    });
  });

  it("accepts the exact terminal shape of all six lifecycle events", async () => {
    const { bounceType: _bounceType, ...common } = validEvent;
    void _bounceType;
    const events = [
      { ...common, eventType: "MESSAGE_DELIVERED", terminal: true },
      { ...common, eventType: "MESSAGE_DEFERRED", terminal: false },
      validEvent,
      { ...common, eventType: "MESSAGE_FAILED", terminal: true },
      { ...common, eventType: "MESSAGE_REJECTED", terminal: true },
      { ...common, eventType: "MESSAGE_COMPLAINED", terminal: true },
    ] as const;
    for (const event of events) {
      expect((await POST(request(event))).status).toBe(200);
    }
    expect(mocks.record).toHaveBeenCalledTimes(6);
  });

  it("fails closed while disabled or when authentication is invalid", async () => {
    mocks.enabled.mockReturnValueOnce(false);
    const disabled = await POST(request(validEvent));
    expect(disabled.status).toBe(503);

    mocks.verify.mockReturnValueOnce(false);
    const unauthorized = await POST(request(validEvent));
    expect(unauthorized.status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("enforces content type, body size and a strict event schema", async () => {
    expect((await POST(request(validEvent, "text/plain"))).status).toBe(415);
    expect((await POST(request(validEvent, "application/json-seq"))).status).toBe(415);
    expect((await POST(request(validEvent, "application/json; charset=utf-8"))).status)
      .not.toBe(415);
    expect((await POST(request("x".repeat(2_049)))).status).toBe(413);
    expect((await POST(request({ ...validEvent, unexpected: true }))).status).toBe(400);
    expect((await POST(request({
      ...validEvent,
      eventType: "MESSAGE_COMPLAINED",
      bounceType: "HARD",
    }))).status).toBe(400);
    expect((await POST(request({
      ...validEvent,
      eventType: "MESSAGE_DEFERRED",
      terminal: true,
      bounceType: undefined,
    }))).status).toBe(400);
    expect((await POST(request({
      ...validEvent,
      eventType: "MESSAGE_DELIVERED",
      bounceType: undefined,
      messageFingerprint: "not-a-fingerprint",
    }))).status).toBe(400);
  });

  it("returns only a generic transient error when persistence fails", async () => {
    mocks.record.mockRejectedValueOnce(new Error("private database detail"));
    const response = await POST(request(validEvent));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "service_unavailable" });
  });
});
