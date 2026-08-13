import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

function actionableConsoleError(message: string) {
  if (message.includes("Applying inline style violates")
    && message.includes("style-src-elem")
  ) return false;
  if (message.includes("Loading the script 'http://127.0.0.1:3100/_next/static/chunks/")
    && message.includes("violates the following Content Security Policy directive")) return false;
  return true;
}

test("login stays clear, responsive, interactive, and free of recovery errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && actionableConsoleError(message.text())) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/login");
  await expect(page.locator(".interaction-atmosphere")).toBeAttached();
  await expect(page.locator(".login-guide svg")).toBeVisible();
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Register your company/ })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("pointer depth is decorative and reduced motion removes animation", async ({ page }, testInfo) => {
  await page.goto("/login");
  if (testInfo.project.name === "mobile-chrome") {
    await expect(page.locator(".interaction-pointer-light")).toHaveCSS("display", "none");
    return;
  }
  const light = page.locator(".interaction-pointer-light");
  const before = await light.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.move(180, 210);
  await expect.poll(() => light.evaluate((element) => getComputedStyle(element).transform)).not.toBe(before);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".interaction-pointer-light")).toHaveCSS("display", "none");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("first sign-in requires language and the authorized team without a dismiss path", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/profile?onboarding=1&returnTo=%2Fdashboard");

  const gate = page.getByRole("dialog", { name: "Tell your team who you are" });
  await expect(gate).toBeVisible();
  await expect(gate.getByLabel("Preferred language")).toBeVisible();
  await expect(gate.getByLabel("Assigned team")).toHaveValue("");
  await gate.getByLabel("Assigned team").selectOption({ index: 1 });
  await expect(gate.getByLabel("Assigned team")).not.toHaveValue("");
  await expect(gate.getByRole("button", { name: /close|cancel|skip/i })).toHaveCount(0);
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
});

test("major owner routes render without recovery, RSC, or browser errors", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The route matrix runs once at desktop width.");
  await signInAsDemoOwner(page);
  const routes = [
    "/dashboard", "/notifications", "/products", "/companies", "/companies/leads",
    "/users", "/reports", "/audit", "/email-operations", "/settings", "/support",
    "/profile", "/account",
  ];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && actionableConsoleError(message.text())) failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(500);
    await expect(page.locator("main.app-content"), route).toBeVisible();
    await expect(page.getByText("This page could not be restored"), route).toHaveCount(0);
    await expect(page.getByText(/server error occurred/i), route).toHaveCount(0);
  }
  expect(failures).toEqual([]);
});
