import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasswordField } from "@/components/PasswordField";
import { ACCOUNT_LIFECYCLE_MESSAGES } from "@/lib/account-lifecycle-i18n";

describe("password policy user experience", () => {
  it("renders an accessible visibility control without disabling paste or truncating input", () => {
    const html = renderToStaticMarkup(createElement(PasswordField, {
      id: "test-new-password",
      name: "password",
      label: "New password",
      showLabel: "Show password",
      hideLabel: "Hide password",
      autoComplete: "new-password",
      describedBy: "password-help",
      enforceNewPasswordPolicy: true,
      tooShortMessage: "Use at least 15 Unicode characters.",
      tooLongMessage: "Use no more than 128 Unicode characters.",
    }));

    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-controls="test-new-password"');
    expect(html).not.toContain("maxlength");
    expect(html).not.toContain("onpaste");
  });

  it("keeps setup, reset, and account guidance aligned in every locale", async () => {
    for (const copy of Object.values(ACCOUNT_LIFECYCLE_MESSAGES)) {
      const surfaces = JSON.stringify({
        reset: copy.reset,
        account: copy.account,
      });
      expect(surfaces).toContain("15");
      expect(surfaces).toContain("128");
      expect(surfaces).not.toMatch(/72\s*(?:UTF-8|bait|بايت)/i);
      expect(copy.reset.showPassword).not.toBe(copy.reset.hidePassword);
      expect(copy.account.showPassword).not.toBe(copy.account.hidePassword);
    }

    const setupSource = await readFile(new URL(
      "../src/components/AccountSetupClient.tsx",
      import.meta.url,
    ), "utf8");
    expect(setupSource).toContain("<PasswordField");
    expect(setupSource).toContain("Paste and password managers are supported.");
    expect(setupSource).not.toMatch(/(?:14 characters|14 aksara|14 حرف|72 UTF-8|72 bait|72 بايت)/);
  });
});
