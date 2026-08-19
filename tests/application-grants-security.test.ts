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
    visitor_state_select: boolean;
    visitor_claims_select: boolean;
    visitor_tokens_select: boolean;
    permission_override_select: boolean;
    approval_limit_select: boolean;
    delegated_access_select: boolean;
    permission_history_select: boolean;
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
        'axora_app','public_visitor_counter_state','SELECT'
      ) AS visitor_state_select,
      has_table_privilege(
        'axora_app','public_visitor_claims','SELECT'
      ) AS visitor_claims_select,
      has_table_privilege(
        'axora_app','public_visitor_claim_tokens','SELECT'
      ) AS visitor_tokens_select,
      has_table_privilege(
        'axora_app','user_permission_overrides','SELECT'
      ) AS permission_override_select,
      has_table_privilege(
        'axora_app','approval_limits','SELECT'
      ) AS approval_limit_select,
      has_table_privilege(
        'axora_app','delegated_access','SELECT'
      ) AS delegated_access_select,
      has_table_privilege(
        'axora_app','permission_change_history','SELECT'
      ) AS permission_history_select,
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
    visitor_state_select: false,
    visitor_claims_select: false,
    visitor_tokens_select: false,
    permission_override_select: false,
    approval_limit_select: false,
    delegated_access_select: false,
    permission_history_select: false,
    audit_insert: false,
  });

  const functions = await db.query<{
    workflow_enqueue: boolean;
    workflow_claim: boolean;
    received_quantity: boolean;
    suppression_check: boolean;
    resend_provider_record: boolean;
    retired_cloudflare_provider_record: boolean;
    visitor_snapshot: boolean;
    visitor_claim: boolean;
    access_administration_snapshot: boolean;
    organization_directory: boolean;
    organization_resource: boolean;
    request_access_rows: boolean;
    request_resource: boolean;
    request_lock: boolean;
    request_creation_lock: boolean;
    request_permission_internal: boolean;
    request_scope_internal: boolean;
    request_trigger_internal: boolean;
    live_authorization_internal: boolean;
    organization_resolver_internal: boolean;
    raw_received: boolean;
    raw_recipient_scope: boolean;
    fingerprint: boolean;
    receipt_trigger: boolean;
    support_summary: boolean;
    support_audit: boolean;
    support_actor_helper: boolean;
    session_audit_trigger: boolean;
    visitor_counter_trigger: boolean;
    visitor_claim_trigger: boolean;
    deletion_cleanup_claim: boolean;
    deletion_cleanup_table: boolean;
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
        'axora_record_resend_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)',
        'EXECUTE'
      ) AS resend_provider_record,
      has_function_privilege(
        'axora_app',
        'axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)',
        'EXECUTE'
      ) AS retired_cloudflare_provider_record,
      has_function_privilege(
        'axora_app',
        'axora_public_visitor_snapshot_v3(text)','EXECUTE'
      ) AS visitor_snapshot,
      has_function_privilege(
        'axora_app',
        'axora_claim_public_visitor_v3(text,text,text,timestamptz,text)',
        'EXECUTE'
      ) AS visitor_claim,
      has_function_privilege(
        'axora_app',
        'axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz)',
        'EXECUTE'
      ) AS access_administration_snapshot,
      has_function_privilege(
        'axora_app',
        'axora_organization_directory_snapshot(uuid,uuid,timestamptz)',
        'EXECUTE'
      ) AS organization_directory,
      has_function_privilege(
        'axora_app',
        'axora_organization_resource_access(uuid,uuid,text,text,uuid,timestamptz)',
        'EXECUTE'
      ) AS organization_resource,
      has_function_privilege(
        'axora_app',
        'axora_request_access_rows(uuid,uuid,timestamptz)',
        'EXECUTE'
      ) AS request_access_rows,
      has_function_privilege(
        'axora_app',
        'axora_request_resource_access(uuid,uuid,text,uuid,timestamptz)',
        'EXECUTE'
      ) AS request_resource,
      has_function_privilege(
        'axora_app',
        'axora_lock_request_resource_access(uuid,uuid,text,uuid,timestamptz)',
        'EXECUTE'
      ) AS request_lock,
      has_function_privilege(
        'axora_app',
        'axora_lock_request_creation_scope(uuid,uuid,uuid,uuid,uuid,timestamptz)',
        'EXECUTE'
      ) AS request_creation_lock,
      has_function_privilege(
        'axora_app',
        'axora_request_permission_is_effective(jsonb,uuid,text,uuid,uuid,uuid,uuid)',
        'EXECUTE'
      ) AS request_permission_internal,
      has_function_privilege(
        'axora_app','axora_request_scope_type(uuid)','EXECUTE'
      ) AS request_scope_internal,
      has_function_privilege(
        'axora_app','axora_validate_request_department_scope()','EXECUTE'
      ) AS request_trigger_internal,
      has_function_privilege(
        'axora_app',
        'axora_live_authorization_snapshot(uuid,uuid,timestamptz)',
        'EXECUTE'
      ) AS live_authorization_internal,
      has_function_privilege(
        'axora_app',
        'axora_resolve_organization_resource_scope(text,uuid)',
        'EXECUTE'
      ) AS organization_resolver_internal,
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
      ) AS session_audit_trigger,
      has_function_privilege(
        'axora_app','protect_public_visitor_counter_state()','EXECUTE'
      ) AS visitor_counter_trigger,
      has_function_privilege(
        'axora_app','reject_public_visitor_claim_mutation()','EXECUTE'
      ) AS visitor_claim_trigger,
      has_function_privilege(
        'axora_app',
        'axora_claim_company_deletion_cleanup_task(text,integer,timestamptz)',
        'EXECUTE'
      ) AS deletion_cleanup_claim,
      has_table_privilege(
        'axora_app','company_deletion_cleanup_tasks','SELECT'
      ) AS deletion_cleanup_table
  `);
  expect(functions.rows[0]).toEqual({
    workflow_enqueue: true,
    workflow_claim: true,
    received_quantity: true,
    suppression_check: true,
    resend_provider_record: true,
    retired_cloudflare_provider_record: false,
    visitor_snapshot: true,
    visitor_claim: true,
    access_administration_snapshot: true,
    organization_directory: true,
    organization_resource: true,
    request_access_rows: true,
    request_resource: true,
    request_lock: true,
    request_creation_lock: true,
    request_permission_internal: false,
    request_scope_internal: false,
    request_trigger_internal: false,
    live_authorization_internal: false,
    organization_resolver_internal: false,
    raw_received: false,
    raw_recipient_scope: false,
    fingerprint: false,
    receipt_trigger: false,
    support_summary: true,
    support_audit: true,
    support_actor_helper: false,
    session_audit_trigger: false,
    visitor_counter_trigger: false,
    visitor_claim_trigger: false,
    deletion_cleanup_claim: false,
    deletion_cleanup_table: false,
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
      expect(source).toContain("public.public_visitor_claims");
      expect(source).toContain("public.axora_support_system_summary()");
      expect(source).toContain(
        "public.axora_record_support_audit(text,uuid,boolean,integer,text)",
      );
      expect(source).toContain("public.audit_user_session_revocation()");
      expect(source).toContain(
        "public.axora_public_visitor_snapshot_v3(text)",
      );
      expect(source).toContain(
        "public.axora_access_administration_snapshot(",
      );
      expect(source).toContain(
        "public.axora_organization_directory_snapshot(",
      );
      expect(source).toContain(
        "public.axora_organization_resource_access(",
      );
      expect(source).toContain("public.axora_request_access_rows(");
      expect(source).toContain(
        "public.axora_request_resource_access(",
      );
      expect(source).toContain(
        "public.axora_lock_request_resource_access(",
      );
      expect(source).toContain(
        "public.axora_lock_request_creation_scope(",
      );
      expect(source).toContain("public.axora_record_resend_email_event(");
      await expectSensitiveBoundary(db);
    } finally {
      await db.close();
    }
  }, 30_000);
});
