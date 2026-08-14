import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { publicVisitorCopy } from "../src/lib/public-visitor-copy";

const baseURL = "http://127.0.0.1:3101";
const turnstileScriptUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js*";

const unclaimedSnapshot = {
  totalCount: 0,
  earlyBirdCount: 0,
  nightOwlCount: 0,
};
const claimedSnapshot = {
  totalCount: 1,
  earlyBirdCount: 1,
  nightOwlCount: 0,
  visitorNumber: 1,
  choice: "EARLY_BIRD",
};

async function rememberLocale(
  context: BrowserContext,
  locale: "en" | "ar" | "ms",
) {
  await context.addCookies([
    { name: "axora_locale", value: locale, url: baseURL },
  ]);
}

async function installTurnstileScript(page: Page, body: string) {
  await page.route(turnstileScriptUrl, (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    body,
  }));
}

function turnstileScript(executeBody = "") {
  return `
  (() => {
    let sequence = 0;
    let options;
    window.turnstile = {
      ready(callback) { callback(); },
      render(_container, nextOptions) {
        options = nextOptions;
        return \`test-widget-\${++sequence}\`;
      },
      execute(widgetId) {
        ${executeBody}
      },
      reset() {},
      remove() {},
    };
  })();
  `;
}

async function visitorSection(page: Page, locale: "en" | "ar" | "ms") {
  const section = page.getByRole("dialog", {
    name: publicVisitorCopy[locale].title,
  });
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("data-interactive", "true");
  return section;
}

async function openReadyVisitorChoice(
  page: Page,
  context: BrowserContext,
  locale: "en" | "ar" | "ms" = "en",
) {
  await rememberLocale(context, locale);
  await page.goto(`/${locale}`);
  const section = await visitorSection(page, locale);
  await expect(section).toHaveAttribute("data-phase", "ready");
  return section;
}

async function mockVisitorApi(
  page: Page,
  handler: (method: string) => {
    status: number;
    body?: unknown;
    abort?: "connectionreset";
  },
) {
  await page.route("**/api/public/visitor-choice", async (route) => {
    const result = handler(route.request().method());
    if (result.abort) {
      await route.abort(result.abort);
      return;
    }
    await route.fulfill({
      status: result.status,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(result.body ?? {}),
    });
  });
}

