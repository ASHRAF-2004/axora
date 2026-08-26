import { expect, test } from "@playwright/test";
import { signInAsDemoRole } from "./helpers/auth";

const cam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "cam-company-detail@fixture.invalid",
  name: "CAM company detail fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
};

test("CAM company detail accepts demo identifiers and malformed identifiers stay controlled", async ({ page }) => {
  const serverErrors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await signInAsDemoRole(page, cam);

  const companyResponse = await page.goto("/companies/co-youruni");
  expect(companyResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "YourUni" })).toBeVisible();
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);

  await page.goto("/companies/not-a-company");
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  expect(serverErrors).toEqual([]);
});
