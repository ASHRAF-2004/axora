import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/041_delegated_access_management.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  company: "c1000000-0000-4000-8000-000000000041",
  branch: "c2000000-0000-4000-8000-000000000041",
  secondBranch: "c3000000-0000-4000-8000-000000000041",
  department: "c4000000-0000-4000-8000-000000000041",
  otherCompany: "c5000000-0000-4000-8000-000000000041",
  otherBranch: "c6000000-0000-4000-8000-000000000041",
  actor: "a1000000-0000-4000-8000-000000000041",
  requester: "a2000000-0000-4000-8000-000000000041",
  branchAdmin: "a3000000-0000-4000-8000-000000000041",
  outsideRequester: "a4000000-0000-4000-8000-000000000041",
  backupManager: "a5000000-0000-4000-8000-000000000041",
  owner: "a6000000-0000-4000-8000-000000000041",
  actorAssignment: "b1000000-0000-4000-8000-000000000041",
  requesterAssignment: "b2000000-0000-4000-8000-000000000041",
  requesterSecondAssignment: "b3000000-0000-4000-8000-000000000041",
  branchAdminAssignment: "b4000000-0000-4000-8000-000000000041",
  outsideAssignment: "b5000000-0000-4000-8000-000000000041",
  backupManagerAssignment: "b6000000-0000-4000-8000-000000000041",
  ownerAssignment: "b7000000-0000-4000-8000-000000000041",
  command: "d1000000-0000-4000-8000-000000000041",
  liveAuthorityCommand: "d2000000-0000-4000-8000-000000000041",
  backupCommand: "d3000000-0000-4000-8000-000000000041",
  crossTenantCommand: "d4000000-0000-4000-8000-000000000041",
  broadScopeCommand: "d5000000-0000-4000-8000-000000000041",
  ownerCommand: "d6000000-0000-4000-8000-000000000041",
  nonDelegatableCommand: "d7000000-0000-4000-8000-000000000041",
} as const;

