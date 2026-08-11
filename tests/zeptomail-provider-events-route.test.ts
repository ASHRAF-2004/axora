import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventsEnabled: vi.fn(),
  bootstrapState: vi.fn(),
  bootstrapVerify: vi.fn(),
  verify: vi.fn(),
  parsePayload: vi.fn(),
  normalize: vi.fn(),
  record: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("@/lib/email-provider-events", () => ({
  emailProviderEventsEnabled: mocks.eventsEnabled,
}));
vi.mock("@/lib/email-operations", () => ({
  recordEmailWebhookProcessingFailure: mocks.recordFailure,
}));
vi.mock("@/lib/zeptomail-provider-events", () => ({
  zeptoMailWebhookBootstrapState: mocks.bootstrapState,
  verifyZeptoMailWebhookBootstrapEvent: mocks.bootstrapVerify,
  verifyZeptoMailWebhookRequest: mocks.verify,
  parseZeptoMailWebhookPayload: mocks.parsePayload,
  normalizeZeptoMailWebhookEvent: mocks.normalize,
  recordZeptoMailProviderEvent: mocks.record,
}));

import { POST } from "@/app/api/email/provider-events/zeptomail/route";

const rawEvent = JSON.stringify({
  event_name: ["softbounce"],
  mailagent_key: "agent_1",
  webhook_request_id: "bootstrap-probe",
  event_message: [{
    request_id: "request-probe",
    email_info: { to: [{ email_address: { address: "synthetic@example.test" } }] },
    event_data: [{ details: [{}] }],
  }],
});
const parsed = { eventRaw: rawEvent, event: JSON.parse(rawEvent) };

function request(body = rawEvent, contentType = "application/json") {
  return new Request("https://axora.management/api/email/provider-events/zeptomail", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

describe("ZeptoMail provider event route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventsEnabled.mockReturnValue(false);
    mocks.bootstrapState.mockReturnValue("disabled");
    mocks.bootstrapVerify.mockReturnValue(true);
    mocks.verify.mockReturnValue(true);
    mocks.parsePayload.mockReturnValue(parsed);
    mocks.normalize.mockReturnValue({ eventType: "MESSAGE_BOUNCED", bounceType: "SOFT" });
    mocks.record.mockResolvedValue({ recorded: true, suppressed: false });
  });

  it("returns 200 for bootstrap without persistence, normalization or failure evidence", async () => {
    mocks.bootstrapState.mockReturnValue("enabled");
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: false, bootstrap: true });
    expect(mocks.parsePayload).toHaveBeenCalledWith(rawEvent, "application/json");
    expect(mocks.bootstrapVerify).toHaveBeenCalledWith(parsed.event);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
  });

  it("rejects invalid bootstrap probes and unsafe bootstrap configuration", async () => {
    mocks.bootstrapState.mockReturnValueOnce("enabled");
    mocks.bootstrapVerify.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(401);
    mocks.bootstrapState.mockReturnValueOnce("invalid");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("keeps unsigned operational events rejected and records signed lifecycle events", async () => {
    mocks.eventsEnabled.mockReturnValue(true);
    mocks.verify.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();

    for (const [eventType, suppressed] of [
      ["MESSAGE_BOUNCED", false],
      ["MESSAGE_BOUNCED", true],
      ["MESSAGE_COMPLAINED", true],
    ] as const) {
      mocks.normalize.mockReturnValueOnce({ eventType });
      mocks.record.mockResolvedValueOnce({ recorded: true, suppressed });
      const response = await POST(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ accepted: true, suppressed });
    }
    expect(mocks.record).toHaveBeenCalledTimes(3);
  });

  it("accepts legacy form transport and retains strict media and 16 KiB limits without logging payloads", async () => {
    mocks.eventsEnabled.mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const formBody = new URLSearchParams({ event: rawEvent }).toString();
    expect((await POST(request(formBody, "application/x-www-form-urlencoded"))).status).toBe(200);
    expect((await POST(new Request(
      "https://axora.management/api/email/provider-events/zeptomail",
      { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" },
    ))).status).toBe(415);
    expect((await POST(request("x".repeat(16 * 1024 + 1)))).status).toBe(413);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
