import { expect, test } from "@playwright/test";
import { openDemoInteractionEditor } from "./helpers/auth";

test.describe("interactive experience accessibility and page safety", () => {
  test("honors the browser reduced-motion preference with a static fallback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "The browser preference is covered once in Chromium.");

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDemoInteractionEditor(page);

    const renderer = page.getByTestId("trusted-interaction");
    await expect(renderer).toHaveAttribute("data-state", "reduced-motion");
    await expect(renderer).toHaveAttribute("data-fallback", "reduced-motion");
    await expect(renderer.locator('[data-static-fallback="true"]')).toBeVisible();
    await expect(renderer.locator('[data-fallback-reason="reduced-motion"]')).toBeVisible();

    const initialState = await renderer.getAttribute("data-state");
    await page.waitForTimeout(500);
    await expect(renderer).toHaveAttribute("data-state", initialState!);
    expect(pageErrors).toEqual([]);
  });

  test("previews explicit reduced-motion and low-performance fallbacks", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Preview fallbacks are covered once in Chromium.");

    await openDemoInteractionEditor(page);
    const renderer = page.getByTestId("trusted-interaction");

    await page.getByRole("button", { name: "Preview reduced motion" }).click();
    await expect(page.getByTestId("interaction-preview")).toHaveAttribute("data-mode", "reduced-motion");
    await expect(renderer).toHaveAttribute("data-state", "reduced-motion");
    await expect(renderer).toHaveAttribute("data-fallback", "reduced-motion");
    await expect(renderer.locator('[data-static-fallback="true"]')).toBeVisible();

    await page.getByRole("button", { name: "Preview low performance" }).click();
    await expect(page.getByTestId("interaction-preview")).toHaveAttribute("data-mode", "low-performance");
    await expect(renderer).toHaveAttribute("data-state", "reduced-motion");
    await expect(renderer).toHaveAttribute("data-fallback", "low-performance");
    await expect(renderer.locator('[data-static-fallback="true"]')).toBeVisible();
  });

  test("exposes keyboard-operable animation controls without exposing decorative artwork", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Keyboard controls are covered once in Chromium.");

    await openDemoInteractionEditor(page);
    const renderer = page.getByTestId("trusted-interaction");
    const pause = page.getByRole("button", { name: "Pause interactive experience" });

    await renderer.scrollIntoViewIfNeeded();
    await expect(renderer).toHaveAttribute("aria-live", "off");
    await expect(renderer.locator("svg.axora-buddy-art")).toHaveAttribute("aria-hidden", "true");
    await pause.focus();
    await expect(pause).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(renderer).toHaveAttribute("data-paused", "true");

    const resume = page.getByRole("button", { name: "Resume interactive experience" });
    await expect(resume).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(renderer).toHaveAttribute("data-paused", "false");
  });

  test("pauses when the document is hidden and resumes when it becomes visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Visibility behavior is covered once in Chromium.");

    await openDemoInteractionEditor(page);
    const renderer = page.getByTestId("trusted-interaction");
    await renderer.scrollIntoViewIfNeeded();
    await expect(renderer).toHaveAttribute("data-paused", "false");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(renderer).toHaveAttribute("data-paused", "true");
    await expect(renderer).toHaveAttribute("data-state", /paused|hidden/);

    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(renderer).toHaveAttribute("data-paused", "false");
    await expect(renderer).toHaveAttribute("data-state", /idle|walking-left|walking-right|turning/);
  });

  test("does not obstruct protected calls to action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Protected controls are covered once in Chromium.");

    await openDemoInteractionEditor(page);
    const primaryCallToAction = page.getByTestId("preview-primary-cta");
    const navigationCallToAction = page.getByTestId("preview-nav-cta");

    for (const control of [primaryCallToAction, navigationCallToAction]) {
      await control.evaluate((element) => {
        element.addEventListener("click", () => {
          (element as HTMLElement).dataset.e2eActivated = "true";
        }, { once: true });
      });
      await control.click();
      await expect(control).toHaveAttribute("data-e2e-activated", "true");
    }
  });

  test("never creates horizontal page or preview overflow", async ({ page }) => {
    await openDemoInteractionEditor(page);
    await page.getByRole("button", { name: "Preview mobile" }).click();

    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ))).toBe(true);
    await expect.poll(() => page.getByTestId("interaction-preview").evaluate((element) => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBe(true);
  });
});
