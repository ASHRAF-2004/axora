import { expect, test, type Page } from "@playwright/test";
import { installClaimedPublicVisitor } from "./helpers/public-visitor";

const baseURL = "http://127.0.0.1:3100";
const fixtureToken = "A".repeat(43);

const localeCases = [
  {
    locale: "en" as const,
    direction: "ltr",
    missing: "Open your invitation email",
    invalid: "Invitation unavailable",
    contact: "Contact Axora",
  },
  {
    locale: "ar" as const,
    direction: "rtl",
    missing: "افتح رسالة الدعوة",
    invalid: "الدعوة غير متاحة",
    contact: "تواصل مع Axora",
  },
  {
    locale: "ms" as const,
    direction: "ltr",
    missing: "Buka e-mel jemputan anda",
    invalid: "Jemputan tidak tersedia",
    contact: "Hubungi Axora",
  },
] as const;

function failOnBrowserErrors(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror:${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`http:${response.status()}`);
  });
  return failures;
}

test.beforeEach(async ({ page }) => installClaimedPublicVisitor(page));

for (const localeCase of localeCases) {
  test(`${localeCase.locale} setup transport clears the fragment on first open`, async ({
    context,
    page,
  }) => {
    const failures = failOnBrowserErrors(page);
    await context.addCookies([{
      name: "axora_locale",
      value: localeCase.locale,
      url: baseURL,
    }]);

    await page.goto(`/account/setup#token=${fixtureToken}`);
    await expect(page.getByRole("heading", { name: localeCase.invalid })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/account/setup`);
    await expect(page.locator("main")).toHaveAttribute("dir", localeCase.direction);
    await expect(page.locator("body")).not.toContainText(fixtureToken);
    await expect(page.getByRole("link", { name: localeCase.contact }))
      .toHaveAttribute("href", `/${localeCase.locale}/contact`);
    expect(failures).toEqual([]);
  });
}

test("scanner-style GET does not inspect or consume an absent bearer", async ({ page }) => {
  const failures = failOnBrowserErrors(page);
  const actionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/account/setup")) {
      actionRequests.push(request.url());
    }
  });

  const response = await page.goto("/account/setup");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Open your invitation email" }))
    .toBeVisible();
  expect(actionRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("malformed and ambiguous fragments are cleared without inspection", async ({ page }) => {
  const actionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/account/setup")) {
      actionRequests.push(request.url());
    }
  });

  await page.goto(`/account/setup#token=${fixtureToken}&token=${"B".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Invitation unavailable" }))
    .toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/account/setup`);
  expect(actionRequests).toEqual([]);
});
