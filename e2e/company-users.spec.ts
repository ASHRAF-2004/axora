import { expect, test } from "@playwright/test";

import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const unassignedCam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "agent.fixture@axora.invalid",
  name: "Agent fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
} satisfies DemoRoleSession;

test("Owner creates a fixed-context Company User invitation in demo mode", async ({
  page,
}, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/co-youruni/users/new");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "Create Company User: YourUni",
  })).toBeVisible();
  await expect(page.getByLabel("Customer company")).toHaveCount(0);
  await page.getByLabel("Full name").fill(`Prompt 7 company admin ${testInfo.project.name}`);
  await page.getByLabel("Work email").fill(
    `prompt7-company-user-${testInfo.project.name}@axora.invalid`,
  );
  await page.getByLabel("Role").selectOption("COMPANY_ADMIN");
  await page.getByRole("button", { name: "Create account & send invite" }).click();

  await expect(page).toHaveURL(
    /\/companies\/co-youruni\/users\?notice=user-created-email-disabled$/,
  );
  const createdUser = page.locator("tr").filter({
    hasText: `prompt7-company-user-${testInfo.project.name}@axora.invalid`,
  });
  await expect(createdUser).toBeVisible();
  await expect(createdUser.getByText("Pending setup", { exact: true })).toBeVisible();
});

test("unassigned CAM cannot browse another company's Company Users workspace", async ({ page }) => {
  await signInAsDemoRole(page, unassignedCam);
  await page.goto("/companies/co-youruni/users");
  await expect(page.getByRole("heading", { name: "This page could not be found." }))
    .toBeVisible();
  await expect(page.getByText("Company Users", { exact: true })).toHaveCount(0);
});
