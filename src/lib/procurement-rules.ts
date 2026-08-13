import { roundMoney } from "./domain";
import type { Product } from "./types";

export const DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE = 10;

export function calculateCommercialSellingPrice(
  baseCost: number,
  markupPercentage = DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE,
) {
  if (!Number.isFinite(baseCost) || baseCost < 0) {
    throw new Error("Base cost must be a non-negative finite amount.");
  }
  if (!Number.isFinite(markupPercentage) || markupPercentage < 0) {
    throw new Error("Markup percentage must be non-negative and finite.");
  }
  return roundMoney(baseCost * (1 + markupPercentage / 100));
}

export function productPriceChanged(
  stored: Pick<Product, "defaultSellPrice" | "priceRuleVersion">,
  current: Pick<Product, "defaultSellPrice" | "priceRuleVersion">,
) {
  return roundMoney(stored.defaultSellPrice) !== roundMoney(current.defaultSellPrice)
    || (stored.priceRuleVersion ?? 0) !== (current.priceRuleVersion ?? 0);
}

export function withDemoCommercialDefaults(product: Product): Product {
  return {
    ...product,
    defaultSellPrice: calculateCommercialSellingPrice(product.defaultBuyPrice),
    priceRuleVersion: product.priceRuleVersion ?? 1,
    priceCurrency: product.priceCurrency ?? "MYR",
  };
}
