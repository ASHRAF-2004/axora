import { expect, test } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const admin = {
  id: "31313131-3131-4131-8131-313131313131",
  email: "phone-input.fixture@axora.invalid",
  name: "Phone input fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
} satisfies DemoRoleSession;

test("normalizes paste, searches countries, rejects malformed values and remains touch-safe", async ({ page }) => {
  await signInAsDemoRole(page, admin);
  await page.goto("/profile");

  const number = page.getByLabel("Phone", { exact: true });
  const country = page.getByRole("button", { name: /Choose country: Malaysia, \+60/ });
  await expect(country).toBeVisible();
  await expect(number).toHaveAttribute("type", "tel");
  await expect(number).toHaveAttribute("inputmode", "tel");
  expect((await number.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await country.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await number.fill("+1 (202) 555-0123");
  await expect(page.locator('input[type="hidden"][name="phone"]')).toHaveValue("+12025550123");
  await expect(page.getByRole("button", { name: /Choose country: United States, \+1/ })).toBeVisible();

  await page.getByRole("button", { name: /Choose country: United States, \+1/ }).click();
  const search = page.getByLabel("Search countries or dial codes");
  await search.fill("Emirates");
  await page.getByRole("option", { name: /United Arab Emirates.*\+971/ }).click();
  await number.fill("50 123 4567");
  await number.press("Tab");
  await expect(page.locator('input[type="hidden"][name="phone"]')).toHaveValue("+971501234567");

  await number.fill("abc");
  await expect(page.locator("small[role=alert]")).toContainText("digits and standard phone punctuation");
  await number.fill("");
  await number.fill("+60 +60 12 345 6789");
  await number.press("Tab");
  await expect(page.locator("small[role=alert]")).toContainText("country calling code only once");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(number).toBeFocused();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText(/Something went wrong|Reference:/i)).toHaveCount(0);
});

test("keeps Arabic RTL layout, phone direction and country search usable at 320px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The exact 320px RTL check runs once.");
  await page.setViewportSize({ width: 320, height: 760 });
  await signInAsDemoRole(page, { ...admin, id: "32323232-3232-4232-8232-323232323232", preferredLocale: "ar" });
  await page.goto("/profile");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const number = page.getByLabel("الهاتف", { exact: true });
  await expect(number).toHaveAttribute("dir", "ltr");
  const country = page.getByRole("button", { name: /اختر الدولة: ماليزيا, \+60/ });
  await country.focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByLabel("ابحث عن دولة أو رمز اتصال");
  await expect(search).toBeFocused();
  await search.fill("المملكة المتحدة");
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /اختر الدولة: المملكة المتحدة, \+44/ })).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
  expect((await number.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test("keeps the phone controls legible in the authenticated dark appearance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The exact dark appearance check runs once.");
  await signInAsDemoRole(page, { ...admin, id: "33333333-3333-4333-8333-333333333334" });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Appearance: Dark", exact: true }).click();
  await expect(page.locator('.app-shell[data-appearance="dark"]')).toBeVisible();
  const number = page.getByLabel("Phone", { exact: true });
  await expect(number).toBeVisible();
  const colors = await number.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor, text: style.color };
  });
  expect(new Set(Object.values(colors)).size).toBe(3);
  expect(Object.values(colors).every((value) => value !== "rgba(0, 0, 0, 0)")).toBe(true);
});
