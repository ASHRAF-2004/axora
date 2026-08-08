import fs from "node:fs";
import { randomUUID } from "node:crypto";
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

function buildSslConfig() {
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.DATABASE_SSL === "true") {
    const caFile = process.env.DATABASE_SSL_CA_FILE;
    return {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(caFile ? { ca: fs.readFileSync(caFile, "utf8") } : {}),
    };
  }
  return undefined;
}

export function getPool() {
  if (isDemoMode()) throw new Error("Database access is disabled in demo mode.");
  if (!global.__axoraPool) {
    global.__axoraPool = new Pool({
      connectionString: buildConnectionString(),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      max: 10,
      ssl: buildSslConfig(),
    });
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
  context: {
    userId?: string;
    actor?: {
      id: string;
      roleAssignmentId?: string | null;
      sessionId?: string;
      timezone?: string;
    };
    reason?: string;
    reasonCode?: string;
    resultCode?: string;
    outcome?: "SUCCESS" | "FAILURE";
    correlationId?: string;
    commandId?: string;
    systemIdentity?: string;
  },
  work: (client: PoolClient) => Promise<T>,
) {
  return withTransaction(async (client) => {
    await client.query(
      `SELECT
         set_config('axora.user_id', $1, true),
         set_config('axora.change_reason', $2, true),
         set_config('axora.role_assignment_id', $3, true),
         set_config('axora.session_id', $4, true),
         set_config('axora.display_timezone', $5, true),
         set_config('axora.reason_code', $6, true),
         set_config('axora.result_code', $7, true),
         set_config('axora.outcome', $8, true),
         set_config('axora.correlation_id', $9, true),
         set_config('axora.command_id', $10, true),
         set_config('axora.system_identity', $11, true)`,
      [
        context.actor?.id ?? context.userId ?? "",
        context.reason?.trim() ?? "",
        context.actor?.roleAssignmentId ?? "",
        context.actor?.sessionId ?? "",
        context.actor?.timezone ?? "UTC",
        context.reasonCode ?? "",
        context.resultCode ?? "",
        context.outcome ?? "SUCCESS",
        context.correlationId ?? randomUUID(),
        context.commandId ?? "",
        context.systemIdentity ?? "",
      ],
    );
    return work(client);
  });
}
