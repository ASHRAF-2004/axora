import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Client Account Manager catalog workspace", () => {
  it("keeps CAM catalog access out of the branch-shopping branch", async () => {
    const page = await source("src/app/(portal)/products/page.tsx");

    expect(page).toContain('const isCamCatalogViewer = actor.role === "CLIENT_ACCOUNT_MANAGER"');
    expect(page).toContain("if (!canManageCatalog && !isCamCatalogViewer)");
    expect(page).toContain("isCamCatalogViewer ? copy.management : copy.title");
    expect(page).toContain("{canManageCatalog ? <div className=\"page-actions\">");
    expect(page).toContain("{canManageCatalog ? <>");
  });

  it("allows CAM to inspect an authorized catalog record without granting edit access", async () => {
    const detail = await source("src/app/(portal)/products/[id]/page.tsx");

    expect(detail).toContain('requirePagePermission("view_catalog")');
    expect(detail).toContain('actor.role !== "CLIENT_ACCOUNT_MANAGER"');
    expect(detail).toContain("const canEdit = canManage");
  });
});
