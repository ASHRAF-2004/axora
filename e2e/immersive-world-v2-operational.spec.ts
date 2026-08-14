import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyAdmin: DemoRoleSession = {
  id: "30333333-3333-4333-8333-333333333333",
  email: "company-admin.fixture@axora.invalid",
  name: "Company administrator fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "10000000-0000-4000-8000-000000000001",
};

test("owner create routes are single-purpose and obsolete budget access is unavailable", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);

  await page.goto("/companies/new");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/company/i);
  await expect(page.locator("form").filter({ has: page.getByLabel("Display name") })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("search")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-add-company-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/products/new");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/product/i);
  await expect(page.locator('input[name="packaging"]')).toHaveCount(0);
  await expect(page.locator('input[name*="minimum"],input[name*="maximum"],input[name*="increment"]')).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.goto("/users/new");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.goto("/budgets");
  await expect(page.getByRole("heading", { name: /not found|could not be found/i })).toBeVisible();
});

test("owner sees Manage Drivers, a live driver detail map, and no normal assignment control", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/deliveries");
  await expect(page.getByRole("heading", { level: 1, name: "Manage Drivers" })).toBeVisible();
  await expect(page.getByText(/assign or reassign/i)).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-manage-drivers-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.getByRole("heading", { level: 1, name: "Demo Delivery Guy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live driver map" })).toBeVisible();
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-driver-detail-${testInfo.project.name}.png`, fullPage: true });
});

test("staff can select an atmosphere while company users remain on tenant branding", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/dashboard");
  if (!await page.getByRole("button", { name: "Aurora" }).isVisible()) {
    await page.locator(".app-menu-button").click();
  }
  await expect(page.getByRole("button", { name: "Aurora" })).toBeVisible();
  await page.getByRole("button", { name: "Ember" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-atmosphere", "ember");
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-staff-theme-${testInfo.project.name}.png`, fullPage: true });

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Aurora" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ember" })).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveAttribute("data-tenant-theme", /^(?:axora|company)$/);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-company-theme-precedence-${testInfo.project.name}.png`, fullPage: true });
});

test("customer catalogue uses licensed local category artwork and no product identifiers", async ({ page }, testInfo) => {
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/products");
  await expect(page.locator('img[src^="/catalog/categories/"]').first()).toBeVisible();
  await expect(page.locator('img[src^="http"]')).toHaveCount(0);
  await expect(page.getByText(/product id/i)).toHaveCount(0);
  await expect(page.getByText(/supplier|buying cost|internal markup/i)).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-catalogue-${testInfo.project.name}.png`, fullPage: true });
});
