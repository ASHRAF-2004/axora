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

test("Arabic mobile Delivery Agent retains a versioned command offline with reduced motion", async ({ page, context }, testInfo) => {
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

test("an older recipient-bearing offline queue is quarantined without replay or disclosure", async ({ page }) => {
  let workflowPosts = 0;
  const privateRecipient = "PRIVATE LEGACY RECEIVER";
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [{
      id: jobId, code: "DEL-LEGACY-PRIVATE-001", status: "ITEMS_ACQUIRED", workflowVersion: 7,
      assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
      requestNumber: "REQ-LEGACY-PRIVATE-001", branchName: "Controlled branch",
      companyName: "Controlled company", destinationTimezone: "Asia/Kuala_Lumpur",
      proofPolicy: ["PHOTO"], proofSatisfied: false, address: "Controlled destination",
      lines: [{
        id: "70000000-0000-4000-8000-000000000001",
        requestLineId: "80000000-0000-4000-8000-000000000001",
        productId: "40000000-0000-4000-8000-000000000001",
        productName: "Safety gloves", quantity: 2, unitOfMeasure: "box",
      }],
      events: [], evidence: [],
      actualHistory: [{ id: "90000000-0000-4000-8000-000000000001", state: "FINALIZED" }],
    }],
  } }));
  await page.route("**/api/driver/workflow", async (route) => {
    workflowPosts += 1;
    await route.fulfill({ status: 409, json: { error: "must not replay" } });
  });
  await page.route("**/api/driver/tracking", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", sessions: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/api/health/live");
  const key = `axora:delivery-commands:v2:${driver.id}`;
  await page.evaluate(({ storageKey, recipient }) => {
    localStorage.setItem(storageKey, JSON.stringify([{
      version: 2,
      queuedAt: "2026-08-09T01:00:00Z",
      submissionState: "READY",
      payload: {
        jobId: "10000000-0000-4000-8000-000000000001",
        assignmentId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 7,
        commandId: "30000000-0000-4000-8000-000000000001",
        deviceId: "40000000-0000-4000-8000-000000000001",
        deviceSequence: 1,
        eventType: "DELIVERED",
        clientRecordedAt: "2026-08-09T01:00:00Z",
        metadata: { receiverName: recipient },
      },
    }]));
  }, { storageKey: key, recipient: privateRecipient });
  await page.goto("/driver");

  await expect(page.getByText(
    "The offline queue could not be read. Export it before clearing local data.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText(privateRecipient)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Out for delivery", exact: true }))
    .toBeDisabled();
  expect(workflowPosts).toBe(0);
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toContain(privateRecipient);

  await page.getByRole("button", { name: "Discard local copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm discard", exact: true }))
    .toBeVisible();
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toContain(privateRecipient);
  await page.getByRole("button", { name: "Confirm discard", exact: true }).click();
  await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toBeNull();
  expect(workflowPosts).toBe(0);
});

test("a lost workflow response is reconciled without replaying the mutation", async ({ page }) => {
  let workflowPosts = 0;
  let commandReady = false;
  let committed = false;
  const job = {
    id: jobId, code: "DEL-RECONCILE-001", status: "ITEMS_ACQUIRED", workflowVersion: 7,
    assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
    requestNumber: "REQ-RECONCILE-001", branchName: "Controlled branch",
    companyName: "Controlled company", destinationTimezone: "Asia/Kuala_Lumpur",
    proofPolicy: ["PHOTO"], proofSatisfied: false, address: "Controlled destination",
    lines: [{ id: "70000000-0000-4000-8000-000000000001", requestLineId: "80000000-0000-4000-8000-000000000001", productId: "40000000-0000-4000-8000-000000000001", productName: "Safety gloves", quantity: 2, unitOfMeasure: "box" }],
    events: [], evidence: [], actualHistory: [{ id: "90000000-0000-4000-8000-000000000001", state: "FINALIZED" }],
  };
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [{ ...job, status: committed ? "OUT_FOR_DELIVERY" : job.status,
      workflowVersion: committed ? 8 : job.workflowVersion }],
  } }));
  await page.route("**/api/driver/workflow", async (route) => {
    workflowPosts += 1;
    committed = true;
    await route.abort("connectionfailed");
  });
  await page.route("**/api/driver/command-result?*", (route) => (
    commandReady
      ? route.fulfill({ json: { jobId, status: "OUT_FOR_DELIVERY", workflowVersion: 8 } })
      : route.fulfill({ status: 409, json: { error: "controlled read failure" } })
  ));
  await page.route("**/api/driver/tracking", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", sessions: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");

  await page.getByRole("button", { name: "Out for delivery", exact: true }).click();
  await expect(page.getByText(/command outcome is still being checked/i)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key),
    `axora:delivery-commands:v2:${driver.id}`)).toContain('"submissionState":"UNCERTAIN"');
  expect(workflowPosts).toBe(1);

  commandReady = true;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "DEL-RECONCILE-001" })
    .locator("span").filter({ hasText: /^Out for delivery$/ })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key),
    `axora:delivery-commands:v2:${driver.id}`)).toBeNull();
  expect(workflowPosts).toBe(1);
});

