import { describe, expect, it } from "vitest";
import {
  isSupportedLocale,
  LOCALE_NAMES,
  nearestSupportedLocale,
  parseAcceptLanguage,
  PUBLIC_MESSAGES,
  PUBLIC_PAGE_SLUGS,
  SUPPORTED_LOCALES,
} from "@/lib/i18n";
import { PORTAL_MESSAGES } from "@/lib/portal-i18n";

describe("locale selection and public dictionaries", () => {
  it("orders browser language preferences by quality", () => {
    expect(parseAcceptLanguage("fr-CA;q=0.7, ar-MY;q=0.9, en;q=0.8"))
      .toEqual(["ar-MY", "en", "fr-CA"]);
  });

  it("handles quality parameters case-insensitively and rejects invalid ranges", () => {
    expect(parseAcceptLanguage("ms-MY;Q=0.8, ar;q=1.1, en;q=0, fr"))
      .toEqual(["fr", "ms-MY"]);
  });

  it("selects the nearest supported browser language", () => {
    expect(nearestSupportedLocale(["ar-MY", "en-US"])).toBe("ar");
    expect(nearestSupportedLocale(["ms-MY"])).toBe("ms");
    expect(nearestSupportedLocale(["fr-FR", "de-DE"])).toBe("en");
  });

  it("does not treat unsupported or partial values as explicit locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(false);
    expect(isSupportedLocale("fr")).toBe(false);
  });

  it("declares RTL only for Arabic", () => {
    expect(LOCALE_NAMES.ar.dir).toBe("rtl");
    expect(LOCALE_NAMES.en.dir).toBe("ltr");
    expect(LOCALE_NAMES.ms.dir).toBe("ltr");
  });

  it("provides every public route and critical action in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dictionary = PUBLIC_MESSAGES[locale];
      expect(dictionary.nav.login.length).toBeGreaterThan(0);
      expect(dictionary.nav.contact.length).toBeGreaterThan(0);
      expect(dictionary.contact.submit.length).toBeGreaterThan(0);
      expect(dictionary.home.stages).toHaveLength(9);
      for (const slug of PUBLIC_PAGE_SLUGS) {
        expect(dictionary.pages[slug].title.length).toBeGreaterThan(0);
        expect(dictionary.pages[slug].sections.length).toBeGreaterThan(0);
      }
    }
  });

  it("localizes the authenticated shell, principal roles, and navigation", () => {
    const requiredRoles = [
      "PLATFORM_OWNER", "PLATFORM_OPERATIONS", "COMPANY_ADMIN", "BRANCH_ADMIN",
      "BRANCH_APPROVER", "COMPANY_APPROVER", "REQUESTER", "FINANCE_REVIEWER",
      "AUDITOR", "TECHNICAL_SUPPORT", "SUPPLIER_USER", "DELIVERY_DRIVER",
      "RECEIVING_USER",
    ];
    const requiredRoutes = [
      "/dashboard", "/products", "/requests", "/approvals", "/sourcing",
      "/deliveries", "/finance", "/companies", "/branches", "/suppliers",
      "/users", "/documents", "/reports", "/audit", "/support", "/settings", "/help",
      "/supplier", "/driver", "/receiving",
    ];
    for (const locale of SUPPORTED_LOCALES) {
      const dictionary = PORTAL_MESSAGES[locale];
      expect(dictionary.shell.language.length).toBeGreaterThan(0);
      expect(dictionary.tutorial.skipStep.length).toBeGreaterThan(0);
      expect(dictionary.tutorial.stepOf(2, 5)).toContain("2");
      for (const role of requiredRoles) expect(dictionary.roles[role]?.length).toBeGreaterThan(0);
      for (const route of requiredRoutes) expect(dictionary.navigation[route]?.label.length).toBeGreaterThan(0);
    }
  });
});
