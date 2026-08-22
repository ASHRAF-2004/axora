import { describe,expect,it } from "vitest";
import { requestFilterMessages } from "../src/lib/request-filter-i18n";
import { shopMessages } from "../src/lib/shop-i18n";

describe("procurement discovery localization",() => {
  it("provides request and complete-catalogue controls in every supported locale",() => {
    for (const locale of ["en","ar","ms"] as const) {
      const filters=requestFilterMessages(locale);
      const shop=shopMessages(locale);
      expect(filters.title).toBeTruthy();
      expect(filters.search).toBeTruthy();
      expect(filters.status).toBeTruthy();
      expect(Object.keys(filters)).not.toContain("company");
      expect(Object.keys(filters)).not.toContain("advanced");
      expect(shop.seeAllProducts).toBeTruthy();
      expect(shop.allProducts).toBeTruthy();
      expect(shop.pageStatus(2,4)).toBeTruthy();
    }
  });
});
