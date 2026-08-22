import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole } from "./helpers/auth";

const arabicOwner = {
  id: "70000000-0000-4000-8000-000000000070",
  email: "arabic-email-operations@axora.invalid",
  name: "مالك عمليات البريد",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
  preferredLocale: "ar" as const,
};

const companyAdmin = {
  id: "70000000-0000-4000-8000-000000000071",
  email: "company-email-operations@axora.invalid",
  name: "Company email fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY" as const,
  scopeType: "COMPANY" as const,
  companyId: "10000000-0000-4000-8000-000000000001",
};

const malayOwner = {
  id: "70000000-0000-4000-8000-000000000072",
  email: "malay-email-operations@axora.invalid",
  name: "Pemilik operasi e-mel",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
  preferredLocale: "ms" as const,
};

async function selectAppearance(page: Page, appearance: "light" | "dark") {
  const shell = page.locator(".app-shell");
  if (await shell.getAttribute("data-appearance") === appearance) return;
  const mobile = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (mobile) {
    await page.locator(".app-menu-button").click();
    await expect(page.locator("dialog.app-drawer[open]")).toBeVisible();
  }
  const scope = mobile ? page.locator("dialog.app-drawer[open]") : page.locator(".app-desktop-appearance");
  await scope.locator(`[data-appearance-choice="${appearance}"]`).click();
  await expect(shell).toHaveAttribute("data-appearance", appearance);
  if (mobile) await page.locator("dialog.app-drawer[open]").evaluate((dialog: HTMLDialogElement) => dialog.close());
}

function captureUnexpectedRuntime(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Next's existing nonce-based CSP reports CSS-module reinsertion during
    // client refreshes in Playwright; the page-specific audit treats only
    // other console errors as application failures.
    if (message.text().startsWith("Applying inline style violates the following Content Security Policy directive 'style-src-elem")) return;
    failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
  });
  return failures;
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
    const luminance = (color: Rgba) => 0.2126 * linear(color.red)
      + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  });
}

test("owner sees live-source quota presentation and compact masked operations", async ({ page }, testInfo) => {
  const runtimeFailures = captureUnexpectedRuntime(page);
  await signInAsDemoOwner(page);
  await page.goto("/email-operations");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "Email Status",
  })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resend", exact: true })).toBeVisible();
  await expect(page.getByText("FREE", { exact: true })).toBeVisible();
  await expect(page.getByText("8 / 3,000", { exact: true })).toBeVisible();
  await expect(page.getByText("0 / 100", { exact: true })).toBeVisible();
  const progress = page.getByRole("progressbar");
  await expect(progress).toHaveCount(2);
  await expect(progress.nth(0)).toHaveAttribute("max", "3000");
  await expect(progress.nth(0)).toHaveAttribute("value", "8");
  await expect(progress.nth(1)).toHaveAttribute("max", "100");
  await expect(progress.nth(1)).toHaveAttribute("value", "0");
  await expect(page.getByText("Remaining: 2,992", { exact: true })).toBeVisible();
  await expect(page.getByText("Remaining: 100", { exact: true })).toBeVisible();
  await expect(page.getByText("Request update", { exact: true })).toBeVisible();
  await expect(page.getByText("ap***@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCSS("min-height", "44px");
  await expect(page.locator("main")).not.toContainText("owner@axora.e2e");
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
  for (const appearance of ["light", "dark"] as const) {
    await selectAppearance(page, appearance);
    for (const selector of [
      "main h1", "main h2", '[class*="description"]', '[class*="quotaMeta"] span',
      '[class*="table"] th', '[class*="table"] td', '[class*="retryButton"]',
    ]) {
      const target = page.locator(selector).filter({ visible: true }).first();
      if (await target.count()) {
        expect(await effectiveContrast(target), `${appearance} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.screenshot({
      animations: "disabled", fullPage: true,
      path: `output/playwright/email-status-en-${appearance}-${testInfo.project.name}.png`,
    });
  }
  expect(runtimeFailures).toEqual([]);
});

test("email status has no page overflow at required responsive widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One browser is sufficient for deterministic layout sampling.");
  await signInAsDemoOwner(page);
  for (const width of [1440, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.goto("/email-operations");
    await expect(page.getByRole("heading", { level: 1, name: "Email Status" })).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ), `${width}px horizontal overflow`).toBeLessThanOrEqual(2);
  }
});

test("Arabic operations remain RTL, mobile-safe, and reduced-motion aware", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, arabicOwner);
  await page.goto("/email-operations");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/[\u0600-\u06ff]/u);
  await selectAppearance(page, "dark");
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
  await page.screenshot({
    animations: "disabled", fullPage: true,
    path: `output/playwright/email-status-ar-dark-${testInfo.project.name}.png`,
  });
});

test("Malay operations use polished localized copy", async ({ page }, testInfo) => {
  await signInAsDemoRole(page, malayOwner);
  await page.goto("/email-operations");
  await selectAppearance(page, "light");
  await expect(page.getByRole("heading", { level: 1, name: "Status E-mel" })).toBeVisible();
  await expect(page.getByText("Had bulanan", { exact: true })).toBeVisible();
  await expect(page.getByText("Baki: 2,992", { exact: true })).toBeVisible();
  await page.screenshot({
    animations: "disabled", fullPage: true,
    path: `output/playwright/email-status-ms-light-${testInfo.project.name}.png`,
  });
});

test("company users cannot enter global email operations", async ({ page }) => {
  await signInAsDemoRole(page, companyAdmin);
  await page.goto("/email-operations");
  await expect(page.getByRole("heading", { name: "This page is not part of your role" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email Status" })).toHaveCount(0);
});
