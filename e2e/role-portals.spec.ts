import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";

const principals = {
  hr: { id: "10111111-1111-4111-8111-111111111111", email: "hr.fixture@axora.invalid", name: "HR fixture", role: "HUMAN_RESOURCES_MANAGEMENT", accountKind: "PLATFORM", scopeType: "PLATFORM" },
  agent: { id: "20222222-2222-4222-8222-222222222222", email: "agent.fixture@axora.invalid", name: "Agent fixture", role: "CLIENT_ACCOUNT_MANAGER", accountKind: "PLATFORM", scopeType: "PLATFORM" },
  companyAdmin: { id: "30333333-3333-4333-8333-333333333333", email: "company-admin.fixture@axora.invalid", name: "Company administrator fixture", role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", companyId },
  branchAdmin: { id: "40444444-4444-4444-8444-444444444444", email: "branch-admin.fixture@axora.invalid", name: "Branch administrator fixture", role: "BRANCH_ADMIN", accountKind: "COMPANY", scopeType: "BRANCH", companyId, branchId },
  requester: { id: "50555555-5555-4555-8555-555555555555", email: "requester.fixture@axora.invalid", name: "Requester fixture", role: "REQUESTER", accountKind: "COMPANY", scopeType: "BRANCH", companyId, branchId },
  approver: { id: "60666666-6666-4666-8666-666666666666", email: "approver.fixture@axora.invalid", name: "Approver fixture", role: "COMPANY_APPROVER", accountKind: "COMPANY", scopeType: "COMPANY", companyId },
  deliveryGuy: { id: "70777777-7777-4777-8777-777777777777", email: "delivery.fixture@axora.invalid", name: "Delivery Guy fixture", role: "DELIVERY_GUY", accountKind: "DELIVERY", scopeType: "DELIVERY" },
} satisfies Record<string, DemoRoleSession>;

async function expectShell(page: Parameters<typeof signInAsDemoRole>[0]) {
  await expect(page.locator("main.app-content")).toBeVisible();
  await expect(page.locator("header.app-topbar")).toBeVisible();
  await expect(page.locator("header.app-topbar").getByRole("button").first()).toBeVisible();
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
}

test("Human Resources Management assigns and monitors leads without financial access", async ({ page }) => {
  await signInAsDemoRole(page, principals.hr);
  await page.goto("/dashboard");
  await expect(page.locator("main").getByText("Human Resources Management", { exact: true })).toBeVisible();
  await expectShell(page);
  await page.goto("/companies/leads");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Agent sees assigned company operations without platform financial fields", async ({ page }) => {
  await signInAsDemoRole(page, principals.agent);
  await page.goto("/dashboard");
  await expect(page.getByText("Client Account Manager workspace", { exact: true })).toBeVisible();
  await expectShell(page);
  await page.goto("/companies");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByText(/customer sales|buying cost|gross profit|gross margin/i)).toHaveCount(0);
});

test("company and branch administrators retain scoped people, budget and request work", async ({ page }) => {
  await signInAsDemoRole(page, principals.companyAdmin);
  await page.goto("/users");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("heading", { level: 1, name: "Shop for your branch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create global product" })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAsDemoRole(page, principals.branchAdmin);
  await page.goto("/branches");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Requester submits but cannot approve, while Approver cannot create requests", async ({ page }) => {
  await signInAsDemoRole(page, principals.requester);
  await page.goto("/requests/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create purchase request" })).toBeVisible();
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/access-denied$/);

  await page.context().clearCookies();
  await signInAsDemoRole(page, principals.approver);
  await page.goto("/approvals");
  await expect(page.getByText(/cannot approve your own request/i)).toBeVisible();
  await page.goto("/requests/new");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Delivery Guy receives only the assigned buying and delivery workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoRole(page, principals.deliveryGuy);
  await page.goto("/driver");
  await expect(page.getByRole("heading", { level: 1, name: "Assigned deliveries" })).toBeVisible();
  await expectShell(page);
  await page.goto("/finance");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Platform Owner retains full authority and financial visibility", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/reports");
  const reports = page.getByRole("main");
  await expect(reports.getByText("Customer sales", { exact: true })).toBeVisible();
  await expect(reports.getByText(/^(Supplier buying cost|Internal buying cost)$/i).first()).toBeVisible();
  await expect(reports.getByText("Gross margin", { exact: true })).toBeVisible();
});

test("Arabic company dashboard remains RTL, mobile-safe and reduced-motion aware", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, { ...principals.companyAdmin, preferredLocale: "ar" });
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectShell(page);
});
