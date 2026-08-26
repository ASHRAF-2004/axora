import { expect, test } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const driver: DemoRoleSession = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "tracking-driver.fixture@axora.invalid",
  name: "Tracking Delivery Agent fixture",
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

test("assigned Delivery Agent buffers offline and completion preempts a stale resume response", async ({ page, context }) => {
  const points: Record<string, unknown>[] = [];
  const operations: string[] = [];
  let resumeResponses = 0;
  let releaseResumeResponse: (() => void) | undefined;
  const resumeResponsePending = new Promise<void>((resolve) => {
    releaseResumeResponse = resolve;
  });
  let trackingStatus = "ACTIVE";
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
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.action === "POINT") points.push(body);
      else if (typeof body.action === "string") {
        operations.push(body.action);
        if (body.action === "PAUSE") {
          trackingStatus = "PAUSED";
          await route.abort("connectionfailed");
          return;
        }
        if (body.action === "RESUME") {
          trackingStatus = "ACTIVE";
          await resumeResponsePending;
        }
      }
      await route.fulfill({ json: body.action === "POINT"
        ? { accepted: true }
        : { sessionId, status: trackingStatus } });
      if (body.action === "RESUME") resumeResponses += 1;
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
        status: trackingStatus,
        lastUpdatedAt: points.length ? "2026-08-09T04:00:15Z" : null,
        latitude: points.length ? 3.139 : null,
        longitude: points.length ? 101.6869 : null,
        locationAvailable: points.length > 0,
        accuracyMeters: points.length ? 12 : null,
        destinationLatitude: 3.141,
        destinationLongitude: 101.69,
        remainingMeters: points.length ? 420 : null,
        etaSeconds: points.length ? 180 : null,
        routeMode: "DIRECT_ESTIMATE",
        visibilityPrecision: "APPROXIMATE",
        rawRetentionDays: 30,
        pointCount: points.length,
      }],
    } });
  });
  await signInAsDemoRole(page, driver);
  await page.goto("/driver");

  await expect(page.getByText("Ready to share location").first()).toBeVisible();
  await expect(page.getByText(/collected only for the active assigned delivery/i)).toBeVisible();
  expect(points).toHaveLength(0);

  await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start location sharing" }).click();
  const queueKey = `axora:delivery-location:v1:${driver.id}`;
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), queueKey))
    .toContain('\"action\":\"POINT\"');
  expect(points).toHaveLength(0);

  await context.setOffline(false);
  await expect.poll(() => points.length).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), queueKey))
    .toBeNull();
  const location = points[0];
  expect(location).toMatchObject({
    sessionId,
    latitude: 3.139,
    longitude: 101.6869,
  });
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
  await expect(page.getByText(/Direct distance estimate — not a road route/)).toBeVisible();

  await page.getByRole("button", { name: "Pause sharing" }).click();
  await expect(page.getByRole("button", { name: "Resume sharing location" })).toBeVisible();
  await page.getByRole("button", { name: "Resume sharing location" }).click();
  await expect.poll(() => operations).toEqual(["PAUSE", "RESUME"]);
  await expect(page.getByRole("button", { name: /end tracking|end sharing/i }))
    .toHaveCount(0);
  await page.evaluate(({ key, actor, session, jobId: terminalJobId }) => {
    localStorage.setItem(key, JSON.stringify([{
      action: "POINT",
      sessionId: session,
      pointId: "50000000-0000-4000-8000-000000000068",
      deviceId: "60000000-0000-4000-8000-000000000068",
      deviceSequence: 99,
      latitude: 3.139,
      longitude: 101.6869,
      accuracyMeters: 12,
      speedMps: null,
      headingDegrees: null,
      recordedAt: "2026-08-09T04:01:00Z",
      actor,
    }]));
    window.dispatchEvent(new CustomEvent("axora:delivery-completion-pending", {
      detail: { jobId: terminalJobId },
    }));
  }, { key: queueKey, actor: driver.id, session: sessionId, jobId });
  await expect(page.getByRole("button", { name: "Resume sharing location" }))
    .toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull();
  releaseResumeResponse?.();
  await expect.poll(() => resumeResponses).toBe(1);
  await expect(page.getByRole("button", { name: "Resume sharing location" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause sharing" })).toHaveCount(0);
  await page.evaluate((terminalJobId) => {
    window.dispatchEvent(new CustomEvent("axora:delivery-terminal", {
      detail: { jobId: terminalJobId, status: "COMPLETED" },
    }));
  }, jobId);
  await expect(page.getByText("No tracking session is assigned.")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull();
  await expect(page.getByText(/internal cost|buying cost/i)).toHaveCount(0);
});

test("location denial is clear, creates no false point, and remains retryable", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __allowAxoraGeo?: boolean;
      __axoraWatchCount?: number;
    };
    state.__allowAxoraGeo = false;
    state.__axoraWatchCount = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        clearWatch: () => undefined,
        watchPosition: (
          success: PositionCallback,
          failure: PositionErrorCallback,
        ) => {
          state.__axoraWatchCount = (state.__axoraWatchCount ?? 0) + 1;
          if (state.__allowAxoraGeo) {
            success({
              coords: {
                accuracy: 12,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                latitude: 3.139,
                longitude: 101.6869,
                speed: null,
                toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            });
          } else {
            failure({
              code: 1,
              message: "denied",
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            });
          }
          return state.__axoraWatchCount;
        },
      },
    });
  });
  const actions: string[] = [];
  let status = "ACTIVE";
  await page.route("**/api/driver/workspace", (route) => route.fulfill({ json: {
    actorId: driver.id,
    capturedAt: "2026-08-09T04:00:00Z",
    jobs: [],
  } }));
  await page.route("**/api/driver/tracking", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action: string };
      actions.push(body.action);
      if (body.action === "PAUSE") status = "PAUSED";
      if (body.action === "RESUME") status = "ACTIVE";
      await route.fulfill({ json: body.action === "POINT"
        ? { accepted: true }
        : { sessionId, status } });
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
        status,
        destinationLatitude: 3.141,
        destinationLongitude: 101.69,
        visibilityPrecision: "APPROXIMATE",
        rawRetentionDays: 30,
        pointCount: actions.filter((action) => action === "POINT").length,
      }],
    } });
  });

  await signInAsDemoRole(page, driver);
  await page.goto("/driver");
  expect(await page.evaluate(() => (
    (window as unknown as { __axoraWatchCount?: number }).__axoraWatchCount
  ))).toBe(0);
  await page.getByRole("button", { name: "Start location sharing" }).click();
  await expect(page.getByText(/Location permission was denied/)).toBeVisible();
  await expect.poll(() => actions.slice(0, 2))
    .toEqual(["REPORT_FAILURE", "PAUSE"]);
  expect(actions).not.toContain("POINT");

  await page.evaluate(() => {
    (window as unknown as { __allowAxoraGeo?: boolean }).__allowAxoraGeo = true;
  });
  await page.getByRole("button", { name: "Resume sharing location" }).click();
  await expect.poll(() => actions).toContain("RESUME");
  await expect.poll(() => actions).toContain("POINT");
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
      routeMode: "PRIVACY_SAFE_DIRECT_ESTIMATE",
      pointCount: 2,
      locationAvailable: true,
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
  await page.route("**/api/receiving/delivery-tracking/live", async (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `event: snapshot\ndata: ${JSON.stringify({ sequence: 1, snapshot: {
      capturedAt: "2026-08-09T04:00:00Z",
      sessions: [{ sessionId, jobId, jobCode: "DEL-LIVE-068", branchName: "Kuala Lumpur", jobStatus: "OUT_FOR_DELIVERY", status: "ACTIVE", lastUpdatedAt: "2026-08-09T03:59:45Z", stale: false, latitude: 3.139, longitude: 101.687, accuracyMeters: 150, destinationLatitude: 3.141, destinationLongitude: 101.69, remainingMeters: 420, etaSeconds: 180, routeMode: "PRIVACY_SAFE_DIRECT_ESTIMATE", pointCount: 2, locationAvailable: true, visibilityPrecision: "APPROXIMATE", rawRetentionDays: 30, agentUserId: driver.id, agentName: driver.name, contactMode: "AXORA_RELAY", contactPath: `/support?delivery=${jobId}`, vehicleType: "Van", vehicleColour: "White", vehicleRegistration: "AXR 204" }],
    } })}\n\n`,
  }));
  await signInAsDemoRole(page, receiver);
  await page.goto("/receiving");

  const board = page.getByRole("region", { name: "Your delivery" });
  await expect(board).toBeVisible();
  await expect(board.getByRole("group", { name: "Delivery destination map" }))
    .toBeVisible();
  await expect(board.locator(".maplibregl-marker")).toHaveCount(2);
  await expect(board.getByText(/Direct distance estimate — not a road route/))
    .toBeVisible();
  await expect(board.getByText("AXR 204")).toBeVisible();
  await expect(board.getByText("Approximate ETA: in 3 minutes", { exact: true }))
    .toBeVisible();
  await expect(board.getByText("Approximate location").first()).toBeVisible();
  await expect(board.getByText(/3\.139|101\.687/)).toHaveCount(0);
  await expect(board.getByText(/history|raw coordinates/i)).toHaveCount(0);
});

