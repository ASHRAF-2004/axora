import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  record: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/account-email", () => ({
  sendAccountSetupEmail: mocks.send,
}));

vi.mock("@/lib/account-setup", () => ({
  recordAccountSetupDelivery: mocks.record,
}));

vi.mock("@/lib/company-lifecycle", () => ({
  syncCompanyAdministrator: mocks.sync,
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
}));

import { deliverAccountSetupInvitation } from "@/lib/account-invitation-delivery";

const actor = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  name: "Owner",
  role: "PLATFORM_OWNER" as const,
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
  authVersion: 1,
};

const invitation = {
  invitationId: "80000000-0000-4000-8000-000000000001",
  userId: "70000000-0000-4000-8000-000000000001",
  recipientName: "Company Administrator",
  recipientEmail: "administrator@example.test",
  companyName: "Example Company",
  companyId: "10000000-0000-4000-8000-000000000001",
  role: "COMPANY_ADMIN" as const,
  expiresAt: "2026-08-24T00:00:00.000Z",
  locale: "en" as const,
  rawToken: "A".repeat(43),
};

describe("canonical account invitation post-delivery behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({
      succeeded: true,
      providerMessageId: "provider-message-id",
      providerName: "resend",
      status: "sent",
    });
    mocks.record.mockResolvedValue(true);
    mocks.sync.mockResolvedValue({});
  });

  it("synchronizes a Company Administrator only after SENT is durably recorded", async () => {
    await expect(deliverAccountSetupInvitation(invitation, actor)).resolves.toBe("sent");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(invitation.invitationId, {
      succeeded: true,
      providerMessageId: "provider-message-id",
      providerName: "resend",
      status: "sent",
    });
    expect(mocks.record.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
    expect(mocks.sync).toHaveBeenCalledWith(
      actor,
      invitation.companyId,
      "Secure Company Administrator invitation delivered",
    );
  });

  it("does not synchronize when the provider result cannot be recorded", async () => {
    mocks.record.mockResolvedValue(false);

    await expect(deliverAccountSetupInvitation(invitation, actor))
      .resolves.toBe("unconfirmed");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("preserves a failed invitation without a lifecycle transition", async () => {
    mocks.send.mockResolvedValue({ succeeded: false, status: "failed" });

    await expect(deliverAccountSetupInvitation(invitation, actor))
      .resolves.toBe("failed");
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("returns a recoverable result without sending twice when synchronization fails", async () => {
    mocks.sync.mockRejectedValue(new Error("lifecycle unavailable"));

    await expect(deliverAccountSetupInvitation(invitation, actor))
      .resolves.toBe("sent-lifecycle-sync-failed");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it("does not apply Company lifecycle behavior to another invitation role", async () => {
    await expect(deliverAccountSetupInvitation({
      ...invitation,
      role: "COMPANY_APPROVER",
    }, actor)).resolves.toBe("sent");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
