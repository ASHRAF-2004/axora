import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/043_access_administration_snapshot.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  companyA: "a1000000-0000-4000-8000-000000000043",
  branchA: "a2000000-0000-4000-8000-000000000043",
  companyB: "a3000000-0000-4000-8000-000000000043",
  branchB: "a4000000-0000-4000-8000-000000000043",
  actorA: "b1000000-0000-4000-8000-000000000043",
  actorB: "b2000000-0000-4000-8000-000000000043",
  target: "b3000000-0000-4000-8000-000000000043",
  actorAssignmentA: "c1000000-0000-4000-8000-000000000043",
  actorAssignmentB: "c2000000-0000-4000-8000-000000000043",
  targetCompanyAssignment: "c3000000-0000-4000-8000-000000000043",
  targetBranchAssignmentA: "c4000000-0000-4000-8000-000000000043",
  targetBranchAssignmentB: "c5000000-0000-4000-8000-000000000043",
  delegationCommand: "d1000000-0000-4000-8000-000000000043",
} as const;

interface RoleIds {
  companyAdminRoleId: string;
  companyApproverRoleId: string;
  requesterRoleId: string;
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

async function accessFixture(db: PGlite, createAppRole = false) {
  await applyMigrations(db, { through: "042_role_scope_lifecycle.sql" });
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

  const roles = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_APPROVER')
        AS "companyApproverRoleId",
      (SELECT id::text FROM roles WHERE role_key='REQUESTER')
        AS "requesterRoleId"
  `);
  const context = roles.rows[0];
  if (!context?.companyAdminRoleId || !context.companyApproverRoleId
    || !context.requesterRoleId) {
    throw new Error("Access administration fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO companies(id,company_code,name,active) VALUES
      ($1,'ACCESS-A-043','Northwind Services',true),
      ($2,'ACCESS-B-043','Contoso Facilities',true)
  `, [ids.companyA, ids.companyB]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,active
    ) VALUES
      ($1,'ACCESS-BA-043',$2,'Cyberjaya','CYB-043','Address A',true),
      ($3,'ACCESS-BB-043',$4,'Putrajaya','PUT-043','Address B',true)
  `, [ids.branchA, ids.companyA, ids.branchB, ids.companyB]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'admin-a@example.test','Administrator A','not-a-real-hash',
        $4,$6,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'admin-b@example.test','Administrator B','not-a-real-hash',
        $4,$7,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'target@example.test','Scoped target','not-a-real-hash',
        $5,$6,$8,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.actorA,
    ids.actorB,
    ids.target,
    context.companyAdminRoleId,
    context.requesterRoleId,
    ids.companyA,
    ids.companyB,
    ids.branchA,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$4,'ACTIVE',true,now()),
      ($2,$5,'ACTIVE',true,now()),
      ($3,$4,'ACTIVE',true,now()),
      ($3,$5,'ACTIVE',false,now())
  `, [ids.actorA, ids.actorB, ids.target, ids.companyA, ids.companyB]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary,created_by
    ) VALUES
      ($1,$2,$3,'ACTIVE',true,$4),
      ($1,$5,$6,'ACTIVE',false,$7)
  `, [
    ids.target,
    ids.companyA,
    ids.branchA,
    ids.actorA,
    ids.companyB,
    ids.branchB,
    ids.actorB,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,
      active,assigned_by,assigned_at
    ) VALUES
      ($1,$6,$9,'COMPANY',$11,NULL,true,$6,now()-interval '5 days'),
      ($2,$7,$9,'COMPANY',$12,NULL,true,$7,now()-interval '5 days'),
      ($3,$8,$10,'COMPANY',$11,NULL,true,$6,now()-interval '3 days'),
      ($4,$8,$13,'BRANCH',$11,$14,true,$6,now()-interval '2 days'),
      ($5,$8,$13,'BRANCH',$12,$15,true,$7,now()-interval '1 day')
  `, [
    ids.actorAssignmentA,
    ids.actorAssignmentB,
    ids.targetCompanyAssignment,
    ids.targetBranchAssignmentA,
    ids.targetBranchAssignmentB,
    ids.actorA,
    ids.actorB,
    ids.target,
    context.companyAdminRoleId,
    context.companyApproverRoleId,
    ids.companyA,
    ids.companyB,
    context.requesterRoleId,
    ids.branchA,
    ids.branchB,
  ]);

  await db.query(`
    SELECT * FROM axora_set_user_permission_override(
      $1,$2,$3,$4,'request.submit','DENY','COMPANY',$5,
      NULL,NULL,NULL,now(),NULL,$6
    )
  `, [
    ids.actorA,
    ids.actorAssignmentA,
    ids.target,
    ids.targetCompanyAssignment,
    ids.companyA,
    "Separate submission duties across company A",
  ]);
  await db.query(`
    SELECT * FROM axora_set_user_permission_override(
      $1,$2,$3,$4,'request.approve.other','GRANT','BRANCH',$5,
      $6,NULL,NULL,now(),NULL,$7
    )
  `, [
    ids.actorA,
    ids.actorAssignmentA,
    ids.target,
    ids.targetBranchAssignmentA,
    ids.companyA,
    ids.branchA,
    "Temporary branch approval responsibility",
  ]);
  await db.query(`
    SELECT * FROM axora_set_user_permission_override(
      $1,$2,$3,$4,'request.cancel','DENY','BRANCH',$5,
      $6,NULL,NULL,now(),NULL,$7
    )
  `, [
    ids.actorB,
    ids.actorAssignmentB,
    ids.target,
    ids.targetBranchAssignmentB,
    ids.companyB,
    ids.branchB,
    "Other tenant confidential denial",
  ]);

  await db.query(`
    SELECT * FROM axora_set_approval_limit(
      $1,$2,$3,$4,NULL,'request.approve.other','COMPANY',$5,
      NULL,NULL,'MYR',5000,false,now(),NULL,$6
    )
  `, [
    ids.actorA,
    ids.actorAssignmentA,
    ids.target,
    ids.targetCompanyAssignment,
    ids.companyA,
    "Company approval ceiling for delegated coverage",
  ]);

  await db.query(`
    SELECT * FROM axora_create_delegated_access(
      $1,$2,$3,$4,$5,
      ARRAY['request.approve.over_budget']::text[],
      jsonb_build_array(jsonb_build_object(
        'type','BRANCH','companyId',$6::text,'branchId',$7::text
      )),
      now(),now()+interval '2 days',$8
    )
  `, [
    ids.delegationCommand,
    ids.actorA,
    ids.actorAssignmentA,
    ids.target,
    ids.targetBranchAssignmentA,
    ids.companyA,
    ids.branchA,
    "Temporary over-budget branch coverage",
  ]);

  return context;
}

