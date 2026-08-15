import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole } from "./helpers/auth";

test("dashboard presets, comparison, export and refresh share one URL state", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.getByLabel("Period", { exact: true }).selectOption("last-3-months");
  await page.getByLabel("Compare with the previous equivalent period", { exact: true }).check();
  await page.getByRole("button", { name: "Apply period" }).click();

  await expect(page).toHaveURL(/preset=last-3-months/);
  await expect(page).toHaveURL(/compare=1/);
  await expect(page.getByRole("heading", { name: "Reporting period" })).toBeVisible();
  await expect(page.getByText(/Compared with/)).toBeVisible();
  const exportLink = page.getByRole("link", { name: "Export dashboard" });
  await expect(exportLink).toHaveAttribute("href", /\/api\/export\/dashboard\?preset=last-3-months&compare=1/);

  await page.reload();
  await expect(page.getByLabel("Period", { exact: true })).toHaveValue("last-3-months");
  await expect(page.getByLabel("Compare with the previous equivalent period", { exact: true })).toBeChecked();
});

test("custom dashboard dates remain bookmarkable with inclusive end semantics", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.getByLabel("Period", { exact: true }).selectOption("custom");
  await page.getByLabel("Start date").fill("2026-06-01");
  await page.getByLabel("End date").fill("2026-07-31");
  await page.getByRole("button", { name: "Apply period" }).click();

  await expect(page).toHaveURL(/preset=custom/);
  await expect(page).toHaveURL(/start=2026-06-01/);
  await expect(page).toHaveURL(/end=2026-07-31/);
  const periodRegion = page.getByRole("region", { name: "Reporting period" });
  await expect(periodRegion.getByText(/Start is inclusive/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Export dashboard" })).toHaveAttribute(
    "href",
    /start=2026-06-01&end=2026-07-31/,
  );
});

test("Arabic period controls remain RTL, mobile-safe and reduced-motion safe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 800 });
  await signInAsDemoRole(page, {
    id: "81000000-0000-4000-8000-000000000001",
    email: "arabic.owner@axora.e2e",
    name: "مالك أكسورا",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    isOwner: true,
    preferredLocale: "ar",
  });
  await page.goto("/dashboard");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "فترة التقارير" })).toBeVisible();
  await expect(page.getByLabel("الفترة", { exact: true })).toHaveValue("current-month");
  await expect(page.getByRole("link", { name: "تصدير لوحة المعلومات" })).toBeVisible();
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".dashboard-period-panel")).toHaveCSS("animation-name", "none");
});
