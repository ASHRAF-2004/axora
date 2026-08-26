import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

// These journeys submit financial and tenant mutations. A failed assertion must
// never make CI replay the same command against the retained demo server state.
test.describe.configure({ retries: 0 });

const companyId = "11111111-1111-4111-8111-111111111111";
const existingBranchId = "88888888-8888-4888-8888-888888888888";

function companyAdmin(projectName: string, locale: "en" | "ar" | "ms" = "en") {
  return {
    id: projectName === "mobile-chrome"
      ? "30333333-3333-4333-8333-333333333338"
      : "30333333-3333-4333-8333-333333333337",
    email: `company-foundation-${projectName}@axora.invalid`,
    name: `Company foundation ${projectName}`,
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
    preferredLocale: locale,
  } satisfies DemoRoleSession;
}

function watchForUnexpectedBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror:${error.name}:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });
  return failures;
}

async function selectAppearance(page: Page, appearance: "light" | "dark") {
  const shell = page.locator(".app-shell");
  if (await shell.getAttribute("data-appearance") === appearance) return;
  const mobile = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (mobile) await page.locator(".app-menu-button").click();
  const scope = mobile ? page.locator("dialog.app-drawer[open]") : page.locator(".app-desktop-appearance");
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/profile/appearance")
    && candidate.request().method() === "PATCH");
  await scope.locator(`[data-appearance-choice="${appearance}"]`).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toHaveAttribute("data-appearance", appearance);
  if (mobile) await page.locator("dialog.app-drawer[open]").evaluate((dialog: HTMLDialogElement) => dialog.close());
}

