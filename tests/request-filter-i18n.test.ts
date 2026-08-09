import { describe,expect,it } from "vitest";
import { requestFilterMessages } from "../src/lib/request-filter-i18n";
import { shopMessages } from "../src/lib/shop-i18n";

describe("procurement discovery localization",() => {
  it("provides request and complete-catalogue controls in every supported locale",() => {
    for (const locale of ["en","ar","ms"] as const) {
      const filters=requestFilterMessages(locale);
      const shop=shopMessages(locale);
      expect(filters.title).toBeTruthy();
      expect(filters.company).toBeTruthy();
      expect(filters.deliveryAgent).toBeTruthy();
      expect(filters.budgetStatuses.COMPANY_CEILING).toBeTruthy();
      expect(shop.seeAllProducts).toBeTruthy();
      expect(shop.allProducts).toBeTruthy();
      expect(shop.pageStatus(2,4)).toBeTruthy();
    }
  });
});
