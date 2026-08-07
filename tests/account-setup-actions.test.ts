import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  InvitationQuotaError: class InvitationQuotaError extends Error {
    constructor(public readonly reason: "actor" | "company") {
      super(reason);
    }
  },
  ResendRateLimitError: class ResendRateLimitError extends Error {
    constructor(public readonly reason: "cooldown" | "hourly") {
      super(reason);
    }
  },
  requirePermission: vi.fn(),
  requireRecentStepUp: vi.fn(),
  createInvitedUser: vi.fn(),
  resendInvitation: vi.fn(),
  recordDelivery: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  lockAuthorizedUserTarget: vi.fn(),
  setAuthorizedUserActive: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
  requireRecentStepUp: mocks.requireRecentStepUp,
}));

vi.mock("@/lib/account-setup", () => ({
  AccountSetupInvitationQuotaError: mocks.InvitationQuotaError,
  AccountSetupResendRateLimitError: mocks.ResendRateLimitError,
  createInvitedUser: mocks.createInvitedUser,
  resendAccountSetupInvitation: mocks.resendInvitation,
  recordAccountSetupDelivery: mocks.recordDelivery,
}));

vi.mock("@/lib/account-email", () => ({
  sendAccountSetupEmail: mocks.sendEmail,
}));

vi.mock("@/lib/user-isolation", () => ({
  lockAuthorizedUserTarget: mocks.lockAuthorizedUserTarget,
  setAuthorizedUserActive: mocks.setAuthorizedUserActive,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import {
  createUserAction,
  resendAccountSetupInvitationAction,
} from "@/app/(portal)/users/actions";

const actor = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
};

const invitation = {
  invitationId: "80000000-0000-4000-8000-000000000001",
  userId: "70000000-0000-4000-8000-000000000001",
  recipientName: "New User",
  recipientEmail: "new@example.test",
  companyName: "Example Company",
  role: "VIEWER",
  expiresAt: "2026-08-03T00:00:00.000Z",
  rawToken: "A".repeat(43),
};

function userForm() {
  const form = new FormData();
  form.set("email", "new@example.test");
  form.set("displayName", "New User");
  form.set("role", "VIEWER");
  form.set("preferredLocale", "ar");
  return form;
}

describe("account invitation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.requireRecentStepUp.mockResolvedValue(undefined);
    mocks.createInvitedUser.mockResolvedValue(invitation);
    mocks.resendInvitation.mockResolvedValue(invitation);
    mocks.recordDelivery.mockResolvedValue(true);
    mocks.lockAuthorizedUserTarget.mockResolvedValue({
      userId: invitation.userId,
      permission: "user.invite",
    });
  });

  it("creates an invitation without accepting an administrator password", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    const form = userForm();
    form.set("password", "this field must be ignored");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-invited",
    );

    expect(mocks.createInvitedUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@example.test",
      displayName: "New User",
      role: "VIEWER",
      preferredLocale: "ar",
    }), actor);
    expect(mocks.sendEmail).toHaveBeenCalledWith(invitation);
    expect(mocks.recordDelivery).toHaveBeenCalledWith(invitation.invitationId, {
      succeeded: true,
      providerMessageId: undefined,
      status: "sent",
    });
  });

  it("passes only structured organization scope and optional profile fields", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    const form = new FormData();
    form.set("email", "supplier.user@example.test");
    form.set("displayName", "Supplier User");
    form.set("role", "SUPPLIER_USER");
    form.set("supplierId", "30000000-0000-4000-8000-000000000001");
    form.set("jobTitle", "Quotation specialist");
    form.set("preferredLocale", "ms");
    form.set("password", "must still be ignored");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-invited",
    );
    expect(mocks.createInvitedUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "supplier.user@example.test",
      displayName: "Supplier User",
      role: "SUPPLIER_USER",
      supplierId: "30000000-0000-4000-8000-000000000001",
      jobTitle: "Quotation specialist",
      preferredLocale: "ms",
    }), actor);
  });

  it("rejects an unsupported invitation language before creating an account", async () => {
    const form = userForm();
    form.set("preferredLocale", "xx");
    await expect(createUserAction(form)).rejects.toThrow();
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the account and reports when email delivery is disabled", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: false, status: "disabled" });

    await expect(createUserAction(userForm())).rejects.toThrow(
      "REDIRECT:/users?notice=user-created-email-disabled",
    );
    expect(mocks.recordDelivery).toHaveBeenCalledWith(invitation.invitationId, {
      succeeded: false,
      providerMessageId: undefined,
      status: "disabled",
    });
  });

  it("reports the administrator invitation quota without creating an account", async () => {
    mocks.createInvitedUser.mockRejectedValue(new mocks.InvitationQuotaError("actor"));

    await expect(createUserAction(userForm())).rejects.toThrow(
      "REDIRECT:/users?notice=user-invitation-quota-actor",
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordDelivery).not.toHaveBeenCalled();
  });

  it("reports an unconfirmed outcome when delivery tracking cannot be saved", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    mocks.recordDelivery.mockRejectedValue(new Error("database unavailable"));

    await expect(createUserAction(userForm())).rejects.toThrow(
      "REDIRECT:/users?notice=user-created-email-unconfirmed",
    );
  });

  it("resends only after the exact scoped target is authorized", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });

    await expect(
      resendAccountSetupInvitationAction(invitation.userId),
    ).rejects.toThrow("REDIRECT:/users?notice=user-invitation-resent");

    expect(mocks.lockAuthorizedUserTarget).toHaveBeenCalledWith(
      actor,
      invitation.userId,
      "user.invite",
    );
    expect(mocks.resendInvitation).toHaveBeenCalledWith(invitation.userId, actor);
    expect(mocks.sendEmail).toHaveBeenCalledWith(invitation);
  });

  it("shows a safe notice when invitations are resent too quickly", async () => {
    mocks.resendInvitation.mockRejectedValue(new mocks.ResendRateLimitError("cooldown"));

    await expect(
      resendAccountSetupInvitationAction(invitation.userId),
    ).rejects.toThrow("REDIRECT:/users?notice=user-resend-cooldown");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reports the company-wide invitation quota during resend", async () => {
    mocks.resendInvitation.mockRejectedValue(new mocks.InvitationQuotaError("company"));

    await expect(
      resendAccountSetupInvitationAction(invitation.userId),
    ).rejects.toThrow("REDIRECT:/users?notice=user-invitation-quota-company");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
