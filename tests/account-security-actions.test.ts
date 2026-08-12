import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PasswordPolicyError extends Error {}
  return {
    PasswordPolicyError,
    requireSession: vi.fn(),
    setSession: vi.fn(),
    changeOwnPassword: vi.fn(),
    revokeOtherSession: vi.fn(),
    revokeAllOtherSessions: vi.fn(),
    requestEmailVerification: vi.fn(),
    headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.55" })),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/account-security", () => ({
  changeOwnPassword: mocks.changeOwnPassword,
  revokeOtherSession: mocks.revokeOtherSession,
  revokeAllOtherSessions: mocks.revokeAllOtherSessions,
}));
vi.mock("@/lib/auth", () => ({
  requireAccountLifecycleSession: mocks.requireSession,
  setSession: mocks.setSession,
}));
vi.mock("@/lib/password-policy", () => ({
  PasswordPolicyError: mocks.PasswordPolicyError,
}));
vi.mock("@/lib/security-notifications", () => ({
  requestEmailVerification: mocks.requestEmailVerification,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  changePasswordAction,
  resendEmailVerificationAction,
  revokeAllOtherSessionsAction,
  revokeSessionAction,
} from "@/app/(portal)/account/actions";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.test",
  name: "Person",
  role: "AUDITOR",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
  authVersion: 4,
};

function passwordForm() {
  const form = new FormData();
  form.set("currentPassword", "current memorable password");
  form.set("newPassword", "a sufficiently long replacement password");
  form.set("confirmPassword", "a sufficiently long replacement password");
  return form;
}

describe("account security server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(actor);
    mocks.setSession.mockResolvedValue(undefined);
  });

  it("uses one generic response for an incorrect current password", async () => {
    mocks.changeOwnPassword.mockResolvedValue({ status: "invalid_current" });
    await expect(changePasswordAction(passwordForm()))
      .rejects.toThrow("REDIRECT:/account?security=change-failed");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("renews only the current browser after auth_version rotation", async () => {
    mocks.changeOwnPassword.mockResolvedValue({ status: "changed", authVersion: 5 });
    await expect(changePasswordAction(passwordForm()))
      .rejects.toThrow("REDIRECT:/account?security=password-changed");
    expect(mocks.setSession).toHaveBeenCalledWith({ ...actor, authVersion: 5 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("requires a fresh sign-in if renewing the post-change session fails", async () => {
    mocks.changeOwnPassword.mockResolvedValue({ status: "changed", authVersion: 5 });
    mocks.setSession.mockRejectedValue(new Error("session store unavailable"));
    await expect(changePasswordAction(passwordForm()))
      .rejects.toThrow("REDIRECT:/login?reset=complete");
    expect(mocks.redirect.mock.calls.flat()).not.toContain(
      "/account?security=change-failed",
    );
  });

  it("scopes individual and bulk session revocation to repository helpers", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000002";
    const form = new FormData();
    form.set("sessionId", sessionId);
    mocks.revokeOtherSession.mockResolvedValue(true);
    await expect(revokeSessionAction(form))
      .rejects.toThrow("REDIRECT:/account?security=session-revoked");
    expect(mocks.revokeOtherSession).toHaveBeenCalledWith(actor, sessionId);

    mocks.revokeAllOtherSessions.mockResolvedValue(2);
    await expect(revokeAllOtherSessionsAction())
      .rejects.toThrow("REDIRECT:/account?security=sessions-revoked");
    expect(mocks.revokeAllOtherSessions).toHaveBeenCalledWith(actor);
  });

  it("queues verification for only the signed-in address", async () => {
    const form = new FormData();
    form.set("locale", "ar");
    mocks.requestEmailVerification.mockResolvedValue({ accepted: true });
    await expect(resendEmailVerificationAction(form))
      .rejects.toThrow("REDIRECT:/account?security=verification-sent");
    expect(mocks.requestEmailVerification).toHaveBeenCalledWith(
      actor.id,
      actor.email,
      "ar",
      "203.0.113.55",
    );
  });



});
