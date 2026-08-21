import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/063_fulfilment_delivery_execution.sql",
  import.meta.url,
);

describe("canonical fulfilment delivery execution migration", () => {
  it("migrates populated legacy jobs forward without replacing tenant data", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "062_budget_worker_claim_disambiguation.sql" });
      await applyDemoSeed(db);
      const scope = await db.query<{ request_id: string; company_id: string; branch_id: string }>(`
        SELECT id AS request_id,company_id,branch_id FROM requests
        ORDER BY created_at,id LIMIT 1
      `);
      const ids = scope.rows[0];
      await db.exec(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at
        ) SELECT 'd1000000-0000-4000-8000-000000000001',
          'delivery-migration-owner@example.test','Delivery migration owner',
          'not-a-real-hash',id,true,'PLATFORM','ACTIVE',now()
        FROM roles WHERE role_key='PLATFORM_OWNER';
      `);
      await db.query(`
        INSERT INTO delivery_jobs(
          id,company_id,branch_id,request_id,job_code,status,
          scheduled_window_start,scheduled_window_end,
          delivery_address_snapshot,idempotency_key,created_by
        ) VALUES (
          'd2000000-0000-4000-8000-000000000001',$1,$2,$3,
          'DEL-LEGACY-PRESERVED','CREATED','2026-08-14T01:00:00Z',
          '2026-08-14T03:00:00Z','Preserved delivery address',
          'delivery-legacy-preserved',
          'd1000000-0000-4000-8000-000000000001'
        )
      `, [ids.company_id, ids.branch_id, ids.request_id]);

      await db.exec(await readFile(migrationUrl, "utf8"));
      const migrated = await db.query<{
        status: string; workflow_version: number; destination_timezone: string;
        local_start: string; local_date: string; proof_policy: string[];
      }>(`
        SELECT status,workflow_version,destination_timezone,
          scheduled_local_start::text AS local_start,
          scheduled_local_date::text AS local_date,proof_policy
        FROM delivery_jobs WHERE id='d2000000-0000-4000-8000-000000000001'
      `);
      expect(migrated.rows[0]).toMatchObject({
        status: "AWAITING_ASSIGNMENT",
        workflow_version: 1,
        local_start: "2026-08-14 09:00:00",
        local_date: "2026-08-14",
        proof_policy: ["PHOTO"],
      });
      expect(migrated.rows[0].destination_timezone).toBe("Asia/Kuala_Lumpur");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("owns transitions, idempotency, proof, OTP and exact-scope access in database capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      const definitions = await db.query<{
        record_event: string; assign_job: string; proof_guard: string;
        driver_scope: string; actual_submit: string; evidence_file: string;
      }>(`
        SELECT
          pg_get_functiondef('axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz)'::regprocedure) AS record_event,
          pg_get_functiondef('axora_assign_delivery_job(uuid,uuid,uuid,uuid,uuid,integer,text,timestamptz,text,text,text,text[],uuid,timestamptz)'::regprocedure) AS assign_job,
          pg_get_functiondef('axora_delivery_job_has_required_proof(uuid)'::regprocedure) AS proof_guard,
          pg_get_functiondef('axora_context_is_job_driver(uuid,uuid)'::regprocedure) AS driver_scope,
          pg_get_functiondef('axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz)'::regprocedure) AS actual_submit,
          pg_get_functiondef('axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz)'::regprocedure) AS evidence_file
      `);
      const row = definitions.rows[0];
      expect(row.record_event).toContain("job.workflow_version<>p_expected_workflow_version");
      expect(row.record_event).toContain("public.axora_begin_delivery_command");
      expect(row.record_event).toContain("SHOPPING_STARTED");
      expect(row.record_event).toContain("OUT_FOR_DELIVERY");
      expect(row.record_event).toContain("axora_delivery_job_has_required_proof");
      expect(row.assign_job).toContain("delivery.assign");
      expect(row.assign_job).toContain("driver_role_assignment_id");
      expect(row.assign_job).toContain("fulfilment_purchase_assignments");
      expect(row.proof_guard).toContain("delivery_otp_challenges");
      expect(row.proof_guard).toContain("delivery_proof_exceptions");
      expect(row.driver_scope).toContain("assignment.ended_at IS NULL");
      expect(row.driver_scope).toContain("axora_context_role_assignment_id");
      expect(row.actual_submit).toContain("'delivery.shop','DELIVERY'");
      expect(row.evidence_file).toContain("'delivery.view','BRANCH'");
      expect(row.evidence_file).toContain("CLIENT_ACCOUNT_MANAGER");
      expect(row.evidence_file).toContain("driver_role_assignment_id");

      const security = await db.query<{
        otp_code_column: number; commands_select: boolean; otp_select: boolean;
        event_execute: boolean; evidence_execute: boolean; rls: boolean;
      }>(`
        SELECT
          (SELECT count(*)::int FROM information_schema.columns
            WHERE table_name='delivery_otp_challenges'
              AND column_name IN ('code','plaintext_code')) AS otp_code_column,
          has_table_privilege('axora_app','delivery_workflow_commands','SELECT') AS commands_select,
          has_table_privilege('axora_app','delivery_otp_challenges','SELECT') AS otp_select,
          has_function_privilege('axora_app',
            'axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz)','EXECUTE') AS event_execute,
          has_function_privilege('axora_app',
            'axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz)','EXECUTE') AS evidence_execute,
          (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
            FROM pg_class WHERE relname IN (
              'delivery_workflow_commands','delivery_otp_challenges',
              'delivery_otp_events','delivery_proof_exceptions'
            )) AS rls
      `);
      expect(security.rows[0]).toEqual({
        otp_code_column: 0,
        commands_select: false,
        otp_select: false,
        event_execute: true,
        evidence_execute: true,
        rls: true,
      });

      const appendOnly = await db.query<{ exceptions: string; otp_events: string }>(`
        SELECT
          pg_get_triggerdef((SELECT oid FROM pg_trigger
            WHERE tgname='delivery_proof_exceptions_append_only')) AS exceptions,
          pg_get_triggerdef((SELECT oid FROM pg_trigger
            WHERE tgname='delivery_otp_events_append_only')) AS otp_events
      `);
      expect(appendOnly.rows[0].exceptions).toContain("reject_append_only_mutation");
      expect(appendOnly.rows[0].otp_events).toContain("reject_append_only_mutation");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects invalid canonical states, proof dimensions and plaintext OTP-shaped columns", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      const checks = await db.query<{ job: string; dimensions: string; signature: string }>(`
        SELECT
          pg_get_constraintdef((SELECT oid FROM pg_constraint
            WHERE conname='delivery_jobs_status_check')) AS job,
          pg_get_constraintdef((SELECT oid FROM pg_constraint
            WHERE conname='delivery_evidence_dimensions_check')) AS dimensions,
          pg_get_constraintdef((SELECT oid FROM pg_constraint
            WHERE conname='delivery_evidence_signature_consent_check')) AS signature
      `);
      expect(checks.rows[0].job).toContain("AWAITING_SUBSTITUTE_APPROVAL");
      expect(checks.rows[0].job).toContain("COMPLETED");
      expect(checks.rows[0].dimensions).toContain("12000");
      expect(checks.rows[0].signature).toContain("consented_at IS NOT NULL");
    } finally {
      await db.close();
    }
  }, 30_000);
});
