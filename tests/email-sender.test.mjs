import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROVIDER_ATTEMPTS,
  createEmailSenderServer,
  createEmailOutboxPoller,
  emailSenderInternals,
  fetchWithRetry,
  pollTransactionalEmailOutboxOnce,
  readinessStatus,
  sendAccountSetup,
  sendTransactionalEmail,
} from "../server-tools/email-sender.mjs";

const enabledEnvironment = {
  AXORA_EMAIL_DELIVERY_ENABLED: "true",
  APP_BASE_URL: "https://axora.management",
  RESEND_API_KEY_FILE: "/run/secrets/resend_api_key",
  AXORA_EMAIL_SERVICE_AUTH_KEY_FILE: "/run/secrets/axora_email_service_auth_key",
  AXORA_EMAIL_OUTBOX_URL: "http://app:3000/account/email-outbox",
  AXORA_EMAIL_PROVIDER: "resend",
  AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management",
  AXORA_EMAIL_FROM_NAME: "Axora",
  AXORA_EMAIL_REPLY_TO: "support@axora.management",
};

const accountSetupPayload = {
  deliveryId: "00000000-0000-4000-8000-000000000001",
  recipientName: "Aisha Rahman",
  recipientEmail: "aisha@example.com",
  companyName: "Example Industries",
  role: "COMPANY_ADMIN",
  expiresAt: "2026-08-03T06:00:00.000Z",
  setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
};

function secretReader(value = "re_synthetic_production_key_value") {
  return vi.fn(async (filename, encoding) => {
    if (encoding === "utf8") {
      return String(filename).includes("resend_api_key") ? value : "s".repeat(48);
    }
    return Buffer.from("png");
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  emailSenderInternals.deliveryCache.clear();
  emailSenderInternals.replayCache.clear();
});

describe("central provider retry boundary", () => {
  it.each([429, 500, 503])("does not immediately replay HTTP %i", async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const response = await fetchWithRetry("https://provider.example/send", {}, { fetchImpl });
    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
  });

  it("treats a network exception as uncertain without replay", async () => {
    const cause = new TypeError("connection reset after request write");
    const fetchImpl = vi.fn().mockRejectedValue(cause);
    await expect(fetchWithRetry("https://provider.example/send", {}, { fetchImpl }))
      .rejects.toMatchObject({
        message: "provider_unavailable",
        disposition: "uncertain",
        cause,
      });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("central Resend delivery", () => {
  it("delivers account setup only through a Resend provider implementation", async () => {
    const provider = {
      name: "resend",
      send: vi.fn().mockResolvedValue({ status: "submitted", messageId: "re-email-1" }),
    };
    await expect(sendAccountSetup(accountSetupPayload, {
      env: enabledEnvironment,
      provider,
      readFileImpl: secretReader(),
    })).resolves.toEqual({
      succeeded: true,
      status: "submitted",
      providerName: "resend",
      providerAgent: "axora-auth",
      messageId: "re-email-1",
    });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send.mock.calls[0][0]).toMatchObject({
      deliveryId: accountSetupPayload.deliveryId,
      providerAgent: "axora-auth",
      to: accountSetupPayload.recipientEmail,
    });
  });

  it("rejects a non-Resend injected provider before sending", async () => {
    const provider = { name: "legacy-provider", send: vi.fn() };
    await expect(sendAccountSetup(accountSetupPayload, {
      env: enabledEnvironment,
      provider,
      readFileImpl: secretReader(),
    })).rejects.toThrow("email_not_configured");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("renders a password reset through the same Resend sender boundary", async () => {
    const provider = {
      name: "resend",
      send: vi.fn().mockResolvedValue({ status: "submitted" }),
    };
    const token = "R".repeat(43);
    await expect(sendTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000011",
      messageKind: "PASSWORD_RESET",
      providerAgent: "axora-auth",
      recipientName: "Aisha Rahman",
      recipientEmail: "aisha@example.test",
      locale: "en",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management/account/reset-password#token=${token}`,
    }, {
      env: enabledEnvironment,
      provider,
      readFileImpl: secretReader(),
    })).resolves.toMatchObject({
      succeeded: true,
      providerName: "resend",
      providerAgent: "axora-auth",
    });
    const message = provider.send.mock.calls[0][0];
    expect(message.headers).toEqual({ "X-Axora-Template": "password-reset-v1" });
    expect(message.attachments).toHaveLength(1);
    expect(message.html).toContain(`/account/reset-password#token=${token}`);
  });

  it("uses a validated contact sender only as reply-to", async () => {
    const provider = {
      name: "resend",
      send: vi.fn().mockResolvedValue({ status: "submitted" }),
    };
    await sendTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000012",
      messageKind: "CONTACT_NOTIFICATION",
      providerAgent: "axora-platform",
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
    }, { env: enabledEnvironment, provider, readFileImpl: secretReader() });
    expect(provider.send.mock.calls[0][0].reply_to).toEqual({
      address: "aisha@example.test",
      name: "Aisha Rahman",
    });
  });

  it("claims, sends with Resend, and acknowledges the transactional queue", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000021",
      leaseId: "00000000-0000-4000-8000-000000000022",
      messageKind: "EMAIL_VERIFICATION",
      providerAgent: "axora-auth",
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
      return new Response(JSON.stringify({ id: "re-transactional-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-resend-monthly-quota": "8",
          "x-resend-daily-quota": "0",
        },
      });
    });
    await expect(pollTransactionalEmailOutboxOnce({
      env: enabledEnvironment,
      fetchImpl,
      readFileImpl: secretReader(),
    })).resolves.toEqual({ claimed: true, outcome: "sent" });
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[0].body)).toEqual({ action: "claim", queue: "transactional" });
    expect(JSON.parse(requests[2].body)).toMatchObject({
      action: "complete",
      queue: "transactional",
      deliveryId: job.deliveryId,
      leaseId: job.leaseId,
      outcome: "sent",
      providerMessageId: "re-transactional-123",
      providerName: "resend",
      providerAgent: "axora-auth",
      quotaSnapshot: expect.objectContaining({
        provider: "resend",
        monthlyUsed: 8,
        monthlyLimit: 3000,
        dailyUsed: 0,
        dailyLimit: 100,
      }),
    });
    expect(requests[1].url).toBe("https://api.resend.com/emails");
    expect(requests[1].headers["Idempotency-Key"] ?? requests[1].headers.get?.("Idempotency-Key"))
      .toBe(`axora-delivery-${job.deliveryId}`);
  });
});

