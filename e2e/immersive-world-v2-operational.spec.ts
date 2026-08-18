import { expect, test, type Page } from "@playwright/test";
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

async function visibleAppearanceButton(page: Page, appearance: "Light" | "Dark") {
  const desktopButton = page.locator(`.app-desktop-appearance button[aria-label="Appearance: ${appearance}"]`);
  const usesDrawer = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (!usesDrawer) {
    await expect(desktopButton).toBeVisible();
    return desktopButton;
  }

  const openDrawer = page.locator("dialog.app-drawer[open]");
  if (!await openDrawer.isVisible()) {
    await page.locator(".app-menu-button").click();
  }
  await expect(openDrawer).toBeVisible();
  const drawerButton = openDrawer.locator(`.app-drawer-appearance button[aria-label="Appearance: ${appearance}"]`);
  await expect(drawerButton).toBeVisible();
  return drawerButton;
}

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

  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    class FixtureEventSource {
      private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
      constructor() {
        window.setTimeout(() => {
          const snapshot = { locations: [
            { latitude: 3.139, longitude: 101.6869, accuracy: 8, capturedAt: new Date().toISOString() },
            { latitude: 3.1412, longitude: 101.69, accuracy: 6, capturedAt: new Date().toISOString() },
          ] };
          const event = new MessageEvent("snapshot", { data: JSON.stringify({ sequence: 2, version: "a".repeat(64), snapshot }) });
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
    if (/\/maps\/(?:mvp-klang-valley-(?:roads|places)\.geojson|fonts\/)/.test(response.url()) && response.ok()) sourceResponses.push(response.url());
  });
  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.getByRole("heading", { level: 1, name: "Demo Delivery Guy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live driver map" })).toBeVisible();
  const map = page.locator('[data-map-provider="axora-mvp-klang-valley"]');
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  await expect(map).toHaveAttribute("data-route-point-count", "2");
  await expect(map).toHaveAttribute("data-latest-coordinate", "3.141200,101.690000");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "© OpenStreetMap contributors" }).first()).toBeVisible();
  expect(sourceResponses.some((url) => url.includes("mvp-klang-valley-roads.geojson"))).toBe(true);
  expect(sourceResponses.some((url) => url.includes("mvp-klang-valley-places.geojson"))).toBe(true);
  expect(sourceResponses.some((url) => url.includes("/maps/fonts/"))).toBe(true);
  expect(browserErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-driver-detail-${testInfo.project.name}.png`, fullPage: true });
  await map.screenshot({ animations: "disabled", path: `output/playwright/v2-driver-map-operational-${testInfo.project.name}.png` });
});

test("missing map configuration is honest and customer sessions cannot read raw driver coordinates", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.route("**/maps/driver-map-config.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"version":1,"status":"unconfigured"}' }));
  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.locator('[data-map-provider="unconfigured"]')).toHaveAttribute("data-map-state", "unconfigured");
  await expect(page.getByRole("alert").filter({ hasText: "Operational street mapping is not configured" })).toBeVisible();
  await expect(page.locator(".maplibregl-map")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: `output/playwright/v2-driver-map-unconfigured-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdmin);
  const response = await page.request.get("/api/drivers/44444444-4444-4444-8444-444444444444");
  expect([403, 404]).toContain(response.status());
});

test("a configured map provider failure shows an honest unavailable state", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.route("**/maps/driver-map-config.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      version: 1,
      status: "configured",
      providerId: "failed-provider",
      providerName: "Failed provider fixture",
      styleUrl: "/maps/failed-provider/style.json",
      attribution: { label: "Failed map fixture", url: "https://example.test/map-licence" },
      coverage: { bounds: [101.35, 2.7, 102, 3.45], label: "Controlled pilot coverage" },
    }),
  }));
  await page.route("**/maps/failed-provider/style.json", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/deliveries/drivers/44444444-4444-4444-8444-444444444444");
  await expect(page.locator('[data-map-provider="failed-provider"]')).toHaveAttribute("data-map-state", "failed");
  await expect(page.getByRole("alert").filter({ hasText: "approved map source is unavailable" })).toBeVisible();
  await expect(page.locator(".maplibregl-map")).toHaveCount(0);
});

