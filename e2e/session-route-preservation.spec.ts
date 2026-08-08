import { expect, test } from "@playwright/test";
import {
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  signInAsDemoOwner,
  signInAsDemoRole,
} from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";
const requester = {
  id: "99999999-9999-4999-8999-999999999999",
  email: "requester.fixture@axora.invalid",
  name: "Requester fixture",
  role: "REQUESTER",
  accountKind: "COMPANY" as const,
  scopeType: "BRANCH" as const,
  companyId,
  branchId,
};

async function completeDemoLogin(page: Parameters<typeof signInAsDemoOwner>[0]) {
  await page.getByLabel("Email").fill(E2E_OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("refresh preserves the authorized path, filters, and selected fragment", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests?q=paper&status=open#request-table");
  await expect(page.getByRole("heading", { level: 1, name: "Purchase requests" }))
    .toBeVisible();
  await expect(page).toHaveURL(/\/requests\?q=paper&status=open#request-table$/);

  await page.reload();

  await expect(page).toHaveURL(/\/requests\?q=paper&status=open#request-table$/);
  await expect(page.getByLabel("Search requests")).toHaveValue("paper");
  await expect(page.getByLabel("Filter by status")).toHaveValue("open");
});

test("an expired cookie resumes the exact prior route after login", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests?q=paper&status=open#request-table");
  await expect(page).toHaveURL(/#request-table$/);

  await page.context().clearCookies();
  await page.reload();

  await expect(page).toHaveURL(/\/login\?.*reason=required|\/login\?.*reason=expired/);
  await expect(page.getByText(/session ended|sign in to continue/i)).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    "/requests?q=paper&status=open#request-table",
  );

  await completeDemoLogin(page);
  await expect(page).toHaveURL(/\/requests\?q=paper&status=open#request-table$/);
  await expect(page.getByLabel("Search requests")).toHaveValue("paper");
});

test("stale, external, and unauthorized return routes fall back safely", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "axora-session-return:v1",
      "/users?tab=access#previous-user",
    );
  });
  await page.reload();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue("/dashboard");
  await completeDemoLogin(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.context().clearCookies();
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.example%2Fusers");
  await completeDemoLogin(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.context().clearCookies();
  await signInAsDemoRole(page, requester);
  await page.goto("/login?returnTo=%2Fusers%3Ftab%3Daccess%23active");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("request draft fields recover after a hard refresh", async ({ page }) => {
  await signInAsDemoRole(page, requester);
  await page.goto("/requests/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create purchase request" }))
    .toBeVisible();

  await page.getByLabel("Request type").selectOption("Recurring");
  await page.getByLabel("Department").fill("Operations and facilities");
  await page.getByLabel("Priority").selectOption("High");
  await page.getByLabel("Notes").fill("Preserve this safe draft across refresh.");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Needed by").fill(tomorrow);

  await page.reload();

  await expect(page.getByLabel("Request type")).toHaveValue("Recurring");
  await expect(page.getByLabel("Department"))
    .toHaveValue("Operations and facilities");
  await expect(page.getByLabel("Priority")).toHaveValue("High");
  await expect(page.getByLabel("Notes"))
    .toHaveValue("Preserve this safe draft across refresh.");
  await expect(page.getByLabel("Needed by")).toHaveValue(tomorrow);
  await expect(page.locator('input[name="submissionKey"]'))
    .toHaveValue(/^[0-9a-f-]{36}$/i);
});

test("offline and reconnect states retain the current route", async ({ page, context }) => {
  await signInAsDemoOwner(page);
  await page.goto("/audit?entityType=requests&action=UPDATE#audit-table");
  await expect(page).toHaveURL(/\/audit\?entityType=requests&action=UPDATE#audit-table$/);

  await context.setOffline(true);
  await expect(page.getByText(/You are offline/)).toBeVisible();
  await expect(page).toHaveURL(/\/audit\?entityType=requests&action=UPDATE#audit-table$/);

  await context.setOffline(false);
  await expect(page.getByText("Connection restored.")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/audit\?entityType=requests&action=UPDATE#audit-table$/);
});

test("multiple tabs independently retain their active authorized routes", async ({ page, context }) => {
  await signInAsDemoOwner(page);
  const second = await context.newPage();

  await page.goto("/requests?q=paper&status=open#requests");
  await second.goto("/audit?entityType=requests&action=UPDATE#audit");

  await Promise.all([page.reload(), second.reload()]);

  await expect(page).toHaveURL(/\/requests\?q=paper&status=open#requests$/);
  await expect(second).toHaveURL(/\/audit\?entityType=requests&action=UPDATE#audit$/);
});
