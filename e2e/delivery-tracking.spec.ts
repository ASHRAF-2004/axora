import { expect, test } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const driver: DemoRoleSession = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "tracking-driver.fixture@axora.invalid",
  name: "Tracking Delivery Guy fixture",
  role: "DELIVERY_GUY",
  accountKind: "DELIVERY",
  scopeType: "DELIVERY",
};

const receiver: DemoRoleSession = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "tracking-receiver.fixture@axora.invalid",
  name: "Tracking receiver fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "66666666-6666-4666-8666-666666666666",
};

const sessionId = "10000000-0000-4000-8000-000000000068";
const jobId = "20000000-0000-4000-8000-000000000068";

test("assigned Delivery Guy shares only the active delivery location and sees the privacy indicator", async ({ page, context }) => {
  const points: Record<string, unknown>[] = [];
  await context.grantPermissions(["geolocation"], {
    origin: "http://127.0.0.1:3100",
  });
  await context.setGeolocation({ latitude: 3.139, longitude: 101.6869, accuracy: 12 });
  await page.route("**/api/driver/workspace", async (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T04:00:00Z",
    jobs: [{
      id: jobId,
      code: "DEL-LIVE-068",
      status: "OUT_FOR_DELIVERY",
      workflowVersion: 9,
      assignmentId: "30000000-0000-4000-8000-000000000068",
      requestId: "40000000-0000-4000-8000-000000000068",
      requestNumber: "REQ-LIVE-068",
      branchName: "Kuala Lumpur",
      destinationTimezone: "Asia/Kuala_Lumpur",
      proofPolicy: ["PHOTO"],
      proofSatisfied: false,
      address: "Tracking destination",
      lines: [],
      events: [],
      evidence: [],
      actualHistory: [],
    }],
  } }));
  await page.route("**/api/driver/tracking", async (route) => {
    if (route.request().method() === "POST") {
      points.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { accepted: true } });
      return;
    }
    await route.fulfill({ json: {
      actorId: driver.id,
      capturedAt: "2026-08-09T04:00:00Z",
      sessions: [{
        sessionId,
        jobId,
        jobCode: "DEL-LIVE-068",
        assignmentId: "30000000-0000-4000-8000-000000000068",
        jobStatus: "OUT_FOR_DELIVERY",
        status: "ACTIVE",
        visibilityPrecision: "APPROXIMATE",
        rawRetentionDays: 30,
        pointCount: 0,
      }],
    } });
  });
  await signInAsDemoRole(page, driver);
  await page.goto("/driver");

  await expect(page.getByText("Location sharing is active").first()).toBeVisible();
  await expect(page.getByText(/collected only for the active assigned delivery/i)).toBeVisible();
  await expect.poll(() => points.some((point) => point.action === "POINT")).toBe(true);
  const location = points.find((point) => point.action === "POINT");
  expect(location).toMatchObject({
    sessionId,
    latitude: 3.139,
    longitude: 101.6869,
  });
  await expect(page.getByText(/internal cost|buying cost/i)).toHaveCount(0);
});

test("company recipient sees active ETA, route, approved vehicle and no historical movement", async ({ page }) => {
  await page.route("**/api/receiving/delivery-otp", async (route) => route.fulfill({
    json: { capturedAt: "2026-08-09T04:00:00Z", jobs: [] },
  }));
  await page.route("**/api/receiving/delivery-tracking", async (route) => route.fulfill({ json: {
    capturedAt: "2026-08-09T04:00:00Z",
    sessions: [{
      sessionId,
      jobId,
      jobCode: "DEL-LIVE-068",
      branchName: "Kuala Lumpur",
      jobStatus: "OUT_FOR_DELIVERY",
      status: "ACTIVE",
      lastUpdatedAt: "2026-08-09T03:59:45Z",
      stale: false,
      latitude: 3.139,
      longitude: 101.687,
      accuracyMeters: 150,
      destinationLatitude: 3.141,
      destinationLongitude: 101.69,
      remainingMeters: 420,
      etaSeconds: 180,
      visibilityPrecision: "APPROXIMATE",
      rawRetentionDays: 30,
      agentUserId: driver.id,
      agentName: driver.name,
      contactMode: "AXORA_RELAY",
      contactPath: `/support?delivery=${jobId}`,
      vehicleType: "Van",
      vehicleColour: "White",
      vehicleRegistration: "AXR 204",
    }],
  } }));
  await signInAsDemoRole(page, receiver);
  await page.goto("/receiving");

  const board = page.getByRole("region", { name: "Your active delivery" });
  await expect(board).toBeVisible();
  await expect(board.getByRole("img", { name: "Privacy-safe route progress" })).toBeVisible();
  await expect(board.getByText("AXR 204")).toBeVisible();
  await expect(board.getByText(/in 3 minutes/i)).toBeVisible();
  await expect(board.getByText("Approximate location").first()).toBeVisible();
  await expect(board.getByText(/history|raw coordinates/i)).toHaveCount(0);
});

test("Arabic small-phone tracking marks stale data and disables ETA without motion", async ({ page }) => {
  const arabicReceiver = { ...receiver, preferredLocale: "ar" as const };
  await page.route("**/api/receiving/delivery-otp", async (route) => route.fulfill({
    json: { capturedAt: "2026-08-09T04:10:00Z", jobs: [] },
  }));
  await page.route("**/api/receiving/delivery-tracking", async (route) => route.fulfill({ json: {
    capturedAt: "2026-08-09T04:10:00Z",
    sessions: [{
      sessionId,
      jobId,
      jobCode: "DEL-LIVE-068",
      branchName: "كوالالمبور",
      jobStatus: "OUT_FOR_DELIVERY",
      status: "PAUSED",
      lastUpdatedAt: "2026-08-09T04:00:00Z",
      stale: true,
      latitude: 3.139,
      longitude: 101.687,
      destinationLatitude: 3.141,
      destinationLongitude: 101.69,
      remainingMeters: 420,
      etaSeconds: null,
      visibilityPrecision: "APPROXIMATE",
      rawRetentionDays: 30,
    }],
  } }));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, arabicReceiver);
  await page.goto("/receiving");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("الموقع قديم")).toBeVisible();
  await expect(page.getByText("وقت الوصول غير متاح")).toBeVisible();
  const card = page.locator("article").filter({ hasText: "DEL-LIVE-068" });
  expect(await card.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
