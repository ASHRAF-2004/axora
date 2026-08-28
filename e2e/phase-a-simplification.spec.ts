import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const companyAdmin: DemoRoleSession = {
  id: "30333333-3333-4333-8333-333333333333",
  email: "company-admin.phase-a@axora.invalid",
  name: "Company administrator fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
};

test("Owner deliberately selects a company before seeing Wallet financial data", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/wallet");

  await expect(page.getByRole("heading", { level: 1, name: "Company Wallets" }))
    .toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search companies" }))
    .toBeVisible();
  await expect(page.getByText("Available balance", { exact: true })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/MYR\s*[\d,.]+/);

  const walletLink = page.getByRole("link", { name: "Open wallet" }).first();
  await expect(walletLink).toBeVisible();
  await walletLink.click();
  await expect(page).toHaveURL(/\/companies\/[^/]+\/wallet$/);
  await expect(page.getByText("Available balance", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Wallet ledger" }))
    .toBeVisible();
});

test("Company Admin opens its own Wallet directly and profile menu has no duplicate Settings", async ({ page }) => {
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/wallet");

  await expect(page.getByText("Available balance", { exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search companies" })).toHaveCount(0);
  await page.locator(".app-profile-button").click();
  const menu = page.locator("#app-profile-menu");
  await expect(menu.getByRole("menuitem", { name: "My Profile" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Settings", exact: true })).toHaveCount(0);
});
