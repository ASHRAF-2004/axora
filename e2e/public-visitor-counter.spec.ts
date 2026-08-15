import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

async function rememberLocale(context: BrowserContext, locale: "en" | "ar" | "ms") {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

async function installVisitorFixture(page: Page, options: { claimed?: boolean } = {}) {
  let claimed = options.claimed ?? false;
  let posts = 0;
  let gets = 0;
  let streamRequests = 0;
  let aggregate = { version: claimed ? 13 : 12, totalCount: claimed ? 13 : 12, earlyBirdCount: claimed ? 8 : 7, nightOwlCount: 5 };
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
      aggregate = { version: 13, totalCount: 13, earlyBirdCount: 8, nightOwlCount: 5 };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...aggregate, visitorNumber: 13, choice: "EARLY_BIRD", claimedNew: true }) });
    }
    gets += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(claimed
      ? { ...aggregate, visitorNumber: 13, choice: "EARLY_BIRD", eligible: true }
      : { ...aggregate, eligible: true }) });
  });
  await page.route("**/api/public/visitor-choice/stream", (route) => {
    streamRequests += 1;
    return route.fulfill({ status: 204 });
  });
  return {
    postCount: () => posts,
    getCount: () => gets,
    streamCount: () => streamRequests,
    updateAggregate: (next: typeof aggregate) => { aggregate = next; },
  };
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

test("an anonymous visitor with a valid recorded claim sees only compact live results", async ({ context, page }, testInfo) => {
  await rememberLocale(context, "en");
  await installVisitorFixture(page, { claimed: true });
  await page.goto("/en");
  await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `output/playwright/v2-visitor-claimed-counters-${testInfo.project.name}.png`, fullPage: false });
});

test("near-live polling applies monotonic snapshots and never opens EventSource", async ({ context, page }) => {
  await rememberLocale(context, "en");
  const fixture = await installVisitorFixture(page);
  await page.goto("/en");
  const dialog = page.getByRole("dialog", { name: "Which side are you on?" });
  await expect(dialog.locator("strong").first()).toHaveText("12");
  const initialGets = fixture.getCount();
  expect(fixture.streamCount()).toBe(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  fixture.updateAggregate({ version: 13, totalCount: 13, earlyBirdCount: 7, nightOwlCount: 6 });
  await page.waitForTimeout(250);
  expect(fixture.getCount()).toBe(initialGets);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dialog.locator("strong").first()).toHaveText("13");
  expect(fixture.getCount()).toBe(initialGets + 1);
  expect(fixture.streamCount()).toBe(0);

  fixture.updateAggregate({ version: 12, totalCount: 12, earlyBirdCount: 7, nightOwlCount: 5 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(250);
  await expect(dialog.locator("strong").first()).toHaveText("13");
});

test("authenticated owner, delivery, and company users never receive the public choice modal", async ({ page }) => {
  const { signInAsDemoOwner, signInAsDemoRole } = await import("./helpers/auth");
  await signInAsDemoOwner(page);
  await page.goto("/en");
  await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toHaveCount(0);

  const sessions = [
    { id: "40444444-4444-4444-8444-444444444444", email: "driver.fixture@axora.invalid", name: "Delivery fixture", role: "DELIVERY_GUY", accountKind: "DELIVERY", scopeType: "DELIVERY" },
    { id: "30333333-3333-4333-8333-333333333333", email: "company.fixture@axora.invalid", name: "Company fixture", role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", companyId: "10000000-0000-4000-8000-000000000001" },
  ] as const;
  for (const session of sessions) {
    await page.context().clearCookies();
    await signInAsDemoRole(page, session);
    await page.goto("/en");
    await expect(page.getByRole("dialog", { name: "Which side are you on?" })).toHaveCount(0);
    await expect(page.locator('[data-visitor-claimed="true"]')).toHaveCount(0);
  }
});

test("an explicitly privacy-ineligible visitor never receives the modal", async ({ context, page }) => {
  await rememberLocale(context, "en");
  await page.setExtraHTTPHeaders({ DNT: "1" });
  await page.goto("/en");
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
