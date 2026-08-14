import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

async function rememberLocale(context: BrowserContext, locale: "en" | "ar" | "ms") {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

async function installVisitorFixture(page: Page) {
  let claimed = false;
  let posts = 0;
  await page.addInitScript(() => {
    let options: Record<string, unknown> | undefined;
    window.turnstile = {
      render: (_container, next) => { options = next; return "fixture-widget"; },
      execute: () => queueMicrotask(() => (options?.callback as ((token: string) => void) | undefined)?.("test-turnstile-token")),
      reset: () => undefined,
      remove: () => { options = undefined; },
    };
  });
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.route(/\/api\/public\/visitor-choice$/, async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      claimed = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ totalCount: 13, earlyBirdCount: 8, nightOwlCount: 5, visitorNumber: 13, choice: "EARLY_BIRD", claimedNew: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(claimed
      ? { totalCount: 13, earlyBirdCount: 8, nightOwlCount: 5, visitorNumber: 13, choice: "EARLY_BIRD" }
      : { totalCount: 12, earlyBirdCount: 7, nightOwlCount: 5 }) });
  });
  await page.route("**/api/public/visitor-choice/stream", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    body: `retry: 60000\nevent: snapshot\ndata: ${JSON.stringify({ totalCount: 12, earlyBirdCount: 7, nightOwlCount: 5, sequence: 12 })}\n\n`,
  }));
  return { postCount: () => posts };
}

const localeCases = [
  { locale: "en" as const, title: "Which side are you on?", early: "Choose Early Birds", night: "Choose Night Owls", privacy: "Privacy" },
  { locale: "ar" as const, title: "أيُّ فريق تختار؟", early: "اختيار فريق الصباح الباكر", night: "اختيار فريق السهر", privacy: "الخصوصية" },
  { locale: "ms" as const, title: "Anda di pihak mana?", early: "Pilih Pasukan Awal Pagi", night: "Pilih Pasukan Kaki Malam", privacy: "Privasi" },
] as const;

for (const localeCase of localeCases) {
  test(`${localeCase.locale} homepage exposes the required localized visitor-choice modal`, async ({ context, page }, testInfo) => {
    await rememberLocale(context, localeCase.locale);
    await installVisitorFixture(page);
    await page.goto(`/${localeCase.locale}`);
    const dialog = page.getByRole("dialog", { name: localeCase.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: localeCase.early })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: localeCase.night })).toBeEnabled();
    await expect(dialog.getByRole("link", { name: localeCase.privacy })).toHaveAttribute("href", `/${localeCase.locale}/privacy`);
    await expect(dialog.locator("strong").first()).toHaveText("12");
    if (localeCase.locale === "en") {
      await page.screenshot({ animations: "disabled", path: `output/playwright/v2-visitor-choice-modal-${testInfo.project.name}.png`, fullPage: true });
    }
  });
}

test("the mandatory modal traps focus and cannot be dismissed before success", async ({ context, page }) => {
  await rememberLocale(context, "en");
  await installVisitorFixture(page);
  await page.goto("/en");
  const dialog = page.getByRole("dialog", { name: "Which side are you on?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toContainText("Which side are you on?");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
});

test("one double click submits once, closes immediately, and leaves compact live counters", async ({ context, page }) => {
  await rememberLocale(context, "en");
  const fixture = await installVisitorFixture(page);
  await page.goto("/en");
  const choice = page.getByRole("button", { name: "Choose Early Birds" });
  await expect(choice).toBeEnabled();
  await choice.evaluate((element) => {
    (element as HTMLElement).click();
    (element as HTMLElement).click();
  });
  await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
  expect(fixture.postCount()).toBe(1);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("the modal and counters exist only on the public homepage", async ({ context, page }) => {
  await rememberLocale(context, "en");
  await installVisitorFixture(page);
  await page.goto("/en/about");
  await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toHaveCount(0);
});

test("visitor choice remains usable without overflow and motion under restrained preferences", async ({ context, page }) => {
  await rememberLocale(context, "en");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installVisitorFixture(page);
  await page.goto("/en");
  const early = page.getByRole("button", { name: "Choose Early Birds" });
  await expect(early).toBeVisible();
  expect(Number.parseFloat(await early.evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
