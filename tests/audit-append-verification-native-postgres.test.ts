import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for isolated native audit verification.`);
  return value;
}
interface Evidence {
  event_count: number;
  invalid_hash_count: number;
  invalid_partition_count: number;
  duplicate_hash_count: number;
  root_count: number;
  missing_predecessor_count: number;
  fork_count: number;
  reachable_count: number;
  terminal_count: number;
  head_matches: boolean;
  is_valid: boolean;
}
interface EventLink { id: string; integrity_hash: string; previous_integrity_hash: string | null }

function expectSameEvidence(actual: unknown, expected: unknown) {
  // Compare the complete original values without dumping rows/hashes into
  // assertion output if a future regression violates the preservation guard.
  expect(isDeepStrictEqual(actual, expected)).toBe(true);
}

nativeDescribe.sequential("private audit append verification native serialization", () => {
  let admin: Client;
  let adminConfig: ClientConfig;
  let appConfig: ClientConfig;

  async function connect(config: ClientConfig) {
    const connection = new Client(config);
    await connection.connect();
    await connection.query("SET statement_timeout='15s'; SET lock_timeout='10s'; SET TIME ZONE 'UTC'");
    return connection;
  }
  async function company() {
    const id = randomUUID();
    await admin.query("INSERT INTO public.companies(id,company_code,name,active) VALUES ($1,$2,'Native isolated audit verifier',true)", [id, `NAV-${id}`]);
    return id;
  }
  async function append(connection: Client, partition: string, time?: string, microseconds = 0) {
    return (await connection.query<EventLink>(`
      INSERT INTO public.audit_logs(entity_type,record_id,action,company_id,occurred_at)
      VALUES ('isolated_native_append_probe',gen_random_uuid(),'READ',$1,
        COALESCE($2::timestamptz,clock_timestamp()) + $3::integer * interval '1 microsecond')
      RETURNING id::text,integrity_hash,previous_integrity_hash
    `, [partition, time ?? null, microseconds])).rows[0];
  }
  async function evidence(partition: string, connection = admin) {
    const result = await connection.query<{ proof: Evidence }>(
      "SELECT to_jsonb(proof) AS proof FROM public.axora_verify_audit_append_integrity($1) proof", [partition],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0].proof;
  }
  async function head(partition: string, connection = admin) {
    return (await connection.query<{ head: unknown }>(
      "SELECT to_jsonb(head) AS head FROM public.audit_integrity_heads head WHERE partition_key=$1", [partition],
    )).rows[0].head;
  }
  async function blockedBy(blockedPid: number, blockerPid: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await admin.query<{ blocked: boolean }>("SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked", [blockedPid, blockerPid]);
      if (result.rows[0].blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("The expected isolated audit partition-head lock wait was not observed.");
  }
  async function pid(connection: Client) {
    return (await connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  }

  beforeAll(async () => {
    const host = required("AXORA_NATIVE_POSTGRES_HOST");
    const database = required("AXORA_NATIVE_POSTGRES_DATABASE");
    const port = Number(required("AXORA_NATIVE_POSTGRES_PORT"));
    if ((host !== "127.0.0.1" && host !== "::1") || database !== "axora_native_ci"
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || required("DB_USER") !== "axora_app"
      || required("AXORA_NATIVE_POSTGRES_ADMIN_USER") !== "postgres") {
      throw new Error("Audit verification races require the loopback isolated native CI database.");
    }
    const shared = { host, port, database, ssl: false, connectionTimeoutMillis: 2_000, application_name: `axora-native-audit-${randomUUID()}` };
    adminConfig = { ...shared, user: "postgres", password: required("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD") };
    appConfig = { ...shared, user: "axora_app", password: required("DB_PASSWORD") };
    admin = await connect(adminConfig);
    expect((await admin.query<{ database: string }>("SELECT current_database() AS database")).rows[0].database).toBe("axora_native_ci");
  });
  afterAll(async () => { await admin?.end(); });

  it("preserves a 17-microsecond inversion under the head lock and verifies consistent snapshots", async () => {
    const partition = await company();
    const earlier = await connect(adminConfig);
    const later = await connect(adminConfig);
    const observer = await connect(adminConfig);
    try {
      const earlierPid = await pid(earlier);
      const laterPid = await pid(later);
      const time = (await admin.query<{ time: string }>(`SELECT to_char(clock_timestamp()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time`)).rows[0].time;
      const original = await evidence(partition);
      const originalHead = await head(partition);
      expect(original.is_valid).toBe(true);
      await observer.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      expect(await evidence(partition, observer)).toEqual(original);
      await later.query("BEGIN");
      await later.query("SELECT 1 FROM public.audit_integrity_heads WHERE partition_key=$1 FOR UPDATE", [partition]);
      await earlier.query("BEGIN");
      const waiting = append(earlier, partition, time);
      await blockedBy(earlierPid, laterPid);
      expect(await evidence(partition)).toEqual(original);
      expectSameEvidence(await head(partition), originalHead);

      const laterEvent = await append(later, partition, time, 17);
      await later.query("COMMIT");
      const earlierEvent = await waiting;
      // The waiting writer has inserted but not committed: readers must see
      // the committed later event and its matching head, never a mixed pair.
      const between = await evidence(partition);
      expect(between).toMatchObject({ event_count: original.event_count + 1, is_valid: true });
      expect(await evidence(partition, observer)).toEqual(original);
      expectSameEvidence(await head(partition, observer), originalHead);
      await earlier.query("COMMIT");
      const final = await evidence(partition);
      expect(final).toMatchObject({ event_count: original.event_count + 2, is_valid: true });
      expect(final.reachable_count).toBe(final.event_count);
      expect(earlierEvent.previous_integrity_hash === laterEvent.integrity_hash).toBe(true);
      expect(BigInt(earlierEvent.id)).toBeLessThan(BigInt(laterEvent.id));
      const delta = await admin.query<{ microseconds: number }>(`
        SELECT (extract(epoch FROM later.occurred_at-earlier.occurred_at)*1000000)::integer AS microseconds
        FROM public.audit_logs later CROSS JOIN public.audit_logs earlier
        WHERE later.id=$1 AND earlier.id=$2
      `, [laterEvent.id, earlierEvent.id]);
      expect(delta.rows[0].microseconds).toBe(17);
      const temporal = await admin.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.axora_verify_audit_integrity($1) WHERE is_valid IS NOT TRUE", [partition],
      );
      expect(temporal.rows[0].count).toBe(2);
      expect(await evidence(partition, observer)).toEqual(original);
      await observer.query("COMMIT");
      expect(await evidence(partition, observer)).toEqual(final);
    } finally {
      await Promise.all([earlier.query("ROLLBACK"), later.query("ROLLBACK"), observer.query("ROLLBACK")]);
      await Promise.all([earlier.end(), later.end(), observer.end()]);
    }
  });

  it("rolls back a waiting writer and links the next event to the last committed head", async () => {
    const partition = await company();
    const waiter = await connect(adminConfig);
    const holder = await connect(adminConfig);
    try {
      const waiterPid = await pid(waiter);
      const holderPid = await pid(holder);
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM public.audit_integrity_heads WHERE partition_key=$1 FOR UPDATE", [partition]);
      await waiter.query("BEGIN");
      const waiting = append(waiter, partition);
      await blockedBy(waiterPid, holderPid);
      const committed = await append(holder, partition);
      await holder.query("COMMIT");
      const committedHead = await head(partition);
      const beforeRollback = await evidence(partition);
      const uncommitted = await waiting;
      expect(uncommitted.previous_integrity_hash === committed.integrity_hash).toBe(true);
      expect(await evidence(partition)).toEqual(beforeRollback);
      await waiter.query("ROLLBACK");
      expect(await evidence(partition)).toEqual(beforeRollback);
      expectSameEvidence(await head(partition), committedHead);
      expect((await admin.query("SELECT id FROM public.audit_logs WHERE id=$1", [uncommitted.id])).rows).toEqual([]);
      const next = await append(admin, partition);
      expect(next.previous_integrity_hash === committed.integrity_hash).toBe(true);
      expect((await evidence(partition)).is_valid).toBe(true);
    } finally {
      await Promise.all([waiter.query("ROLLBACK"), holder.query("ROLLBACK")]);
      await Promise.all([waiter.end(), holder.end()]);
    }
  });

  it("rejects payload, graph, disconnected-cycle and head tampering and restores every fixture on rollback", async () => {
    const partition = await company();
    const links = [await append(admin, partition), await append(admin, partition), await append(admin, partition)];
    const original = await evidence(partition);
    const originalHead = await head(partition);
    const originalEvents = (await admin.query("SELECT to_jsonb(event) AS event FROM public.audit_logs event WHERE integrity_partition=$1 ORDER BY id", [partition])).rows;
    const cases: Array<{ sql: string; values: unknown[]; expected: Partial<Evidence>; rehashTail?: boolean }> = [
      { sql: "UPDATE public.audit_logs SET reason='isolated payload tamper' WHERE id=$1", values: [links[2].id], expected: { invalid_hash_count: 1 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=repeat('0',64) WHERE id=$1", values: [links[2].id], expected: { missing_predecessor_count: 1 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=NULL WHERE id=$1", values: [links[2].id], expected: { root_count: 2 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=$1 WHERE id=$2", values: [links[0].integrity_hash, links[2].id], expected: { fork_count: 1 } },
      { sql: "UPDATE public.audit_logs SET integrity_hash=$1 WHERE id=$2", values: [links[0].integrity_hash, links[2].id], expected: { duplicate_hash_count: 1 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=$1 WHERE id=$2", values: [links[2].integrity_hash, links[1].id], expected: { root_count: 1, missing_predecessor_count: 0, reachable_count: original.event_count - 2 } },
      { sql: "UPDATE public.audit_integrity_heads SET latest_event_id=$1,latest_hash=$2 WHERE partition_key=$3", values: [links[1].id, links[1].integrity_hash, partition], expected: { head_matches: false } },
      // These three keep every stored hash valid and the terminal head anchored.
      // Rejection must therefore come from graph topology, not stale hashes.
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=repeat('0',64) WHERE id=$1", values: [links[2].id], rehashTail: true,
        expected: { invalid_hash_count: 0, head_matches: true, root_count: 1, missing_predecessor_count: 1, terminal_count: 2, reachable_count: original.event_count - 1 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=NULL WHERE id=$1", values: [links[2].id], rehashTail: true,
        expected: { invalid_hash_count: 0, head_matches: true, root_count: 2, missing_predecessor_count: 0, terminal_count: 2, reachable_count: original.event_count } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=$1 WHERE id=$2", values: [links[0].integrity_hash, links[2].id], rehashTail: true,
        expected: { invalid_hash_count: 0, head_matches: true, root_count: 1, missing_predecessor_count: 0, fork_count: 1, terminal_count: 2, reachable_count: original.event_count } },
    ];
    for (const probe of cases) {
      await admin.query("BEGIN");
      try {
        await admin.query("ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_append_only");
        await admin.query(probe.sql, probe.values);
        if (probe.rehashTail) {
          await admin.query("UPDATE public.audit_logs event SET integrity_hash=public.axora_audit_hash(event) WHERE id=$1", [links[2].id]);
          await admin.query(`UPDATE public.audit_integrity_heads SET latest_event_id=$1,
            latest_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE partition_key=$2`, [links[2].id, partition]);
        }
        expect(await evidence(partition)).toMatchObject({ ...probe.expected, is_valid: false });
      } finally { await admin.query("ROLLBACK"); }
      expect(await evidence(partition)).toEqual(original);
      expectSameEvidence(await head(partition), originalHead);
      expectSameEvidence((await admin.query("SELECT to_jsonb(event) AS event FROM public.audit_logs event WHERE integrity_partition=$1 ORDER BY id", [partition])).rows, originalEvents);
    }
  });

  it("keeps the verifier private after deployment migration and canonical grant replays", async () => {
    const permissions = await admin.query<{ role: string; permitted: boolean }>(`
      SELECT role,has_function_privilege(role,'public.axora_verify_audit_append_integrity(text)','EXECUTE') AS permitted
      FROM unnest(ARRAY['public','axora_app','axora_cleanup_worker','axora_integration_worker']) role ORDER BY role
    `);
    expect(permissions.rows).toHaveLength(4);
    expect(permissions.rows.every((role) => !role.permitted)).toBe(true);
    const application = await connect(appConfig);
    try { await expect(application.query("SELECT * FROM public.axora_verify_audit_append_integrity()"))
      .rejects.toMatchObject({ code: "42501" }); }
    finally { await application.end(); }
    const definition = await admin.query<{ volatility: string; definer: boolean }>(`
      SELECT provolatile AS volatility,prosecdef AS definer FROM pg_proc
      WHERE oid='public.axora_verify_audit_append_integrity(text)'::regprocedure
    `);
    expect(definition.rows[0]).toEqual({ volatility: "s", definer: false });
  });
});
