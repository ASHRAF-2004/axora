import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe("Requests canonical order workspace migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
  });

  afterEach(async () => db.close());

  it("moves receiving-only users into scoped Requests and enables CAM invoice projection", async () => {
    const result = await db.query<{ role_key: string; permission_code: string }>(`
      SELECT role.role_key,permission.permission_code
      FROM public.role_permissions role_permission
      JOIN public.roles role ON role.id=role_permission.role_id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE (role.role_key='RECEIVING_USER' AND permission.permission_code='request.view')
         OR (role.role_key='CLIENT_ACCOUNT_MANAGER' AND permission.permission_code='finance.invoice.view')
      ORDER BY role.role_key
    `);
    expect(result.rows).toEqual([
      { role_key: "CLIENT_ACCOUNT_MANAGER", permission_code: "finance.invoice.view" },
      { role_key: "RECEIVING_USER", permission_code: "request.view" },
    ]);
  });

  it("uses safe SECURITY DEFINER boundaries and revokes PUBLIC execution", async () => {
    const result = await db.query<{
      proname: string; security_definer: boolean; config: string[] | null; public_execute: boolean;
    }>(`
      SELECT procedure.proname,procedure.prosecdef AS security_definer,
        procedure.proconfig AS config,
        has_function_privilege('public',procedure.oid,'EXECUTE') AS public_execute
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='public'
        AND procedure.proname IN (
          'axora_context_can_access_delivery_job',
          'axora_context_can_confirm_delivery_receipt',
          'validate_receipt'
        )
      ORDER BY procedure.proname
    `);
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.security_definer).toBe(true);
      expect(row.config).toContain("search_path=pg_catalog, public, pg_temp");
      expect(row.public_execute).toBe(false);
    }
  });

  it("makes receipt RLS depend on canonical delivery/request capabilities", async () => {
    const result = await db.query<{ policyname: string; qual: string | null; with_check: string | null }>(`
      SELECT policyname,qual,with_check
      FROM pg_policies
      WHERE schemaname='public' AND tablename='receipts'
      ORDER BY policyname
    `);
    expect(result.rows.find((row) => row.policyname === "receipts_read_scope")?.qual)
      .toContain("axora_context_can_access_delivery_job(delivery_job_id)");
    expect(result.rows.find((row) => row.policyname === "receipts_receiver_insert")?.with_check)
      .toContain("axora_context_can_confirm_delivery_receipt(delivery_job_id)");
  });

  it("upgrades the protected-main 123 head without rewriting existing rows", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(upgrade, { through: "123_public_contact_enquiry_contract.sql" });
      const before = await upgrade.query<{ companies: number; receipts: number }>(`
        SELECT (SELECT count(*)::int FROM public.companies) AS companies,
          (SELECT count(*)::int FROM public.receipts) AS receipts
      `);
      await upgrade.exec(await readFile(new URL(
        "../database/migrations/124_requests_canonical_order_workspace.sql",
        import.meta.url,
      ), "utf8"));
      const after = await upgrade.query<{ companies: number; receipts: number; grant_ok: boolean }>(`
        SELECT (SELECT count(*)::int FROM public.companies) AS companies,
          (SELECT count(*)::int FROM public.receipts) AS receipts,
          has_function_privilege('axora_app',
            'public.axora_context_can_confirm_delivery_receipt(uuid)','EXECUTE') AS grant_ok
      `);
      expect(after.rows[0]).toEqual({ ...before.rows[0], grant_ok: true });
    } finally {
      await upgrade.close();
    }
  }, 30_000);
});