test("a generic workflow conflict is reconciled before being classified as failure", async ({ page }) => {
  let workflowPosts = 0;
  let committed = false;
  const job = {
    id: jobId, code: "DEL-COMMIT-ACK-001", status: "ITEMS_ACQUIRED", workflowVersion: 7,
    assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
    requestNumber: "REQ-COMMIT-ACK-001", branchName: "Controlled branch",
    companyName: "Controlled company", destinationTimezone: "Asia/Kuala_Lumpur",
    proofPolicy: ["PHOTO"], proofSatisfied: false, address: "Controlled destination",
    lines: [{
      id: "70000000-0000-4000-8000-000000000001",
      requestLineId: "80000000-0000-4000-8000-000000000001",
      productId: "40000000-0000-4000-8000-000000000001",
      productName: "Safety gloves", quantity: 2, unitOfMeasure: "box",
    }],
    events: [], evidence: [],
    actualHistory: [{ id: "90000000-0000-4000-8000-000000000001", state: "FINALIZED" }],
  };
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", jobs: [{
      ...job,
      status: committed ? "OUT_FOR_DELIVERY" : job.status,
      workflowVersion: committed ? 8 : job.workflowVersion,
    }],
  } }));
  await page.route("**/api/driver/workflow", async (route) => {
    workflowPosts += 1;
    committed = true;
    await route.fulfill({ status: 409, json: { error: "Delivery event unavailable" } });
  });
  await page.route("**/api/driver/command-result?*", (route) => route.fulfill({ json: {
    jobId, status: "OUT_FOR_DELIVERY", workflowVersion: 8,
  } }));
  await page.route("**/api/driver/tracking", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", sessions: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");

  await page.getByRole("button", { name: "Out for delivery", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "DEL-COMMIT-ACK-001" })
    .locator("span").filter({ hasText: /^Out for delivery$/ })).toBeVisible();
  await expect(page.getByText(/conflicted with current server state/i)).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key),
    `axora:delivery-commands:v2:${driver.id}`)).toBeNull();
  expect(workflowPosts).toBe(1);
});

