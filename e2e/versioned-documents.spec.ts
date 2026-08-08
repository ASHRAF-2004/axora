import { expect, test } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyAdmin: DemoRoleSession = {
  id: "66666666-6666-4666-8666-666666666666",
  email: "company-admin.fixture@axora.invalid",
  name: "Company administrator fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "11111111-1111-4111-8111-111111111111",
};

const supplier: DemoRoleSession = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "supplier.fixture@axora.invalid",
  name: "Supplier fixture",
  role: "SUPPLIER_USER",
  accountKind: "SUPPLIER",
  scopeType: "SUPPLIER",
  supplierId: "33333333-3333-4333-8333-333333333333",
};

test("company document history keeps the established portal heading and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/documents");

  await expect(page.locator("#generated-documents-documents")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(2);
});

test("supplier PO history preserves Arabic RTL, reduced motion and supplier isolation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, { ...supplier, preferredLocale: "ar" });
  await page.goto("/supplier");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#generated-documents-supplier")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(2);
});
