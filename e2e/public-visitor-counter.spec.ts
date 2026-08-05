import { expect, test, type BrowserContext } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

async function rememberLocale(
  context: BrowserContext,
  locale: "en" | "ar" | "ms",
) {
  await context.addCookies([
    { name: "axora_locale", value: locale, url: baseURL },
  ]);
}

const localeCases = [
  {
    locale: "en" as const,
    title: "Which side are you on?",
    early: "Choose Early Birds",
    night: "Choose Night Owls",
    privacy: "Privacy",
  },
  {
    locale: "ar" as const,
    title: "أيُّ فريق تختار؟",
    early: "اختيار فريق الصباح الباكر",
    night: "اختيار فريق السهر",
    privacy: "الخصوصية",
  },
  {
    locale: "ms" as const,
    title: "Anda di pihak mana?",
    early: "Pilih Pasukan Awal Pagi",
    night: "Pilih Pasukan Kaki Malam",
    privacy: "Privasi",
  },
] as const;

for (const localeCase of localeCases) {
  test(`${localeCase.locale} home exposes the localized visitor-choice counter`, async ({
    context,
    page,
  }) => {
    await rememberLocale(context, localeCase.locale);
    await page.goto(`/${localeCase.locale}`);

    const section = page.getByRole("region", {
      name: localeCase.title,
    });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", {
        level: 2,
        name: localeCase.title,
      }),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: localeCase.early }),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: localeCase.night }),
    ).toBeVisible();
    await expect(
      section.getByRole("link", { name: localeCase.privacy }),
    ).toHaveAttribute("href", `/${localeCase.locale}/privacy`);
    await expect(section.locator("strong").first()).toHaveText("0");
  });
}

test("visitor-choice counter remains usable without horizontal overflow on a small phone", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "en");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/en");

  const section = page.getByRole("region", {
    name: "Which side are you on?",
  });
  await expect(section).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Choose Early Birds" }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Choose Night Owls" }),
  ).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});

test("reduced motion disables visitor stamp, pulse, and confetti animation", async ({
  context,
  page,
}) => {
  await rememberLocale(context, "en");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en");

  const early = page.getByRole("button", { name: "Choose Early Birds" });
  const transitionDuration = await early.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
});
