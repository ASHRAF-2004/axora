import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_INTERACTION_CATALOG,
  DEFAULT_MASCOT_CONFIG,
  assertInteractionPublishable,
  validateInteractionForPublication,
} from "@/lib/interactions";

describe("approved interaction assets and publication gates", () => {
  it("records an exact local commercial-use license for every catalog entry", async () => {
    for (const asset of Object.values(APPROVED_INTERACTION_CATALOG)) {
      expect(asset.license).toMatchObject({
        commercialUseApproved: true,
        localCopyApproved: true,
        inventoryDocument: "/docs/INTERACTION_ASSET_LICENSES.md",
      });
      expect(asset.license.name.length).toBeGreaterThan(2);
      expect(asset.license.source.length).toBeGreaterThan(2);
      expect(asset.license.exactLicense.length).toBeGreaterThan(2);
      if (asset.license.attributionRequired) {
        expect(asset.license.attributionDocument).toBeTruthy();
      }

      const integritySource = await readFile(join(process.cwd(), asset.integrity.sourcePath));
      expect(asset.integrity.algorithm).toBe("sha256");
      expect(createHash("sha256").update(integritySource).digest("hex"))
        .toBe(asset.integrity.digest);
      if (asset.localAssetPath) {
        const file = await stat(join(process.cwd(), "public", asset.localAssetPath.replace(/^\//, "")));
        expect(file.isFile()).toBe(true);
      }
    }

    expect(APPROVED_INTERACTION_CATALOG["axora-mark-static-v1"].license)
      .toMatchObject({
        name: "ISC License",
        attributionRequired: true,
        attributionDocument: "/THIRD_PARTY_NOTICES.md",
      });
  });

  it("keeps the original mascot SVG static, local, and free of executable content", async () => {
    const source = await readFile(join(process.cwd(), "public/interactions/axora-buddy-static.svg"), "utf8");
    expect(source).toContain("<title");
    expect(source).toContain("<desc");
    expect(source).not.toMatch(/<script|<foreignObject|javascript:|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']https?:\/\//i);
  });

  it("accepts the approved mascot but rejects unknown, mismatched, or fallback-only assets", () => {
    expect(validateInteractionForPublication(DEFAULT_MASCOT_CONFIG).valid).toBe(true);
    expect(validateInteractionForPublication({ ...DEFAULT_MASCOT_CONFIG, assetId: "community-robot" }).valid).toBe(false);
    const mismatch = validateInteractionForPublication({
      ...DEFAULT_MASCOT_CONFIG,
      interactionType: "abstract-illustration",
    });
    expect(mismatch.errors.some((issue) => issue.code === "asset-type-mismatch")).toBe(true);
    const fallbackOnly = validateInteractionForPublication({
      ...DEFAULT_MASCOT_CONFIG,
      assetId: "axora-mark-static-v1",
      interactionType: "abstract-illustration",
    });
    expect(fallbackOnly.errors.some((issue) => issue.code === "asset-not-approved")).toBe(true);
    const wrongFallback = validateInteractionForPublication({
      ...DEFAULT_MASCOT_CONFIG,
      fallback: { kind: "static-svg", assetId: "axora-mark-static-v1" },
    });
    expect(wrongFallback.errors.some((issue) => issue.code === "fallback-not-approved")).toBe(true);
  });

  it("requires a static failure/reduced-motion fallback and enforces budgets", () => {
    const missingFallback = validateInteractionForPublication({
      ...DEFAULT_MASCOT_CONFIG,
      fallback: { kind: "hidden", assetId: "none" },
    });
    expect(missingFallback.errors.some((issue) => issue.code === "fallback-missing")).toBe(true);
    const oversized = validateInteractionForPublication(DEFAULT_MASCOT_CONFIG, { measuredAssetBytes: 500_000 });
    expect(oversized.errors.some((issue) => issue.code === "performance-budget")).toBe(true);
  });

  it("rejects an unsuitable tone, tenant asset leakage, protected overlap, and overflow", () => {
    expect(validateInteractionForPublication(DEFAULT_MASCOT_CONFIG, { pageTone: "restrained" }).errors)
      .toContainEqual(expect.objectContaining({ code: "tone-unsuitable" }));
    expect(validateInteractionForPublication(DEFAULT_MASCOT_CONFIG, {
      allowedAssetIds: ["axora-mark-static-v1"],
    }).errors).toContainEqual(expect.objectContaining({ code: "tenant-isolation" }));
    const geometry = validateInteractionForPublication(DEFAULT_MASCOT_CONFIG, {
      viewport: { width: 320, height: 640 },
      interactionRect: { x: 280, y: 80, width: 80, height: 80 },
      protectedRects: [{ id: "primary-cta", x: 260, y: 50, width: 60, height: 100 }],
    });
    expect(geometry.errors).toContainEqual(expect.objectContaining({ code: "horizontal-overflow" }));
    expect(geometry.errors).toContainEqual(expect.objectContaining({ code: "protected-control-overlap" }));
  });

  it("returns a parsed publishable config or throws a useful publication error", () => {
    expect(assertInteractionPublishable(DEFAULT_MASCOT_CONFIG)).toEqual(DEFAULT_MASCOT_CONFIG);
    expect(() => assertInteractionPublishable({ ...DEFAULT_MASCOT_CONFIG, fallback: { kind: "hidden", assetId: "none" } }))
      .toThrow("static fallback");
  });
});
