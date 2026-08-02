import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const removedLegacyComponents = [
  "../src/components/Sidebar.tsx",
  "../src/components/CatalogPicker.tsx",
  "../src/components/ProductCatalog.tsx",
] as const;

describe("legacy portal UI removal", () => {
  it("does not retain the sidebar or superseded English-only catalog components", async () => {
    for (const path of removedLegacyComponents) {
      await expect(access(new URL(path, import.meta.url))).rejects.toThrow();
    }
  });

  it("keeps the active shell top-navigation and locale driven", async () => {
    const shell = await readFile(
      new URL("../src/components/app-shell/AppShell.tsx", import.meta.url),
      "utf8",
    );
    const shop = await readFile(
      new URL("../src/components/ShopCategoryHub.tsx", import.meta.url),
      "utf8",
    );

    expect(shell).toContain('className="app-topbar"');
    expect(shell).toContain('className="app-primary-nav"');
    expect(shell).toContain("portalMessages(locale)");
    expect(shell).not.toMatch(/<Sidebar\b|from ["'][^"']*Sidebar["']/);
    expect(shop).toContain("shopMessages(locale)");
  });
});
