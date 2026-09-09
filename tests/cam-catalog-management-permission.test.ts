import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getDemoStore } from "@/lib/demo-data";
import { updateProductCatalogMetadata } from "@/lib/product-admin";
import { canAccess, canManageCommercialCatalog } from "@/lib/permissions";
import { createCatalogDraftProduct, listProducts } from "@/lib/repository";

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

  it("honors product.manage without granting confidential commercial pricing", async () => {
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

  it("creates an inactive draft which is visible to the catalog manager but unavailable to Shopping", async () => {
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
