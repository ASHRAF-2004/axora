import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/074_remove_supplier_actor.sql",
  import.meta.url,
);

describe("supplier actor removal migration", () => {
  it("revokes the actor without removing internal supplier master data", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "073_production_route_stabilization.sql" });
      await applyDemoSeed(db);
      await db.exec(`
        INSERT INTO public.suppliers(id,supplier_code,name)
        VALUES (
          '30000000-0000-4000-8000-000000000074',
          'SUP-074','Supplier actor removal fixture'
        );
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_kind,account_status,active,auth_version
        ) SELECT
          '70000000-0000-4000-8000-000000000074',
          'supplier-actor-removal@example.test','Supplier actor fixture',
          'not-a-real-hash',role.id,false,'SUPPLIER','ACTIVE',true,1
        FROM public.roles role WHERE role.role_key='SUPPLIER_USER'
      `);
      const fixture = await db.query<{
        user_id: string;
        role_id: string;
        supplier_id: string;
        supplier_count: number;
      }>(`
        SELECT account.id::text AS user_id,role.id::text AS role_id,
          supplier.id::text AS supplier_id,
          (SELECT count(*)::int FROM public.suppliers) AS supplier_count
        FROM public.users account
        CROSS JOIN public.roles role
        CROSS JOIN public.suppliers supplier
        WHERE role.role_key='SUPPLIER_USER'
          AND account.account_kind='SUPPLIER'
        ORDER BY account.id,supplier.id
        LIMIT 1
      `);
      const selected = fixture.rows[0];
      expect(selected).toBeDefined();
      await db.query(`
        INSERT INTO public.supplier_memberships(user_id,supplier_id,status)
        VALUES ($1,$2,'ACTIVE')
      `, [selected.user_id, selected.supplier_id]);
      await db.query(`
        INSERT INTO public.role_assignments(
          user_id,role_id,scope_type,supplier_id,active
        ) VALUES ($1,$2,'SUPPLIER',$3,true)
      `, [selected.user_id, selected.role_id, selected.supplier_id]);

      await db.exec(await readFile(migrationUrl, "utf8"));

      const state = await db.query<{
        active_assignments: number;
        active_permissions: number;
        grants: number;
        supplier_count: number;
        role_rows: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.role_assignments assignment
            JOIN public.roles role ON role.id=assignment.role_id
            WHERE role.role_key='SUPPLIER_USER' AND assignment.active)
            AS active_assignments,
          (SELECT count(*)::int FROM public.permissions
            WHERE permission_code IN (
              'supplier.portal.view','supplier.rfq.respond'
            ) AND active) AS active_permissions,
          (SELECT count(*)::int FROM public.role_permissions role_permission
            JOIN public.permissions permission
              ON permission.id=role_permission.permission_id
            WHERE permission.permission_code IN (
              'supplier.portal.view','supplier.rfq.respond'
            )) AS grants,
          (SELECT count(*)::int FROM public.suppliers) AS supplier_count,
          (SELECT count(*)::int FROM public.roles
            WHERE role_key='SUPPLIER_USER') AS role_rows
      `);
      expect(state.rows[0]).toEqual({
        active_assignments: 0,
        active_permissions: 0,
        grants: 0,
        supplier_count: selected.supplier_count,
        role_rows: 1,
      });

      await expect(db.query(`
        INSERT INTO public.role_assignments(
          user_id,role_id,scope_type,supplier_id,active
        ) VALUES ($1,$2,'SUPPLIER',$3,true)
      `, [selected.user_id, selected.role_id, selected.supplier_id]))
        .rejects.toThrow("Supplier actor assignments are no longer supported");
    } finally {
      await db.close();
    }
  }, 30_000);
});
