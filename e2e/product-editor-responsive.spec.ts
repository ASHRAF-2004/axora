import { expect, test, type Page } from "@playwright/test";
import { procurementRulesMessages } from "../src/lib/procurement-rules-i18n";
import { signInAsDemoRole } from "./helpers/auth";

async function selectAppearance(page: Page, appearance: "light" | "dark") {
  const shell = page.locator(".app-shell");
  if (await shell.getAttribute("data-appearance") === appearance) return;
  const mobile = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (mobile) {
    await page.locator(".app-menu-button").click();
    await expect(page.locator("dialog.app-drawer[open]")).toBeVisible();
  }
  const scope = mobile ? page.locator("dialog.app-drawer[open]") : page.locator(".app-desktop-appearance");
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/profile/appearance")
    && candidate.request().method() === "PATCH");
  await scope.locator(`[data-appearance-choice="${appearance}"]`).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toHaveAttribute("data-appearance", appearance);
  await expect(scope.locator("fieldset")).toHaveAttribute("data-persistence-state", "ready");
  if (mobile) {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.app-drawer")).not.toBeVisible();
  }
}

for (const locale of ["en", "ar", "ms"] as const) {
  test(`assigned owner product history stays within the editor in ${locale}`, async ({ page }, testInfo) => {
    const localeIndex = ["en", "ar", "ms"].indexOf(locale);
    const fixtureIndex = localeIndex * 2 + (testInfo.project.name === "mobile-chrome" ? 2 : 1);
    // Appearance preferences live in a server-side demo map. Do not change the
    // shared login fixture's preferences or another locale/project's identity.
    await signInAsDemoRole(page, {
      id: `87000000-0000-4000-8000-${String(fixtureIndex).padStart(12, "0")}`,
      email: `responsive-history-${locale}-${testInfo.project.name}@axora.invalid`,
      name: `Responsive history ${locale} ${testInfo.project.name}`,
      role: "PLATFORM_OWNER", accountKind: "PLATFORM", scopeType: "PLATFORM", isOwner: true,
      roleAssignmentId: "86000000-0000-4000-8000-000000000004", preferredLocale: locale,
    });
    await page.goto("/products/pr-1/edit");
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const history = page.getByRole("region", { name: procurementRulesMessages(locale).history, exact: true });
    // The real demo loader requires a role assignment before returning history.
    // Empty history must never stand in for the production table regression.
    await expect(history.locator("tbody tr")).toHaveCount(1);
    const layout = page.locator(".product-editor-layout");
    await expect(layout).toBeVisible();
    const widths = testInfo.project.name === "mobile-chrome" ? [390, 360, 320] : [1440, 1024, 768, 390, 360, 320];

    for (const appearance of ["light", "dark"] as const) {
      await page.setViewportSize({ width: widths[0], height: 900 });
      await selectAppearance(page, appearance);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await layout.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            escapedChildren: Array.from(element.children).filter((child) => {
              const box = child.getBoundingClientRect();
              return box.left < bounds.left - 1 || box.right > bounds.right + 1;
            }).length,
          };
        });
        expect(geometry.overflow, `${locale}/${appearance}/${width}px document`).toBeLessThanOrEqual(2);
        expect(geometry.escapedChildren, `${locale}/${appearance}/${width}px grid children`).toBe(0);
        if (width <= 390) {
          const scroll = await history.evaluate((element) => ({ client: element.clientWidth, content: element.scrollWidth }));
          expect(scroll.content).toBeGreaterThan(scroll.client);
          await expect(history).toHaveCSS("overflow-x", "auto");
        }
      }
      await history.focus();
      await expect(history).toBeFocused();
      await history.evaluate((element) => { element.scrollLeft = 0; });
      await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
      await expect.poll(() => history.evaluate((element) => Math.abs(element.scrollLeft))).toBeGreaterThan(0);
    }
  });
}
