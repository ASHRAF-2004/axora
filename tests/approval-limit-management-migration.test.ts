import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/040_approval_limit_management.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  company: "c1000000-0000-4000-8000-000000000040",
  branch: "c2000000-0000-4000-8000-000000000040",
  department: "c3000000-0000-4000-8000-000000000040",
  otherCompany: "c4000000-0000-4000-8000-000000000040",
  otherBranch: "c5000000-0000-4000-8000-000000000040",
  actor: "a1000000-0000-4000-8000-000000000040",
  targetOne: "a2000000-0000-4000-8000-000000000040",
  targetTwo: "a3000000-0000-4000-8000-000000000040",
  outsideTarget: "a4000000-0000-4000-8000-000000000040",
  actorAssignment: "b1000000-0000-4000-8000-000000000040",
  targetOneAssignment: "b2000000-0000-4000-8000-000000000040",
  targetTwoAssignment: "b3000000-0000-4000-8000-000000000040",
  outsideAssignment: "b4000000-0000-4000-8000-000000000040",
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
  return source;
}

async function approvalFixture(db: PGlite) {
  await applyMigrations(db, { through: "039_scoped_permission_management.sql" });
  const roles = await db.query<{
    companyAdminRoleId: string;
    branchApproverRoleId: string;
  }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_APPROVER')
        AS "branchApproverRoleId"
  `);
  const context = roles.rows[0];
  if (!context?.companyAdminRoleId || !context.branchApproverRoleId) {
    throw new Error("Approval-limit fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO companies(id,company_code,name,active) VALUES
      ($1,'C-APL-040','Approval limit company',true),
      ($2,'C-APL-OTHER-040','Approval limit other company',true)
  `, [ids.company, ids.otherCompany]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,active
    ) VALUES
      ($1,'B-APL-040',$2,'Approval branch','APL-040','Address one',true),
      ($3,'B-APL-OTHER-040',$4,'Other approval branch','APL-O-040','Address two',true)
  `, [ids.branch, ids.company, ids.otherBranch, ids.otherCompany]);
  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES ($1,$2,$3,'D-APL-040','Approval department',true)
  `, [ids.department, ids.company, ids.branch]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'approval-actor@example.test','Approval actor','not-a-real-hash',
        $9,$5,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'approval-target-one@example.test','Approval target one','not-a-real-hash',
        $10,$5,$6,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'approval-target-two@example.test','Approval target two','not-a-real-hash',
        $10,$5,$6,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'approval-outside@example.test','Approval outside target','not-a-real-hash',
        $10,$7,$8,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.actor,
    ids.targetOne,
    ids.targetTwo,
    ids.outsideTarget,
    ids.company,
    ids.branch,
    ids.otherCompany,
    ids.otherBranch,
    context.companyAdminRoleId,
    context.branchApproverRoleId,
  ]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$5,'ACTIVE',true,now()),
      ($2,$5,'ACTIVE',true,now()),
      ($3,$5,'ACTIVE',true,now()),
      ($4,$6,'ACTIVE',true,now())
  `, [
    ids.actor,
    ids.targetOne,
    ids.targetTwo,
    ids.outsideTarget,
    ids.company,
    ids.otherCompany,
  ]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary
    ) VALUES
      ($1,$4,$5,'ACTIVE',true),
      ($2,$4,$5,'ACTIVE',true),
      ($3,$6,$7,'ACTIVE',true)
  `, [
    ids.targetOne,
    ids.targetTwo,
    ids.outsideTarget,
    ids.company,
    ids.branch,
    ids.otherCompany,
    ids.otherBranch,
  ]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,active
    ) VALUES
      ($1,$5,$9,'COMPANY',$10,NULL,true),
      ($2,$6,$11,'BRANCH',$10,$12,true),
      ($3,$7,$11,'BRANCH',$10,$12,true),
      ($4,$8,$11,'BRANCH',$13,$14,true)
  `, [
    ids.actorAssignment,
    ids.targetOneAssignment,
    ids.targetTwoAssignment,
    ids.outsideAssignment,
    ids.actor,
    ids.targetOne,
    ids.targetTwo,
    ids.outsideTarget,
    context.companyAdminRoleId,
    ids.company,
    context.branchApproverRoleId,
    ids.branch,
    ids.otherCompany,
    ids.otherBranch,
  ]);
  await db.query(`
    INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES
      ($1,repeat('a',64),now()+interval '8 hours'),
      ($2,repeat('b',64),now()+interval '8 hours'),
      ($3,repeat('c',64),now()+interval '8 hours')
  `, [ids.targetOne, ids.targetTwo, ids.outsideTarget]);

  await db.exec(await readFile(migrationUrl, "utf8"));
  return context;
}

describe("audited approval-limit management", () => {
  it("sets, deduplicates, replaces, removes, audits, and invalidates a user atomically", async () => {
    const db = new PGlite();
    try {
      await approvalFixture(db);
      const startsAt = "2026-08-06T12:00:00.000Z";
      const first = await db.query<{
        approval_limit_id: string;
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'request.approve.other','BRANCH',
          $5,$6,NULL,'MYR',5000.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.targetOne,
        ids.targetOneAssignment,
        ids.company,
        ids.branch,
        startsAt,
        "Initial branch approval ceiling",
      ]);
      expect(first.rows[0]).toMatchObject({
        affected_users: 1,
        revoked_sessions: 1,
        changed: true,
      });

      const repeated = await db.query<{
        approval_limit_id: string;
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'request.approve.other','BRANCH',
          $5,$6,NULL,'MYR',5000.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.targetOne,
        ids.targetOneAssignment,
        ids.company,
        ids.branch,
        startsAt,
        "Initial branch approval ceiling",
      ]);
      expect(repeated.rows[0]).toEqual({
        approval_limit_id: first.rows[0].approval_limit_id,
        affected_users: 0,
        revoked_sessions: 0,
        changed: false,
      });

      await db.query(`
        INSERT INTO user_sessions(user_id,token_hash,expires_at)
        VALUES ($1,repeat('d',64),now()+interval '8 hours')
      `, [ids.targetOne]);
      const replacement = await db.query<{
        approval_limit_id: string;
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'request.approve.other','BRANCH',
          $5,$6,NULL,'MYR',7500.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.targetOne,
        ids.targetOneAssignment,
        ids.company,
        ids.branch,
        startsAt,
        "Raised branch approval ceiling",
      ]);
      expect(replacement.rows[0]).toMatchObject({
        affected_users: 1,
        revoked_sessions: 1,
        changed: true,
      });
      expect(replacement.rows[0].approval_limit_id)
        .not.toBe(first.rows[0].approval_limit_id);

      await db.query(`
        INSERT INTO user_sessions(user_id,token_hash,expires_at)
        VALUES ($1,repeat('e',64),now()+interval '8 hours')
      `, [ids.targetOne]);
      const removed = await db.query<{
        approval_limit_id: string;
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_remove_approval_limit($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        replacement.rows[0].approval_limit_id,
        "Approval responsibility ended",
      ]);
      expect(removed.rows[0]).toMatchObject({
        affected_users: 1,
        revoked_sessions: 1,
        changed: true,
      });

      const repeatedRemoval = await db.query<{
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_remove_approval_limit($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        replacement.rows[0].approval_limit_id,
        "Approval responsibility already ended",
      ]);
      expect(repeatedRemoval.rows[0]).toMatchObject({
        affected_users: 0,
        revoked_sessions: 0,
        changed: false,
      });

      const state = await db.query<{
        active: number;
        history: number;
        authVersion: number;
        revokedSessions: number;
        setEvents: number;
        removeEvents: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM approval_limits
           WHERE user_id=$1 AND active) AS active,
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1) AS history,
          (SELECT auth_version::int FROM users WHERE id=$1) AS "authVersion",
          (SELECT count(*)::int FROM user_sessions
           WHERE user_id=$1 AND revoked_at IS NOT NULL) AS "revokedSessions",
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1 AND change_type='APPROVAL_LIMIT_SET')
            AS "setEvents",
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1 AND change_type='APPROVAL_LIMIT_REMOVED')
            AS "removeEvents"
      `, [ids.targetOne]);
      expect(state.rows[0]).toEqual({
        active: 0,
        history: 3,
        authVersion: 4,
        revokedSessions: 3,
        setEvents: 2,
        removeEvents: 1,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("limits role invalidation to intersecting scopes and rejects escalation or cross-tenant changes", async () => {
    const db = new PGlite();
    try {
      const context = await approvalFixture(db);
      const startsAt = "2026-08-06T12:00:00.000Z";
      const roleLimit = await db.query<{
        approval_limit_id: string;
        affected_users: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,NULL,NULL,$3,'request.approve.other','DEPARTMENT',
          $4,NULL,$5,'MYR',2500.00,false,$6,NULL,$7
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        context.branchApproverRoleId,
        ids.company,
        ids.department,
        startsAt,
        "Department approver role ceiling",
      ]);
      expect(roleLimit.rows[0]).toMatchObject({
        affected_users: 2,
        revoked_sessions: 2,
        changed: true,
      });

      const state = await db.query<{
        firstVersion: number;
        secondVersion: number;
        outsideVersion: number;
        outsideRevoked: number;
        storedBranch: string;
      }>(`
        SELECT
          (SELECT auth_version::int FROM users WHERE id=$1) AS "firstVersion",
          (SELECT auth_version::int FROM users WHERE id=$2) AS "secondVersion",
          (SELECT auth_version::int FROM users WHERE id=$3) AS "outsideVersion",
          (SELECT count(*)::int FROM user_sessions
           WHERE user_id=$3 AND revoked_at IS NOT NULL) AS "outsideRevoked",
          (SELECT branch_id::text FROM approval_limits
           WHERE id=$4) AS "storedBranch"
      `, [
        ids.targetOne,
        ids.targetTwo,
        ids.outsideTarget,
        roleLimit.rows[0].approval_limit_id,
      ]);
      expect(state.rows[0]).toEqual({
        firstVersion: 2,
        secondVersion: 2,
        outsideVersion: 1,
        outsideRevoked: 0,
        storedBranch: ids.branch,
      });

      await expect(db.query(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'request.approve.other','BRANCH',
          $5,$6,NULL,'MYR',100.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.outsideTarget,
        ids.outsideAssignment,
        ids.otherCompany,
        ids.otherBranch,
        startsAt,
        "Cross-company limit attempt",
      ])).rejects.toThrow(/cannot manage approval limits/i);

      await expect(db.query(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'request.approve.over_budget','BRANCH',
          $5,$6,NULL,'MYR',100.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.targetOne,
        ids.targetOneAssignment,
        ids.company,
        ids.branch,
        startsAt,
        "Target lacks over-budget authority",
      ])).rejects.toThrow(/does not possess the approval permission/i);

      await expect(db.query(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,NULL,NULL,$3,'request.approve.other','COMPANY',
          $4,NULL,NULL,'MYR',100.00,false,$5,NULL,$6
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        context.companyAdminRoleId,
        ids.company,
        startsAt,
        "Own role escalation attempt",
      ])).rejects.toThrow(/own role/i);

      await expect(db.query(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,NULL,NULL,$3,'request.approve.self','COMPANY',
          $4,NULL,NULL,'MYR',100.00,true,$5,NULL,$6
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        context.branchApproverRoleId,
        ids.company,
        startsAt,
        "Role self-approval attempt",
      ])).rejects.toThrow(/explicitly permitted user/i);

      await expect(db.query(`
        SELECT * FROM axora_set_approval_limit(
          $1,$2,$3,$4,NULL,'budget.increase','BRANCH',
          $5,$6,NULL,'MYR',100.00,false,$7,NULL,$8
        )
      `, [
        ids.actor,
        ids.actorAssignment,
        ids.targetOne,
        ids.targetOneAssignment,
        ids.company,
        ids.branch,
        startsAt,
        "Unsupported limit permission",
      ])).rejects.toThrow(/does not support approval limits/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps raw limits private and exposes only audited commands after grant reapplication", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const source = await applyApplicationGrantScript(db);
      expect(source).toContain("public.approval_limits");
      expect(source).toContain("public.axora_set_approval_limit(");
      expect(source).toContain("public.axora_remove_approval_limit(");

      const privileges = await db.query<{
        limitSelect: boolean;
        limitInsert: boolean;
        historyInsert: boolean;
        setCommand: boolean;
        removeCommand: boolean;
        invalidationHelper: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','approval_limits','SELECT')
            AS "limitSelect",
          has_table_privilege('axora_app','approval_limits','INSERT')
            AS "limitInsert",
          has_table_privilege('axora_app','permission_change_history','INSERT')
            AS "historyInsert",
          has_function_privilege(
            'axora_app',
            'axora_set_approval_limit(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,boolean,timestamptz,timestamptz,text)',
            'EXECUTE'
          ) AS "setCommand",
          has_function_privilege(
            'axora_app','axora_remove_approval_limit(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "removeCommand",
          has_function_privilege(
            'axora_app',
            'axora_invalidate_approval_limit_subject(uuid,uuid,text,uuid,uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "invalidationHelper"
      `);
      expect(privileges.rows[0]).toEqual({
        limitSelect: false,
        limitInsert: false,
        historyInsert: false,
        setCommand: true,
        removeCommand: true,
        invalidationHelper: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
