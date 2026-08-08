import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/064_versioned_generated_documents.sql",
  import.meta.url,
);

describe("versioned generated documents migration", () => {
  it("migrates populated procurement data forward without replacing tenant records", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "063_fulfilment_delivery_execution.sql" });
      await applyDemoSeed(db);
      const before = await db.query<{ companies: number; requests: number; lines: number }>(`
        SELECT
          (SELECT count(*)::int FROM companies) AS companies,
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM request_lines) AS lines
      `);

      await db.exec(await readFile(migrationUrl, "utf8"));

      const after = await db.query<{
        companies: number; requests: number; lines: number;
        templates: number; budget_visible: boolean; receipt_policy: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM companies) AS companies,
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM request_lines) AS lines,
          (SELECT count(*)::int FROM document_templates WHERE active) AS templates,
          (SELECT bool_and(NOT document_budget_balance_visible) FROM companies) AS budget_visible,
          (SELECT min(document_receipt_policy) FROM companies) AS receipt_policy
      `);
      expect(after.rows[0]).toMatchObject({
        ...before.rows[0],
        templates: 3,
        budget_visible: true,
        receipt_policy: "REFERENCE_ONLY",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps snapshots and storage metadata private behind live authorization capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);

      const security = await db.query<{
        protected_tables: number; raw_select: boolean; raw_mutation: boolean;
        download_execute: boolean; workspace_execute: boolean;
        internal_builder_execute: boolean; append_only_triggers: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM pg_class
            WHERE relname IN (
              'document_templates','document_generation_jobs','generated_documents',
              'supplier_purchase_order_workflows','document_generation_events',
              'supplier_purchase_order_events','document_enqueue_failures'
            ) AND relrowsecurity AND relforcerowsecurity) AS protected_tables,
          EXISTS (
            SELECT 1 FROM information_schema.table_privileges
            WHERE grantee='axora_app'
              AND table_name IN (
                'document_generation_jobs','generated_documents',
                'supplier_purchase_order_workflows','document_generation_events',
                'supplier_purchase_order_events','document_enqueue_failures'
              ) AND privilege_type='SELECT'
          ) AS raw_select,
          EXISTS (
            SELECT 1 FROM information_schema.table_privileges
            WHERE grantee='axora_app'
              AND table_name IN (
                'document_generation_jobs','generated_documents',
                'supplier_purchase_order_workflows','document_generation_events',
                'supplier_purchase_order_events','document_enqueue_failures'
              ) AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
          ) AS raw_mutation,
          (SELECT bool_and(has_function_privilege('axora_app',p.oid,'EXECUTE'))
            FROM pg_proc p WHERE p.proname='axora_generated_document_download') AS download_execute,
          (SELECT bool_and(has_function_privilege('axora_app',p.oid,'EXECUTE'))
            FROM pg_proc p WHERE p.proname='axora_generated_document_workspace') AS workspace_execute,
          (SELECT bool_or(has_function_privilege('axora_app',p.oid,'EXECUTE'))
            FROM pg_proc p WHERE p.proname LIKE 'axora_build_%_document_snapshot') AS internal_builder_execute,
          (SELECT count(*)::int FROM pg_trigger
            WHERE tgname IN (
              'document_generation_events_append_only',
              'supplier_po_events_append_only',
              'document_enqueue_failures_append_only'
            ) AND NOT tgisinternal) AS append_only_triggers
      `);
      expect(security.rows[0]).toEqual({
        protected_tables: 7,
        raw_select: false,
        raw_mutation: false,
        download_execute: true,
        workspace_execute: true,
        internal_builder_execute: false,
        append_only_triggers: 3,
      });

      const definitions = await db.query<{
        download: string; access: string; workspace: string; dispatch: string;
        approved_snapshot: string; final_snapshot: string; supplier_snapshot: string;
      }>(`
        SELECT
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_generated_document_download' LIMIT 1) AS download,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_generated_document_access_allowed' LIMIT 1) AS access,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_generated_document_workspace' LIMIT 1) AS workspace,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_manage_supplier_purchase_order' LIMIT 1) AS dispatch,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_build_approved_request_document_snapshot' LIMIT 1) AS approved_snapshot,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_build_final_delivery_document_snapshot' LIMIT 1) AS final_snapshot,
          (SELECT pg_get_functiondef(oid) FROM pg_proc
            WHERE proname='axora_build_supplier_po_document_snapshot' LIMIT 1) AS supplier_snapshot
      `);
      expect(definitions.rows[0].download).toContain("axora_generated_document_access_allowed");
      expect(definitions.rows[0].access).toContain("axora_document_request_permission");
      expect(definitions.rows[0].access).toContain("supplier_memberships");
      expect(definitions.rows[0].workspace).toContain("axora_generated_document_access_allowed");
      expect(definitions.rows[0].dispatch).toContain("email_verified_at IS NOT NULL");
      expect(definitions.rows[0].dispatch).toContain("axora_email_recipient_is_suppressed");
      expect(definitions.rows[0].dispatch).toContain("document.dispatch.supplier");
      expect(definitions.rows[0].approved_snapshot).not.toMatch(/buy_unit_price|base_unit_price|margin_amount/i);
      expect(definitions.rows[0].final_snapshot).not.toMatch(/actual_buy_unit_price|actual_markup_amount/i);
      expect(definitions.rows[0].supplier_snapshot).not.toMatch(/budget|contractual_credit_ceiling|margin_amount/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects forbidden nested commercial data and owns document state/version idempotency", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await expect(db.query(`
        SELECT axora_assert_document_snapshot_safe(
          'APPROVED_REQUEST',
          '{"request":{"lines":[{"buy_unit_price":12.50}]}}'::jsonb
        )
      `)).rejects.toThrow(/forbidden/i);
      await expect(db.query(`
        SELECT axora_assert_document_snapshot_safe(
          'SUPPLIER_PURCHASE_ORDER',
          '{"supplier":{"name":"Verified supplier"},"lines":[{"quantity":2}]}'::jsonb
        )
      `)).resolves.toBeDefined();

      const constraints = await db.query<{
        po_states: string; job_states: string; immutable_versions: number;
        approval_trigger: number; final_triggers: number;
      }>(`
        SELECT
          (SELECT string_agg(pg_get_constraintdef(oid),' ')
            FROM pg_constraint
            WHERE conrelid='supplier_purchase_order_workflows'::regclass
              AND contype='c') AS po_states,
          (SELECT string_agg(pg_get_constraintdef(oid),' ')
            FROM pg_constraint
            WHERE conrelid='document_generation_jobs'::regclass
              AND contype='c') AS job_states,
          (SELECT count(*)::int FROM pg_indexes
            WHERE indexname='generated_documents_one_current_idx'
              AND indexdef LIKE '%UNIQUE%') AS immutable_versions,
          (SELECT count(*)::int FROM pg_trigger
            WHERE tgname='request_approval_enqueue_generated_documents'
              AND NOT tgisinternal) AS approval_trigger,
          (SELECT count(*)::int FROM pg_trigger
            WHERE tgname IN (
              'request_actual_enqueue_final_document',
              'delivery_job_enqueue_final_document'
            )
              AND NOT tgisinternal) AS final_triggers
      `);
      expect(constraints.rows[0].po_states).toContain("READY_FOR_SALES_REVIEW");
      expect(constraints.rows[0].po_states).toContain("APPROVED_FOR_DISPATCH");
      expect(constraints.rows[0].po_states).toContain("DISPATCHED_TO_SUPPLIER");
      expect(constraints.rows[0].po_states).toContain("ACKNOWLEDGED");
      expect(constraints.rows[0].po_states).toContain("AMENDED");
      expect(constraints.rows[0].po_states).toContain("CANCELLED");
      expect(constraints.rows[0].job_states).toContain("PENDING");
      expect(constraints.rows[0].job_states).toContain("COMPLETED");
      expect(constraints.rows[0].job_states).toContain("FAILED");
      expect(constraints.rows[0]).toMatchObject({
        immutable_versions: 1,
        approval_trigger: 1,
        final_triggers: 2,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
