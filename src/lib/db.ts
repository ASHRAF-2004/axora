import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __axoraPool: Pool | undefined;
}

export function isDemoMode() {
  return process.env.DEMO_MODE !== "false";
}

export class PostgresQueryParameterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresQueryParameterContractError";
  }
}

export function postgresParameterIndexes(text: string) {
  const indexes = new Set<number>();
  let index = 0;
  let blockDepth = 0;
  let dollarQuote: string | undefined;
  let state: "sql" | "single" | "double" | "line" | "block" = "sql";
  while (index < text.length) {
    const current = text[index];
    const next = text[index + 1];
    if (dollarQuote) {
      if (text.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        dollarQuote = undefined;
      } else index += 1;
      continue;
    }
    if (state === "single") {
      if (current === "'" && next === "'") index += 2;
      else if (current === "'") { state = "sql"; index += 1; }
      else index += 1;
      continue;
    }
    if (state === "double") {
      if (current === '"' && next === '"') index += 2;
      else if (current === '"') { state = "sql"; index += 1; }
      else index += 1;
      continue;
    }
    if (state === "line") {
      if (current === "\n") state = "sql";
      index += 1;
      continue;
    }
    if (state === "block") {
      if (current === "/" && next === "*") { blockDepth += 1; index += 2; }
      else if (current === "*" && next === "/") {
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = "sql";
      } else index += 1;
      continue;
    }
    if (current === "'") { state = "single"; index += 1; continue; }
    if (current === '"') { state = "double"; index += 1; continue; }
    if (current === "-" && next === "-") { state = "line"; index += 2; continue; }
    if (current === "/" && next === "*") {
      state = "block";
      blockDepth = 1;
      index += 2;
      continue;
    }
    if (current === "$") {
      const quote = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (quote) { dollarQuote = quote; index += quote.length; continue; }
      const parameter = text.slice(index + 1).match(/^\d+/)?.[0];
      if (parameter) {
        indexes.add(Number(parameter));
        index += parameter.length + 1;
        continue;
      }
    }
    index += 1;
  }
  return [...indexes].sort((left, right) => left - right);
}

export function assertPostgresQueryParameterContract(
  text: string,
  values: readonly unknown[] = [],
) {
  const indexes = postgresParameterIndexes(text);
  const maximum = indexes.at(-1) ?? 0;
  const contiguous = indexes.every((value, offset) => value === offset + 1);
  if (!contiguous || indexes.includes(0) || maximum !== values.length) {
    throw new PostgresQueryParameterContractError(
      `PostgreSQL parameter contract mismatch (indexes=${indexes.join(",") || "none"}; values=${values.length}).`,
    );
  }
}

const guardedClients = new WeakSet<PoolClient>();

function guardClientQueries(client: PoolClient) {
  if (guardedClients.has(client)) return;
  const originalQuery = client.query;
  client.query = (function guardedQuery(this: PoolClient, ...args: unknown[]) {
    const specification = args[0];
    const text = typeof specification === "string"
      ? specification
      : specification && typeof specification === "object" && "text" in specification
        ? String(specification.text)
        : undefined;
    const configuredValues = specification && typeof specification === "object" && "values" in specification
      ? specification.values
      : undefined;
    const values = Array.isArray(configuredValues)
      ? configuredValues
      : Array.isArray(args[1]) ? args[1] : [];
    if (text) assertPostgresQueryParameterContract(text, values);
    return Reflect.apply(originalQuery, this, args);
  }) as PoolClient["query"];
  guardedClients.add(client);
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
    const pool = new Pool({
      connectionString: buildConnectionString(),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      max: 10,
      ssl: buildSslConfig(),
    });
    pool.on("connect", guardClientQueries);
    global.__axoraPool = pool;
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