test("delivery users receive the live self-claim pool without owner assignment controls", async ({ page }, testInfo) => {
  await signInAsDemoRole(page, deliveryGuy);
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "Available delivery jobs" })).toBeVisible();
  await expect(page.getByText(/owner assign|assigned by owner/i)).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-available-job-pool-${testInfo.project.name}.png`, fullPage: true });
});

test("authenticated users select Light or Dark while company branding remains authoritative", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  await page.goto("/dashboard");
  const light = await visibleAppearanceButton(page, "Light");
  await expect(light).toHaveAttribute("aria-pressed", "true");
  const dark = await visibleAppearanceButton(page, "Dark");
  const persisted = page.waitForResponse((response) => (
    response.url().endsWith("/api/profile/appearance")
      && response.request().method() === "PATCH"
  ));
  await dark.click();
  const response = await persisted;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ appearance: "dark" });
  await expect(dark.locator("xpath=ancestor::fieldset")).toHaveAttribute("data-persistence-state", "ready");
  const staffShell = page.locator('.app-shell[data-tenant-theme="axora"]');
  await expect(staffShell).toHaveAttribute("data-appearance", "dark");
  expect((await staffShell.evaluate((element) => getComputedStyle(element).getPropertyValue("--axora-page-bg").trim()))).toBe("#071521");
  await page.reload();
  await expect(staffShell).toHaveAttribute("data-appearance", "dark");
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-staff-appearance-${testInfo.project.name}.png`, fullPage: true });

  await page.context().clearCookies();
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /Aurora|Solar|Ember|Midnight/ })).toHaveCount(0);
  const companyShell = page.locator('.app-shell[data-tenant-theme="company"]');
  await expect(companyShell).toBeVisible();
  const initialAppearance = await companyShell.getAttribute("data-appearance");
  expect(["light", "dark"]).toContain(initialAppearance);
  const initialTheme = await companyShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      brand: style.getPropertyValue("--axora-brand").trim(),
      tenantBrand: style.getPropertyValue("--tenant-primary").trim(),
      surface: style.getPropertyValue("--axora-surface").trim(),
      lightSurface: style.getPropertyValue("--tenant-surface-light").trim(),
      darkSurface: style.getPropertyValue("--tenant-surface-dark").trim(),
      colorScheme: style.colorScheme,
    };
  });
  expect(initialTheme.brand).toBe(initialTheme.tenantBrand);
  expect(initialTheme.surface).toBe(initialAppearance === "dark" ? initialTheme.darkSurface : initialTheme.lightSurface);
  expect(initialTheme.colorScheme).toBe(initialAppearance);

  const nextAppearance = initialAppearance === "dark" ? "Light" : "Dark";
  const nextButton = await visibleAppearanceButton(page, nextAppearance);
  const companyPersisted = page.waitForResponse((nextResponse) => (
    nextResponse.url().endsWith("/api/profile/appearance")
      && nextResponse.request().method() === "PATCH"
  ));
  await nextButton.click();
  expect((await companyPersisted).status()).toBe(200);
  const expectedAppearance = nextAppearance.toLowerCase();
  await expect(companyShell).toHaveAttribute("data-appearance", expectedAppearance);
  const switchedTheme = await companyShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      brand: style.getPropertyValue("--axora-brand").trim(),
      tenantBrand: style.getPropertyValue("--tenant-primary").trim(),
      surface: style.getPropertyValue("--axora-surface").trim(),
      lightSurface: style.getPropertyValue("--tenant-surface-light").trim(),
      darkSurface: style.getPropertyValue("--tenant-surface-dark").trim(),
      colorScheme: style.colorScheme,
    };
  });
  expect(switchedTheme.brand).toBe(switchedTheme.tenantBrand);
  expect(switchedTheme.brand).toBe(initialTheme.brand);
  expect(switchedTheme.surface).toBe(expectedAppearance === "dark" ? switchedTheme.darkSurface : switchedTheme.lightSurface);
  expect(switchedTheme.surface).not.toBe(initialTheme.surface);
  expect(switchedTheme.colorScheme).toBe(expectedAppearance);
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-company-appearance-precedence-${testInfo.project.name}.png`, fullPage: true });
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
