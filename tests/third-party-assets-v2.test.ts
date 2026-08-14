import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGE_CATEGORIES, categoryImage } from "@/lib/category-images";
import { SEMANTIC_MODEL_PATHS, STAGE_SOUND_PATHS, WORKFLOW_STAGE_IDS } from "@/lib/immersive-public-experience";

const root = process.cwd();
const manifest = fs.readFileSync(path.join(root, "THIRD_PARTY_ASSETS.md"), "utf8");

function assetPath(publicPath: string) {
  return path.join(root, "public", publicPath.replace(/^\//, ""));
}

describe("immersive and catalogue asset provenance", () => {
  it("self-hosts every semantic GLB with declared provenance", () => {
    const paths = new Set(Object.values(SEMANTIC_MODEL_PATHS));
    expect(paths.size).toBe(Object.keys(SEMANTIC_MODEL_PATHS).length);
    for (const publicPath of paths) {
      const file = assetPath(publicPath);
      expect(fs.existsSync(file), publicPath).toBe(true);
      expect(fs.readFileSync(file).subarray(0, 4).toString("ascii"), publicPath).toBe("glTF");
      expect(manifest).toContain(publicPath.replace(/^\//, "public/"));
    }
  });

  it("uses a distinct self-hosted cue for every customer workflow stage", () => {
    const paths = WORKFLOW_STAGE_IDS.map((stage) => STAGE_SOUND_PATHS[stage]);
    expect(new Set(paths).size).toBe(WORKFLOW_STAGE_IDS.length);
    for (const publicPath of [...paths, "/immersive/sounds/delivery-door.wav"]) {
      const file = assetPath(publicPath);
      expect(fs.existsSync(file), publicPath).toBe(true);
      const signature = fs.readFileSync(file).subarray(0, 4).toString("ascii");
      expect(["OggS", "RIFF"], publicPath).toContain(signature);
      expect(manifest).toContain(publicPath.replace(/^\//, "public/"));
    }
  });

  it("provides localized, self-hosted AVIF and WebP art for every fixed category", () => {
    expect(CATEGORY_IMAGE_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of CATEGORY_IMAGE_CATEGORIES) {
      for (const locale of ["en", "ar", "ms"] as const) {
        const art = categoryImage(category, locale);
        expect(art.alt.trim().length, `${category}:${locale}`).toBeGreaterThan(4);
        expect(art.avif).toMatch(/^\/catalog\/categories\/[a-z0-9-]+\.avif$/);
        expect(art.webp).toMatch(/^\/catalog\/categories\/[a-z0-9-]+\.webp$/);
        expect(fs.existsSync(assetPath(art.avif)), art.avif).toBe(true);
        expect(fs.existsSync(assetPath(art.webp)), art.webp).toBe(true);
      }
    }
    expect(manifest).toContain("3dicons v1");
    expect(manifest).toContain("CC0");
  });
});
