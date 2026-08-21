import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyRequester: DemoRoleSession = {
  id: "86000000-0000-4000-8000-000000000001",
  email: "profile-requester@axora.e2e",
  name: "Profile Requester",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
};

async function validProfilePng() {
  return sharp({ create: {
    width: 320,
    height: 240,
    channels: 4,
    background: { r: 24, g: 91, b: 70, alpha: 1 },
  } }).png().toBuffer();
}

test("a supported user crops, activates, replaces, and removes a private profile photo", async ({ page }) => {
  await signInAsDemoRole(page, companyRequester);
  await page.goto("/profile");
  let uploadRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/profile/avatar") && request.method() === "POST") uploadRequests += 1;
  });
  const manager = page.locator(".profile-image-manager");
  await expect(manager.getByRole("heading", { name: "Profile photo" })).toBeVisible();
  await manager.locator('input[name="avatar"]').setInputFiles({
    name: "profile.png",
    mimeType: "image/png",
    buffer: await validProfilePng(),
  });
  await expect(manager.locator(".profile-image-preview")).toHaveAttribute("data-has-preview", "true");
  await manager.getByRole("slider", { name: "Horizontal position" }).fill("35");
  await manager.getByRole("slider", { name: "Vertical position" }).fill("60");
  await manager.getByRole("slider", { name: "Zoom" }).fill("1.4");
  await manager.getByRole("button", { name: "Crop and save" }).click();
  await expect(page).toHaveURL(/\/profile\?.*saved=image/);
  await expect(page.getByText("Your processed profile photo is active.")).toBeVisible();
  await expect(manager.locator('img[src^="/api/profile/avatar"]')).toBeVisible();
  await expect(page.locator('.app-avatar img[src^="/api/profile/avatar"]')).toBeVisible();
  expect(uploadRequests).toBe(1);

  const activatedSource = await manager.locator('img[src^="/api/profile/avatar"]').getAttribute("src");
  expect(activatedSource).toContain("?v=");
  await page.reload();
  await expect(manager.locator('img[src^="/api/profile/avatar"]')).toHaveAttribute("src", activatedSource ?? "");
  await expect(page.locator('.app-avatar img[src^="/api/profile/avatar"]')).toBeVisible();

  await manager.locator('input[name="avatar"]').setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(manager.getByRole("alert")).toContainText(/JPEG, PNG, or WebP/);
  await expect(page.getByText(/unexpected error|reference id/i)).toHaveCount(0);
  expect(uploadRequests).toBe(1);

  await manager.getByRole("button", { name: "Remove photo" }).click();
  await expect(page).toHaveURL(/\/profile\?.*saved=image-removed/);
  await expect(page.getByText("The profile photo was removed. Initials are now shown.")).toBeVisible();
  await expect(manager.locator('img[src^="/api/profile/avatar"]')).toHaveCount(0);
});

test("Arabic profile-photo controls remain RTL, mobile-safe, and reduced-motion safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, { ...companyRequester, id: "86000000-0000-4000-8000-000000000002", preferredLocale: "ar" });
  await page.goto("/profile");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const manager = page.locator(".profile-image-manager");
  await expect(manager.getByText("صورة الملف الشخصي", { exact: true })).toBeVisible();
  await manager.locator('input[name="avatar"]').setInputFiles({
    name: "profile-ar.png",
    mimeType: "image/png",
    buffer: await validProfilePng(),
  });
  await expect(manager.getByRole("slider")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const transition = await manager.locator(".profile-image-preview img").evaluate((element) => (
    getComputedStyle(element).transitionDuration
  ));
  expect(Number.parseFloat(transition)).toBeLessThanOrEqual(0.001);
});
