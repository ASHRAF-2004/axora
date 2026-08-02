import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class SecurityTokenError extends Error {}
  class PasswordPolicyError extends Error {}
  return {
    SecurityTokenError,
    PasswordPolicyError,
    inspectReset: vi.fn(),
    consumeReset: vi.fn(),
    consumeVerification: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/security-notifications", () => ({
  SecurityTokenError: mocks.SecurityTokenError,
  inspectPasswordResetToken: mocks.inspectReset,
  consumePasswordResetToken: mocks.consumeReset,
  consumeEmailVerificationToken: mocks.consumeVerification,
}));
vi.mock("@/lib/password-policy", () => ({
  PasswordPolicyError: mocks.PasswordPolicyError,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  completePasswordResetAction,
  inspectPasswordResetTokenAction,
} from "@/app/account/reset-password/actions";
import { verifyEmailTokenAction } from "@/app/account/verify-email/actions";

const rawToken = "T".repeat(43);
const initial = { status: "idle" as const };

function passwordForm(password: string, confirmation = password) {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmPassword", confirmation);
  return form;
}

describe("single-use account security link actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inspects a reset link without reflecting the token", async () => {
    mocks.inspectReset.mockResolvedValue({ valid: true, locale: "ar" });
    await expect(inspectPasswordResetTokenAction(rawToken)).resolves.toEqual({ status: "valid", locale: "ar" });
    expect(mocks.inspectReset).toHaveBeenCalledWith(rawToken);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("consumes a reset token and redirects without placing it in the URL", async () => {
    const password = "a memorable replacement password";
    mocks.consumeReset.mockResolvedValue({ completed: true });
    await expect(completePasswordResetAction(
      rawToken,
      initial,
      passwordForm(password),
    )).rejects.toThrow("REDIRECT:/login?reset=complete");
    expect(mocks.consumeReset).toHaveBeenCalledWith(rawToken, password);
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain(rawToken);
  });

  it("does not consume when new-password confirmation differs", async () => {
    await expect(completePasswordResetAction(
      rawToken,
      initial,
      passwordForm("a memorable replacement password", "a different replacement password"),
    )).resolves.toMatchObject({ status: "error" });
    await expect(completePasswordResetAction(
      rawToken,
      initial,
      passwordForm("a memorable replacement password", "a different replacement password"),
    )).resolves.toEqual({ status: "error", code: "password_mismatch" });
    expect(mocks.consumeReset).not.toHaveBeenCalled();
  });

  it("returns one invalid state for expired, used, or replaced reset links", async () => {
    mocks.consumeReset.mockRejectedValue(new mocks.SecurityTokenError());
    await expect(completePasswordResetAction(
      rawToken,
      initial,
      passwordForm("a memorable replacement password"),
    )).resolves.toMatchObject({ status: "invalid" });
  });

  it("consumes email verification once and normalizes invalid links", async () => {
    mocks.consumeVerification.mockResolvedValueOnce({ verified: true, locale: "ms" });
    await expect(verifyEmailTokenAction(rawToken)).resolves.toEqual({ status: "verified", locale: "ms" });
    mocks.consumeVerification.mockRejectedValueOnce(new mocks.SecurityTokenError());
    await expect(verifyEmailTokenAction(rawToken)).resolves.toEqual({ status: "invalid" });
  });
});
