import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGE_CATEGORIES, categoryImage } from "@/lib/category-images";
import { PRODUCT_CATEGORIES } from "@/lib/product-options";
import {
  immersivePublicCopy,
  PUBLIC_SCENE_MODELS,
  SEMANTIC_MODEL_PATHS,
  STAGE_SOUND_PATHS,
  WORKFLOW_STAGE_IDS,
} from "@/lib/immersive-public-experience";
import { customerVisibleDeliveryStatus } from "@/lib/delivery-tracking";

const root = process.cwd();

describe("Axora immersive world V2", () => {
  it("uses the privacy-safe customer workflow in every locale", () => {
    expect(WORKFLOW_STAGE_IDS).toEqual(["request", "approve", "pay", "invoice", "prepare", "deliver", "track", "complete"]);
    for (const locale of ["en", "ar", "ms"] as const) {
      const serialized = JSON.stringify(immersivePublicCopy(locale));
      expect(serialized).not.toMatch(/Delivery Guy buys|Buy the items|يشتري مسؤول التوصيل|membeli item/i);
    }
  });

  it("maps every internal purchasing state to a neutral customer state", () => {
    for (const state of ["AVAILABLE", "CLAIMED", "SHOPPING", "PURCHASING", "ITEMS_ACQUIRED", "ASSIGNED"]) {
      expect(customerVisibleDeliveryStatus(state)).toBe("PREPARING");
    }
    expect(customerVisibleDeliveryStatus("OUT_FOR_DELIVERY")).toBe("OUT_FOR_DELIVERY");
    expect(customerVisibleDeliveryStatus("DELIVERED")).toBe("DELIVERED");
    expect(customerVisibleDeliveryStatus("COMPLETED")).toBe("COMPLETED");
  });

  it("ships self-contained semantic GLBs and one distinct sound per stage", async () => {
    const workflowSounds = WORKFLOW_STAGE_IDS.map((stage) => STAGE_SOUND_PATHS[stage]);
    expect(new Set(workflowSounds).size).toBe(workflowSounds.length);
    for (const modelPath of new Set(Object.values(SEMANTIC_MODEL_PATHS))) {
      const bytes = await readFile(path.join(root, "public", modelPath.replace(/^\//, "")));
      expect(bytes.subarray(0, 4).toString()).toBe("glTF");
      const jsonLength = bytes.readUInt32LE(12);
      const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString().replace(/\0+$/, "")) as { images?: Array<{ uri?: string }> };
      expect(document.images?.some((image) => Boolean(image.uri))).not.toBe(true);
    }
    for (const soundPath of new Set(Object.values(STAGE_SOUND_PATHS))) {
      expect((await stat(path.join(root, "public", soundPath.replace(/^\//, "")))).size).toBeGreaterThan(100);
    }
  });

  it("gives all six public routes distinct semantic scene sequences", () => {
    expect(Object.keys(PUBLIC_SCENE_MODELS)).toEqual(["home", "how-it-works", "procurement-process", "solutions-by-role", "security-and-privacy", "about"]);
    expect(new Set(Object.values(PUBLIC_SCENE_MODELS).map((sequence) => sequence.join(","))).size).toBe(6);
    expect(PUBLIC_SCENE_MODELS.home).toContain("deliver");
    expect(PUBLIC_SCENE_MODELS["security-and-privacy"]).toEqual(expect.arrayContaining(["shield", "vault"]));
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

  it("uses semantic models instead of box controls and cleans up scene work", async () => {
    const [scene, emblem] = await Promise.all([
      readFile(path.join(root, "src/components/public/AxoraSemanticSceneCanvas.tsx"), "utf8"),
      readFile(path.join(root, "src/components/public/AxoraBrandEmblemCanvas.tsx"), "utf8"),
    ]);
    expect(scene).not.toMatch(/RoundedBox|boxGeometry/);
    expect(scene).toContain("AbortController");
    expect(scene).toContain("controller.abort()");
    expect(scene).toContain("material.dispose()");
    expect(scene).toContain('removeEventListener("webglcontextlost"');
    expect(emblem).toContain("extrudeGeometry");
    expect(emblem).not.toMatch(/boxGeometry|useTexture/);
  });
});
