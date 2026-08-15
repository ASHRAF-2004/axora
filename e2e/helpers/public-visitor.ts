import type { Page } from "@playwright/test";

export async function installClaimedPublicVisitor(page: Page) {
  await page.route(/\/api\/public\/visitor-choice$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 42,
        totalCount: 42,
        earlyBirdCount: 24,
        nightOwlCount: 18,
        choice: "EARLY_BIRD",
        visitorNumber: 42,
      }),
    });
  });
}
