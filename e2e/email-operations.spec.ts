import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole } from "./helpers/auth";

const arabicOwner = {
  id: "70000000-0000-4000-8000-000000000070",
  email: "arabic-email-operations@axora.invalid",
  name: "مالك عمليات البريد",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
  preferredLocale: "ar" as const,
};

const companyAdmin = {
  id: "70000000-0000-4000-8000-000000000071",
  email: "company-email-operations@axora.invalid",
  name: "Company email fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY" as const,
  scopeType: "COMPANY" as const,
  companyId: "10000000-0000-4000-8000-000000000001",
};

test("owner sees the masked transactional email operations workspace", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/email-operations");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "Transactional email operations",
  })).toBeVisible();
  await expect(page.getByText("axora-auth", { exact: true }).last()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("owner@axora.e2e");
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});

test("Arabic operations remain RTL, mobile-safe, and reduced-motion aware", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, arabicOwner);
  await page.goto("/email-operations");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/[\u0600-\u06ff]/u);
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});

test("company users cannot enter global email operations", async ({ page }) => {
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/email-operations");
  await expect(page).toHaveURL(/\/access-denied$/);
});
