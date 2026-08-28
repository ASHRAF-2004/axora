import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

const authenticatedRoutes = [
  { path: "/dashboard", heading: /Good (morning|afternoon|evening),/ },
  { path: "/products", heading: "Products" },
  { path: "/requests", heading: "Purchase requests" },
  { path: "/deliveries", heading: "Manage Delivery Agents" },
  { path: "/finance", heading: "Invoices and payments" },
  { path: "/companies", heading: "Companies" },
  { path: "/branches", heading: "Branches" },
  { path: "/users", heading: "Axora Users" },
  { path: "/email-operations", heading: "Email Status" },
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

test("redirects retired MVP routes without rendering their old products", async ({ page }) => {
  await signInAsDemoOwner(page);
  for (const path of ["/help", "/support", "/reports", "/audit"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/profile$/);
  await page.goto("/receiving");
  await expect(page).toHaveURL(/\/requests$/);
  for (const path of ["/companies/leads", "/companies/leads/new", "/companies/leads/00000000-0000-4000-8000-000000000001"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/companies$/);
  }
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

test("compact MVP administration has no overflow at every required width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The exact responsive matrix runs once.");
  await signInAsDemoOwner(page);
  for (const width of [1440, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/companies", "/companies/10000000-0000-4000-8000-000000000001/onboarding", "/email-operations"]) {
      await page.goto(route);
      await expect(page.locator("main.app-content")).toBeVisible();
      expect(await horizontalOverflow(page), `${route} at ${width}px`).toBeLessThanOrEqual(2);
    }
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

test("creates a company on the first valid attempt without a logo or assignment", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const name = `MVP company ${Date.now()}`;
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Main contact name").fill("Controlled contact");
  await Promise.all([
    page.waitForURL(/\/companies\/[0-9a-f-]+\?notice=company-created$/i),
    page.getByRole("button", { name: "Create company" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  for (const tab of ["Overview", "Company setup", "Users", "Branches and delivery locations", "Wallet and budgets", "Documents"]) {
    await expect(page.getByRole("link", { name: tab })).toBeVisible();
  }
  await page.getByRole("link", { name: "Company setup" }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+\/onboarding$/i);
  await page.getByLabel("Main contact name").fill("Controlled contact updated");
  await page.getByRole("button", { name: "Save company setup" }).click();
  await expect(page).toHaveURL(/\/onboarding\?notice=saved$/);
  await expect(page.getByRole("status").filter({ hasText: "Company setup saved" })).toBeVisible();
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
});

test("creates one catalogue product without losing the route after insertion", async ({ page }, testInfo) => {
  // This journey performs creation, two image uploads, a primary-image
  // mutation, and a final update. Give a loaded serial CI worker enough total
  // time while retaining the focused per-operation assertions below.
  testInfo.setTimeout(60_000);
  await signInAsDemoOwner(page);
  await page.goto("/products/new");
  const name = `E2E catalogue product ${Date.now()}`;
  const form = page.locator('form[data-draft-id="create-product"]');
  await form.getByLabel("Product name").fill(name);
  await form.getByLabel("Subcategory").fill("Regression fixtures");
  await form.getByLabel("Axora internal cost (RM)").fill("12.50");
  await form.getByLabel("Description / specification").fill("Catalogue route-recovery regression fixture");
  await form.getByRole("button", { name: "Create product" }).click();

  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/edit(?:\?.*)?$/i, { timeout: 15_000 });
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(/Product created successfully/)).toBeVisible();

  const imageUpload = page.locator('form').filter({ has: page.getByRole("heading", { name: "Image slideshow" }) });
  await imageUpload.locator('input[name="images"]').setInputFiles([
    "public/catalog/categories/office-basics.webp",
    "public/catalog/categories/other.webp",
  ]);
  await imageUpload.getByLabel("Alternative text for this upload").fill("Controlled product image");
  const uploadResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && Boolean(response.request().headers()["next-action"]),
    { timeout: 15_000 },
  );
  const [, uploadResponse] = await Promise.all([
    imageUpload.getByRole("button", { name: "Upload images" }).click(),
    uploadResponsePromise,
  ]);
  expect(uploadResponse.status()).toBeLessThan(400);
  const gallery = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Manage gallery" }) });
  await expect(gallery.locator("article")).toHaveCount(2, { timeout: 15_000 });
  await gallery.getByRole("button", { name: "Make primary" }).click();
  await expect(gallery.getByText("Primary", { exact: true })).toHaveCount(1);

  const editor = page.locator("form.panel.form-panel").first();
  await editor.getByLabel("Description / specification").fill(
    "Catalogue route-recovery regression fixture updated",
  );
  await Promise.all([
    page.waitForURL(/\/products\?notice=product-updated$/),
    editor.getByRole("button", { name: "Save product" }).click(),
  ]);
  await expect(page.getByText("This page could not be restored")).toHaveCount(0);
  await expect(page.getByText("Product changes saved successfully.")).toBeVisible();
  await expect(page.getByRole("cell", { name }).first()).toBeVisible();
  await page.screenshot({
    path: `output/playwright/catalogue-product-created-${testInfo.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
});
