import type { Product } from "@/lib/types";

export const REQUEST_CART_STORAGE_KEY = "axora-request-cart:v1";
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
  minimumOrderQuantity: number;
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
  product: Pick<Product, "minimumOrderQuantity">,
) {
  return Math.max(Math.ceil(product.minimumOrderQuantity), 1);
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
    minimumOrderQuantity: product.minimumOrderQuantity,
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
      Number.isFinite(product.minimumOrderQuantity) &&
      Number.isFinite(product.deliverySlaDays) &&
      Number.isFinite(item.quantity) &&
      typeof item.specification === "string",
  );
}

export function readRequestCart(): RequestCartItem[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(REQUEST_CART_STORAGE_KEY) ?? "[]",
    );

    return Array.isArray(parsed) ? parsed.filter(validItem) : [];
  } catch {
    return [];
  }
}

export function writeRequestCart(items: RequestCartItem[]) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    REQUEST_CART_STORAGE_KEY,
    JSON.stringify(items),
  );

  window.dispatchEvent(
    new CustomEvent<RequestCartItem[]>(REQUEST_CART_EVENT, {
      detail: items,
    }),
  );
}

export function addProductToRequestCart(product: Product) {
  const current = readRequestCart();
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

  writeRequestCart(items);
  return { items, added: true };
}

export function clearRequestCart() {
  writeRequestCart([]);
}
