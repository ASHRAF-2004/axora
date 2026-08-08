import { roundMoney } from "./domain";
import type { Product } from "./types";

export const DEFAULT_COMMERCIAL_MARKUP_PERCENTAGE = 10;

export interface ProductQuantityRule {
  minimum: number;
  maximum?: number;
  increment: number;
  packSize: number;
  packUnit: string;
  version: number;
}

function positiveWhole(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) >= 1
    ? Math.ceil(Number(value))
    : fallback;
}

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

export function productQuantityRule(
  product: Pick<
    Product,
    | "minimumOrderQuantity"
    | "maximumOrderQuantity"
    | "orderIncrement"
    | "packSize"
    | "packUnit"
    | "unit"
    | "quantityRuleVersion"
  >,
): ProductQuantityRule {
  const minimum = positiveWhole(product.minimumOrderQuantity, 1);
  const maximum = product.maximumOrderQuantity === undefined
    ? undefined
    : positiveWhole(product.maximumOrderQuantity, minimum);

  return {
    minimum,
    maximum,
    increment: positiveWhole(product.orderIncrement, 1),
    packSize: positiveWhole(product.packSize, 1),
    packUnit: product.packUnit?.trim() || product.unit,
    version: Math.max(Math.floor(product.quantityRuleVersion ?? 0), 0),
  };
}

export function quantityMatchesProductRule(
  quantity: number,
  product: Parameters<typeof productQuantityRule>[0],
) {
  const rule = productQuantityRule(product);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) return false;
  if (quantity < rule.minimum) return false;
  if (rule.maximum !== undefined && quantity > rule.maximum) return false;
  return (quantity - rule.minimum) % rule.increment === 0;
}

export function productPriceChanged(
  stored: Pick<Product, "defaultSellPrice" | "priceRuleVersion">,
  current: Pick<Product, "defaultSellPrice" | "priceRuleVersion">,
) {
  return roundMoney(stored.defaultSellPrice) !== roundMoney(current.defaultSellPrice)
    || (stored.priceRuleVersion ?? 0) !== (current.priceRuleVersion ?? 0);
}

export function withDemoCommercialDefaults(product: Product): Product {
  const rule = productQuantityRule(product);
  return {
    ...product,
    defaultSellPrice: calculateCommercialSellingPrice(product.defaultBuyPrice),
    minimumOrderQuantity: rule.minimum,
    maximumOrderQuantity: rule.maximum,
    orderIncrement: rule.increment,
    packSize: rule.packSize,
    packUnit: rule.packUnit,
    quantityRuleVersion: rule.version || 1,
    priceRuleVersion: product.priceRuleVersion ?? 1,
    priceCurrency: product.priceCurrency ?? "MYR",
  };
}
