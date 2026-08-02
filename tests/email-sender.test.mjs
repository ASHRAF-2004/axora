import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROVIDER_ATTEMPTS,
  createEmailSenderServer,
  emailSenderInternals,
  fetchWithRetry,
  parseProviderDeliveryResult,
  parseProviderMessageId,
  pollTransactionalEmailOutboxOnce,
  readinessStatus,
  sendAccountSetup,
  sendTransactionalEmail,
} from "../server-tools/email-sender.mjs";

const enabledEnvironment = {
  AXORA_EMAIL_DELIVERY_ENABLED: "true",
  APP_BASE_URL: "https://axora.management",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_EMAIL_API_TOKEN_FILE: "/run/secrets/cloudflare_email_api_token",
  AXORA_EMAIL_SERVICE_AUTH_KEY_FILE: "/run/secrets/axora_email_service_auth_key",
  AXORA_EMAIL_OUTBOX_URL: "http://app:3000/account/email-outbox",
  AXORA_EMAIL_PROVIDER: "cloudflare-email-service",
  AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management",
  AXORA_EMAIL_FROM_NAME: "Axora",
  AXORA_EMAIL_REPLY_TO: "support@axora.management",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  emailSenderInternals.deliveryCache.clear();
  emailSenderInternals.replayCache.clear();
});

