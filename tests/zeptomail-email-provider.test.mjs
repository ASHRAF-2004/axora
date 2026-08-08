import { describe, expect, it, vi } from "vitest";
import {
  apiToken,
  createZeptoMailProvider,
  senderConfiguration,
} from "../server-tools/email-sender.mjs";

const message = {
  deliveryId: "20000000-0000-4000-8000-000000000901",
  providerAgent: "axora-auth",
  to: "recipient@example.test",
  recipientName: "Recipient",
  from: { address: "security@axora.management", name: "Axora Security" },
  reply_to: { address: "support@axora.management", name: "Axora support" },
  subject: "Reset your Axora password",
  html: "<p>Secure account message</p>",
  text: "Secure account message",
  attachments: [{
    content: Buffer.from("logo").toString("base64"),
    filename: "logo.png",
    type: "image/png",
    disposition: "inline",
    content_id: "axora-logo",
  }],
  headers: { "X-Axora-Template": "password-reset-v1" },
};

describe("ZeptoMail provider adapter", () => {
  it("accepts provider-neutral sender configuration without a Cloudflare account", () => {
    expect(senderConfiguration({
      AXORA_EMAIL_PROVIDER: "zeptomail",
      AXORA_EMAIL_FROM_ADDRESS: "security@axora.management",
      AXORA_EMAIL_FROM_NAME: "Axora Security",
      AXORA_EMAIL_REPLY_TO: "support@axora.management",
      APP_BASE_URL: "https://axora.management",
    })).toMatchObject({ provider: "zeptomail", accountId: "" });
  });

  it("uses the active rotation slot without exposing or combining tokens", async () => {
    const readFileImpl = vi.fn(async () => "z".repeat(48));
    await expect(apiToken({
      env: {
        AXORA_EMAIL_PROVIDER: "zeptomail",
        AXORA_ZEPTOMAIL_TOKEN_SLOT: "next",
        ZEPTOMAIL_SEND_TOKEN_FILE: "/run/secrets/primary",
        ZEPTOMAIL_SEND_TOKEN_NEXT_FILE: "/run/secrets/next",
      },
      readFileImpl,
      provider: "zeptomail",
      providerAgent: "axora-auth",
    })).resolves.toBe("z".repeat(48));
    expect(readFileImpl).toHaveBeenCalledWith("/run/secrets/next", "utf8");
  });

  it("submits one recipient with a stable client reference and tracking disabled", async () => {
    let request;
    const provider = createZeptoMailProvider({
      token: "token-value-that-is-long-enough",
      fetchImpl: vi.fn(async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({ request_id: "zepto-request-901" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }),
    });
    await expect(provider.send(message)).resolves.toEqual({
      status: "submitted",
      messageId: "zepto-request-901",
    });
    expect(request.url).toBe("https://api.zeptomail.com/v1.1/email");
    expect(request.options.headers.Authorization).toBe(
      "Zoho-enczapikey token-value-that-is-long-enough",
    );
    expect(request.body).toMatchObject({
      client_reference: message.deliveryId,
      track_clicks: false,
      track_opens: false,
      textbody: message.text,
      htmlbody: message.html,
      to: [{ email_address: { address: message.to, name: message.recipientName } }],
    });
    expect(request.body).not.toHaveProperty("cc");
    expect(request.body).not.toHaveProperty("bcc");
    expect(request.body.inline_images).toHaveLength(1);
  });

  it.each([
    [429, "retry"],
    [503, "retry"],
    [401, "configuration"],
    [400, "failed"],
  ])("classifies HTTP %i as %s", async (status, disposition) => {
    const provider = createZeptoMailProvider({
      token: "token-value-that-is-long-enough",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: {} }), {
        status,
        headers: { "Content-Type": "application/json" },
      })),
    });
    await expect(provider.send(message)).rejects.toMatchObject({ statusCode: status, disposition });
  });

  it("treats an ambiguous network failure as uncertain and never retries inline", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("connection reset"); });
    const provider = createZeptoMailProvider({
      token: "token-value-that-is-long-enough",
      fetchImpl,
    });
    await expect(provider.send(message)).rejects.toMatchObject({ disposition: "uncertain" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
