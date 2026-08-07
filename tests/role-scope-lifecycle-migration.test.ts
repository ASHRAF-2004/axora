import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/042_role_scope_lifecycle.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  company: "c1000000-0000-4000-8000-000000000042",
  branch: "c2000000-0000-4000-8000-000000000042",
  department: "c3000000-0000-4000-8000-000000000042",
  otherCompany: "c4000000-0000-4000-8000-000000000042",
  otherBranch: "c5000000-0000-4000-8000-000000000042",
  owner: "a1000000-0000-4000-8000-000000000042",
  futureOwner: "a2000000-0000-4000-8000-000000000042",
  companyAdmin: "a3000000-0000-4000-8000-000000000042",
  requester: "a4000000-0000-4000-8000-000000000042",
  outsideRequester: "a5000000-0000-4000-8000-000000000042",
  otherCompanyAdmin: "a6000000-0000-4000-8000-000000000042",
  invitedUser: "a7000000-0000-4000-8000-000000000042",
  ownerAssignment: "b1000000-0000-4000-8000-000000000042",
  futureOwnerAssignment: "b2000000-0000-4000-8000-000000000042",
  companyAdminAssignment: "b3000000-0000-4000-8000-000000000042",
  requesterAssignment: "b4000000-0000-4000-8000-000000000042",
  outsideRequesterAssignment: "b5000000-0000-4000-8000-000000000042",
  otherCompanyAdminAssignment: "b6000000-0000-4000-8000-000000000042",
  assignBranchAdminCommand: "d1000000-0000-4000-8000-000000000042",
  revokeBranchAdminCommand: "d2000000-0000-4000-8000-000000000042",
  assignSecondAdminCommand: "d3000000-0000-4000-8000-000000000042",
  assignOwnerCommand: "d4000000-0000-4000-8000-000000000042",
  crossTenantCommand: "d5000000-0000-4000-8000-000000000042",
  invalidRoleCommand: "d6000000-0000-4000-8000-000000000042",
  invitedAssignment: "d7000000-0000-4000-8000-000000000042",
} as const;

