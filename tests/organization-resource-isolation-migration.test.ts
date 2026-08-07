import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/044_organization_resource_isolation.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  companyA: "a1000000-0000-4000-8000-000000000044",
  companyB: "a2000000-0000-4000-8000-000000000044",
  branchA1: "b1000000-0000-4000-8000-000000000044",
  branchA2: "b2000000-0000-4000-8000-000000000044",
  branchB1: "b3000000-0000-4000-8000-000000000044",
  departmentA1: "c1000000-0000-4000-8000-000000000044",
  owner: "d1000000-0000-4000-8000-000000000044",
  managerA: "d2000000-0000-4000-8000-000000000044",
  companyAdminA: "d3000000-0000-4000-8000-000000000044",
  branchAdminA1: "d4000000-0000-4000-8000-000000000044",
  departmentAdminA1: "d5000000-0000-4000-8000-000000000044",
  ownerAssignment: "e1000000-0000-4000-8000-000000000044",
  managerAssignmentA: "e2000000-0000-4000-8000-000000000044",
  companyAdminAssignmentA: "e3000000-0000-4000-8000-000000000044",
  branchAdminAssignmentA1: "e4000000-0000-4000-8000-000000000044",
  departmentAdminAssignmentA1: "e5000000-0000-4000-8000-000000000044",
} as const;

interface RoleIds {
  platformOwner: string;
  clientManager: string;
  companyAdmin: string;
  branchAdmin: string;
  departmentAdmin: string;
}

