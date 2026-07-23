import fs from "node:fs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __axoraPool: Pool | undefined;
}

export function isDemoMode() {
  return process.env.DEMO_MODE !== "false";
}

function readPassword() {
  if (process.env.DB_PASSWORD_FILE && fs.existsSync(process.env.DB_PASSWORD_FILE)) {
    return fs.readFileSync(process.env.DB_PASSWORD_FILE, "utf8").trim();
  }
  return process.env.DB_PASSWORD ?? "";
}

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "axora";
  const user = process.env.DB_USER ?? "axora_app";
  const password = encodeURIComponent(readPassword());
  return `postgresql://${encodeURIComponent(user)}:${password}@${host}:${port}/${encodeURIComponent(name)}`;
}

export function getPool() {
  if (isDemoMode()) throw new Error("Database access is disabled in demo mode.");
  if (!global.__axoraPool) {
    global.__axoraPool = new Pool({ connectionString: buildConnectionString(), max: 10, idleTimeoutMillis: 30_000 });
  }
  return global.__axoraPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withAuditTransaction<T>(
  context: { userId?: string; reason?: string },
  work: (client: PoolClient) => Promise<T>,
) {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('axora.user_id', $1, true), set_config('axora.change_reason', $2, true)", [
      context.userId ?? "",
      context.reason?.trim() ?? "",
    ]);
    return work(client);
  });
}
