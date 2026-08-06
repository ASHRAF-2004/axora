import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migration037Url = new URL(
  "../database/migrations/037_effective_access_snapshot.sql",
  import.meta.url,
);

const ids = {
  user: "fa000000-0000-4000-8000-000000000037",
  assignment: "fb000000-0000-4000-8000-000000000037",
  override: "fc000000-0000-4000-8000-000000000037",
  expiredOverride: "fc000000-0000-4000-8000-000000000038",
  delegation: "fd000000-0000-4000-8000-000000000037",
  limit: "fe000000-0000-4000-8000-000000000037",
};

async function createCompanyUserFixture(db: PGlite) {
  await applyDemoSeed(db);
  const context = await db.query<{
    companyId: string;
    branchId: string;
    roleId: string;
    approvePermissionId: string;
    overBudgetPermissionId: string;
  }>(`
    SELECT
      branch.company_id::text AS "companyId",
      branch.id::text AS "branchId",
      (SELECT id::text FROM roles
        WHERE role_key='COMPANY_APPROVER') AS "roleId",
      (SELECT id::text FROM permissions
        WHERE permission_code='request.approve.other')
        AS "approvePermissionId",
      (SELECT id::text FROM permissions
        WHERE permission_code='request.approve.over_budget')
        AS "overBudgetPermissionId"
    FROM branches branch
    ORDER BY branch.id
    LIMIT 1
  `);
  const value = context.rows[0];

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_kind,account_status,active,auth_version
    ) VALUES (
      $1,'effective-access-user@example.test','Effective access user',
      'not-a-real-password-hash',$2,$3,false,
      'COMPANY','ACTIVE',true,11
    )
  `, [ids.user, value.roleId, value.companyId]);

  return value;
}

describe("live effective-access snapshot migration", () => {
  it("returns minimized live policy facts for the selected active assignment", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "036_authorization_policy_foundation.sql",
      });
      const context = await createCompanyUserFixture(db);
      await db.exec(await readFile(migration037Url, "utf8"));

      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_at
        ) VALUES ($1,$2,$3,'COMPANY',$4,true,$5)
      `, [
        ids.assignment,
        ids.user,
        context.roleId,
        context.companyId,
        "2026-08-06T04:00:00.000Z",
      ]);

      await db.query(`
        INSERT INTO user_permission_overrides(
          id,user_id,permission_id,effect,scope_type,company_id,
          starts_at,ends_at,active,reason,changed_by
        ) VALUES
          ($1,$2,$3,'DENY','COMPANY',$4,$5,$6,true,
            'Temporary scoped separation of duties',$2),
          ($7,$2,$3,'GRANT','COMPANY',$4,$8,$9,true,
            'Expired historical grant',$2)
      `, [
        ids.override,
        ids.user,
        context.approvePermissionId,
        context.companyId,
        "2026-08-06T04:00:00.000Z",
        "2026-08-06T06:00:00.000Z",
        ids.expiredOverride,
        "2026-08-06T02:00:00.000Z",
        "2026-08-06T03:00:00.000Z",
      ]);

      await db.query(`
        INSERT INTO approval_limits(
          id,user_id,permission_id,scope_type,company_id,currency,
          maximum_amount,allow_self_approval,starts_at,active,reason,changed_by
        ) VALUES (
          $1,$2,$3,'COMPANY',$4,'MYR',2500,false,$5,true,
          'Approved company request limit',$2
        )
      `, [
        ids.limit,
        ids.user,
        context.approvePermissionId,
        context.companyId,
        "2026-08-06T04:00:00.000Z",
      ]);

      await db.query(`
        INSERT INTO delegated_access(
          id,grantee_user_id,authorized_by,starts_at,ends_at,status,reason
        ) VALUES ($1,$2,$2,$3,$4,'ACTIVE','Temporary budget coverage')
      `, [
        ids.delegation,
        ids.user,
        "2026-08-06T04:00:00.000Z",
        "2026-08-06T06:00:00.000Z",
      ]);
      await db.query(`
        INSERT INTO delegated_access_permissions(
          delegated_access_id,permission_id
        ) VALUES ($1,$2)
      `, [ids.delegation, context.overBudgetPermissionId]);
      await db.query(`
        INSERT INTO delegated_access_scopes(
          delegated_access_id,scope_type,company_id
        ) VALUES ($1,'COMPANY',$2)
      `, [ids.delegation, context.companyId]);

      const result = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [
        ids.user,
        ids.assignment,
        "2026-08-06T05:00:00.000Z",
      ]);
      const snapshot = result.rows[0].snapshot;

      expect(snapshot).toMatchObject({
        accountStatus: "ACTIVE",
        accountKind: "COMPANY",
        isOwner: false,
        authVersion: 11,
        roleAssignmentId: ids.assignment,
        roleKey: "COMPANY_APPROVER",
      });
      expect(snapshot.scopes).toEqual([{
        type: "COMPANY",
        companyId: context.companyId,
      }]);
      expect(snapshot.rolePermissions).toEqual(expect.arrayContaining([
        "request.view",
        "request.approve.other",
        "budget.view",
      ]));
      expect(snapshot.permissionOverrides).toEqual([expect.objectContaining({
        permission: "request.approve.other",
        effect: "DENY",
      })]);
      expect(snapshot.delegations).toEqual([expect.objectContaining({
        permissions: ["request.approve.over_budget"],
      })]);
      expect(snapshot.approvalLimits).toEqual([expect.objectContaining({
        permission: "request.approve.other",
        currency: "MYR",
        maximumAmount: 2500,
      })]);

      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("effective-access-user@example.test");
      expect(serialized).not.toContain("not-a-real-password-hash");
      expect(Object.keys(snapshot)).not.toContain("email");
      expect(Object.keys(snapshot)).not.toContain("passwordHash");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("synchronizes assignment scopes and stops serving revoked or inactive identities", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "036_authorization_policy_foundation.sql",
      });
      const context = await createCompanyUserFixture(db);
      await db.exec(await readFile(migration037Url, "utf8"));

      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active
        ) VALUES ($1,$2,$3,'COMPANY',$4,true)
      `, [ids.assignment, ids.user, context.roleId, context.companyId]);

      const activeScope = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM user_scopes
        WHERE user_id=$1
          AND source='ROLE_ASSIGNMENT'
          AND source_reference=$2
          AND active
      `, [ids.user, ids.assignment]);
      expect(activeScope.rows[0].count).toBe(1);

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now()
        WHERE id=$1
      `, [ids.assignment]);

      const revoked = await db.query<{
        activeScopes: number;
        snapshot: unknown;
      }>(`
        SELECT
          (SELECT count(*)::int
           FROM user_scopes
           WHERE source='ROLE_ASSIGNMENT'
             AND source_reference=$2
             AND active) AS "activeScopes",
          axora_effective_access_snapshot($1,$2,now()) AS snapshot
      `, [ids.user, ids.assignment]);
      expect(revoked.rows[0]).toEqual({ activeScopes: 0, snapshot: null });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("grants the application only the snapshot function, not raw policy tables", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "036_authorization_policy_foundation.sql",
      });
      await db.exec("CREATE ROLE axora_app");
      await db.exec(await readFile(migration037Url, "utf8"));

      const privileges = await db.query<{
        executeSnapshot: boolean;
        selectScopes: boolean;
        selectOverrides: boolean;
        publicExecute: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_effective_access_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "executeSnapshot",
          has_table_privilege('axora_app','user_scopes','SELECT')
            AS "selectScopes",
          has_table_privilege(
            'axora_app','user_permission_overrides','SELECT'
          ) AS "selectOverrides",
          has_function_privilege(
            'public',
            'axora_effective_access_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicExecute"
      `);
      expect(privileges.rows[0]).toEqual({
        executeSnapshot: true,
        selectScopes: false,
        selectOverrides: false,
        publicExecute: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
