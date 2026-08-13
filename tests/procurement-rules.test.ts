import { describe, expect, it } from "vitest";
import {
  calculateCommercialSellingPrice,
  productPriceChanged,
} from "@/lib/procurement-rules";

describe("commercial pricing rules", () => {
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

});
