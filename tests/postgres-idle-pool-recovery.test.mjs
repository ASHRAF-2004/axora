import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPostgresPoolErrorHandler } from "../server-tools/postgres-pool-errors.mjs";
import { getPool } from "../src/lib/db.ts";

const require = createRequire(import.meta.url);
const pgUrl = pathToFileURL(require.resolve("pg")).href;
const helperUrl = new URL("../server-tools/postgres-pool-errors.mjs", import.meta.url).href;
const savedAppPool = global.__axoraPool;
let testAppPool;

function isolatedPoolProcess(withHandler) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { EventEmitter } from "node:events";
    import pg from ${JSON.stringify(pgUrl)};
    import { attachPostgresPoolErrorHandler } from ${JSON.stringify(helperUrl)};
    const clients = [];
    const entries = [];
    let rejectedQueries = 0;
    let invalidated = 0;
    class IsolatedClient extends EventEmitter {
      constructor() { super(); this._queryable = true; this._ending = false; clients.push(this); }
      connect(callback) { queueMicrotask(() => callback()); }
      query(text, values, callback) {
        queueMicrotask(() => {
          if (text === "synthetic-operation-failure") {
            rejectedQueries += 1;
            callback(Object.assign(new Error("Synthetic operation failure"), { code: "40001" }));
          } else callback(null, { rows: [{ value: 1 }] });
        });
      }
      end(callback) { this._ending = true; if (callback) queueMicrotask(callback); }
    }
    const pool = new pg.Pool({ Client: IsolatedClient, max: 1 });
    if (${withHandler}) {
      attachPostgresPoolErrorHandler(pool, {
        component: "app", onError: () => { invalidated += 1; },
        logError: (entry) => entries.push(entry),
      });
    }
    await pool.query("SELECT 1");
    clients[0].emit("error", Object.assign(new Error("Synthetic private connection detail"), {
      code: "57P01", detail: "Synthetic private recipient", connectionString: "synthetic-private-url",
    }));
    const result = await pool.query("SELECT 1");
    const clientsAfterRecovery = clients.length;
    let operationCode;
    try { await pool.query("synthetic-operation-failure"); } catch (error) { operationCode = error.code; }
    await pool.end();
    console.log(JSON.stringify({ clientsAfterRecovery, value: result.rows[0].value,
      rejectedQueries, operationCode, invalidated, entries }));
  `], {
    env: { PATH: process.env.PATH }, timeout: 5_000, encoding: "utf8",
  });
}

afterEach(async () => {
  if (testAppPool) await testAppPool.end();
  testAppPool = undefined;
  global.__axoraPool = savedAppPool;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("idle PostgreSQL pool dependency recovery", () => {
  it("reproduces the process-fatal idle error with the real pg.Pool before the repair", () => {
    const child = isolatedPoolProcess(false);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("Synthetic private connection detail");
  });

  it("keeps the process alive and gets a fresh client without replaying failed operations", () => {
    const child = isolatedPoolProcess(true);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toEqual({
      clientsAfterRecovery: 2, value: 1, rejectedQueries: 1, operationCode: "40001", invalidated: 1,
      entries: [{ event: "postgres_idle_client_error", component: "app", sqlState: "57P01" }],
    });
    expect(child.stdout).not.toMatch(/private connection|recipient|synthetic-private-url/);
  });

  it("attaches once, invalidates once, and never logs arbitrary exception data", () => {
    const pool = new EventEmitter();
    const onError = vi.fn();
    const logError = vi.fn();
    const options = { component: "budget-worker", onError, logError };
    expect(attachPostgresPoolErrorHandler(pool, options)).toBe(true);
    expect(attachPostgresPoolErrorHandler(pool, options)).toBe(false);
    expect(pool.listenerCount("error")).toBe(1);
    pool.emit("error", { code: "not-a-sqlstate", message: "Synthetic private detail" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith({
      event: "postgres_idle_client_error", component: "budget-worker",
    });
  });

  it("wires the shared app singleton without changing the pool or transaction semantics", () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("DATABASE_URL", "postgresql://isolated@127.0.0.1:1/isolated");
    vi.stubEnv("DATABASE_SSL", "false");
    global.__axoraPool = undefined;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    testAppPool = getPool();
    expect(getPool()).toBe(testAppPool);
    expect(testAppPool.listenerCount("error")).toBe(1);
    expect(() => testAppPool.emit("error", Object.assign(new Error("Synthetic private detail"), {
      code: "57P01",
    }))).not.toThrow();
    expect(getPool()).toBe(testAppPool);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: "postgres_idle_client_error", component: "app", sqlState: "57P01",
    }));
  });
});
