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
  neededByDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  urgency: "Normal" as const,
};

describe("whole-number product quantities", () => {
  it("accepts the simplified product shape and rejects retired ordering fields", () => {
    expect(productSchema.safeParse(productInput).success).toBe(true);
    expect(productSchema.safeParse({ ...productInput, minimumOrderQuantity: 1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...productInput, orderIncrement: 1 }).success).toBe(false);
  });

  it("accepts whole-number request quantities and rejects decimals", () => {
    const parsed = requestSchema.safeParse({
      ...requestInput,
      lines: [{ productId: "product-1", quantity: 3 }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.department).toBe("");

    expect(requestSchema.safeParse({
      ...requestInput,
      lines: [{ productId: "product-1", quantity: 1.5 }],
    }).success).toBe(false);
  });
});
