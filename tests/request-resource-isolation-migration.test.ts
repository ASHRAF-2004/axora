import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/045_request_resource_isolation.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  branchA: "20000000-0000-4000-8000-000000000001",
  branchB: "20000000-0000-4000-8000-000000000002",
  branchA2: "20450000-0000-4000-8000-000000000002",
  administration: "30450000-0000-4000-8000-000000000001",
  otherBranchDepartment: "30450000-0000-4000-8000-000000000002",
  ambiguousByName: "30450000-0000-4000-8000-000000000003",
  ambiguousByCode: "30450000-0000-4000-8000-000000000004",
  platformOperations: "d0450000-0000-4000-8000-000000000001",
  companyAdmin: "d0450000-0000-4000-8000-000000000002",
  departmentAdmin: "d0450000-0000-4000-8000-000000000003",
  requester: "d0450000-0000-4000-8000-000000000004",
  platformAssignment: "e0450000-0000-4000-8000-000000000001",
  companyAssignment: "e0450000-0000-4000-8000-000000000002",
  departmentAssignment: "e0450000-0000-4000-8000-000000000003",
  requesterAssignment: "e0450000-0000-4000-8000-000000000004",
  requestA1: "50000000-0000-4000-8000-000000000001",
  requestA2: "50000000-0000-4000-8000-000000000002",
  requestAmbiguous: "50000000-0000-4000-8000-000000000004",
  requestB1: "50000000-0000-4000-8000-000000000006",
} as const;

interface RoleIds {
  platformOperations: string;
  companyAdmin: string;
  departmentAdmin: string;
  requester: string;
}

interface AccessRow {
  requestId: string;
  companyId: string;
  branchId: string;
  departmentId?: string;
  ownerUserId?: string;
  canViewFinance: boolean;
  canViewSourcing: boolean;
  canViewCommercial: boolean;
  resourceActive: boolean;
}

