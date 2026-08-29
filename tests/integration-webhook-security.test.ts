import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INTEGRATION_EVENT_TYPES } from "../src/lib/integrations/events";
import {
  isPublicWebhookAddress,
  parseWebhookDestination,
  resolveWebhookDestination,
  WebhookDestinationError,
} from "../src/lib/integrations/webhook-destination";
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/lib/integrations/webhook-signature";

const credential = `axora_whsec_${"a".repeat(43)}`;

describe("webhook destination security", () => {
  it.each([
    "http://receiver.example.test/hook",
    "https://user:password@receiver.example.test/hook",
    "https://receiver.example.test:8443/hook",
    "https://receiver.example.test/hook#fragment",
    "file:///etc/passwd",
    "unix:///var/run/docker.sock",
  ])("rejects an unsafe URL shape: %s", (value) => {
    expect(() => parseWebhookDestination(value)).toThrow(WebhookDestinationError);
  });

  it.each([
    "https://localhost/hook",
    "https://localhost./hook",
    "https://service.internal/hook",
    "https://service.local/hook",
    "https://metadata/hook",
    "https://127.0.0.1/hook",
    "https://127.1/hook",
    "https://2130706433/hook",
    "https://0x7f000001/hook",
    "https://10.0.0.1/hook",
    "https://168.63.129.16/metadata",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.10/hook",
    "https://[::1]/hook",
    "https://[fc00::1]/hook",
    "https://[fe80::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
  ])("rejects a local, private, or metadata destination: %s", async (value) => {
    await expect(resolveWebhookDestination(value, async () => [
      { address: "93.184.216.34", family: 4 },
    ])).rejects.toBeInstanceOf(WebhookDestinationError);
  });

  it("requires every freshly resolved address to be public", async () => {
    await expect(resolveWebhookDestination(
      "https://hooks.receiver.dev/hook",
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.1.2.3", family: 4 },
      ],
    )).rejects.toMatchObject({ category: "SSRF_BLOCKED" });
  });

  it("deduplicates public answers while retaining the normalized origin", async () => {
    const result = await resolveWebhookDestination(
      "https://Hooks.Receiver.dev/path?tenant=fictional",
      async () => [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.34", family: 4 },
      ],
    );
    expect(result.endpointOrigin).toBe("https://hooks.receiver.dev");
    expect(result.addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it.each([
    ["0.0.0.0", false],
    ["100.64.0.1", false],
    ["198.18.0.1", false],
    ["224.0.0.1", false],
    ["93.184.216.34", true],
    ["::", false],
    ["::1", false],
    ["2001:db8::1", false],
    ["2002:a00:1::", false],
    ["2001:4860:4860::8888", true],
    ["2606:4700:4700::1111", true],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicWebhookAddress(address)).toBe(expected);
  });
});

describe("webhook signing and replay window", () => {
  const timestamp = 1_800_000_000;
  const payload = '{"event_id":"fictional-event","schema_version":1}';

  it("signs the exact timestamp and raw bytes with HMAC-SHA256", () => {
    const expected = createHmac("sha256", credential)
      .update(`${timestamp}.`, "utf8")
      .update(payload, "utf8")
      .digest("hex");
    expect(signWebhookPayload(credential, timestamp, payload)).toBe(`v1=${expected}`);
  });

  it("accepts an intact signature inside the timestamp window", () => {
    expect(verifyWebhookSignature({
      credential,
      timestamp: String(timestamp),
      signature: signWebhookPayload(credential, timestamp, payload),
      rawPayload: payload,
      now: timestamp + 299,
    })).toBe(true);
  });

  it.each([
    ["changed body", timestamp, timestamp],
    [payload, timestamp - 301, timestamp],
    [payload, timestamp + 301, timestamp],
  ])("rejects tampering or replay outside tolerance", (body, signedAt, now) => {
    expect(verifyWebhookSignature({
      credential,
      timestamp: String(signedAt),
      signature: signWebhookPayload(credential, signedAt, payload),
      rawPayload: body,
      now,
    })).toBe(false);
  });

  it("publishes the deliberately bounded v1 event catalog", () => {
    expect(INTEGRATION_EVENT_TYPES).toEqual([
      "company.created",
      "request.created",
      "request.submitted",
      "request.approved",
      "request.rejected",
      "invoice.finalized",
      "delivery.out_for_delivery",
      "delivery.arrived",
      "delivery.delivered",
      "delivery.completed",
    ]);
  });
});
