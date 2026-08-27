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
  deliveryGuy: { id: "70777777-7777-4777-8777-777777777777", email: "delivery.fixture@axora.invalid", name: "Delivery Agent fixture", role: "DELIVERY_GUY", accountKind: "DELIVERY", scopeType: "DELIVERY" },
} satisfies Record<string, DemoRoleSession>;

async function expectShell(page: Parameters<typeof signInAsDemoRole>[0]) {
  await expect(page.locator("main.app-content")).toBeVisible();
  await expect(page.locator("header.app-topbar")).toBeVisible();
  await expect(page.locator("header.app-topbar").getByRole("button").first()).toBeVisible();
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
}

test("Human Resources Management reaches companies while retired routes return to the dashboard", async ({ page }) => {
  await signInAsDemoRole(page, principals.hr);
  await page.goto("/dashboard");
  await expect(page.locator("main").getByText("Human Resources Management", { exact: true })).toBeVisible();
  await expectShell(page);
  await page.goto("/companies/leads");
  await expect(page).toHaveURL(/\/companies$/);
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("Agent sees assigned company operations without platform financial fields", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInAsDemoRole(page, principals.agent);
  await page.goto("/dashboard");
  await expect(page.getByText("Client Account Manager workspace", { exact: true })).toBeVisible();
  await expectShell(page);
  await page.goto("/companies");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("link", { name: "Create global product" })).toHaveCount(0);
  await expect(page.getByText(/Axora internal cost|supplier cost|gross margin/i)).toHaveCount(0);
  await page.goto("/requests/order-1");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByText(/Internal line total|supplier cost|gross margin/i)).toHaveCount(0);
  await page.goto("/requests/not-a-valid-id");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  await page.goto("/deliveries");
  await expect(page.locator("main h1")).toBeVisible();
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  await page.goto("/reports");
  await expect(page.getByText(/customer sales|buying cost|gross profit|gross margin/i)).toHaveCount(0);
});

test("company and branch administrators retain scoped people, budget and request work", async ({ page }) => {
  await signInAsDemoRole(page, principals.companyAdmin);
  await page.goto("/users");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("heading", { level: 1, name: "Choose a branch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create global product" })).toHaveCount(0);
  await page.goto("/branches/organization");
  await expect(page).toHaveURL(/\/branches$/);

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
  await expect(page.getByLabel("Department")).toHaveCount(0);
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/access-denied$/);

  await page.context().clearCookies();
  await signInAsDemoRole(page, principals.approver);
  await page.goto("/approvals");
  await expect(page.getByText(/cannot approve your own request/i)).toBeVisible();
  await page.goto("/requests/new");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Delivery Agent lands in a contained delivery-only workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoRole(page, principals.deliveryGuy);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { level: 1, name: "Assigned deliveries" })).toBeVisible();
  await expectShell(page);
  await page.getByRole("button", { name: "Open application menu" }).click();
  const deliveryLink = page.getByRole("dialog", { name: "Menu" })
    .locator('a[href="/driver"]');
  await expect(deliveryLink).toBeVisible();
  await expect(deliveryLink.getByText("Delivery", { exact: true })).toBeVisible();
  for (const href of ["/budgets", "/wallet", "/approvals", "/settings/procurement", "/users", "/finance"]) {
    await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  await expect(page.getByText(/company wallet|branch budget|approved spend|purchasing rules/i))
    .toHaveCount(0);

  for (const route of ["/budgets", "/wallet", "/approvals", "/settings/procurement", "/users", "/finance"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/access-denied$/);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  }
  for (const route of ["/company-wallet", "/company/users"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByText(/company wallet balance|available budget|company users/i))
      .toHaveCount(0);
  }
});

test("Malay Delivery Agent workspace is dark-mode and phone-landscape safe", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signInAsDemoRole(page, {
    ...principals.deliveryGuy,
    id: "70777777-7777-4777-8777-777777777778",
    email: "delivery-ms.fixture@axora.invalid",
    preferredLocale: "ms",
  });
  await page.goto("/driver");
  expect((await page.request.patch("/api/profile/appearance", {
    data: { appearance: "dark" },
    headers: { Origin: "http://127.0.0.1:3100" },
  })).status()).toBe(200);
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", "dark");
  await expect(page.getByRole("heading", { level: 1, name: "Penghantaran ditugaskan" }))
    .toBeVisible();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(2);

  const targets = await page.locator("main button:visible").evaluateAll((elements) => (
    elements.map((element) => ({
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
    }))
  ));
  for (const target of targets) {
    expect(target.height, JSON.stringify(targets)).toBeGreaterThanOrEqual(44);
    expect(target.width, JSON.stringify(targets)).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 667, height: 375 });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(2);
});

test("Platform Owner retains company authority and the Owner-only Email Status", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies");
  await expect(page.locator("main h1")).toBeVisible();
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/email-operations");
  await expect(page.getByRole("heading", { level: 1, name: "Email Status" })).toBeVisible();
  await page.goto("/branches/organization");
  await expect(page).toHaveURL(/\/branches$/);
  await page.goto("/companies/co-youruni/users/new");
  const role = page.getByLabel("Role");
  await expect(role.locator('option[value="DEPARTMENT_ADMIN"]')).toHaveCount(0);
  await role.selectOption("REQUESTER");
  await expect(page.getByLabel("Assignment level")).toHaveCount(0);
  await expect(page.getByLabel("Department")).toHaveCount(0);
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
