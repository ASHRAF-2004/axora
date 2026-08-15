import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const baseURL = "http://127.0.0.1:3100";
const stages = ["request", "approve", "pay", "invoice", "prepare", "deliver", "track", "complete"] as const;
const sounds = {
  request: "/immersive/sounds/request.ogg",
  approve: "/immersive/sounds/approve.ogg",
  pay: "/immersive/sounds/pay.ogg",
  invoice: "/immersive/sounds/invoice.ogg",
  prepare: "/immersive/sounds/prepare.ogg",
  deliver: "/immersive/sounds/delivery-engine.ogg",
  track: "/immersive/sounds/track.ogg",
  complete: "/immersive/sounds/complete.ogg",
} as const;

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "axora_locale", value: "en", url: baseURL }]);
  await page.route(/\/api\/public\/visitor-choice(?:\?.*)?$/, async (route) => {
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
    body: `event: snapshot\ndata: ${JSON.stringify({ sequence: 1, version: "scene-runtime", snapshot: { totalCount: 42, earlyBirdCount: 24, nightOwlCount: 18 } })}\n\n`,
  }));
});

function runtimeFor(page: Page, asset: string) {
  return page.locator(`[data-testid="workflow-webgl"][data-scene-phase="ready"][data-rendered-asset="${asset}"]`).first();
}

async function expectRenderedAsset(page: Page, asset: string) {
  const runtime = runtimeFor(page, asset);
  await expect(runtime).toBeVisible({ timeout: 20_000 });
  await expect(runtime).toHaveAttribute("data-requested-asset", asset);
  await expect(runtime).toHaveAttribute("data-attached-asset", asset);
  await expect(runtime).toHaveAttribute("data-model-inside-frustum", "true");
  await expect(runtime).toHaveAttribute("data-model-bounds", /.+/);
  const bounds = (await runtime.getAttribute("data-model-bounds"))!.split(",").map(Number);
  expect(bounds).toHaveLength(4);
  expect(bounds[0]).toBeGreaterThanOrEqual(0.015);
  expect(bounds[1]).toBeGreaterThanOrEqual(0.015);
  expect(bounds[2]).toBeLessThanOrEqual(0.985);
  expect(bounds[3]).toBeLessThanOrEqual(0.985);

  // Read Chromium's composited frame. WebGL intentionally uses the default
  // preserveDrawingBuffer=false, so canvas.toDataURL() can truthfully return a
  // cleared back buffer even while the visible compositor frame is correct.
  const screenshot = await runtime.locator("canvas").screenshot({ animations: "disabled" });
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [left, top, right, bottom] = bounds;
  const x0 = Math.max(0, Math.floor(left * info.width));
  const y0 = Math.max(0, Math.floor(top * info.height));
  const x1 = Math.min(info.width, Math.ceil(right * info.width));
  const y1 = Math.min(info.height, Math.ceil(bottom * info.height));
  const background = [data[0], data[1], data[2]];
  let varied = 0;
  let sampled = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const offset = (y * info.width + x) * info.channels;
      const distance = Math.abs(data[offset] - background[0])
        + Math.abs(data[offset + 1] - background[1])
        + Math.abs(data[offset + 2] - background[2]);
      if (distance > 28) varied += 1;
      sampled += 1;
    }
  }
  const pixelEvidence = { variedRatio: sampled ? varied / sampled : 0, sampled };
  expect(pixelEvidence.sampled).toBeGreaterThan(100);
  expect(pixelEvidence.variedRatio).toBeGreaterThan(0.025);
  return runtime;
}

test("cold and delayed models never blank or commit stale semantic state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The controlled cold-load gate runs once in desktop Chromium.");
  let releasePay!: () => void;
  const payGate = new Promise<void>((resolve) => { releasePay = resolve; });
  await page.route("**/immersive/models/pay.glb", async (route) => {
    await payGate;
    await route.continue();
  });
  await page.goto("/en");
  await expectRenderedAsset(page, "request");
  await page.getByRole("button", { name: /03.*Pay/ }).click();
  await expect(page.locator('[data-public-scene="home"]')).toHaveAttribute("data-requested-stage", "pay");
  await expect(page.locator('[data-public-scene="home"]')).not.toHaveAttribute("data-rendered-stage", "pay");
  await expect(page.locator('[data-testid="workflow-webgl"][data-rendered-asset="request"]').first()).toBeVisible();
  releasePay();
  await expectRenderedAsset(page, "pay");

  await page.getByRole("button", { name: /08.*Complete/ }).click();
  await page.getByRole("button", { name: /02.*Approve/ }).click();
  await page.getByRole("button", { name: /07.*Track/ }).click();
  await expectRenderedAsset(page, "track");
  await expect(page.locator('[data-public-scene="home"]')).toHaveAttribute("data-rendered-stage", "track");
  await page.getByRole("button", { name: /01.*Request/ }).click();
  await expectRenderedAsset(page, "request");
});

test("every settled stage has visible pixels, matching copy, and one opted-in cue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The complete audio/render proof runs once in desktop Chromium.");
  await page.addInitScript(() => {
    const events: Array<{ type: "play" | "pause"; path: string }> = [];
    Object.assign(window, { __axoraSceneAudio: events });
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
  await expectRenderedAsset(page, "request");
  await page.locator('[data-scene-route="home-workflow"]').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", caret: "initial", path: "output/playwright/v2-home-stage-request.png" });
  expect(await page.evaluate(() => (window as typeof window & { __axoraSceneAudio: unknown[] }).__axoraSceneAudio)).toEqual([]);
  await page.getByRole("button", { name: "Enable interface sound" }).click();

  for (const [index, stage] of stages.entries()) {
    if (index === 0) continue;
    const control = page.locator(`[data-scene-step="${index}"]`).getByRole("button");
    await control.click();
    await expectRenderedAsset(page, stage);
    await expect(page.getByTestId("scene-caption")).toContainText((await control.locator("strong").textContent()) ?? "");
    await page.screenshot({
      animations: "disabled",
      caret: "initial",
      path: `output/playwright/v2-home-stage-${stage}.png`,
    });
    await expect.poll(() => page.evaluate((path) => (window as typeof window & { __axoraSceneAudio: Array<{ type: string; path: string }> }).__axoraSceneAudio
      .filter((event) => event.type === "play" && event.path === path).length, sounds[stage])).toBe(1);
    if (stage === "deliver") {
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __axoraSceneAudio: Array<{ type: string; path: string }> }).__axoraSceneAudio
        .filter((event) => event.type === "play" && event.path === "/immersive/sounds/delivery-door.wav").length)).toBe(1);
    }
    await control.click();
    expect(await page.evaluate((path) => (window as typeof window & { __axoraSceneAudio: Array<{ type: string; path: string }> }).__axoraSceneAudio
      .filter((event) => event.type === "play" && event.path === path).length, sounds[stage])).toBe(1);
  }

  await page.locator('[data-scene-step="0"]').getByRole("button").click();
  await expectRenderedAsset(page, "request");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __axoraSceneAudio: Array<{ type: string; path: string }> }).__axoraSceneAudio
    .filter((event) => event.type === "play" && event.path === "/immersive/sounds/request.ogg").length)).toBe(1);
  await page.getByRole("button", { name: "Mute interface sound" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __axoraSceneAudio: Array<{ type: string }> }).__axoraSceneAudio.some((event) => event.type === "pause"))).toBe(true);
});
