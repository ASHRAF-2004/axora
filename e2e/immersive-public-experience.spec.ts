import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseURL = "http://127.0.0.1:3100";

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/public\/visitor-choice$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ totalCount: 42, earlyBirdCount: 24, nightOwlCount: 18, choice: "EARLY_BIRD", visitorNumber: 42 }),
    });
  });
  await page.route("**/api/public/visitor-choice/stream", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `event: snapshot\ndata: ${JSON.stringify({ sequence: 1, version: "immersive-fixture", snapshot: { totalCount: 42, earlyBirdCount: 24, nightOwlCount: 18 } })}\n\n`,
  }));
});

async function useLocale(context: Parameters<typeof test>[0] extends never ? never : import("@playwright/test").BrowserContext, locale: "en" | "ar" | "ms") {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

async function expectWorkflowSceneReady(page: Page, expectedAsset?: string) {
  const assetSelector = expectedAsset ? `[data-rendered-asset="${expectedAsset}"]` : "[data-rendered-asset]";
  const readyScene = page.locator(`[data-scene-route] [data-context-loss-ready="true"][data-scene-phase="ready"]${assetSelector}`).first();
  await expect(readyScene).toBeVisible({ timeout: 15_000 });
  await expect(readyScene).toHaveAttribute("data-attached-asset", expectedAsset ?? /.+/);
  await expect(readyScene).toHaveAttribute("data-model-inside-frustum", "true");
  await expect(readyScene).toHaveAttribute("data-model-bounds", /.+/);
  const bounds = (await readyScene.getAttribute("data-model-bounds"))!.split(",").map(Number);
  expect(bounds).toHaveLength(4);
  expect(bounds.every(Number.isFinite)).toBe(true);
  expect(bounds[0]).toBeGreaterThanOrEqual(0.015);
  expect(bounds[1]).toBeGreaterThanOrEqual(0.015);
  expect(bounds[2]).toBeLessThanOrEqual(0.985);
  expect(bounds[3]).toBeLessThanOrEqual(0.985);
  expect(bounds[2] - bounds[0]).toBeGreaterThanOrEqual(0.08);
  expect(bounds[3] - bounds[1]).toBeGreaterThanOrEqual(0.08);
  const canvas = readyScene.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => canvas.evaluate((element) => {
    const scene = element as HTMLCanvasElement;
    const context = scene.getContext("webgl2") ?? scene.getContext("webgl");
    return Boolean(context && context.drawingBufferWidth > 0 && context.drawingBufferHeight > 0);
  })).toBe(true);
  return readyScene;
}

async function engageDeferredMobileScene(page: Page, stageName: RegExp) {
  if ((page.viewportSize()?.width ?? 761) > 760) return;
  const fallback = page.getByTestId("workflow-fallback").first();
  const canvas = page.locator("[data-scene-route] canvas").first();
  await expect.poll(async () => {
    if (await canvas.isVisible()) return "canvas";
    const reason = await fallback.getAttribute("data-reason");
    return reason && reason !== "checking" ? reason : "pending";
  }).not.toBe("pending");
  if (await fallback.getAttribute("data-reason") === "mobile-deferred") {
    await page.getByRole("button", { name: stageName }).click();
  }
}

async function computedAtmosphere(page: Page, selector = "html") {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      page: style.getPropertyValue("--axora-page-bg").trim(),
      surface: style.getPropertyValue("--axora-surface").trim(),
      brand: style.getPropertyValue("--axora-brand").trim(),
      background: style.backgroundColor,
      color: style.color,
    };
  });
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
  await engageDeferredMobileScene(page, /02.*Approve/);
  await expect(page.locator("[data-scene-route] canvas").first()).toBeVisible({ timeout: 15_000 });
  const approve = page.getByRole("button", { name: /02.*Approve/ });
  await approve.click();
  await expect(approve).toHaveAttribute("aria-pressed", "true");
  await expectWorkflowSceneReady(page, "approve");
  await expect(page.locator('[data-scene-step="1"]')).toContainText("budget and approval limits");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("3");
  await expect(page.getByRole("button", { name: /03.*Pay/ })).toHaveAttribute("aria-pressed", "true");
  await expectWorkflowSceneReady(page, "pay");
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

