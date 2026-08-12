import { describe, expect, it, vi } from "vitest";
import {
  apiToken,
  createResendEmailProvider,
  readinessStatus,
  sendAccountSetup,
  senderConfiguration,
} from "../server-tools/email-sender.mjs";

const deliveryId = "7c400000-0000-4000-8000-000000000001";
const message = {
  deliveryId,
  providerAgent: "axora-auth",
  to: "recipient@example.invalid",
  recipientName: "Synthetic recipient",
  from: { address: "noreply@axora.management", name: "Axora" },
  reply_to: { address: "support@axora.management", name: "Axora support" },
  subject: "Synthetic account event",
  html: "<p>Safe synthetic body</p>",
  text: "Safe synthetic body",
  headers: { "X-Axora-Template": "password-reset-v1" },
  attachments: [{
    content: Buffer.from("synthetic").toString("base64"),
    filename: "logo.png",
    type: "image/png",
    disposition: "inline",
    content_id: "axora-logo",
  }],
};

describe("Resend provider adapter", () => {
  it("accepts Resend configuration and reads only the configured secret file", async () => {
    expect(senderConfiguration({
      AXORA_EMAIL_PROVIDER: "resend",
      AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management",
      AXORA_EMAIL_FROM_NAME: "Axora",
      AXORA_EMAIL_REPLY_TO: "support@axora.management",
      APP_BASE_URL: "https://axora.management",
    })).toMatchObject({ provider: "resend", fromAddress: "noreply@axora.management" });
    const readFileImpl = vi.fn(async () => "re_synthetic_production_key_value");
    await expect(apiToken({
      provider: "resend",
      env: { RESEND_API_KEY_FILE: "/run/secrets/resend_api_key" },
      readFileImpl,
    })).resolves.toBe("re_synthetic_production_key_value");
    expect(readFileImpl).toHaveBeenCalledWith("/run/secrets/resend_api_key", "utf8");
  });

  it("submits the existing message model with stable idempotency and captures the provider ID", async () => {
    const requests = [];
    const provider = createResendEmailProvider({
      token: "re_synthetic_production_key_value",
      fetchImpl: vi.fn(async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ id: "resend-synthetic-message-id" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    await expect(provider.send(message)).resolves.toEqual({
      status: "submitted",
      messageId: "resend-synthetic-message-id",
    });
    await provider.send(message);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("https://api.resend.com/emails");
    expect(requests[0].options.headers).toMatchObject({
      Authorization: "Bearer re_synthetic_production_key_value",
      "Idempotency-Key": `axora-delivery-${deliveryId}`,
    });
    expect(requests[1].options.headers["Idempotency-Key"])
      .toBe(requests[0].options.headers["Idempotency-Key"]);
    expect(requests[0].body).toMatchObject({
      from: "Axora <noreply@axora.management>",
      to: ["recipient@example.invalid"],
      reply_to: "support@axora.management",
      subject: "Synthetic account event",
      html: "<p>Safe synthetic body</p>",
      text: "Safe synthetic body",
      headers: {
        "X-Axora-Template": "password-reset-v1",
        "X-Axora-Delivery-Id": deliveryId,
        "X-Axora-Provider-Agent": "axora-auth",
      },
    });
    expect(requests[0].body.attachments[0]).toMatchObject({
      filename: "logo.png",
      content_id: "axora-logo",
    });
  });

  it.each([
    [429, "retry"],
    [500, "retry"],
    [401, "configuration"],
    [400, "failed"],
  ])("classifies HTTP %i as %s", async (status, disposition) => {
    const provider = createResendEmailProvider({
      token: "re_synthetic_production_key_value",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ message: "redacted" }), {
        status,
        headers: { "content-type": "application/json" },
      })),
    });
    await expect(provider.send(message)).rejects.toMatchObject({ disposition, statusCode: status });
  });

  it("treats transport ambiguity and malformed success as uncertain without logging secrets", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unavailable = createResendEmailProvider({
      token: "re_secret_that_must_not_be_logged",
      fetchImpl: vi.fn(async () => { throw new Error("connection reset"); }),
    });
    await expect(unavailable.send(message)).rejects.toMatchObject({ disposition: "uncertain" });
    const malformed = createResendEmailProvider({
      token: "re_secret_that_must_not_be_logged",
      fetchImpl: vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });
    await expect(malformed.send(message)).rejects.toMatchObject({ disposition: "uncertain" });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("fails closed before rendering or reading credentials when delivery is disabled", async () => {
    await expect(sendAccountSetup({}, {
      env: { AXORA_EMAIL_DELIVERY_ENABLED: "false" },
      readFileImpl: vi.fn(async () => { throw new Error("must not read"); }),
    })).rejects.toThrow("email_not_configured");
    await expect(readinessStatus({
      env: { AXORA_EMAIL_DELIVERY_ENABLED: "false", AXORA_EMAIL_PROVIDER: "resend" },
      readFileImpl: vi.fn(async () => { throw new Error("must not read"); }),
    })).resolves.toEqual({ statusCode: 200, body: { status: "disabled" } });
  });
});
