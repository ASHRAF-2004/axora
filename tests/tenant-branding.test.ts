import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeLogoPixels,
  brandContrastSummary,
  buildBrandThemeTokens,
  contrastRatio,
  themeCssVariables,
} from "@/lib/brand-colors";
import { processCompanyLogo } from "@/lib/tenant-branding";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("deterministic tenant branding", () => {
  it("extracts an accessible theme from a navy and amber logo", () => {
    const pixels = new Uint8Array([
      11, 45, 82, 255,
      11, 45, 82, 255,
      232, 163, 61, 255,
      255, 255, 255, 255,
    ]);
    const result = analyzeLogoPixels(pixels, 4);
    expect(result.usedFallback).toBe(false);
    expect(result.tokens.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.tokens.accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.tokens.primaryHover).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.tokens.primaryActive).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrastRatio(result.tokens.primary, result.tokens.primaryForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(result.tokens.link, result.tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(result.tokens.focusRing, result.tokens.surface)).toBeGreaterThanOrEqual(3);
  });

  it("uses safe semantic colors rather than repurposing tenant colors", () => {
    const pixels = new Uint8Array([220, 10, 20, 255, 220, 10, 20, 255]);
    const result = analyzeLogoPixels(pixels, 4);
    expect(result.tokens.danger).toBe("#B4232C");
    expect(result.tokens.warning).toBe("#9A5B08");
    expect(result.tokens.success).toBe("#187A50");
  });

  it("falls back safely when a logo contains no opaque non-white pixels", () => {
    const result = analyzeLogoPixels(new Uint8Array([255, 255, 255, 0, 255, 255, 255, 0]), 4);
    expect(result.usedFallback).toBe(true);
    expect(result.tokens.primary).toBe("#0B3157");
  });

  it("emits only bounded trusted CSS custom properties", () => {
    const result = analyzeLogoPixels(new Uint8Array([11, 45, 82, 255]), 4);
    const css = themeCssVariables(result.tokens);
    expect(css).toContain("--tenant-primary:#0B2D52");
    expect(css).toContain("--tenant-primary-hover:");
    expect(css).toContain("--tenant-page-dark:#0A1624");
    expect(css).not.toMatch(/[{}<>]/);
  });

  it("blocks unsafe reviewed text while retaining bounded colors", () => {
    const tokens = buildBrandThemeTokens({
      pageBackground: "#FFFFFF",
      text: "#FFFFFF",
    });
    const contrast = brandContrastSummary(tokens);
    expect(contrast.textOnBackground).toBe(1);
    expect(contrast.passes).toBe(false);
  });

  it("normalizes a validated logo and rejects a MIME mismatch", async () => {
    const logo = await sharp({
      create: { width: 48, height: 48, channels: 4, background: "#0B2D52" },
    }).png().toBuffer();
    const processed = await processCompanyLogo(logo, "tenant-logo.png", "image/png");
    expect(processed.contentType).toBe("image/png");
    expect(processed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(processed.width).toBe(48);
    expect(processed.qualityWarnings).toContain("LOW_RESOLUTION");
    await expect(processCompanyLogo(logo, "tenant-logo.jpg", "image/jpeg")).rejects.toThrow(
      "does not match",
    );
  });
});

describe("tenant brand schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    await applyDemoSeed(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("stores one active versioned logo and theme for a company", async () => {
    await db.exec(`
      INSERT INTO company_logos(
        id,company_id,version,file_name,content_type,logo_content,sha256,
        width,height,has_transparency,active
      ) VALUES (
        'c1000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',1,'logo.png','image/png',
        decode('89504e47','hex'),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        64,64,true,true
      );
      INSERT INTO company_brand_themes(
        id,company_id,source_logo_id,version,algorithm_version,
        primary_color,secondary_color,accent_color,primary_foreground,
        secondary_foreground,page_background,surface_color,muted_surface,
        border_color,success_color,warning_color,danger_color,focus_ring,
        link_color,chart_colors
      ) VALUES (
        'c2000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',1,'test-v1',
        '#0B2D52','#173F5F','#E8A33D','#FFFFFF','#FFFFFF','#F7F9FC',
        '#FFFFFF','#EEF2F7','#D7DEE8','#187A50','#9A5B08','#B4232C',
        '#A96A10','#123E68',ARRAY['#0B2D52','#E8A33D','#187A50']
      );
    `);
    const count = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM company_brand_themes WHERE active
    `);
    expect(count.rows[0].count).toBe(1);
  });

  it("rejects a second active theme and mutation of published tokens", async () => {
    await expect(db.exec(`
      INSERT INTO company_brand_themes(
        company_id,source_logo_id,version,algorithm_version,
        primary_color,secondary_color,accent_color,primary_foreground,
        secondary_foreground,page_background,surface_color,muted_surface,
        border_color,success_color,warning_color,danger_color,focus_ring,
        link_color,chart_colors
      ) SELECT
        company_id,source_logo_id,2,algorithm_version,
        primary_color,secondary_color,accent_color,primary_foreground,
        secondary_foreground,page_background,surface_color,muted_surface,
        border_color,success_color,warning_color,danger_color,focus_ring,
        link_color,chart_colors
      FROM company_brand_themes WHERE version=1
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE company_brand_themes SET primary_color='#FFFFFF'
      WHERE id='c2000000-0000-4000-8000-000000000001'
    `)).rejects.toThrow("immutable");
  });

  it("rejects malformed or incomplete theme tokens", async () => {
    await expect(db.exec(`
      UPDATE company_brand_themes SET active=false
      WHERE id='c2000000-0000-4000-8000-000000000001';
      INSERT INTO company_brand_themes(
        company_id,source_logo_id,version,algorithm_version,
        primary_color,secondary_color,accent_color,primary_foreground,
        secondary_foreground,page_background,surface_color,muted_surface,
        border_color,success_color,warning_color,danger_color,focus_ring,
        link_color,chart_colors
      ) VALUES (
        '10000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',2,'test-v1',
        'red','#173F5F','#E8A33D','#FFFFFF','#FFFFFF','#F7F9FC',
        '#FFFFFF','#EEF2F7','#D7DEE8','#187A50','#9A5B08','#B4232C',
        '#A96A10','#123E68',ARRAY['#0B2D52','#E8A33D','#187A50']
      )
    `)).rejects.toThrow();
  });
});
