import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

describe("single-purpose portal routes", () => {
  it("keeps the branch list read-only and moves mutations to one branch detail", async () => {
    const [list,detail] = await Promise.all([
      readFile("src/app/(portal)/branches/page.tsx","utf8"),
      readFile("src/app/(portal)/branches/[branchId]/page.tsx","utf8"),
    ]);
    expect(list).not.toContain("setBranchBudgetAction");
    expect(list).not.toContain("setMasterActiveAction");
    expect(list).toContain("/branches/${branch.id}");
    expect(detail).not.toContain("setBranchBudgetAction");
    expect(detail).toContain("/budgets/${branch.id}");
    expect(detail).toContain("setMasterActiveAction");
  });

  it("separates product list, creation, detail and editing", async () => {
    const [list,create,detail,edit] = await Promise.all([
      readFile("src/app/(portal)/products/page.tsx","utf8"),
      readFile("src/app/(portal)/products/new/page.tsx","utf8"),
      readFile("src/app/(portal)/products/[id]/page.tsx","utf8"),
      readFile("src/app/(portal)/products/[id]/edit/page.tsx","utf8"),
    ]);
    expect(list).toContain("/products/${product.id}");
    expect(list).not.toContain("ProductActionForm");
    expect(create).toContain("ProductActionForm");
    expect(create).not.toContain("listProducts");
    expect(detail).toContain("Catalog record");
    expect(detail).not.toContain("ProductActionForm");
    expect(edit).toContain("ProductActionForm");
  });

  it("keeps customer budgets out of platform-owner navigation and routes", async () => {
    const [navigation,budgetPage] = await Promise.all([
      readFile("src/lib/portal-navigation.ts","utf8"),
      readFile("src/app/(portal)/budgets/page.tsx","utf8"),
    ]);
    expect(navigation).toContain('href: "/budgets", label: "Budgets", permission: "view_budgets", companyOnly: true');
    expect(budgetPage).toContain('actor.accountKind !== "COMPANY"');
    expect(budgetPage).toContain('redirect("/access-denied")');
  });

  it("uses authenticated SSE for notification summaries with polling only as fallback", async () => {
    const [route,shell] = await Promise.all([
      readFile("src/app/api/notifications/summary/stream/route.ts","utf8"),
      readFile("src/components/app-shell/AppShell.tsx","utf8"),
    ]);
    expect(route).toContain("getSession()");
    expect(route).toContain("snapshotEventStream");
    expect(shell).toContain('new EventSource("/api/notifications/summary/stream"');
    expect(shell).toContain('!("EventSource" in window)');
  });
});
