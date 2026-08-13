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
const roleAssignmentId = "30000000-0000-4000-8000-000000000001";

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

test("owner assignment captures workload, destination time, proof policy and expected version", async ({ page }) => {
  let command: Record<string, unknown> | null = null;
  const workspace = {
    capturedAt: "2026-08-09T01:00:00Z",
    agents: [{ userId: driver.id, roleAssignmentId, name: "Assigned agent", email: driver.email, activeJobs: 2, overdueJobs: 1 }],
    requests: [{ id: "60000000-0000-4000-8000-000000000001", number: "REQ-MEETING-001", companyName: "Meeting company", branchName: "Kuala Lumpur", branchTimezone: "Asia/Kuala_Lumpur", neededByDate: "2026-08-10" }],
    jobs: [{ id: jobId, code: "DEL-MEETING-001", status: "AWAITING_ASSIGNMENT", workflowVersion: 4, requestNumber: "REQ-MEETING-001", companyName: "Meeting company", branchName: "Kuala Lumpur", destinationTimezone: "Asia/Kuala_Lumpur", scheduledWindowStart: "2026-08-09T02:00:00Z", scheduledWindowEnd: "2026-08-09T04:00:00Z", scheduledLocalStart: "2026-08-09T10:00:00", scheduledLocalEnd: "2026-08-09T12:00:00", scheduledLocalDate: "2026-08-09", acceptanceDeadline: "2026-08-09T02:30:00Z", slaDueAt: "2026-08-09T04:00:00Z", proofPolicy: ["PHOTO"], proofSatisfied: false, assignment: null, history: [] }],
  };
  await page.route("**/api/deliveries/workspace", async (route) => route.fulfill({ json: workspace }));
  await page.route("**/api/deliveries/commands", async (route) => {
    command = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "ASSIGNED", workflowVersion: 5 } });
  });
  await signInAsDemoOwner(page);
  await page.goto("/deliveries");

  await expect(page.getByRole("heading", { level: 1, name: "Delivery control tower" })).toBeVisible();
  await expect(page.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("Asia/Kuala_Lumpur").last()).toBeVisible();
  const assignment = page.locator("details").filter({ hasText: "Assign or reassign" }).first();
  await assignment.getByLabel("Agent").selectOption(roleAssignmentId);
  await assignment.getByLabel("Reason or note").fill("Meeting route workload assignment");
  await assignment.getByRole("button", { name: "Assign or reassign" }).click();
  await expect.poll(() => command).not.toBeNull();
  expect(command).toMatchObject({
    action: "ASSIGN", jobId, driverRoleAssignmentId: roleAssignmentId,
    expectedVersion: 4, destinationTimezone: "Asia/Kuala_Lumpur",
    proofPolicy: ["PHOTO"],
  });
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
