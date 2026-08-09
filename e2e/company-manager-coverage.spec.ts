import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

test("company manager coverage remains usable on mobile with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoOwner(page);
  await page.goto("/companies");

  await expect(page.getByRole("heading", { level: 1, name: "Company lifecycle" }))
    .toBeVisible();
  const coverage = page.getByText("Manager coverage and handover", { exact: true }).first();
  await expect(coverage).toBeVisible();
  await coverage.click();
  await expect(page.getByText("Coverage gap requires owner action", { exact: true }).first())
    .toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});
