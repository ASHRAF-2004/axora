import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PUBLIC_PAGE_SLUGS, SUPPORTED_LOCALES } from "@/lib/i18n";

describe("public discovery metadata", () => {
  it("publishes each localized public route with language alternates", () => {
    const entries = sitemap();
    expect(entries).toHaveLength(SUPPORTED_LOCALES.length * (PUBLIC_PAGE_SLUGS.length + 2));

    const arabicProcess = entries.find((entry) => entry.url === "https://axora.management/ar/procurement-process");
    expect(arabicProcess?.alternates?.languages).toEqual({
      en: "https://axora.management/en/procurement-process",
      ar: "https://axora.management/ar/procurement-process",
      ms: "https://axora.management/ms/procurement-process",
      "x-default": "https://axora.management/en/procurement-process",
    });
  });

  it("allows public discovery while excluding authentication and portal routes", () => {
    const policy = robots();
    expect(policy.sitemap).toBe("https://axora.management/sitemap.xml");
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const wildcard = rules.find((rule) => rule.userAgent === "*");
    expect(wildcard?.allow).toContain("/");
    expect(wildcard?.disallow).toEqual(expect.arrayContaining(["/login", "/dashboard", "/api/"]));
  });
});
