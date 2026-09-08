import { describe, expect, it } from "vitest";
import {
  calculateCommercialSellingPrice,
  productPriceChanged,
} from "@/lib/procurement-rules";

describe("commercial pricing rules", () => {
  it("uses the configured percentage once and rejects invalid values", () => {
    expect(calculateCommercialSellingPrice(10)).toBe(11);
    expect(calculateCommercialSellingPrice(10.05)).toBe(11.06);
    expect(calculateCommercialSellingPrice(0)).toBe(0);
    expect(calculateCommercialSellingPrice(100, 0)).toBe(100);
    expect(calculateCommercialSellingPrice(100, 10.5)).toBe(110.5);
    expect(calculateCommercialSellingPrice(100, 100)).toBe(200);
    expect(() => calculateCommercialSellingPrice(-0.01)).toThrow("non-negative");
    expect(() => calculateCommercialSellingPrice(100, -0.01)).toThrow("between 0 and 100");
    expect(() => calculateCommercialSellingPrice(100, 100.01)).toThrow("between 0 and 100");
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

});