function array(value: unknown) {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

describe("scoped access administration snapshot", () => {
  it("returns only visible assignments and composes role, override, limit, delegation, and history facts", async () => {
    const db = new PGlite();
    try {
      await accessFixture(db);
      const result = await db.query<SnapshotRow>(`
        SELECT axora_access_administration_snapshot(
          $1,$2,$3,NULL,now()
        ) AS snapshot
      `, [ids.actorA, ids.actorAssignmentA, ids.target]);
      const snapshot = result.rows[0]?.snapshot;
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected access administration snapshot");

      expect(snapshot).toMatchObject({
        canManagePermissions: true,
        canViewHistory: true,
        selectedAssignmentId: ids.targetBranchAssignmentA,
        identity: {
          id: ids.target,
          displayName: "Scoped target",
          email: "target@example.test",
          accountKind: "COMPANY",
          accountStatus: "ACTIVE",
          active: true,
          setupCompleted: true,
        },
        selectedScope: {
          type: "BRANCH",
          companyId: ids.companyA,
          companyName: "Northwind Services",
          branchId: ids.branchA,
          branchName: "Cyberjaya",
        },
      });

      const assignments = array(snapshot.assignments);
      expect(assignments.map((row) => row.id)).toEqual([
        ids.targetBranchAssignmentA,
        ids.targetCompanyAssignment,
      ]);
      expect(assignments.map((row) => row.id))
        .not.toContain(ids.targetBranchAssignmentB);

      const permissions = array(snapshot.permissionOptions);
      expect(permissions.find((row) => row.code === "request.submit"))
        .toMatchObject({
          targetRoleIncludes: true,
          effective: false,
          actorCanGrant: false,
        });
      expect(permissions.find((row) => (
        row.code === "request.approve.over_budget"
      ))).toMatchObject({
        targetRoleIncludes: false,
        effective: true,
        actorCanGrant: true,
      });

      const overrides = array(snapshot.permissionOverrides);
      expect(overrides).toEqual(expect.arrayContaining([
        expect.objectContaining({
          permission: "request.submit",
          effect: "DENY",
          reason: "Separate submission duties across company A",
          manageable: true,
          scope: expect.objectContaining({ type: "COMPANY" }),
        }),
        expect.objectContaining({
          permission: "request.approve.other",
          effect: "GRANT",
          reason: "Temporary branch approval responsibility",
          manageable: true,
          scope: expect.objectContaining({ type: "BRANCH" }),
        }),
      ]));
      expect(JSON.stringify(overrides))
        .not.toContain("Other tenant confidential denial");

      const limits = array(snapshot.approvalLimits);
      expect(limits).toHaveLength(1);
      expect(limits[0]).toMatchObject({
        subjectType: "USER",
        permission: "request.approve.other",
        currency: "MYR",
        allowSelfApproval: false,
        scope: expect.objectContaining({
          type: "COMPANY",
          companyId: ids.companyA,
        }),
      });
      expect(Number(limits[0]?.maximumAmount)).toBe(5000);

      const delegations = array(snapshot.delegations);
      expect(delegations).toHaveLength(1);
      expect(delegations[0]).toMatchObject({
        status: "ACTIVE",
        reason: "Temporary over-budget branch coverage",
        permissions: ["request.approve.over_budget"],
      });

      const history = array(snapshot.history);
      expect(history.map((row) => row.changeType)).toEqual(expect.arrayContaining([
        "PERMISSION_DENIED",
        "PERMISSION_GRANTED",
        "APPROVAL_LIMIT_SET",
        "DELEGATION_CREATED",
      ]));
      expect(JSON.stringify(history))
        .not.toContain("Other tenant confidential denial");

      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("not-a-real-hash");
      expect(serialized).not.toContain("passwordHash");
      expect(serialized).not.toContain("tokenHash");
      expect(serialized).not.toContain("networkHash");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails closed for cross-tenant, inactive, malformed, and self-management contexts", async () => {
    const db = new PGlite();
    try {
      await accessFixture(db);
      const crossTenant = await db.query<SnapshotRow>(`
        SELECT axora_access_administration_snapshot(
          $1,$2,$3,$4,now()
        ) AS snapshot
      `, [
        ids.actorA,
        ids.actorAssignmentA,
        ids.target,
        ids.targetBranchAssignmentB,
      ]);
      expect(crossTenant.rows[0]?.snapshot).toBeNull();

      const self = await db.query<SnapshotRow>(`
        SELECT axora_access_administration_snapshot(
          $1,$2,$1,$2,now()
        ) AS snapshot
      `, [ids.actorA, ids.actorAssignmentA]);
      expect(self.rows[0]?.snapshot).toMatchObject({
        canManagePermissions: false,
      });

      const malformed = await db.query<SnapshotRow>(`
        SELECT axora_access_administration_snapshot(
          $1,NULL,$2,NULL,now()
        ) AS snapshot
      `, [ids.actorA, ids.target]);
      expect(malformed.rows[0]?.snapshot).toBeNull();

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Access fixture ended'
        WHERE id=$1
      `, [ids.targetBranchAssignmentA, ids.actorA]);
      const inactive = await db.query<SnapshotRow>(`
        SELECT axora_access_administration_snapshot(
          $1,$2,$3,$4,now()
        ) AS snapshot
      `, [
        ids.actorA,
        ids.actorAssignmentA,
        ids.target,
        ids.targetBranchAssignmentA,
      ]);
      expect(inactive.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes only the snapshot capability and preserves the boundary after grant reapplication", async () => {
    const db = new PGlite();
    try {
      await accessFixture(db, true);
      const source = await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        executeSnapshot: boolean;
        publicExecute: boolean;
        selectOverrides: boolean;
        selectLimits: boolean;
        selectDelegations: boolean;
        selectHistory: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "executeSnapshot",
          has_function_privilege(
            'public',
            'axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicExecute",
          has_table_privilege(
            'axora_app','user_permission_overrides','SELECT'
          ) AS "selectOverrides",
          has_table_privilege('axora_app','approval_limits','SELECT')
            AS "selectLimits",
          has_table_privilege('axora_app','delegated_access','SELECT')
            AS "selectDelegations",
          has_table_privilege(
            'axora_app','permission_change_history','SELECT'
          ) AS "selectHistory"
      `);
      expect(privileges.rows[0]).toEqual({
        executeSnapshot: true,
        publicExecute: false,
        selectOverrides: false,
        selectLimits: false,
        selectDelegations: false,
        selectHistory: false,
      });
      expect(source).toContain("public.axora_access_administration_snapshot(");

      await db.exec("SET ROLE axora_app");
      try {
        const result = await db.query<SnapshotRow>(`
          SELECT axora_access_administration_snapshot(
            $1,$2,$3,NULL,now()
          ) AS snapshot
        `, [ids.actorA, ids.actorAssignmentA, ids.target]);
        expect(result.rows[0]?.snapshot).toMatchObject({
          selectedAssignmentId: ids.targetBranchAssignmentA,
        });
        await expect(db.query("SELECT * FROM user_permission_overrides"))
          .rejects.toThrow();
      } finally {
        await db.exec("RESET ROLE");
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});