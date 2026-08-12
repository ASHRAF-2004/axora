import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("account invitation resend resilience", () => {
  it("keeps the authorized resend snapshot behind a narrow capability", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      const result = await db.query<{ execute: boolean; departmentSelect: boolean; definition: string }>(`
        SELECT
          has_function_privilege('axora_app','axora_account_setup_resend_target(uuid,uuid,uuid,timestamptz)','EXECUTE') AS execute,
          has_table_privilege('axora_app','departments','SELECT') AS "departmentSelect",
          pg_get_functiondef('axora_account_setup_resend_target(uuid,uuid,uuid,timestamptz)'::regprocedure) AS definition
      `);
      expect(result.rows[0]?.execute).toBe(true);
      expect(result.rows[0]?.departmentSelect).toBe(false);
      expect(result.rows[0]?.definition).toContain("axora_lock_user_target_access");
      expect(result.rows[0]?.definition).toContain("latestDeliveryStatus");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("uses one locked snapshot and a structured client action", async () => {
    const setup = await source("src/lib/account-setup.ts");
    const action = await source("src/app/(portal)/users/actions.ts");
    const form = await source("src/components/InvitationResendForm.tsx");
    expect(setup).toContain("lockAuthorizedInvitationResendTarget(");
    expect(setup).not.toContain("const targetResult = await client.query<ExistingInvitationTarget>");
    expect(setup).toContain("assertInvitationMayBeReplaced(target)");
    expect(action).toContain("Promise<InvitationResendActionState>");
    expect(action).toContain('return { status: "error", code: error.reason }');
    expect(form).toContain("useActionState(");
    expect(form).toContain('data-draft-ignore="true"');
  });
});