describe("email sender readiness and private endpoints", () => {
  it("reports disabled without reading secrets", async () => {
    const readFileImpl = vi.fn();
    await expect(readinessStatus({
      env: { AXORA_EMAIL_DELIVERY_ENABLED: "false" },
      readFileImpl,
    })).resolves.toEqual({ statusCode: 200, body: { status: "disabled" } });
    expect(readFileImpl).not.toHaveBeenCalled();
  });

  it("reports ready only for valid Resend configuration and local secrets/assets", async () => {
    const readFileImpl = secretReader();
    await expect(readinessStatus({ env: enabledEnvironment, readFileImpl }))
      .resolves.toEqual({ statusCode: 200, body: { status: "ready" } });
    expect(readFileImpl).toHaveBeenCalledTimes(4);
    await expect(readinessStatus({
      env: { ...enabledEnvironment, AXORA_EMAIL_PROVIDER: "legacy-provider" },
      readFileImpl,
    })).resolves.toEqual({ statusCode: 503, body: { status: "not_ready" } });
  });

  it("authenticates and idempotently handles the private transactional endpoint", async () => {
    const sendTransactionalEmailImpl = vi.fn().mockResolvedValue({
      succeeded: true,
      status: "submitted",
      providerName: "resend",
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

    const unauthorizedServer = createEmailSenderServer({ verifyServiceRequestImpl: async () => false });
    await new Promise((resolveListen) => unauthorizedServer.listen(0, "127.0.0.1", resolveListen));
    const unauthorizedAddress = unauthorizedServer.address();
    try {
      const response = await fetch(`http://127.0.0.1:${unauthorizedAddress.port}/v1/account-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountSetupPayload),
      });
      expect(response.status).toBe(401);
    } finally {
      await new Promise((resolveClose, rejectClose) => unauthorizedServer.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    }
  });
});

describe("durable outbox polling readiness and recovery", () => {
  it("reports a claim outage honestly and recovers both queues without restart", async () => {
    const pollTransactionalImpl = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("private queue details"), { statusCode: 503, stage: "claim" }))
      .mockResolvedValue({ claimed: false });
    const pollWorkflowImpl = vi.fn().mockResolvedValue({ claimed: false });
    const logError = vi.fn();
    const poller = createEmailOutboxPoller({ env: enabledEnvironment, pollTransactionalImpl, pollWorkflowImpl, logError });
    try {
      expect(poller.readiness()).toEqual({ statusCode: 503, body: { status: "starting", subsystem: "outbox" } });
      await poller.poll();
      expect(poller.readiness()).toEqual({ statusCode: 503, body: { status: "degraded", subsystem: "outbox" } });
      expect(logError).toHaveBeenCalledWith({ event: "transactional_email_outbox_poll_failed", stage: "claim", httpStatus: 503 });
      expect(JSON.stringify(logError.mock.calls)).not.toContain("private queue details");
      await poller.poll();
      expect(poller.readiness()).toEqual({ statusCode: 200, body: { status: "ready" } });
      expect(pollTransactionalImpl).toHaveBeenCalledTimes(2);
      expect(pollWorkflowImpl).toHaveBeenCalledTimes(2);
    } finally { await poller.stop(); }
  });

  it("bounds startup and marks stalled polling degraded", async () => {
    let clock = 1_000;
    const poller = createEmailOutboxPoller({ env: enabledEnvironment,
      pollTransactionalImpl: async () => ({ claimed: false }),
      pollWorkflowImpl: async () => ({ claimed: false }), now: () => clock,
    });
    try {
      clock += 45_001;
      expect(poller.readiness().body.status).toBe("degraded");
      await poller.poll();
      expect(poller.readiness().statusCode).toBe(200);
      clock += 45_001;
      expect(poller.readiness().body.status).toBe("degraded");
    } finally { await poller.stop(); }
  });

  it("does not overlap leases and drains an active poll during graceful stop", async () => {
    let finish;
    const waiting = new Promise((resolve) => { finish = resolve; });
    const pollTransactionalImpl = vi.fn(() => waiting);
    const pollWorkflowImpl = vi.fn().mockResolvedValue({ claimed: false });
    const poller = createEmailOutboxPoller({ env: enabledEnvironment, pollTransactionalImpl, pollWorkflowImpl });
    const first = poller.poll();
    const overlapping = poller.poll();
    let stopped = false;
    const stopping = poller.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(pollTransactionalImpl).toHaveBeenCalledOnce();
    finish({ claimed: false });
    await Promise.all([first, overlapping, stopping]);
    await poller.poll();
    expect(pollTransactionalImpl).toHaveBeenCalledOnce();
    expect(pollWorkflowImpl).not.toHaveBeenCalled();
    expect(stopped).toBe(true);
  });

  it("records a lost completion response without replaying the provider send", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000041",
      leaseId: "00000000-0000-4000-8000-000000000042",
      messageKind: "CONTACT_NOTIFICATION", providerAgent: "axora-platform",
      recipientName: "Axora team", recipientEmail: "monitored-inbox@example.test", locale: "en",
      contact: { name: "Fixture Visitor", message: "Synthetic controlled recovery enquiry.", submittedAt: new Date().toISOString() },
    };
    let claimed = false;
    const provider = { name: "resend", send: vi.fn().mockResolvedValue({ status: "submitted", messageId: "isolated-provider-accepted" }) };
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "complete") throw new TypeError("response connection interrupted");
      if (claimed) return Response.json({ job: null });
      claimed = true;
      return Response.json({ job });
    });
    await expect(pollTransactionalEmailOutboxOnce({ env: enabledEnvironment, provider, fetchImpl, readFileImpl: secretReader() }))
      .rejects.toMatchObject({ message: "outbox_unavailable", stage: "complete" });
    // A fresh process sees the durable SENDING lease, rather than sending again.
    await expect(pollTransactionalEmailOutboxOnce({ env: enabledEnvironment, provider, fetchImpl, readFileImpl: secretReader() }))
      .resolves.toEqual({ claimed: false });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send.mock.calls[0][0].deliveryId).toBe(job.deliveryId);
  });

  it.each([{ recorded: false }, {}, "malformed"])("degrades an unrecorded completion %j without provider replay", async (acknowledgement) => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000051",
      leaseId: "00000000-0000-4000-8000-000000000052",
      messageKind: "CONTACT_NOTIFICATION", providerAgent: "axora-platform",
      recipientName: "Axora team", recipientEmail: "monitored-inbox@example.test", locale: "en",
      contact: { name: "Private synthetic visitor", message: "Private synthetic enquiry body.", submittedAt: new Date().toISOString() },
    };
    let claimed = false;
    const provider = { name: "resend", send: vi.fn().mockResolvedValue({ status: "submitted", messageId: "isolated-provider-unrecorded" }) };
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "complete") return acknowledgement === "malformed"
        ? new Response("malformed", { status: 200 }) : Response.json(acknowledgement);
      if (claimed) return Response.json({ job: null });
      claimed = true;
      return Response.json({ job });
    });
    const logError = vi.fn();
    const poller = createEmailOutboxPoller({ env: enabledEnvironment, logError,
      pollTransactionalImpl: () => pollTransactionalEmailOutboxOnce({ env: enabledEnvironment, provider, fetchImpl, readFileImpl: secretReader() }),
      pollWorkflowImpl: async () => ({ claimed: false }),
    });
    try {
      await poller.poll();
      expect(poller.readiness().body.status).toBe("degraded");
      expect(logError).toHaveBeenCalledWith({ event: "transactional_email_outbox_poll_failed", stage: "complete", httpStatus: 200 });
      expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|monitored-inbox|unrecorded/i);
      await poller.poll();
      expect(provider.send).toHaveBeenCalledOnce();
    } finally { await poller.stop(); }
  });

  it("keeps an invalid delivery switch degraded without unhandled polling errors", async () => {
    const pollTransactionalImpl = vi.fn();
    const logError = vi.fn();
    const poller = createEmailOutboxPoller({ env: { AXORA_EMAIL_DELIVERY_ENABLED: "invalid" }, pollTransactionalImpl, logError });
    try {
      await expect(poller.poll()).resolves.toBeUndefined();
      expect(pollTransactionalImpl).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith({ event: "email_outbox_poll_failed", stage: "configuration" });
      expect(poller.readiness().body.status).toBe("degraded");
    } finally { await poller.stop(); }
  });
});
