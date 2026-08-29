import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const grantScriptUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

async function applyCanonicalGrantPolicy(db: PGlite) {
  const source = await readFile(grantScriptUrl, "utf8");
  await db.exec(source
    .split("\n")
    .filter((line) => (
      !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
    ))
    .join("\n"));
}

describe("cleanup-worker grant reconciliation", () => {
  it("preserves only the user and company deletion lease capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await db.exec("CREATE ROLE axora_cleanup_worker NOLOGIN");
      await applyMigrations(db);
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await applyCanonicalGrantPolicy(db);

      const result = await db.query<{
        user_claim: boolean;
        user_complete: boolean;
        user_fail: boolean;
        user_reconcile: boolean;
        company_claim: boolean;
        user_table: boolean;
        company_table: boolean;
        app_user_claim: boolean;
        app_user_table: boolean;
        app_remove_account: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_cleanup_worker',
            'axora_claim_user_deletion_cleanup_task(text,integer,timestamptz)',
            'EXECUTE'
          ) AS user_claim,
          has_function_privilege(
            'axora_cleanup_worker',
            'axora_complete_user_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz)',
            'EXECUTE'
          ) AS user_complete,
          has_function_privilege(
            'axora_cleanup_worker',
            'axora_fail_user_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz)',
            'EXECUTE'
          ) AS user_fail,
          has_function_privilege(
            'axora_cleanup_worker',
            'axora_reconcile_user_deletion_cleanup_tasks(timestamptz)',
            'EXECUTE'
          ) AS user_reconcile,
          has_function_privilege(
            'axora_cleanup_worker',
            'axora_claim_company_deletion_cleanup_task(text,integer,timestamptz)',
            'EXECUTE'
          ) AS company_claim,
          has_table_privilege(
            'axora_cleanup_worker',
            'user_deletion_cleanup_tasks',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS user_table,
          has_table_privilege(
            'axora_cleanup_worker',
            'company_deletion_cleanup_tasks',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS company_table,
          has_function_privilege(
            'axora_app',
            'axora_claim_user_deletion_cleanup_task(text,integer,timestamptz)',
            'EXECUTE'
          ) AS app_user_claim,
          has_table_privilege(
            'axora_app',
            'user_deletion_cleanup_tasks',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS app_user_table,
          has_function_privilege(
            'axora_app',
            'axora_remove_user_account(uuid,uuid,uuid,text,timestamptz)',
            'EXECUTE'
          ) AS app_remove_account
      `);

      expect(result.rows[0]).toEqual({
        user_claim: true,
        user_complete: true,
        user_fail: true,
        user_reconcile: false,
        company_claim: true,
        user_table: false,
        company_table: false,
        app_user_claim: false,
        app_user_table: false,
        app_remove_account: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
