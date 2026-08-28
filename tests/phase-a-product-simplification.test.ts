import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { legalPageContent } from "@/lib/legal-pages";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Phase A public and portal information architecture", () => {
  it("publishes complete localized legal pages and canonical footer links", async () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      for (const kind of ["terms-and-conditions", "privacy-policy"] as const) {
        const page = legalPageContent(locale, kind);
        expect(page.effectiveDate).toBeTruthy();
        expect(page.version).toBe("1.0");
        expect(page.sections.length).toBeGreaterThanOrEqual(10);
        expect(page.contactBody).toContain("support@axora.management");
      }
    }
    const footer = await source("src/components/public/PublicShell.tsx");
    expect(footer).toContain("/terms-and-conditions");
    expect(footer).toContain("/privacy-policy");
    expect(footer).not.toContain('`${prefix}/privacy`');
    expect(footer).not.toContain('`${prefix}/terms`');
  });

  it("keeps one visible personal-profile entry while retaining compatibility routes", async () => {
    const [shell, settings] = await Promise.all([
      source("src/components/app-shell/AppShell.tsx"),
      source("src/app/(portal)/settings/page.tsx"),
    ]);
    expect(shell).toContain('href="/profile"');
    expect(shell).not.toContain('href="/settings"');
    expect(settings).toContain('redirect("/profile")');
  });

  it("makes the Owner Wallet company-first without projecting balances on the index", async () => {
    const [index, detail] = await Promise.all([
      source("src/app/(portal)/wallet/page.tsx"),
      source("src/app/(portal)/companies/[companyId]/wallet/page.tsx"),
    ]);
    const ownerIndex = index.slice(index.indexOf("if (actor.isOwner)"), index.indexOf("const workspace ="));
    expect(ownerIndex).toContain("loadCompanyLifecycleWorkspace");
    expect(ownerIndex).toContain("company.code");
    expect(ownerIndex).toContain("company.active");
    expect(ownerIndex).toContain("/companies/${encodeURIComponent(company.id)}/wallet");
    expect(ownerIndex).not.toContain("availableBalance");
    expect(index).not.toContain("workspace.wallets[0]");
    expect(index).toContain("getCompanyWalletWorkspace(actor, actor.companyId)");
    expect(detail).toContain('if (!actor.isOwner) redirect("/access-denied")');
    expect(detail).toContain("getCompanyWalletWorkspace(actor, company.id)");
  });
});