test("opted-in scroll activation plays Delivery engine then door exactly once", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.addInitScript(() => {
    const events: Array<{ type: "play" | "pause"; path: string }> = [];
    Object.assign(window, { __axoraAudioEvents: events });
    class TestAudio {
      currentTime = 0;
      preload = "none";
      volume = 1;
      constructor(readonly src: string) {}
      load() {}
      pause() { events.push({ type: "pause", path: this.src }); }
      play() { events.push({ type: "play", path: this.src }); return Promise.resolve(); }
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: TestAudio });
  });
  await page.goto("/en");
  await page.getByRole("button", { name: "Enable interface sound" }).click();
  const delivery = page.locator('[data-scene-step="5"]');
  await delivery.scrollIntoViewIfNeeded();
  await expect(delivery.getByRole("button", { name: /06.*Deliver/ })).toHaveAttribute("aria-pressed", "true");
  await expectWorkflowSceneReady(page, "deliver");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __axoraAudioEvents: Array<{ type: string; path: string }> }).__axoraAudioEvents
    .filter((event) => event.type === "play").map((event) => event.path))).toEqual(expect.arrayContaining([
      "/immersive/sounds/delivery-engine.ogg",
      "/immersive/sounds/delivery-door.wav",
    ]));
  await delivery.scrollIntoViewIfNeeded();
  const deliveryPlays = await page.evaluate(() => (window as typeof window & { __axoraAudioEvents: Array<{ type: string; path: string }> }).__axoraAudioEvents
    .filter((event) => event.type === "play" && event.path.includes("delivery-engine")).length);
  expect(deliveryPlays).toBe(1);
  await page.getByRole("button", { name: "Mute interface sound" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __axoraAudioEvents: Array<{ type: string; path: string }> }).__axoraAudioEvents.some((event) => event.type === "pause"))).toBe(true);
});

test("theme persists without enabling sound or overriding document direction", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.goto("/en");
  const emberButton = page.getByRole("button", { name: "Ember" });
  const mobileMenuButton = page.getByRole("button", { name: "Open menu" });
  await expect(emberButton.or(mobileMenuButton)).toBeVisible();
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click();
  }
  await expect(emberButton).toBeVisible();
  await emberButton.click();
  await expect(page.locator('html[data-atmosphere="ember"]')).toBeVisible();
  expect((await computedAtmosphere(page)).brand).toBe("#bd3f32");
  await page.reload();
  await expect(page.locator('html[data-atmosphere="ember"]')).toBeVisible();
  expect((await computedAtmosphere(page)).page).toBe("#fff3ef");
  await expect(page.getByRole("button", { name: "Enable interface sound" })).toHaveAttribute("aria-pressed", "false");
});

test("reduced motion receives meaningful static content with no canvas", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback").first()).toBeVisible();
  await expect(page.locator("[data-scene-route] canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /01.*Request/ })).toBeVisible();
});

test("forced colours retain meaningful public controls and evidence", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Forced-colour evidence is captured once by desktop Chromium.");
  await useLocale(context, "en");
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /01.*Request/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `output/playwright/immersive-forced-colors-${testInfo.project.name}.png`, fullPage: false });
});

test("WebGL unavailability falls back while navigation and challenge remain usable", async ({ context, page }, testInfo) => {
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
  await expect(page.getByTestId("workflow-fallback").first()).toBeVisible();
  await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
  await expect(page.locator(".public-login-link")).toHaveAttribute("href", "/login");
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    path: `output/playwright/immersive-webgl-unavailable-${testInfo.project.name}.png`,
    fullPage: false,
  });
});

test("a failed 3D chunk leaves the full semantic experience available", async ({ context, page }) => {
  await useLocale(context, "en");
  await page.route("**/immersive/models/*.glb", (route) => route.abort("failed"));
  await page.goto("/en");
  await engageDeferredMobileScene(page, /02.*Approve/);
  await expect(page.getByTestId("workflow-fallback").first()).toHaveAttribute("data-reason", "scene-failed");
  await expect(page.getByRole("button", { name: /01.*Request/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the server-rendered document retains meaningful localized content without client execution", async ({ request }) => {
  const response = await request.get("/en");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("One clear path from business need to verified delivery.");
  expect(html).toContain("Enter the Axora world");
});

test("context loss restores the semantic console without losing the route", async ({ context, page }, testInfo) => {
  await useLocale(context, "en");
  await page.goto("/en");
  await engageDeferredMobileScene(page, /02.*Approve/);
  const readyScene = page.locator('[data-scene-route] [data-context-loss-ready="true"]').first();
  await expect(readyScene).toBeVisible({ timeout: 15_000 });
  const canvas = readyScene.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await canvas.dispatchEvent("webglcontextlost", { cancelable: true });
  await expect(page.locator('[data-testid="workflow-fallback"][data-reason="context-lost"]')).toBeVisible();
  await expect(page).toHaveURL(/\/en$/);
  await page.screenshot({ animations: "disabled", path: `output/playwright/immersive-context-loss-${testInfo.project.name}.png`, fullPage: false });
});

test("Arabic mirrors direction and Malay localizes workflow controls", async ({ context, page }) => {
  await useLocale(context, "ar");
  await page.goto("/ar");
  await expect(page.locator('[data-locale="ar"]')).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /02.*الموافقة/ })).toBeVisible();

  await useLocale(context, "ms");
  await page.goto("/ms");
  await expect(page.getByRole("button", { name: /02.*Lulus/ })).toBeVisible();
});

