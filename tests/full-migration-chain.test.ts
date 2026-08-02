import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations, migrationFiles } from "./helpers/pglite";

const migrationUrl = (filename: string) =>
  new URL(`../database/migrations/${filename}`, import.meta.url);

describe("complete forward migration chain", () => {
  it("applies every numbered migration through 032 to an empty database", async () => {
    const db = new PGlite();
    try {
      const available = await migrationFiles();
      expect(available.slice(-5)).toEqual([
        "028_email_provider_events_and_suppression.sql",
        "029_delivery_driver_event_evidence.sql",
        "030_email_provider_lifecycle_events.sql",
        "031_support_diagnostics_security.sql",
        "032_user_session_revocation_audit.sql",
      ]);
      expect(new Set(available).size).toBe(available.length);
      expect(new Set(available.map((filename) => filename.slice(0, 3))).size)
        .toBe(available.length);

      const applied = await applyMigrations(db);
      expect(applied).toEqual(available);
      const state = await db.query<{
        table_count: number;
        policy_count: number;
        company_nullable: string;
        customer_match_table: string | null;
      }>(`
        SELECT
          (SELECT count(*)::int FROM information_schema.tables
            WHERE table_schema='public') AS table_count,
          (SELECT count(*)::int FROM pg_policies
            WHERE schemaname='public') AS policy_count,
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='account_setup_invitations'
              AND column_name='company_id') AS company_nullable,
          to_regclass('public.customer_three_way_matches')::text
            AS customer_match_table
      `);
      expect(state.rows[0]).toMatchObject({
        table_count: expect.any(Number),
        policy_count: expect.any(Number),
        company_nullable: "YES",
        customer_match_table: "customer_three_way_matches",
      });
      expect(state.rows[0].table_count).toBeGreaterThanOrEqual(60);
      expect(state.rows[0].policy_count).toBeGreaterThanOrEqual(35);

      await expect(db.query(`
        INSERT INTO public_request_rate_buckets(
          action_key,scope_kind,scope_hash,bucket_started_at
        ) VALUES ('LOGIN','NETWORK',$1,date_trunc('minute',now()))
      `, ["a".repeat(64)])).resolves.not.toThrow();
      await expect(db.query(`
        INSERT INTO public_request_rate_buckets(
          action_key,scope_kind,scope_hash,bucket_started_at
        ) VALUES ('UNSCOPED','NETWORK',$1,date_trunc('minute',now()))
      `, ["b".repeat(64)])).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("upgrades a populated through-022 current-schema fixture without losing data", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "022_authentication_rate_limits.sql" });
      await applyDemoSeed(db);
      await db.exec(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_kind,account_status
        ) SELECT
          'd8000000-0000-4000-8000-000000000001',
          'migration-existing-actor@example.test','Existing workflow actor',
          'not-a-real-hash',id,true,'PLATFORM','ACTIVE'
        FROM roles WHERE role_key='PLATFORM_OWNER';
        INSERT INTO workflow_events(
          company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
          event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
          occurred_at,metadata
        ) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000001','request',
          '50000000-0000-4000-8000-000000000001','request.preexisting',1,
          'd8000000-0000-4000-8000-000000000001','PLATFORM',
          '50000000-0000-4000-8000-000000000001',
          'migration:preexisting-request-event',now(),
          '{"source":"PREEXISTING"}'::jsonb
        );
      `);
      const before = await db.query<{
        requests: number;
        decisions: number;
        events: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM approvals
            WHERE status IN ('Approved','Rejected')) AS decisions,
          (SELECT count(*)::int FROM workflow_events) AS events
      `);
      expect(before.rows[0]).toEqual({ requests: 15, decisions: 13, events: 1 });

      await db.exec(await readFile(
        migrationUrl("023_workflow_event_rls_and_baseline.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("024_canonical_account_invitations.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("025_customer_three_way_matching.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("026_workflow_email_delivery.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("027_receipt_accounting_unification.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("028_email_provider_events_and_suppression.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("029_delivery_driver_event_evidence.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("030_email_provider_lifecycle_events.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("031_support_diagnostics_security.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("032_user_session_revocation_audit.sql"),
        "utf8",
      ));

      const after = await db.query<{
        requests: number;
        decisions: number;
        events: number;
        system_events: number;
        actor_events: number;
        malformed_versions: number;
        match_policies: number;
        receipt_baselines: number;
        receipt_baseline_sources: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM approvals
            WHERE status IN ('Approved','Rejected')) AS decisions,
          (SELECT count(*)::int FROM workflow_events) AS events,
          (SELECT count(*)::int FROM workflow_events
            WHERE actor_kind='SYSTEM') AS system_events,
          (SELECT count(*)::int FROM workflow_events
            WHERE actor_user_id IS NOT NULL) AS actor_events,
          (SELECT count(*)::int FROM (
            SELECT company_id,aggregate_type,aggregate_id,
              min(event_version) AS minimum_version,
              max(event_version) AS maximum_version,
              count(*) AS version_count,
              count(DISTINCT event_version) AS distinct_version_count
            FROM workflow_events
            GROUP BY company_id,aggregate_type,aggregate_id
          ) versioned
          WHERE minimum_version<>1
            OR maximum_version<>version_count
            OR distinct_version_count<>version_count) AS malformed_versions,
          (SELECT count(*)::int FROM pg_policies
            WHERE schemaname='public'
              AND tablename='customer_three_way_matches') AS match_policies,
          (SELECT count(*)::int
            FROM request_line_receipt_baselines) AS receipt_baselines,
          (SELECT count(*)::int
            FROM request_line_receipt_baseline_sources) AS receipt_baseline_sources
      `);
      expect(after.rows[0]).toEqual({
        requests: 15,
        decisions: 13,
        events: 29,
        system_events: 28,
        actor_events: 1,
        malformed_versions: 0,
        match_policies: 3,
        receipt_baselines: 17,
        receipt_baseline_sources: 0,
      });
      const metadata = await db.query<{ bad: number }>(`
        SELECT count(*)::int AS bad FROM workflow_events
        WHERE actor_kind='SYSTEM' AND (
          metadata->>'source'<>'SYSTEM'
          OR metadata->>'newState' IS NULL
        )
      `);
      expect(metadata.rows[0].bad).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps reset and bootstrap migration discovery dynamic through 032", async () => {
    const [initializer, reset, bootstrap] = await Promise.all([
      readFile(new URL("../database/init/01-run-migration.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/production/reset-baseline.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/bootstrap/create_first_platform_owner.mjs", import.meta.url), "utf8"),
    ]);
    expect(initializer).toContain("/migrations/[0-9][0-9][0-9]_*.sql");
    expect(reset).toContain("/database/migrations/[0-9][0-9][0-9]_*.sql");
    expect(initializer).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user/);
    expect(bootstrap).toContain(
      'const REQUIRED_MIGRATION = "032_user_session_revocation_audit.sql"',
    );
    expect(bootstrap).toContain("filenames.slice(0, lastRequired + 1)");
  });
});
