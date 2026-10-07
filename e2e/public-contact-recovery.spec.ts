import { expect, test, type Page } from "@playwright/test";

type ContactFixture = {
  options?: Record<string, (...args: unknown[]) => unknown>;
  resets: number;
};

async function invoke(page: Page, callback: string, value?: string) {
  await page.evaluate(({ callback, value }) => {
    const fixture = (window as Window & { __contactFixture?: ContactFixture }).__contactFixture;
    fixture?.options?.[callback]?.(value);
  }, { callback, value });
}

const cases = [
  { locale: "en", retry: "Retry verification", submit: "Send enquiry", failure: "Verification could not be completed.", unavailable: "Contact submission is temporarily unavailable." },
  { locale: "ar", retry: "إعادة محاولة التحقق", submit: "إرسال الاستفسار", failure: "تعذر إكمال التحقق.", unavailable: "خدمة التواصل غير متاحة مؤقتًا." },
  { locale: "ms", retry: "Cuba pengesahan semula", submit: "Hantar pertanyaan", failure: "Pengesahan tidak dapat diselesaikan.", unavailable: "Penghantaran borang tidak tersedia buat sementara waktu." },
] as const;

for (const copy of cases) {
  test(`Contact ${copy.locale} recovers verification without sending or clearing entered fields`, async ({ page, context }) => {
    await context.addCookies([{ name: "axora_locale", value: copy.locale, url: "http://127.0.0.1:3100" }]);
    let submissions = 0;
    page.on("request", (request) => { if (request.method() === "POST") submissions += 1; });
    await page.route("**/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
      contentType: "application/javascript",
      // This fixture is confined to the standalone demo browser, never production.
      body: `window.__contactFixture={resets:0};window.turnstile={render:function(container,options){window.__contactFixture.options=options;return 'contact-recovery-fixture';},reset:function(){window.__contactFixture.resets++;},remove:function(){}};`,
    }));
    await page.goto(`/${copy.locale}/contact`);
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __contactFixture?: ContactFixture }).__contactFixture?.options))).toBe(true);
    const form = page.locator(".public-contact-form");
    await form.locator('[name="fullName"]').fill("Isolated recovery fixture");
    await form.locator('[name="email"]').fill("contact.fixture@axora.invalid");
    await form.locator('[name="message"]').fill("This form must remain unchanged during verification recovery.");
    await form.locator('[name="privacyAccepted"]').check();
    const submit = form.getByRole("button", { name: copy.submit, exact: true });
    await expect(submit).toBeDisabled();
    await invoke(page, "error-callback", "600010");
    await expect(form.getByRole("status")).toContainText(copy.failure);
    await expect(form.locator("bdi").filter({ hasText: "600010" })).toHaveCount(1);
    const retry = form.getByRole("button", { name: copy.retry, exact: true });
    const help = form.getByRole("link", { name: /Verification troubleshooting|استكشاف مشكلات التحقق|Penyelesaian masalah pengesahan/ });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(help).toBeVisible();
    const recoveryLayout = await form.getByRole("status").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { documentOverflow: document.documentElement.scrollWidth - innerWidth,
        feedbackOverflow: element.scrollWidth - element.clientWidth,
        controls: [...element.querySelectorAll("button,a")].map((control) => {
          const rect = control.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height,
            contained: rect.left >= box.left - 1 && rect.right <= box.right + 1 };
        }) };
    });
    expect(recoveryLayout.documentOverflow).toBeLessThanOrEqual(0);
    expect(recoveryLayout.feedbackOverflow).toBeLessThanOrEqual(1);
    for (const control of recoveryLayout.controls) {
      expect(control.width).toBeGreaterThan(0);
      expect(control.height).toBeGreaterThan(0);
      expect(control.contained).toBe(true);
    }
    await retry.click();
    await expect(submit).toBeDisabled();
    expect(await page.evaluate(() => (window as Window & { __contactFixture?: ContactFixture }).__contactFixture?.resets)).toBe(1);
    await expect(form.locator('[name="fullName"]')).toHaveValue("Isolated recovery fixture");
    await expect(form.locator('[name="email"]')).toHaveValue("contact.fixture@axora.invalid");
    await expect(form.locator('[name="message"]')).toHaveValue("This form must remain unchanged during verification recovery.");
    await expect(form.locator('[name="privacyAccepted"]')).toBeChecked();
    await invoke(page, "callback");
    await expect(submit).toBeEnabled();
    await invoke(page, "expired-callback");
    await expect(submit).toBeDisabled();
    await form.getByRole("button", { name: copy.retry, exact: true }).click();
    await invoke(page, "callback");
    await expect(submit).toBeEnabled();
    await invoke(page, "error-callback", "110200");
    await expect(submit).toBeDisabled();
    await expect(form.getByRole("status")).toContainText(copy.unavailable);
    await expect(form.getByRole("button", { name: copy.retry, exact: true })).toHaveCount(0);
    expect(submissions).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (copy.locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
}
