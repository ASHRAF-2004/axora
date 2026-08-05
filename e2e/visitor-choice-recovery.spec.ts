import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const turnstileScript =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const unclaimedSnapshot = {
  totalCount: 3,
  earlyBirdCount: 2,
  nightOwlCount: 1,
};

const claimedSnapshot = {
  totalCount: 4,
  earlyBirdCount: 3,
  nightOwlCount: 1,
  choice: "EARLY_BIRD",
  visitorNumber: 4,
};

type TurnstileBehavior =
  | "success"
  | "silent"
  | "unsupported"
  | "render-empty"
  | "render-throws"
  | "ready-throws"
  | "execute-throws"
  | "second-execute-succeeds"
  | "teardown-throws";

async function rememberLocale(
  context: BrowserContext,
  locale: "en" | "ar" | "ms",
) {
  await context.addCookies([
    { name: "axora_locale", value: locale, url: baseURL },
  ]);
}

function turnstileBody(behavior: TurnstileBehavior) {
  const ready = behavior === "ready-throws"
    ? "throw new Error('ready failed');"
    : "callback();";
  const render = behavior === "render-throws"
    ? "throw new Error('render failed');"
    : behavior === "render-empty"
      ? "options = nextOptions; return undefined;"
      : "options = nextOptions; return 'visitor-widget';";
  const execute = behavior === "execute-throws"
    ? "throw new Error('execute failed');"
    : behavior === "silent"
      ? "return;"
      : behavior === "unsupported"
        ? "options['unsupported-callback']();"
        : behavior === "second-execute-succeeds"
          ? "executeCount += 1; if (executeCount > 1) options.callback('test-token');"
          : "options.callback('test-token');";
  const reset = behavior === "teardown-throws"
    ? "throw new Error('reset failed');"
    : "return;";
  const remove = behavior === "teardown-throws"
    ? "throw new Error('remove failed');"
    : "return;";

  return `
    (() => {
      let options;
      let executeCount = 0;
      window.turnstile = {
        ready(callback) { ${ready} },
        render(_container, nextOptions) { ${render} },
        execute(_widgetId) { ${execute} },
        reset(_widgetId) { ${reset} },
        remove(_widgetId) { ${remove} }
      };
    })();
  `;
}

async function installTurnstile(
  page: Page,
  behavior: TurnstileBehavior,
) {
  await page.route(turnstileScript, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "Cache-Control": "no-store" },
      body: turnstileBody(behavior),
    });
  });
}

async function installUnavailableTurnstile(page: Page) {
  await page.route(turnstileScript, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "Cache-Control": "no-store" },
      body: "delete window.turnstile;",
    });
  });
}

async function installSnapshotApi(
  page: Page,
  options: {
    getSnapshot?: () => typeof unclaimedSnapshot | typeof claimedSnapshot;
    postStatus?: number;
    postSnapshot?: unknown;
    onPost?: () => void;
    abortPost?: boolean;
  } = {},
) {
  await page.route("**/api/public/visitor-choice", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          options.getSnapshot?.() ?? unclaimedSnapshot,
        ),
      });
      return;
    }
    if (method === "POST") {
      options.onPost?.();
      if (options.abortPost) {
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({
        status: options.postStatus ?? 200,
        contentType: "application/json",
        body: JSON.stringify(
          options.postSnapshot ?? claimedSnapshot,
        ),
      });
      return;
    }
    await route.continue();
  });
}

async function openReadyEnglish(page: Page, context: BrowserContext) {
  await rememberLocale(context, "en");
  await page.goto("/en");
  const choice = page.getByRole("button", { name: "Choose Early Birds" });
  await expect(choice).toBeEnabled();
  return choice;
}