test("an uncertain recipient-bearing command survives reload without storing recipient data", async ({ page }) => {
  let workflowPosts = 0;
  let commandReady = false;
  let committed = false;
  const recipientName = "SYNTHETIC PRIVATE RECEIVER";
  const arrivedEventId = "30000000-0000-4000-8000-000000000001";
  const job = {
    id: jobId, code: "DEL-PRIVATE-RECONCILE-001", status: "ARRIVED", workflowVersion: 7,
    assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
    requestNumber: "REQ-PRIVATE-RECONCILE-001", branchName: "Controlled branch",
    companyName: "Controlled company", destinationTimezone: "Asia/Kuala_Lumpur",
    proofPolicy: ["PHOTO"], proofSatisfied: true, address: "Controlled destination",
    lines: [{ id: "70000000-0000-4000-8000-000000000001", requestLineId: "80000000-0000-4000-8000-000000000001", productId: "40000000-0000-4000-8000-000000000001", productName: "Safety gloves", quantity: 2, unitOfMeasure: "box" }],
    events: [{ id: arrivedEventId, type: "ARRIVED", receivedAt: "2026-08-09T01:00:00Z" }],
    evidence: [{ id: "90000000-0000-4000-8000-000000000001", type: "PHOTO", fileName: "test-proof.png", version: 1 }],
    actualHistory: [{ id: "90000000-0000-4000-8000-000000000002", state: "FINALIZED" }],
  };
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [{ ...job, status: committed ? "DELIVERED" : job.status,
      workflowVersion: committed ? 8 : job.workflowVersion }],
  } }));
  await page.route("**/api/driver/workflow", async (route) => {
    workflowPosts += 1;
    committed = true;
    await route.abort("connectionfailed");
  });
  await page.route("**/api/driver/command-result?*", (route) => (
    commandReady
      ? route.fulfill({ json: { jobId, status: "DELIVERED", workflowVersion: 8 } })
      : route.fulfill({ status: 404, json: { error: "not committed yet" } })
  ));
  await page.route("**/api/driver/tracking", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", sessions: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");

  await page.locator("article").filter({ hasText: "DEL-PRIVATE-RECONCILE-001" })
    .locator("textarea").fill(recipientName);
  await page.getByRole("button", { name: "Delivered", exact: true }).click();
  await expect(page.getByText(/command outcome is still being checked/i)).toBeVisible({ timeout: 15_000 });
  const reconciliationKey = `axora:delivery-reconciliation:v1:${driver.id}`;
  const saved = await page.evaluate((key) => localStorage.getItem(key), reconciliationKey);
  expect(saved).toContain('"kind":"EVENT"');
  expect(saved).not.toContain(recipientName);
  expect(saved).not.toContain("receiverName");
  expect(workflowPosts).toBe(1);

  await page.reload();
  await expect(page.getByRole("button", { name: "Complete job", exact: true })).toBeDisabled();
  commandReady = true;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), reconciliationKey))
    .toBeNull();
  await expect(page.getByRole("button", { name: "Complete job", exact: true })).toBeEnabled();
  expect(workflowPosts).toBe(1);
});

test("confirmed proof remains guarded until its workspace refresh succeeds", async ({ page }) => {
  const evidenceCommandId = "30000000-0000-4000-8000-000000000002";
  const arrivedEventId = "30000000-0000-4000-8000-000000000003";
  let workspaceAvailable = true;
  let proofVisible = false;
  const job = {
    id: jobId, code: "DEL-PROOF-REFRESH-001", status: "ARRIVED", workflowVersion: 7,
    assignmentId, requestId: "60000000-0000-4000-8000-000000000001",
    requestNumber: "REQ-PROOF-REFRESH-001", branchName: "Controlled branch",
    companyName: "Controlled company", destinationTimezone: "Asia/Kuala_Lumpur",
    proofPolicy: ["PHOTO"], address: "Controlled destination",
    lines: [{
      id: "70000000-0000-4000-8000-000000000001",
      requestLineId: "80000000-0000-4000-8000-000000000001",
      productId: "40000000-0000-4000-8000-000000000001",
      productName: "Safety gloves", quantity: 2, unitOfMeasure: "box",
    }],
    events: [{ id: arrivedEventId, type: "ARRIVED", receivedAt: "2026-08-09T01:00:00Z" }],
    actualHistory: [{ id: "90000000-0000-4000-8000-000000000001", state: "FINALIZED" }],
  };
  await page.route("**/api/driver/workspace", (route) => {
    if (!workspaceAvailable) {
      return route.fulfill({ status: 503, json: { error: "controlled refresh failure" } });
    }
    return route.fulfill({ json: {
      actorId: driver.id,
      capturedAt: "2026-08-09T01:00:00Z",
      jobs: [{
        ...job,
        proofSatisfied: proofVisible,
        evidence: proofVisible ? [{
          id: "90000000-0000-4000-8000-000000000002",
          type: "PHOTO", fileName: "controlled-proof.png", version: 1,
        }] : [],
      }],
    } });
  });
  await page.route("**/api/driver/command-result?*", (route) => route.fulfill({ json: {
    evidenceId: "90000000-0000-4000-8000-000000000002",
    version: 1, validationStatus: "ACCEPTED", created: false,
  } }));
  await page.route("**/api/driver/tracking", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", sessions: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/api/health/live");
  const key = `axora:delivery-reconciliation:v1:${driver.id}`;
  await page.evaluate(({ storageKey, commandId, deliveryJobId }) => {
    localStorage.setItem(storageKey, JSON.stringify([{
      version: 1,
      kind: "EVIDENCE",
      jobId: deliveryJobId,
      commandId,
      recordedAt: "2026-08-09T01:00:00Z",
    }]));
  }, { storageKey: key, commandId: evidenceCommandId, deliveryJobId: jobId });
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "DEL-PROOF-REFRESH-001" }))
    .toBeVisible();

  workspaceAvailable = false;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Command recorded. Refreshing delivery workspace…", {
    exact: true,
  })).toBeVisible();
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toContain(evidenceCommandId);
  await page.locator("summary").filter({ hasText: /^Upload proof$/ }).click();
  await expect(page.getByRole("button", { name: "Upload proof", exact: true }))
    .toBeDisabled();

  workspaceAvailable = true;
  proofVisible = true;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toBeNull();
  await expect(page.getByText("Required proof is ready", { exact: false })).toBeVisible();
});

