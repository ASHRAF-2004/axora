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

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
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
