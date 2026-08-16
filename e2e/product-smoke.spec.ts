import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

const authenticatedRoutes = [
  { path: "/dashboard", heading: /Good (morning|afternoon|evening),/ },
  { path: "/products", heading: "Products" },
  { path: "/requests", heading: "Purchase requests" },
  { path: "/deliveries", heading: "Manage Drivers" },
  { path: "/receiving", heading: "Confirm delivered quantities" },
  { path: "/finance", heading: "Invoices and payments" },
  { path: "/companies", heading: "Company lifecycle" },
  { path: "/branches", heading: "Branches & monthly budgets" },
  { path: "/reports", heading: "Reports and reconciliation" },
  { path: "/audit", heading: "Audit history" },
  { path: "/users", heading: "Create named accounts" },
  { path: "/support", heading: "System and account diagnostics" },
  { path: "/settings", heading: "Settings and security" },
  { path: "/help", heading: "How Axora operates" },
] as const;

async function horizontalOverflow(page: Parameters<typeof signInAsDemoOwner>[0]) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("redirects an unauthenticated portal visit to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole("heading", { name: "Sign in to Axora" })).toBeVisible();
});

test("opens every owner top-level workspace with its semantic shell", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);

  for (const route of authenticatedRoutes) {
    await test.step(route.path, async () => {
      await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll("/", "\\/")}$`));
      await expect(page.locator("main")).toHaveCount(1);
      await expect(
        page.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
      if (testInfo.project.name === "chromium") {
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
      }
    });
  }
});

test("keeps customer approval decisions outside the platform-owner role", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/approvals");

  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("heading", {
    level: 2,
    name: "Actual-spend and substitute approvals",
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Approve and reserve budget",
  })).toHaveCount(0);
});

test("creates one catalogue product without losing the route after insertion", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/products/new");
  const name = `E2E catalogue product ${Date.now()}`;
  const form = page.locator('form[data-draft-id="create-product"]');
  await form.getByLabel("Product name").fill(name);
  await form.getByLabel("Subcategory").fill("Regression fixtures");
  await form.getByLabel("Axora internal cost (RM)").fill("12.50");
  await form.getByLabel("Description / specification").fill("Catalogue route-recovery regression fixture");
  await form.getByRole("button", { name: "Create product" }).click();

  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/edit(?:\?.*)?$/i);
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(/Product created successfully/)).toBeVisible();

  const editor = page.locator("form.panel.form-panel").first();
  await editor.getByLabel("Description / specification").fill(
    "Catalogue route-recovery regression fixture updated",
  );
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/edit(?:\?.*)?$/i);
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  await expect(page.getByText("Product changes saved successfully.")).toBeVisible();

  await page.goto("/products");
  await expect(page.getByRole("cell", { name }).first()).toBeVisible();
  await page.screenshot({
    path: `output/playwright/catalogue-product-created-${testInfo.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
});
