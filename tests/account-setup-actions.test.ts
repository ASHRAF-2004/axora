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
  ResendEligibilityError: class ResendEligibilityError extends Error {
    constructor(public readonly reason: "pending" | "delivered" | "ineligible") {
      super(reason);
    }
  },
  AccessUnavailableError: class AccessUnavailableError extends Error {},
  requirePermission: vi.fn(),
  createInvitedUser: vi.fn(),
  resendInvitation: vi.fn(),
  recordDelivery: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  setAuthorizedUserActive: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/account-setup", () => ({
  AccountSetupInvitationQuotaError: mocks.InvitationQuotaError,
  AccountSetupResendRateLimitError: mocks.ResendRateLimitError,
  AccountSetupResendEligibilityError: mocks.ResendEligibilityError,
  createInvitedUser: mocks.createInvitedUser,
  resendAccountSetupInvitation: mocks.resendInvitation,
  recordAccountSetupDelivery: mocks.recordDelivery,
}));

vi.mock("@/lib/access-management", () => ({
  AccessManagementUnavailableError: mocks.AccessUnavailableError,
}));

vi.mock("@/lib/account-email", () => ({
  sendAccountSetupEmail: mocks.sendEmail,
}));

vi.mock("@/lib/user-isolation", () => ({
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
  role: "COMPANY_ADMIN",
  expiresAt: "2026-08-03T00:00:00.000Z",
  rawToken: "A".repeat(43),
};

function userForm() {
  const form = new FormData();
  form.set("email", "new@example.test");
  form.set("displayName", "New User");
  form.set("role", "COMPANY_ADMIN");
  form.set("companyId", actor.companyId);
  form.set("preferredLocale", "ar");
  return form;
}

function resendForm() {
  const form = new FormData();
  form.set("userId", invitation.userId);
  return form;
}

describe("account invitation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.createInvitedUser.mockResolvedValue(invitation);
    mocks.resendInvitation.mockResolvedValue(invitation);
    mocks.recordDelivery.mockResolvedValue(true);
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
      role: "COMPANY_ADMIN",
      companyId: actor.companyId,
      preferredLocale: "ar",
      permissions: undefined,
    }), actor);
    expect(mocks.sendEmail).toHaveBeenCalledWith(invitation);
    expect(mocks.recordDelivery).toHaveBeenCalledWith(invitation.invitationId, {
      succeeded: true,
      providerMessageId: undefined,
      status: "sent",
    });
  });

  it("does not turn unchanged role defaults into explicit permission overrides", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    const form = userForm();
    form.append("permissions", "dashboard.view");
    form.append("permissions", "company.view");
    form.set("permissionsCustomized", "false");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-invited",
    );

    expect(mocks.createInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: undefined }),
      actor,
    );
  });

  it("passes only an explicitly customized permission selection", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    const form = userForm();
    form.append("permissions", "dashboard.view");
    form.append("permissions", "company.view");
    form.set("permissionsCustomized", "true");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-invited",
    );

    expect(mocks.createInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: ["dashboard.view", "company.view"],
      }),
      actor,
    );
  });

  it("shows controlled feedback when a customized access set is unavailable", async () => {
    const form = userForm();
    form.set("permissionsCustomized", "true");
    form.append("permissions", "dashboard.view");
    mocks.createInvitedUser.mockRejectedValue(
      new mocks.AccessUnavailableError(),
    );

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-permission-selection-unavailable",
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects the removed supplier actor before creating an account", async () => {
    const form = new FormData();
    form.set("email", "supplier.user@example.test");
    form.set("displayName", "Supplier User");
    form.set("role", "SUPPLIER_USER");
    form.set("supplierId", "30000000-0000-4000-8000-000000000001");
    form.set("preferredLocale", "ms");
    await expect(createUserAction(form)).rejects.toThrow();
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
  });

  it("rejects an unsupported invitation language before creating an account", async () => {
    const form = userForm();
    form.set("preferredLocale", "xx");
    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-creation-invalid",
    );
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps invalid company-user feedback inside the fixed company workspace", async () => {
    const form = userForm();
    form.set("creationContext", "COMPANY");
    form.set("preferredLocale", "xx");

    await expect(createUserAction(form)).rejects.toThrow(
      `REDIRECT:/companies/${actor.companyId}/users?notice=user-creation-invalid`,
    );
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
  });

  it("creates delivery workforce identities only from the delivery workspace", async () => {
    const owner = {
      ...actor,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      isOwner: true,
    };
    mocks.requirePermission.mockResolvedValue(owner);
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    const form = new FormData();
    form.set("creationContext", "DELIVERY");
    form.set("email", "driver@example.test");
    form.set("displayName", "Delivery Driver");
    form.set("role", "DELIVERY_GUY");
    form.set("preferredLocale", "ms");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/deliveries?notice=user-invited",
    );
    expect(mocks.createInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: "DELIVERY_GUY" }),
      owner,
    );
  });

  it("rejects a delivery identity forged into the Axora Users workspace", async () => {
    mocks.requirePermission.mockResolvedValue({
      ...actor,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      isOwner: true,
    });
    const form = new FormData();
    form.set("creationContext", "PLATFORM");
    form.set("email", "driver@example.test");
    form.set("displayName", "Delivery Driver");
    form.set("role", "DELIVERY_GUY");
    form.set("preferredLocale", "en");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-creation-invalid",
    );
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
  });

  it("keeps protected Platform Owner permissions on canonical defaults", async () => {
    mocks.requirePermission.mockResolvedValue({
      ...actor,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      isOwner: true,
    });
    const form = new FormData();
    form.set("creationContext", "PLATFORM");
    form.set("email", "second-owner@example.test");
    form.set("displayName", "Second Owner");
    form.set("role", "PLATFORM_OWNER");
    form.set("preferredLocale", "en");
    form.set("permissionsCustomized", "true");
    form.append("permissions", "dashboard.view");

    await expect(createUserAction(form)).rejects.toThrow(
      "REDIRECT:/users?notice=user-creation-invalid",
    );
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
  });

  it("rejects owner-only wallet recording on a company identity", async () => {
    mocks.requirePermission.mockResolvedValue({
      ...actor,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      isOwner: true,
    });
    const form = userForm();
    form.set("creationContext", "COMPANY");
    form.set("permissionsCustomized", "true");
    form.append("permissions", "finance.wallet.top_up.record");

    await expect(createUserAction(form)).rejects.toThrow(
      `REDIRECT:/companies/${actor.companyId}/users?notice=user-creation-invalid`,
    );
    expect(mocks.createInvitedUser).not.toHaveBeenCalled();
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

  it("delegates exact target authorization to the resend transaction", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });

    await expect(resendAccountSetupInvitationAction(
      { status: "idle" }, resendForm(),
    )).resolves.toEqual({ status: "success", code: "sent" });

    expect(mocks.resendInvitation).toHaveBeenCalledWith(invitation.userId, actor);
    expect(mocks.sendEmail).toHaveBeenCalledWith(invitation);
  });

  it("shows a safe notice when invitations are resent too quickly", async () => {
    mocks.resendInvitation.mockRejectedValue(new mocks.ResendRateLimitError("cooldown"));

    await expect(resendAccountSetupInvitationAction(
      { status: "idle" }, resendForm(),
    )).resolves.toEqual({ status: "error", code: "cooldown" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reports the company-wide invitation quota during resend", async () => {
    mocks.resendInvitation.mockRejectedValue(new mocks.InvitationQuotaError("company"));

    await expect(resendAccountSetupInvitationAction(
      { status: "idle" }, resendForm(),
    )).resolves.toEqual({ status: "error", code: "quota" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("queues one logical email when concurrent stale resends race", async () => {
    mocks.sendEmail.mockResolvedValue({ succeeded: true, status: "sent" });
    mocks.resendInvitation
      .mockResolvedValueOnce(invitation)
      .mockRejectedValueOnce(new mocks.ResendEligibilityError("pending"));

    const results = await Promise.all([
      resendAccountSetupInvitationAction({ status: "idle" }, resendForm()),
      resendAccountSetupInvitationAction({ status: "idle" }, resendForm()),
    ]);

    expect(results).toEqual(expect.arrayContaining([
      { status: "success", code: "sent" },
      { status: "error", code: "pending" },
    ]));
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
  });
});
