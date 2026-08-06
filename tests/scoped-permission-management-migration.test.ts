import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/039_scoped_permission_management.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  actor: "a1000000-0000-4000-8000-000000000039",
  target: "a2000000-0000-4000-8000-000000000039",
  otherTarget: "a3000000-0000-4000-8000-000000000039",
  secondOwner: "a4000000-0000-4000-8000-000000000039",
  actorAssignment: "b1000000-0000-4000-8000-000000000039",
  targetAssignment: "b2000000-0000-4000-8000-000000000039",
  otherAssignment: "b3000000-0000-4000-8000-000000000039",
  secondOwnerAssignment: "b4000000-0000-4000-8000-000000000039",
};

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

async function permissionFixture(db: PGlite) {
  await applyMigrations(db, { through: "038_canonical_session_scopes.sql" });
  await applyDemoSeed(db);
  const context = await db.query<{
    companyId: string;
    branchId: string;
    secondCompanyId: string;
    secondBranchId: string;
    companyAdminRoleId: string;
    requesterRoleId: string;
    ownerRoleId: string;
    existingOwnerId: string;
    existingOwnerAssignmentId: string;
  }>(`
    SELECT
      first_company.id::text AS "companyId",
      first_branch.id::text AS "branchId",
      second_company.id::text AS "secondCompanyId",
      second_branch.id::text AS "secondBranchId",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='REQUESTER')
        AS "requesterRoleId",
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS "ownerRoleId",
      owner.id::text AS "existingOwnerId",
      owner_assignment.id::text AS "existingOwnerAssignmentId"
    FROM companies first_company
    JOIN branches first_branch ON first_branch.company_id=first_company.id
    JOIN companies second_company ON second_company.id<>first_company.id
    JOIN branches second_branch ON second_branch.company_id=second_company.id
    JOIN users owner ON owner.is_owner AND owner.active
    JOIN role_assignments owner_assignment
      ON owner_assignment.user_id=owner.id AND owner_assignment.active
    ORDER BY first_company.id,first_branch.id,second_company.id,second_branch.id
    LIMIT 1
  `);
  const value = context.rows[0];

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'permission-actor@example.test','Permission actor','not-a-real-hash',
        $5,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'permission-target@example.test','Permission target','not-a-real-hash',
        $6,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'permission-other@example.test','Permission other','not-a-real-hash',
        $6,$10,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'permission-owner@example.test','Permission owner','not-a-real-hash',
        $7,NULL,true,now(),'PLATFORM','ACTIVE',true,1)
  `, [
    ids.actor,
    ids.target,
    ids.otherTarget,
    ids.secondOwner,
    value.companyAdminRoleId,
    value.requesterRoleId,
    value.ownerRoleId,
    null,
    value.companyId,
    value.secondCompanyId,
  ]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$4,'ACTIVE',true,now()),
      ($2,$4,'ACTIVE',true,now()),
      ($3,$5,'ACTIVE',true,now())
  `, [ids.actor, ids.target, ids.otherTarget, value.companyId, value.secondCompanyId]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary
    ) VALUES
      ($1,$3,$4,'ACTIVE',true),
      ($2,$5,$6,'ACTIVE',true)
  `, [
    ids.target,
    ids.otherTarget,
    value.companyId,
    value.branchId,
    value.secondCompanyId,
    value.secondBranchId,
  ]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,active
    ) VALUES
      ($1,$5,$8,'COMPANY',$9,NULL,true),
      ($2,$6,$10,'BRANCH',$9,$11,true),
      ($3,$7,$10,'BRANCH',$12,$13,true),
      ($4,$14,$15,'PLATFORM',NULL,NULL,true)
  `, [
    ids.actorAssignment,
    ids.targetAssignment,
    ids.otherAssignment,
    ids.secondOwnerAssignment,
    ids.actor,
    ids.target,
    ids.otherTarget,
    value.companyAdminRoleId,
    value.companyId,
    value.requesterRoleId,
    value.branchId,
    value.secondCompanyId,
    value.secondBranchId,
    ids.secondOwner,
    value.ownerRoleId,
  ]);
  await db.query(`
    INSERT INTO user_sessions(user_id,token_hash,expires_at)
    VALUES ($1,$2,now()+interval '8 hours')
  `, [ids.target, "a".repeat(64)]);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return value;
}