const publicRouteSceneCases = [
  { path: "/en", route: "home", initial: "request", next: "approve", file: "homepage" },
  { path: "/en/how-it-works", route: "how-it-works", initial: "request", next: "approve", file: "how-it-works" },
  { path: "/en/procurement-process", route: "procurement-process", initial: "request", next: "approve", file: "procurement-process" },
  { path: "/en/solutions-by-role", route: "solutions-by-role", initial: "person", next: "workspace", file: "solutions-by-role" },
  { path: "/en/security-and-privacy", route: "security-and-privacy", initial: "shield", next: "vault", file: "security-and-privacy" },
  { path: "/en/about", route: "about", initial: "company", next: "network", file: "about" },
] as const;

for (const item of publicRouteSceneCases) {
  test(`${item.route} presents and transforms its semantic 3D sequence`, async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Each route's complete evidence is captured once by desktop Chromium.");
    await useLocale(context, "en");
    await page.goto(item.path);
    const world = page.locator(`[data-public-scene="${item.route}"]`);
    await expect(world).toBeVisible();
    await expect(world).toHaveAttribute("data-interaction-ready", "true");
    await expectWorkflowSceneReady(page, item.initial);
    await expect(world).toHaveAttribute("data-rendered-stage", item.initial);
    await world.locator("[data-scene-step]").nth(1).getByRole("button").click();
    await expectWorkflowSceneReady(page, item.next);
    await expect(world).toHaveAttribute("data-rendered-stage", item.next);
    await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/v2-${item.file}.png`, fullPage: true });
  });
}

test("all homepage stages attach the selected semantic object inside usable bounds", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The full cold-to-settled semantic sequence is verified once in desktop Chromium.");
  await useLocale(context, "en");
  await page.goto("/en");
  const expected = ["request", "approve", "pay", "invoice", "prepare", "deliver", "track", "complete"] as const;
  for (let index = 0; index < expected.length; index += 1) {
    const step = page.locator(`[data-scene-step="${index}"]`);
    await step.getByRole("button").click();
    await expect(step.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expectWorkflowSceneReady(page, expected[index]);
    await expect(page.locator('[data-public-scene="home"]')).toHaveAttribute("data-rendered-stage", expected[index]);
    await expect(page.getByTestId("scene-caption")).toContainText((await step.getByRole("button").locator("strong").textContent()) ?? "");
  }
  await page.getByRole("button", { name: /03.*Pay/ }).click();
  await expectWorkflowSceneReady(page, "pay");
  await expect(page.locator('[data-public-scene="home"]')).toHaveAttribute("data-rendered-stage", "pay");
});

test("desktop and theme visual evidence is captured once in Chromium", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop evidence is intentionally captured only by the desktop Chromium project.");
  await useLocale(context, "en");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en");
  await expect(page.getByTestId("workflow-console")).toBeVisible();
  await expectWorkflowSceneReady(page, "request");
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-default-${testInfo.project.name}.png`, fullPage: true });
  const computedThemes = new Set<string>();
  for (const theme of ["Aurora", "Solar", "Ember", "Midnight"] as const) {
    const themeButton = page.getByRole("button", { name: theme, exact: true });
    const atmosphere = theme.toLowerCase();
    await themeButton.click();
    await expect(themeButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`html[data-atmosphere="${atmosphere}"]`)).toBeVisible();
    const tokens = await computedAtmosphere(page);
    expect(tokens.page).not.toBe("");
    expect(tokens.surface).not.toBe("");
    expect(tokens.brand).not.toBe("");
    computedThemes.add(JSON.stringify(tokens));
    await expectWorkflowSceneReady(page);
    await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-theme-${atmosphere}-${testInfo.project.name}.png`, fullPage: false });
  }
  expect(computedThemes.size).toBe(4);
  await page.getByRole("button", { name: /06.*Deliver/ }).click();
  await expectWorkflowSceneReady(page, "deliver");
  await page.locator("#workflow").screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-workflow-${testInfo.project.name}.png` });

  await page.goto("/login");
  await expect(page.locator("main form")).toBeVisible();
  expect((await computedAtmosphere(page)).page).toBe("#091124");
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-login-${testInfo.project.name}.png`, fullPage: false });
});

test("mobile, Arabic, and reduced-motion visual evidence is captured once in Mobile Chrome", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile evidence is intentionally captured only with the configured Pixel 7 project.");
  await useLocale(context, "en");
  await page.goto("/en");
  await expect(page.getByTestId("workflow-console")).toBeVisible();
  await expect(page.locator('[data-testid="workflow-fallback"][data-reason="mobile-deferred"]').first()).toBeVisible();
  await engageDeferredMobileScene(page, /02.*Approve/);
  await expectWorkflowSceneReady(page, "approve");
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-mobile-${testInfo.project.name}.png`, fullPage: false });

  await useLocale(context, "ar");
  await page.goto("/ar");
  await expect(page.locator('[data-locale="ar"]')).toBeVisible();
  await expect(page.locator('[data-testid="workflow-fallback"][data-reason="mobile-deferred"]').first()).toBeVisible();
  await engageDeferredMobileScene(page, /02.*الموافقة/);
  await expectWorkflowSceneReady(page, "approve");
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-arabic-${testInfo.project.name}.png`, fullPage: false });

  await useLocale(context, "ms");
  await page.goto("/ms");
  await expect(page.getByRole("button", { name: /02.*Lulus/ })).toBeVisible();
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-malay-${testInfo.project.name}.png`, fullPage: false });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await useLocale(context, "en");
  await page.goto("/en");
  await expect(page.getByTestId("workflow-fallback").first()).toBeVisible();
  await page.screenshot({ animations: "disabled", caret: "initial", path: `output/playwright/immersive-reduced-motion-${testInfo.project.name}.png`, fullPage: false });
});

