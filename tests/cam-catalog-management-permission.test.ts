import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getDemoStore } from "@/lib/demo-data";
import { updateProductCatalogMetadata } from "@/lib/product-admin";
import { canAccess, canManageCommercialCatalog } from "@/lib/permissions";
import { createCatalogDraftProduct, listProducts } from "@/lib/repository";
import { calculateCommercialSellingPrice } from "@/lib/procurement-rules";
import { productCatalogMarkupSchema } from "@/lib/validation";

const cam: SessionUser = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "cam-catalog-manager.fixture@axora.invalid",
  name: "CAM catalog manager",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "20222222-2222-4222-8222-222222222222",
  isOwner: false,
  effectivePermissions: ["view_catalog", "manage_catalog"],
};

describe("CAM product-management permission", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "true");
    delete (globalThis as typeof globalThis & { __axoraDemoStore?: unknown }).__axoraDemoStore;
  });

  it("uses the existing 0–100 markup contract and applies it exactly once", () => {
    const catalog = {
      name: "Markup validation product", category: "Office Basics", subcategory: "Paper",
      brand: "", size: "", unit: "Ream", packaging: "", description: "", deliverySlaDays: 1,
    };
    expect(productCatalogMarkupSchema.parse({ ...catalog, customerMarkupPercentage: 0 }).customerMarkupPercentage).toBe(0);
    expect(productCatalogMarkupSchema.parse({ ...catalog, customerMarkupPercentage: 100 }).customerMarkupPercentage).toBe(100);
    expect(() => productCatalogMarkupSchema.parse({ ...catalog, customerMarkupPercentage: -1 })).toThrow("Profit cannot be negative.");
    expect(() => productCatalogMarkupSchema.parse({ ...catalog, customerMarkupPercentage: 101 })).toThrow("Profit cannot exceed 100%.");
    expect(calculateCommercialSellingPrice(100, 25)).toBe(125);
  });

  it("honors product.manage without granting confidential cost or pricing-history access", async () => {
    expect(canAccess(cam, "manage_catalog")).toBe(true);
    expect(canAccess(cam, "manage_commercial_pricing")).toBe(false);
    expect(canManageCommercialCatalog(cam)).toBe(false);

    const original = getDemoStore().products[0];
    const originalName = original.name;
    const originalPrices = {
      buy: original.defaultBuyPrice,
      sell: original.defaultSellPrice,
      markup: original.customerMarkupPercentage,
    };
    await updateProductCatalogMetadata(original.id, {
      name: `${originalName} managed`,
      category: original.category,
      subcategory: original.subcategory,
      brand: original.brand,
      size: original.size,
      unit: original.unit,
      packaging: original.packaging,
      description: "Updated catalog description",
      deliverySlaDays: original.deliverySlaDays,
    }, cam);
    expect(original).toMatchObject({ name: `${originalName} managed`, description: "Updated catalog description" });
    expect({ buy: original.defaultBuyPrice, sell: original.defaultSellPrice, markup: original.customerMarkupPercentage })
      .toEqual(originalPrices);
  });

  it("lets a catalog manager set the 0–100 customer markup without seeing or changing base cost", async () => {
    const product = getDemoStore().products[0];
    const baseCost = product.defaultBuyPrice;
    await updateProductCatalogMetadata(product.id, {
      name: product.name,
      category: product.category,
      subcategory: product.subcategory,
      brand: product.brand,
      size: product.size,
      unit: product.unit,
      packaging: product.packaging,
      description: product.description,
      deliverySlaDays: product.deliverySlaDays,
      customerMarkupPercentage: 25,
    }, cam);

    expect(product.defaultBuyPrice).toBe(baseCost);
    expect(product.customerMarkupPercentage).toBe(25);
    expect(product.defaultSellPrice).toBe(baseCost * 1.25);
  });

  it("creates a price-pending inactive draft which is visible to the catalog manager but unavailable to Shopping", async () => {
    const id = await createCatalogDraftProduct({
      name: "CAM draft product",
      category: "Office Basics",
      subcategory: "Paper",
      brand: "CAM fixture",
      size: "A4",
      unit: "Ream",
      packaging: undefined,
      description: "Created without commercial pricing authority",
      deliverySlaDays: 2,
      customerMarkupPercentage: 10,
    }, cam);

    const draft = getDemoStore().products.find((product) => product.id === id);
    expect(draft).toMatchObject({
      status: "Inactive",
      defaultBuyPrice: 0,
      defaultSellPrice: 0,
      customerMarkupPercentage: 10,
    });
    expect(await listProducts(cam)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, status: "Inactive" }),
    ]));
  });
});
