import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), workspace: vi.fn(), locale: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePagePermission: mocks.requirePermission }));
vi.mock("@/lib/budget-ledger", () => ({ getBudgetWorkspace: mocks.workspace }));
vi.mock("@/lib/locale-server", () => ({ requestLocaleDecision: mocks.locale }));
vi.mock("@/components/Brand", () => ({ Brand: () => createElement("span", null, "Axora") }));
vi.mock("@/components/AccountSetupClient", () => ({ AccountSetupClient: () => createElement("article", { className: "login-card" }, "Invitation state") }));

import BudgetsPage from "@/app/(portal)/budgets/page";
import SetupPage from "@/app/account/setup/page";

describe("recovery workspace presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ accountKind: "COMPANY", companyId: "company-fixture", preferredLocale: "en" });
    mocks.locale.mockResolvedValue({ locale: "en" });
    mocks.workspace.mockResolvedValue({ accounts: [
      { id: "account-fixture", companyId: "company-fixture", levelType: "BRANCH", branchId: "branch-fixture", name: "Fixture branch budget", code: "BR-001", recurringAllocation: "1000.00", currency: "MYR", refreshInterval: "MONTHLY", period: { allocated: "1500.00", available: "1234.50" } },
      { id: "foreign-fixture", companyId: "other-company", levelType: "BRANCH", branchId: "foreign-branch", name: "Foreign branch", recurringAllocation: "999.00" },
    ] });
  });

  it.each(["en", "ar", "ms"] as const)("renders the existing budget values and scope in %s with labelled scrollable table columns", async (locale) => {
    mocks.requirePermission.mockResolvedValue({ accountKind: "COMPANY", companyId: "company-fixture", preferredLocale: locale });
    const html = renderToStaticMarkup(await BudgetsPage());
    expect(html.match(/scope="col"/g)).toHaveLength(6);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Fixture branch");
    expect(html).toContain("BR-001");
    expect(html).toContain("/budgets/branch-fixture");
    expect(html).not.toContain("foreign-branch");
    const format = new Intl.NumberFormat(locale, { style: "currency", currency: "MYR", currencyDisplay: "narrowSymbol" });
    expect(html).toContain(format.format(1500));
    expect(html).toContain(format.format(1234.5));
  });

  it.each(["en", "ar", "ms"] as const)("uses the existing compact account design in %s without changing invitation transport", async (locale) => {
    mocks.locale.mockResolvedValue({ locale });
    const html = renderToStaticMarkup(await SetupPage());
    expect(html).toContain("simple-auth-page account-setup-shell");
    expect(html).not.toContain("login-story");
    expect(html).toContain('dir="' + (locale === "ar" ? "rtl" : "ltr") + '"');
    expect(html).toContain("Invitation state");
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain("token=");
  });
});
