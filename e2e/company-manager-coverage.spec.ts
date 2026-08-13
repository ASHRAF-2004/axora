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

test("company lead creation is a single concise responsive form", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies");

  const form = page.locator("form").filter({
    has: page.getByRole("heading", { level: 2, name: "Create a company lead" }),
  });
  await expect(form).toBeVisible();
  for (const field of [
    "name",
    "industry",
    "companyInformation",
    "logo",
    "mainContactName",
    "mainContactEmail",
    "mainContactPhone",
    "billingCycle",
  ]) {
    await expect(form.locator(`[name="${field}"]`)).toHaveCount(1);
  }
  for (const removedField of [
    "legalName",
    "registrationNumber",
    "websiteUrl",
    "billingContactName",
    "billingContactEmail",
    "billingContactPhone",
    "billingAddress",
    "notes",
  ]) {
    await expect(form.locator(`[name="${removedField}"]`)).toHaveCount(0);
  }
  await expect(form.getByRole("button", { name: "Create lead" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(form).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});