test("owner manages Delivery Agents without normal assignment or budget controls", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/deliveries");
  await expect(page.getByRole("heading", { level: 1, name: "Manage Delivery Agents" })).toBeVisible();
  await expect(page.getByText(/assign or reassign/i)).toHaveCount(0);
  await expect(page.getByText(/monthly budget/i)).toHaveCount(0);
});

test("Delivery Agent claims exactly one paid available job through the self-claim path", async ({ page }) => {
  let jobs = [{ id: jobId, code: "DEL-MEETING-001", requestReference: "REQ-MEETING-001", companyName: "Meeting company", branchName: "Kuala Lumpur", area: "Kuala Lumpur", destinationTimezone: "Asia/Kuala_Lumpur", lineCount: 2, status: "AVAILABLE" }];
  let postCount = 0;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") { postCount += 1; jobs = []; return route.fulfill({ json: { assignmentId, jobId, status: "ASSIGNED", created: true } }); }
    return route.fulfill({ json: { sequence: 1 + postCount, capturedAt: "2026-08-09T01:00:00Z", availability: "AVAILABLE", jobs } });
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

test("a committed claim remains successful when the post-claim workspace refresh fails", async ({ page }) => {
  let claimed = false;
  let postCount = 0;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      claimed = true;
      await route.fulfill({ json: {
        assignmentId,
        jobId,
        status: "ASSIGNED",
        created: true,
      } });
      return;
    }
    if (claimed) {
      await route.fulfill({ status: 503, json: { error: "controlled refresh failure" } });
      return;
    }
    await route.fulfill({ json: {
      sequence: 1,
      capturedAt: "2026-08-09T01:00:00Z",
      availability: "AVAILABLE",
      jobs: [{
        id: jobId,
        code: "DEL-MEETING-001",
        requestReference: "REQ-MEETING-001",
        companyName: "Meeting company",
        branchName: "Kuala Lumpur",
        area: "Kuala Lumpur",
        destinationTimezone: "Asia/Kuala_Lumpur",
        lineCount: 1,
        status: "AVAILABLE",
      }],
    } });
  });
  await page.route("**/api/driver/jobs/live", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: "retry: 60000\n\n",
  }));
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [],
  } }));

  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");
  await page.getByRole("button", { name: "Claim", exact: true }).click();

  await expect(page.getByText("Claim succeeded. Refreshing delivery workspace…"))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true }))
    .toHaveCount(0);
  await expect(page.getByText(/claim failed|already claimed/i)).toHaveCount(0);
  expect(postCount).toBe(1);
});

test("a lost claim response reconciles through the read-only command result", async ({ page }) => {
  let postCount = 0;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({ json: {
      sequence: 1,
      capturedAt: "2026-08-09T01:00:00Z",
      availability: "AVAILABLE",
      jobs: [{
        id: jobId,
        code: "DEL-MEETING-001",
        requestReference: "REQ-MEETING-001",
        companyName: "Meeting company",
        branchName: "Kuala Lumpur",
        area: "Kuala Lumpur",
        destinationTimezone: "Asia/Kuala_Lumpur",
        lineCount: 1,
        status: "AVAILABLE",
      }],
    } });
  });
  await page.route("**/api/driver/jobs/claim-result?*", (route) => route.fulfill({ json: {
    assignmentId,
    jobId,
    status: "ASSIGNED",
    created: false,
  } }));
  await page.route("**/api/driver/jobs/live", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: "retry: 60000\n\n",
  }));
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [],
  } }));

  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");
  await page.getByRole("button", { name: "Claim", exact: true }).click();

  await expect(page.getByText("Claim succeeded.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true }))
    .toHaveCount(0);
  expect(postCount).toBe(1);
});

