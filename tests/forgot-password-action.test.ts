import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.42" })),
  setCookie: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/security-notifications", () => ({
  requestPasswordReset: mocks.requestPasswordReset,
}));
vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: vi.fn(async () => ({ set: mocks.setCookie })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requestPasswordResetAction } from "@/app/account/forgot-password/actions";

function requestForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("locale", "ms");
  return form;
}

describe("forgot-password public response", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["known@example.test", "unknown@example.test"])(
    "uses the same response for %s",
    async (email) => {
      mocks.requestPasswordReset.mockResolvedValue({ accepted: true });
      await expect(requestPasswordResetAction(requestForm(email)))
        .rejects.toThrow("REDIRECT:/account/forgot-password?requested=1&locale=ms");
      expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
        email,
        "203.0.113.42",
        "ms",
      );
    },
  );

  it("keeps the same response for validation, throttling, or backend failure", async () => {
    mocks.requestPasswordReset.mockRejectedValue(new Error("private backend category"));
    await expect(requestPasswordResetAction(requestForm("malformed")))
      .rejects.toThrow("REDIRECT:/account/forgot-password?requested=1&locale=ms");
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("private backend category");
  });
});
