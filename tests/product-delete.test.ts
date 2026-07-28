import { describe, expect, it } from "vitest";

import { canPermanentlyDeleteProduct } from "@/lib/product-delete";

describe("product deletion policy", () => {
  it("allows permanent deletion when a product has no purchase history", () => {
    expect(canPermanentlyDeleteProduct(0)).toBe(true);
  });

  it("blocks permanent deletion when a product is referenced by a request line", () => {
    expect(canPermanentlyDeleteProduct(1)).toBe(false);
    expect(canPermanentlyDeleteProduct(4)).toBe(false);
  });
});
