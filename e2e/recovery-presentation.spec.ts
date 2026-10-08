import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrastRatio } from "../src/lib/brand-colors";
import { signInAsDemoOwner, signInAsDemoRole } from "./helpers/auth";
import { integrationStatusMessages } from "../src/lib/integrations/status-i18n";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";

async function selectAppearance(page: Page, appearance: "light" | "dark") {
  const shell = page.locator(".app-shell");
  await expect(shell).toBeVisible();
  if (await shell.getAttribute("data-appearance") === appearance) return;
  const mobile = await page.evaluate(() => matchMedia("(max-width: 720px)").matches);
  if (mobile) await page.locator(".app-menu-button").click();
  const scope = mobile ? page.locator("dialog.app-drawer[open]") : page.locator(".app-desktop-appearance");
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/profile/appearance")
    && candidate.request().method() === "PATCH");
  await scope.locator(`[data-appearance-choice="${appearance}"]`).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toHaveAttribute("data-appearance", appearance);
  await expect(scope.locator("fieldset")).toHaveAttribute("data-persistence-state", "ready");
  if (mobile) await page.locator("dialog.app-drawer[open]").evaluate((dialog: HTMLDialogElement) => dialog.close());
}

async function readable(action: Locator) {
  await expect.poll(async () => {
    const colors = await action.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor];
    });
    const hex = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3 || (channels.length === 4 && channels[3] !== 1)) throw new Error("Expected opaque semantic button colors");
      return "#" + channels.slice(0, 3).map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
    };
    return contrastRatio(hex(colors[0]), hex(colors[1]));
  }).toBeGreaterThanOrEqual(4.5);
}

async function actionStates(page: Page, action: Locator) {
  await readable(action);
  await action.hover();
  await readable(action);
  await action.focus();
  await readable(action);
  const box = await action.boundingBox();
  if (!box) throw new Error("Action has no rendered geometry");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try { await readable(action); }
  finally {
    // Release outside the link so checking :active never initiates a command.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
}

for (const appearance of ["light", "dark"] as const) {
  test(`Owner setup tabs and every Open wallet action remain readable in ${appearance} states`, async ({ page }) => {
    await signInAsDemoOwner(page);
    await selectAppearance(page, appearance);
    for (const segment of ["", "/onboarding", "/users", "/branches", "/wallet", "/documents"]) {
      await page.goto(`/companies/${companyId}${segment}`);
      await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", appearance);
      const selected = page.locator('.company-workspace-nav [aria-current="page"]');
      await expect(selected).toHaveCount(1);
      await actionStates(page, selected);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto("/wallet");
    const actions = page.getByRole("link", { name: "Open wallet", exact: true });
    await expect(actions.first()).toBeVisible();
    expect(await actions.count()).toBeGreaterThan(0);
    for (const action of await actions.all()) await actionStates(page, action);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

const locales = [
  { locale: "en", edit: "Edit delivery address", confirmation: "Location confirmation" },
  { locale: "ar", edit: "تعديل عنوان التسليم", confirmation: "تأكيد الموقع" },
  { locale: "ms", edit: "Edit alamat penghantaran", confirmation: "Pengesahan lokasi" },
] as const;

for (const copy of locales) {
  test(`Integration status distinguishes disabled providers from connected accounts in ${copy.locale}`, async ({ page }) => {
    await signInAsDemoRole(page, { id: "30333333-3333-4333-8333-333333333340", email: "integration.presentation@axora.invalid", name: "Integration presentation", role: "PLATFORM_OWNER", isOwner: true, accountKind: "PLATFORM", scopeType: "PLATFORM", preferredLocale: copy.locale });
    await page.goto("/integrations");
    const status = integrationStatusMessages(copy.locale);
    await expect(page.getByText(status.zapierDisabled, { exact: true })).toBeVisible();
    await expect(page.getByText(status.capabilityHelp, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (copy.locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test(`Branch labels and full-width budget table render cleanly in ${copy.locale}`, async ({ page }) => {
    await signInAsDemoRole(page, { id: "30333333-3333-4333-8333-333333333339", email: "presentation.fixture@axora.invalid", name: "Presentation fixture", role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", companyId, preferredLocale: copy.locale });
    await page.goto(`/branches/${branchId}`);
    await expect(page.getByRole("link", { name: copy.edit, exact: true })).toHaveCount(1);
    await expect(page.locator("dt").filter({ hasText: copy.edit })).toHaveCount(0);
    await expect(page.locator("dt").filter({ hasText: copy.confirmation })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/budgets");
    await expect(page.locator('table th[scope="col"]')).toHaveCount(6);
    const region = page.getByRole("region");
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (copy.locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
}
