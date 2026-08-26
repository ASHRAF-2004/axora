import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole } from "./helpers/auth";

const localizedOwner = (locale: "ar" | "ms") => ({
  id: `e1200000-0000-4000-8000-0000000000${locale === "ar" ? "41" : "42"}`,
  email: `company-register-${locale}@fixture.invalid`,
  name: "Localized company register fixture",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
  preferredLocale: locale,
});

test("company register groups lifecycle filters and localizes one-company setup actions", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const companyName = `Localized register ${Date.now()}`;
  await page.getByLabel("Company name").fill(companyName);
  await page.getByLabel("Main contact name").fill("Register fixture contact");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i);

  const query = `/companies?q=${encodeURIComponent(companyName)}`;
  await page.goto(query);
  await expect(page.getByText("1 company", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue setup" })).toBeVisible();
  const englishLabels = await page.locator('select[name="status"] option').allTextContents();
  expect(new Set(englishLabels).size).toBe(englishLabels.length);

  await page.context().clearCookies();
  await signInAsDemoRole(page, localizedOwner("ar"));
  await page.goto(query);
  await expect(page.getByText("1 شركة", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "متابعة الإعداد" })).toBeVisible();
  await expect(page.getByText("Continue setup", { exact: true })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAsDemoRole(page, localizedOwner("ms"));
  await page.goto(query);
  await expect(page.getByText("1 syarikat", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Teruskan persediaan" })).toBeVisible();
  await expect(page.getByText("Continue setup", { exact: true })).toHaveCount(0);
});
