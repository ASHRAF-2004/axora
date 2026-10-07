import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ pools: [] }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class IsolatedPool extends EventEmitter {
    constructor() { super(); this.queries = 0; fixtures.pools.push(this); }
    async query() { this.queries += 1; return { rows: [], rowCount: 0 }; }
    async connect() { return { query: (...args) => this.query(...args), release() {} }; }
    async end() {}
  }
  return { default: { Pool: IsolatedPool }, Pool: IsolatedPool };
});

import { startBudgetWorker } from "../server-tools/budget-worker.mjs";
import { startDocumentWorker } from "../server-tools/document-worker.mjs";
import { startCompanyDeletionCleanupWorker } from "../server-tools/company-deletion-cleanup-worker.mjs";
import { startIntegrationWorker } from "../server-tools/integration-worker.mjs";

const resources = [];
const signalListeners = {
  SIGTERM: new Set(process.listeners("SIGTERM")), SIGINT: new Set(process.listeners("SIGINT")),
};

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function readyStatus(worker) {
  const response = await fetch(`http://127.0.0.1:${worker.server.address().port}/health/ready`);
  await response.arrayBuffer();
  return response.status;
}

async function waitReady(worker) {
  const until = Date.now() + 3_000;
  while (Date.now() < until) {
    if (await readyStatus(worker) === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Isolated worker did not recover readiness");
}

afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
  for (const signal of ["SIGTERM", "SIGINT"]) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].has(listener)) process.off(signal, listener);
    }
  }
  fixtures.pools.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("worker idle dependency failure readiness", () => {
  it.each(["budget", "document", "cleanup", "integration"])(
    "%s stays live, loses readiness, then recovers through its existing poll", async (kind) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      const port = await freePort();
      const env = { NODE_ENV: "test", DB_HOST: "127.0.0.1", DB_NAME: "isolated",
        DB_USER: "axora_app", DB_PASSWORD: "synthetic-isolated-fixture" };
      let worker;
      if (kind === "budget") {
        worker = startBudgetWorker({ env: { ...env, BUDGET_WORKER_PORT: String(port),
          BUDGET_WORKER_INTERVAL_MS: "1000" } });
      } else if (kind === "document") {
        vi.stubEnv("DATABASE_URL", "postgresql://isolated@127.0.0.1:1/isolated");
        vi.stubEnv("DOCUMENT_WORKER_PORT", String(port));
        vi.stubEnv("DOCUMENT_WORKER_INTERVAL_MS", "1000");
        worker = await startDocumentWorker();
      } else if (kind === "cleanup") {
        const uploads = await mkdtemp(path.join(os.tmpdir(), "axora-idle-pool-"));
        resources.push(() => rm(uploads, { recursive: true, force: true }));
        worker = startCompanyDeletionCleanupWorker({ env: { ...env,
          DB_USER: "axora_cleanup_worker", AXORA_UPLOADS_CONTAINER_DIR: uploads,
          COMPANY_DELETION_CLEANUP_WORKER_PORT: String(port),
          COMPANY_DELETION_CLEANUP_INTERVAL_MS: "1000" } });
      } else {
        worker = startIntegrationWorker({ env: { ...env, DB_USER: "axora_integration_worker",
          AXORA_INTEGRATION_WEBHOOKS_ENABLED: "true",
          AXORA_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
          INTEGRATION_WORKER_PORT: String(port), INTEGRATION_WORKER_INTERVAL_MS: "1000" } });
      }
      resources.push(async () => {
        if (worker.stop) await worker.stop();
        else if (kind === "cleanup") await worker.shutdown();
        else {
          const closed = once(worker.server, "close");
          worker.shutdown();
          await closed;
        }
      });
      if (!worker.server.listening) await once(worker.server, "listening");
      await waitReady(worker);
      const pool = fixtures.pools[0];
      expect(pool.listenerCount("error")).toBe(1);
      const queriesBefore = pool.queries;
      pool.emit("error", Object.assign(new Error("Synthetic private connection detail"), {
        code: "57P01", detail: "Synthetic private recipient",
      }));
      expect(await readyStatus(worker)).toBe(503);
      const live = await fetch(`http://127.0.0.1:${port}/health/live`);
      await live.arrayBuffer();
      expect(live.status).toBe(200);
      await waitReady(worker);
      expect(pool.queries).toBeGreaterThan(queriesBefore);
      expect(fixtures.pools).toHaveLength(1);
      expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
        event: "postgres_idle_client_error",
        component: kind === "cleanup" ? "company-deletion-cleanup-worker" : `${kind}-worker`,
        sqlState: "57P01",
      }));
    }, 5_000,
  );
});
