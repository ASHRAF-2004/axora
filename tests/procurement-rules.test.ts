import { describe, expect, it } from "vitest";
import {
  calculateCommercialSellingPrice,
  productPriceChanged,
  productQuantityRule,
  quantityMatchesProductRule,
} from "@/lib/procurement-rules";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";

const product = {
  minimumOrderQuantity: 5,
  maximumOrderQuantity: 20,
  orderIncrement: 5,
  packSize: 10,
  packUnit: "pieces",
  unit: "carton",
  quantityRuleVersion: 3,
};

describe("supplier-product quantity and commercial rules", () => {
  it("accepts boundaries and increments while rejecting gaps and overflow", () => {
    expect(productQuantityRule(product)).toMatchObject({ minimum: 5, maximum: 20, increment: 5 });
    expect(quantityMatchesProductRule(5, product)).toBe(true);
    expect(quantityMatchesProductRule(10, product)).toBe(true);
    expect(quantityMatchesProductRule(20, product)).toBe(true);
    expect(quantityMatchesProductRule(4, product)).toBe(false);
    expect(quantityMatchesProductRule(6, product)).toBe(false);
    expect(quantityMatchesProductRule(21, product)).toBe(false);
    expect(quantityMatchesProductRule(5.5, product)).toBe(false);
  });

  it("uses a deterministic 10 percent rule and rejects negative inputs", () => {
    expect(calculateCommercialSellingPrice(10)).toBe(11);
    expect(calculateCommercialSellingPrice(10.05)).toBe(11.06);
    expect(calculateCommercialSellingPrice(0)).toBe(0);
    expect(() => calculateCommercialSellingPrice(-0.01)).toThrow("non-negative");
  });

  it("detects changed price values or rule versions", () => {
    expect(productPriceChanged(
      { defaultSellPrice: 11, priceRuleVersion: 1 },
      { defaultSellPrice: 11, priceRuleVersion: 2 },
    )).toBe(true);
    expect(productPriceChanged(
      { defaultSellPrice: 11, priceRuleVersion: 2 },
      { defaultSellPrice: 11, priceRuleVersion: 2 },
    )).toBe(false);
  });

  it("publishes quantity, pack, and price-change guidance in every locale", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = procurementRulesMessages(locale);
      expect(copy.quantitySummary(productQuantityRule(product))).toContain("5");
      expect(copy.packSummary(10, "pieces")).toContain("10");
      expect(copy.priceChangedBody(2)).toContain("2");
      expect(copy.acknowledgePrices.length).toBeGreaterThan(10);
    }
  });
});
