import { expect, test } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";

const owner: DemoRoleSession = {
  id: "f1285000-0000-4000-8000-000000000001",
  email: "integration-owner@axora.invalid",
  name: "Integration Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};

const companyAdministrator: DemoRoleSession = {
  id: "f1285000-0000-4000-8000-000000000002",
  email: "integration-administrator@axora.invalid",
  name: "Integration Administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
};

const deniedRoles: DemoRoleSession[] = [
  {
    id: "f1285000-0000-4000-8000-000000000003",
    email: "integration-cam@axora.invalid",
    name: "Integration CAM",
    role: "CLIENT_ACCOUNT_MANAGER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
  },
  {
    id: "f1285000-0000-4000-8000-000000000004",
    email: "integration-requester@axora.invalid",
    name: "Integration Requester",
    role: "REQUESTER",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId: "88888888-8888-4888-8888-888888888888",
  },
  {
    id: "f1285000-0000-4000-8000-000000000005",
    email: "integration-driver@axora.invalid",
    name: "Integration Driver",
    role: "DELIVERY_GUY",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
  },
];

test("integration foundation stays dark while its management UI remains role-scoped", async ({
  page,
  request,
}) => {
  for (const path of [
    "/api/v1/me",
    "/api/v1/openapi.json",
    "/.well-known/oauth-authorization-server",
  ]) {
    const response = await request.get(path);
    expect(response.status(), `${path} must be absent while dark-launched`).toBe(404);
  }

  await signInAsDemoRole(page, owner);
  await page.goto("/integrations");
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" }))
    .toBeVisible();
  await expect(page.getByText("External API disabled", { exact: true })).toBeVisible();
  await expect(page.getByText("Slack disabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack notifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack operational status" }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Slack" })).toHaveCount(0);
  await expect(page.getByRole("heading", {
    name: "Operational status",exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Application registry" })).toBeVisible();

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdministrator);
  await page.goto("/integrations");
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected apps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available apps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack notifications" })).toBeVisible();
  await expect(page.getByText("No Slack workspace is connected.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText(/xox[bep]-/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Application registry" })).toHaveCount(0);

  for (const actor of deniedRoles) {
    await page.context().clearCookies();
    await signInAsDemoRole(page, actor);
    await page.goto("/integrations");
    await expect(page).toHaveURL(/\/access-denied$/);
  }
});

test("integration management preserves RTL and cannot be recovered with browser Back after logout", async ({
  page,
}) => {
  await signInAsDemoRole(page, {
    ...companyAdministrator,
    id: "f1285000-0000-4000-8000-000000000006",
    preferredLocale: "ar",
  });
  await page.goto("/integrations");
  await expect(page.locator(".app-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "التكاملات" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "إشعارات Slack" })).toBeVisible();

  await page.getByRole("button", { name: /Integration Administrator/ }).click();
  await page.getByRole("menuitem", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole("heading", { level: 1, name: "تسجيل الدخول إلى Axora" }))
    .toBeVisible();
  await expect(page.getByText("التكاملات", { exact: true })).toHaveCount(0);
});
