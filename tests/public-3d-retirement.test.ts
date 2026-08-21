import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { PUBLIC_PAGE_SLUGS } from "@/lib/i18n";

const read = (path: string) => readFileSync(path, "utf8");

describe("retired public Operations Experience", () => {
  it("removes the desktop, mobile, and footer navigation contract in every locale", () => {
    const shell = read("src/components/public/PublicShell.tsx");
    expect(shell).not.toMatch(/operations-experience|Operations Experience|تجربة العمليات|Pengalaman Operasi/);
    expect(shell).toContain("<PublicMobileMenu");
    expect(shell).toContain("navigation={navigation}");
    expect(shell).toContain("messages.nav.how");
    expect(shell).toContain("messages.nav.process");
    expect(shell).toContain("publicMessages(locale)");
  });

  it("keeps a locale-safe permanent redirect with no scene runtime", () => {
    expect(existsSync("src/app/[locale]/operations-experience/page.tsx")).toBe(false);
    const config = read("next.config.ts");
    expect(config).toContain('source: "/:locale(en|ar|ms)/operations-experience"');
    expect(config).toContain('destination: "/:locale/how-it-works"');
    expect(config).toContain("permanent: true");
    expect(config).not.toMatch(/AxoraImmersiveExperience|Canvas|WebGL/);
  });

  it("removes scene code, assets, and production dependencies", () => {
    for (const path of [
      "src/components/public/AxoraImmersiveExperience.tsx",
      "src/components/public/AxoraSemanticSceneCanvas.tsx",
      "src/lib/immersive-public-experience.ts",
      "src/lib/public-scene-states.ts",
      "public/immersive",
    ]) expect(existsSync(path), path).toBe(false);

    const packageJson = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    for (const dependency of ["@react-three/drei", "@react-three/fiber", "three"]) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency);
    }
  });

  it("keeps ordinary public routes and excludes the retired route from discovery", () => {
    expect(PUBLIC_PAGE_SLUGS).toEqual(expect.arrayContaining(["how-it-works", "procurement-process"]));
    expect(PUBLIC_PAGE_SLUGS).not.toContain("operations-experience");
    expect(sitemap().map((entry) => entry.url).join("\n")).not.toContain("operations-experience");
    const linkValidator = read("scripts/validate-public-links.mjs");
    expect(linkValidator).toContain('"/en/how-it-works"');
    expect(linkValidator).toContain('"/en/procurement-process"');
    expect(linkValidator).not.toContain("operations-experience");
  });
});
