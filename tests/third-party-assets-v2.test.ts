import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGE_CATEGORIES } from "@/lib/category-images";

describe("catalogue and map asset provenance", () => {
  it("has exactly one validated provenance record for every runtime third-party file", async () => {
    const output = execFileSync(process.execPath, ["scripts/validate-third-party-assets.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(output).toContain("Validated 34 self-hosted third-party assets");
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as { assets: Array<{ path: string }> };
    expect(manifest.assets).toHaveLength(34);
    expect(new Set(manifest.assets.map((asset) => asset.path)).size).toBe(34);
  });

  it("restores software notices and verifies every local licence reference", () => {
    const output = execFileSync(process.execPath, ["scripts/validate-third-party-notices.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(output).toContain("Validated 9 third-party notice sections");
  });

  it("requires a verified original checksum for every shipped runtime asset", async () => {
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as {
      assets: Array<{ path: string; originalFileSha256: string | null; originalChecksumReason?: string }>;
    };
    const unavailable = manifest.assets.filter((asset) => asset.originalFileSha256 === null);
    expect(unavailable).toEqual([]);
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

  it("contains no retired immersive model or sound records", async () => {
    const manifest = JSON.parse(await readFile(new URL("../third-party-assets.json", import.meta.url), "utf8")) as {
      assets: Array<{ path: string; canonicalSource: string; exactPackOrItem: string }>;
    };
    expect(manifest.assets.filter((asset) => asset.path.startsWith("public/immersive/"))).toEqual([]);
  });
});
