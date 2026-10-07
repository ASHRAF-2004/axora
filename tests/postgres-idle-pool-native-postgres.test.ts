import { randomUUID } from "node:crypto";
import { Client, Pool, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attachPostgresPoolErrorHandler,
  type PostgresIdleClientErrorEntry,
} from "../server-tools/postgres-pool-errors.mjs";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

nativeDescribe.sequential("native idle PostgreSQL pool recovery", () => {
  let admin: Client | undefined;
  let pool: Pool | undefined;
  const applicationName = `axora-native-idle-recovery-${randomUUID()}`;
  const entries: PostgresIdleClientErrorEntry[] = [];

  beforeAll(async () => {
    const host = requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST");
    const port = Number(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"));
    const database = requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE");
    // Fail before opening sockets unless the explicit isolated runner contract
    // is present. Never terminate a connection in an arbitrary database.
    if ((host !== "127.0.0.1" && host !== "::1")
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535
      || database !== "axora_native_ci") {
      throw new Error("Idle-pool recovery requires the isolated native CI database.");
    }
    const shared = {
      host, port, database, ssl: false, connectionTimeoutMillis: 2_000,
      statement_timeout: 2_000, query_timeout: 3_000,
    } satisfies Partial<ClientConfig>;
    admin = new Client({
      ...shared,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
      application_name: `${applicationName}-admin`,
    });
    pool = new Pool({
      ...shared, user: "axora_app", password: requiredEnvironment("DB_PASSWORD"),
      application_name: applicationName, max: 1, idleTimeoutMillis: 30_000,
    });
    attachPostgresPoolErrorHandler(pool, {
      component: "app", logError: (entry) => entries.push(entry),
    });
    await admin.connect();
    const verified = await admin.query<{ database: string }>(
      "SELECT current_database() AS database",
    );
    expect(verified.rows[0]?.database).toBe("axora_native_ci");
  }, 8_000);

  afterAll(async () => {
    await Promise.all([pool?.end(), admin?.end()]);
  }, 8_000);

  it("survives termination of only its idle fixture socket and obtains a fresh backend without replay", async () => {
    if (!admin || !pool) throw new Error("Isolated native fixture was not initialized.");
    const first = await pool.query<{ pid: number; value: number }>(
      "SELECT pg_backend_pid() AS pid, 1 AS value",
    );
    const firstPid = first.rows[0]?.pid;
    expect(first.rows[0]?.value).toBe(1);
    expect(Number.isInteger(firstPid)).toBe(true);
    expect(pool.idleCount).toBe(1);
    expect(pool.listenerCount("error")).toBe(1);

    let cancelErrorWait = () => {};
    const idleError = new Promise<Error & { code?: string }>((resolve, reject) => {
      const observedPool = pool!;
      const onError = (error: Error & { code?: string }) => {
        cancelErrorWait();
        resolve(error);
      };
      const timer = setTimeout(() => {
        cancelErrorWait();
        reject(new Error("Isolated idle client termination event timed out."));
      }, 3_000);
      cancelErrorWait = () => {
        clearTimeout(timer);
        observedPool.off("error", onError);
      };
      observedPool.once("error", onError);
    });
    // Register the wait before termination and consume either outcome immediately
    // so a failed bounded admin operation cannot leave an unhandled rejection.
    const observedError = idleError.then((error) => ({ error }), (failure: unknown) => ({ failure }));
    try {
      const terminated = await admin.query<{ terminated: boolean }>(`
        SELECT pg_terminate_backend(pid) AS terminated
        FROM pg_stat_activity
        WHERE pid=$1 AND datname='axora_native_ci'
          AND usename='axora_app' AND application_name=$2 AND state='idle'
          AND pid<>pg_backend_pid()
      `, [firstPid, applicationName]);
      expect(terminated.rows).toEqual([{ terminated: true }]);
      const observed = await observedError;
      if ("failure" in observed) throw observed.failure;
      expect(observed.error.code).toBe("57P01");
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
    } finally {
      cancelErrorWait();
    }

    const next = await pool.query<{ pid: number; value: number }>(
      "SELECT pg_backend_pid() AS pid, 1 AS value",
    );
    expect(next.rows[0]?.pid).not.toBe(firstPid);
    expect(next.rows[0]?.value).toBe(1);
    expect(pool.totalCount).toBe(1);
    expect(entries).toEqual([{
      event: "postgres_idle_client_error", component: "app", sqlState: "57P01",
    }]);

    // The listener is not a transaction recovery mechanism. A failed operation
    // remains aborted until explicit rollback; nothing is reset or replayed.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(client.query("SELECT 1 / 0 AS value")).rejects.toMatchObject({ code: "22012" });
      await expect(client.query("SELECT 1 AS value")).rejects.toMatchObject({ code: "25P02" });
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
    expect(entries).toHaveLength(1);
    expect(pool.listenerCount("error")).toBe(1);
  }, 15_000);
});
