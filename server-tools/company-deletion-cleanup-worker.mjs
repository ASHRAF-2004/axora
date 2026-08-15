import http from "node:http";
import { randomUUID } from "node:crypto";
import { access, lstat, readFileSync, realpath, rm, rmdir } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const accessAsync = promisify(access);
const lstatAsync = promisify(lstat);
const realpathAsync = promisify(realpath);
const rmAsync = promisify(rm);
const rmdirAsync = promisify(rmdir);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class PermanentCleanupError extends Error {}

function readSecret(file) {
  return file ? readFileSync(file, "utf8").trim() : undefined;
}

export function companyDeletionCleanupDatabaseConfig(env = process.env) {
  const password = readSecret(env.DB_PASSWORD_FILE) ?? env.DB_PASSWORD;
  if (env.DATABASE_URL || !env.DB_HOST || !env.DB_NAME
    || env.DB_USER !== "axora_cleanup_worker" || !password) {
    throw new Error("Company deletion cleanup database configuration is incomplete.");
  }
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password,
  };
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
    || "External deletion cleanup failed";
}

function relativeSegments(locator) {
  if (typeof locator !== "string" || locator.length < 1 || locator.length > 1200
    || locator.includes("\\") || /[\u0000-\u001f\u007f]/.test(locator)
    || path.posix.isAbsolute(locator)) {
    throw new PermanentCleanupError("The cleanup locator is unsafe.");
  }
  const segments = locator.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PermanentCleanupError("The cleanup locator is unsafe.");
  }
  return segments;
}

async function insideRoot(root, targetParent) {
  const rootReal = await realpathAsync(root);
  let parentReal;
  try {
    parentReal = await realpathAsync(targetParent);
  } catch (error) {
    if (error?.code === "ENOENT") return { rootReal, missing: true };
    throw error;
  }
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new PermanentCleanupError("The cleanup locator escapes its configured root.");
  }
  return { rootReal, missing: false };
}

async function pruneEmptyParents(rootReal, start) {
  let current = start;
  while (current !== rootReal && current.startsWith(`${rootReal}${path.sep}`)) {
    try {
      await rmdirAsync(current);
    } catch (error) {
      if (error?.code === "ENOTEMPTY" || error?.code === "ENOENT") return;
      throw error;
    }
    current = path.dirname(current);
  }
}

export async function removeOwnedFile(root, locator) {
  const segments = relativeSegments(locator);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new PermanentCleanupError("The cleanup locator escapes its configured root.");
  }
  const scope = await insideRoot(resolvedRoot, path.dirname(target));
  if (scope.missing) return { removed: false, alreadyAbsent: true };
  try {
    const metadata = await lstatAsync(target);
    if (metadata.isDirectory()) {
      throw new PermanentCleanupError("A file cleanup task cannot remove a directory.");
    }
    await rmAsync(target, { force: true });
    await pruneEmptyParents(scope.rootReal, path.dirname(target));
    return { removed: true, alreadyAbsent: false };
  } catch (error) {
    if (error?.code === "ENOENT") return { removed: false, alreadyAbsent: true };
    throw error;
  }
}

async function removeCompanyNamespace(root, locator) {
  if (!root) throw new PermanentCleanupError("The cleanup adapter is not configured.");
  const match = /^company:([0-9a-f-]{36})$/.exec(locator);
  if (!match || !UUID.test(match[1])) {
    throw new PermanentCleanupError("The company namespace locator is unsafe.");
  }
  const resolvedRoot = path.resolve(root);
  await accessAsync(resolvedRoot);
  const target = path.join(resolvedRoot, match[1]);
  const scope = await insideRoot(resolvedRoot, resolvedRoot);
  const targetMetadata = await lstatAsync(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!targetMetadata) return { removed: false, alreadyAbsent: true };
  if (targetMetadata.isSymbolicLink()) {
    await rmAsync(target, { force: true });
  } else {
    await rmAsync(target, { recursive: true, force: true });
  }
  return { removed: true, alreadyAbsent: false, root: scope.rootReal };
}

export function createCompanyDeletionCleanupAdapters({
  uploadsRoot,
  cacheRoot,
  searchIndexRoot,
} = {}) {
  const configuredUploadsRoot = path.resolve(
    uploadsRoot ?? process.env.AXORA_UPLOADS_CONTAINER_DIR ?? path.join(process.cwd(), "data", "uploads"),
  );
  return {
    FILE: (task) => removeOwnedFile(configuredUploadsRoot, task.locator),
    CACHE: (task) => removeCompanyNamespace(cacheRoot ?? process.env.AXORA_COMPANY_CACHE_ROOT, task.locator),
    SEARCH_INDEX: (task) => removeCompanyNamespace(
      searchIndexRoot ?? process.env.AXORA_COMPANY_SEARCH_INDEX_ROOT,
      task.locator,
    ),
    async ready() {
      await accessAsync(configuredUploadsRoot);
      return true;
    },
  };
}

