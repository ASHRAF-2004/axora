import { expect, test, type Page } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";
import { installReliabilityGuard } from "./helpers/reliability";

function countServerActionPosts(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) count += 1;
  });
  return () => count;
}

test.describe("production reliability guard", () => {
  // First-attempt correctness must never be masked by Playwright's CI retry policy.
  test.describe.configure({ retries: 0 });

  test("a valid profile mutation succeeds on its first and only submission", async ({ page }) => {
    await signInAsDemoOwner(page);
    const reliability = installReliabilityGuard(page);
    const actionPosts = countServerActionPosts(page);

    await page.goto("/profile");
    await page.getByLabel("Display name").fill("Axora Reliability Owner");
    await page.getByLabel("Job title").fill("Platform Owner");

    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page).toHaveURL(/\/profile\?saved=1$/);
    await expect(page.locator('.profile-feedback[role="status"]')).toContainText(
      "profile changes were saved",
    );
    expect(actionPosts()).toBe(1);
    await reliability.assertHealthy();
  });

  test("an expected invalid profile mutation stays local on the first submission", async ({ page }) => {
    await signInAsDemoOwner(page);
    const reliability = installReliabilityGuard(page);
    const actionPosts = countServerActionPosts(page);

    await page.goto("/profile");
    const policy = page.getByRole("checkbox", {
      name: /I confirm these details and accept the required Axora policies/i,
    });
    await policy.uncheck();
    await policy.evaluate((element) => element.removeAttribute("required"));

    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page).toHaveURL(/\/profile\?.*error=invalid-profile/);
    await expect(page.locator('.profile-feedback[role="alert"]')).toContainText(
      "Review the highlighted profile fields",
    );
    expect(actionPosts()).toBe(1);
    await reliability.assertHealthy();
  });
});
