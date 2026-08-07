import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const companiesPageUrl = new URL(
  "../src/app/(portal)/companies/page.tsx",
  import.meta.url,
);
const branchesPageUrl = new URL(
  "../src/app/(portal)/branches/page.tsx",
  import.meta.url,
);

describe("organization directory UI isolation", () => {
  it("routes company and branch directories through the trusted snapshot", async () => {
    const [companiesPage, branchesPage] = await Promise.all([
      readFile(companiesPageUrl, "utf8"),
      readFile(branchesPageUrl, "utf8"),
    ]);

    expect(companiesPage).toContain("loadOrganizationDirectory(actor)");
    expect(branchesPage).toContain("loadOrganizationDirectory(actor)");
    expect(companiesPage).not.toContain("listCompanies");
    expect(branchesPage).not.toContain("listCompanies");
    expect(branchesPage).not.toContain("listBranches");
  });

  it("does not render branch financial values without field-level visibility", async () => {
    const branchesPage = await readFile(branchesPageUrl, "utf8");
    expect(branchesPage).toContain("branch.canViewBudget");
    expect(branchesPage).toContain("showBudgetColumns");
    expect(branchesPage).toContain("committedAmount ?? 0");
    expect(branchesPage).toContain("remainingAmount == null");
  });
});
