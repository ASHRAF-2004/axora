import { expect, test } from "@playwright/test";
import { installClaimedPublicVisitor } from "./helpers/public-visitor";
import { signInAsDemoOwner } from "./helpers/auth";

const immersiveResource = /(?:\/immersive\/|\.glb(?:\?|$)|meshopt|three\.module)/i;

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "axora_locale", value: "en", url: "http://127.0.0.1:3100" }]);
  await installClaimedPublicVisitor(page);
});

async function expectSimpleRoute(page: import("@playwright/test").Page, path: string) {
  const immersiveRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (immersiveResource.test(request.url())) immersiveRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(path);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(immersiveRequests).toEqual([]);
  expect(errors).toEqual([]);
}

test("default homepage and login use the simple interface without 3D resources", async ({ page }, testInfo) => {
  await expectSimpleRoute(page, "/en");
  await expect(page.getByRole("heading", { level: 1, name: "One clear path from business need to verified delivery." })).toBeVisible();
  await expect(page.locator(".simple-lifecycle-card")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `output/playwright/simple-ui-homepage-${testInfo.project.name}.png`,
  });

  await expectSimpleRoute(page, "/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Axora" })).toBeVisible();
  await page.getByLabel("Email").clear();
  await page.getByLabel("Password", { exact: true }).clear();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: `output/playwright/simple-ui-login-${testInfo.project.name}.png`,
  });
});

test("owner dashboard keeps the top-navigation shell without public 3D", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(page.getByRole("navigation", { name: "Complete application navigation" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Primary application navigation" })).toBeVisible();
  }
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: `output/playwright/simple-ui-owner-dashboard-${testInfo.project.name}.png`,
  });
});