test("an uncertain claim remains hidden across reload until its exact result is found", async ({ page }) => {
  let postCount = 0;
  let commandReady = false;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({ json: {
      sequence: 1,
      capturedAt: "2026-08-09T01:00:00Z",
      availability: "AVAILABLE",
      jobs: [{
        id: jobId, code: "DEL-RELOAD-CLAIM-001", requestReference: "REQ-RELOAD-CLAIM-001",
        companyName: "Controlled company", branchName: "Controlled branch",
        area: "Kuala Lumpur", destinationTimezone: "Asia/Kuala_Lumpur",
        lineCount: 1, status: "AVAILABLE",
      }],
    } });
  });
  await page.route("**/api/driver/jobs/claim-result?*", (route) => (
    commandReady
      ? route.fulfill({ json: { assignmentId, jobId, status: "ASSIGNED", created: false } })
      : route.fulfill({ status: 404, json: { error: "not committed yet" } })
  ));
  await page.route("**/api/driver/jobs/live", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: "retry: 60000\n\n",
  }));
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", jobs: [],
  } }));
  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");

  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(page.getByText(/Checking the authoritative claim result/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  const pendingKey = `axora:delivery-claim:v1:${driver.id}`;
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey))
    .not.toBeNull();

  commandReady = true;
  await page.reload();
  await expect(page.getByText("Claim succeeded.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey))
    .toBeNull();
  expect(postCount).toBe(1);
});

test("a committed claim with a truncated success body is reconciled as success", async ({ page }) => {
  let postCount = 0;
  await page.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{\"assignmentId\":",
      });
      return;
    }
    await route.fulfill({ json: {
      sequence: 1,
      capturedAt: "2026-08-09T01:00:00Z",
      availability: "AVAILABLE",
      jobs: [{
        id: jobId, code: "DEL-TRUNCATED-001", requestReference: "REQ-TRUNCATED-001",
        companyName: "Controlled company", branchName: "Controlled branch",
        area: "Kuala Lumpur", destinationTimezone: "Asia/Kuala_Lumpur",
        lineCount: 1, status: "AVAILABLE",
      }],
    } });
  });
  await page.route("**/api/driver/jobs/claim-result?*", (route) => route.fulfill({ json: {
    assignmentId, jobId, status: "ASSIGNED", created: false,
  } }));
  await page.route("**/api/driver/jobs/live", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: "retry: 60000\n\n",
  }));
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id, capturedAt: "2026-08-09T01:00:00Z", jobs: [],
  } }));

  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  await page.goto("/driver");
  await page.getByRole("button", { name: "Claim", exact: true }).click();

  await expect(page.getByText("Claim succeeded.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  expect(postCount).toBe(1);
});

