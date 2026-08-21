import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const retiredCopy = /Operations Experience|تجربة العمليات|Pengalaman Operasi/i;
const retiredResource = /(?:\/immersive\/|\.glb(?:\?|$)|three(?:\.module)?|react-three|meshopt)/i;

async function setPublicCookies(page: Page, locale: "en" | "ar" | "ms", appearance: "light" | "dark") {
  await page.context().addCookies([
    { name: "axora_locale", value: locale, url: baseURL },
    { name: "axora_appearance", value: appearance, url: baseURL },
  ]);
}

function captureUnexpectedRuntime(page: Page) {
  const failures: string[] = [];
  const retiredRequests: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Applying inline style violates the following Content Security Policy directive 'style-src-elem")) return;
    failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    if (retiredResource.test(request.url())) retiredRequests.push(request.url());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
  });
  return { failures, retiredRequests };
}

async function effectiveContrast(locator: Locator) {
  return locator.evaluate((element) => {
    type Rgba = { red: number; green: number; blue: number; alpha: number };
    const parse = (value: string): Rgba => {
      if (value.startsWith("color(srgb")) {
        const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return {
          red: (values[0] ?? 0) * 255,
          green: (values[1] ?? 0) * 255,
          blue: (values[2] ?? 0) * 255,
          alpha: values[3] ?? 1,
        };
      }
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
    const luminance = (color: Rgba) => 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return {
      ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      backgroundLuminance,
    };
  });
}

async function expectRetiredNavigationAbsent(page: Page) {
  await expect(page.locator('a[href*="operations-experience"]')).toHaveCount(0);
  await expect(page.getByText(retiredCopy)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "Sec-GPC": "1" });
});

test("public homepage Light and Dark surfaces remain readable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const runtime = captureUnexpectedRuntime(page);

  for (const appearance of ["light", "dark"] as const) {
    await setPublicCookies(page, "en", appearance);
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("data-appearance", appearance);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".simple-lifecycle-card")).toBeVisible();
    await expectRetiredNavigationAbsent(page);

    for (const selector of [
      ".public-hero h1",
      ".public-hero-lead",
      ".public-hero-actions .button-primary",
      ".public-hero-actions .button-secondary",
      ".simple-lifecycle-header > span:first-child",
      ".simple-lifecycle-list strong",
      ".simple-lifecycle-list small",
      ".simple-lifecycle-foot",
      ".public-process-grid h3",
      ".public-process-grid p",
      ".public-footer-grid a",
    ]) {
      const contrast = await effectiveContrast(page.locator(selector).first());
      expect(contrast.ratio, `${appearance} ${selector}`).toBeGreaterThanOrEqual(4.5);
    }

    for (const selector of [".simple-lifecycle-card", ".simple-lifecycle-list li", ".public-role-grid > a", ".simple-assurance-grid article"]) {
      const surface = await effectiveContrast(page.locator(selector).first());
      if (appearance === "dark") expect(surface.backgroundLuminance, selector).toBeLessThan(0.08);
      else expect(surface.backgroundLuminance, selector).toBeGreaterThan(0.75);
    }

    const axe = await new AxeBuilder({ page })
      .include(".public-site")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) })), appearance).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: `output/playwright/public-home-${appearance}-${testInfo.project.name}.png`,
    });
  }

  expect(runtime.retiredRequests).toEqual([]);
  expect(runtime.failures).toEqual([]);
});

test("Dark homepage fits every required responsive width and mobile navigation is retired", async ({ page }, testInfo) => {
  const runtime = captureUnexpectedRuntime(page);
  await setPublicCookies(page, "en", "dark");
  for (const width of [1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.goto("/en");
    await expect(page.locator(".simple-lifecycle-card")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px overflow`).toBeLessThanOrEqual(2);
    await expect(page.locator(".public-hero-actions .button-primary")).toBeVisible();
    await expect(page.locator(".public-hero-actions .button-secondary")).toBeVisible();
    if (width <= 1024) {
      await page.locator(".public-mobile-menu > button").click();
      const drawer = page.locator("#public-mobile-navigation");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText(retiredCopy)).toHaveCount(0);
      await expect(drawer.locator('a[href*="operations-experience"]')).toHaveCount(0);
    }
  }
  await page.screenshot({ animations: "disabled", fullPage: true, path: `output/playwright/public-home-dark-320-${testInfo.project.name}.png` });
  expect(runtime.retiredRequests).toEqual([]);
  expect(runtime.failures).toEqual([]);
});

test("Arabic Dark remains RTL and retired localized routes redirect without 3D", async ({ page }) => {
  const runtime = captureUnexpectedRuntime(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await setPublicCookies(page, "ar", "dark");
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".public-site")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".simple-lifecycle-card")).toBeVisible();
  await expectRetiredNavigationAbsent(page);
  await page.locator(".public-mobile-menu > button").click();
  await expect(page.locator("#public-mobile-navigation")).toBeVisible();
  await expectRetiredNavigationAbsent(page);

  for (const locale of ["en", "ar", "ms"] as const) {
    const response = await page.request.get(`/${locale}/operations-experience`, { maxRedirects: 0 });
    expect(response.status(), locale).toBe(308);
    expect(response.headers().location, locale).toBe(`/${locale}/how-it-works`);
    await page.goto(`/${locale}/operations-experience`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/how-it-works$`));
    await expect(page.locator("canvas")).toHaveCount(0);
  }

  expect(runtime.retiredRequests).toEqual([]);
  expect(runtime.failures).toEqual([]);
});
