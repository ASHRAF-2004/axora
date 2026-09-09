import { expect, test } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";
const preferenceCookie = "axora_dashboard_reporting";

function companyAdmin(id: string): DemoRoleSession {
  return {
    id,
    email: `dashboard-preference-${id}@axora.invalid`,
    name: "Dashboard preference administrator",
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  };
}

test("Company reporting period and branch preferences survive refresh and navigation without crossing users", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The desktop preference flow is deterministic; responsive controls are covered elsewhere.");
  await signInAsDemoRole(page, companyAdmin("33333333-3333-4333-8333-333333333339"));
  await page.goto("/dashboard");
  await expect(page.locator(".dashboard-period-form")).toHaveAttribute("action", "/dashboard");

  await page.getByLabel("Period", { exact: true }).selectOption("year-to-date");
  await page.getByLabel("Branch scope", { exact: true }).selectOption(branchId);
  await page.getByRole("button", { name: "Apply period" }).click();
  await expect(page).toHaveURL(/\/dashboard\?preset=year-to-date.*branch=/);
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("year-to-date");
  await expect(page.getByLabel("Branch scope", { exact: true })).toHaveValue(branchId);

  await page.goto(`/products?branch=${branchId}`);
  await expect.poll(async () => (
    (await page.context().cookies()).find((cookie) => cookie.name === preferenceCookie)?.value
  )).toContain("33333333-3333-4333-8333-333333333339");
  await page.goto("/dashboard");
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("year-to-date");
  await expect(page.getByLabel("Branch scope", { exact: true })).toHaveValue(branchId);
  await page.reload();
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("year-to-date");
  await expect(page.getByLabel("Branch scope", { exact: true })).toHaveValue(branchId);

  const urlOverrideSaved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/dashboard/reporting-preference"
    && response.request().method() === "POST",
  );
  await page.goto(`/dashboard?preset=current-month&branch=${branchId}`);
  expect((await urlOverrideSaved).status()).toBe(204);
  await page.goto(`/products?branch=${branchId}`);
  await page.goto("/dashboard");
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("current-month");
  await expect(page.getByLabel("Branch scope", { exact: true })).toHaveValue(branchId);

  await page.getByLabel("Period", { exact: true }).selectOption("custom");
  await page.getByLabel("Start date").fill("2026-01-14");
  await page.getByLabel("End date").fill("2026-08-31");
  await page.getByRole("button", { name: "Apply period" }).click();
  await expect(page).toHaveURL(/\/dashboard\?preset=custom.*start=2026-01-14.*end=2026-08-31/);
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("custom");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-01-14");
  await expect(page.getByLabel("End date")).toHaveValue("2026-08-31");
  await page.goto(`/products?branch=${branchId}`);
  await page.goto("/dashboard");
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("custom");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-01-14");
  await expect(page.getByLabel("End date")).toHaveValue("2026-08-31");
  await page.reload();
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("custom");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-01-14");
  await expect(page.getByLabel("End date")).toHaveValue("2026-08-31");

  await signInAsDemoRole(page, companyAdmin("33333333-3333-4333-8333-333333333340"));
  await page.goto("/dashboard");
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("current-month");
});