async function workerQuery(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // This value is audit context only. Database authorization is enforced by
    // EXECUTE grants held exclusively by the dedicated cleanup-worker role.
    await client.query("SELECT set_config('axora.system_identity','company-deletion-cleanup-worker',true)");
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createCompanyDeletionCleanupStore(pool) {
  return {
    async claim(workerId, leaseSeconds, now) {
      const result = await workerQuery(pool,
        "SELECT * FROM public.axora_claim_company_deletion_cleanup_task($1,$2,$3)",
        [workerId, leaseSeconds, now]);
      return result.rows[0] ?? null;
    },
    async complete(task, outcome, workerId, now) {
      const result = await workerQuery(pool,
        "SELECT public.axora_complete_company_deletion_cleanup_task($1,$2,$3,$4,$5) AS value",
        [task.task_id, task.lease_id, workerId, outcome, now]);
      return result.rows[0]?.value;
    },
    async fail(task, message, retryable, workerId, now) {
      const result = await workerQuery(pool,
        "SELECT public.axora_fail_company_deletion_cleanup_task($1,$2,$3,$4,$5,$6) AS value",
        [task.task_id, task.lease_id, workerId, message, retryable, now]);
      return result.rows[0]?.value;
    },
    async ready() {
      await pool.query("SELECT 1");
      return true;
    },
  };
}

export async function processCompanyDeletionCleanupTask(task, {
  adapters,
  store,
  workerId,
} = {}) {
  if (!store || !adapters || !workerId) throw new Error("Cleanup worker dependencies are incomplete.");
  const adapter = adapters[task.task_kind];
  if (typeof adapter !== "function") {
    const error = new PermanentCleanupError("The cleanup task kind is unsupported.");
    await store.fail(task, safeError(error), false, workerId, new Date());
    return { status: "TERMINAL_FAILED", taskId: task.task_id };
  }
  try {
    const outcome = await adapter(task);
    await store.complete(task, { ...outcome, adapter: task.task_kind }, workerId, new Date());
    return { status: "COMPLETE", taskId: task.task_id };
  } catch (error) {
    const retryable = !(error instanceof PermanentCleanupError);
    const state = await store.fail(task, safeError(error), retryable, workerId, new Date());
    return {
      status: state?.cleanupStatus === "FAILED" ? "TERMINAL_FAILED" : "RETRY_WAIT",
      taskId: task.task_id,
    };
  }
}

export async function pollCompanyDeletionCleanupOnce({
  store,
  adapters,
  workerId = randomUUID(),
  concurrency = 2,
  leaseSeconds = 120,
} = {}) {
  const boundedConcurrency = Math.max(1, Math.min(4, Number(concurrency)));
  const boundedLease = Math.max(30, Math.min(900, Number(leaseSeconds)));
  const tasks = [];
  for (let index = 0; index < boundedConcurrency; index += 1) {
    const task = await store.claim(workerId, boundedLease, new Date());
    if (!task) break;
    tasks.push(task);
  }
  return Promise.all(tasks.map((task) => processCompanyDeletionCleanupTask(task, {
    adapters, store, workerId,
  })));
}

export function startCompanyDeletionCleanupWorker({ env = process.env } = {}) {
  const workerId = env.COMPANY_DELETION_CLEANUP_WORKER_ID ?? `company-cleanup-${randomUUID()}`;
  const intervalMs = Math.max(1_000, Number(env.COMPANY_DELETION_CLEANUP_INTERVAL_MS ?? 15_000));
  const pool = new pg.Pool({
    ...companyDeletionCleanupDatabaseConfig(env),
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  const store = createCompanyDeletionCleanupStore(pool);
  const adapters = createCompanyDeletionCleanupAdapters({
    uploadsRoot: env.AXORA_UPLOADS_CONTAINER_DIR,
    cacheRoot: env.AXORA_COMPANY_CACHE_ROOT,
    searchIndexRoot: env.AXORA_COMPANY_SEARCH_INDEX_ROOT,
  });
  const state = { active: false, stopping: false, lastSuccessfulPollAt: 0 };
  const poll = async () => {
    if (state.active || state.stopping) return;
    state.active = true;
    try {
      const results = await pollCompanyDeletionCleanupOnce({ store, adapters, workerId });
      state.lastSuccessfulPollAt = Date.now();
      for (const result of results) {
        console.info(JSON.stringify({ event: "company_deletion_cleanup_processed", status: result.status }));
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "company_deletion_cleanup_poll_failed", error: safeError(error) }));
    } finally {
      state.active = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET"
      || (request.url !== "/health/live" && request.url !== "/health/ready")) {
      response.writeHead(404).end();
      return;
    }
    let ready = request.url === "/health/live";
    if (!ready) {
      try {
        await Promise.all([store.ready(), adapters.ready()]);
        ready = state.lastSuccessfulPollAt > 0
          && Date.now() - state.lastSuccessfulPollAt < Math.max(intervalMs * 4, 60_000);
      } catch {
        ready = false;
      }
    }
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: ready ? "ok" : "not_ready", active: state.active }));
  });
  const port = Number(env.COMPANY_DELETION_CLEANUP_WORKER_PORT ?? 3103);
  const shutdown = async () => {
    if (state.stopping) return;
    state.stopping = true;
    clearInterval(timer);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "company_deletion_cleanup_worker_started", port }));
  });
  return { server, state, shutdown };
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(path.resolve(entrypoint)).href === import.meta.url) {
  startCompanyDeletionCleanupWorker();
}