interface SnapshotRow {
  snapshot: Record<string, unknown> | null;
}

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
  return source;
}

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db, {
    through: "044_organization_resource_isolation.sql",
  });
  await applyDemoSeed(db);

  const rolesResult = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles
       WHERE role_key='PLATFORM_OPERATIONS') AS "platformOperations",
      (SELECT id::text FROM roles
       WHERE role_key='COMPANY_ADMIN') AS "companyAdmin",
      (SELECT id::text FROM roles
       WHERE role_key='DEPARTMENT_ADMIN') AS "departmentAdmin",
      (SELECT id::text FROM roles
       WHERE role_key='REQUESTER') AS requester
  `);
  const roles = rolesResult.rows[0];
  if (!roles?.platformOperations || !roles.companyAdmin
    || !roles.departmentAdmin || !roles.requester) {
    throw new Error("Request isolation fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,city,
      contact_name,contact_phone,contact_email,active
    ) VALUES (
      $1,'B-045-A2',$2,'YourUni second branch','YU-SECOND',
      'Second branch test address','Putrajaya','Branch contact',
      '+601100000045','branch-045@example.test',true
    )
  `, [ids.branchA2, ids.companyA]);

  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES
      ($1,$5,$6,'ADMIN-045','Administration',true),
      ($2,$5,$7,'OTHER-045','Other branch department',true),
      ($3,$5,$6,'AMB-NAME-045','Ambiguous',true),
      ($4,$5,$6,'Ambiguous','Ambiguous code match',true)
  `, [
    ids.administration,
    ids.otherBranchDepartment,
    ids.ambiguousByName,
    ids.ambiguousByCode,
    ids.companyA,
    ids.branchA,
    ids.branchA2,
  ]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'platform-ops-045@example.test','Platform Operations 045',
        'not-a-real-hash',$9,NULL,NULL,false,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'company-admin-045@example.test','Company Admin 045',
        'not-a-real-hash',$10,$13,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'department-admin-045@example.test','Department Admin 045',
        'not-a-real-hash',$11,$13,$14,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'requester-045@example.test','Requester 045',
        'not-a-real-hash',$12,$13,$14,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.platformOperations,
    ids.companyAdmin,
    ids.departmentAdmin,
    ids.requester,
    ids.platformAssignment,
    ids.companyAssignment,
    ids.departmentAssignment,
    ids.requesterAssignment,
    roles.platformOperations,
    roles.companyAdmin,
    roles.departmentAdmin,
    roles.requester,
    ids.companyA,
    ids.branchA,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$4,'ACTIVE',true,now()),
      ($2,$4,'ACTIVE',true,now()),
      ($3,$4,'ACTIVE',true,now())
  `, [ids.companyAdmin, ids.departmentAdmin, ids.requester, ids.companyA]);
  await db.query(`
    INSERT INTO department_assignments(
      user_id,company_id,department_id,status,is_primary,assigned_by
    ) VALUES
      ($1,$3,$4,'ACTIVE',true,$5),
      ($2,$3,$4,'ACTIVE',true,$5)
  `, [
    ids.departmentAdmin,
    ids.requester,
    ids.companyA,
    ids.administration,
    ids.companyAdmin,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$5,$9,'PLATFORM',NULL,NULL,NULL,NULL,true,$5,now()),
      ($2,$6,$10,'COMPANY',$13,NULL,NULL,NULL,true,$5,now()),
      ($3,$7,$11,'DEPARTMENT',$13,$14,$15,NULL,true,$5,now()),
      ($4,$8,$12,'DEPARTMENT',$13,$14,$15,NULL,true,$5,now())
  `, [
    ids.platformAssignment,
    ids.companyAssignment,
    ids.departmentAssignment,
    ids.requesterAssignment,
    ids.platformOperations,
    ids.companyAdmin,
    ids.departmentAdmin,
    ids.requester,
    roles.platformOperations,
    roles.companyAdmin,
    roles.departmentAdmin,
    roles.requester,
    ids.companyA,
    ids.branchA,
    ids.administration,
  ]);

  await db.query(`
    UPDATE requests
    SET created_by=CASE id
      WHEN $1 THEN $4::uuid
      WHEN $2 THEN $5::uuid
      ELSE created_by END,
      department=CASE id
        WHEN $3 THEN 'Ambiguous'
        ELSE department END
    WHERE id IN ($1,$2,$3)
  `, [
    ids.requestA1,
    ids.requestA2,
    ids.requestAmbiguous,
    ids.requester,
    ids.companyAdmin,
  ]);

  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function accessRows(
  db: PGlite,
  actorId: string,
  assignmentId: string,
) {
  const result = await db.query<AccessRow>(`
    SELECT
      request_id::text AS "requestId",
      company_id::text AS "companyId",
      branch_id::text AS "branchId",
      department_id::text AS "departmentId",
      owner_user_id::text AS "ownerUserId",
      can_view_finance AS "canViewFinance",
      can_view_sourcing AS "canViewSourcing",
      can_view_commercial AS "canViewCommercial",
      resource_active AS "resourceActive"
    FROM axora_request_access_rows($1,$2,now())
    ORDER BY request_id
  `, [actorId, assignmentId]);
  return result.rows;
}

describe("request resource isolation migration", () => {
  it("filters requests by exact live company, department, and creator scope", async () => {
    const db = await fixture();
    try {
      const platform = await accessRows(
        db,
        ids.platformOperations,
        ids.platformAssignment,
      );
      expect(platform).toHaveLength(15);
      expect(platform.every((row) => row.canViewSourcing)).toBe(true);
      expect(platform.every((row) => row.canViewCommercial)).toBe(true);
      expect(platform.every((row) => !row.canViewFinance)).toBe(true);

      const company = await accessRows(
        db,
        ids.companyAdmin,
        ids.companyAssignment,
      );
      expect(company.map((row) => row.companyId))
        .toEqual(Array(5).fill(ids.companyA));
      expect(company.every((row) => row.canViewFinance)).toBe(true);
      expect(company.every((row) => !row.canViewSourcing)).toBe(true);
      expect(company.every((row) => !row.canViewCommercial)).toBe(true);
      expect(JSON.stringify(company)).not.toContain(ids.companyB);

      const department = await accessRows(
        db,
        ids.departmentAdmin,
        ids.departmentAssignment,
      );
      expect(department.map((row) => row.requestId))
        .toEqual([ids.requestA1]);
      expect(department[0]).toMatchObject({
        departmentId: ids.administration,
        resourceActive: true,
      });

      const requester = await accessRows(
        db,
        ids.requester,
        ids.requesterAssignment,
      );
      expect(requester.map((row) => row.requestId))
        .toEqual([ids.requestA1]);
      expect(requester[0]?.ownerUserId).toBe(ids.requester);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("backfills only one unambiguous department and rejects a wrong-branch department", async () => {
    const db = await fixture();
    try {
      const state = await db.query<{
        administration?: string;
        ambiguous?: string;
      }>(`
        SELECT
          (SELECT department_id::text FROM requests WHERE id=$1)
            AS administration,
          (SELECT department_id::text FROM requests WHERE id=$2)
            AS ambiguous
      `, [ids.requestA1, ids.requestAmbiguous]);
      expect(state.rows[0]).toEqual({
        administration: ids.administration,
        ambiguous: undefined,
      });

      await expect(db.query(`
        UPDATE requests SET department_id=$2 WHERE id=$1
      `, [ids.requestA1, ids.otherBranchDepartment])).rejects.toThrow(
        "belongs to another branch",
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("returns one indistinguishable null for missing, other-tenant, and unauthorized resources", async () => {
    const db = await fixture();
    try {
      const otherTenant = await db.query<SnapshotRow>(`
        SELECT axora_request_resource_access(
          $1,$2,'request.view',$3,now()
        ) AS snapshot
      `, [ids.companyAdmin, ids.companyAssignment, ids.requestB1]);
      const missing = await db.query<SnapshotRow>(`
        SELECT axora_request_resource_access(
          $1,$2,'request.view',$3,now()
        ) AS snapshot
      `, [
        ids.companyAdmin,
        ids.companyAssignment,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ]);
      const unauthorizedWrite = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_resource_access(
          $1,$2,'sourcing.manage',$3,now()
        ) AS snapshot
      `, [ids.companyAdmin, ids.companyAssignment, ids.requestA1]);
      const allowedWrite = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_resource_access(
          $1,$2,'sourcing.manage',$3,now()
        ) AS snapshot
      `, [ids.platformOperations, ids.platformAssignment, ids.requestB1]);
      expect(otherTenant.rows[0]?.snapshot).toBeNull();
      expect(missing.rows[0]?.snapshot).toBeNull();
      expect(unauthorizedWrite.rows[0]?.snapshot).toBeNull();
      expect(allowedWrite.rows[0]?.snapshot).toMatchObject({
        requestId: ids.requestB1,
        companyId: ids.companyB,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("locks request creation to the canonical branch and department scope", async () => {
    const db = await fixture();
    try {
      const allowed = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_creation_scope(
          $1,$2,$3,$4,$5,now()
        ) AS snapshot
      `, [
        ids.requester,
        ids.requesterAssignment,
        ids.companyA,
        ids.branchA,
        ids.administration,
      ]);
      const noDepartment = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_creation_scope(
          $1,$2,$3,$4,NULL,now()
        ) AS snapshot
      `, [
        ids.requester,
        ids.requesterAssignment,
        ids.companyA,
        ids.branchA,
      ]);
      const wrongBranch = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_creation_scope(
          $1,$2,$3,$4,$5,now()
        ) AS snapshot
      `, [
        ids.requester,
        ids.requesterAssignment,
        ids.companyA,
        ids.branchA2,
        ids.administration,
      ]);
      expect(allowed.rows[0]?.snapshot).toMatchObject({
        companyId: ids.companyA,
        branchId: ids.branchA,
        departmentId: ids.administration,
      });
      expect(noDepartment.rows[0]?.snapshot).toBeNull();
      expect(wrongBranch.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps internal helpers private and reapplies only the intended application capabilities", async () => {
    const db = await fixture();
    try {
      const source = await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        accessRows: boolean;
        resourceAccess: boolean;
        lockResource: boolean;
        lockCreation: boolean;
        permissionHelper: boolean;
        scopeHelper: boolean;
        triggerHelper: boolean;
        publicAccessRows: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app','axora_request_access_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "accessRows",
          has_function_privilege(
            'axora_app',
            'axora_request_resource_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "resourceAccess",
          has_function_privilege(
            'axora_app',
            'axora_lock_request_resource_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "lockResource",
          has_function_privilege(
            'axora_app',
            'axora_lock_request_creation_scope(uuid,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "lockCreation",
          has_function_privilege(
            'axora_app',
            'axora_request_permission_is_effective(jsonb,uuid,text,uuid,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS "permissionHelper",
          has_function_privilege(
            'axora_app','axora_request_scope_type(uuid)','EXECUTE'
          ) AS "scopeHelper",
          has_function_privilege(
            'axora_app','axora_validate_request_department_scope()',
            'EXECUTE'
          ) AS "triggerHelper",
          has_function_privilege(
            'public','axora_request_access_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicAccessRows"
      `);
      expect(privileges.rows[0]).toEqual({
        accessRows: true,
        resourceAccess: true,
        lockResource: true,
        lockCreation: true,
        permissionHelper: false,
        scopeHelper: false,
        triggerHelper: false,
        publicAccessRows: false,
      });
      expect(source).toContain("axora_lock_request_resource_access");
      expect(source).toContain("axora_lock_request_creation_scope");
    } finally {
      await db.close();
    }
  }, 30_000);
});
