import { expect, test } from "@playwright/test";
import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const companyId = "10000000-0000-4000-8000-000000000001";

test("owner previews reviewed company branding across device, Arabic, and reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoOwner(page);
  await page.goto("/companies/" + companyId + "/theme");

  await expect(page.getByRole("heading", {
    level: 1,
    name: /Brand and page review/,
  })).toBeVisible();
  await expect(page.getByText("Review required", { exact: true }).first())
    .toBeVisible();
  await expect(page.getByText("WCAG contrast evidence")).toBeVisible();

  await page.getByLabel("Tablet").check();
  await expect(page.locator('section[data-device="tablet"]')).toBeVisible();
  await page.getByLabel("Mobile").check();
  await page.getByLabel("العربية").check();
  const preview = page.locator('section[lang="ar"][dir="rtl"]');
  await expect(preview).toBeVisible();
  await expect(preview.getByText("مشتريات الشركة")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth
      - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
  const duration = await preview.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).transitionDuration)
  ));
  expect(duration).toBeLessThanOrEqual(0.00001);
  await page.screenshot({
    path: `output/playwright/company-theme-${testInfo.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
  await page.goto(`/companies/${companyId}/onboarding`);
  await expect(page.getByRole("heading", {
    level: 1,
    name: /Onboarding workspace: YourUni/,
  })).toBeVisible();
  await page.screenshot({
    path: `output/playwright/company-onboarding-${testInfo.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
});

test("company users cannot enter Axora brand review", async ({ page }) => {
  const companyAdmin: DemoRoleSession = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "company.brand.fixture@axora.invalid",
    name: "Company brand fixture",
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  };
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/companies/" + companyId + "/theme");
  await expect(page).toHaveURL(/\/access-denied$/);
});
