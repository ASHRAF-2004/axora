import { expect, test } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const owner = (locale: "ar" | "ms"): DemoRoleSession => ({
  id: locale === "ar"
    ? "17171717-1717-4717-8717-171717171717"
    : "18181818-1818-4818-8818-181818181818",
  email: `localized-owner-${locale}@axora.invalid`,
  name: "Localized owner fixture",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
  preferredLocale: locale,
});

test("Arabic and Malay create routes localize navigation and recovery controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Localized create-route semantics run once; the full suite covers both device projects.");
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror:${error.name}`));
  page.on("console", (message) => {
    if (message.text().startsWith("Applying inline style violates the following Content Security Policy directive 'style-src-elem")) return;
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });

  for (const fixture of [
    { locale: "ar" as const, width: 320, companyBack: "العودة إلى الشركات", back: "رجوع", continue: "متابعة", direction: "rtl" },
    { locale: "ms" as const, width: 390, companyBack: "Kembali ke syarikat", back: "Kembali", continue: "Teruskan", direction: "ltr" },
  ]) {
    await page.context().clearCookies();
    await page.setViewportSize({ width: fixture.width, height: 844 });
    await signInAsDemoRole(page, owner(fixture.locale));

    await page.goto("/companies/new");
    await expect(page.locator("html")).toHaveAttribute("dir", fixture.direction);
    await expect(page.getByRole("link", { name: fixture.companyBack, exact: true })).toBeVisible();

    await page.goto("/products/new");
    await expect(page.getByRole("link", { name: fixture.back, exact: true })).toBeVisible();

    await page.goto("/branches/new");
    await expect(page.getByRole("link", { name: fixture.back, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: fixture.continue, exact: true })).toBeVisible();
    await expect(page.getByText(/Something went wrong|Reference:/i)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  }

  expect(failures).toEqual([]);
});
