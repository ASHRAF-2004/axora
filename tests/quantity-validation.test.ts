import { describe, expect, it } from "vitest";
import { productSchema, requestSchema } from "@/lib/validation";

const productInput = {
  name: "A4 Copy Paper",
  category: "Office Basics",
  subcategory: "Paper",
  unit: "Ream",
  defaultBuyPrice: 10,
  defaultSellPrice: 12,
  deliverySlaDays: 1,
};

const requestInput = {
  companyId: "company-1",
  branchId: "branch-1",
  requestType: "Standard" as const,
  department: "Administration",
  neededByDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  urgency: "Normal" as const,
};

describe("whole-number product quantities", () => {
  it("accepts whole-number product minimum quantities", () => {
    expect(productSchema.safeParse({ ...productInput, minimumOrderQuantity: 1 }).success).toBe(true);
    expect(productSchema.safeParse({ ...productInput, minimumOrderQuantity: 4 }).success).toBe(true);
  });

  it("rejects decimal product minimum quantities", () => {
    expect(productSchema.safeParse({ ...productInput, minimumOrderQuantity: 0.99 }).success).toBe(false);
    expect(productSchema.safeParse({ ...productInput, minimumOrderQuantity: 1.01 }).success).toBe(false);
  });

  it("accepts whole-number request quantities and rejects decimals", () => {
    expect(requestSchema.safeParse({
      ...requestInput,
      lines: [{ productId: "product-1", quantity: 3 }],
    }).success).toBe(true);

    expect(requestSchema.safeParse({
      ...requestInput,
      lines: [{ productId: "product-1", quantity: 1.5 }],
    }).success).toBe(false);
  });
});
