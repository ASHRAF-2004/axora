import { expect, test, type Locator, type Page } from "@playwright/test";
import { configureWalkingMascot, openDemoInteractionEditor } from "./helpers/auth";

type StateTraceWindow = Window & {
  __axoraInteractionObserver?: MutationObserver;
  __axoraInteractionStates?: string[];
};

async function startStateTrace(renderer: Locator) {
  await renderer.evaluate((element) => {
    const stateWindow = window as StateTraceWindow;
    stateWindow.__axoraInteractionObserver?.disconnect();
    stateWindow.__axoraInteractionStates = [element.getAttribute("data-state") ?? "missing"];
    stateWindow.__axoraInteractionObserver = new MutationObserver(() => {
      const state = element.getAttribute("data-state") ?? "missing";
      const states = stateWindow.__axoraInteractionStates ?? [];
      if (states.at(-1) !== state) states.push(state);
      stateWindow.__axoraInteractionStates = states;
    });
    stateWindow.__axoraInteractionObserver.observe(element, {
      attributeFilter: ["data-state"],
      attributes: true,
    });
  });
}

async function stateTrace(page: Page) {
  return page.evaluate(() => {
    const stateWindow = window as StateTraceWindow;
    return stateWindow.__axoraInteractionStates ?? [];
  });
}

async function expectMascotInsideRenderer(renderer: Locator, mascot: Locator) {
  await expect.poll(async () => {
    const [rendererBox, mascotBox] = await Promise.all([
      renderer.boundingBox(),
      mascot.boundingBox(),
    ]);
    if (!rendererBox || !mascotBox) return false;
    const tolerance = 2;
    return mascotBox.x >= rendererBox.x - tolerance
      && mascotBox.y >= rendererBox.y - tolerance
      && mascotBox.x + mascotBox.width <= rendererBox.x + rendererBox.width + tolerance
      && mascotBox.y + mascotBox.height <= rendererBox.y + rendererBox.height + tolerance;
  }).toBe(true);
}

