import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

const DEFAULT_INTERVAL_MS = 15_000;

function readSecret(path) {
  return path ? readFileSync(path, "utf8").trim() : undefined;
}

export function budgetWorkerDatabaseConfig(env = process.env) {
  if (env.DATABASE_URL) {
    return {
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === "false"
        ? false
        : env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
          : undefined,
    };
  }
  const password = readSecret(env.DB_PASSWORD_FILE) ?? env.DB_PASSWORD;
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !password) {
    throw new Error("Budget worker database configuration is incomplete.");
  }
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password,
  };
}

export async function pollBudgetRefreshJobsOnce({
  db,
  workerId,
  limit = 10,
  leaseSeconds = 90,
}) {
  await db.query(
    "SELECT public.axora_reconcile_budget_refresh_jobs(now()) AS reconciled",
  );
  const claimed = await db.query(
    "SELECT job_id::text,lease_token::text FROM public.axora_claim_budget_refresh_jobs($1,$2,$3,now())",
    [workerId, limit, leaseSeconds],
  );
  const results = [];
  for (const job of claimed.rows) {
    const processed = await db.query(
      "SELECT public.axora_process_budget_refresh_job($1,$2,$3,now()) AS payload",
      [workerId, job.job_id, job.lease_token],
    );
    results.push(processed.rows[0]?.payload);
  }
  return results;
}

export function createBudgetWorkerServer(state) {
  return http.createServer((request, response) => {
    if (request.method !== "GET"
      || (request.url !== "/health/live" && request.url !== "/health/ready")) {
      response.writeHead(404).end();
      return;
    }
    const ready = request.url === "/health/live"
      || (state.lastSuccessfulPollAt
        && Date.now() - state.lastSuccessfulPollAt < state.maxReadyAgeMs);
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: ready ? "ok" : "not_ready",
      workerId: state.workerId,
      active: state.active,
    }));
  });
}

export function startBudgetWorker({ env = process.env } = {}) {
  const workerId = env.BUDGET_WORKER_ID ?? "budget-" + randomUUID();
  const intervalMs = Number(env.BUDGET_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const state = {
    workerId,
    active: false,
    lastSuccessfulPollAt: 0,
    maxReadyAgeMs: Math.max(intervalMs * 4, 60_000),
  };
  const db = new pg.Pool({
    ...budgetWorkerDatabaseConfig(env),
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  const poll = async () => {
    if (state.active) return;
    state.active = true;
    try {
      await pollBudgetRefreshJobsOnce({ db, workerId });
      state.lastSuccessfulPollAt = Date.now();
    } catch {
      console.error(JSON.stringify({ event: "budget_refresh_poll_failed" }));
    } finally {
      state.active = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  const server = createBudgetWorkerServer(state);
  const port = Number(env.BUDGET_WORKER_PORT ?? 3101);
  const shutdown = () => server.close();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "budget_worker_started", port }));
  });
  server.on("close", () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    clearInterval(timer);
    void db.end();
  });
  return { server, state, shutdown };
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url) {
  startBudgetWorker();
}
