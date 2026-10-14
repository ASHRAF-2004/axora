import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

test.describe.configure({ retries: 0 });

test("Company creation completes one browser POST and redirect without a Flight response", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const name = `Native company ${testInfo.project.name}-${testInfo.repeatEachIndex}`;
  await page.getByLabel("Company name", { exact: true }).fill(name);
  await page.getByLabel("Main contact name", { exact: true }).fill("Native completion contact");
  const posts: { navigation: boolean; actionHeader: string | undefined }[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/companies/new") {
      posts.push({ navigation: request.isNavigationRequest(), actionHeader: request.headers()["next-action"] });
    }
  });
  await page.getByRole("button", { name: "Create company", exact: true }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}\?notice=company-created$/);
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  expect(posts).toEqual([{ navigation: true, actionHeader: undefined }]);
});

test("confirmed owner company removal uses one browser POST and redirect", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const name = `Native company removal ${testInfo.project.name}-${testInfo.repeatEachIndex}`;
  await page.getByLabel("Company name", { exact: true }).fill(name);
  await page.getByLabel("Main contact name", { exact: true }).fill("Controlled removal contact");
  await page.getByRole("button", { name: "Create company", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  const companyPath = new URL(page.url()).pathname;
  const posts: { navigation: boolean; actionHeader: string | undefined }[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === companyPath) {
      posts.push({ navigation: request.isNavigationRequest(), actionHeader: request.headers()["next-action"] });
    }
  });
  const details = page.locator("details.panel").filter({ has: page.locator("summary", { hasText: "Delete company" }) });
  await details.locator("summary").click();
  await details.getByRole("button", { name: "Delete company", exact: true }).click();
  expect(posts).toEqual([]);
  expect(await details.locator('input[name="confirmed"]').evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await details.locator('input[name="confirmed"]').check();
  await details.getByRole("button", { name: "Delete company", exact: true }).click();
  await expect(page).toHaveURL(/\/companies\?deletionCommand=[0-9a-f-]{36}$/);
  expect(posts).toEqual([{ navigation: true, actionHeader: undefined }]);
  // Physical deletion and immutable retention are checked in native PostgreSQL.
});
