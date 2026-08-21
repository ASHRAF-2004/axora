import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";
const companyAdmin: DemoRoleSession = {
  id: "30333333-3333-4333-8333-333333333333",
  email: "company-admin.fixture@axora.invalid",
  name: "Company administrator fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
};
const arabicRequester: DemoRoleSession = {
  id: "86000000-0000-4000-8000-000000000003",
  email: "rtl-requester@axora.invalid",
  name: "مستخدم تجريبي",
  preferredLocale: "ar",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId,
  branchId: "88888888-8888-4888-8888-888888888888",
};

async function selectAppearance(page: Page, appearance: "light" | "dark") {
  const shell = page.locator(".app-shell");
  if (await shell.getAttribute("data-appearance") === appearance) {
    await expect(page.locator("html")).not.toHaveAttribute("data-ux-navigating", "true");
    return;
  }
  const mobile = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (mobile) {
    await page.locator(".app-menu-button").click();
    await expect(page.locator("dialog.app-drawer[open]")).toBeVisible();
  }
  const scope = mobile ? page.locator("dialog.app-drawer[open]") : page.locator(".app-desktop-appearance");
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/profile/appearance")
      && candidate.request().method() === "PATCH"
  ));
  await scope.locator(`[data-appearance-choice="${appearance}"]`).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toHaveAttribute("data-appearance", appearance);
  await expect(scope.locator("fieldset")).toHaveAttribute("data-persistence-state", "ready");
  if (mobile) await page.locator("dialog.app-drawer[open]").evaluate((dialog: HTMLDialogElement) => dialog.close());
  await expect(page.locator("html")).not.toHaveAttribute("data-ux-navigating", "true");
}

async function effectiveContrast(locator: Locator) {
  return locator.evaluate((element) => {
    type Rgba = { red: number; green: number; blue: number; alpha: number };
    const parse = (value: string): Rgba => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { red: values[0] ?? 0, green: values[1] ?? 0, blue: values[2] ?? 0, alpha: values[3] ?? 1 };
    };
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front.alpha + back.alpha * (1 - front.alpha);
      if (!alpha) return { red: 0, green: 0, blue: 0, alpha: 0 };
      return {
        red: (front.red * front.alpha + back.red * back.alpha * (1 - front.alpha)) / alpha,
        green: (front.green * front.alpha + back.green * back.alpha * (1 - front.alpha)) / alpha,
        blue: (front.blue * front.alpha + back.blue * back.alpha * (1 - front.alpha)) / alpha,
        alpha,
      };
    };
    const lineage: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) lineage.unshift(current);
    let background: Rgba = { red: 255, green: 255, blue: 255, alpha: 1 };
    for (const current of lineage) background = over(parse(getComputedStyle(current).backgroundColor), background);
    const foreground = over(parse(getComputedStyle(element).color), background);
    const linear = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: Rgba) => (
      0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    );
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return { ratio: (light + 0.05) / (dark + 0.05), backgroundLuminance: luminance(background) };
  });
}

function captureUnexpectedRuntime(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // axe-core injects ephemeral audit styles; the dev CSP reports those exact
    // audit-only tags, while production application styles remain unaffected.
    if (message.text().startsWith("Applying inline style violates the following Content Security Policy directive 'style-src-elem")) return;
    failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => { if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", (request) => {
    // Navigations and EventSource replacement deliberately abort superseded requests.
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
  });
  return { failures };
}

