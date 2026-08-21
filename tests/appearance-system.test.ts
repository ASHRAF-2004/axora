import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_COOKIE_KEY,
  APPEARANCE_MODES,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_APPEARANCE_COOKIE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  isAppearanceMode,
  legacyAppearanceToMode,
} from "@/lib/appearance";
import { contrastRatio, relativeLuminance } from "@/lib/brand-colors";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function themeTokens(css: string, appearance: "light" | "dark") {
  const block = css.match(new RegExp(
    `html\\[data-appearance="${appearance}"\\],[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`,
  ))?.[1];
  if (!block) throw new Error(`Missing ${appearance} token block.`);
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
      .map((match) => [`--${match[1]}`, match[2].toUpperCase()]),
  );
}

function token(tokens: Record<string, string>, name: string) {
  const value = tokens[name];
  if (!value) throw new Error(`Missing literal color token ${name}.`);
  return value;
}

describe("unified appearance contract", () => {
  it("supports exactly Light and Dark with Light as the default", () => {
    expect(APPEARANCE_MODES).toEqual(["light", "dark"]);
    expect(DEFAULT_APPEARANCE).toBe("light");
    expect(isAppearanceMode("light")).toBe(true);
    expect(isAppearanceMode("dark")).toBe(true);
    expect(isAppearanceMode("system")).toBe(false);
    expect(isAppearanceMode("Aurora")).toBe(false);
  });

  it("owns deterministic rollout-only legacy conversion centrally", () => {
    expect(legacyAppearanceToMode("Aurora")).toBe("light");
    expect(legacyAppearanceToMode("Solar")).toBe("light");
    expect(legacyAppearanceToMode("Ember")).toBe("light");
    expect(legacyAppearanceToMode("Midnight")).toBe("dark");
    expect(legacyAppearanceToMode("Amber")).toBeNull();
    expect(legacyAppearanceToMode("system")).toBeNull();
    expect(APPEARANCE_STORAGE_KEY).toBe("axora-appearance:v1");
    expect(APPEARANCE_COOKIE_KEY).toBe("axora_appearance");
    expect(LEGACY_APPEARANCE_STORAGE_KEY).toBe("axora-public-atmosphere:v2");
    expect(LEGACY_APPEARANCE_COOKIE_KEY).toBe("axora_public_atmosphere");
  });

  it("keeps one semantic Light/Dark palette source with the approved Axora anchors", async () => {
    const css = await source("src/app/appearance-tokens.css");
    expect(css).toContain('html[data-appearance="light"]');
    expect(css).toContain('html[data-appearance="dark"]');
    expect(css).toContain("--axora-brand-anchor: #0b3157");
    expect(css).toContain("--axora-brand-accent: #eaa63a");
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
    expect(css).not.toContain("data-atmosphere");
  });

  it.each(["light", "dark"] as const)("meets semantic %s contrast contracts", async (appearance) => {
    const css = await source("src/app/appearance-tokens.css");
    const tokens = themeTokens(css, appearance);
    const page = token(tokens, "--axora-page-bg");
    const surface = token(tokens, "--axora-surface");

    for (const textToken of ["--axora-text", "--axora-text-secondary", "--axora-text-muted"]) {
      expect(contrastRatio(token(tokens, textToken), surface), `${textToken} on ${appearance} surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(token(tokens, "--axora-focus"), surface), `focus on ${appearance} surface`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token(tokens, "--axora-focus"), page), `focus on ${appearance} page`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token(tokens, "--axora-chart-axis"), surface), `chart axis on ${appearance} surface`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token(tokens, "--axora-chart-1"), surface), `chart series 1 on ${appearance} surface`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token(tokens, "--axora-chart-2"), surface), `chart series 2 on ${appearance} surface`).toBeGreaterThanOrEqual(3);

    for (const status of ["success", "warning", "danger", "info", "neutral"]) {
      expect(
        contrastRatio(token(tokens, `--axora-${status}`), token(tokens, `--axora-${status}-bg`)),
        `${status} status in ${appearance}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps Dark surfaces dark and shared authenticated primitives semantic", async () => {
    const [tokensCss, globalCss] = await Promise.all([
      source("src/app/appearance-tokens.css"),
      source("src/app/globals.css"),
    ]);
    const dark = themeTokens(tokensCss, "dark");
    for (const surfaceToken of ["--axora-page-bg", "--axora-surface", "--axora-surface-elevated", "--axora-surface-muted"]) {
      expect(relativeLuminance(token(dark, surfaceToken)), surfaceToken).toBeLessThan(0.08);
    }
    expect(tokensCss).toContain(".app-shell :is(.panel, .metric-card, .card, .table-wrap, .empty-state");
    expect(tokensCss).toContain(".data-table td { color: var(--axora-text-secondary)");
    expect(globalCss).toMatch(/\.metric-card\s*\{[^}]*background:\s*var\(--axora-surface\)/is);
    expect(globalCss).toMatch(/\.panel\s*\{[^}]*background:\s*var\(--axora-surface\)/is);
    expect(globalCss).toContain(".shop-cart-bar {");
    expect(globalCss).not.toMatch(/\.shop-cart-bar\s*\{[^}]*background:\s*(?:white|#fff)/is);
  });

  it("derives company Dark interactions after the common reviewed-brand mapping", async () => {
    const css = await source("src/app/appearance-tokens.css");
    const commonCompany = css.lastIndexOf('.app-shell[data-tenant-theme="company"] {');
    const darkDerivation = css.lastIndexOf('.app-shell[data-tenant-theme="company"][data-appearance="dark"] {');
    expect(commonCompany).toBeGreaterThan(0);
    expect(darkDerivation).toBeGreaterThan(commonCompany);
    expect(css.slice(darkDerivation)).toContain("--axora-link: color-mix");
    expect(css.slice(darkDerivation)).toContain("--axora-focus: color-mix");
  });
});

describe("approved Axora vector identity", () => {
  it("preserves the approved network geometry in explicit Light and Dark variants", async () => {
    const [sourceSvg, lightSvg, darkSvg] = await Promise.all([
      source("public/brand/axora-logo-source.svg"),
      source("public/brand/axora-logo-light.svg"),
      source("public/brand/axora-logo-dark.svg"),
    ]);
    const paths = [
      "M78 80 L112 113 L154 75",
      "M112 113 L112 158 L76 190",
      "M112 158 L160 190",
    ];
    for (const path of paths) {
      expect(sourceSvg).toContain(path);
      expect(lightSvg).toContain(path);
      expect(darkSvg).toContain(path);
    }
    for (const svg of [sourceSvg, lightSvg, darkSvg]) {
      expect(svg).toContain("#0B3157");
      expect(svg).toContain("#EAA63A");
      expect(svg).toContain("#FFFFFF");
    }
    expect(lightSvg).toContain('<text x="264" y="183" fill="#0B3157"');
    expect(darkSvg).toContain('<text x="264" y="183" fill="#FFFFFF"');
  });

  it("selects explicit SVG variants without Axora logo color filters", async () => {
    const brand = await source("src/components/Brand.tsx");
    expect(brand).toContain("/brand/axora-logo-${appearance}.svg");
    expect(brand).not.toMatch(/invert\(|brightness\(|hue-rotate\(/);
  });
});
