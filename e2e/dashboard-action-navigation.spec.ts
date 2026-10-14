import { expect, test } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

test.describe.configure({ retries: 0 });

const companyId = "11111111-1111-4111-8111-111111111111";
const companyActor: DemoRoleSession = {
  id: "30333333-3333-4333-8333-333333333337",
  email: "dashboard-navigation@axora.invalid",
  name: "Dashboard navigation fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
};

for (const [locale, budgets, requests] of [
  ["en", "Budgets", "Review requests"],
  ["ar", "الميزانيات", "مراجعة الطلبات"],
  ["ms", "Bajet", "Semak permintaan"],
] as const) {
  test(`Company Administrator dashboard opens budgets and requests in ${locale}`, async ({ page }) => {
    await signInAsDemoRole(page, { ...companyActor, preferredLocale: locale });
    await page.goto("/dashboard");
    const actions = page.locator(".dashboard-role-actions");
    const budgetLink = actions.getByRole("link", { name: budgets, exact: true });
    await expect(budgetLink).toHaveAttribute("href", "/budgets");
    await budgetLink.click();
    await expect(page).toHaveURL(/\/budgets$/);
    await expect(page.locator("#portal-main h1")).toBeVisible();
    await expect(page.getByText("This page could not be restored")).toHaveCount(0);

    await page.goto("/dashboard");
    const requestLink = actions.getByRole("link", { name: requests, exact: true });
    await expect(requestLink).toHaveAttribute("href", "/requests");
    await requestLink.click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.locator("#portal-main h1")).toBeVisible();
    await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  });
}

test("Operations dashboard opens paid requests, deliveries, catalog and branches", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  await signInAsDemoRole(page, {
    id: "30333333-3333-4333-8333-333333333339",
    email: "dashboard-operations@axora.invalid",
    name: "Operations navigation fixture",
    role: "PLATFORM_OPERATIONS",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
  });
  for (const [label, destination] of [
    ["Review paid requests", "/requests"],
    ["Coordinate deliveries", "/deliveries"],
    ["Manage catalog", "/products"],
    ["Company operations", "/branches"],
  ]) {
    await page.goto("/dashboard");
    const link = page.locator(".dashboard-role-actions").getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", destination);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.locator("#portal-main h1")).toBeVisible();
  }
  expect(failures).toEqual([]);
});

for (const [role, count] of [["FINANCE_REVIEWER", 4], ["AUDITOR", 3]] as const) {
  test(`${role} dashboard renders complete usable action links`, async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", error => failures.push(error.message));
    await signInAsDemoRole(page, { ...companyActor, role });
    await page.goto("/dashboard");
    const links = page.locator(".dashboard-role-actions a");
    await expect(links).toHaveCount(count);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", /^\/(requests|deliveries)$/);
    }
    const history = links.filter({ hasText: "Request history" });
    await history.click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.locator("#portal-main h1")).toBeVisible();
    expect(failures).toEqual([]);
  });
}
