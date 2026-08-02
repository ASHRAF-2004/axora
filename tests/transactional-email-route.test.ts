import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  claimTransactional: vi.fn(),
  completeTransactional: vi.fn(),
  claimWorkflow: vi.fn(),
  completeWorkflow: vi.fn(),
}));

vi.mock("@/lib/account-email", () => ({
  buildAccountSetupUrl: vi.fn((token: string) => (
    `https://axora.management/account/setup#token=${token}`
  )),
  verifyEmailServiceRequest: mocks.verify,
}));

vi.mock("@/lib/transactional-email", () => ({
  claimTransactionalEmailOutbox: mocks.claimTransactional,
  completeTransactionalEmailOutbox: mocks.completeTransactional,
}));

vi.mock("@/lib/workflow-email", () => ({
  claimWorkflowEmailOutbox: mocks.claimWorkflow,
  completeWorkflowEmailOutbox: mocks.completeWorkflow,
}));

import { POST } from "@/app/account/email-outbox/route";

function request(body: unknown) {
  return new Request("http://app:3000/account/email-outbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("private transactional outbox route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue(true);
  });

  it("claims only from the explicitly selected transactional queue", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000001",
      leaseId: "00000000-0000-4000-8000-000000000002",
      messageKind: "PASSWORD_RESET",
      recipientEmail: "aisha@example.test",
    };
    mocks.claimTransactional.mockResolvedValue(job);

    const response = await POST(request({ action: "claim", queue: "transactional" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job });
    expect(mocks.claimTransactional).toHaveBeenCalledOnce();
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      pathname: "/account/email-outbox",
    }));
  });

  it("records a leased transactional completion and reports stale leases", async () => {
    const body = {
      action: "complete",
      queue: "transactional",
      deliveryId: "00000000-0000-4000-8000-000000000011",
      leaseId: "00000000-0000-4000-8000-000000000012",
      outcome: "sent",
      providerMessageId: "cloudflare-message-123",
    } as const;
    mocks.completeTransactional.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const recorded = await POST(request(body));
    expect(recorded.status).toBe(200);
    await expect(recorded.json()).resolves.toEqual({ recorded: true });
    expect(mocks.completeTransactional).toHaveBeenCalledWith(
      body.deliveryId,
      body.leaseId,
      "sent",
      { providerMessageId: body.providerMessageId, errorCode: undefined },
    );

    const stale = await POST(request(body));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "stale_lease" });
  });

  it("claims and completes only the selected workflow queue", async () => {
    const job = {
      deliveryId: "00000000-0000-4000-8000-000000000021",
      leaseId: "00000000-0000-4000-8000-000000000022",
      messageKind: "WORKFLOW_UPDATE",
      recipientEmail: "aisha@example.test",
      workflow: {
        title: "Request approved",
        body: "Your request moved to sourcing.",
        actionPath: "/requests/00000000-0000-4000-8000-000000000023",
      },
    };
    mocks.claimWorkflow.mockResolvedValue(job);
    const claimed = await POST(request({ action: "claim", queue: "workflow" }));
    expect(claimed.status).toBe(200);
    await expect(claimed.json()).resolves.toEqual({ job });
    expect(mocks.claimWorkflow).toHaveBeenCalledOnce();
    expect(mocks.claimTransactional).not.toHaveBeenCalled();

    mocks.completeWorkflow.mockResolvedValue(true);
    const completed = await POST(request({
      action: "complete",
      queue: "workflow",
      deliveryId: job.deliveryId,
      leaseId: job.leaseId,
      outcome: "sent",
    }));
    expect(completed.status).toBe(200);
    expect(mocks.completeWorkflow).toHaveBeenCalledWith(
      job.deliveryId,
      job.leaseId,
      "sent",
      { providerMessageId: undefined, errorCode: undefined },
    );
  });

  it("rejects unauthenticated and malformed requests without touching either queue", async () => {
    mocks.verify.mockReturnValueOnce(false);
    const unauthorized = await POST(request({ action: "claim", queue: "transactional" }));
    expect(unauthorized.status).toBe(401);

    const malformed = await POST(request({ action: "claim", queue: "account" }));
    expect(malformed.status).toBe(400);
    expect(mocks.claimTransactional).not.toHaveBeenCalled();
    expect(mocks.claimWorkflow).not.toHaveBeenCalled();
  });
});