test("authenticated dashboard surfaces retain AA contrast in Light and Dark", async ({ page }, testInfo) => {
  await signInAsDemoOwner(page);
  const runtime = captureUnexpectedRuntime(page);
  await page.goto("/dashboard");
  await expect(page.locator(".metric-card").first()).toBeVisible();

  for (const appearance of ["light", "dark"] as const) {
    await selectAppearance(page, appearance);
    for (const selector of [
      ".metric-label", ".metric-value", ".metric-note", ".panel-header h2",
      ".panel-header p", ".table-link", ".data-table th", ".data-table td", ".callout p",
    ]) {
      const target = page.locator(selector).filter({ visible: true }).first();
      if (!await target.count()) continue;
      const contrast = await effectiveContrast(target);
      expect(contrast.ratio, `${appearance} ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const selector of [".metric-card", ".panel", ".data-table td"]) {
      const surface = page.locator(selector).filter({ visible: true }).first();
      if (!await surface.count()) continue;
      const contrast = await effectiveContrast(surface);
      if (appearance === "dark") expect(contrast.backgroundLuminance, selector).toBeLessThan(0.12);
      else expect(contrast.backgroundLuminance, selector).toBeGreaterThan(0.75);
    }
    const accessibility = await new AxeBuilder({ page })
      .include(".app-shell")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({ html: node.html, target: node.target })),
    })), appearance).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: `output/playwright/prompt-10-dashboard-${appearance}-${testInfo.project.name}.png`,
    });
  }
  expect(runtime.failures).toEqual([]);
});

test("Arabic portal geometry, mixed direction, keyboard drawer, and browser state are correct", async ({ page }) => {
  await signInAsDemoRole(page, arabicRequester);
  await page.goto("/requests?q=ورق&status=open#request-table");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".app-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".bidi-ltr").first()).toHaveCSS("direction", "ltr");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const trigger = page.locator(".app-menu-button");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = page.locator("dialog.app-drawer[open]");
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const drawerHeadContrast = await effectiveContrast(drawer.locator(".app-drawer-head strong"));
  expect(drawerHeadContrast.ratio).toBeGreaterThanOrEqual(4.5);
  expect(drawerHeadContrast.backgroundLuminance).toBeLessThan(0.15);
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - (viewport?.width ?? 0))).toBeLessThanOrEqual(2);
  if ((viewport?.width ?? 0) > 500) expect(box?.x ?? 0).toBeGreaterThan(0);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: "output/playwright/prompt-10-arabic-drawer.png",
  });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await drawer.locator("nav a").first().click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(/\/branches$/);
  await page.goto("/requests?q=ورق&status=open#request-table");

  await selectAppearance(page, "dark");
  await page.goto("/requests?q=حبر&status=Approved#request-table");
  await page.goBack();
  await expect(page).toHaveURL(/q=%D9%88%D8%B1%D9%82&status=open#request-table$/);
  await page.goForward();
  await expect(page).toHaveURL(/q=%D8%AD%D8%A8%D8%B1&status=Approved#request-table$/);
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", "dark");
  await expect(page).toHaveURL(/q=%D8%AD%D8%A8%D8%B1&status=Approved#request-table$/);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: "output/playwright/prompt-10-arabic-requests-dark.png",
  });
});

test("skip navigation and profile menu are keyboard operable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop keyboard behavior is independent of viewport sampling.");
  await signInAsDemoRole(page, {
    id: "demo-admin",
    email: "owner@axora.e2e",
    name: "Axora demo administrator",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    isOwner: true,
  });
  await page.goto("/dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".route-loading-screen")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-ux-navigating", "true");
  const skipLink = page.locator(".skip-link");
  const skipLinkIsFirstSequentialControl = await page.evaluate(() => {
    const selector = 'a[href], button, input, select, textarea, [tabindex]';
    const first = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
      const style = getComputedStyle(element);
      return element.tabIndex >= 0
        && !element.hasAttribute("disabled")
        && style.display !== "none"
        && style.visibility !== "hidden";
    });
    return first?.classList.contains("skip-link") ?? false;
  });
  expect(skipLinkIsFirstSequentialControl).toBe(true);
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#portal-main")).toBeFocused();

  const profileButton = page.locator(".app-profile-button");
  await profileButton.focus();
  await page.keyboard.press("Enter");
  const menuItems = page.locator('#app-profile-menu [role="menuitem"]');
  await expect(menuItems.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(menuItems.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#app-profile-menu")).toHaveCount(0);
  await expect(profileButton).toBeFocused();
});

test("representative role and Malay workspaces render only inside the authorized shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The mobile role sample is covered by dashboard and RTL projects.");
  const scenarios: Array<{ actor: DemoRoleSession | "owner"; route: string }> = [
    { actor: "owner", route: "/users" },
    { actor: "owner", route: "/notifications" },
    { actor: { ...companyAdmin, preferredLocale: "ms" }, route: "/wallet" },
    { actor: { ...companyAdmin, preferredLocale: "ms", id: "30333333-3333-4333-8333-333333333334" }, route: "/budgets" },
    { actor: { id: "55555555-5555-4555-8555-555555555555", email: "cam@axora.invalid", name: "CAM fixture", role: "CLIENT_ACCOUNT_MANAGER", accountKind: "PLATFORM", scopeType: "PLATFORM" }, route: "/companies" },
    { actor: { ...arabicRequester, preferredLocale: "ms", id: "86000000-0000-4000-8000-000000000004" }, route: "/products" },
    { actor: { ...arabicRequester, preferredLocale: "ms", id: "86000000-0000-4000-8000-000000000005" }, route: "/profile" },
    { actor: { id: "44444444-4444-4444-8444-444444444444", email: "delivery@axora.invalid", name: "Delivery fixture", role: "DELIVERY_GUY", accountKind: "DELIVERY", scopeType: "DELIVERY" }, route: "/driver" },
  ];
  for (const scenario of scenarios) {
    await page.context().clearCookies();
    if (scenario.actor === "owner") await signInAsDemoOwner(page);
    else await signInAsDemoRole(page, scenario.actor);
    await page.goto(scenario.route);
    await expect(page).toHaveURL(new RegExp(`${scenario.route.replace("/", "\\/")}$`));
    const shell = page.locator(".app-shell");
    const expectedLocale = scenario.actor === "owner" ? "en" : scenario.actor.preferredLocale ?? "en";
    await expect(shell).toHaveAttribute("lang", expectedLocale);
    await expect(shell).toHaveAttribute("dir", expectedLocale === "ar" ? "rtl" : "ltr");
    await expect(shell.locator("main.app-content")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${scenario.route} overflow`).toBe(true);
    for (const selector of [".app-menu-button", ".app-active-brand"]) {
      const box = await shell.locator(selector).boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      expect(box, `${scenario.route} ${selector}`).not.toBeNull();
      expect(box?.x ?? -1, `${scenario.route} ${selector} start`).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? width) + (box?.width ?? 1), `${scenario.route} ${selector} end`).toBeLessThanOrEqual(width);
    }
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/unexpected error|reference id/i)).toHaveCount(0);
    await selectAppearance(page, "dark");
    const surfaces = page.locator('.app-shell :is(.panel,.metric-card,.card,.table-wrap,.toolbar,.shop-product-card,.shop-cart-bar,.shop-search-box,[class*="_card_"],[class*="_panel_"],[class*="_metric"])').filter({ visible: true });
    for (let index = 0; index < Math.min(await surfaces.count(), 24); index += 1) {
      expect((await effectiveContrast(surfaces.nth(index))).backgroundLuminance, `${scenario.route} surface ${index}`).toBeLessThan(0.15);
    }
    const accessibility = await new AxeBuilder({ page })
      .include(".app-shell")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({
        failure: node.failureSummary,
        html: node.html,
        target: node.target,
      })),
    })), scenario.route).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: `output/playwright/prompt-10-route-${scenario.route.slice(1).replaceAll("/", "-")}.png`,
    });
  }
});
