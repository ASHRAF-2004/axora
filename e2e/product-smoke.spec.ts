import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

const authenticatedRoutes = [
  { path: "/dashboard", heading: /Good (morning|afternoon|evening),/ },
  { path: "/products", heading: "Products" },
  { path: "/requests", heading: "Purchase requests" },
  { path: "/sourcing", heading: "Sourcing and quotations" },
  { path: "/deliveries", heading: "Delivery control tower" },
  { path: "/receiving", heading: "Confirm delivered quantities" },
  { path: "/finance", heading: "Invoices and payments" },
  { path: "/documents", heading: "Documents" },
  { path: "/companies", heading: "Company lifecycle" },
  { path: "/branches", heading: "Branches & monthly budgets" },
  { path: "/suppliers", heading: "Suppliers" },
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
