import { createHmac } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LOCALE_NAMES, publicMessages, type SupportedLocale } from "../src/lib/i18n";
import { publicVisitorCopy } from "../src/lib/public-visitor-copy";

const baseURL = "http://127.0.0.1:3100";

async function rememberLocale(context: BrowserContext, locale: SupportedLocale) {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

async function monitorRemovedDependencies(page: Page) {
  const requests = { visitor: 0, turnstile: 0 };
  await page.route(/\/api\/public\/visitor-choice(?:\/stream)?(?:\?|$)/, async (route) => {
    requests.visitor += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/**", async (route) => {
    requests.turnstile += 1;
    await route.abort("blockedbyclient");
  });
  return requests;
}

async function expectNoTeamChooser(page: Page, locale: SupportedLocale) {
  const copy = publicVisitorCopy[locale];
  await expect(page.getByRole("dialog", { name: copy.title })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.chooseEarly })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.chooseNight })).toHaveCount(0);
  await expect(page.locator("#visitor-choice-title")).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toHaveCount(0);
  await expect(page.locator("#axora-visitor-turnstile")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
}

async function expectOpenHome(page: Page, locale: SupportedLocale) {
  const messages = publicMessages(locale);
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
  await expect(page.locator(".public-site")).toHaveAttribute("lang", locale);
  await expect(page.locator(".public-site")).toHaveAttribute("dir", LOCALE_NAMES[locale].dir);
  const actions = page.locator(".public-hero-actions");
  await expect(actions.getByRole("link", { name: messages.home.primaryAction })).toHaveAttribute("href", `/${locale}/how-it-works`);
  await expect(actions.getByRole("link", { name: messages.home.secondaryAction })).toHaveAttribute("href", `/${locale}/contact`);
  await page.waitForLoadState("networkidle");
  await expectNoTeamChooser(page, locale);
}

// These public-home regressions replace the deliberately removed visitor-choice
// UI contract. Backend cookie, API authorization and migration tests stay intact.
for (const locale of ["en", "ar", "ms"] as const) {
  test(`${locale} homepage opens directly without a team choice or visitor dependency`, async ({ context, page }) => {
    await rememberLocale(context, locale);
    const requests = await monitorRemovedDependencies(page);
    await page.goto(`/${locale}`);
    await expectOpenHome(page, locale);
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
  });
}

test("keyboard users can reach the homepage without a team-choice focus trap", async ({ context, page }) => {
  await rememberLocale(context, "en");
  const requests = await monitorRemovedDependencies(page);
  await page.goto("/en");
  await expectOpenHome(page, "en");
  const skipLink = page.getByRole("link", { name: publicMessages("en").skipToContent });
  await expect(skipLink).toHaveAttribute("data-focus-ready", "true");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Escape");
  await expectNoTeamChooser(page, "en");
  expect(requests).toEqual({ visitor: 0, turnstile: 0 });
});

test("a saved signed visitor cookie neither restores counters nor changes on a home visit", async ({ context, page }) => {
  await rememberLocale(context, "en");
  // Public demo key only: this is an old browser cookie, not a real account or
  // a newly recorded claim. Visiting home must not read, rotate or submit it.
  const token = Buffer.alloc(32, 7).toString("base64url");
  const signature = createHmac("sha256", "public-e2e-session-key-not-for-production-0001")
    .update("axora-public-visitor-cookie-v2\0", "utf8")
    .update(token, "utf8")
    .digest("base64url");
  const value = `v2.${token}.${signature}`;
  await context.addCookies([{ name: "axora_visitor_claim", value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const requests = await monitorRemovedDependencies(page);
  await page.goto("/en");
  await expectOpenHome(page, "en");
  await page.reload();
  await expectOpenHome(page, "en");
  expect((await context.cookies()).find((cookie) => cookie.name === "axora_visitor_claim")?.value).toBe(value);
  expect(requests).toEqual({ visitor: 0, turnstile: 0 });
});

test("other public pages remain accessible without a team choice", async ({ context, page }) => {
  await rememberLocale(context, "en");
  const requests = await monitorRemovedDependencies(page);
  await page.goto("/en/about");
  await expect(page.getByRole("heading", { level: 1, name: publicMessages("en").pages.about.title })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoTeamChooser(page, "en");
  expect(requests).toEqual({ visitor: 0, turnstile: 0 });
});

test("authenticated owner, delivery and company fixtures still see the ordinary public homepage", async ({ context, page }) => {
  const { signInAsDemoOwner, signInAsDemoRole } = await import("./helpers/auth");
  await rememberLocale(context, "en");
  const requests = await monitorRemovedDependencies(page);
  await signInAsDemoOwner(page);
  await page.goto("/en");
  await expectOpenHome(page, "en");

  const sessions = [
    { id: "40444444-4444-4444-8444-444444444444", email: "driver.fixture@axora.invalid", name: "Delivery fixture", role: "DELIVERY_GUY", accountKind: "DELIVERY", scopeType: "DELIVERY" },
    { id: "30333333-3333-4333-8333-333333333333", email: "company.fixture@axora.invalid", name: "Company fixture", role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", companyId: "10000000-0000-4000-8000-000000000001" },
  ] as const;
  for (const session of sessions) {
    await context.clearCookies();
    await rememberLocale(context, "en");
    await signInAsDemoRole(page, session);
    await page.goto("/en");
    await expectOpenHome(page, "en");
  }
  expect(requests).toEqual({ visitor: 0, turnstile: 0 });
});

for (const privacyHeader of ["DNT", "Sec-GPC"] as const) {
  test(`${privacyHeader} visitors can use home without a team choice or visitor requests`, async ({ context, page }) => {
    await rememberLocale(context, "en");
    await page.setExtraHTTPHeaders({ [privacyHeader]: "1" });
    const requests = await monitorRemovedDependencies(page);
    await page.goto("/en");
    await expectOpenHome(page, "en");
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
  });
}

test("the unobstructed Arabic homepage wraps on a reduced-motion small phone", async ({ context, page }) => {
  await rememberLocale(context, "ar");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests = await monitorRemovedDependencies(page);
  await page.goto("/ar");
  await expectOpenHome(page, "ar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  expect(requests).toEqual({ visitor: 0, turnstile: 0 });
});
