import { expect, test, type Page } from "@playwright/test";

import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const unassignedCam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "agent.fixture@axora.invalid",
  name: "Agent fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
} satisfies DemoRoleSession;

function watchForUnexpectedBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror:${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
    }
  });
  return failures;
}

test("Owner creates a new Company and its first Administrator on one submission", async ({
  page,
}, testInfo) => {
  const browserFailures = watchForUnexpectedBrowserFailures(page);
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const companyName = `First-attempt company ${testInfo.project.name}`;
  await page.getByLabel("Company name").fill(companyName);
  await page.getByLabel("Main contact name").fill("First Administrator");
  await Promise.all([
    page.waitForURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i),
    page.getByRole("button", { name: "Create company" }).click(),
  ]);
  const companyId = new URL(page.url()).pathname.split("/").at(-1);
  expect(companyId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.goto(`/companies/${companyId}/users/new`);

  await expect(page.getByRole("heading", {
    level: 1,
    name: `Create Company User: ${companyName}`,
  })).toBeVisible();
  await expect(page.getByLabel("Customer company")).toHaveCount(0);
  const displayName = `First Company Administrator ${testInfo.project.name}`;
  const email = `first-company-admin-${testInfo.project.name}@axora.invalid`;
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Role").selectOption("COMPANY_ADMIN");
  const submit = page.getByRole("button", { name: "Create account & send invite" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page).toHaveURL(
    new RegExp(`/companies/${companyId}/users\\?notice=user-created-email-disabled$`),
  );
  const createdUser = page.locator("tr").filter({
    hasText: email,
  });
  await expect(createdUser).toBeVisible();
  await expect(createdUser.getByText("Pending setup", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(1);

  await page.goto(`/companies/${companyId}/users/new`);
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Role").selectOption("COMPANY_ADMIN");
  await page.getByRole("button", { name: "Create account & send invite" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/companies/${companyId}/users\\?notice=user-invitation-pending$`),
  );
  await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(1);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(browserFailures).toEqual([]);
});

test("Owner creates a Company Administrator with compatible customized permissions", async ({
  page,
}, testInfo) => {
  const browserFailures = watchForUnexpectedBrowserFailures(page);
  await signInAsDemoOwner(page);
  await page.goto("/companies/co-youruni/users/new");
  const email = `custom-company-admin-${testInfo.project.name}@axora.invalid`;
  await page.getByLabel("Full name").fill(`Custom Company Administrator ${testInfo.project.name}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Role").selectOption("COMPANY_ADMIN");
  await page.getByRole("button", { name: "Customize permissions" }).click();
  const compatibleExtra = page.locator('input[name="permissions"]:not(:checked)').first();
  await expect(compatibleExtra).toBeVisible();
  await compatibleExtra.check();
  await page.getByRole("button", { name: "Create account & send invite" }).click();

  await expect(page).toHaveURL(
    /\/companies\/co-youruni\/users\?notice=user-created-email-disabled$/,
  );
  await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(1);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(browserFailures).toEqual([]);
});

test("Arabic Company Administrator creation remains RTL and controlled", async ({ page }, testInfo) => {
  const browserFailures = watchForUnexpectedBrowserFailures(page);
  await signInAsDemoRole(page, {
    id: `21222222-2222-4222-8222-${testInfo.project.name === "chromium" ? "222222222221" : "222222222223"}`,
    email: `arabic-owner-${testInfo.project.name}@axora.invalid`,
    name: "Arabic Owner",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    isOwner: true,
    preferredLocale: "ar",
  });
  await page.goto("/companies/co-youruni/users/new");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const email = `arabic-company-admin-${testInfo.project.name}@axora.invalid`;
  await page.getByLabel("الاسم الكامل").fill(`مدير شركة ${testInfo.project.name}`);
  await page.getByLabel("بريد العمل").fill(email);
  await page.getByLabel("الدور").selectOption("COMPANY_ADMIN");
  await page.getByRole("button", { name: "إنشاء الحساب وإرسال الدعوة" }).click();

  await expect(page).toHaveURL(
    /\/companies\/co-youruni\/users\?notice=user-created-email-disabled$/,
  );
  await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(1);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(browserFailures).toEqual([]);
});

test("authorized CAM browses company users without a company assignment", async ({ page }) => {
  await signInAsDemoRole(page, unassignedCam);
  await page.goto("/companies/co-youruni/users");
  await expect(page.getByRole("heading", { name: "Company Users: YourUni" })).toBeVisible();
});