test.describe("visitor-choice verification recovery", () => {
  for (const locale of ["en", "ar", "ms"] as const) {
    test(`${locale} reports a failed Turnstile script with localized retry controls`, async ({
      context,
      page,
    }) => {
      await rememberLocale(context, locale);
      await page.route(turnstileScriptUrl, (route) =>
        route.abort("blockedbyclient"));
      await page.goto(`/${locale}`);

      const section = await visitorSection(page, locale);
      await section.getByRole("button", {
        name: publicVisitorCopy[locale].chooseEarly,
      }).click();
      await expect(section).toHaveAttribute("data-phase", "error");
      await expect(section.getByRole("alert")).toContainText(
        publicVisitorCopy[locale].scriptError,
      );
      await expect(
        section.getByRole("button", {
          name: publicVisitorCopy[locale].retry,
        }),
      ).toBeVisible();
    });
  }

  test("window.turnstile unavailable becomes a retryable error", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(page, "void 0;");
    await rememberLocale(context, "en");
    await page.goto("/en");

    const section = await visitorSection(page, "en");
    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.scriptError,
    );
    await expect(
      section.getByRole("button", { name: publicVisitorCopy.en.retry }),
    ).toBeVisible();
  });

  test("a render call without a usable widget ID fails closed", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(page, `
      window.turnstile = {
        ready(callback) { callback(); },
        render() { return undefined; },
        execute() {},
        reset() {},
        remove() {},
      };
    `);
    await rememberLocale(context, "en");
    await page.goto("/en");

    const section = await visitorSection(page, "en");
    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.scriptError,
    );
  });

  test("a throwing ready callback does not block direct explicit rendering", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(page, `
      window.turnstile = {
        ready() { throw new Error("not-ready"); },
        render() { return "test-widget"; },
        execute() {},
        reset() {},
        remove() {},
      };
    `);

    const section = await openReadyVisitorChoice(page, context);
    const early = section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    });
    await expect(early).toBeEnabled();
    await early.click();
    await expect(section).toHaveAttribute("data-phase", "verifying");
  });

  test("execute exceptions leave a clear retryable error", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(
      page,
      turnstileScript('throw new Error("execute-failed");'),
    );
    const section = await openReadyVisitorChoice(page, context);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();

    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.error,
    );
    await expect(
      section.getByRole("button", { name: publicVisitorCopy.en.retry }),
    ).toBeVisible();
  });

  test("a challenge with no callback times out instead of spinning forever", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(page, turnstileScript());
    const section = await openReadyVisitorChoice(page, context);
    await page.clock.install();

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "verifying");
    await page.clock.fastForward(18_500);

    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.timeout,
    );
  });

  test("unsupported browsers receive the dedicated retryable message", async ({
    context,
    page,
  }) => {
    await installTurnstileScript(
      page,
      turnstileScript('options["unsupported-callback"]();'),
    );
    const section = await openReadyVisitorChoice(page, context);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();

    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.unsupported,
    );
  });

  test("a pending browser POST is aborted and becomes retryable", async ({
    context,
    page,
  }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          window.location.href,
        );
        if (url.pathname === "/api/public/visitor-choice"
          && init?.method === "POST") {
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(
              new DOMException("The request was aborted.", "AbortError"),
            );
            if (init.signal?.aborted) {
              abort();
            } else {
              init.signal?.addEventListener("abort", abort, { once: true });
            }
          });
        }
        return originalFetch(input, init);
      }) as typeof window.fetch;
    });
    await installTurnstileScript(
      page,
      turnstileScript('options.callback("test-turnstile-token");'),
    );
    const section = await openReadyVisitorChoice(page, context);
    await page.clock.install();

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "verifying");
    await page.clock.fastForward(12_500);

    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(section.getByRole("alert")).toContainText(
      publicVisitorCopy.en.requestTimeout,
    );
  });

  for (const responseCase of [
    { status: 403, expected: publicVisitorCopy.en.rejected },
    { status: 429, expected: publicVisitorCopy.en.rateLimited },
    { status: 503, expected: publicVisitorCopy.en.unavailable },
  ]) {
    test(`POST ${responseCase.status} maps to a localized retryable state`, async ({
      context,
      page,
    }) => {
      await mockVisitorApi(page, (method) => method === "GET"
        ? { status: 200, body: unclaimedSnapshot }
        : { status: responseCase.status, body: { error: "rejected" } });
      await installTurnstileScript(
        page,
        turnstileScript('options.callback("test-turnstile-token");'),
      );
      const section = await openReadyVisitorChoice(page, context);

      await section.getByRole("button", {
        name: publicVisitorCopy.en.chooseEarly,
      }).click();

      await expect(section).toHaveAttribute("data-phase", "error");
      await expect(section.getByRole("alert")).toContainText(
        responseCase.expected,
      );
      await expect(
        section.getByRole("button", { name: publicVisitorCopy.en.retry }),
      ).toBeVisible();
    });
  }

  test("a successful claim clears the verification watchdog", async ({
    context,
    page,
  }) => {
    await mockVisitorApi(page, (method) => method === "GET"
      ? { status: 200, body: unclaimedSnapshot }
      : { status: 200, body: claimedSnapshot });
    await installTurnstileScript(
      page,
      turnstileScript('options.callback("test-turnstile-token");'),
    );
    const section = await openReadyVisitorChoice(page, context);
    await page.clock.install();

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    const counters = page.locator('[data-visitor-claimed="true"]');
    await expect(section).toHaveCount(0);
    await expect(counters).toBeVisible();
    await page.clock.fastForward(20_000);

    await expect(counters).toBeVisible();
    await expect(section.getByRole("alert")).toHaveCount(0);
  });

  test("retry recovers a committed claim after the POST response is lost", async ({
    context,
    page,
  }) => {
    let committed = false;
    let postCount = 0;
    await mockVisitorApi(page, (method) => {
      if (method === "GET") {
        return {
          status: 200,
          body: committed ? claimedSnapshot : unclaimedSnapshot,
        };
      }
      postCount += 1;
      committed = true;
      return { status: 0, abort: "connectionreset" };
    });
    await installTurnstileScript(
      page,
      turnstileScript('options.callback("test-turnstile-token");'),
    );
    const section = await openReadyVisitorChoice(page, context);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "error");

    await section.getByRole("button", {
      name: publicVisitorCopy.en.retry,
    }).click();

    await expect(section).toHaveCount(0);
    await expect(page.locator('[data-visitor-claimed="true"]')).toContainText(
      publicVisitorCopy.en.totalLabel,
    );
    expect(postCount).toBe(1);
  });

  test("duplicate callbacks and a retry produce only one POST per attempt", async ({
    context,
    page,
  }) => {
    let postCount = 0;
    await mockVisitorApi(page, (method) => {
      if (method === "GET") {
        return { status: 200, body: unclaimedSnapshot };
      }
      postCount += 1;
      return postCount === 1
        ? { status: 503, body: { error: "unavailable" } }
        : { status: 200, body: claimedSnapshot };
    });
    await installTurnstileScript(
      page,
      turnstileScript(`
        options.callback("test-turnstile-token");
        options.callback("duplicate-test-token");
      `),
    );
    const section = await openReadyVisitorChoice(page, context);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "error");
    expect(postCount).toBe(1);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.retry,
    }).click();
    await expect(section).toHaveAttribute("data-phase", "ready");
    expect(postCount).toBe(1);

    await section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    }).click();
    await expect(section).toHaveCount(0);
    await expect(page.locator('[data-visitor-claimed="true"]')).toBeVisible();
    expect(postCount).toBe(2);
  });

  test("retryable timeout remains usable on a reduced-motion small phone", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installTurnstileScript(page, turnstileScript());
    const section = await openReadyVisitorChoice(page, context);
    await page.clock.install();

    const early = section.getByRole("button", {
      name: publicVisitorCopy.en.chooseEarly,
    });
    await early.click();
    await page.clock.fastForward(18_500);

    await expect(section).toHaveAttribute("data-phase", "error");
    await expect(
      section.getByRole("button", { name: publicVisitorCopy.en.retry }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
    const transitionDuration = await early.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
  });
});
