import { expect, test } from "@playwright/test";
import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const camA: DemoRoleSession = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "cam-a.phase-c@axora.invalid",
  name: "CAM A fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
};

const camB: DemoRoleSession = {
  id: "20222222-2222-4222-8222-222222222223",
  email: "cam-b.phase-c@axora.invalid",
  name: "CAM B fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
};

async function clearSession(page: Parameters<typeof signInAsDemoRole>[0]) {
  await page.context().clearCookies();
}

test("Owner is global while CAM-A and CAM-B lists, search, and direct routes stay isolated", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies");
  await expect(page.getByText("YourUni", { exact: true })).toBeVisible();
  await expect(page.getByText("Excel Language Centre", { exact: true })).toBeVisible();
  await expect(page.getByText("Unibax", { exact: true })).toBeVisible();

  await clearSession(page);
  await signInAsDemoRole(page, camA);
  await page.goto("/companies");
  await expect(page.getByText("YourUni", { exact: true })).toBeVisible();
  await expect(page.getByText("Excel Language Centre", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Unibax", { exact: true })).toHaveCount(0);
  await page.goto("/companies/co-excel");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await page.goto("/requests/order-9");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await page.goto("/requests?q=Excel");
  await expect(page.getByText("Excel Language Centre", { exact: true })).toHaveCount(0);

  await clearSession(page);
  await signInAsDemoRole(page, camB);
  await page.goto("/companies");
  await expect(page.getByText("Excel Language Centre", { exact: true })).toBeVisible();
  await expect(page.getByText("YourUni", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Unibax", { exact: true })).toHaveCount(0);
  await page.goto("/companies/co-youruni");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await page.goto("/requests/order-1");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await page.goto("/requests/order-9");
  await expect(page.getByRole("heading", { level: 1, name: "ORD-2026-009" })).toBeVisible();
});

test("CAM-created company belongs to its creator and Owner, while Owner-created company stays Owner-only", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${testInfo.retry}-${Date.now()}`;
  await signInAsDemoRole(page, camA);
  await page.goto("/companies/new");
  await page.getByLabel("Company name").fill(`CAM A Company ${suffix}`);
  await page.getByLabel("Main contact name").fill("CAM A contact");
  await Promise.all([
    page.waitForURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i),
    page.getByRole("button", { name: "Create company" }).click(),
  ]);
  const camCreatedPath = new URL(page.url()).pathname;
  await expect(page.getByText(`CAM A Company ${suffix}`, { exact: true })).toBeVisible();

  await clearSession(page);
  await signInAsDemoRole(page, camB);
  await page.goto(camCreatedPath);
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();

  await clearSession(page);
  await signInAsDemoOwner(page);
  await page.goto(camCreatedPath);
  await expect(page.getByText(`CAM A Company ${suffix}`, { exact: true })).toBeVisible();
  await page.goto("/companies/new");
  await page.getByLabel("Company name").fill(`Owner Company ${suffix}`);
  await page.getByLabel("Main contact name").fill("Owner contact");
  await Promise.all([
    page.waitForURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i),
    page.getByRole("button", { name: "Create company" }).click(),
  ]);
  const ownerCreatedPath = new URL(page.url()).pathname;

  await clearSession(page);
  await signInAsDemoRole(page, camA);
  await page.goto(ownerCreatedPath);
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
});
