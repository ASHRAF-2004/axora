import { describe, expect, it, vi } from "vitest";
import { readAndClearSetupTokenFragment } from "@/components/AccountSetupClient";

describe("account setup fragment transport", () => {
  it("removes the bearer token and generates only a token-free request route", () => {
    const rawToken = "A".repeat(43);
    const replaceState = vi.fn();

    const extracted = readAndClearSetupTokenFragment({
      hash: `#token=${rawToken}`,
      pathname: "/account/setup",
    }, {
      state: { navigation: "email" },
      replaceState,
    });

    expect(extracted).toBe(rawToken);
    expect(replaceState).toHaveBeenCalledWith(
      { navigation: "email" },
      "",
      "/account/setup",
    );
    const generatedRoutes = replaceState.mock.calls.map((call) => String(call[2]));
    expect(generatedRoutes).toEqual(["/account/setup"]);
    expect(JSON.stringify(generatedRoutes)).not.toContain(rawToken);
    expect(JSON.stringify(generatedRoutes)).not.toContain("token=");
  });

  it("rejects malformed or ambiguous fragments after clearing them", () => {
    const replaceState = vi.fn();
    const extracted = readAndClearSetupTokenFragment({
      hash: `#token=${"A".repeat(43)}&token=${"B".repeat(43)}`,
      pathname: "/account/setup",
    }, {
      state: null,
      replaceState,
    });

    expect(extracted).toBe("");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/account/setup");
  });
});
