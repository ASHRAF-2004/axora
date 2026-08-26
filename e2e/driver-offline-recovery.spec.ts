import { expect, test } from "@playwright/test";
import { signInAsDemoRole } from "./helpers/auth";

const driver = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "driver-recovery.fixture@axora.invalid",
  name: "Driver recovery fixture",
  role: "DELIVERY_GUY",
  accountKind: "DELIVERY",
  scopeType: "DELIVERY",
} as const;

const storageKey = `axora:driver:${driver.id}:event-queue:v1`;
const validEvent = {
  deliveryJobId: "20000000-0000-4000-8000-000000000001",
  assignmentId: "30000000-0000-4000-8000-000000000001",
  deviceId: "40000000-0000-4000-8000-000000000001",
  clientEventId: "50000000-0000-4000-8000-000000000001",
  deviceSequence: 1,
  eventType: "ARRIVED",
  clientRecordedAt: "2026-08-02T08:00:00.000Z",
};

async function openOriginAndStore(page: Parameters<typeof signInAsDemoRole>[0], raw: string) {
  await signInAsDemoRole(page, driver);
  // Establish the application origin without starting the public locale
  // redirect/confirmation flow, which can race a second navigation.
  await page.goto("/api/health/live");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: raw,
  });
  await page.goto("/driver");
}

test("corrupt driver storage is preserved, exportable, and discarded only after confirmation", async ({ page }) => {
  const raw = "{not-valid-json";
  await openOriginAndStore(page, raw);

  await expect(page.getByRole("heading", { name: "Saved delivery updates need attention" })).toBeVisible();
  await expect(page.getByText("Nothing was changed or deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);

  await page.getByRole("button", { name: "Retry validation" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^axora-delivery-queue-recovery-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);

  await page.getByRole("button", { name: "Discard local copy" }).click();
  await expect(page.getByRole("group", { name: "Discard this saved copy?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep saved copy" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);

  await page.getByRole("button", { name: "Discard local copy" }).click();
  await page.getByRole("button", { name: "Confirm discard" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  await expect(page.getByRole("heading", { name: "Saved delivery updates need attention" })).toHaveCount(0);
  await expect(page.getByText(/discarded after confirmation/i)).toBeVisible();
});

test("partial, future-schema, and cross-driver queues never sync or overwrite original storage", async ({ page }) => {
  let eventRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/driver/events")) eventRequests += 1;
  });
  const partialRaw = JSON.stringify([validEvent, { ...validEvent, clientEventId: "invalid" }]);
  await openOriginAndStore(page, partialRaw);

  await expect(page.getByText("1 of 2 saved items passed validation.")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(partialRaw);
  expect(eventRequests).toBe(0);

  const futureRaw = JSON.stringify({
    schema: "axora.driver-offline-events",
    version: 99,
    driverId: driver.id,
    events: [validEvent],
  });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: futureRaw,
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Saved delivery updates need attention" })).toBeVisible();
  await expect(page.getByText("The saved data could not be read.")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(futureRaw);
  expect(eventRequests).toBe(0);

  const crossDriverRaw = JSON.stringify({
    schema: "axora.driver-offline-events",
    version: 1,
    driverId: "99999999-9999-4999-8999-999999999999",
    events: [validEvent],
  });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: crossDriverRaw,
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Saved delivery updates need attention" })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(crossDriverRaw);
  expect(eventRequests).toBe(0);
});

test("a valid scoped queue survives page loading and a failed server retry byte-for-byte", async ({ page }) => {
  await page.route("**/api/driver/events", async (route) => route.abort("connectionfailed"));
  const raw = JSON.stringify({
    schema: "axora.driver-offline-events",
    version: 1,
    driverId: driver.id,
    events: [validEvent],
  });
  await openOriginAndStore(page, raw);

  await expect(page.getByText("1 saved update is waiting")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved delivery updates need attention" })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(raw);
});
