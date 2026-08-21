import { expect, test } from "@playwright/test";
import { signInAsDemoOwner, signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const driver: DemoRoleSession = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "canonical-driver.fixture@axora.invalid",
  name: "Canonical driver fixture",
  role: "DELIVERY_GUY",
  accountKind: "DELIVERY",
  scopeType: "DELIVERY",
  preferredLocale: "ar",
};

const receiver: DemoRoleSession = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "delivery-receiver.fixture@axora.invalid",
  name: "Delivery receiver fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "66666666-6666-4666-8666-666666666666",
};

const jobId = "10000000-0000-4000-8000-000000000001";
const assignmentId = "20000000-0000-4000-8000-000000000001";

test("Arabic mobile Delivery Guy retains a versioned command offline with reduced motion", async ({ page, context }, testInfo) => {
  await page.route("**/api/driver/workspace", async (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [{
      id: jobId, code: "DEL-MEETING-001", status: "ITEMS_ACQUIRED", workflowVersion: 7,
      assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
      requestNumber: "REQ-MEETING-001", branchName: "Kuala Lumpur",
      destinationTimezone: "Asia/Kuala_Lumpur",
      scheduledLocalStart: "2026-08-09T10:00:00", scheduledLocalEnd: "2026-08-09T12:00:00",
      acceptanceDeadline: "2026-08-09T01:30:00Z", slaDueAt: "2026-08-09T04:00:00Z",
      proofPolicy: ["PHOTO"], proofSatisfied: false, address: "Meeting branch",
      lines: [{ id: "70000000-0000-4000-8000-000000000001", requestLineId: "80000000-0000-4000-8000-000000000001", productId: "40000000-0000-4000-8000-000000000001", productName: "Safety gloves", quantity: 2, unitOfMeasure: "box" }],
      events: [], evidence: [], actualHistory: [{ id: "90000000-0000-4000-8000-000000000001", state: "FINALIZED" }],
    }],
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, driver);
  await page.goto("/driver");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "DEL-MEETING-001" })).toBeVisible();
  await expect(page.getByText("Asia/Kuala_Lumpur").last()).toBeVisible();
  const card = page.locator("article").filter({ hasText: "DEL-MEETING-001" });
  expect(await card.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `output/playwright/delivery-guy-${testInfo.project.name}.png`, fullPage: true });

  await context.setOffline(true);
  await page.getByRole("button", { name: "خرج للتسليم" }).click();
  const queued = await page.evaluate((key) => localStorage.getItem(key), `axora:delivery-commands:v2:${driver.id}`);
  expect(queued).toContain('"expectedVersion":7');
  expect(queued).toContain('"commandId"');
});

test("owner manages drivers without normal assignment or budget controls", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/deliveries");
  await expect(page.getByRole("heading", { level: 1, name: "Manage Drivers" })).toBeVisible();
  await expect(page.getByText(/assign or reassign/i)).toHaveCount(0);
  await expect(page.getByText(/monthly budget/i)).toHaveCount(0);
});

test("Delivery Guy claims exactly one paid available job through the self-claim path", async ({ page }) => {
  let jobs = [{ id: jobId, code: "DEL-MEETING-001", requestReference: "REQ-MEETING-001", companyName: "Meeting company", branchName: "Kuala Lumpur", area: "Kuala Lumpur", destinationTimezone: "Asia/Kuala_Lumpur", lineCount: 2, status: "AVAILABLE" }];
  let postCount = 0;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") { postCount += 1; jobs = []; return route.fulfill({ json: { assignmentId, jobId, status: "ASSIGNED", created: true } }); }
    return route.fulfill({ json: { sequence: 1 + postCount, capturedAt: "2026-08-09T01:00:00Z", jobs } });
  });
  await page.route("**/api/driver/jobs/live", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: "retry: 60000\n\n" }));
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: { actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", jobs: [] } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "Available delivery jobs" })).toBeVisible();
  await expect(page.getByText("DEL-MEETING-001")).toBeVisible();
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("No paid jobs are available.")).toBeVisible();
  expect(postCount).toBe(1);
});

test("a real demo self-claim becomes the driver's Out for Delivery navigation job", async ({ page }) => {
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");

  const executionJob = page.locator("article").filter({ hasText: "DEL-DEMO-AVAILABLE-001" });
  const executionHeading = executionJob.getByRole("heading", { name: "DEL-DEMO-AVAILABLE-001" });
  const claim = page.getByRole("button", { name: "Claim", exact: true });
  await expect(claim.or(executionHeading)).toBeVisible();
  if (await claim.isVisible()) await claim.click();

  await expect(executionHeading).toBeVisible();

  for (const action of ["Accept assignment", "Start buying", "Items bought", "Out for delivery"]) {
    const button = executionJob.getByRole("button", { name: action, exact: true });
    if (await button.isVisible()) {
      await button.click();
      await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
    }
  }

  await expect(executionJob.locator("span").filter({ hasText: /^Out for delivery$/ }))
    .toBeVisible();
  const waze = executionJob.getByRole("link", { name: "Navigate with Waze" });
  const google = executionJob.getByRole("link", { name: "Navigate with Google Maps" });
  await expect(waze).toHaveAttribute("href", /ll=3\.1516%2C101\.7113/);
  await expect(google).toHaveAttribute("href", /destination=3\.1516%2C101\.7113/);
});

test("customer recipient sees a one-time OTP without purchasing internals", async ({ page }) => {
  await page.route("**/api/receiving/delivery-otp", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: {
        challengeId: "a0000000-0000-4000-8000-000000000001",
        expiresAt: "2026-08-09T01:10:00Z", recipientIdentity: receiver.name,
        code: "004271",
      } });
      return;
    }
    await route.fulfill({ json: { capturedAt: "2026-08-09T01:00:00Z", jobs: [{
      id: jobId, code: "DEL-MEETING-001", status: "ARRIVED",
      requestNumber: "REQ-MEETING-001", branchName: "Kuala Lumpur",
      destinationTimezone: "Asia/Kuala_Lumpur",
      scheduledLocalStart: "2026-08-09T10:00:00", proofPolicy: ["PHOTO", "OTP"],
    }] } });
  });
  await signInAsDemoRole(page, receiver);
  await page.goto("/receiving");

  await expect(page.getByRole("region", { name: "Secure delivery confirmation" })).toBeVisible();
  await expect(page.getByText(/buying cost/i)).toHaveCount(0);
  await expect(page.getByText(/internal cost/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Generate one-time code" }).click();
  await expect(page.getByText("004271", { exact: true })).toBeVisible();
  await expect(page.getByText(/never stored in plaintext/i)).toBeVisible();
});
