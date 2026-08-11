import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventsEnabled: vi.fn(),
  bootstrapState: vi.fn(),
  bootstrapVerify: vi.fn(),
  verify: vi.fn(),
  parse: vi.fn(),
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
  parseZeptoMailWebhookForm: mocks.parse,
  normalizeZeptoMailWebhookEvent: mocks.normalize,
  recordZeptoMailProviderEvent: mocks.record,
}));

import { POST } from "@/app/api/email/provider-events/zeptomail/route";

const rawEvent = JSON.stringify({
  event_name: "soft bounce",
  mailagent_key: "agent_1",
  webhook_request_id: "bootstrap-probe",
  event_message: {},
});
const parsed = { eventRaw: rawEvent, event: JSON.parse(rawEvent) };

function request(body = new URLSearchParams({ event: rawEvent }).toString()) {
  return new Request("https://axora.management/api/email/provider-events/zeptomail", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
    mocks.parse.mockReturnValue(parsed);
    mocks.normalize.mockReturnValue({ eventType: "MESSAGE_BOUNCED", bounceType: "SOFT" });
    mocks.record.mockResolvedValue({ recorded: true, suppressed: false });
  });

  it("returns 200 for bootstrap without persistence, normalization or failure evidence", async () => {
    mocks.bootstrapState.mockReturnValue("enabled");
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: false, bootstrap: true });
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

    for (const eventType of ["MESSAGE_BOUNCED", "MESSAGE_BOUNCED", "MESSAGE_COMPLAINED"]) {
      mocks.normalize.mockReturnValueOnce({ eventType });
      expect((await POST(request())).status).toBe(200);
    }
    expect(mocks.record).toHaveBeenCalledTimes(3);
  });

  it("retains strict content type and 16 KiB limits without logging payloads", async () => {
    mocks.eventsEnabled.mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(new Request(
      "https://axora.management/api/email/provider-events/zeptomail",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    ))).status).toBe(415);
    expect((await POST(request("x".repeat(16 * 1024 + 1)))).status).toBe(413);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