interface RoleIds {
  ownerRoleId: string;
  operationsRoleId: string;
  companyAdminRoleId: string;
  branchAdminRoleId: string;
  requesterRoleId: string;
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

async function lifecycleFixture(db: PGlite): Promise<RoleIds> {
  await applyMigrations(db, { through: "041_delegated_access_management.sql" });
  const roles = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS "ownerRoleId",
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OPERATIONS')
        AS "operationsRoleId",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_ADMIN')
        AS "branchAdminRoleId",
      (SELECT id::text FROM roles WHERE role_key='REQUESTER')
        AS "requesterRoleId"
  `);
  const context = roles.rows[0];
  if (!context?.ownerRoleId || !context.operationsRoleId
    || !context.companyAdminRoleId || !context.branchAdminRoleId
    || !context.requesterRoleId) {
    throw new Error("Role lifecycle fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO companies(id,company_code,name,active) VALUES
      ($1,'C-ROLE-042','Role lifecycle company',true),
      ($2,'C-ROLE-OTHER-042','Role lifecycle other company',true)
  `, [ids.company, ids.otherCompany]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,active
    ) VALUES
      ($1,'B-ROLE-042',$2,'Role lifecycle branch','ROLE-042','Address one',true),
      ($3,'B-ROLE-OTHER-042',$4,'Other role branch','ROLE-O-042','Address two',true)
  `, [ids.branch, ids.company, ids.otherBranch, ids.otherCompany]);
  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES ($1,$2,$3,'D-ROLE-042','Role lifecycle department',true)
  `, [ids.department, ids.company, ids.branch]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'role-owner@example.test','Role owner','not-a-real-hash',
        $8,NULL,NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'future-owner@example.test','Future owner','not-a-real-hash',
        $9,NULL,NULL,false,now(),'PLATFORM','ACTIVE',true,1),
      ($3,'role-company-admin@example.test','Company admin','not-a-real-hash',
        $10,$6,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'role-requester@example.test','Requester','not-a-real-hash',
        $11,$6,$7,false,now(),'COMPANY','ACTIVE',true,1),
      ($5,'role-outside@example.test','Outside requester','not-a-real-hash',
        $11,$12,$13,false,now(),'COMPANY','ACTIVE',true,1),
      ($14,'role-other-admin@example.test','Other company admin','not-a-real-hash',
        $10,$12,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($15,'role-invited@example.test','Invited user','$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
        $11,$6,$7,false,NULL,'COMPANY','INVITED',true,1)
  `, [
    ids.owner,
    ids.futureOwner,
    ids.companyAdmin,
    ids.requester,
    ids.outsideRequester,
    ids.company,
    ids.branch,
    context.ownerRoleId,
    context.operationsRoleId,
    context.companyAdminRoleId,
    context.requesterRoleId,
    ids.otherCompany,
    ids.otherBranch,
    ids.otherCompanyAdmin,
    ids.invitedUser,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$6,'ACTIVE',true,now()),
      ($2,$6,'ACTIVE',true,now()),
      ($3,$7,'ACTIVE',true,now()),
      ($4,$7,'ACTIVE',true,now()),
      ($5,$6,'INVITED',true,NULL)
  `, [
    ids.companyAdmin,
    ids.requester,
    ids.outsideRequester,
    ids.otherCompanyAdmin,
    ids.invitedUser,
    ids.company,
    ids.otherCompany,
  ]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary,created_by
    ) VALUES
      ($1,$4,$5,'ACTIVE',true,$6),
      ($2,$7,$8,'ACTIVE',true,$6),
      ($3,$4,$5,'ACTIVE',true,$6)
  `, [
    ids.requester,
    ids.outsideRequester,
    ids.invitedUser,
    ids.company,
    ids.branch,
    ids.owner,
    ids.otherCompany,
    ids.otherBranch,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_by
    ) VALUES
      ($1,$7,$13,'PLATFORM',NULL,NULL,true,$7),
      ($2,$8,$14,'PLATFORM',NULL,NULL,true,$7),
      ($3,$9,$15,'COMPANY',$17,NULL,true,$7),
      ($4,$10,$16,'BRANCH',$17,$18,true,$9),
      ($5,$11,$16,'BRANCH',$19,$20,true,$7),
      ($6,$12,$15,'COMPANY',$19,NULL,true,$7)
  `, [
    ids.ownerAssignment,
    ids.futureOwnerAssignment,
    ids.companyAdminAssignment,
    ids.requesterAssignment,
    ids.outsideRequesterAssignment,
    ids.otherCompanyAdminAssignment,
    ids.owner,
    ids.futureOwner,
    ids.companyAdmin,
    ids.requester,
    ids.outsideRequester,
    ids.otherCompanyAdmin,
    context.ownerRoleId,
    context.operationsRoleId,
    context.companyAdminRoleId,
    context.requesterRoleId,
    ids.company,
    ids.branch,
    ids.otherCompany,
    ids.otherBranch,
  ]);
  await db.query(`
    INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES
      ($1,repeat('a',64),now()+interval '8 hours'),
      ($2,repeat('b',64),now()+interval '8 hours')
  `, [ids.requester, ids.companyAdmin]);

  await db.exec(await readFile(migrationUrl, "utf8"));
  return context;
}