describe("Cloudflare safe retry policy", () => {
  it.each([429, 500, 503])("does not immediately replay ambiguous or throttled HTTP %i responses", async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await fetchWithRetry("https://provider.example/send", {}, {
      fetchImpl,
    });

    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
  });

  it("does not retry any other HTTP status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));

    const response = await fetchWithRetry("https://provider.example/send", {}, {
      fetchImpl,
    });

    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry an ambiguous network exception", async () => {
    const cause = new TypeError("connection reset after request write");
    const fetchImpl = vi.fn().mockRejectedValue(cause);
    await expect(fetchWithRetry("https://provider.example/send", {}, {
      fetchImpl,
    })).rejects.toMatchObject({
      message: "provider_unavailable",
      disposition: "uncertain",
      cause,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("Cloudflare message ID parsing", () => {
  it("allows the REST API to omit result.message_id", () => {
    expect(parseProviderMessageId({ result: {} })).toBeUndefined();
  });

  it("returns a valid result.message_id", () => {
    expect(parseProviderMessageId({ result: { message_id: "cloudflare-message-123" } }))
      .toBe("cloudflare-message-123");
  });

  it.each([
    null,
    123,
    "",
    "x".repeat(256),
    "first\rsecond",
    "first\nsecond",
  ])("rejects an invalid message ID %#", (messageId) => {
    expect(() => parseProviderMessageId({ result: { message_id: messageId } }))
      .toThrow("provider_rejected");
  });

  it("returns the validated message ID from a successful provider send", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: ["aisha@example.com"],
        queued: [],
        permanent_bounces: [],
        message_id: "cloudflare-message-123",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(sendAccountSetup({
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.com",
      companyName: "Example Industries",
      role: "APPROVER",
      branchName: "Kuala Lumpur",
      expiresAt: "2026-08-03T06:00:00.000Z",
      setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, {
      env: enabledEnvironment,
      fetchImpl,
      readFileImpl,
    })).resolves.toEqual({
      succeeded: true,
      status: "delivered",
      messageId: "cloudflare-message-123",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("accepts a successful REST response without a message ID", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        delivered: [],
        queued: ["aisha@example.com"],
        permanent_bounces: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(sendAccountSetup({
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.com",
      companyName: "Example Industries",
      role: "APPROVER",
      branchName: "Kuala Lumpur",
      expiresAt: "2026-08-03T06:00:00.000Z",
      setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, {
      env: enabledEnvironment,
      fetchImpl,
      readFileImpl,
    })).resolves.toEqual({ succeeded: true, status: "queued" });
  });

  it.each([
    [429, "provider_rate_limited", "retry"],
    [500, "provider_unavailable", "uncertain"],
    [400, "provider_rejected", "failed"],
  ])("classifies HTTP %i without an unsafe immediate replay", async (status, message, disposition) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ code: 1, message: "safe fixture" }],
    }), { status, headers: { "Content-Type": "application/json" } }));
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(sendAccountSetup({
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.com",
      companyName: "Example Industries",
      role: "APPROVER",
      expiresAt: "2026-08-03T06:00:00.000Z",
      setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, { env: enabledEnvironment, fetchImpl, readFileImpl })).rejects.toMatchObject({
      message,
      disposition,
      statusCode: status,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("requires the exact single recipient in one Cloudflare result group", () => {
    expect(parseProviderDeliveryResult({
      result: {
        delivered: ["Aisha@Example.com"],
        queued: [],
        permanent_bounces: [],
      },
    }, "aisha@example.com")).toBe("delivered");

    for (const result of [
      { delivered: ["other@example.com"], queued: [], permanent_bounces: [] },
      { delivered: ["aisha@example.com"], queued: ["aisha@example.com"], permanent_bounces: [] },
      { delivered: [], queued: [] },
      { delivered: "aisha@example.com", queued: [], permanent_bounces: [] },
    ]) {
      expect(() => parseProviderDeliveryResult(
        { result },
        "aisha@example.com",
      )).toThrow(expect.objectContaining({
        message: "provider_rejected",
        disposition: "uncertain",
      }));
    }
  });

  it("treats an exact permanent bounce as a definite failed delivery", () => {
    expect(() => parseProviderDeliveryResult({
      result: {
        delivered: [],
        queued: [],
        permanent_bounces: ["aisha@example.com"],
      },
    }, "aisha@example.com")).toThrow(expect.objectContaining({
      message: "provider_rejected",
      disposition: "failed",
    }));
  });

  it("treats malformed JSON after HTTP acceptance as uncertain", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }));
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(sendAccountSetup({
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.com",
      companyName: "Example Industries",
      role: "APPROVER",
      expiresAt: "2026-08-03T06:00:00.000Z",
      setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, { env: enabledEnvironment, fetchImpl, readFileImpl })).rejects.toMatchObject({
      message: "provider_rejected",
      disposition: "uncertain",
      statusCode: 200,
    });
  });
});

describe("transactional notification delivery", () => {
  it("renders a security notification with only the local Axora logo", async () => {
    const provider = { send: vi.fn().mockResolvedValue({ status: "queued" }) };
    const readFileImpl = vi.fn().mockResolvedValue(Buffer.from("png"));
    const token = "R".repeat(43);

    await expect(sendTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000011",
      messageKind: "PASSWORD_RESET",
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.test",
      locale: "en",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management/account/reset-password#token=${token}`,
    }, {
      env: enabledEnvironment,
      provider,
      readFileImpl,
    })).resolves.toEqual({ succeeded: true, status: "queued" });

    expect(provider.send).toHaveBeenCalledOnce();
    const message = provider.send.mock.calls[0][0];
    expect(message.to).toBe("aisha@example.test");
    expect(message.reply_to.address).toBe("support@axora.management");
    expect(message.headers).toEqual({ "X-Axora-Template": "password-reset" });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      content_id: "axora-logo",
      disposition: "inline",
    });
    expect(message.html).toContain(`/account/reset-password#token=${token}`);
    expect(message.text).toContain(`/account/reset-password#token=${token}`);
  });

  it("uses the validated contact sender as reply-to for a private notification", async () => {
    const provider = { send: vi.fn().mockResolvedValue({ status: "delivered" }) };
    const readFileImpl = vi.fn().mockResolvedValue(Buffer.from("png"));

    await sendTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000012",
      messageKind: "CONTACT_NOTIFICATION",
      recipientName: "Axora team",
      recipientEmail: "monitored-inbox@example.test",
      locale: "ms",
      contact: {
        name: "Aisha Rahman",
        email: "aisha@example.test",
        company: "Example Industries",
        phone: "+60 12 345 6789",
        subject: "Procurement workflow",
        message: "Please contact us about a controlled purchasing rollout.",
        submittedAt: "2026-08-03T06:00:00.000Z",
      },
    }, { env: enabledEnvironment, provider, readFileImpl });

    const message = provider.send.mock.calls[0][0];
    expect(message.to).toBe("monitored-inbox@example.test");
    expect(message.reply_to).toEqual({
      address: "aisha@example.test",
      name: "Aisha Rahman",
    });
    expect(message.headers).toEqual({ "X-Axora-Template": "contact-notification" });
  });

  it("claims, sends, and acknowledges the transactional queue", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000021",
      leaseId: "00000000-0000-4000-8000-000000000022",
      messageKind: "EMAIL_VERIFICATION",
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.test",
      locale: "en",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management/account/verify-email#token=${"V".repeat(43)}`,
    };
    const requests = [];
    const fetchImpl = vi.fn(async (url, options) => {
      requests.push({ url: String(url), body: options?.body, headers: options?.headers });
      if (String(url).startsWith("http://app:3000")) {
        const body = JSON.parse(options.body);
        return body.action === "claim"
          ? new Response(JSON.stringify({ job }), { status: 200 })
          : new Response(JSON.stringify({ recorded: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        result: {
          delivered: [job.recipientEmail],
          queued: [],
          permanent_bounces: [],
          message_id: "cloudflare-transactional-123",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(pollTransactionalEmailOutboxOnce({
      env: enabledEnvironment,
      fetchImpl,
      readFileImpl,
    })).resolves.toEqual({ claimed: true, outcome: "sent" });

    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[0].body)).toEqual({
      action: "claim",
      queue: "transactional",
    });
    expect(JSON.parse(requests[2].body)).toEqual({
      action: "complete",
      queue: "transactional",
      deliveryId: job.deliveryId,
      leaseId: job.leaseId,
      outcome: "sent",
      providerMessageId: "cloudflare-transactional-123",
    });
    expect(requests[0].headers["X-Axora-Email-Signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requests[2].headers["X-Axora-Email-Signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("authenticates and idempotently handles the private transactional endpoint", async () => {
    const sendTransactionalEmailImpl = vi.fn().mockResolvedValue({
      succeeded: true,
      status: "queued",
    });
    const server = createEmailSenderServer({
      sendTransactionalEmailImpl,
      verifyServiceRequestImpl: async () => true,
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const payload = {
      deliveryId: "00000000-0000-4000-8000-000000000031",
      messageKind: "EMAIL_VERIFICATION",
    };
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/v1/transactional`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
      }
      expect(sendTransactionalEmailImpl).toHaveBeenCalledOnce();
    } finally {
      await new Promise((resolveClose, rejectClose) => server.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    }
  });
});

describe("email sender readiness", () => {
  it("blocks sends while delivery is disabled without reading files or calling the provider", async () => {
    const readFileImpl = vi.fn();
    const fetchImpl = vi.fn();

    await expect(sendAccountSetup({}, {
      env: { ...enabledEnvironment, AXORA_EMAIL_DELIVERY_ENABLED: "false" },
      readFileImpl,
      fetchImpl,
    })).rejects.toThrow("email_not_configured");
    expect(readFileImpl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports disabled without inspecting configuration files", async () => {
    const readFileImpl = vi.fn();

    await expect(readinessStatus({
      env: { AXORA_EMAIL_DELIVERY_ENABLED: "false" },
      readFileImpl,
    })).resolves.toEqual({ statusCode: 200, body: { status: "disabled" } });
    expect(readFileImpl).not.toHaveBeenCalled();
  });

  it("reports ready after validating config, the token, and both inline assets locally", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(readinessStatus({
      env: enabledEnvironment,
      readFileImpl,
    })).resolves.toEqual({ statusCode: 200, body: { status: "ready" } });
    expect(readFileImpl).toHaveBeenCalledTimes(4);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("reports not ready for invalid non-secret configuration", async () => {
    const readFileImpl = vi.fn();

    await expect(readinessStatus({
      env: { ...enabledEnvironment, CLOUDFLARE_ACCOUNT_ID: "invalid" },
      readFileImpl,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
    expect(readFileImpl).not.toHaveBeenCalled();
  });

  it("reports not ready when the token file is unreadable or empty", async () => {
    const unreadable = vi.fn().mockRejectedValue(new Error("EACCES"));
    const empty = vi.fn().mockResolvedValue("");

    await expect(readinessStatus({
      env: enabledEnvironment,
      readFileImpl: unreadable,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
    await expect(readinessStatus({
      env: enabledEnvironment,
      readFileImpl: empty,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
  });

  it.each([
    "short",
    `${"t".repeat(20)} token`,
    `${"t".repeat(20)}\u0000`,
    "t".repeat(4_097),
  ])("reports not ready for a malformed token %#", async (token) => {
    const readFileImpl = vi.fn().mockResolvedValue(token);

    await expect(readinessStatus({
      env: enabledEnvironment,
      readFileImpl,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
  });

  it("reports not ready when an inline asset is empty", async () => {
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.alloc(0)
    ));

    await expect(readinessStatus({
      env: enabledEnvironment,
      readFileImpl,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
  });

  it("serves liveness separately and exposes disabled readiness over HTTP", async () => {
    const server = createEmailSenderServer({
      readinessStatusImpl: async () => ({
        statusCode: 200,
        body: { status: "disabled" },
      }),
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    try {
      const live = await fetch(`http://127.0.0.1:${address.port}/health/live`);
      const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
      expect({ status: live.status, body: await live.json() })
        .toEqual({ status: 200, body: { status: "live" } });
      expect({ status: ready.status, body: await ready.json() })
        .toEqual({ status: 200, body: { status: "disabled" } });
    } finally {
      await new Promise((resolveClose, rejectClose) => server.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    }
  });

  it("requires authenticated POST requests and idempotently reuses a delivery result", async () => {
    const sendAccountSetupImpl = vi.fn().mockResolvedValue({
      succeeded: true,
      status: "queued",
    });
    const server = createEmailSenderServer({
      sendAccountSetupImpl,
      verifyServiceRequestImpl: async () => true,
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const payload = {
      deliveryId: "00000000-0000-4000-8000-000000000001",
      recipientName: "Aisha",
    };
    try {
      const first = await fetch(`http://127.0.0.1:${address.port}/v1/account-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}/v1/account-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(sendAccountSetupImpl).toHaveBeenCalledOnce();
    } finally {
      await new Promise((resolveClose, rejectClose) => server.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    }

    const unauthorizedServer = createEmailSenderServer({
      verifyServiceRequestImpl: async () => false,
    });
    await new Promise((resolveListen) => unauthorizedServer.listen(0, "127.0.0.1", resolveListen));
    const unauthorizedAddress = unauthorizedServer.address();
    try {
      const response = await fetch(
        `http://127.0.0.1:${unauthorizedAddress.port}/v1/account-setup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      expect(response.status).toBe(401);
    } finally {
      await new Promise((resolveClose, rejectClose) => unauthorizedServer.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    }
  });
});
