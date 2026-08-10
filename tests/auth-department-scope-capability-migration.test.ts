import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/072_auth_department_scope_capability.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  company: "a1000000-0000-4000-8000-000000000072",
  branch: "b1000000-0000-4000-8000-000000000072",
  department: "c1000000-0000-4000-8000-000000000072",
  user: "d1000000-0000-4000-8000-000000000072",
  assignment: "e1000000-0000-4000-8000-000000000072",
} as const;

async function applyApplicationGrantScript(db: PGlite) {
  const source = await readFile(grantsUrl, "utf8");
  const executable = source
    .split("\n")
    .filter((line) => (
      !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
    ))
    .join("\n");
  await db.exec(executable);
}

describe("authentication department-scope capability migration", () => {
  it("serves only the matching session scope while raw tables stay denied", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "071_notification_centre.sql" });
      await db.exec(await readFile(migrationUrl, "utf8"));

      const role = await db.query<{ id: string }>(`
        SELECT id::text AS id FROM roles WHERE role_key='DEPARTMENT_ADMIN'
      `);
      const roleId = role.rows[0]?.id;
      expect(roleId).toBeTruthy();

      await db.query(`
        INSERT INTO companies(
          id,company_code,name,industry,main_contact_name,main_contact_email,
          main_contact_phone,billing_contact_name,billing_contact_email,
          billing_contact_phone,billing_address,payment_terms,billing_cycle,
          active
        ) VALUES (
          $1,'AUTH-072','Auth Scope Company','Services','Main Contact',
          'main-072@example.test','+601100000072','Billing Contact',
          'billing-072@example.test','+601100000073','Address 072',
          'Cash on delivery (COD)','Monthly',true
        )
      `, [ids.company]);
      await db.query(`
        INSERT INTO branches(
          id,branch_code_id,company_id,name,branch_code,delivery_address,city,
          contact_name,contact_phone,contact_email,monthly_budget,active
        ) VALUES (
          $1,'AUTH-BRANCH-072',$2,'Primary Branch','AUTH-B-072',
          'Branch Address','Kuala Lumpur','Branch Contact','+601100000074',
          'branch-072@example.test',1000,true
        )
      `, [ids.branch, ids.company]);
      await db.query(`
        INSERT INTO departments(
          id,company_id,branch_id,department_code,name,active
        ) VALUES ($1,$2,$3,'AUTH-D-072','Procurement',true)
      `, [ids.department, ids.company, ids.branch]);
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,branch_id,
          account_setup_completed_at,account_kind,account_status,active,
          auth_version
        ) VALUES (
          $1,'department-072@example.test','Department User','not-a-hash',
          $2,$3,$4,now(),'COMPANY','ACTIVE',true,1
        )
      `, [ids.user, roleId, ids.company, ids.branch]);
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES ($1,$2,'ACTIVE',true,now())
      `, [ids.user, ids.company]);
      await db.query(`
        INSERT INTO department_assignments(
          user_id,company_id,department_id,status,is_primary
        ) VALUES ($1,$2,$3,'ACTIVE',true)
      `, [ids.user, ids.company, ids.department]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,department_id,
          active,assigned_at
        ) VALUES ($1,$2,$3,'DEPARTMENT',$4,$5,$6,true,now())
      `, [
        ids.assignment,
        ids.user,
        roleId,
        ids.company,
        ids.branch,
        ids.department,
      ]);

      await db.exec(`
        CREATE TABLE schema_migrations(
          filename text PRIMARY KEY,
          sha256 text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await applyApplicationGrantScript(db);

      const privileges = await db.query<{
        capability: boolean;
        departments: boolean;
        assignments: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app','axora_auth_department_scope(uuid,uuid)','EXECUTE'
          ) AS capability,
          has_table_privilege(
            'axora_app','departments','SELECT'
          ) AS departments,
          has_table_privilege(
            'axora_app','department_assignments','SELECT'
          ) AS assignments
      `);
      expect(privileges.rows[0]).toEqual({
        capability: true,
        departments: false,
        assignments: false,
      });

      await db.exec("SET ROLE axora_app");
      try {
        const allowed = await db.query<{
          snapshot: Record<string, unknown> | null;
        }>(`
          SELECT axora_auth_department_scope($1,$2) AS snapshot
        `, [ids.user, ids.assignment]);
        expect(allowed.rows[0]?.snapshot).toEqual({
          departmentActive: true,
          branchId: ids.branch,
          branchActive: true,
          assignmentStatus: "ACTIVE",
          assignmentPrimary: true,
        });

        const denied = await db.query<{ snapshot: unknown }>(`
          SELECT axora_auth_department_scope($1,$2) AS snapshot
        `, [
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
          ids.assignment,
        ]);
        expect(denied.rows[0]?.snapshot).toBeNull();
        await expect(db.query("SELECT * FROM departments")).rejects.toThrow();
        await expect(db.query("SELECT * FROM department_assignments"))
          .rejects.toThrow();
      } finally {
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
