import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("company setup presentation regression boundaries", () => {
  it("keeps active setup tabs and wallet actions on the shared primary-button contract", async () => {
    const [nav, tokens, walletPage, walletCss] = await Promise.all([
      source("src/components/CompanyWorkspaceNav.tsx"),
      source("src/app/appearance-tokens.css"),
      source("src/app/(portal)/wallet/page.tsx"),
      source("src/app/(portal)/wallet/Wallet.module.css"),
    ]);
    expect(nav).toContain("company-workspace-tab button");
    expect(nav).toContain('"button-primary is-active"');
    expect(tokens).toContain(".company-workspace-nav .button-primary:visited");
    expect(tokens).toContain("var(--axora-brand-foreground)");
    expect(walletPage).toContain("button button-primary ${styles.openWallet}");
    expect(walletCss).toContain("a.openWallet:visited");
  });

  it("renders grouped branch and product information without changing commercial visibility", async () => {
    const [branch, product, css] = await Promise.all([
      source("src/app/(portal)/branches/[branchId]/page.tsx"),
      source("src/app/(portal)/products/[id]/page.tsx"),
      source("src/app/globals.css"),
    ]);
    expect(branch).toContain("branch-detail-layout");
    expect(branch).toContain("information-groups");
    expect(product).toContain("Product details");
    expect(product).toContain("Authorized pricing");
    expect(product).toContain('canAccess(actor, "view_internal_cost")');
    expect(product).toContain("canViewCost ?");
    expect(css).toContain(".information-list");
    expect(css).toContain(".metric-information-list");
  });

  it("uses the existing reviewed logo endpoint and retains a no-logo state", async () => {
    const overview = await source("src/app/(portal)/companies/[companyId]/page.tsx");
    expect(overview).toContain("getCompanyBrandReviewWorkspace(company.id, actor)");
    expect(overview).toContain("/api/company-brand/${company.id}/logo?theme=");
    expect(overview).toContain("overview.noLogo");
  });

  it("keeps the company wallet route owner-only while serving a setup company without a 404", async () => {
    const wallet = await source("src/app/(portal)/companies/[companyId]/wallet/page.tsx");
    expect(wallet).toContain('requirePagePermission("view_wallet")');
    expect(wallet).toContain('if (!actor.isOwner) redirect("/access-denied")');
    expect(wallet).toContain("if (!wallet) {");
    expect(wallet).toContain("Wallet setup is pending");
    expect(wallet).not.toContain("if (!wallet) notFound()");
  });
});
