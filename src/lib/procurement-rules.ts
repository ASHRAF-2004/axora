import { roundMoney } from "./domain";
import type { Product } from "./types";

export const DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE = 10;
export const MAX_COMMERCIAL_MARKUP_PERCENTAGE = 100;

export function calculateCommercialSellingPrice(
  baseCost: number,
  markupPercentage = DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE,
) {
  if (!Number.isFinite(baseCost) || baseCost < 0) {
    throw new Error("Base cost must be a non-negative finite amount.");
  }
  if (!Number.isFinite(markupPercentage) || markupPercentage < 0
    || markupPercentage > MAX_COMMERCIAL_MARKUP_PERCENTAGE) {
    throw new Error("Markup percentage must be between 0 and 100.");
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
  const markupPercentage = product.customerMarkupPercentage
    ?? DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE;
  return {
    ...product,
    customerMarkupPercentage: markupPercentage,
    defaultSellPrice: calculateCommercialSellingPrice(product.defaultBuyPrice, markupPercentage),
    priceRuleVersion: product.priceRuleVersion ?? 1,
    priceCurrency: product.priceCurrency ?? "MYR",
  };
}