test("Company Administrator completes users, branch location and first budget on the first attempt", async ({ page }, testInfo) => {
  const browserFailures = watchForUnexpectedBrowserFailures(page);
  const actor = companyAdmin(testInfo.project.name);
  await signInAsDemoRole(page, actor);

  await page.goto("/dashboard");
  await page.locator(".app-menu-button").click();
  const drawer = page.locator("dialog.app-drawer[open]");
  await drawer.getByRole("link", { name: "Company Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Company Users" })).toBeVisible();
  await expect(page.locator("#portal-main").getByText(actor.email, { exact: true })).toBeVisible();
  for (const ownerTab of ["Overview", "Company setup", "Documents", "Email Status", "Axora Users"]) {
    await expect(page.getByRole("link", { name: ownerTab, exact: true })).toHaveCount(0);
  }

  await page.getByRole("link", { name: "Create Company User" }).click();
  await expect(page.getByLabel("Customer company")).toHaveCount(0);
  const invitedEmail = `foundation-branch-admin-${testInfo.project.name}@axora.invalid`;
  await page.getByLabel("Full name").fill(`Foundation branch administrator ${testInfo.project.name}`);
  await page.getByLabel("Work email").fill(invitedEmail);
  await page.getByLabel("Role").selectOption("BRANCH_ADMIN");
  await page.getByLabel("Assigned branch").selectOption(existingBranchId);
  await page.getByRole("button", { name: "Create account & send invite" }).click();
  await expect(page).toHaveURL(/\/users\?notice=user-created-email-disabled$/, { timeout: 15_000 });
  await expect(page.locator("tr").filter({ hasText: invitedEmail })).toHaveCount(1);

  await page.goto(`/companies/${companyId}`);
  await expect(page).toHaveURL(/\/access-denied$/);

  await page.goto("/branches/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create branch" })).toBeVisible();
  await expect(page.locator('#portal-main select[name="companyId"]')).toHaveCount(0);
  const suffix = testInfo.project.name === "mobile-chrome" ? "M" : "D";
  const branchName = `Verdi operations ${suffix}`;
  await page.getByLabel("Branch name").fill(branchName);
  await page.getByLabel("Branch short code").fill(`VERDI-${suffix}`);
  await page.getByLabel("City / area").fill("Cyberjaya");
  await page.getByLabel("Contact name").fill("Operations desk");
  await page.getByLabel("Contact phone").fill("+12025550123");
  await page.getByLabel("Search place, building or address").fill("verdi");
  const option = page.getByRole("option").filter({ hasText: "Verdi Eco-Dominiums" }).first();
  await expect(option).toBeVisible();
  await option.getByRole("button").click();
  await expect(page.getByText(/Verdi Eco-Dominiums/).last()).toBeVisible();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".maplibregl-marker")).toBeVisible();
  await expect.poll(async () => {
    const [marker, map] = await Promise.all([
      page.locator(".maplibregl-marker").boundingBox(),
      page.locator("canvas.maplibregl-canvas").boundingBox(),
    ]);
    if (!marker || !map) return Number.POSITIVE_INFINITY;
    return Math.hypot(
      marker.x + marker.width / 2 - (map.x + map.width / 2),
      marker.y + marker.height / 2 - (map.y + map.height / 2),
    );
  }).toBeLessThan(3);
  await page.locator(".maplibregl-map").screenshot({
    animations: "disabled",
    path: `output/playwright/company-admin-location-map-${testInfo.project.name}.png`,
  });
  const confirm = page.getByRole("button", { name: "Confirm location" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText("Location confirmed. Save the form to finish.")).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true,
    path: `output/playwright/company-admin-branch-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Create branch" }).click();
  await expect(page).toHaveURL(/\/branches\/br-[a-z0-9-]+\?notice=branch-created$/, { timeout: 15_000 });
  const createdBranchId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByRole("heading", { level: 1, name: branchName })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: branchName })).toBeVisible();
  await page.getByRole("link", { name: "Edit branch" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit branch information" })).toBeVisible();
  await expect(page.locator('form input[name="companyId"]')).toHaveCount(0);
  await page.getByLabel("Contact phone").fill("+12025550124");
  await page.getByLabel("Notes").fill("Call the receiving desk on arrival");
  await page.getByRole("button", { name: "Save branch" }).click();
  await expect(page).toHaveURL(new RegExp(`/branches/${createdBranchId}\\?notice=branch-updated$`));
  await expect(page.getByText("+12025550124", { exact: true })).toBeVisible();
  await expect(page.getByText("Call the receiving desk on arrival", { exact: true })).toBeVisible();
  const people = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: "People" }) });
  await expect(people.getByText("0 assigned")).toBeVisible();

  await page.getByRole("link", { name: "Edit delivery address" }).click();
  await page.getByLabel("Search place, building or address").fill("kenwingston business");
  const updatedLocation = page.getByRole("option").filter({ hasText: "Kenwingston Business Centre" }).first();
  await expect(updatedLocation).toBeVisible();
  await updatedLocation.getByRole("button").click();
  await page.getByRole("button", { name: "Confirm location" }).click();
  await expect(page.getByText("Location confirmed. Save the form to finish.")).toBeVisible();
  await page.getByRole("button", { name: "Save delivery location" }).click();
  await page.reload();
  await expect(page.getByText(/Kenwingston Business Centre/).last()).toBeVisible();
  await page.getByRole("link", { name: "Back to branch" }).click();

  await page.getByRole("link", { name: "View budget" }).click();
  await expect(page).toHaveURL(new RegExp(`/budgets/${createdBranchId}$`));
  await page.getByLabel("Amount").fill("1000");
  await page.getByLabel("Cycle").selectOption("MONTHLY");
  await page.getByRole("button", { name: "Set budget" }).click();
  await expect(page.getByText(/RM\s*1,000\.00/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Set budget" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/RM\s*1,000\.00/).first()).toBeVisible();
  await expect(page.getByText("The active budget period is immutable.", { exact: false })).toBeVisible();
  await selectAppearance(page, "dark");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", "dark");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true,
    path: `output/playwright/company-admin-budget-${testInfo.project.name}-dark.png` });

  await expect(page.getByText(/Something went wrong|This page could not be restored|Reference:/i)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  expect(browserFailures).toEqual([]);
});

async function geolocationPage(browser: Browser, mode: "allowed" | "denied" | "timeout") {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  if (mode === "allowed") {
    await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3100" });
    await context.setGeolocation({ latitude: 2.9188294, longitude: 101.6411689 });
  } else {
    await context.addInitScript((errorCode) => {
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({
          code: errorCode,
          message: errorCode === 1 ? "Permission denied in controlled fixture" : "Timed out in controlled fixture",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError),
      } });
    }, mode === "denied" ? 1 : 3);
  }
  const page = await context.newPage();
  await signInAsDemoRole(page, companyAdmin(`geolocation-${mode}`));
  return { context, page };
}

test("current location remains explicit and recovers from allowed, denied and timeout outcomes", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The browser permission contract is viewport-independent.");
  for (const mode of ["allowed", "denied", "timeout"] as const) {
    const { context, page } = await geolocationPage(browser, mode);
    try {
      await page.goto("/branches/new");
      await expect(page.getByText("No coordinates selected yet.")).toBeVisible();
      const search = page.getByLabel("Search place, building or address");
      await expect(search).toBeEnabled();
      await page.getByRole("button", { name: "Use my current location" }).click();
      if (mode === "allowed") {
        await expect(page.getByText(/Verdi Eco-Dominiums/).last()).toBeVisible();
        await expect(page.getByRole("button", { name: "Confirm location" })).toBeEnabled();
      } else {
        await expect(page.getByText(mode === "denied"
          ? "Location permission was denied. Search or choose the location on the map instead."
          : "Your current location took too long to resolve. Search or choose the location on the map instead.")).toBeVisible();
        await expect(search).toBeEnabled();
      }
      await expect(page.getByText(/Something went wrong|Reference:/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

test("Arabic and Malay Company Administrator workspaces retain locale, RTL and canonical navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Locale semantics run once alongside both-project first-attempt coverage.");
  for (const locale of ["ar", "ms"] as const) {
    await page.context().clearCookies();
    await signInAsDemoRole(page, companyAdmin(`locale-${locale}`, locale));
    await page.goto("/branches/new");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "ar" ? "إنشاء فرع" : "Cipta cawangan");
    await expect(page.locator('#portal-main select[name="companyId"]')).toHaveCount(0);
    await page.goto("/budgets");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "ar" ? "الميزانيات" : "Bajet");
    await expect(page.getByText(locale === "ar" ? "شهري" : "Bulanan", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("MONTHLY", { exact: true })).toHaveCount(0);
    await page.screenshot({ animations: "disabled", fullPage: true,
      path: `output/playwright/company-admin-locale-${locale}-chromium.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  }
});
