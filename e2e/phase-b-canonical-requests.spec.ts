import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyAdmin: DemoRoleSession = {
  id: "30333333-3333-4333-8333-333333333333",
  email: "company-admin.phase-b@axora.invalid",
  name: "Company administrator fixture",
  role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY",
  companyId: "11111111-1111-4111-8111-111111111111",
};

const cam: DemoRoleSession = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "cam.phase-b@axora.invalid",
  name: "Client Account Manager fixture",
  role: "CLIENT_ACCOUNT_MANAGER", accountKind: "PLATFORM", scopeType: "PLATFORM",
};

test("Owner sees one completed order record with invoice, delivery, proof and tracking", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests/order-9");

  await expect(page.getByRole("heading", { level: 1, name: "ORD-2026-009" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Invoice" })).toBeVisible();
  await expect(page.getByText("CINV-DEMO-009", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Delivery & tracking" })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Proof of Delivery" })).toBeVisible();
  await expect(page.getByText("No customer-visible proof is available yet.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/latitude|longitude|storage path|OTP secret/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

for (const [name, actor] of [["Company Admin", companyAdmin], ["CAM", cam]] as const) {
  test(`${name} uses Requests instead of standalone Invoices or Receiving`, async ({ page }) => {
    await signInAsDemoRole(page, actor);
    await page.goto("/requests");
    await expect(page.getByRole("heading", { level: 1, name: "Purchase requests" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invoices", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Receiving", exact: true })).toHaveCount(0);

    await page.goto("/receiving");
    await expect(page).toHaveURL(/\/requests$/);
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/requests$/);
  });
}

test("Owner Finance remains a cross-company operational workspace", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Invoices and payments" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Invoice register" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Payment register" })).toBeVisible();
});