describe("audited scoped permission management", () => {
  it("sets, deduplicates, removes, audits, and invalidates sessions atomically", async () => {
    const db = new PGlite();
    try {
      const context = await permissionFixture(db);
      const startsAt = "2026-08-06T10:00:00.000Z";
      const first = await db.query<{
        override_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'request.approve.other','GRANT','BRANCH',
          $5,$6,NULL,NULL,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        context.companyId,
        context.branchId,
        startsAt,
        "Temporary approval coverage",
      ]);
      expect(first.rows[0]).toMatchObject({
        auth_version: 2,
        revoked_sessions: 1,
        changed: true,
      });

      const repeated = await db.query<{
        override_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'request.approve.other','GRANT','BRANCH',
          $5,$6,NULL,NULL,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        context.companyId,
        context.branchId,
        startsAt,
        "Temporary approval coverage",
      ]);
      expect(repeated.rows[0]).toEqual({
        override_id: first.rows[0].override_id,
        auth_version: 2,
        revoked_sessions: 0,
        changed: false,
      });

      const afterSet = await db.query<{
        active: number;
        history: number;
        authVersion: number;
        revoked: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM user_permission_overrides
           WHERE user_id=$1 AND active) AS active,
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1) AS history,
          (SELECT auth_version::int FROM users WHERE id=$1) AS "authVersion",
          (SELECT count(*)::int FROM user_sessions
           WHERE user_id=$1 AND revoked_at IS NOT NULL) AS revoked
      `, [ids.target]);
      expect(afterSet.rows[0]).toEqual({
        active: 1,
        history: 1,
        authVersion: 2,
        revoked: 1,
      });

      const removed = await db.query<{
        override_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_remove_user_permission_override($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        first.rows[0].override_id,
        "Temporary coverage ended",
      ]);
      expect(removed.rows[0]).toMatchObject({
        override_id: first.rows[0].override_id,
        auth_version: 3,
        changed: true,
      });
      const repeatedRemoval = await db.query<{
        changed: boolean;
        auth_version: number;
        revoked_sessions: number;
      }>(`
        SELECT * FROM axora_remove_user_permission_override($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        first.rows[0].override_id,
        "Temporary coverage already ended",
      ]);
      expect(repeatedRemoval.rows[0]).toMatchObject({
        changed: false,
        auth_version: 3,
        revoked_sessions: 0,
      });
      const afterRemove = await db.query<{ active: number; history: number }>(`
        SELECT
          (SELECT count(*)::int FROM user_permission_overrides
           WHERE user_id=$1 AND active) AS active,
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1) AS history
      `, [ids.target]);
      expect(afterRemove.rows[0]).toEqual({ active: 0, history: 2 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects self-change, cross-company scope, unsupported grants, and owner denial", async () => {
    const db = new PGlite();
    try {
      const context = await permissionFixture(db);
      const common = [
        "2026-08-06T10:00:00.000Z",
        "Policy enforcement test",
      ];

      await expect(db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$1,$2,'request.approve.other','GRANT','COMPANY',
          $3,NULL,NULL,NULL,$4,NULL,$5
        )
      `, [ids.actor, ids.actorAssignment, context.companyId, ...common]))
        .rejects.toThrow(/own protected permissions/i);

      await expect(db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'request.approve.other','GRANT','BRANCH',
          $5,$6,NULL,NULL,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.otherTarget,
        ids.otherAssignment,
        context.secondCompanyId,
        context.secondBranchId,
        ...common,
      ])).rejects.toThrow(/cannot manage permissions/i);

      await expect(db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'commercial.platform_margin.view','GRANT','BRANCH',
          $5,$6,NULL,NULL,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        context.companyId,
        context.branchId,
        ...common,
      ])).rejects.toThrow(/do not possess/i);

      await expect(db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'platform.view','DENY','PLATFORM',
          NULL,NULL,NULL,NULL,$5,NULL,$6
        )
      `, [
        context.existingOwnerId,
        context.existingOwnerAssignmentId,
        ids.secondOwner,
        ids.secondOwnerAssignment,
        ...common,
      ])).rejects.toThrow(/cannot be denied/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps raw policy state private and exposes only snapshot and command functions after grant reapplication", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        overrideSelect: boolean;
        historyInsert: boolean;
        setCommand: boolean;
        removeCommand: boolean;
        snapshot: boolean;
        helper: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'axora_app','user_permission_overrides','SELECT'
          ) AS "overrideSelect",
          has_table_privilege(
            'axora_app','permission_change_history','INSERT'
          ) AS "historyInsert",
          has_function_privilege(
            'axora_app',
            'axora_set_user_permission_override(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text)',
            'EXECUTE'
          ) AS "setCommand",
          has_function_privilege(
            'axora_app',
            'axora_remove_user_permission_override(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "removeCommand",
          has_function_privilege(
            'axora_app',
            'axora_effective_access_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS snapshot,
          has_function_privilege(
            'axora_app',
            'axora_snapshot_has_permission(jsonb,text,text,uuid,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS helper
      `);
      expect(privileges.rows[0]).toEqual({
        overrideSelect: false,
        historyInsert: false,
        setCommand: true,
        removeCommand: true,
        snapshot: true,
        helper: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
