import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { productSchema } from "@/lib/validation";
import { allowedNextStatuses } from "@/lib/workflow";
import { ACCOUNT_ROLE_CATALOG } from "@/lib/role-catalog";

const source = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("operating model simplification", () => {
  it("keeps catalogue validation narrow and returns structured product outcomes", async () => {
    const [page, actions] = await Promise.all([
      source("src/app/(portal)/products/page.tsx"),
      source("src/app/(portal)/masters/actions.ts"),
    ]);
    expect(productSchema.safeParse({
      name: "Paper", category: "Office", subcategory: "Paper", unit: "ream",
      defaultBuyPrice: 10, defaultSellPrice: 11, deliverySlaDays: 1,
    }).success).toBe(true);
    for (const retired of [
      "minimumOrderQuantity", "maximumOrderQuantity", "orderIncrement",
      "packUnit", "quantityRuleReason", "quantityRuleEffectiveFrom",
    ]) expect(page).not.toContain(`name="${retired}"`);
    expect(actions).toContain("ProductActionState");
    expect(actions).toContain("product-created-image-retry");
    expect(actions.indexOf("createProduct(input, user)")).toBeLessThan(
      actions.indexOf("savePreparedProductImages({"),
    );
    expect(actions).toContain("redirectTo: `/products/${productId}/edit?notice=product-created-image-retry`");
    expect(actions).toContain('redirectTo: "/products?notice=product-updated"');
  });

  it("removes live sourcing, supplier, and document workspaces", async () => {
    const navigation = await source("src/lib/portal-navigation.ts");
    expect(navigation).not.toContain('href: "/sourcing"');
    expect(navigation).not.toContain('href: "/suppliers"');
    expect(navigation).not.toContain('href: "/documents"');
  });

  it("keeps only essential invoice registers", async () => {
    const finance = await source("src/app/(portal)/finance/page.tsx");
    expect(finance).toContain("invoiceRegister");
    expect(finance).toContain("paymentRegister");
    expect(finance).not.toContain("FinanceManagementForms");
    expect(finance).not.toContain("CustomerMatch");
    await expect(source("src/components/FinanceManagementForms.tsx")).rejects.toThrow();
    await expect(source("src/app/(portal)/documents/page.tsx")).rejects.toThrow();
  });

  it("uses HR, Agent, and Delivery Guy role templates", () => {
    const visible = ACCOUNT_ROLE_CATALOG.filter((role) => role.availableForCreation !== false)
      .map((role) => role.key);
    expect(visible).toContain("HUMAN_RESOURCES_MANAGEMENT");
    expect(visible).toContain("CLIENT_ACCOUNT_MANAGER");
    expect(visible).toContain("DELIVERY_GUY");
    expect(visible).not.toContain("DELIVERY_AGENT");
    expect(visible).not.toContain("DELIVERY_TEAM_SUPERVISOR");
  });

  it("moves approved work directly toward paid delivery", () => {
    expect(allowedNextStatuses("Under Verification")).toContain("Approved");
    expect(allowedNextStatuses("Approved")).toContain("Preparing for Delivery");
    expect(allowedNextStatuses("Approved")).not.toContain("Supplier Assigned");
  });

  it("silently restores scoped safe form progress", async () => {
    const drafts = await source("src/components/PortalDraftManager.tsx");
    expect(drafts).toContain("sessionStorage");
    expect(drafts).toContain("scopeKey");
    expect(drafts).not.toContain("Progress saved");
    expect(drafts).not.toContain("Saved progress restored");
  });

  it("adds forward-only HR, Agent, and paid-delivery enforcement", async () => {
    const migration = await source("database/migrations/080_operating_model_simplification.sql");
    expect(migration).toContain("HUMAN_RESOURCES_MANAGEMENT");
    expect(migration).toContain("CLIENT_ACCOUNT_MANAGER");
    expect(migration).toContain("delivery_jobs_paid_request_guard");
    expect(migration).toContain("payment.payment_status='PAID'");
    expect(migration).toMatch(/roleKey'[^\n]*HUMAN_RESOURCES_MANAGEMENT/);
    expect(migration).toMatch(/roleKey'[^\n]*CLIENT_ACCOUNT_MANAGER/);
    expect(migration).toContain("'Under Verification'),\n   public.lookup_id('request_status','Approved')");
    expect(migration).toContain("'Approved'),\n   public.lookup_id('request_status','Preparing for Delivery')");
    expect(migration).not.toContain("'preferredSupplierName'");
    expect(migration).not.toContain("'minimumOrderQuantity'");
    expect(migration).not.toContain("TRUNCATE");
  });

  it("does not expose supplier selection or ungranted financial columns", async () => {
    const [reader, dashboard, reports] = await Promise.all([
      source("src/lib/request-reader.ts"),
      source("src/app/(portal)/dashboard/page.tsx"),
      source("src/app/(portal)/reports/page.tsx"),
    ]);
    expect(reader).toContain('NULL::text AS "supplierName"');
    expect(dashboard).toContain('canAccess(actor, "view_platform_profit")');
    expect(reports).toContain('redirect("/dashboard")');
  });
});