describe("audited role and scope lifecycle", () => {
  it("assigns, deduplicates, prefers, audits, revokes, and invalidates atomically", async () => {
    const db = new PGlite();
    try {
      const context = await lifecycleFixture(db);
      const assigned = await db.query<{
        role_assignment_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'BRANCH_ADMIN','BRANCH',$5,$6,NULL,NULL,$7
        )
      `, [
        ids.assignBranchAdminCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.requester,
        ids.company,
        ids.branch,
        "Appoint requester as branch administrator",
      ]);
      expect(assigned.rows[0]).toEqual({
        role_assignment_id: ids.assignBranchAdminCommand,
        auth_version: 2,
        revoked_sessions: 1,
        changed: true,
      });

      const repeated = await db.query<{
        role_assignment_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'BRANCH_ADMIN','BRANCH',$5,$6,NULL,NULL,$7
        )
      `, [
        ids.assignBranchAdminCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.requester,
        ids.company,
        ids.branch,
        "Appoint requester as branch administrator",
      ]);
      expect(repeated.rows[0]).toEqual({
        role_assignment_id: ids.assignBranchAdminCommand,
        auth_version: 2,
        revoked_sessions: 0,
        changed: false,
      });

      await expect(db.query(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'REQUESTER','BRANCH',$5,$6,NULL,NULL,$7
        )
      `, [
        ids.assignBranchAdminCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.requester,
        ids.company,
        ids.branch,
        "Conflicting command reuse",
      ])).rejects.toThrow(/conflicts with another request/i);

      const preferred = await db.query<{
        roleKey: string;
        branchId: string;
        history: number;
      }>(`
        SELECT role.role_key AS "roleKey",account.branch_id::text AS "branchId",
          (SELECT count(*)::int FROM permission_change_history history
           WHERE history.target_user_id=account.id
             AND history.change_type='ROLE_ASSIGNED') AS history
        FROM users account JOIN roles role ON role.id=account.role_id
        WHERE account.id=$1
      `, [ids.requester]);
      expect(preferred.rows[0]).toEqual({
        roleKey: "BRANCH_ADMIN",
        branchId: ids.branch,
        history: 1,
      });

      await expect(db.query(
        "DELETE FROM role_assignments WHERE id=$1",
        [ids.assignBranchAdminCommand],
      )).rejects.toThrow(/append-only/i);
      await expect(db.query(
        `UPDATE role_assignments
         SET role_id=$2 WHERE id=$1`,
        [ids.assignBranchAdminCommand, context.requesterRoleId],
      )).rejects.toThrow(/immutable/i);

      await db.query(`
        INSERT INTO user_sessions(user_id,token_hash,expires_at)
        VALUES ($1,repeat('c',64),now()+interval '8 hours')
      `, [ids.requester]);
      const revoked = await db.query<{
        role_assignment_id: string;
        auth_version: number;
        revoked_sessions: number;
        changed: boolean;
      }>(`
        SELECT * FROM axora_revoke_user_role_scope($1,$2,$3,$4,$5)
      `, [
        ids.revokeBranchAdminCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.assignBranchAdminCommand,
        "Branch administrator coverage ended",
      ]);
      expect(revoked.rows[0]).toEqual({
        role_assignment_id: ids.assignBranchAdminCommand,
        auth_version: 3,
        revoked_sessions: 1,
        changed: true,
      });

      const finalState = await db.query<{
        roleKey: string;
        active: boolean;
        revokedBy: string;
        history: number;
        revokedSessions: number;
      }>(`
        SELECT role.role_key AS "roleKey",assignment.active,
          assignment.revoked_by::text AS "revokedBy",
          (SELECT count(*)::int FROM permission_change_history history
           WHERE history.target_user_id=assignment.user_id
             AND history.change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED'))
            AS history,
          (SELECT count(*)::int FROM user_sessions session
           WHERE session.user_id=assignment.user_id
             AND session.revoked_at IS NOT NULL) AS "revokedSessions"
        FROM role_assignments assignment
        JOIN users account ON account.id=assignment.user_id
        JOIN roles role ON role.id=account.role_id
        WHERE assignment.id=$1
      `, [ids.assignBranchAdminCommand]);
      expect(finalState.rows[0]).toEqual({
        roleKey: "REQUESTER",
        active: false,
        revokedBy: ids.companyAdmin,
        history: 2,
        revokedSessions: 2,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("enforces tenant, role hierarchy, account-kind, and active-scope boundaries", async () => {
    const db = new PGlite();
    try {
      await lifecycleFixture(db);

      await expect(db.query(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'BRANCH_ADMIN','BRANCH',$5,$6,NULL,NULL,$7
        )
      `, [
        ids.crossTenantCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.outsideRequester,
        ids.company,
        ids.branch,
        "Cross-tenant assignment attempt",
      ])).rejects.toThrow(/does not belong/i);

      await expect(db.query(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'PLATFORM_OPERATIONS','PLATFORM',
          NULL,NULL,NULL,NULL,$5
        )
      `, [
        ids.invalidRoleCommand,
        ids.companyAdmin,
        ids.companyAdminAssignment,
        ids.futureOwner,
        "Company administrator platform-role attempt",
      ])).rejects.toThrow(/cannot assign/i);

      await db.query(
        "UPDATE branches SET active=false WHERE id=$1",
        [ids.branch],
      );
      await expect(db.query(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'BRANCH_ADMIN','BRANCH',$5,$6,NULL,NULL,$7
        )
      `, [
        "d8000000-0000-4000-8000-000000000042",
        ids.owner,
        ids.ownerAssignment,
        ids.requester,
        ids.company,
        ids.branch,
        "Inactive branch assignment attempt",
      ])).rejects.toThrow(/does not fit/i);
      await db.query(
        "UPDATE branches SET active=true WHERE id=$1",
        [ids.branch],
      );

      await expect(db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_by
        ) VALUES (
          $1,$2,(SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),
          'BRANCH',$3,$4,true,$5
        )
      `, [
        "d9000000-0000-4000-8000-000000000042",
        ids.outsideRequester,
        ids.company,
        ids.branch,
        ids.owner,
      ])).rejects.toThrow(/target or scope is invalid/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("protects the last Platform Owner and last Company Administrator at the database boundary", async () => {
    const db = new PGlite();
    try {
      await lifecycleFixture(db);

      await expect(db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Attempt last owner removal'
        WHERE id=$1
      `, [ids.ownerAssignment, ids.owner])).rejects.toThrow(/last active Platform Owner/i);

      await expect(db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Attempt last company administrator removal'
        WHERE id=$1
      `, [ids.companyAdminAssignment, ids.owner]))
        .rejects.toThrow(/last active Company Administrator/i);

      await expect(db.query(
        "UPDATE users SET active=false,account_status='SUSPENDED' WHERE id=$1",
        [ids.owner],
      )).rejects.toThrow(/last active Platform Owner/i);
      await expect(db.query(
        "UPDATE users SET active=false,account_status='SUSPENDED' WHERE id=$1",
        [ids.companyAdmin],
      )).rejects.toThrow(/last active Company Administrator/i);
      await expect(db.query(
        "DELETE FROM users WHERE id=$1",
        [ids.owner],
      )).rejects.toThrow(/cannot be deleted/i);

      const promoted = await db.query<{
        role_assignment_id: string;
        changed: boolean;
      }>(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'PLATFORM_OWNER','PLATFORM',
          NULL,NULL,NULL,NULL,$5
        )
      `, [
        ids.assignOwnerCommand,
        ids.owner,
        ids.ownerAssignment,
        ids.futureOwner,
        "Promote second Platform Owner",
      ]);
      expect(promoted.rows[0]).toMatchObject({ changed: true });

      await expect(db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Second owner exists'
        WHERE id=$1
      `, [ids.ownerAssignment, ids.futureOwner])).resolves.toBeDefined();

      const secondAdmin = await db.query<{
        role_assignment_id: string;
        changed: boolean;
      }>(`
        SELECT * FROM axora_assign_user_role_scope(
          $1,$2,$3,$4,'COMPANY_ADMIN','COMPANY',$5,NULL,NULL,NULL,$6
        )
      `, [
        ids.assignSecondAdminCommand,
        ids.futureOwner,
        ids.assignOwnerCommand,
        ids.requester,
        ids.company,
        "Appoint backup Company Administrator",
      ]);
      expect(secondAdmin.rows[0]).toMatchObject({ changed: true });

      await expect(db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Backup company administrator exists'
        WHERE id=$1
      `, [ids.companyAdminAssignment, ids.futureOwner])).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("retains a validated invitation INSERT path but denies direct lifecycle mutation to the application role", async () => {
    const db = new PGlite();
    try {
      const context = await lifecycleFixture(db);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_by
        ) VALUES ($1,$2,$3,'BRANCH',$4,$5,true,$6)
      `, [
        ids.invitedAssignment,
        ids.invitedUser,
        context.requesterRoleId,
        ids.company,
        ids.branch,
        ids.owner,
      ]);

      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const source = await applyApplicationGrantScript(db);
      const privileges = await db.query<{
        assignmentSelect: boolean;
        assignmentInsert: boolean;
        assignmentUpdate: boolean;
        assignmentDelete: boolean;
        rulesSelect: boolean;
        assignCommand: boolean;
        revokeCommand: boolean;
        contractHelper: boolean;
        countHelper: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','role_assignments','SELECT')
            AS "assignmentSelect",
          has_table_privilege('axora_app','role_assignments','INSERT')
            AS "assignmentInsert",
          has_table_privilege('axora_app','role_assignments','UPDATE')
            AS "assignmentUpdate",
          has_table_privilege('axora_app','role_assignments','DELETE')
            AS "assignmentDelete",
          has_table_privilege(
            'axora_app','role_assignment_management_rules','SELECT'
          ) AS "rulesSelect",
          has_function_privilege(
            'axora_app',
            'axora_assign_user_role_scope(uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "assignCommand",
          has_function_privilege(
            'axora_app','axora_revoke_user_role_scope(uuid,uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "revokeCommand",
          has_function_privilege(
            'axora_app',
            'axora_role_scope_contract_is_valid(text,boolean,text,text,uuid,uuid,uuid,uuid)',
            'EXECUTE'
          ) AS "contractHelper",
          has_function_privilege(
            'axora_app','axora_active_platform_owner_count(uuid,uuid)',
            'EXECUTE'
          ) AS "countHelper"
      `);
      expect(privileges.rows[0]).toEqual({
        assignmentSelect: true,
        assignmentInsert: true,
        assignmentUpdate: false,
        assignmentDelete: false,
        rulesSelect: false,
        assignCommand: true,
        revokeCommand: true,
        contractHelper: false,
        countHelper: false,
      });
      expect(source).toContain("public.axora_assign_user_role_scope(");
      expect(source).toContain("public.axora_revoke_user_role_scope(");
      expect(source).toContain("public.role_assignment_management_rules");
    } finally {
      await db.close();
    }
  }, 30_000);
});
