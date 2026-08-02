import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TokenError extends Error {}
  class PasswordPolicyError extends Error {}
  return {
    TokenError,
    PasswordPolicyError,
    consume: vi.fn(),
    inspect: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/account-setup", () => ({
  AccountSetupTokenError: mocks.TokenError,
  consumeAccountSetupToken: mocks.consume,
  inspectAccountSetupToken: mocks.inspect,
}));

vi.mock("@/lib/password-policy", () => ({
  PasswordPolicyError: mocks.PasswordPolicyError,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import {
  completeAccountSetupAction,
  inspectAccountSetupTokenAction,
} from "@/app/account/setup/actions";

const rawToken = "A".repeat(43);
const initialState = { status: "idle" as const };

function passwordForm(password: string, confirmation = password) {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmPassword", confirmation);
  return form;
}

describe("public account setup action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consume.mockResolvedValue({ id: "user-id" });
  });

  it("inspects the fragment token through a server action without redirecting", async () => {
    mocks.inspect.mockResolvedValue({
      valid: true,
      recipientName: "New User",
      recipientEmail: "new@example.test",
      companyName: "Example Company",
      expiresAt: "2026-08-03T00:00:00.000Z",
      locale: "ms",
    });

    await expect(inspectAccountSetupTokenAction(rawToken)).resolves.toEqual({
      status: "valid",
      recipientName: "New User",
      recipientEmail: "new@example.test",
      companyName: "Example Company",
      expiresAt: "2026-08-03T00:00:00.000Z",
      locale: "ms",
    });
    expect(mocks.inspect).toHaveBeenCalledWith(rawToken);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("consumes the single-use token then sends the recipient to sign in", async () => {
    const password = "correct horse battery staple";

    await expect(
      completeAccountSetupAction(rawToken, initialState, passwordForm(password)),
    ).rejects.toThrow("REDIRECT:/login?setup=complete");

    expect(mocks.consume).toHaveBeenCalledWith(rawToken, password);
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain(rawToken);
  });

  it("returns an inline error without a token-bearing redirect when confirmation differs", async () => {
    const result = await completeAccountSetupAction(
      rawToken,
      initialState,
      passwordForm("correct horse battery staple", "different secure phrase"),
    );

    expect(result).toEqual({
      status: "error",
      code: "password_mismatch",
    });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns a stable safe validation code regardless of requested locale", async () => {
    const form = passwordForm("correct horse battery staple", "different secure phrase");
    form.set("locale", "ms");
    const result = await completeAccountSetupAction(rawToken, initialState, form);
    expect(result).toEqual({
      status: "error",
      code: "password_mismatch",
    });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("returns an inline invalid-link state for an expired or used token", async () => {
    mocks.consume.mockRejectedValue(new mocks.TokenError());

    const result = await completeAccountSetupAction(
      rawToken,
      initialState,
      passwordForm("correct horse battery staple"),
    );

    expect(result.status).toBe("invalid");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
