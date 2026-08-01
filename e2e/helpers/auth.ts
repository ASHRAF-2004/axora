import { expect, type Page } from "@playwright/test";

export const E2E_OWNER_EMAIL = "owner@axora.e2e";
// Public deterministic fixture; never use these values outside DEMO_MODE.
export const E2E_OWNER_PASSWORD = "public-e2e-fixture-password";

export async function signInAsDemoOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER_EMAIL);
  await page.getByLabel("Password").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function openDemoInteractionEditor(page: Page) {
  await signInAsDemoOwner(page);
  await page.goto("/settings/interactions?companyId=co-youruni");
  await expect(page.getByTestId("interaction-preview")).toBeVisible();
  await expect(page.getByTestId("trusted-interaction")).toBeVisible();
}

export async function configureWalkingMascot(page: Page) {
  const enabled = page.getByLabel("Enable interactive experience");
  if (!(await enabled.isChecked())) await enabled.check();

  await page.getByLabel("Approved asset").selectOption("axora-buddy-v1");
  await page.getByLabel("Automatic movement").check();
  await page.getByLabel("Allow visitor drag").check();
  await page.getByLabel("Visitor pause control").check();
  await page.getByLabel("Visitor dismiss control").check();
  await page.getByRole("slider", { name: "Walking speed" }).fill("120");
  await page.getByRole("slider", { name: "Resume delay" }).fill("200");
  await page.getByLabel("Mobile behavior").selectOption("full");
  await page.getByTestId("trusted-interaction").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("axora-buddy")).toBeVisible();
}
