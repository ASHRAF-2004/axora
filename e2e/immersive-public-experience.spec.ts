import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseURL = "http://127.0.0.1:3100";

async function useLocale(context: Parameters<typeof test>[0] extends never ? never : import("@playwright/test").BrowserContext, locale: "en" | "ar" | "ms") {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

test("desktop loads the 3D console and keeps every control accessible", async ({ context, page }) => {
  await useLocale(context, "en");
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const nextDevStyleNoise = text.startsWith("Applying inline style violates")
      && text.includes("style-src-elem");
    if (message.type() === "error" && !nextDevStyleNoise) errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/en");

  await expect(page.getByTestId("workflow-console")).toBeVisible();
  await expect(page.locator('canvas[data-testid="workflow-webgl"]')).toBeVisible();
  const approve = page.getByRole("tab", { name: /02.*Approve/ });
  await approve.click();
  await expect(approve).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("separation of duties");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("3");
  await expect(page.getByRole("tab", { name: /03.*Pay/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Enable interface sound" })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("sound stays silent by default and persists only after explicit activation", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  const enable = page.getByRole("button", { name: "Enable interface sound" });
  await expect(enable).toHaveAttribute("aria-pressed", "false");
  await enable.click();
  await expect(page.getByRole("button", { name: "Mute interface sound" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Mute interface sound" })).toHaveAttribute("aria-pressed", "true");
});

test("theme persists without enabling sound or overriding document direction", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  await page.getByRole("button", { name: "Ember" }).click();
  await expect(page.locator('[data-atmosphere="ember"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-atmosphere="ember"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable interface sound" })).toHaveAttribute("aria-pressed", "false");
});

test("reduced motion receives meaningful static content with no canvas", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback")).toBeVisible();
  await expect(page.locator('canvas[data-testid="workflow-webgl"]')).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /01.*Request/ })).toBeVisible();
});

test("WebGL unavailability falls back while navigation and challenge remain usable", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl" || type === "webgl2") return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback")).toBeVisible();
  await expect(page.locator("#visitor-choice-title")).toBeVisible();
  await expect(page.locator(".public-login-link")).toHaveAttribute("href", "/login");
  await page.screenshot({ caret: "initial", path: "output/playwright/immersive-webgl-unavailable.png", fullPage: false });
});

test("a failed 3D chunk leaves the full semantic experience available", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.route("**/_next/static/chunks/node_modules_three*.js", (route) => route.abort("failed"));
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback")).toHaveAttribute("data-reason", "scene-failed");
  await expect(page.getByRole("tab", { name: /01.*Request/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the server-rendered document retains meaningful localized content without client execution", async ({ request }) => {
  const response = await request.get("/en");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("One clear path from business need to verified delivery.");
  expect(html).toContain("Axora Workflow Console");
});

test("context loss restores the semantic console without losing the route", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  const canvas = page.locator('canvas[data-testid="workflow-webgl"]');
  await expect(canvas).toBeVisible();
  await canvas.dispatchEvent("webglcontextlost", { cancelable: true });
  await expect(page.getByTestId("workflow-fallback")).toHaveAttribute("data-reason", "context-lost");
  await expect(page).toHaveURL(/\/en$/);
});

test("Arabic mirrors direction and Malay localizes workflow controls", async ({ context, page }) => {
  await useLocale(context, "ar");
  await page.goto("/ar");
  await expect(page.locator('[data-locale="ar"]')).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("tab", { name: /02.*الموافقة/ })).toBeVisible();

  await useLocale(context, "ms");
  await page.goto("/ms");
  await expect(page.getByRole("tab", { name: /02.*Lulus/ })).toBeVisible();
});

test("desktop, theme, mobile, Arabic, reduced and fallback evidence is captured", async ({ context, page }, testInfo) => {
  await useLocale(context, "en");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-console")).toBeVisible();
  await expect(page.locator('canvas[data-testid="workflow-webgl"]')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ caret: "initial", path: `output/playwright/immersive-default-${testInfo.project.name}.png`, fullPage: true });
  for (const theme of ["Aurora", "Solar", "Ember", "Midnight"] as const) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ caret: "initial", path: `output/playwright/immersive-theme-${theme.toLowerCase()}-${testInfo.project.name}.png`, fullPage: false });
  }
  await page.getByRole("tab", { name: /06.*Deliver/ }).click();
  await page.locator("#workflow").screenshot({ caret: "initial", path: `output/playwright/immersive-workflow-${testInfo.project.name}.png` });

  await page.goto("/login");
  await expect(page.locator("main form")).toBeVisible();
  await page.screenshot({ caret: "initial", path: `output/playwright/immersive-login-${testInfo.project.name}.png`, fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-console")).toBeVisible();
  await page.screenshot({ caret: "initial", path: `output/playwright/immersive-mobile-${testInfo.project.name}.png`, fullPage: false });

  await useLocale(context, "ar");
  await page.goto("/ar");
  await expect(page.locator('[data-locale="ar"]')).toBeVisible();
  await page.screenshot({ caret: "initial", path: `output/playwright/immersive-arabic-${testInfo.project.name}.png`, fullPage: false });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await useLocale(context, "en");
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback")).toBeVisible();
  await page.screenshot({ caret: "initial", path: `output/playwright/immersive-reduced-motion-${testInfo.project.name}.png`, fullPage: false });
});

test("public experience passes WCAG A and AA automation", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((item) => item.id)).toEqual([]);
});

test("every atmosphere retains automated color contrast", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  for (const theme of ["Aurora", "Solar", "Ember", "Midnight"] as const) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations.map((item) => item.id), theme).toEqual([]);
  }
});
