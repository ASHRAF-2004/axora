import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGE_CATEGORIES } from "@/lib/category-images";

describe("immersive and catalogue asset provenance", () => {
  it("has exactly one validated provenance record for every runtime third-party file", async () => {
    const output = execFileSync(process.execPath, ["scripts/validate-third-party-assets.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(output).toContain("Validated 56 self-hosted third-party assets");
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as { assets: Array<{ path: string }> };
    expect(manifest.assets).toHaveLength(56);
    expect(new Set(manifest.assets.map((asset) => asset.path)).size).toBe(56);
  });

  it("maps every category derivative to one exact source item", async () => {
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as {
      assets: Array<{ path: string; canonicalSource: string; originalFilename: string; exactPackOrItem: string }>;
    };
    const categories = manifest.assets.filter((asset) => asset.path.startsWith("public/catalog/categories/"));
    expect(categories).toHaveLength(CATEGORY_IMAGE_CATEGORIES.length * 2);
    for (const asset of categories) {
      expect(asset.canonicalSource).toMatch(/^https:\/\/3dicons\.co\/icons\/[a-z0-9-]+\?angle=dynamic$/);
      expect(asset.originalFilename).toMatch(/\/dynamic\/500\/color\.webp$/);
      expect(asset.exactPackOrItem).toContain("3dicons v1 /");
    }
  });

  it("records tracking as Space Kit only and never as City Kit Roads", async () => {
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as {
      assets: Array<{ path: string; canonicalSource: string; exactPackOrItem: string }>;
    };
    const track = manifest.assets.filter((asset) => asset.path === "public/immersive/models/track.glb");
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({ exactPackOrItem: "Space Kit" });
    expect(track[0]?.canonicalSource).toBe("https://kenney.nl/assets/space-kit");
  });
});
