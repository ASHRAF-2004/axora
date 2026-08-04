import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsDemoOwner } from "./helpers/auth";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAutomatedWcagViolations(
  page: Parameters<typeof signInAsDemoOwner>[0],
) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

const publicRoutes = [
  { path: "/login", heading: "Sign in to Axora" },
  { path: "/account/setup", heading: "Your Axora access starts here." },
  { path: "/account/setup/help", heading: "Get your account ready safely." },
  {
    path: "/privacy",
    heading: "How Axora handles account and procurement information.",
  },
] as const;

test("public account routes expose a main landmark and page heading", async ({
  page,
}) => {
  for (const route of publicRoutes) {
    await test.step(route.path, async () => {
      await page.goto(route.path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(
        page.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeAttached();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }
});

test("sign-in controls have programmatic labels and password-manager hints", async ({
  page,
}) => {
  await page.goto("/login");

  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("the authenticated shell exposes named navigation and profile controls", async ({
  page,
}, testInfo) => {
  await signInAsDemoOwner(page);

  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(
      page.getByRole("navigation", {
        name: "Complete application navigation",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close application menu" }).click();
  } else {
    await expect(
      page.getByRole("navigation", {
        name: "Primary application navigation",
      }),
    ).toBeVisible();
  }
  await expect(page.getByRole("main")).toBeVisible();
  const profileButton = page.locator(".app-profile-button");
  await expect(profileButton).toHaveAccessibleName(
    /My profile: Axora demo administrator/,
  );
  await profileButton.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test("critical public and authenticated surfaces pass automated WCAG A/AA checks", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "axora_locale",
      value: "en",
      url: "http://127.0.0.1:3100",
    },
  ]);
  for (const route of [
    "/en",
    "/en/contact",
    "/login",
    "/account/setup/help",
  ] as const) {
    await test.step(route, async () => {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoAutomatedWcagViolations(page);
    });
  }

  await signInAsDemoOwner(page);
  await expectNoAutomatedWcagViolations(page);
});

test("public content and sign-in remain usable while noncritical media is slow", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "axora_locale",
      value: "en",
      url: "http://127.0.0.1:3100",
    },
  ]);
  await page.route(/\/(?:brand|_next\/image)\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "One clear path from business need to verified delivery.",
    }),
  ).toBeVisible();
  await expect(page.locator(".public-login-link")).toBeVisible();
  await expect(page.locator(".public-login-link")).toHaveAttribute(
    "href",
    "/login",
  );
});