test.describe("trusted mascot runtime", () => {
  test("walks, turns at its boundary, pauses, and can be dismissed", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop behavior is covered once in Chromium.");
    test.slow();

    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    await renderer.scrollIntoViewIfNeeded();
    await expect(mascot).toBeVisible();
    await expect(renderer).toHaveAttribute(
      "data-state",
      /walking-left|walking-right|turning/,
      { timeout: 12_000 },
    );

    const startingDirection = await renderer.getAttribute("data-direction");
    await expect.poll(
      () => renderer.getAttribute("data-direction"),
      { message: "the mascot should turn instead of leaving its approved region", timeout: 20_000 },
    ).not.toBe(startingDirection);
    await expectMascotInsideRenderer(renderer, mascot);

    await page.getByRole("button", { name: "Pause interactive experience" }).click();
    await expect(renderer).toHaveAttribute("data-paused", "true");
    await expect(renderer).toHaveAttribute("data-state", "paused");

    await page.getByRole("button", { name: "Resume interactive experience" }).click();
    await expect(renderer).toHaveAttribute("data-paused", "false");
    await expect(renderer).toHaveAttribute("data-state", /idle|walking-left|walking-right|turning/);

    await page.getByRole("button", { name: "Dismiss interactive experience" }).click();
    await expect(renderer).toHaveAttribute("data-state", "hidden");
    await expect(mascot).toHaveCount(0);
  });

  test("supports mouse pickup, constrained carrying, drop, landing, and walking resume", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Mouse behavior is covered in desktop Chromium.");
    test.slow();

    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    await renderer.scrollIntoViewIfNeeded();
    await expect(mascot).toBeVisible();
    await startStateTrace(renderer);

    const initialBox = await mascot.boundingBox();
    expect(initialBox).not.toBeNull();
    const startX = initialBox!.x + initialBox!.width / 2;
    const startY = initialBox!.y + initialBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 55, startY - 28, { steps: 8 });
    await expect(renderer).toHaveAttribute("data-state", "being-carried");
    await page.mouse.up();

    await expect(renderer).toHaveAttribute(
      "data-state",
      /released|falling|landing|recovering|walking-left|walking-right/,
    );
    await expect.poll(
      () => renderer.getAttribute("data-state"),
      { message: "walking should resume after the landing delay", timeout: 8_000 },
    ).toMatch(/walking-left|walking-right|turning/);

    const trace = await stateTrace(page);
    expect(trace).toContain("being-carried");
    expect(trace).toContain("falling");
    expect(trace).toContain("landing");
    expect(trace.some((state) => state === "recovering" || state.startsWith("walking-"))).toBe(true);
    await expectMascotInsideRenderer(renderer, mascot);
  });

  test("keeps an outside release constrained and recovers from pointer cancellation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Pointer edge cases are covered in desktop Chromium.");
    test.slow();

    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    const preview = page.getByTestId("interaction-preview");
    await renderer.scrollIntoViewIfNeeded();
    await expect(mascot).toBeVisible();
    const [mascotBox, previewBox] = await Promise.all([mascot.boundingBox(), preview.boundingBox()]);
    expect(mascotBox).not.toBeNull();
    expect(previewBox).not.toBeNull();

    await page.mouse.move(
      mascotBox!.x + mascotBox!.width / 2,
      mascotBox!.y + mascotBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(previewBox!.x - 80, previewBox!.y - 40, { steps: 10 });
    await page.mouse.up();
    await expect.poll(
      () => renderer.getAttribute("data-state"),
      { timeout: 8_000 },
    ).toMatch(/walking-left|walking-right|turning/);
    await expectMascotInsideRenderer(renderer, mascot);

    await startStateTrace(renderer);
    const currentBox = await mascot.boundingBox();
    expect(currentBox).not.toBeNull();
    const point = {
      x: currentBox!.x + currentBox!.width / 2,
      y: currentBox!.y + currentBox!.height / 2,
    };
    await mascot.dispatchEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      isPrimary: true,
      pointerId: 41,
      pointerType: "pen",
    });
    await mascot.dispatchEvent("pointercancel", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x,
      clientY: point.y,
      isPrimary: true,
      pointerId: 41,
      pointerType: "pen",
    });

    await expect.poll(
      () => renderer.getAttribute("data-state"),
      { timeout: 8_000 },
    ).toMatch(/walking-left|walking-right|turning/);
    const cancellationTrace = await stateTrace(page);
    expect(cancellationTrace).toContain("released");
    expect(cancellationTrace).toContain("falling");
    await expectMascotInsideRenderer(renderer, mascot);
  });

  test("supports touch pickup, carry, drop, and resume on mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "Touch behavior is covered in the mobile project.");
    test.slow();

    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    await renderer.scrollIntoViewIfNeeded();
    await expect(mascot).toBeVisible();
    await startStateTrace(renderer);

    const box = await mascot.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 7, x: start.x, y: start.y, radiusX: 4, radiusY: 4, force: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          id: 7,
          x: start.x - step * 6,
          y: start.y - step * 3,
          radiusX: 4,
          radiusY: 4,
          force: 1,
        }],
      });
    }
    await expect(renderer).toHaveAttribute("data-state", "being-carried");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect.poll(
      () => renderer.getAttribute("data-state"),
      { message: "touch release should land and resume walking", timeout: 8_000 },
    ).toMatch(/walking-left|walking-right|turning/);
    const trace = await stateTrace(page);
    expect(trace).toContain("being-carried");
    expect(trace).toContain("falling");
    expect(trace).toContain("landing");
    await expectMascotInsideRenderer(renderer, mascot);
  });

  test("stays inside its approved region across mobile orientation changes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "Mobile orientation is covered in the mobile project.");

    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    await renderer.scrollIntoViewIfNeeded();
    await expect(mascot).toBeVisible();
    await expectMascotInsideRenderer(renderer, mascot);

    await page.setViewportSize({ width: 915, height: 412 });
    await renderer.scrollIntoViewIfNeeded();
    await expectMascotInsideRenderer(renderer, mascot);

    await page.setViewportSize({ width: 412, height: 915 });
    await renderer.scrollIntoViewIfNeeded();
    await expectMascotInsideRenderer(renderer, mascot);
  });

  test("recalculates its safe position on resize and cleans up on route change", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Resize behavior is covered in desktop Chromium.");

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await openDemoInteractionEditor(page);
    await configureWalkingMascot(page);

    const renderer = page.getByTestId("trusted-interaction");
    const mascot = page.getByTestId("axora-buddy");
    await expect(mascot).toBeVisible();
    await page.setViewportSize({ width: 760, height: 820 });
    await expectMascotInsideRenderer(renderer, mascot);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectMascotInsideRenderer(renderer, mascot);

    await page.goto("/dashboard");
    await expect(renderer).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
  });
});
