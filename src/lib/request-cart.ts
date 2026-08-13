import type { Product } from "@/lib/types";
import { productPriceChanged } from "./procurement-rules";
import {
  scopedBrowserStorageKey,
  type BrowserSessionScope,
} from "./browser-session-scope";

const LEGACY_REQUEST_CART_STORAGE_KEY = "axora-request-cart:v1";
const REQUEST_CART_STORAGE_PREFIX = "axora-request-cart:v2";
export const REQUEST_CART_EVENT = "axora-request-cart-change";

export interface RequestCartProduct {
  id: string;
  code: string;
  name: string;
  category: string;
  subcategory: string;
  brand?: string;
  size?: string;
  unit: string;
  defaultSellPrice: number;
  priceRuleVersion?: number;
  priceEffectiveFrom?: string;
  priceChangedAt?: string;
  priceCurrency?: string;
  deliverySlaDays: number;
  hasImage: boolean;
  imageAltText?: string;
}

export interface RequestCartItem {
  product: RequestCartProduct;
  quantity: number;
  specification: string;
}

export function minimumCartQuantity(
  product: Product,
) {
  void product;
  return 1;
}

function productSnapshot(product: Product): RequestCartProduct {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    category: product.category,
    subcategory: product.subcategory,
    brand: product.brand,
    size: product.size,
    unit: product.unit,
    defaultSellPrice: product.defaultSellPrice,
    priceRuleVersion: product.priceRuleVersion,
    priceEffectiveFrom: product.priceEffectiveFrom,
    priceChangedAt: product.priceChangedAt,
    priceCurrency: product.priceCurrency,
    deliverySlaDays: product.deliverySlaDays,
    hasImage: product.hasImage,
    imageAltText: product.imageAltText,
  };
}

function validItem(value: unknown): value is RequestCartItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<RequestCartItem>;
  const product = item.product as Partial<RequestCartProduct> | undefined;

  return Boolean(
    product &&
      typeof product.id === "string" &&
      typeof product.code === "string" &&
      typeof product.name === "string" &&
      typeof product.category === "string" &&
      typeof product.subcategory === "string" &&
      typeof product.unit === "string" &&
      Number.isFinite(product.defaultSellPrice) &&
      Number.isFinite(product.deliverySlaDays) &&
      Number.isFinite(item.quantity) &&
      typeof item.specification === "string",
  );
}

export function requestCartStorageKey(scope?: BrowserSessionScope | null) {
  return scopedBrowserStorageKey(REQUEST_CART_STORAGE_PREFIX, scope);
}

function discardUnscopedLegacyCart() {
  if (typeof window === "undefined") return;
  try {
    // The old key has no user or tenant identity. Migrating it could expose one
    // person's draft after a different person signs into the same browser.
    window.localStorage.removeItem(LEGACY_REQUEST_CART_STORAGE_KEY);
  } catch {
    // Storage availability is not required for catalogue browsing.
  }
}

export function readRequestCart(
  scope?: BrowserSessionScope | null,
): RequestCartItem[] {
  if (typeof window === "undefined") return [];
  const key = requestCartStorageKey(scope);
  if (!key) return [];

  try {
    discardUnscopedLegacyCart();
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "[]",
    );

    return Array.isArray(parsed) ? parsed.filter(validItem) : [];
  } catch {
    return [];
  }
}

export function writeRequestCart(
  items: RequestCartItem[],
  scope?: BrowserSessionScope | null,
) {
  if (typeof window === "undefined") return;
  const key = requestCartStorageKey(scope);
  if (!key) return;

  try {
    discardUnscopedLegacyCart();
    window.localStorage.setItem(
      key,
      JSON.stringify(items.filter(validItem)),
    );
  } catch {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<RequestCartItem[]>(REQUEST_CART_EVENT, {
      detail: items,
    }),
  );
}

export function addProductToRequestCart(
  product: Product,
  scope?: BrowserSessionScope | null,
) {
  const current = readRequestCart(scope);
  const existing = current.find(
    (item) => item.product.id === product.id,
  );

  if (existing) {
    return { items: current, added: false };
  }

  const items = [
    ...current,
    {
      product: productSnapshot(product),
      quantity: minimumCartQuantity(product),
      specification: "",
    },
  ];

  writeRequestCart(items, scope);
  return { items, added: true };
}

export function clearRequestCart(scope?: BrowserSessionScope | null) {
  if (typeof window === "undefined") return;
  const key = requestCartStorageKey(scope);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
    discardUnscopedLegacyCart();
  } catch {
    // Explicit sign-out and successful submission still proceed.
  }
  window.dispatchEvent(
    new CustomEvent<RequestCartItem[]>(REQUEST_CART_EVENT, { detail: [] }),
  );
}

export const requestCartInternals = {
  legacyStorageKey: LEGACY_REQUEST_CART_STORAGE_KEY,
  storagePrefix: REQUEST_CART_STORAGE_PREFIX,
  validItem,
  productPriceChanged,
};
