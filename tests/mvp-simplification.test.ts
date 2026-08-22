import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Prompt 12 internal MVP surface", () => {
  it("retires CRM, assignment, help, diagnostics, reports, audit and settings routes", async () => {
    const routes = await Promise.all([
      "companies/leads/page.tsx", "companies/leads/new/page.tsx",
      "companies/leads/[leadId]/page.tsx",
    ].map((path) => source(`src/app/(portal)/${path}`)));
    for (const route of routes) expect(route).toContain('permanentRedirect("/companies")');
    for (const path of ["help", "support", "reports", "audit"]) {
      expect(await source(`src/app/(portal)/${path}/page.tsx`)).toContain('redirect("/dashboard")');
    }
    expect(await source("src/app/(portal)/settings/page.tsx")).toContain('redirect("/profile")');
    const navigation = await source("src/lib/portal-navigation.ts");
    for (const href of ["/help", "/support", "/reports", "/audit", "/companies/leads"]) {
      expect(navigation).not.toContain(`href: "${href}"`);
    }
    expect(navigation).not.toContain("Insights & controls");
  });

  it("uses the short direct-company form and redirects to the new workspace", async () => {
    const [page, actions] = await Promise.all([
      source("src/app/(portal)/companies/new/page.tsx"),
      source("src/app/(portal)/masters/actions.ts"),
    ]);
    for (const field of ["name", "mainContactName", "legalName", "industry", "websiteUrl", "logo"]) {
      expect(page).toContain(`name="${field}"`);
    }
    for (const field of ["billingCycle", "companyInformation", "notes", "manager", "reason"]) {
      expect(page).not.toContain(`name="${field}"`);
    }
    expect(page).not.toMatch(/name="logo"[^>]*required/);
    expect(actions).toContain('requirePermission("create_companies")');
    expect(actions).toContain("createCompanyWithoutBrand");
    expect(actions).toContain("/companies/${created.companyId}?notice=company-created");
  });

  it("keeps Company Setup compact and removes the CRM verification console", async () => {
    const [page, migration] = await Promise.all([
      source("src/app/(portal)/companies/[companyId]/onboarding/page.tsx"),
      source("database/migrations/107_mvp_simplification.sql"),
    ]);
    for (const field of ["legalName", "mainContactName", "industryCode", "defaultLocale", "timezone"]) {
      expect(page).toContain(`name="${field}"`);
    }
    for (const removed of ["exceptionReason", "responsibleUserId", "billingCycle", "registrationCountryCode", "submitCompanyVerificationAction", "Duplicate risk"]) {
      expect(page).not.toContain(removed);
    }
    expect(migration).not.toContain("THEN ARRAY['DUPLICATE_REVIEW']");
    expect(migration).not.toContain("THEN ARRAY['ONBOARDING_VERIFICATION']");
  });

  it("keeps ordinary representative workflows free of typed audit reasons", async () => {
    const files = await Promise.all([
      "src/app/(portal)/companies/new/page.tsx",
      "src/app/(portal)/users/[id]/access/page.tsx",
      "src/app/(portal)/products/new/page.tsx",
      "src/app/(portal)/budgets/page.tsx",
      "src/components/BudgetCycleManagement.tsx",
      "src/components/RequestApprovalDecisionForm.tsx",
      "src/app/(portal)/email-operations/page.tsx",
      "src/components/role-portals/DeliveryTrackingPanels.tsx",
    ].map(source));
    for (const file of files) {
      expect(file).not.toMatch(/name=[{]?['"](?:reason|explanation|auditReason)/);
    }
  });

  it("provides an Owner-only compact Email Status page with safe retry only", async () => {
    const [page, actions] = await Promise.all([
      source("src/app/(portal)/email-operations/page.tsx"),
      source("src/app/(portal)/email-operations/actions.ts"),
    ]);
    expect(page).toContain("Email Status");
    expect(page).toContain("!actor.isOwner || actor.accountKind !== \"PLATFORM\"");
    expect(page).toContain("slice(0, 20)");
    expect(page).toContain('name="action" value="RETRY"');
    for (const removed of ["Pause Agent", "Resume Agent", "RecipientReveal", "correlationId", "providerAgent"]) {
      expect(page).not.toContain(removed);
    }
    expect(actions).toContain('action: z.literal("RETRY")');
    expect(actions).toContain('reason: z.literal("EMAIL_RETRY_REQUESTED")');
    expect(actions).not.toContain("REVEAL");
  });

  it("makes Manage Products sufficient while keeping commercial history separate", async () => {
    const [actions, edit, migration] = await Promise.all([
      source("src/app/(portal)/masters/actions.ts"),
      source("src/app/(portal)/products/[id]/edit/page.tsx"),
      source("database/migrations/107_mvp_simplification.sql"),
    ]);
    expect(actions).toContain('requirePermission("manage_catalog")');
    expect(actions).not.toContain('requirePermission("manage_commercial_pricing")');
    expect(edit).toContain('requirePagePermission("manage_catalog")');
    expect(edit).toContain('canAccess(actor, "manage_commercial_pricing")');
    expect(migration).toContain("$new$'product.manage'$new$");
  });

  it("removes the user-manual build pipeline while retaining business PDF code", async () => {
    const [pkg, workflow, requestPdf] = await Promise.all([
      source("package.json"),
      source(".github/workflows/quality.yml"),
      source("src/lib/generated-documents.ts"),
    ]);
    expect(pkg).not.toMatch(/manuals:(?:build|validate|verify)/);
    expect(workflow).not.toContain("manuals:");
    expect(requestPdf.length).toBeGreaterThan(100);
  });

  it("removes public Help copy and sends invitation assistance to Contact", async () => {
    const [i18n, shell, email] = await Promise.all([
      source("src/lib/i18n.ts"),
      source("src/components/public/PublicShell.tsx"),
      source("server-tools/account-setup-email.mjs"),
    ]);
    expect(i18n).not.toContain('"help",');
    expect(shell).not.toContain("footer.help");
    expect(email).toContain('new URL(`/${locale}/contact`');
    expect(email).not.toContain('new URL(`/${locale}/help`');
  });
});
