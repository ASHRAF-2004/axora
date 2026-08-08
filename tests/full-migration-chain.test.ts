import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations, migrationFiles } from "./helpers/pglite";

const migrationUrl = (filename: string) =>
  new URL(`../database/migrations/${filename}`, import.meta.url);

describe("complete forward migration chain", () => {
  it("applies every numbered migration through 049 to an empty database", async () => {
    const db = new PGlite();
    try {
      const available = await migrationFiles();
      expect(available.slice(-14)).toEqual([
        "036_authorization_policy_foundation.sql",
        "037_effective_access_snapshot.sql",
        "038_canonical_session_scopes.sql",
        "039_scoped_permission_management.sql",
        "040_approval_limit_management.sql",
        "041_delegated_access_management.sql",
        "042_role_scope_lifecycle.sql",
        "043_access_administration_snapshot.sql",
        "044_organization_resource_isolation.sql",
        "045_request_resource_isolation.sql",
        "046_document_resource_isolation.sql",
        "047_isolation_closure_capabilities.sql",
        "048_isolation_transaction_lock_hardening.sql",
        "049_active_request_write_boundary.sql",
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
        request_department_column: string | null;
        attachment_request_column: string | null;
        operation_capability: string | null;
        user_directory_capability: string | null;
        user_creation_capability: string | null;
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
            AS customer_match_table,
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='requests'
              AND column_name='department_id') AS request_department_column,
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='attachments'
              AND column_name='request_id') AS attachment_request_column,
          to_regprocedure(
            'public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz)'
          )::text AS operation_capability,
          to_regprocedure(
            'public.axora_user_directory_rows(uuid,uuid,timestamptz)'
          )::text AS user_directory_capability,
          to_regprocedure(
            'public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)'
          )::text AS user_creation_capability
      `);
      expect(state.rows[0]).toMatchObject({
        table_count: expect.any(Number),
        policy_count: expect.any(Number),
        company_nullable: "YES",
        customer_match_table: "customer_three_way_matches",
        request_department_column: "YES",
        attachment_request_column: "YES",
        operation_capability:
          "axora_operation_request_access_rows(uuid,uuid,text,timestamp with time zone)",
        user_directory_capability:
          "axora_user_directory_rows(uuid,uuid,timestamp with time zone)",
        user_creation_capability:
          "axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamp with time zone)",
      });
      expect(state.rows[0].table_count).toBeGreaterThanOrEqual(64);
      expect(state.rows[0].policy_count).toBeGreaterThanOrEqual(35);

      await expect(db.query(`
        INSERT INTO public_request_rate_buckets(
          action_key,scope_kind,scope_hash,bucket_started_at
        ) VALUES ('LOGIN','NETWORK',$1,date_trunc('minute',now()))
      `, ["a".repeat(64)])).resolves.not.toThrow();
      await expect(db.query(`
        INSERT INTO public_request_rate_buckets(
          action_key,scope_kind,scope_hash,bucket_started_at
        ) VALUES ('VISITOR_CHOICE','NETWORK',$1,date_trunc('minute',now()))
      `, ["c".repeat(64)])).resolves.not.toThrow();
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
      await db.exec(await readFile(
        migrationUrl("033_public_visitor_choice_counter.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("034_public_visitor_network_fallback.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("035_public_visitor_network_uniqueness.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("036_authorization_policy_foundation.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("037_effective_access_snapshot.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("038_canonical_session_scopes.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("039_scoped_permission_management.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("040_approval_limit_management.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("041_delegated_access_management.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("042_role_scope_lifecycle.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("043_access_administration_snapshot.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("044_organization_resource_isolation.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("045_request_resource_isolation.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("046_document_resource_isolation.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("047_isolation_closure_capabilities.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("048_isolation_transaction_lock_hardening.sql"),
        "utf8",
      ));
      await db.exec(await readFile(
        migrationUrl("049_active_request_write_boundary.sql"),
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
        canonical_departments: number;
        canonical_attachments: number;
        closure_capabilities: number;
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
            FROM request_line_receipt_baseline_sources) AS receipt_baseline_sources,
          (SELECT count(*)::int FROM requests
            WHERE department_id IS NOT NULL) AS canonical_departments,
          (SELECT count(*)::int FROM attachments
            WHERE request_id IS NOT NULL) AS canonical_attachments,
          (SELECT count(*)::int FROM pg_proc
            WHERE proname IN (
              'axora_operation_request_access_rows',
              'axora_lock_request_line_access',
              'axora_lock_quotation_access',
              'axora_lock_invoice_access',
              'axora_user_directory_rows',
              'axora_lock_user_target_access',
              'axora_lock_user_creation_scope'
            )) AS closure_capabilities
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
        canonical_departments: 0,
        canonical_attachments: 0,
        closure_capabilities: 7,
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

  it("keeps reset migration discovery dynamic through 049 while bootstrap retains its 032 minimum", async () => {
    const [initializer, reset, bootstrap] = await Promise.all([
      readFile(new URL("../database/init/01-run-migration.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/production/reset-baseline.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/bootstrap/create_first_platform_owner.mjs", import.meta.url), "utf8"),
    ]);
    expect(initializer).toContain("/migrations/[0-9][0-9][0-9]_*.sql");
    expect(reset).toContain("/database/migrations/[0-9][0-9][0-9]_*.sql");
    expect(initializer).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective|038_canonical|039_scoped|040_approval|041_delegated|042_role|043_access|044_organization|045_request|046_document|047_isolation|048_isolation|049_active/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective|038_canonical|039_scoped|040_approval|041_delegated|042_role|043_access|044_organization|045_request|046_document|047_isolation|048_isolation|049_active/);
    expect(bootstrap).toContain(
      'const REQUIRED_MIGRATION = "032_user_session_revocation_audit.sql"',
    );
    expect(bootstrap).toContain("filenames.slice(0, lastRequired + 1)");
  });
});
