import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

interface Evidence {
  partition_key: string | null;
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

describe("private serialized audit-link verification", () => {
  let db: PGlite;
  let ids: number[];
  let migration: string;
  let initialPartitions: unknown[];

  async function evidence(partition = "PLATFORM") {
    const result = await db.query<{ proof: Evidence }>(
      "SELECT to_jsonb(proof) AS proof FROM public.axora_verify_audit_append_integrity($1) proof",
      [partition],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0].proof;
  }

  async function permitIsolatedTampering() {
    // Each test owns a savepoint in its PGlite database. Its rollback restores
    // both evidence and trigger state; ordinary mutation remains prohibited.
    await db.exec("ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_append_only");
  }

  async function expectDenied(sql: string, values: unknown[], message: RegExp) {
    await db.exec("SAVEPOINT denied_audit_command");
    try { await expect(db.query(sql, values)).rejects.toThrow(message); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied_audit_command; RELEASE SAVEPOINT denied_audit_command"); }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN; CREATE ROLE axora_cleanup_worker NOLOGIN; CREATE ROLE axora_integration_worker NOLOGIN; SET TIME ZONE 'UTC'");
    await applyMigrations(db, { through: "139_branch_lifecycle_authority_and_budget_refusals.sql" });
    migration = await readFile(new URL("../database/migrations/140_audit_append_link_verification.sql", import.meta.url), "utf8");
    await db.exec(migration);
    initialPartitions = (await db.query("SELECT * FROM public.axora_verify_audit_append_integrity()")).rows;
  }, 120_000);

  beforeEach(async () => {
    await db.exec("BEGIN; SAVEPOINT isolated_audit_probe");
    const inserted = await db.query<{ id: number }>(`
      INSERT INTO public.audit_logs(entity_type,record_id,action,occurred_at,old_values,new_values)
      SELECT 'isolated_append_probe',gen_random_uuid(),'READ',
        '2050-01-01T00:00:00Z'::timestamptz + number * interval '1 second','{}','{}'
      FROM generate_series(1,3) number ORDER BY number
      RETURNING id
    `);
    ids = inserted.rows.map((row) => row.id);
  });
  afterEach(async () => { await db.exec("ROLLBACK"); });
  afterAll(async () => { await db?.close(); });

  it("returns no invented chain for the freshly migrated empty database", () => {
    expect(initialPartitions).toEqual([]);
  });

  it("accepts a complete chain and rejects no ordinary append-only controls", async () => {
    const proof = await evidence();
    expect(proof).toMatchObject({ invalid_hash_count: 0, invalid_partition_count: 0,
      duplicate_hash_count: 0, root_count: 1, missing_predecessor_count: 0,
      fork_count: 0, terminal_count: 1, head_matches: true, is_valid: true });
    expect(proof.reachable_count).toBe(proof.event_count);
    await expectDenied("UPDATE public.audit_logs SET reason='tampered' WHERE id=$1", [ids[0]], /append-only/i);
    await expectDenied("DELETE FROM public.audit_logs WHERE id=$1", [ids[0]], /append-only/i);
  });

  it("retains temporal discrepancies while accepting intact reverse-timestamp links", async () => {
    await db.exec(`
      INSERT INTO public.audit_logs(entity_type,record_id,action,occurred_at)
      VALUES ('isolated_inverse_probe',gen_random_uuid(),'READ','2051-01-01T00:00:00.000017Z'),
        ('isolated_inverse_probe',gen_random_uuid(),'READ','2051-01-01T00:00:00.000000Z')
    `);
    expect((await evidence()).is_valid).toBe(true);
    const temporal = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM public.axora_verify_audit_integrity('PLATFORM')
      WHERE is_valid IS NOT TRUE
    `);
    expect(temporal.rows[0].count).toBe(2);
  });

  it("detects a changed whole-row payload", async () => {
    await permitIsolatedTampering();
    await db.query("UPDATE public.audit_logs SET reason='tampered payload' WHERE id=$1", [ids[2]]);
    expect(await evidence()).toMatchObject({ invalid_hash_count: 1, is_valid: false });
  });

  it("detects missing hashes and mismatched partition identity", async () => {
    await permitIsolatedTampering();
    await db.query("UPDATE public.audit_logs SET integrity_hash=NULL WHERE id=$1", [ids[2]]);
    expect(await evidence()).toMatchObject({ invalid_hash_count: 1, head_matches: false, is_valid: false });
    await db.query("UPDATE public.audit_logs SET integrity_partition='WRONG' WHERE id=$1", [ids[2]]);
    expect(await evidence("WRONG")).toMatchObject({ invalid_partition_count: 1, is_valid: false });
  });

  it("rejects null partitions without returning a null validity result", async () => {
    await permitIsolatedTampering();
    await db.query("UPDATE public.audit_logs SET integrity_partition=NULL WHERE id=$1", [ids[2]]);
    const rows = await db.query<{ proof: Evidence }>("SELECT to_jsonb(proof) AS proof FROM public.axora_verify_audit_append_integrity() proof");
    expect(rows.rows.find((row) => row.proof.partition_key === null)?.proof).toMatchObject({ invalid_partition_count: 1, is_valid: false });
  });

  it("detects duplicate stored hashes and predecessor forks", async () => {
    await permitIsolatedTampering();
    await db.query(`UPDATE public.audit_logs SET integrity_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE id=$2`, [ids[0], ids[2]]);
    expect(await evidence()).toMatchObject({ duplicate_hash_count: 1, is_valid: false });
    await db.query(`UPDATE public.audit_logs SET previous_integrity_hash=(SELECT previous_integrity_hash FROM public.audit_logs WHERE id=$1) WHERE id=$2`, [ids[1], ids[2]]);
    expect(await evidence()).toMatchObject({ fork_count: 1, is_valid: false });
  });

  it("detects extra roots and same-partition predecessor orphans", async () => {
    await permitIsolatedTampering();
    await db.query("UPDATE public.audit_logs SET previous_integrity_hash=NULL WHERE id=$1", [ids[2]]);
    expect(await evidence()).toMatchObject({ root_count: 2, is_valid: false });
    await db.query("UPDATE public.audit_logs SET previous_integrity_hash=repeat('0',64) WHERE id=$1", [ids[2]]);
    const proof = await evidence();
    expect(proof).toMatchObject({ missing_predecessor_count: 1, is_valid: false });
    expect(proof.reachable_count).toBeLessThan(proof.event_count);
  });

  it("does not accept a predecessor hash from another partition", async () => {
    await permitIsolatedTampering();
    await db.query("UPDATE public.audit_logs SET integrity_partition='OTHER' WHERE id=$1", [ids[0]]);
    expect(await evidence()).toMatchObject({ missing_predecessor_count: 1, is_valid: false });
    expect(await evidence("OTHER")).toMatchObject({ invalid_partition_count: 1, head_matches: false, is_valid: false });
  });

  it("rejects tail topology defects independently of valid hashes and a matching terminal head", async () => {
    const original = await evidence();
    await permitIsolatedTampering();
    const cases: Array<{ sql: string; values: unknown[]; expected: Partial<Evidence> }> = [
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=repeat('0',64) WHERE id=$1", values: [ids[2]],
        expected: { root_count: 1, missing_predecessor_count: 1, terminal_count: 2, reachable_count: original.event_count - 1 } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=NULL WHERE id=$1", values: [ids[2]],
        expected: { root_count: 2, missing_predecessor_count: 0, terminal_count: 2, reachable_count: original.event_count } },
      { sql: "UPDATE public.audit_logs SET previous_integrity_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE id=$2", values: [ids[0], ids[2]],
        expected: { root_count: 1, missing_predecessor_count: 0, fork_count: 1, terminal_count: 2, reachable_count: original.event_count } },
    ];
    for (const probe of cases) {
      await db.exec("SAVEPOINT rehashed_graph_probe");
      try {
        await db.query(probe.sql, probe.values);
        await db.query("UPDATE public.audit_logs event SET integrity_hash=public.axora_audit_hash(event) WHERE id=$1", [ids[2]]);
        await db.query(`UPDATE public.audit_integrity_heads SET latest_event_id=$1,
          latest_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE partition_key='PLATFORM'`, [ids[2]]);
        expect(await evidence()).toMatchObject({ ...probe.expected,
          invalid_hash_count: 0, duplicate_hash_count: 0, head_matches: true, is_valid: false });
      } finally { await db.exec("ROLLBACK TO SAVEPOINT rehashed_graph_probe; RELEASE SAVEPOINT rehashed_graph_probe"); }
      expect(await evidence()).toEqual(original);
    }
  });

  it("terminates and rejects a disconnected cycle even with one remaining root", async () => {
    await permitIsolatedTampering();
    await db.query(`UPDATE public.audit_logs SET previous_integrity_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE id=$2`, [ids[2], ids[1]]);
    const proof = await evidence();
    expect(proof).toMatchObject({ root_count: 1, missing_predecessor_count: 0, is_valid: false });
    expect(proof.reachable_count).toBe(proof.event_count - 2);
  });

  it("rejects a head pointing to an interior event, wrong hash, or no head", async () => {
    await db.query(`UPDATE public.audit_integrity_heads SET latest_event_id=$1,
      latest_hash=(SELECT integrity_hash FROM public.audit_logs WHERE id=$1) WHERE partition_key='PLATFORM'`, [ids[1]]);
    expect(await evidence()).toMatchObject({ head_matches: false, is_valid: false });
    await db.query("UPDATE public.audit_integrity_heads SET latest_event_id=$1,latest_hash=repeat('0',64) WHERE partition_key='PLATFORM'", [ids[2]]);
    expect(await evidence()).toMatchObject({ head_matches: false, is_valid: false });
    await db.exec("DELETE FROM public.audit_integrity_heads WHERE partition_key='PLATFORM'");
    expect(await evidence()).toMatchObject({ head_matches: false, is_valid: false });
  });

  it("includes orphan heads instead of treating their empty event set as valid", async () => {
    await db.exec("INSERT INTO public.audit_integrity_heads(partition_key,latest_event_id,latest_hash) VALUES ('ORPHAN_HEAD',123,repeat('0',64))");
    expect(await evidence("ORPHAN_HEAD")).toMatchObject({ event_count: 0, root_count: 0, reachable_count: 0, head_matches: false, is_valid: false });
    expect((await db.query("SELECT * FROM public.axora_verify_audit_append_integrity('ABSENT')")).rows).toEqual([]);
  });

  it("is private before and after the real canonical grant policy is replayed", async () => {
    async function privileges() {
      return (await db.query<{ role: string; permitted: boolean }>(`
        SELECT role,has_function_privilege(role,'public.axora_verify_audit_append_integrity(text)','EXECUTE') AS permitted
        FROM unnest(ARRAY['public','axora_app','axora_cleanup_worker','axora_integration_worker']) role ORDER BY role
      `)).rows;
    }
    expect((await privileges()).every((role) => !role.permitted)).toBe(true);
    await db.exec("CREATE TABLE schema_migrations(filename text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
    const grants = await readFile(new URL("../database/admin/apply-app-grants.sql", import.meta.url), "utf8");
    await db.exec(grants.split("\n").filter((line) => !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")).join("\n"));
    expect((await privileges()).every((role) => !role.permitted)).toBe(true);
    await db.exec("SET ROLE axora_app");
    await expectDenied("SELECT * FROM public.axora_verify_audit_append_integrity()", [], /permission denied/i);
    await db.exec("RESET ROLE");
    expect((await evidence()).is_valid).toBe(true);
  });
});

describe("forward-only audit verifier upgrade", () => {
  it("preserves every existing event, head and historical hash/trigger/verifier definition", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "139_branch_lifecycle_authority_and_budget_refusals.sql" });
      await db.exec("INSERT INTO public.audit_logs(entity_type,record_id,action) VALUES ('preserved_probe',gen_random_uuid(),'READ')");
      async function snapshot() {
        return (await db.query<{ state: unknown }>(`
          SELECT jsonb_build_object(
            'events',(SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id) FROM public.audit_logs event),
            'heads',(SELECT jsonb_agg(to_jsonb(head) ORDER BY head.partition_key) FROM public.audit_integrity_heads head),
            'columns',(SELECT jsonb_agg(to_jsonb(column_row) ORDER BY column_row.attnum)
              FROM pg_attribute column_row WHERE column_row.attrelid='public.audit_logs'::regclass),
            'functions',(SELECT jsonb_agg(pg_get_functiondef(function_row.oid) ORDER BY function_row.proname)
              FROM pg_proc function_row JOIN pg_namespace namespace ON namespace.oid=function_row.pronamespace
              WHERE namespace.nspname='public' AND function_row.proname IN (
                'axora_audit_hash','axora_prepare_audit_event','axora_verify_audit_integrity',
                'axora_reject_audit_mutation','axora_rebuild_audit_integrity_after_privacy_purge')),
            'triggers',(SELECT jsonb_agg(pg_get_triggerdef(trigger_row.oid) ORDER BY trigger_row.tgname)
              FROM pg_trigger trigger_row WHERE trigger_row.tgrelid='public.audit_logs'::regclass)
          ) AS state
        `)).rows[0].state;
      }
      const before = await snapshot();
      await db.exec(await readFile(new URL("../database/migrations/140_audit_append_link_verification.sql", import.meta.url), "utf8"));
      expect(await snapshot()).toEqual(before);
      const definition = await db.query<{ stable: string; definer: boolean }>(`
        SELECT provolatile AS stable,prosecdef AS definer FROM pg_proc
        WHERE oid='public.axora_verify_audit_append_integrity(text)'::regprocedure
      `);
      expect(definition.rows[0]).toEqual({ stable: "s", definer: false });
    } finally { await db.close(); }
  }, 120_000);
});