test("records the reviewable immersive interaction tour", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The interaction tour is recorded once with desktop Chromium.");
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: "output/playwright/video", size: { width: 1280, height: 800 } },
  });
  await useLocale(context, "en");
  const page = await context.newPage();
  let claimed = false;
  await page.addInitScript(() => {
    let options: Record<string, unknown> | undefined;
    window.turnstile = {
      render: (_container, next) => { options = next; return "tour-widget"; },
      execute: () => queueMicrotask(() => (options?.callback as ((token: string) => void) | undefined)?.("tour-token")),
      reset: () => undefined,
      remove: () => { options = undefined; },
    };
  });
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.route(/\/api\/public\/visitor-choice$/, async (route) => {
    if (route.request().method() === "POST") claimed = true;
    const snapshot = claimed
      ? { totalCount: 43, earlyBirdCount: 25, nightOwlCount: 18, visitorNumber: 43, choice: "EARLY_BIRD", claimedNew: true }
      : { totalCount: 42, earlyBirdCount: 24, nightOwlCount: 18 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.route("**/api/public/visitor-choice/stream", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `event: snapshot\ndata: ${JSON.stringify({ sequence: 1, version: "tour", snapshot: { totalCount: 42, earlyBirdCount: 24, nightOwlCount: 18 } })}\n\n`,
  }));
  await page.goto("/en");
  await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toBeVisible();
  await page.getByRole("button", { name: "Choose Early Birds" }).click();
  await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
  await expectWorkflowSceneReady(page, "request");
  const emblem = page.getByRole("link", { name: /Home.*Axora/i }).first();
  await emblem.focus();
  await emblem.press("Enter");
  await expect(page).toHaveURL(/\/en$/);
  await page.getByRole("button", { name: "Enable interface sound" }).click();
  for (let index = 0; index < 8; index += 1) {
    const step = page.locator(`[data-scene-step="${index}"]`);
    await step.evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    if (await step.getByRole("button").getAttribute("aria-pressed") !== "true") {
      await step.getByRole("button").click();
    }
    await expect(step.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expectWorkflowSceneReady(page, ["request", "approve", "pay", "invoice", "prepare", "deliver", "track", "complete"][index]);
  }
  await page.getByRole("button", { name: "Ember", exact: true }).click();
  await expect(page.locator('html[data-atmosphere="ember"]')).toBeVisible();
  const video = page.video();
  await page.close();
  await context.close();
  if (!video) throw new Error("The interaction tour video was not initialized.");
  await video.saveAs("output/playwright/interaction-tour.webm");
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
  const auroraButton = page.getByRole("button", { name: "Aurora", exact: true });
  const mobileMenuButton = page.getByRole("button", { name: "Open menu" });
  await expect(auroraButton.or(mobileMenuButton)).toBeVisible();
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click();
  }
  await expect(auroraButton).toBeVisible();
  for (const theme of ["Aurora", "Solar", "Ember", "Midnight"] as const) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations.map((item) => item.id), theme).toEqual([]);
  }
});
