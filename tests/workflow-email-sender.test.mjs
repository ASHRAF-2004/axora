import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailSenderInternals,
  pollWorkflowEmailOutboxOnce,
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
  vi.restoreAllMocks();
  emailSenderInternals.deliveryCache.clear();
  emailSenderInternals.replayCache.clear();
});

describe("workflow email sender", () => {
  it("renders a role-aware workflow message with the shared provider adapter", async () => {
    const provider = { send: vi.fn().mockResolvedValue({ status: "queued" }) };
    const readFileImpl = vi.fn().mockResolvedValue(Buffer.from("png"));
    await expect(sendTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000041",
      messageKind: "WORKFLOW_UPDATE",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: {
        title: "Approval required",
        body: "A request is waiting for your decision.",
        actionPath: "/approvals",
      },
    }, {
      env: enabledEnvironment,
      provider,
      readFileImpl,
    })).resolves.toEqual({ succeeded: true, status: "queued" });

    expect(provider.send).toHaveBeenCalledOnce();
    const message = provider.send.mock.calls[0][0];
    expect(message.subject).toBe("Axora workflow update");
    expect(message.subject).not.toContain("Approval required");
    expect(message.to).toBe("person@example.test");
    expect(message.reply_to.address).toBe("support@axora.management");
    expect(message.headers).toEqual({ "X-Axora-Template": "workflow-update-v1" });
    expect(message.attachments).toHaveLength(1);
  });

  it("claims, sends and acknowledges one workflow lease without exposing content in completion", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000042",
      leaseId: "00000000-0000-4000-8000-000000000043",
      messageKind: "WORKFLOW_UPDATE",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: {
        title: "Request approved",
        body: "Your request moved to sourcing.",
        actionPath: "/requests/00000000-0000-4000-8000-000000000044",
      },
    };
    const requests = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return body.action === "claim"
        ? new Response(JSON.stringify({ job }), { status: 200 })
        : new Response(JSON.stringify({ recorded: true }), { status: 200 });
    });
    const provider = {
      send: vi.fn().mockResolvedValue({
        status: "delivered",
        messageId: "cloudflare-workflow-1",
      }),
    };
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(pollWorkflowEmailOutboxOnce({
      env: enabledEnvironment,
      fetchImpl,
      provider,
      readFileImpl,
    })).resolves.toEqual({ claimed: true, outcome: "sent" });
    expect(requests).toEqual([
      { action: "claim", queue: "workflow" },
      {
        action: "complete",
        queue: "workflow",
        deliveryId: job.deliveryId,
        leaseId: job.leaseId,
        outcome: "sent",
        providerMessageId: "cloudflare-workflow-1",
      },
    ]);
    expect(JSON.stringify(requests[1])).not.toContain(job.recipientEmail);
    expect(JSON.stringify(requests[1])).not.toContain(job.workflow.body);
  });

  it("leaves a throttled provider outcome to the durable bounded retry", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000045",
      leaseId: "00000000-0000-4000-8000-000000000046",
      messageKind: "WORKFLOW_UPDATE",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      workflow: { title: "Delivery update", body: "A delivery status changed." },
    };
    const requests = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return body.action === "claim"
        ? new Response(JSON.stringify({ job }), { status: 200 })
        : new Response(JSON.stringify({ recorded: true }), { status: 200 });
    });
    const providerError = Object.assign(new Error("provider_rate_limited"), {
      disposition: "retry",
    });
    const provider = { send: vi.fn().mockRejectedValue(providerError) };
    const readFileImpl = vi.fn(async (_filename, encoding) => (
      encoding === "utf8" ? "t".repeat(40) : Buffer.from("png")
    ));

    await expect(pollWorkflowEmailOutboxOnce({
      env: enabledEnvironment,
      fetchImpl,
      provider,
      readFileImpl,
    })).resolves.toEqual({ claimed: true, outcome: "retry" });
    expect(requests[1]).toMatchObject({
      queue: "workflow",
      outcome: "retry",
      errorCode: "provider_rate_limited",
    });
  });
});
