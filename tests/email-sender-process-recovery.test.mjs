import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workerUrl = new URL("../server-tools/email-sender.mjs", import.meta.url).href;
const resources = [];

async function waitFor(check, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Isolated email worker recovery condition timed out");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function respond(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function fixture({ outage = false, queued = false, holdCompletion = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "axora-email-process-"));
  await writeFile(path.join(root, "service-key"), "s".repeat(48), { mode: 0o600 });
  await writeFile(path.join(root, "provider-key"), "re_synthetic_isolated_process_provider", { mode: 0o600 });
  const state = {
    outage, holdCompletion, status: queued ? "PENDING" : "EMPTY", expireLease: false,
    accepted: 0, completed: 0, claims: 0, completionWaiting: false, children: [],
  };
  const job = {
    deliveryId: "13000000-0000-4000-8000-000000000001",
    leaseId: "13000000-0000-4000-8000-000000000002",
    messageKind: "CONTACT_NOTIFICATION", providerAgent: "axora-platform",
    recipientName: "Isolated receiver", recipientEmail: "isolated@example.test", locale: "en",
    contact: { name: "Isolated visitor", message: "Synthetic enquiry used only by a loopback transport.", submittedAt: new Date().toISOString() },
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/emails") {
        state.accepted += 1;
        respond(response, { id: "isolated-process-provider-message" });
        return;
      }
      if (request.url !== "/account/email-outbox") { respond(response, {}, 404); return; }
      if (state.outage) { respond(response, { error: "service_unavailable" }, 503); return; }
      if (body.action === "claim") {
        state.claims += 1;
        if (state.expireLease && state.status === "SENDING") state.status = "UNCERTAIN";
        if (body.queue === "transactional" && state.status === "PENDING") {
          state.status = "SENDING";
          respond(response, { job });
        } else respond(response, { job: null });
        return;
      }
      if (body.action === "complete") {
        state.completionWaiting = true;
        await waitFor(() => !state.holdCompletion || response.destroyed);
        if (response.destroyed) return;
        expect(body.deliveryId).toBe(job.deliveryId);
        expect(body.leaseId).toBe(job.leaseId);
        state.status = "SENT";
        state.completed += 1;
        respond(response, { recorded: true });
      }
    } catch {
      if (!response.destroyed) respond(response, { error: "isolated_fixture_error" }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const port = await freePort();
  async function start() {
    // Run the real worker in a separate process. Its pinned internal/provider
    // targets are mapped exclusively to the isolated loopback transport; any
    // other outbound destination is rejected before a network request occurs.
    const childCode = `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, options) => {
        const url = String(input);
        if (url === 'http://app:3000/account/email-outbox') return originalFetch(${JSON.stringify(`${baseUrl}/account/email-outbox`)}, options);
        if (url === 'https://api.resend.com/emails') return originalFetch(${JSON.stringify(`${baseUrl}/emails`)}, options);
        throw new Error('Unexpected outbound destination in isolated worker fixture');
      };
      const { startEmailSender } = await import(${JSON.stringify(workerUrl)});
      startEmailSender();
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test", EMAIL_SENDER_PORT: String(port), AXORA_EMAIL_DELIVERY_ENABLED: "true",
        APP_BASE_URL: "https://axora.management", AXORA_EMAIL_PROVIDER: "resend",
        AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management", AXORA_EMAIL_FROM_NAME: "Axora",
        AXORA_EMAIL_REPLY_TO: "support@axora.management", AXORA_EMAIL_OUTBOX_URL: "http://app:3000/account/email-outbox",
        RESEND_API_KEY_FILE: path.join(root, "provider-key"), AXORA_EMAIL_SERVICE_AUTH_KEY_FILE: path.join(root, "service-key"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const events = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        for (const line of chunk.split("\n")) {
          try { events.push(JSON.parse(line)); } catch { /* Non-structured data is never printed. */ }
        }
      });
    }
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    const handle = { child, events, exited };
    state.children.push(handle);
    await waitFor(() => events.some((event) => event.event === "email_sender_started"));
    return handle;
  }
  async function readiness() {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1_000) });
      return { status: response.status, body: await response.json() };
    } catch { return undefined; }
  }
  resources.push(async () => {
    state.holdCompletion = false;
    for (const handle of state.children) {
      if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill("SIGKILL");
      await handle.exited;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { state, start, readiness };
}

afterEach(async () => {
  for (const dispose of resources.splice(0)) await dispose();
});

describe("email worker isolated process recovery", () => {
  it("recovers delayed queue readiness and a graceful restart without manual queue repair", async () => {
    const test = await fixture({ outage: true });
    const worker = await test.start();
    await waitFor(() => worker.events.some((event) => event.event === "transactional_email_outbox_poll_failed"));
    expect((await test.readiness()).status).toBe(503);
    const restoredAt = Date.now();
    test.state.outage = false;
    await waitFor(async () => (await test.readiness())?.status === 200);
    const recoveryMs = Date.now() - restoredAt;
    expect(recoveryMs).toBeLessThan(12_000);
    worker.child.kill("SIGTERM");
    expect(await worker.exited).toEqual({ code: 0, signal: null });
    const restartAt = Date.now();
    const restarted = await test.start();
    await waitFor(async () => (await test.readiness())?.status === 200);
    expect(test.state.accepted).toBe(0);
    console.info(JSON.stringify({ event: "isolated_email_recovery_evidence", scenario: "delayed_queue_and_restart", queueRecoveryMs: recoveryMs, restartReadyMs: Date.now() - restartAt }));
    restarted.child.kill("SIGTERM");
    expect(await restarted.exited).toEqual({ code: 0, signal: null });
  }, 30_000);

  it("drains accepted-provider completion before graceful exit and sends once across restart", async () => {
    const test = await fixture({ queued: true, holdCompletion: true });
    const worker = await test.start();
    await waitFor(() => test.state.completionWaiting);
    expect(test.state.accepted).toBe(1);
    const stoppedAt = Date.now();
    worker.child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(worker.child.exitCode).toBeNull();
    test.state.holdCompletion = false;
    expect(await worker.exited).toEqual({ code: 0, signal: null });
    expect(test.state.status).toBe("SENT");
    expect(test.state.completed).toBe(1);
    const drainMs = Date.now() - stoppedAt;
    const restarted = await test.start();
    await waitFor(async () => (await test.readiness())?.status === 200);
    expect(test.state.accepted).toBe(1);
    console.info(JSON.stringify({ event: "isolated_email_recovery_evidence", scenario: "accepted_provider_graceful_drain", drainMs, providerAcceptances: test.state.accepted, completed: test.state.completed }));
    restarted.child.kill("SIGTERM");
    expect(await restarted.exited).toEqual({ code: 0, signal: null });
  }, 30_000);

  it("does not replay ambiguous provider acceptance after abrupt process loss", async () => {
    const test = await fixture({ queued: true, holdCompletion: true });
    const worker = await test.start();
    await waitFor(() => test.state.completionWaiting);
    worker.child.kill("SIGKILL");
    expect(await worker.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(test.state.status).toBe("SENDING");
    expect(test.state.completed).toBe(0);
    test.state.expireLease = true;
    const restartAt = Date.now();
    const restarted = await test.start();
    await waitFor(async () => (await test.readiness())?.status === 200);
    expect(test.state.status).toBe("UNCERTAIN");
    expect(test.state.accepted).toBe(1);
    console.info(JSON.stringify({ event: "isolated_email_recovery_evidence", scenario: "accepted_provider_abrupt_loss", restartReadyMs: Date.now() - restartAt, providerAcceptances: test.state.accepted, localCompletions: test.state.completed, queueStatus: test.state.status }));
    restarted.child.kill("SIGTERM");
    expect(await restarted.exited).toEqual({ code: 0, signal: null });
  }, 30_000);
});
