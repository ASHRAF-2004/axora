import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGE_CATEGORIES, categoryImage } from "@/lib/category-images";
import { PRODUCT_CATEGORIES } from "@/lib/product-options";
import { customerVisibleDeliveryStatus } from "@/lib/delivery-tracking";

const root = process.cwd();

describe("public and operational regressions", () => {
  it("maps every internal purchasing state to a neutral customer state", () => {
    for (const state of ["AVAILABLE", "CLAIMED", "SHOPPING", "PURCHASING", "ITEMS_ACQUIRED", "ASSIGNED"]) {
      expect(customerVisibleDeliveryStatus(state)).toBe("PREPARING");
    }
    expect(customerVisibleDeliveryStatus("OUT_FOR_DELIVERY")).toBe("OUT_FOR_DELIVERY");
    expect(customerVisibleDeliveryStatus("DELIVERED")).toBe("DELIVERED");
    expect(customerVisibleDeliveryStatus("COMPLETED")).toBe("COMPLETED");
  });

  it("has licensed localized artwork for every customer category", async () => {
    expect(new Set(CATEGORY_IMAGE_CATEGORIES)).toEqual(new Set(PRODUCT_CATEGORIES));
    for (const category of PRODUCT_CATEGORIES) {
      for (const locale of ["en", "ar", "ms"] as const) {
        const asset = categoryImage(category, locale);
        expect(asset.alt.trim().length).toBeGreaterThan(3);
        expect(asset.srcSet.webp).toMatch(/^\/catalog\/categories\/.+\.webp$/);
        expect(asset.srcSet.avif).toMatch(/^\/catalog\/categories\/.+\.avif$/);
        expect((await stat(path.join(root, "public", asset.srcSet.webp.slice(1)))).size).toBeGreaterThan(100);
        expect((await stat(path.join(root, "public", asset.srcSet.avif.slice(1)))).size).toBeGreaterThan(100);
      }
    }
  });

  it("uses a dedicated customer reference instead of the internal product code", async () => {
    const [catalog,migration,contract] = await Promise.all([
      readFile(path.join(root,"src/lib/catalog.ts"),"utf8"),
      readFile(path.join(root,"database/migrations/086_customer_catalog_public_references.sql"),"utf8"),
      readFile(path.join(root,"src/lib/catalog-contracts.ts"),"utf8"),
    ]);
    expect(catalog).not.toContain("publicRef: product.code");
    expect(catalog).toContain("p.public_reference = ANY");
    expect(migration).toContain("products_public_reference_unique");
    expect(contract).toContain("opaque customer reference");
  });

  it("removes the cursor-following light implementation", async () => {
    const interaction = await readFile(path.join(root, "src/components/InteractionMagic.tsx"), "utf8");
    const styles = await readFile(path.join(root, "src/app/globals.css"), "utf8");
    expect(interaction).not.toContain("interaction-pointer-light");
    expect(styles).not.toContain("interaction-pointer-light");
  });

});
