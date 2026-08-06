import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migration038Url = new URL(
  "../database/migrations/038_canonical_session_scopes.sql",
  import.meta.url,
);

const ids = {
  manager: "a1000000-0000-4000-8000-000000000038",
  departmentAdmin: "a2000000-0000-4000-8000-000000000038",
  deliverySupervisor: "a3000000-0000-4000-8000-000000000038",
  managerAssignment: "b1000000-0000-4000-8000-000000000038",
  departmentAssignment: "b2000000-0000-4000-8000-000000000038",
  deliveryAssignment: "b3000000-0000-4000-8000-000000000038",
  department: "c1000000-0000-4000-8000-000000000038",
  secondDepartment: "c2000000-0000-4000-8000-000000000038",
};

async function fixture(db: PGlite) {
  await applyDemoSeed(db);
  const context = await db.query<{
    companyId: string;
    secondCompanyId: string;
    branchId: string;
    managerRoleId: string;
    departmentRoleId: string;
    supervisorRoleId: string;
  }>(`
    SELECT
      company.id::text AS "companyId",
      (SELECT second_company.id::text
       FROM companies second_company
       WHERE second_company.id<>company.id
       ORDER BY second_company.id
       LIMIT 1) AS "secondCompanyId",
      branch.id::text AS "branchId",
      (SELECT id::text FROM roles
       WHERE role_key='CLIENT_ACCOUNT_MANAGER') AS "managerRoleId",
      (SELECT id::text FROM roles
       WHERE role_key='DEPARTMENT_ADMIN') AS "departmentRoleId",
      (SELECT id::text FROM roles
       WHERE role_key='DELIVERY_TEAM_SUPERVISOR') AS "supervisorRoleId"
    FROM companies company
    JOIN branches branch ON branch.company_id=company.id
    ORDER BY company.id,branch.id
    LIMIT 1
  `);
  const value = context.rows[0];

  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES
      ($1,$3,$4,'AUTH-DEPT-1','Authorization department one',true),
      ($2,$3,$4,'AUTH-DEPT-2','Authorization department two',true)
  `, [ids.department, ids.secondDepartment, value.companyId, value.branchId]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'account-manager-038@example.test','Account manager 038',
        'not-a-real-hash',$4,NULL,false,now(),'PLATFORM','ACTIVE',true,5),
      ($2,'department-admin-038@example.test','Department admin 038',
        'not-a-real-hash',$5,$7,false,now(),'COMPANY','ACTIVE',true,6),
      ($3,'delivery-supervisor-038@example.test','Delivery supervisor 038',
        'not-a-real-hash',$6,NULL,false,now(),'DELIVERY','ACTIVE',true,7)
  `, [
    ids.manager,
    ids.departmentAdmin,
    ids.deliverySupervisor,
    value.managerRoleId,
    value.departmentRoleId,
    value.supervisorRoleId,
    value.companyId,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES ($1,$2,'ACTIVE',true,now())
  `, [ids.departmentAdmin, value.companyId]);
  await db.query(`
    INSERT INTO department_assignments(
      user_id,company_id,department_id,status,is_primary
    ) VALUES ($1,$2,$3,'ACTIVE',true)
  `, [ids.departmentAdmin, value.companyId, ids.department]);

  return value;
}

describe("canonical role-assignment session scopes", () => {
  it("adds company-manager, department, and delivery assignment shapes without rewriting identities", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "037_effective_access_snapshot.sql",
      });
      const context = await fixture(db);
      const before = await db.query<{ users: number; sessions: number }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM user_sessions) AS sessions
      `);

      await db.exec(await readFile(migration038Url, "utf8"));

      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active
        ) VALUES ($1,$2,$3,'COMPANY',$4,true)
      `, [
        ids.managerAssignment,
        ids.manager,
        context.managerRoleId,
        context.companyId,
      ]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,
          department_id,active
        ) VALUES ($1,$2,$3,'DEPARTMENT',$4,$5,$6,true)
      `, [
        ids.departmentAssignment,
        ids.departmentAdmin,
        context.departmentRoleId,
        context.companyId,
        context.branchId,
        ids.department,
      ]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active
        ) VALUES ($1,$2,$3,'DELIVERY',true)
      `, [
        ids.deliveryAssignment,
        ids.deliverySupervisor,
        context.supervisorRoleId,
      ]);

      const state = await db.query<{
        users: number;
        sessions: number;
        managerScope: Record<string, unknown>;
        departmentScope: Record<string, unknown>;
        deliveryScope: Record<string, unknown>;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM user_sessions) AS sessions,
          axora_effective_access_snapshot(
            $1,$2,now()
          )->'scopes'->0 AS "managerScope",
          axora_effective_access_snapshot(
            $3,$4,now()
          )->'scopes'->0 AS "departmentScope",
          axora_effective_access_snapshot(
            $5,$6,now()
          )->'scopes'->0 AS "deliveryScope"
      `, [
        ids.manager,
        ids.managerAssignment,
        ids.departmentAdmin,
        ids.departmentAssignment,
        ids.deliverySupervisor,
        ids.deliveryAssignment,
      ]);

      expect(state.rows[0]).toMatchObject({
        users: before.rows[0].users,
        sessions: before.rows[0].sessions,
        managerScope: {
          type: "COMPANY",
          companyId: context.companyId,
        },
        departmentScope: {
          type: "DEPARTMENT",
          companyId: context.companyId,
          branchId: context.branchId,
          departmentId: ids.department,
        },
        deliveryScope: { type: "DELIVERY" },
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps department scopes synchronized and removes access on revocation", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "037_effective_access_snapshot.sql",
      });
      const context = await fixture(db);
      await db.exec(await readFile(migration038Url, "utf8"));

      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,
          department_id,active
        ) VALUES ($1,$2,$3,'DEPARTMENT',$4,$5,$6,true)
      `, [
        ids.departmentAssignment,
        ids.departmentAdmin,
        context.departmentRoleId,
        context.companyId,
        context.branchId,
        ids.department,
      ]);

      await db.query(`
        UPDATE role_assignments
        SET department_id=$2
        WHERE id=$1
      `, [ids.departmentAssignment, ids.secondDepartment]);

      const moved = await db.query<{
        activeCount: number;
        inactiveCount: number;
        departmentId: string;
      }>(`
        SELECT
          count(*) FILTER (WHERE active)::int AS "activeCount",
          count(*) FILTER (WHERE NOT active)::int AS "inactiveCount",
          max(department_id::text) FILTER (WHERE active) AS "departmentId"
        FROM user_scopes
        WHERE source='ROLE_ASSIGNMENT' AND source_reference=$1
      `, [ids.departmentAssignment]);
      expect(moved.rows[0]).toEqual({
        activeCount: 1,
        inactiveCount: 1,
        departmentId: ids.secondDepartment,
      });

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now()
        WHERE id=$1
      `, [ids.departmentAssignment]);
      const revoked = await db.query<{
        activeCount: number;
        snapshot: unknown;
      }>(`
        SELECT
          (SELECT count(*)::int FROM user_scopes
           WHERE source='ROLE_ASSIGNMENT'
             AND source_reference=$2 AND active) AS "activeCount",
          axora_effective_access_snapshot($1,$2,now()) AS snapshot
      `, [ids.departmentAdmin, ids.departmentAssignment]);
      expect(revoked.rows[0]).toEqual({ activeCount: 0, snapshot: null });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects malformed, cross-company, and duplicate active department assignments", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "037_effective_access_snapshot.sql",
      });
      const context = await fixture(db);
      await db.exec(await readFile(migration038Url, "utf8"));

      await expect(db.query(`
        INSERT INTO role_assignments(
          user_id,role_id,scope_type,company_id,active
        ) VALUES ($1,$2,'DEPARTMENT',$3,true)
      `, [ids.departmentAdmin, context.departmentRoleId, context.companyId]))
        .rejects.toThrow();

      await expect(db.query(`
        INSERT INTO role_assignments(
          user_id,role_id,scope_type,company_id,department_id,active
        ) VALUES ($1,$2,'DEPARTMENT',$3,$4,true)
      `, [
        ids.departmentAdmin,
        context.departmentRoleId,
        context.secondCompanyId,
        ids.department,
      ])).rejects.toThrow();

      await db.query(`
        INSERT INTO role_assignments(
          user_id,role_id,scope_type,company_id,branch_id,department_id,active
        ) VALUES ($1,$2,'DEPARTMENT',$3,$4,$5,true)
      `, [
        ids.departmentAdmin,
        context.departmentRoleId,
        context.companyId,
        context.branchId,
        ids.department,
      ]);
      await expect(db.query(`
        INSERT INTO role_assignments(
          user_id,role_id,scope_type,company_id,branch_id,department_id,active
        ) VALUES ($1,$2,'DEPARTMENT',$3,$4,$5,true)
      `, [
        ids.departmentAdmin,
        context.departmentRoleId,
        context.companyId,
        context.branchId,
        ids.department,
      ])).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30_000);
});