test("two tabs coordinate one claim and remove the stale action from both", async ({ page, context }) => {
  let claimed = false;
  let postCount = 0;
  await context.route(/\/api\/driver\/jobs$/, async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      if (claimed) {
        await route.fulfill({ status: 409, json: { error: "This job was already claimed." } });
      } else {
        claimed = true;
        await route.fulfill({ json: { assignmentId, jobId, status: "ASSIGNED", created: true } });
      }
      return;
    }
    await route.fulfill({ json: {
      sequence: postCount + 1,
      capturedAt: "2026-08-09T01:00:00Z",
      availability: "AVAILABLE",
      jobs: claimed ? [] : [{
        id: jobId,
        code: "DEL-TWO-TABS-001",
        requestReference: "REQ-TWO-TABS-001",
        companyName: "Controlled company",
        branchName: "Controlled branch",
        area: "Kuala Lumpur",
        destinationTimezone: "Asia/Kuala_Lumpur",
        lineCount: 1,
        status: "AVAILABLE",
      }],
    } });
  });
  await context.route("**/api/driver/jobs/live", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: "retry: 60000\n\n",
  }));
  await context.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T01:00:00Z",
    jobs: [],
  } }));

  await signInAsDemoRole(page, { ...driver, preferredLocale: "en" });
  const second = await context.newPage();
  await Promise.all([page.goto("/driver"), second.goto("/driver")]);
  await page.getByRole("button", { name: "Claim", exact: true }).click();

  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByText(
    "Claim succeeded.", { exact: true },
  ).isVisible()) + Number(await second.getByText(
    "Claim succeeded.", { exact: true },
  ).isVisible())).toBe(1);
  await expect(page.getByText("This job was already claimed.", { exact: true }))
    .toHaveCount(0);
  await expect(second.getByText("This job was already claimed.", { exact: true }))
    .toHaveCount(0);
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
  const completedStatus = executionJob.locator("span").filter({ hasText: /^Completed$/ });
  // The full gate runs desktop and mobile against one demo server. If desktop
  // has already completed the single logical fixture, mobile verifies the
  // authoritative terminal state instead of replaying a terminal mutation.
  if (await completedStatus.isVisible()) {
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(2);
    await page.reload();
    await expect(completedStatus).toBeVisible();
    return;
  }
  await page.reload();
  await expect(executionHeading).toBeVisible();

  for (const action of ["Accept assignment", "Start buying"]) {
    const button = executionJob.getByRole("button", { name: action, exact: true });
    if (await button.isVisible()) {
      await button.click();
      await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
      await page.reload();
      await expect(executionHeading).toBeVisible();
    }
  }
  await executionJob.locator('input[name="receipt"]').setInputFiles({
    name: "controlled-acquisition.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await executionJob.getByLabel("Internal acquisition unit cost").fill("10.00");
  await executionJob.getByRole("button", { name: "Record acquisition", exact: true }).click();
  const outForDelivery = executionJob.getByRole("button", { name: "Out for delivery", exact: true });
  await expect(outForDelivery).toBeVisible();
  await page.reload();
  await expect(outForDelivery).toBeVisible();
  await outForDelivery.click();
  await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
  await page.reload();

  await expect(executionJob.locator("span").filter({ hasText: /^Out for delivery$/ }))
    .toBeVisible();
  await page.goto("/profile");
  await page.goBack();
  await expect(executionJob.locator("span").filter({ hasText: /^Out for delivery$/ }))
    .toBeVisible();
  await page.goForward();
  await page.goBack();
  await expect(executionJob.locator("span").filter({ hasText: /^Out for delivery$/ }))
    .toBeVisible();
  const tracking = page.getByRole("region", { name: "Location sharing" });
  const waze = tracking.getByRole("link", { name: "Navigate with Waze" });
  const google = tracking.getByRole("link", { name: "Navigate with Google Maps" });
  await expect(waze).toHaveAttribute("href", /ll=3\.1516%2C101\.7113/);
  await expect(google).toHaveAttribute("href", /destination=3\.1516%2C101\.7113/);
  await executionJob.getByRole("button", { name: "Arrived", exact: true }).click();
  await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
  await page.reload();
  await expect(executionJob.locator("span").filter({ hasText: /^Arrived$/ }))
    .toBeVisible();
  await executionJob.getByLabel("Recipient identity").first().fill("AXORA TEST RECEIVER");
  await executionJob.locator("summary").filter({ hasText: /^Upload proof$/ }).click();
  await executionJob.locator('input[name="file"]').setInputFiles({
    name: "controlled-proof.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await executionJob.locator('input[name="recipientIdentity"]').fill("AXORA TEST RECEIVER");
  await executionJob.getByRole("button", { name: "Upload proof", exact: true }).click();
  await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
  await page.reload();
  await executionJob.getByLabel("Recipient identity").first().fill("AXORA TEST RECEIVER");
  await expect(executionJob.getByRole("button", { name: "Delivered", exact: true }))
    .toBeEnabled();
  await executionJob.getByRole("button", { name: "Delivered", exact: true }).click();
  await expect(page.getByText("Command recorded", { exact: true })).toBeVisible();
  await page.reload();
  await expect(executionJob.locator("span").filter({ hasText: /^Delivered$/ }))
    .toBeVisible();
  await executionJob.getByRole("button", { name: "Complete job", exact: true }).click();
  await expect(executionJob.locator("span").filter({ hasText: /^Completed$/ })).toBeVisible();
  await page.reload();
  await expect(executionJob.locator("span").filter({ hasText: /^Completed$/ })).toBeVisible();
  const localCommands = await page.evaluate((key) => localStorage.getItem(key),
    `axora:delivery-commands:v2:${driver.id}`);
  expect(localCommands ?? "").not.toContain("AXORA TEST RECEIVER");
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
