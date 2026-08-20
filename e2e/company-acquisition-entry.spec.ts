import { expect, test } from "@playwright/test";
import { installReliabilityGuard } from "./helpers/reliability";

const baseURL = "http://127.0.0.1:3100";
const isNextDevelopmentStyleNoise = (message: string) => (
  process.env.AXORA_PLAYWRIGHT_STANDALONE !== "true"
  && message.startsWith("Applying inline style violates")
  && message.includes("style-src-elem")
);
const localeCases = [
  {
    locale: "en" as const,
    label: "Register your company / request access",
    direction: "ltr",
    viewport: { width: 1440, height: 900 },
  },
  {
    locale: "ms" as const,
    label: "Daftar syarikat anda / minta akses",
    direction: "ltr",
    viewport: { width: 834, height: 1112 },
  },
  {
    locale: "ar" as const,
    label: "سجّل شركتك / اطلب الوصول",
    direction: "rtl",
    viewport: { width: 320, height: 568 },
  },
] as const;

for (const localeCase of localeCases) {
  test(`${localeCase.locale} login connects to company acquisition on the first click`, async ({
    context,
    page,
  }) => {
    const reliability = installReliabilityGuard(page, {
      ignoreConsoleError: isNextDevelopmentStyleNoise,
    });
    await context.addCookies([
      { name: "axora_locale", value: localeCase.locale, url: baseURL },
    ]);
    await page.setViewportSize(localeCase.viewport);
    await page.goto("/login");

    const main = page.getByRole("main");
    await expect(main).toHaveAttribute("lang", localeCase.locale);
    await expect(main).toHaveAttribute("dir", localeCase.direction);
    const requestAccess = main.locator("form").getByRole(
      "link", { name: localeCase.label, exact: true },
    );
    await expect(requestAccess).toHaveAttribute(
      "href", `/${localeCase.locale}/contact`,
    );
    await requestAccess.click();

    await expect(page).toHaveURL(new RegExp(`/${localeCase.locale}/contact$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('input[name="idempotencyToken"]')).toHaveCount(1);
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(2);
    await reliability.assertHealthy();
  });
}