test("Company Administrator observes preparing through completed without reloading", async ({ page }) => {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent<string>) => void;
    const runtime = window as unknown as {
      __axoraTrackingListeners?: Map<string, Listener[]>;
      __emitAxoraTracking?: (snapshot: unknown, sequence: number) => void;
    };
    runtime.__axoraTrackingListeners = new Map();
    class ControlledEventSource {
      constructor() {}
      addEventListener(type: string, listener: EventListener) {
        const current = runtime.__axoraTrackingListeners?.get(type) ?? [];
        current.push(listener as unknown as Listener);
        runtime.__axoraTrackingListeners?.set(type, current);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: ControlledEventSource,
    });
    runtime.__emitAxoraTracking = (snapshot, sequence) => {
      const event = new MessageEvent("snapshot", {
        data: JSON.stringify({ sequence, snapshot }),
      });
      for (const listener of runtime.__axoraTrackingListeners?.get("snapshot") ?? []) {
        listener(event);
      }
    };
  });
  const base = {
    sessionId,
    jobId,
    jobCode: "DEL-LIVE-068",
    branchName: "Kuala Lumpur",
    visibilityPrecision: "APPROXIMATE",
    rawRetentionDays: 0,
    pointCount: 0,
  };
  await page.route("**/api/receiving/delivery-otp", (route) => route.fulfill({
    json: { capturedAt: "2026-08-09T04:00:00Z", jobs: [] },
  }));
  await page.route("**/api/receiving/delivery-tracking", (route) => route.fulfill({ json: {
    capturedAt: "2026-08-09T04:00:00Z",
    sessions: [{ ...base, jobStatus: "PREPARING", status: "NOT_STARTED" }],
  } }));
  await signInAsDemoRole(page, receiver);
  await page.goto("/receiving");
  const board = page.getByRole("region", { name: "Your delivery" });
  await expect(board.getByText("Preparing", { exact: true })).toBeVisible();

  await page.evaluate(({ session, job, baseSession }) => {
    const runtime = window as unknown as {
      __emitAxoraTracking?: (snapshot: unknown, sequence: number) => void;
    };
    runtime.__emitAxoraTracking?.({
      capturedAt: "2026-08-09T04:01:00Z",
      sessions: [{
        ...baseSession,
        sessionId: session,
        jobId: job,
        jobStatus: "OUT_FOR_DELIVERY",
        status: "ACTIVE",
        latitude: 3.139,
        longitude: 101.687,
        destinationLatitude: 3.141,
        destinationLongitude: 101.69,
        locationAvailable: true,
        remainingMeters: 420,
        etaSeconds: 180,
      }],
    }, 1);
  }, { session: sessionId, job: jobId, baseSession: base });
  await expect(board.getByText("Out for delivery", { exact: true })).toBeVisible();

  await page.evaluate((baseSession) => {
    const runtime = window as unknown as {
      __emitAxoraTracking?: (snapshot: unknown, sequence: number) => void;
    };
    runtime.__emitAxoraTracking?.({
      capturedAt: "2026-08-09T04:02:00Z",
      sessions: [{ ...baseSession, jobStatus: "ARRIVED", status: "ACTIVE" }],
    }, 2);
  }, base);
  await expect(board.getByText("Arrived", { exact: true })).toBeVisible();

  await page.evaluate((baseSession) => {
    const runtime = window as unknown as {
      __emitAxoraTracking?: (snapshot: unknown, sequence: number) => void;
    };
    runtime.__emitAxoraTracking?.({
      capturedAt: "2026-08-09T04:03:00Z",
      sessions: [{ ...baseSession, jobStatus: "COMPLETED", status: "ENDED" }],
    }, 3);
  }, base);
  await expect(board.getByText("Completed", { exact: true })).toBeVisible();
  await expect(board.locator(".maplibregl-marker")).toHaveCount(0);
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
  await page.route("**/api/receiving/delivery-tracking/live", async (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `event: snapshot\ndata: ${JSON.stringify({ sequence: 1, snapshot: {
      capturedAt: "2026-08-09T04:10:00Z",
      sessions: [{ sessionId, jobId, jobCode: "DEL-LIVE-068", branchName: "كوالالمبور", jobStatus: "OUT_FOR_DELIVERY", status: "PAUSED", lastUpdatedAt: "2026-08-09T04:00:00Z", stale: true, latitude: 3.139, longitude: 101.687, destinationLatitude: 3.141, destinationLongitude: 101.69, remainingMeters: 420, etaSeconds: null, visibilityPrecision: "APPROXIMATE", rawRetentionDays: 30 }],
    } })}\n\n`,
  }));
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