interface SnapshotRow {
  snapshot: Record<string, unknown> | null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
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

async function fixture(db: PGlite, createAppRole = false) {
  await applyMigrations(db, { through: "043_access_administration_snapshot.sql" });
  if (createAppRole) {
    await db.exec(`
      CREATE ROLE axora_app NOLOGIN;
      CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
  await db.exec(await readFile(migrationUrl, "utf8"));

  const result = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS "platformOwner",
      (SELECT id::text FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER')
        AS "clientManager",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdmin",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_ADMIN')
        AS "branchAdmin",
      (SELECT id::text FROM roles WHERE role_key='DEPARTMENT_ADMIN')
        AS "departmentAdmin"
  `);
  const roles = result.rows[0];
  if (!roles?.platformOwner || !roles.clientManager || !roles.companyAdmin
    || !roles.branchAdmin || !roles.departmentAdmin) {
    throw new Error("Organization isolation fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO companies(
      id,company_code,name,industry,main_contact_name,main_contact_email,
      main_contact_phone,billing_contact_name,billing_contact_email,
      billing_contact_phone,billing_address,payment_terms,billing_cycle,active
    ) VALUES
      ($1,'ISO-A-044','Northwind Services','Facilities','A Contact',
        'a@example.test','+601100000001','A Billing','billing-a@example.test',
        '+601100000002','Address A','Cash on delivery (COD)','Monthly',true),
      ($2,'ISO-B-044','Contoso Retail','Retail','B Contact',
        'b@example.test','+601100000003','B Billing','billing-b@example.test',
        '+601100000004','Address B','Cash on delivery (COD)','Monthly',true)
  `, [ids.companyA, ids.companyB]);

  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,city,
      contact_name,contact_phone,contact_email,monthly_budget,active
    ) VALUES
      ($1,'ISO-BA1-044',$4,'Cyberjaya','CYB-044','Address A1','Cyberjaya',
        'A1 Contact','+601100000011','a1@example.test',10000,true),
      ($2,'ISO-BA2-044',$4,'Putrajaya','PUT-044','Address A2','Putrajaya',
        'A2 Contact','+601100000012','a2@example.test',20000,true),
      ($3,'ISO-BB1-044',$5,'Kuala Lumpur','KUL-044','Address B1',
        'Kuala Lumpur','B1 Contact','+601100000013','b1@example.test',30000,true)
  `, [
    ids.branchA1,
    ids.branchA2,
    ids.branchB1,
    ids.companyA,
    ids.companyB,
  ]);

  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES ($1,$2,$3,'OPS-044','Operations',true)
  `, [ids.departmentA1, ids.companyA, ids.branchA1]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'owner-044@example.test','Platform Owner','not-a-real-hash',
        $6,NULL,NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'manager-044@example.test','Account Manager A','not-a-real-hash',
        $7,NULL,NULL,false,now(),'PLATFORM','ACTIVE',true,1),
      ($3,'company-admin-044@example.test','Company Administrator A',
        'not-a-real-hash',$8,$11,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'branch-admin-044@example.test','Branch Administrator A1',
        'not-a-real-hash',$9,$11,$12,false,now(),'COMPANY','ACTIVE',true,1),
      ($5,'department-admin-044@example.test','Department Administrator A1',
        'not-a-real-hash',$10,$11,$12,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.owner,
    ids.managerA,
    ids.companyAdminA,
    ids.branchAdminA1,
    ids.departmentAdminA1,
    roles.platformOwner,
    roles.clientManager,
    roles.companyAdmin,
    roles.branchAdmin,
    roles.departmentAdmin,
    ids.companyA,
    ids.branchA1,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$4,'ACTIVE',true,now()),
      ($2,$4,'ACTIVE',true,now()),
      ($3,$4,'ACTIVE',true,now())
  `, [
    ids.companyAdminA,
    ids.branchAdminA1,
    ids.departmentAdminA1,
    ids.companyA,
  ]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary,created_by
    ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
  `, [ids.branchAdminA1, ids.companyA, ids.branchA1, ids.owner]);
  await db.query(`
    INSERT INTO department_assignments(
      user_id,company_id,department_id,status,is_primary,assigned_by
    ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
  `, [
    ids.departmentAdminA1,
    ids.companyA,
    ids.departmentA1,
    ids.owner,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$6,$11,'PLATFORM',NULL,NULL,NULL,NULL,true,$6,now()),
      ($2,$7,$12,'COMPANY',$16,NULL,NULL,NULL,true,$6,now()),
      ($3,$8,$13,'COMPANY',$16,NULL,NULL,NULL,true,$6,now()),
      ($4,$9,$14,'BRANCH',$16,$17,NULL,NULL,true,$6,now()),
      ($5,$10,$15,'DEPARTMENT',$16,$17,$18,NULL,true,$6,now())
  `, [
    ids.ownerAssignment,
    ids.managerAssignmentA,
    ids.companyAdminAssignmentA,
    ids.branchAdminAssignmentA1,
    ids.departmentAdminAssignmentA1,
    ids.owner,
    ids.managerA,
    ids.companyAdminA,
    ids.branchAdminA1,
    ids.departmentAdminA1,
    roles.platformOwner,
    roles.clientManager,
    roles.companyAdmin,
    roles.branchAdmin,
    roles.departmentAdmin,
    ids.companyA,
    ids.branchA1,
    ids.departmentA1,
  ]);

  return roles;
}

async function directory(db: PGlite, actorId: string, assignmentId: string) {
  const result = await db.query<SnapshotRow>(`
    SELECT axora_organization_directory_snapshot($1,$2,now()) AS snapshot
  `, [actorId, assignmentId]);
  return result.rows[0]?.snapshot;
}

describe("organization resource isolation migration", () => {
  it("filters company and branch directories by exact live assignment scope", async () => {
    const db = new PGlite();
    try {
      await fixture(db);

      const owner = await directory(db, ids.owner, ids.ownerAssignment);
      expect(rows(owner?.companies).map((row) => row.id)).toEqual([
        ids.companyB,
        ids.companyA,
      ]);
      expect(rows(owner?.branches).map((row) => row.id)).toEqual([
        ids.branchB1,
        ids.branchA1,
        ids.branchA2,
      ]);
      expect(rows(owner?.branches).every((row) => row.canViewBudget === true))
        .toBe(true);

      const manager = await directory(
        db,
        ids.managerA,
        ids.managerAssignmentA,
      );
      expect(rows(manager?.companies).map((row) => row.id))
        .toEqual([ids.companyA]);
      expect(rows(manager?.branches).map((row) => row.id))
        .toEqual([ids.branchA1, ids.branchA2]);
      expect(JSON.stringify(manager)).not.toContain(ids.companyB);
      expect(JSON.stringify(manager)).not.toContain(ids.branchB1);

      const companyAdmin = await directory(
        db,
        ids.companyAdminA,
        ids.companyAdminAssignmentA,
      );
      expect(rows(companyAdmin?.companies).map((row) => row.id))
        .toEqual([ids.companyA]);
      expect(rows(companyAdmin?.branches).map((row) => row.id))
        .toEqual([ids.branchA1, ids.branchA2]);

      const branchAdmin = await directory(
        db,
        ids.branchAdminA1,
        ids.branchAdminAssignmentA1,
      );
      expect(rows(branchAdmin?.companies).map((row) => row.id))
        .toEqual([ids.companyA]);
      expect(rows(branchAdmin?.branches).map((row) => row.id))
        .toEqual([ids.branchA1]);

      const departmentAdmin = await directory(
        db,
        ids.departmentAdminA1,
        ids.departmentAdminAssignmentA1,
      );
      expect(rows(departmentAdmin?.companies).map((row) => row.id))
        .toEqual([ids.companyA]);
      const departmentBranches = rows(departmentAdmin?.branches);
      expect(departmentBranches.map((row) => row.id))
        .toEqual([ids.branchA1]);
      expect(departmentBranches[0]).toMatchObject({ canViewBudget: false });
      expect(departmentBranches[0]).not.toHaveProperty("monthlyBudget");
      expect(departmentBranches[0]).not.toHaveProperty("committedAmount");
      expect(departmentBranches[0]).not.toHaveProperty("remainingAmount");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("resolves resource ownership server-side and returns the same null for missing and out-of-scope identifiers", async () => {
    const db = new PGlite();
    try {
      await fixture(db);
      const allowed = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'organization.branch.view','BRANCH',$3,now()
        ) AS snapshot
      `, [ids.branchAdminA1, ids.branchAdminAssignmentA1, ids.branchA1]);
      expect(allowed.rows[0]?.snapshot).toMatchObject({
        resourceType: "BRANCH",
        resourceId: ids.branchA1,
        scope: {
          type: "BRANCH",
          companyId: ids.companyA,
          branchId: ids.branchA1,
        },
      });

      const outOfScope = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'organization.branch.view','BRANCH',$3,now()
        ) AS snapshot
      `, [ids.branchAdminA1, ids.branchAdminAssignmentA1, ids.branchA2]);
      const otherTenant = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'organization.branch.view','BRANCH',$3,now()
        ) AS snapshot
      `, [ids.branchAdminA1, ids.branchAdminAssignmentA1, ids.branchB1]);
      const missing = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'organization.branch.view','BRANCH',$3,now()
        ) AS snapshot
      `, [
        ids.branchAdminA1,
        ids.branchAdminAssignmentA1,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ]);
      const malformedKind = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'organization.branch.view','REQUEST',$3,now()
        ) AS snapshot
      `, [ids.branchAdminA1, ids.branchAdminAssignmentA1, ids.branchA1]);
      const unknownPermission = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'unknown.permission','BRANCH',$3,now()
        ) AS snapshot
      `, [ids.branchAdminA1, ids.branchAdminAssignmentA1, ids.branchA1]);
      expect(outOfScope.rows[0]?.snapshot).toBeNull();
      expect(otherTenant.rows[0]?.snapshot).toBeNull();
      expect(missing.rows[0]?.snapshot).toBeNull();
      expect(malformedKind.rows[0]?.snapshot).toBeNull();
      expect(unknownPermission.rows[0]?.snapshot).toBeNull();

      const managerCompany = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'company.view.assigned','COMPANY',$3,now()
        ) AS snapshot
      `, [ids.managerA, ids.managerAssignmentA, ids.companyA]);
      const managerOtherCompany = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'company.view.assigned','COMPANY',$3,now()
        ) AS snapshot
      `, [ids.managerA, ids.managerAssignmentA, ids.companyB]);
      const managerWrongPermission = await db.query<SnapshotRow>(`
        SELECT axora_organization_resource_access(
          $1,$2,'company.view','COMPANY',$3,now()
        ) AS snapshot
      `, [ids.managerA, ids.managerAssignmentA, ids.companyA]);
      expect(managerCompany.rows[0]?.snapshot).toMatchObject({
        resourceId: ids.companyA,
      });
      expect(managerOtherCompany.rows[0]?.snapshot).toBeNull();
      expect(managerWrongPermission.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("honors explicit denials and stops serving revoked or stale actor assignments", async () => {
    const db = new PGlite();
    try {
      await fixture(db);
      await db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'organization.branch.view','DENY','COMPANY',$5,
          NULL,NULL,NULL,now(),NULL,$6
        )
      `, [
        ids.owner,
        ids.ownerAssignment,
        ids.managerA,
        ids.managerAssignmentA,
        ids.companyA,
        "Temporarily separate company onboarding from branch records",
      ]);
      const denied = await directory(db, ids.managerA, ids.managerAssignmentA);
      expect(rows(denied?.companies).map((row) => row.id))
        .toEqual([ids.companyA]);
      expect(rows(denied?.branches)).toEqual([]);

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Manager assignment ended'
        WHERE id=$1
      `, [ids.managerAssignmentA, ids.owner]);
      expect(await directory(db, ids.managerA, ids.managerAssignmentA))
        .toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes only minimized directory and resource capabilities to the application role", async () => {
    const db = new PGlite();
    try {
      await fixture(db, true);
      const source = await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        executeDirectory: boolean;
        executeResource: boolean;
        executeLiveInternal: boolean;
        executeResolverInternal: boolean;
        publicDirectory: boolean;
        publicResource: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_organization_directory_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "executeDirectory",
          has_function_privilege(
            'axora_app',
            'axora_organization_resource_access(uuid,uuid,text,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "executeResource",
          has_function_privilege(
            'axora_app',
            'axora_live_authorization_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "executeLiveInternal",
          has_function_privilege(
            'axora_app',
            'axora_resolve_organization_resource_scope(text,uuid)',
            'EXECUTE'
          ) AS "executeResolverInternal",
          has_function_privilege(
            'public',
            'axora_organization_directory_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicDirectory",
          has_function_privilege(
            'public',
            'axora_organization_resource_access(uuid,uuid,text,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicResource"
      `);
      expect(privileges.rows[0]).toEqual({
        executeDirectory: true,
        executeResource: true,
        executeLiveInternal: false,
        executeResolverInternal: false,
        publicDirectory: false,
        publicResource: false,
      });
      expect(source).toContain("axora_organization_directory_snapshot");
      expect(source).toContain("axora_organization_resource_access");

      await db.exec("SET ROLE axora_app");
      try {
        const visible = await directory(db, ids.managerA, ids.managerAssignmentA);
        expect(rows(visible?.companies).map((row) => row.id))
          .toEqual([ids.companyA]);
        await expect(db.query(`
          SELECT * FROM axora_resolve_organization_resource_scope(
            'COMPANY',$1
          )
        `, [ids.companyA])).rejects.toThrow();
      } finally {
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
