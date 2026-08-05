import { expect, test } from "@playwright/test";

const productionHome = "https://axora.management/en";

test("diagnoses the production visitor-choice browser request path without submitting a claim", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Run the read-only production probe once.",
  );

  let apiScriptRequested = false;
  let turnstileIframeObserved = false;
  let claimPostAttempted = false;

  page.on("request", (request) => {
    if (request.url().startsWith(
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
    )) {
      apiScriptRequested = true;
    }
  });
  page.on("framenavigated", (frame) => {
    try {
      if (new URL(frame.url()).hostname === "challenges.cloudflare.com") {
        turnstileIframeObserved = true;
      }
    } catch {
      // Ignore initial empty frame URLs.
    }
  });

  await page.route("**/api/public/visitor-choice", async (route) => {
    if (route.request().method() === "POST") {
      claimPostAttempted = true;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  const response = await page.goto(productionHome, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  expect(response?.ok()).toBe(true);

  const choice = page.getByRole("button", { name: "Choose Early Birds" });
  await expect(choice).toBeVisible({ timeout: 30_000 });

  const choiceEnabled = await choice.isEnabled();
  if (choiceEnabled) {
    await choice.click();
    await expect.poll(() => apiScriptRequested, { timeout: 20_000 })
      .toBe(true);
    await page.waitForTimeout(20_000);
  }

  const stillVerifying = await page
    .getByText("Verifying your one-time choice…", { exact: true })
    .isVisible()
    .catch(() => false);

  console.log([
    "PRODUCTION_VISITOR_DIAGNOSTIC",
    `choice_enabled=${choiceEnabled}`,
    `api_js_request=${apiScriptRequested}`,
    `turnstile_iframe=${turnstileIframeObserved}`,
    `claim_post_attempt=${claimPostAttempted}`,
    `still_verifying=${stillVerifying}`,
  ].join(" "));

  expect(claimPostAttempted).toBe(false);
});
