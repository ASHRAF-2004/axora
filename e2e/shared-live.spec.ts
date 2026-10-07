import { expect, test, type Page } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

async function owner(page: Page) {
  await signInAsDemoOwner(page);
  await expect(page.locator('[data-live-status="current"]')).toBeVisible();
}

test("one shared EventSource fans out current authorized view hints", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  const active = new Set<string>();
  let peak = 0;
  let legacy = 0;
  const frames: Array<Record<string, unknown>> = [];
  session.on("Network.requestWillBeSent", (event) => {
    const url = new URL(event.request.url);
    if (/\/api\/.+\/(live|stream)$/.test(url.pathname)) legacy += 1;
    if (event.type === "EventSource" && url.pathname === "/api/live") {
      active.add(event.requestId); peak = Math.max(peak, active.size);
    }
  });
  session.on("Network.loadingFinished", (event) => active.delete(event.requestId));
  session.on("Network.loadingFailed", (event) => active.delete(event.requestId));
  session.on("Network.eventSourceMessageReceived", (event) => {
    if (event.eventName === "snapshot") frames.push(JSON.parse(event.data));
  });
  await owner(page);
  const requestLink = page.getByRole("link", { name: "Requests", exact: true }).filter({ visible: true }).first();
  if (!await requestLink.isVisible()) await page.getByRole("button", { name: "Open application menu", exact: true }).click();
  await requestLink.click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.locator('[data-live-status="current"]')).toBeVisible();
  expect(peak).toBe(1);
  expect(legacy).toBe(0);
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expect(JSON.stringify(frame)).not.toMatch(/buyPrice|supplierId|latitude|proofPath|password|token/i);
  await session.detach();
});

test("failed SSE keeps the existing read-only polling path usable", async ({ page }) => {
  await page.route("**/api/live?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("transport") === "poll") await route.continue();
    else await route.abort("connectionfailed");
  });
  await signInAsDemoOwner(page);
  await expect(page.locator('[data-live-status="polling"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.locator("#portal-main")).toBeVisible();
});

test("authorization loss stops fallback reads instead of retrying private data", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/live?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("transport") === "poll") {
      reads += 1;
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Authentication required"}' });
    } else await route.abort("connectionfailed");
  });
  await signInAsDemoOwner(page);
  await expect(page.locator('[data-live-status="paused"]')).toBeVisible();
  expect(reads).toBe(1);
  // The local fixture checks browser cleanup; native tests prove DB revocation.
});

test("view hints preserve dirty filter value and focus, then safely resync", async ({ page }) => {
  await owner(page);
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/live?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("transport") === "poll") { await route.continue(); return; }
    await prepared;
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: snapshot\ndata: ${JSON.stringify({
      epoch: "00000000-0000-4000-8000-000000000001", sequence: 1, resync: true,
      snapshot: { topics: { requests: { version: "b".repeat(64) }, notifications: { version: "a".repeat(64), unreadCount: 0 } } },
    })}\n\n` });
  });
  await page.goto("/requests");
  const input = page.locator('input[name="q"]');
  await input.fill("unsaved local filter");
  release();
  await expect(page.getByText("New data is available; finish your changes to update this view")).toBeVisible();
  await expect(input).toHaveValue("unsaved local filter");
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/requests$/);
  await input.fill("");
  await page.getByRole("heading", { name: "Purchase requests", exact: true }).click();
  await expect(page.getByText("New data is available; finish your changes to update this view")).toBeHidden();
  await expect(input).toHaveValue("");
});
