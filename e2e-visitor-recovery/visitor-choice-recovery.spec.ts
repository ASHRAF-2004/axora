import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { publicMessages, type SupportedLocale } from "../src/lib/i18n";
import { publicVisitorCopy } from "../src/lib/public-visitor-copy";

const baseURL = "http://127.0.0.1:3101";

async function rememberLocale(context: BrowserContext, locale: SupportedLocale) {
  await context.addCookies([{ name: "axora_locale", value: locale, url: baseURL }]);
}

async function blockRemovedDependencies(page: Page) {
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

async function expectOpenHome(page: Page, locale: SupportedLocale) {
  const messages = publicMessages(locale);
  const removed = publicVisitorCopy[locale];
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("dialog", { name: removed.title })).toHaveCount(0);
  await expect(page.getByRole("button", { name: removed.chooseEarly })).toHaveCount(0);
  await expect(page.getByRole("button", { name: removed.chooseNight })).toHaveCount(0);
  await expect(page.locator('[data-visitor-claimed="true"]')).toHaveCount(0);
  await expect(page.locator("#axora-visitor-turnstile")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(page.locator(".public-hero-actions").getByRole("link", { name: messages.home.primaryAction })).toBeVisible();
  await expect(page.locator(".public-hero-actions").getByRole("link", { name: messages.home.secondaryAction })).toBeVisible();
}

// The public team chooser was intentionally removed. Its former challenge
// recovery tests are replaced with regressions proving those dependencies can
// no longer gate homepage access; backend security tests are not retired.
test.describe("public homepage without the removed team-choice dependency", () => {
  for (const locale of ["en", "ar", "ms"] as const) {
    test(`${locale} homepage stays open when old visitor and challenge dependencies are unavailable`, async ({ context, page }) => {
      await rememberLocale(context, locale);
      const requests = await blockRemovedDependencies(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`/${locale}`);
      await expectOpenHome(page, locale);
      expect(requests).toEqual({ visitor: 0, turnstile: 0 });
      expect(pageErrors).toEqual([]);
    });
  }

  test("visibility, focus and network changes never restart visitor polling or verification", async ({ context, page }) => {
    await rememberLocale(context, "en");
    const requests = await blockRemovedDependencies(page);
    await page.goto("/en");
    await expectOpenHome(page, "en");
    await page.clock.install();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await context.setOffline(true);
    await page.clock.fastForward(65_000);
    await context.setOffline(false);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.clock.fastForward(65_000);
    await expectOpenHome(page, "en");
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
  });

  test("direct navigation, refresh and browser history do not recreate the team chooser", async ({ context, page }) => {
    await rememberLocale(context, "en");
    const requests = await blockRemovedDependencies(page);
    await page.goto("/en");
    await expectOpenHome(page, "en");
    await page.locator(".public-hero-actions").getByRole("link", { name: publicMessages("en").home.primaryAction }).click();
    await expect(page).toHaveURL(/\/en\/how-it-works$/);
    await expect(page.getByRole("heading", { level: 1, name: publicMessages("en").pages["how-it-works"].title })).toBeVisible();
    await page.goBack();
    await expectOpenHome(page, "en");
    await page.goForward();
    await expect(page).toHaveURL(/\/en\/how-it-works$/);
    await page.goto("/en");
    await expectOpenHome(page, "en");
    await page.reload();
    await expectOpenHome(page, "en");
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
  });

  test("a malformed retained visitor cookie cannot obstruct the preferred-language homepage", async ({ context, page }) => {
    await rememberLocale(context, "ms");
    const value = "invalid-retained-public-visitor-fixture";
    await context.addCookies([{ name: "axora_visitor_claim", value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
    const requests = await blockRemovedDependencies(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/ms$/);
    await expectOpenHome(page, "ms");
    expect((await context.cookies()).find((cookie) => cookie.name === "axora_visitor_claim")?.value).toBe(value);
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
  });

  test("keyboard navigation reaches Contact while its own verification remains required", async ({ context, page }) => {
    await rememberLocale(context, "en");
    const requests = await blockRemovedDependencies(page);
    let contactPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/en/contact") contactPosts += 1;
    });
    await page.goto("/en");
    await expectOpenHome(page, "en");
    expect(requests).toEqual({ visitor: 0, turnstile: 0 });
    const contact = page.locator(".public-hero-actions").getByRole("link", { name: publicMessages("en").home.secondaryAction });
    await contact.focus();
    await expect(contact).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/contact$/);
    await expect(page.getByRole("heading", { level: 1, name: publicMessages("en").contact.title })).toBeVisible();
    await expect(page.locator(".public-contact-form")).toBeVisible();
    await expect(page.getByRole("button", { name: publicMessages("en").contact.submit, exact: true })).toBeDisabled();
    // Contact has its own verification; the homepage-removal assertion must
    // not wrongly demand that its challenge script is absent on Contact.
    expect(requests.visitor).toBe(0);
    expect(contactPosts).toBe(0);
  });
});
