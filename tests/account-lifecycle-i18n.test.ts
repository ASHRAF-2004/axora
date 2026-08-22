import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LIFECYCLE_MESSAGES,
  accountLifecycleMessages,
  formatAccountDateTime,
} from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { persistBrowserLocale } from "@/lib/i18n";

describe("account lifecycle localization", () => {
  it("provides complete typed account and recovery copy for every supported locale", () => {
    expect(Object.keys(ACCOUNT_LIFECYCLE_MESSAGES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      const copy = accountLifecycleMessages(locale);
      expect(copy.account.title).toBeTruthy();
      expect(copy.forgot.submit).toBeTruthy();
      expect(copy.reset.errors.password_mismatch).toBeTruthy();
      expect(copy.verify.verifiedBody).toBeTruthy();
      expect(copy.account.passwordHelp).toBeTruthy();
    }
  });

  it("marks Arabic RTL while English and Malay remain LTR", () => {
    expect(LOCALE_NAMES.ar.dir).toBe("rtl");
    expect(LOCALE_NAMES.en.dir).toBe("ltr");
    expect(LOCALE_NAMES.ms.dir).toBe("ltr");
  });

  it("persists a token-selected locale and updates document language direction", () => {
    const documentElement = { lang: "en", dir: "ltr" };
    const cookies: string[] = [];
    persistBrowserLocale("ar", {
      documentElement,
      protocol: "https:",
      writeCookie: (value) => cookies.push(value),
    });
    expect(documentElement).toEqual({ lang: "ar", dir: "rtl" });
    expect(cookies[0]).toContain("axora_locale=ar");
    expect(cookies[0]).toContain("; Secure");
  });

  it("formats account timestamps using the saved locale and timezone", () => {
    const value = "2026-08-02T12:00:00.000Z";
    expect(formatAccountDateTime(value, "en", "Asia/Kuala_Lumpur")).toContain("8:00");
    expect(formatAccountDateTime(value, "ms", "UTC")).toContain("12:00");
  });
});
