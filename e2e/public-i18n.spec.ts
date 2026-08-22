import { expect, test, type BrowserContext } from "@playwright/test";
import { installClaimedPublicVisitor } from "./helpers/public-visitor";

const baseURL = "http://127.0.0.1:3100";

test.beforeEach(async ({ page }) => installClaimedPublicVisitor(page));

async function rememberLocale(
  context: BrowserContext,
  locale: "en" | "ar" | "ms",
) {
  await context.addCookies([
    { name: "axora_locale", value: locale, url: baseURL },
  ]);
}

test.describe("first-visit language decision", () => {
  test.use({ locale: "ar-SA" });

  test("detects the browser language and persists an explicit choice", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.goto("/");

    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator(".public-site")).toHaveAttribute("lang", "ar");
    await expect(page.locator(".public-site")).toHaveAttribute("dir", "rtl");
    const languageDialog = page.getByRole("dialog", {
      name: "هل تريد استخدام لغة المتصفح؟",
    });
    await expect(languageDialog).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "هل تريد استخدام لغة المتصفح؟",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Bahasa Melayu/ }).click();
    await expect(page).toHaveURL(/\/ms$/);
    await expect(languageDialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await context.cookies()).find(
            (cookie) => cookie.name === "axora_locale",
          )?.value,
      )
      .toBe("ms");

    await page.reload();
    await expect(languageDialog).toHaveCount(0);
    await page.goto("/");
    await expect(page).toHaveURL(/\/ms$/);
  });
});

const localeCases = [
  {
    locale: "en" as const,
    viewport: { width: 1440, height: 900 },
    heading: "One clear path from business need to verified delivery.",
    direction: "ltr",
    navigation: "Primary navigation",
    menu: null,
  },
  {
    locale: "ms" as const,
    viewport: { width: 834, height: 1112 },
    heading: "Satu laluan jelas daripada keperluan perniagaan kepada penghantaran yang disahkan.",
    direction: "ltr",
    navigation: "Navigasi mudah alih",
    menu: "Buka menu",
  },
  {
    locale: "ar" as const,
    viewport: { width: 320, height: 568 },
    heading: "مسار واحد واضح من احتياج الشركة إلى تسليم موثّق.",
    direction: "rtl",
    navigation: "التنقل عبر الجوال",
    menu: "فتح القائمة",
  },
] as const;

for (const localeCase of localeCases) {
  test(`${localeCase.locale} public home is localized and responsive at ${localeCase.viewport.width}px`, async ({
    context,
    page,
  }) => {
    await rememberLocale(context, localeCase.locale);
    await page.setViewportSize(localeCase.viewport);
    await page.goto(`/${localeCase.locale}`);

    const publicSite = page.locator(".public-site");
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      localeCase.locale,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      localeCase.direction,
    );
    await expect(publicSite).toHaveAttribute("lang", localeCase.locale);
    await expect(publicSite).toHaveAttribute("dir", localeCase.direction);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: localeCase.heading }),
    ).toBeVisible();
    await expect(page.locator(".public-login-link")).toHaveAttribute(
      "href",
      "/login",
    );

    if (localeCase.menu) {
      await page.getByLabel(localeCase.menu).click();
      await expect(
        page.getByRole("navigation", { name: localeCase.navigation }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("navigation", { name: localeCase.navigation }),
      ).toBeVisible();
    }

    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(2);
  });
}

test("mobile navigation closes after a localized client-side route change", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "ms");
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto("/ms");

  await page.getByLabel("Buka menu").click();
  const menuNavigation = page.getByRole("navigation", {
    name: "Navigasi mudah alih",
  });
  await expect(menuNavigation).toBeVisible();
  await menuNavigation.getByRole("link", { name: "Hubungi Kami" }).click();

  await expect(page).toHaveURL(/\/ms\/contact$/);
  await expect(menuNavigation).toBeHidden();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Beritahu kami tentang aliran perolehan anda.",
    }),
  ).toBeVisible();
});

test("small-phone skip link moves keyboard focus to public content", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "Keyboard order is covered with desktop Chromium at a small-phone viewport.",
  );
  await rememberLocale(context, "en");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/en");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveAttribute("data-focus-ready", "true");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("small-phone keyboard flow exposes language, login, and menu controls", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "Keyboard order is covered with desktop Chromium at a small-phone viewport.",
  );
  await rememberLocale(context, "en");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/en?keyboard=header");
  await page
    .locator("nextjs-portal")
    .evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
  await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveAttribute("data-focus-ready", "true");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Home - Axora" })).toBeFocused();
  await page.keyboard.press("Tab");
  const language = page.getByRole("combobox", { name: "Language" });
  await expect(language).toBeFocused();
  await expect(page.locator(".public-language-select")).toHaveCSS(
    "outline-style",
    "solid",
  );

  await page.keyboard.press("Tab");
  await expect(page.locator(".public-login-link")).toBeFocused();
  await page.keyboard.press("Tab");
  const menuButton = page.getByLabel("Open menu");
  await expect(menuButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
});

test("localized contact form labels retained fields and omits retired company fields", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "ar");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/ar/contact");

  await expect(
    page.getByRole("form", {
      name: "أخبرنا عن مسار المشتريات في شركتك.",
    }),
  ).toBeVisible();
  await expect(page.locator('input[name="companyName"]')).toBeVisible();
  await expect(page.locator('input[name="contactName"]')).toBeVisible();
  for (const retiredField of [
    "registrationNumber", "contactEmail", "phoneCountryCode", "phone",
    "country", "region", "contactTime", "city",
  ]) {
    await expect(page.locator(`[name="${retiredField}"]`)).toHaveCount(0);
  }
  await expect(
    page.locator('textarea[name="message"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /أفهم أن أكسورا/ }),
  ).toBeVisible();
  await expect(page.locator('input[name="website"]')).toHaveAttribute(
    "tabindex",
    "-1",
  );
  await expect(page.locator(".contact-honeypot")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(2);
});

test("reduced-motion preference removes meaningful public transition motion", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en");

  await expect
    .poll(() =>
      page.evaluate(() =>
        matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    )
    .toBe(true);
  const roleCard = page.locator(".public-role-grid > a").first();
  const styles = await roleCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(Number.parseFloat(styles.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(styles.transitionDuration)).toBeLessThanOrEqual(
    0.001,
  );
});

test("the public login entry resolves to the themed sign-in form with return navigation", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "en");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en");
  await page.locator(".public-login-link").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Sign in to Axora" }),
  ).toBeVisible();
  const backLink = page.getByRole("link", { name: "Back to website" });
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute("href", "/en");
  await expect(page.getByRole("link")).toHaveCount(4);
});

test("simple login preserves password visibility controls and respects reduced motion", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");

  const password = page.getByLabel("Password", { exact: true });
  await expect(page.locator(".login-guide")).toHaveCount(0);
  await password.focus();
  await password.fill("private-value");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("private-value");
});

test("Arabic login keeps localized controls and return navigation", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "ar");
  await page.goto("/login");

  const main = page.getByRole("main");
  await expect(main).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("form", { name: "تسجيل الدخول إلى Axora" }),
  ).toBeVisible();
  const backLink = main.getByRole("link", { name: "العودة إلى الموقع" });
  await expect(backLink).toHaveAttribute("href", "/ar");
  await expect(main.getByRole("link")).toHaveCount(4);
  await expect(page.getByLabel("البريد الإلكتروني")).toHaveAttribute(
    "type",
    "email",
  );
  await expect(
    page.getByRole("button", { name: "إظهار كلمة المرور" }),
  ).toBeVisible();
});
