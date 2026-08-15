import { expect, test } from "@playwright/test";
import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const companyId = "10000000-0000-4000-8000-000000000001";

test("owner previews reviewed company branding across device, Arabic, and reduced motion", async ({ page }, testInfo) => {
  const optimizedOfficialLogoRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/_next/image" && url.searchParams.get("url")?.startsWith("/brand/axora-")) {
      optimizedOfficialLogoRequests.push(request.url());
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoOwner(page);
  await page.goto("/companies/" + companyId + "/theme");

  await expect(page.getByRole("heading", {
    level: 1,
    name: /Brand and page review/,
  })).toBeVisible();
  await expect(page.getByText("Review required", { exact: true }).first())
    .toBeVisible();
  const contrastHeading = page.getByRole("heading", {
    level: 2,
    name: "WCAG contrast evidence",
  });
  await expect(contrastHeading).toHaveCount(1);
  await expect(contrastHeading).toBeVisible();

  const deviceChoices = page.getByRole("group", { name: "Preview device" });
  await deviceChoices.getByRole("radio", { name: "Tablet", exact: true }).check();
  await expect(page.locator('section[data-device="tablet"]')).toBeVisible();
  await deviceChoices.getByRole("radio", { name: "Mobile", exact: true }).check();
  const languageChoices = page.getByRole("group", { name: "Preview language" });
  await languageChoices.getByRole("radio", { name: "العربية", exact: true }).check();
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
  expect(optimizedOfficialLogoRequests).toEqual([]);
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
