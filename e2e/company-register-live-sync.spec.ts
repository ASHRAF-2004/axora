import { expect, test } from "@playwright/test";

import { signInAsDemoOwner } from "./helpers/auth";

test.describe.configure({ retries: 0 });

test("an open company register sees a company created by another owner session without reloading", async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const contextOptions = {
    baseURL: "http://127.0.0.1:3100",
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    userAgent: testInfo.project.use.userAgent,
  };
  const creatorContext = await browser.newContext(contextOptions);
  const observerContext = await browser.newContext(contextOptions);
  const creator = await creatorContext.newPage();
  const observer = await observerContext.newPage();
  const failures: string[] = [];
  for (const page of [creator, observer]) page.on("pageerror", error => failures.push(error.message));
  try {
    await signInAsDemoOwner(creator);
    await signInAsDemoOwner(observer);
    await observer.goto("http://127.0.0.1:3100/companies");
    await expect(observer.getByRole("heading", { name: "Company register", exact: true })).toBeVisible();
    const observerNavigation = await observer.evaluate(() => performance.timeOrigin);
    await creator.goto("http://127.0.0.1:3100/companies/new");
    const name = `Live register company ${testInfo.project.name} ${Date.now()}`;
    await creator.getByLabel("Company name", { exact: true }).fill(name);
    await creator.getByLabel("Main contact name", { exact: true }).fill("Controlled live register contact");
    await creator.getByRole("button", { name: "Create company", exact: true }).click();
    await expect(creator).toHaveURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i, { timeout: 15_000 });
    await expect(creator.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await observer.bringToFront();
    await expect(observer.locator("tr").filter({ hasText: name })).toHaveCount(1, { timeout: 20_000 });
    expect(await observer.evaluate(() => performance.timeOrigin)).toBe(observerNavigation);
    expect(failures).toEqual([]);
  } finally {
    await creatorContext.close();
    await observerContext.close();
  }
});