test.describe("visitor-choice recovery state machine", () => {
  test.beforeEach((fixtures, testInfo) => {
    void fixtures;
    test.skip(
      testInfo.project.name !== "chromium",
      "Detailed fault injection runs once in desktop Chromium.",
    );
  });

  const localizedScriptFailures = [
    {
      locale: "en" as const,
      message: "Secure verification could not load. Check your connection or content blocker, then retry.",
      retry: "Retry",
    },
    {
      locale: "ar" as const,
      message: "تعذر تحميل التحقق الآمن. تحقق من الاتصال أو مانع المحتوى، ثم أعد المحاولة.",
      retry: "إعادة المحاولة",
    },
    {
      locale: "ms" as const,
      message: "Pengesahan selamat tidak dapat dimuatkan. Semak sambungan atau penyekat kandungan anda, kemudian cuba lagi.",
      retry: "Cuba lagi",
    },
  ];

  for (const localeCase of localizedScriptFailures) {
    test(`${localeCase.locale} reports a Turnstile script load failure with Retry`, async ({
      context,
      page,
    }) => {
      await installSnapshotApi(page);
      await page.route(turnstileScript, (route) =>
        route.abort("blockedbyclient"));
      await rememberLocale(context, localeCase.locale);

      await page.goto(`/${localeCase.locale}`);

      await expect(page.getByRole("alert")).toContainText(
        localeCase.message,
      );
      await expect(
        page.getByRole("button", { name: localeCase.retry }),
      ).toBeVisible();
    });
  }

  test("reports an unavailable window.turnstile API", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installUnavailableTurnstile(page);
    await rememberLocale(context, "en");

    await page.goto("/en");

    await expect(page.getByRole("alert")).toContainText(
      "Secure verification could not load.",
    );
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("recovers by loading a fresh script after a transient script failure", async ({
    context,
    page,
  }) => {
    let scriptRequests = 0;
    let posts = 0;
    await installSnapshotApi(page, { onPost: () => { posts += 1; } });
    await page.route(turnstileScript, async (route) => {
      scriptRequests += 1;
      if (scriptRequests === 1) {
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "Cache-Control": "no-store" },
        body: turnstileBody("success"),
      });
    });
    await rememberLocale(context, "en");
    await page.goto("/en");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.getByRole("button", { name: "Retry" }).click();
    const choice = page.getByRole("button", { name: "Choose Early Birds" });
    await expect(choice).toBeEnabled();
    await choice.click();

    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    expect(scriptRequests).toBe(2);
    expect(posts).toBe(1);
  });

  test("catches turnstile.ready exceptions", async ({ context, page }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "ready-throws");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByRole("alert")).toContainText(
      "Secure verification could not load.",
    );
  });

  test("catches turnstile.render exceptions", async ({ context, page }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "render-throws");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByRole("alert")).toContainText(
      "Secure verification could not load.",
    );
  });

  test("rejects an unusable widget ID returned by render", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "render-empty");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByRole("alert")).toContainText(
      "Secure verification could not load.",
    );
    await expect(page.locator("[data-phase='verifying']")).toHaveCount(0);
  });

  test("catches turnstile.execute exceptions", async ({ context, page }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "execute-throws");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByRole("alert")).toContainText(
      "Your choice could not be verified.",
    );
  });

  test("stops a challenge when no callback arrives before the watchdog", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "silent");
    const choice = await openReadyEnglish(page, context);
    await page.clock.install();

    await choice.click();
    await expect(page.getByText("Verifying your one-time choice…")).toBeVisible();
    await page.clock.fastForward(18_100);

    await expect(page.getByRole("alert")).toContainText(
      "Verification took too long and was stopped.",
    );
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("handles the Turnstile unsupported-browser callback", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "unsupported");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByRole("alert")).toContainText(
      "This browser cannot run secure verification.",
    );
  });

  test("aborts a browser POST that remains pending", async ({
    context,
    page,
  }) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = ((input, init) => {
        const requestUrl = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        const method = init?.method
          ?? (input instanceof Request ? input.method : "GET");
        if (method === "POST"
          && requestUrl.includes("/api/public/visitor-choice")) {
          return new Promise<Response>((_resolve, reject) => {
            const rejectAbort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            if (init?.signal?.aborted) {
              rejectAbort();
            } else {
              init?.signal?.addEventListener(
                "abort",
                rejectAbort,
                { once: true },
              );
            }
          });
        }
        return nativeFetch(input, init);
      }) as typeof window.fetch;
    });
    await installSnapshotApi(page);
    await installTurnstile(page, "success");
    const choice = await openReadyEnglish(page, context);
    await page.clock.install();

    await choice.click();
    await page.clock.fastForward(12_100);

    await expect(page.getByRole("alert")).toContainText(
      "The claim request took too long.",
    );
  });

  const responseFailures = [
    {
      status: 403,
      message: "Secure verification was rejected or expired.",
    },
    {
      status: 429,
      message: "Too many verification attempts were made.",
    },
    {
      status: 503,
      message: "Visitor claiming is temporarily unavailable.",
    },
  ];

  for (const responseFailure of responseFailures) {
    test(`renders a retryable ${responseFailure.status} response`, async ({
      context,
      page,
    }) => {
      await installSnapshotApi(page, {
        postStatus: responseFailure.status,
        postSnapshot: { error: "redacted-test-error" },
      });
      await installTurnstile(page, "success");
      const choice = await openReadyEnglish(page, context);

      await choice.click();

      await expect(page.getByRole("alert")).toContainText(
        responseFailure.message,
      );
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    });
  }

  test("a successful claim clears the verification watchdog", async ({
    context,
    page,
  }) => {
    let posts = 0;
    await installSnapshotApi(page, { onPost: () => { posts += 1; } });
    await installTurnstile(page, "success");
    const choice = await openReadyEnglish(page, context);
    await page.clock.install();

    await choice.click();
    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    await page.clock.fastForward(20_000);

    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect(posts).toBe(1);
  });

  test("a refresh after a lost response recovers the existing claim", async ({
    context,
    page,
  }) => {
    let stored = false;
    let posts = 0;
    await installSnapshotApi(page, {
      getSnapshot: () => stored ? claimedSnapshot : unclaimedSnapshot,
      onPost: () => {
        posts += 1;
        stored = true;
      },
      abortPost: true,
    });
    await installTurnstile(page, "success");
    const choice = await openReadyEnglish(page, context);

    await choice.click();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.reload();

    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    expect(posts).toBe(1);
  });

  test("retry invalidates the old widget and submits only once", async ({
    context,
    page,
  }) => {
    let posts = 0;
    await installSnapshotApi(page, { onPost: () => { posts += 1; } });
    await installTurnstile(page, "second-execute-succeeds");
    const choice = await openReadyEnglish(page, context);
    await page.clock.install();

    await choice.click();
    await page.clock.fastForward(18_100);
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.evaluate((button) => {
      button.click();
      button.click();
    });

    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    expect(posts).toBe(1);
  });

  test("reset and remove exceptions cannot undo a successful claim", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "teardown-throws");
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByText("Your spot is already claimed.")).toBeVisible();
    await expect(page.locator("[data-phase='claimed']")).toBeVisible();
  });

  test("reduced motion keeps the verification state usable without pulse animation", async ({
    context,
    page,
  }) => {
    await installSnapshotApi(page);
    await installTurnstile(page, "silent");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const choice = await openReadyEnglish(page, context);

    await choice.click();

    await expect(page.getByText("Verifying your one-time choice…")).toBeVisible();
    await expect(page.locator("[class*='pendingPulse']")).toBeHidden();
  });
});

test("the retryable error state remains usable on mobile", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "This assertion is specific to the mobile project.",
  );
  await installSnapshotApi(page);
  await page.route(turnstileScript, (route) =>
    route.abort("blockedbyclient"));
  await rememberLocale(context, "en");

  await page.goto("/en");

  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth
      - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});
