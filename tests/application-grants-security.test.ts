import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const grantScriptUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

async function applyApplicationGrantScript(db: PGlite) {
  const source = await readFile(grantScriptUrl, "utf8");
  // PGlite executes PostgreSQL SQL rather than psql backslash commands. The
  // only omitted command executes the preceding, already-inspected CONNECT
  // grant; every schema/table/function/default-privilege statement below is
  // the real deployment script text.
  const executable = source
    .split("\n")
    .filter((line) => (
      !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
    ))
    .join("\n");
  await db.exec(executable);
  return source;
}

async function expectSensitiveBoundary(db: PGlite) {
  const tables = await db.query<{
    ordinary_select: boolean;
    workflow_select: boolean;
    baseline_select: boolean;
    baseline_insert: boolean;
    source_select: boolean;
    provider_select: boolean;
    suppression_select: boolean;
    lifecycle_select: boolean;
    audit_insert: boolean;
  }>(`
    SELECT
      has_table_privilege('axora_app','requests','SELECT') AS ordinary_select,
      has_table_privilege(
        'axora_app','workflow_email_outbox','SELECT'
      ) AS workflow_select,
      has_table_privilege(
        'axora_app','request_line_receipt_baselines','SELECT'
      ) AS baseline_select,
      has_table_privilege(
        'axora_app','request_line_receipt_baselines','INSERT'
      ) AS baseline_insert,
      has_table_privilege(
        'axora_app','request_line_receipt_baseline_sources','SELECT'
      ) AS source_select,
      has_table_privilege(
        'axora_app','email_provider_events','SELECT'
      ) AS provider_select,
      has_table_privilege(
        'axora_app','email_recipient_suppressions','SELECT'
      ) AS suppression_select,
      has_table_privilege(
        'axora_app','email_provider_delivery_lifecycle','SELECT'
      ) AS lifecycle_select,
      has_table_privilege(
        'axora_app','audit_logs','INSERT'
      ) AS audit_insert
  `);
  expect(tables.rows[0]).toEqual({
    ordinary_select: true,
    workflow_select: false,
    baseline_select: false,
    baseline_insert: false,
    source_select: false,
    provider_select: false,
    suppression_select: false,
    lifecycle_select: false,
    audit_insert: false,
  });

  const functions = await db.query<{
    workflow_enqueue: boolean;
    workflow_claim: boolean;
    received_quantity: boolean;
    suppression_check: boolean;
    provider_record: boolean;
    raw_received: boolean;
    raw_recipient_scope: boolean;
    fingerprint: boolean;
    receipt_trigger: boolean;
    support_summary: boolean;
    support_audit: boolean;
    support_actor_helper: boolean;
    session_audit_trigger: boolean;
  }>(`
    SELECT
      has_function_privilege(
        'axora_app',
        'axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text)',
        'EXECUTE'
      ) AS workflow_enqueue,
      has_function_privilege(
        'axora_app','axora_claim_workflow_email(integer,integer)','EXECUTE'
      ) AS workflow_claim,
      has_function_privilege(
        'axora_app','axora_received_quantity(uuid)','EXECUTE'
      ) AS received_quantity,
      has_function_privilege(
        'axora_app','axora_email_recipient_is_suppressed(text)','EXECUTE'
      ) AS suppression_check,
      has_function_privilege(
        'axora_app',
        'axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)',
        'EXECUTE'
      ) AS provider_record,
      has_function_privilege(
        'axora_app',
        'axora_effective_received_quantity_internal(uuid)','EXECUTE'
      ) AS raw_received,
      has_function_privilege(
        'axora_app',
        'axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid)',
        'EXECUTE'
      ) AS raw_recipient_scope,
      has_function_privilege(
        'axora_app','axora_email_recipient_fingerprint(text)','EXECUTE'
      ) AS fingerprint,
      has_function_privilege(
        'axora_app','validate_receipt_line()','EXECUTE'
      ) AS receipt_trigger,
      has_function_privilege(
        'axora_app','axora_support_system_summary()','EXECUTE'
      ) AS support_summary,
      has_function_privilege(
        'axora_app',
        'axora_record_support_audit(text,uuid,boolean,integer,text)',
        'EXECUTE'
      ) AS support_audit,
      has_function_privilege(
        'axora_app','axora_authorized_support_actor()','EXECUTE'
      ) AS support_actor_helper,
      has_function_privilege(
        'axora_app','audit_user_session_revocation()','EXECUTE'
      ) AS session_audit_trigger
  `);
  expect(functions.rows[0]).toEqual({
    workflow_enqueue: true,
    workflow_claim: true,
    received_quantity: true,
    suppression_check: true,
    provider_record: true,
    raw_received: false,
    raw_recipient_scope: false,
    fingerprint: false,
    receipt_trigger: false,
    support_summary: true,
    support_audit: true,
    support_actor_helper: false,
    session_audit_trigger: false,
  });
}

describe("application database grant boundaries", () => {
  it("keeps sensitive capabilities narrow on a fresh migration install", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await expectSensitiveBoundary(db);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("preserves the same boundary when deployment/reset reapplies real grants", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const source = await applyApplicationGrantScript(db);
      expect(source).toContain("REVOKE ALL ON TABLE");
      expect(source).toContain("public.request_line_receipt_baselines");
      expect(source).toContain("public.email_recipient_suppressions");
      expect(source).toContain("public.axora_support_system_summary()");
      expect(source).toContain(
        "public.axora_record_support_audit(text,uuid,boolean,integer,text)",
      );
      expect(source).toContain("public.audit_user_session_revocation()");
      await expectSensitiveBoundary(db);
    } finally {
      await db.close();
    }
  }, 30_000);
});
