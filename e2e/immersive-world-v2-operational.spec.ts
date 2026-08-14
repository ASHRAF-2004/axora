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

const deliveryGuy: DemoRoleSession = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "delivery.fixture@axora.invalid",
  name: "Demo Delivery Guy",
  role: "DELIVERY_GUY",
  accountKind: "DELIVERY",
  scopeType: "DELIVERY",
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

  await page.addInitScript(() => {
    class FixtureEventSource {
      private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
      constructor() {
        window.setTimeout(() => {
          const snapshot = { locations: [
            { latitude: 3.139, longitude: 101.6869, accuracy: 8, capturedAt: new Date().toISOString() },
            { latitude: 3.1412, longitude: 101.69, accuracy: 6, capturedAt: new Date().toISOString() },
          ] };
          const event = new MessageEvent("snapshot", { data: JSON.stringify({ sequence: 2, version: "fixture-map", snapshot }) });
          this.listeners.get("snapshot")?.forEach((listener) => listener(event));
        }, 200);
      }
      addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      close() { this.listeners.clear(); }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: FixtureEventSource });
  });
  const sourceResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/maps/") && response.url().endsWith(".geojson") && response.ok()) sourceResponses.push(response.url());
  });
  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.getByRole("heading", { level: 1, name: "Demo Delivery Guy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live driver map" })).toBeVisible();
  const map = page.locator('[data-map-provider="natural-earth-self-hosted"]');
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  await expect(map).toHaveAttribute("data-route-point-count", "2");
  await expect(map).toHaveAttribute("data-latest-coordinate", "3.141200,101.690000");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Natural Earth" })).toBeVisible();
  expect(sourceResponses.length).toBeGreaterThanOrEqual(2);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-driver-detail-${testInfo.project.name}.png`, fullPage: true });
  await map.screenshot({ animations: "disabled", path: `output/playwright/v2-populated-driver-map-${testInfo.project.name}.png` });
});

test("missing map configuration is honest and customer sessions cannot read raw driver coordinates", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.route("**/maps/axora-operational-style.json", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.locator('[data-map-state="failed"]')).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "The map is unavailable" })).toBeVisible();

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdmin);
  const response = await page.request.get("/api/drivers/44444444-4444-4444-8444-444444444444");
  expect([403, 404]).toContain(response.status());
});

test("delivery users receive the live self-claim pool without owner assignment controls", async ({ page }, testInfo) => {
  await signInAsDemoRole(page, deliveryGuy);
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "Available delivery jobs" })).toBeVisible();
  await expect(page.getByText(/owner assign|assigned by owner/i)).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-available-job-pool-${testInfo.project.name}.png`, fullPage: true });
});

test("staff can select an atmosphere while company users remain on tenant branding", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/dashboard");
  if (!await page.getByRole("button", { name: "Aurora" }).isVisible()) {
    await page.locator(".app-menu-button").click();
  }
  await expect(page.getByRole("button", { name: "Aurora" })).toBeVisible();
  const ember = page.getByRole("button", { name: "Ember" });
  const alreadyPersisted = await ember.getAttribute("aria-pressed") === "true";
  if (!alreadyPersisted) await ember.click();
  await expect(page.locator("html")).toHaveAttribute("data-atmosphere", "ember");
  if (!alreadyPersisted) await expect(page.locator('fieldset[data-persistence-state="saved"]')).toBeVisible();
  const staffTheme = await page.locator(".app-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, brand: style.getPropertyValue("--axora-brand").trim() };
  });
  expect(staffTheme.brand).toBe("#bd3f32");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-atmosphere", "ember");
  expect((await page.locator(".app-shell").evaluate((element) => getComputedStyle(element).getPropertyValue("--axora-brand").trim()))).toBe("#bd3f32");
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-staff-theme-${testInfo.project.name}.png`, fullPage: true });

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Aurora" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ember" })).toHaveCount(0);
  const companyShell = page.locator('.app-shell[data-tenant-theme="company"]');
  await expect(companyShell).toBeVisible();
  const companyTheme = await companyShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      brand: style.getPropertyValue("--axora-brand").trim(),
      tenantBrand: style.getPropertyValue("--tenant-primary").trim(),
      rootBrand: getComputedStyle(document.documentElement).getPropertyValue("--axora-brand").trim(),
    };
  });
  expect(companyTheme.brand).toBe(companyTheme.tenantBrand);
  expect(companyTheme.brand).not.toBe(companyTheme.rootBrand);
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
