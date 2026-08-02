import { describe, expect, it, vi } from "vitest";
import { readAndClearSecurityTokenFragment } from "@/lib/security-token-fragment";

describe("password reset and email verification fragment hygiene", () => {
  it.each([
    "/account/reset-password",
    "/account/verify-email",
  ])("removes the bearer before any server action on %s", (pathname) => {
    const rawToken = "S".repeat(43);
    const replaceState = vi.fn();
    const extracted = readAndClearSecurityTokenFragment({
      hash: `#token=${rawToken}`,
      pathname,
    }, { state: { source: "email" }, replaceState });
    expect(extracted).toBe(rawToken);
    expect(replaceState).toHaveBeenCalledWith({ source: "email" }, "", pathname);
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(rawToken);
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("token=");
  });

  it("clears and rejects ambiguous fragments", () => {
    const replaceState = vi.fn();
    const extracted = readAndClearSecurityTokenFragment({
      hash: `#token=${"A".repeat(43)}&token=${"B".repeat(43)}`,
      pathname: "/account/reset-password",
    }, { state: null, replaceState });
    expect(extracted).toBe("");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/account/reset-password");
  });
});