interface FixtureContext {
  companyAdminRoleId: string;
  requesterRoleId: string;
  branchAdminRoleId: string;
  accountManagerRoleId: string;
  ownerRoleId: string;
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

async function delegationFixture(db: PGlite): Promise<FixtureContext> {
  await applyMigrations(db, { through: "040_approval_limit_management.sql" });
  const roles = await db.query<FixtureContext>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='REQUESTER')
        AS "requesterRoleId",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_ADMIN')
        AS "branchAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER')
        AS "accountManagerRoleId",
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS "ownerRoleId"
  `);
  const context = roles.rows[0];
  if (!context?.companyAdminRoleId || !context.requesterRoleId
    || !context.branchAdminRoleId || !context.accountManagerRoleId
    || !context.ownerRoleId) {
    throw new Error("Delegated-access fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO companies(id,company_code,name,active) VALUES
      ($1,'C-DLG-041','Delegation company',true),
      ($2,'C-DLG-OTHER-041','Delegation other company',true)
  `, [ids.company, ids.otherCompany]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,active
    ) VALUES
      ($1,'B-DLG-041',$2,'Delegation branch','DLG-041','Address one',true),
      ($3,'B-DLG-SECOND-041',$2,'Delegation second branch','DLG-2-041','Address two',true),
      ($4,'B-DLG-OTHER-041',$5,'Delegation other branch','DLG-O-041','Address three',true)
  `, [
    ids.branch,
    ids.company,
    ids.secondBranch,
    ids.otherBranch,
    ids.otherCompany,
  ]);
  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES ($1,$2,$3,'D-DLG-041','Delegation department',true)
  `, [ids.department, ids.company, ids.branch]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'delegation-actor@example.test','Delegation actor','not-a-real-hash',
        $11,$7,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'delegation-requester@example.test','Delegation requester','not-a-real-hash',
        $12,$7,$8,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'delegation-branch-admin@example.test','Delegation branch admin','not-a-real-hash',
        $13,$7,$8,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'delegation-outside@example.test','Delegation outside requester','not-a-real-hash',
        $12,$9,$10,false,now(),'COMPANY','ACTIVE',true,1),
      ($5,'delegation-backup-manager@example.test','Delegation backup manager','not-a-real-hash',
        $14,NULL,NULL,false,now(),'PLATFORM','ACTIVE',true,1),
      ($6,'delegation-owner@example.test','Delegation owner','not-a-real-hash',
        $15,NULL,NULL,true,now(),'PLATFORM','ACTIVE',true,1)
  `, [
    ids.actor,
    ids.requester,
    ids.branchAdmin,
    ids.outsideRequester,
    ids.backupManager,
    ids.owner,
    ids.company,
    ids.branch,
    ids.otherCompany,
    ids.otherBranch,
    context.companyAdminRoleId,
    context.requesterRoleId,
    context.branchAdminRoleId,
    context.accountManagerRoleId,
    context.ownerRoleId,
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
    ids.requester,
    ids.branchAdmin,
    ids.outsideRequester,
    ids.company,
    ids.otherCompany,
  ]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary
    ) VALUES
      ($1,$4,$5,'ACTIVE',true),
      ($1,$4,$6,'ACTIVE',false),
      ($2,$4,$5,'ACTIVE',true),
      ($3,$7,$8,'ACTIVE',true)
  `, [
    ids.requester,
    ids.branchAdmin,
    ids.outsideRequester,
    ids.company,
    ids.branch,
    ids.secondBranch,
    ids.otherCompany,
    ids.otherBranch,
  ]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,active
    ) VALUES
      ($1,$8,$14,'COMPANY',$15,NULL,true),
      ($2,$9,$16,'BRANCH',$15,$17,true),
      ($3,$9,$16,'BRANCH',$15,$18,true),
      ($4,$10,$19,'BRANCH',$15,$17,true),
      ($5,$11,$16,'BRANCH',$20,$21,true),
      ($6,$12,$22,'COMPANY',$20,NULL,true),
      ($7,$13,$23,'PLATFORM',NULL,NULL,true)
  `, [
    ids.actorAssignment,
    ids.requesterAssignment,
    ids.requesterSecondAssignment,
    ids.branchAdminAssignment,
    ids.outsideAssignment,
    ids.backupManagerAssignment,
    ids.ownerAssignment,
    ids.actor,
    ids.requester,
    ids.branchAdmin,
    ids.outsideRequester,
    ids.backupManager,
    ids.owner,
    context.companyAdminRoleId,
    ids.company,
    context.requesterRoleId,
    ids.branch,
    ids.secondBranch,
    context.branchAdminRoleId,
    ids.otherCompany,
    ids.otherBranch,
    context.accountManagerRoleId,
    context.ownerRoleId,
  ]);
  await db.query(`
    INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES
      ($1,repeat('a',64),now()+interval '8 hours'),
      ($2,repeat('b',64),now()+interval '8 hours'),
      ($3,repeat('c',64),now()+interval '8 hours'),
      ($4,repeat('d',64),now()+interval '8 hours')
  `, [
    ids.requester,
    ids.branchAdmin,
    ids.outsideRequester,
    ids.backupManager,
  ]);

  await db.exec(await readFile(migrationUrl, "utf8"));
  return context;
}

function schedule() {
  const now = Date.now();
  return {
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + 24 * 60 * 60 * 1000),
    snapshotAt: new Date(now + 60_000),
  };
}

describe("audited delegated-access management", () => {
  it("creates, deduplicates, binds, audits, revokes, and invalidates atomically", async () => {
    const db = new PGlite();
    try {
      await delegationFixture(db);
      const { startsAt, endsAt, snapshotAt } = schedule();
      const permissions = ["request.view", "document.download"];
      const scopes = [{
        type: "BRANCH",
        companyId: ids.company,
        branchId: ids.branch,
      }];

      const first = await db.query<{
        delegated_access_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.command,
        ids.actor,
        ids.actorAssignment,
        ids.requester,
        ids.requesterAssignment,
        permissions,
        JSON.stringify(scopes),
        startsAt,
        endsAt,
        "Temporary request review coverage",
      ]);
      expect(first.rows[0]).toMatchObject({
        auth_version: 2,
        revoked_sessions: 1,
        changed: true,
      });

      const repeated = await db.query<{
        delegated_access_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.command,
        ids.actor,
        ids.actorAssignment,
        ids.requester,
        ids.requesterAssignment,
        permissions,
        JSON.stringify(scopes),
        startsAt,
        endsAt,
        "Temporary request review coverage",
      ]);
      expect(repeated.rows[0]).toEqual({
        delegated_access_id: first.rows[0].delegated_access_id,
        auth_version: 2,
        revoked_sessions: 0,
        changed: false,
      });

      await expect(db.query(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.command,
        ids.actor,
        ids.actorAssignment,
        ids.requester,
        ids.requesterAssignment,
        ["request.view"],
        JSON.stringify(scopes),
        startsAt,
        endsAt,
        "Conflicting retry payload",
      ])).rejects.toThrow(/conflicts with another request/i);

      const snapshot = await db.query<{ snapshot: {
        delegations: Array<{
          active: boolean;
          startsAt: string;
          endsAt: string;
          permissions: string[];
          scopes: Array<Record<string, string>>;
        }>;
      } }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterAssignment, snapshotAt]);
      expect(snapshot.rows[0].snapshot.delegations).toHaveLength(1);
      const effectiveDelegation = snapshot.rows[0].snapshot.delegations[0];
      expect(effectiveDelegation).toMatchObject({
        active: true,
        permissions: ["document.download", "request.view"],
        scopes: [{
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        }],
      });
      expect(new Date(effectiveDelegation.startsAt).getTime())
        .toBe(startsAt.getTime());
      expect(new Date(effectiveDelegation.endsAt).getTime())
        .toBe(endsAt.getTime());

      const otherAssignmentSnapshot = await db.query<{ snapshot: {
        delegations: unknown[];
      } }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterSecondAssignment, snapshotAt]);
      expect(otherAssignmentSnapshot.rows[0].snapshot.delegations).toEqual([]);

      await db.query(`
        INSERT INTO user_sessions(user_id,token_hash,expires_at)
        VALUES ($1,repeat('e',64),now()+interval '8 hours')
      `, [ids.requester]);
      const revoked = await db.query<{
        delegated_access_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_revoke_delegated_access($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        first.rows[0].delegated_access_id,
        "Coverage ended early",
      ]);
      expect(revoked.rows[0]).toMatchObject({
        auth_version: 3,
        revoked_sessions: 1,
        changed: true,
      });

      const repeatedRevocation = await db.query<{
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_revoke_delegated_access($1,$2,$3,$4)
      `, [
        ids.actor,
        ids.actorAssignment,
        first.rows[0].delegated_access_id,
        "Coverage was already revoked",
      ]);
      expect(repeatedRevocation.rows[0]).toMatchObject({
        auth_version: 3,
        revoked_sessions: 0,
        changed: false,
      });

      const state = await db.query<{
        history: number;
        activeDelegations: number;
        revokedSessions: number;
        correlationId: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM permission_change_history
           WHERE target_user_id=$1
             AND change_type IN ('DELEGATION_CREATED','DELEGATION_REVOKED'))
            AS history,
          (SELECT count(*)::int FROM delegated_access
           WHERE grantee_user_id=$1 AND status='ACTIVE') AS "activeDelegations",
          (SELECT count(*)::int FROM user_sessions
           WHERE user_id=$1 AND revoked_at IS NOT NULL) AS "revokedSessions",
          (SELECT correlation_id::text FROM permission_change_history
           WHERE target_user_id=$1 AND change_type='DELEGATION_CREATED')
            AS "correlationId"
      `, [ids.requester]);
      expect(state.rows[0]).toEqual({
        history: 2,
        activeDelegations: 0,
        revokedSessions: 2,
        correlationId: ids.command,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("supports temporary backup account managers and rejects broader or cross-tenant grantees", async () => {
    const db = new PGlite();
    try {
      await delegationFixture(db);
      const { startsAt, endsAt, snapshotAt } = schedule();

      const backup = await db.query<{
        delegated_access_id: string;
        changed: boolean;
      }>(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.backupCommand,
        ids.actor,
        ids.actorAssignment,
        ids.backupManager,
        ids.backupManagerAssignment,
        ["company.view"],
        JSON.stringify([{ type: "COMPANY", companyId: ids.company }]),
        startsAt,
        endsAt,
        "Temporary backup account manager coverage",
      ]);
      expect(backup.rows[0]).toMatchObject({ changed: true });

      const backupSnapshot = await db.query<{ snapshot: {
        scopes: Array<Record<string, string>>;
        delegations: Array<{
          permissions: string[];
          scopes: Array<Record<string, string>>;
        }>;
      } }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.backupManager, ids.backupManagerAssignment, snapshotAt]);
      expect(backupSnapshot.rows[0].snapshot.scopes).toContainEqual({
        type: "COMPANY",
        companyId: ids.otherCompany,
      });
      expect(backupSnapshot.rows[0].snapshot.delegations[0]).toMatchObject({
        permissions: ["company.view"],
        scopes: [{ type: "COMPANY", companyId: ids.company }],
      });

      await expect(db.query(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.crossTenantCommand,
        ids.actor,
        ids.actorAssignment,
        ids.outsideRequester,
        ids.outsideAssignment,
        ["request.view"],
        JSON.stringify([{
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        }]),
        startsAt,
        endsAt,
        "Cross-tenant delegation attempt",
      ])).rejects.toThrow(/another tenant scope/i);

      await expect(db.query(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.broadScopeCommand,
        ids.actor,
        ids.actorAssignment,
        ids.branchAdmin,
        ids.branchAdminAssignment,
        ["request.view"],
        JSON.stringify([{ type: "COMPANY", companyId: ids.company }]),
        startsAt,
        endsAt,
        "Branch administrator company-wide attempt",
      ])).rejects.toThrow(/role cannot receive/i);

      await expect(db.query(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.ownerCommand,
        ids.actor,
        ids.actorAssignment,
        ids.owner,
        ids.ownerAssignment,
        ["company.view"],
        JSON.stringify([{ type: "COMPANY", companyId: ids.company }]),
        startsAt,
        endsAt,
        "Platform owner delegation attempt",
      ])).rejects.toThrow(/platform-owner authority cannot be delegated/i);

      await expect(db.query(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.nonDelegatableCommand,
        ids.actor,
        ids.actorAssignment,
        ids.requester,
        ids.requesterAssignment,
        ["user.permission.manage"],
        JSON.stringify([{
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        }]),
        startsAt,
        endsAt,
        "Non-delegatable authority attempt",
      ])).rejects.toThrow(/cannot be delegated/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("withdraws delegated authority immediately when the original direct authority is denied", async () => {
    const db = new PGlite();
    try {
      await delegationFixture(db);
      const { startsAt, endsAt, snapshotAt } = schedule();
      const created = await db.query<{ delegated_access_id: string }>(`
        SELECT * FROM axora_create_delegated_access(
          $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
        )
      `, [
        ids.liveAuthorityCommand,
        ids.actor,
        ids.actorAssignment,
        ids.requester,
        ids.requesterAssignment,
        ["request.view"],
        JSON.stringify([{
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        }]),
        startsAt,
        endsAt,
        "Coverage depends on live authorizer authority",
      ]);
      expect(created.rows).toHaveLength(1);

      const before = await db.query<{ snapshot: { delegations: unknown[] } }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterAssignment, snapshotAt]);
      expect(before.rows[0].snapshot.delegations).toHaveLength(1);

      await db.query(
        "UPDATE branches SET active=false WHERE id=$1",
        [ids.branch],
      );
      const inactiveScope = await db.query<{
        snapshot: { delegations: unknown[] };
      }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterAssignment, snapshotAt]);
      expect(inactiveScope.rows[0].snapshot.delegations).toEqual([]);
      await db.query(
        "UPDATE branches SET active=true WHERE id=$1",
        [ids.branch],
      );
      const restoredScope = await db.query<{
        snapshot: { delegations: unknown[] };
      }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterAssignment, snapshotAt]);
      expect(restoredScope.rows[0].snapshot.delegations).toHaveLength(1);

      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,company_id,branch_id,
          starts_at,active,reason,changed_by
        ) VALUES (
          $1,(SELECT id FROM permissions WHERE permission_code='request.view'),
          'DENY','BRANCH',$2,$3,now()-interval '1 minute',true,$4,$1
        )
      `, [
        ids.actor,
        ids.company,
        ids.branch,
        "Direct authority withdrawn for regression test",
      ]);

      const after = await db.query<{ snapshot: { delegations: unknown[] } }>(`
        SELECT axora_effective_access_snapshot($1,$2,$3) AS snapshot
      `, [ids.requester, ids.requesterAssignment, snapshotAt]);
      expect(after.rows[0].snapshot.delegations).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps policy tables private and exposes only snapshot and management commands after grant reapplication", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const source = await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        delegationSelect: boolean;
        delegationInsert: boolean;
        createCommand: boolean;
        revokeCommand: boolean;
        snapshot: boolean;
        scopeHelper: boolean;
        permissionHelper: boolean;
        activeScopeHelper: boolean;
        authorityHelper: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','delegated_access','SELECT')
            AS "delegationSelect",
          has_table_privilege('axora_app','delegated_access','INSERT')
            AS "delegationInsert",
          has_function_privilege(
            'axora_app',
            'axora_create_delegated_access(uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text)',
            'EXECUTE'
          ) AS "createCommand",
          has_function_privilege(
            'axora_app','axora_revoke_delegated_access(uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "revokeCommand",
          has_function_privilege(
            'axora_app','axora_effective_access_snapshot(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS snapshot,
          has_function_privilege(
            'axora_app',
            'axora_role_assignment_scope_contains(uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "scopeHelper",
          has_function_privilege(
            'axora_app',
            'axora_role_assignment_has_direct_permission(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "permissionHelper",
          has_function_privilege(
            'axora_app',
            'axora_delegation_scope_is_active(text,uuid,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS "activeScopeHelper",
          has_function_privilege(
            'axora_app','axora_delegation_authority_is_live(uuid,timestamptz)',
            'EXECUTE'
          ) AS "authorityHelper"
      `);
      expect(privileges.rows[0]).toEqual({
        delegationSelect: false,
        delegationInsert: false,
        createCommand: true,
        revokeCommand: true,
        snapshot: true,
        scopeHelper: false,
        permissionHelper: false,
        activeScopeHelper: false,
        authorityHelper: false,
      });
      expect(source).toContain("public.axora_create_delegated_access(");
      expect(source).toContain("public.axora_revoke_delegated_access(");
      expect(source).toContain("public.axora_delegation_scope_is_active(");
      expect(source).toContain("public.axora_delegation_authority_is_live(");
    } finally {
      await db.close();
    }
  }, 30_000);
});
