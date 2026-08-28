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

test("company finance compatibility redirects to Requests and fits mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/finance");

  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("heading", { level: 1, name: "Purchase requests" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Invoice register" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Payment register" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.screenshot({ path: `output/playwright/request-finance-compatibility-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(2);
});
