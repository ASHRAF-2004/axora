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

describe("P0-02 capability grant reapplication", () => {
  it("preserves only the intended operational and user commands", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await db.exec(`
        CREATE TABLE schema_migrations(
          filename text PRIMARY KEY,
          sha256 text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const source = await applyApplicationGrantScript(db);
      expect(source).toContain("axora_operation_request_access_rows");
      expect(source).toContain("axora_lock_user_creation_scope");

      const result = await db.query<{
        operationRows: boolean;
        lineLock: boolean;
        quotationLock: boolean;
        invoiceLock: boolean;
        userRows: boolean;
        userLock: boolean;
        userCreation: boolean;
        publicOperationRows: boolean;
        publicUserLock: boolean;
        publicUserCreation: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_operation_request_access_rows(uuid,uuid,text,timestamptz)',
            'EXECUTE'
          ) AS "operationRows",
          has_function_privilege(
            'axora_app',
            'axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "lineLock",
          has_function_privilege(
            'axora_app',
            'axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "quotationLock",
          has_function_privilege(
            'axora_app',
            'axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "invoiceLock",
          has_function_privilege(
            'axora_app',
            'axora_user_directory_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "userRows",
          has_function_privilege(
            'axora_app',
            'axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "userLock",
          has_function_privilege(
            'axora_app',
            'axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "userCreation",
          has_function_privilege(
            'public',
            'axora_operation_request_access_rows(uuid,uuid,text,timestamptz)',
            'EXECUTE'
          ) AS "publicOperationRows",
          has_function_privilege(
            'public',
            'axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicUserLock",
          has_function_privilege(
            'public',
            'axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicUserCreation"
      `);
      expect(result.rows[0]).toEqual({
        operationRows: true,
        lineLock: true,
        quotationLock: true,
        invoiceLock: true,
        userRows: true,
        userLock: true,
        userCreation: true,
        publicOperationRows: false,
        publicUserLock: false,
        publicUserCreation: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
