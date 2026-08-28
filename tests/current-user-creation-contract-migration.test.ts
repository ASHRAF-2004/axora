import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "95000000-0000-4000-8000-000000000001",
  ownerAssignment: "95000000-0000-4000-8000-000000000002",
  support: "95000000-0000-4000-8000-000000000003",
  supportAssignment: "95000000-0000-4000-8000-000000000004",
  supportCamAssignment: "95000000-0000-4000-8000-00000000000a",
  company: "95000000-0000-4000-8000-000000000005",
  companyAdmin: "95000000-0000-4000-8000-000000000006",
  companyAdminAssignment: "95000000-0000-4000-8000-000000000007",
  backupCompanyAdmin: "95000000-0000-4000-8000-000000000008",
  backupCompanyAdminAssignment: "95000000-0000-4000-8000-000000000009",
} as const;

interface SnapshotRow {
  hrm: Record<string, unknown> | null;
  manager: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
}

interface PermissionFixtureIds {
  companyAdminRoleId: string;
  createPermissionId: string;
  invitePermissionId: string;
}

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{
    owner: string;
    support: string;
    companyAdmin: string;
  }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='TECHNICAL_SUPPORT') AS support,
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN') AS "companyAdmin"
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.support || !role.companyAdmin) {
    throw new Error("Current role fixture is unavailable");
  }

  await db.query(`
    INSERT INTO companies(id,company_code,name,active)
    VALUES ($1,'USER-CREATION-095','User Creation Fixture',true)
  `, [ids.company]);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-095@example.test','Owner 095','not-a-real-hash',$5,NULL,true,
       now(),'PLATFORM','ACTIVE',true,1),
      ($2,'support-095@example.test','Support 095','not-a-real-hash',$6,NULL,false,
       now(),'PLATFORM','ACTIVE',true,1),
      ($3,'company-admin-095@example.test','Company Admin 095','not-a-real-hash',
       $7,$8,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'backup-company-admin-095@example.test','Backup Company Admin 095',
       'not-a-real-hash',$7,$8,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.owner,
    ids.support,
    ids.companyAdmin,
    ids.backupCompanyAdmin,
    role.owner,
    role.support,
    role.companyAdmin,
    ids.company,
  ]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at,created_by
    ) VALUES
      ($1,$3,'ACTIVE',true,now(),$4),
      ($2,$3,'ACTIVE',true,now(),$4)
  `, [
    ids.companyAdmin,
    ids.backupCompanyAdmin,
    ids.company,
    ids.owner,
  ]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$5,$9,'PLATFORM',NULL,true,$5,now()),
      ($2,$6,$10,'PLATFORM',NULL,true,$5,now()),
      ($3,$7,$11,'COMPANY',$12,true,$5,now()),
      ($4,$8,$11,'COMPANY',$12,true,$5,now())
  `, [
    ids.ownerAssignment,
    ids.supportAssignment,
    ids.companyAdminAssignment,
    ids.backupCompanyAdminAssignment,
    ids.owner,
    ids.support,
    ids.companyAdmin,
    ids.backupCompanyAdmin,
    role.owner,
    role.support,
    role.companyAdmin,
    ids.company,
  ]);
  return db;
}

async function companyAdminCreationSnapshot(db: PGlite) {
  const result = await db.query<{ snapshot: unknown }>(`
    SELECT axora_lock_user_creation_scope(
      $1,$2,'COMPANY_APPROVER','COMPANY',
      $3,NULL,NULL,NULL,now()
    ) AS snapshot
  `, [ids.companyAdmin, ids.companyAdminAssignment, ids.company]);
  return result.rows[0]?.snapshot;
}

async function permissionFixtureIds(db: PGlite) {
  const result = await db.query<PermissionFixtureIds>(`
    SELECT
      (SELECT id::text FROM roles
        WHERE role_key='COMPANY_ADMIN') AS "companyAdminRoleId",
      (SELECT id::text FROM permissions
        WHERE permission_code='company_user.create') AS "createPermissionId",
      (SELECT id::text FROM permissions
        WHERE permission_code='company_user.invite') AS "invitePermissionId"
  `);
  const value = result.rows[0];
  if (!value?.companyAdminRoleId
    || !value.createPermissionId || !value.invitePermissionId) {
    throw new Error("User-creation permission fixture is unavailable");
  }
  return value;
}

describe("current canonical user-creation database contract", () => {
  it("resolves a canonical Owner without a session assignment claim and keeps non-Owners fail-closed", async () => {
    const db = await fixture();
    try {
      await db.query(`
        UPDATE companies
        SET active=false,lifecycle_status='ONBOARDING',
          portal_access_enabled=false,activated_at=NULL,
          verification_status='DRAFT'
        WHERE id=$1
      `, [ids.company]);

      await db.exec("SET ROLE axora_app");
      let result: Awaited<ReturnType<typeof db.query<{
        firstAdmin: unknown;
        platformUser: unknown;
        deliveryUser: unknown;
        staleVersion: unknown;
        missingNonOwnerAssignment: unknown;
      }>>>;
      try {
        result = await db.query(`
          SELECT
            axora_lock_company_admin_invitation_scope(
              $1,NULL,1,$3,now()
            ) AS "firstAdmin",
            axora_lock_user_creation_scope(
              $1,NULL,1,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
              NULL,NULL,NULL,NULL,now()
            ) AS "platformUser",
            axora_lock_user_creation_scope(
              $1,NULL,1,'DELIVERY_GUY','DELIVERY',
              NULL,NULL,NULL,NULL,now()
            ) AS "deliveryUser",
            axora_lock_company_admin_invitation_scope(
              $1,NULL,2,$3,now()
            ) AS "staleVersion",
            axora_lock_user_creation_scope(
              $2,NULL,1,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
              NULL,NULL,NULL,NULL,now()
            ) AS "missingNonOwnerAssignment"
        `, [ids.owner, ids.support, ids.company]);
      } finally {
        await db.exec("RESET ROLE");
      }

      expect(result.rows[0]?.firstAdmin).toMatchObject({
        role: "COMPANY_ADMIN",
        accountKind: "COMPANY",
        scope: { type: "COMPANY", companyId: ids.company },
      });
      expect(result.rows[0]?.platformUser).toMatchObject({
        role: "HUMAN_RESOURCES_MANAGEMENT",
        accountKind: "PLATFORM",
      });
      expect(result.rows[0]?.deliveryUser).toMatchObject({
        role: "DELIVERY_GUY",
        accountKind: "DELIVERY",
      });
      expect(result.rows[0]?.staleVersion).toBeNull();
      expect(result.rows[0]?.missingNonOwnerAssignment).toBeNull();

      await db.query(`
        UPDATE users
        SET role_id=(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER')
        WHERE id=$1
      `, [ids.support]);
      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now()
        WHERE id=$1
      `, [ids.supportAssignment]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) VALUES (
          $1,$2,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
          'PLATFORM',true,$3,now()
        )
      `, [ids.supportCamAssignment, ids.support, ids.owner]);
      await db.query(`
        INSERT INTO company_assignments(
          company_id,manager_user_id,assignment_type,status,coverage_starts_at,
          assigned_by,assigned_at,assignment_reason,assignment_source
        ) VALUES ($1,$2,'PRIMARY','ACTIVE',now(),$3,now(),
          'Explicit first-administrator CAM fixture ownership','OWNER_ASSIGNED')
      `, [ids.company,ids.support,ids.owner]);
      await db.exec("SET ROLE axora_app");
      let camFirstAdmin: Awaited<ReturnType<typeof db.query<{ snapshot: unknown }>>>;
      try {
        camFirstAdmin = await db.query<{ snapshot: unknown }>(`
          SELECT axora_lock_company_admin_invitation_scope(
            $1,$2,1,$3,now()
          ) AS snapshot
        `, [ids.support, ids.supportCamAssignment, ids.company]);
      } finally {
        await db.exec("RESET ROLE");
      }
      expect(camFirstAdmin.rows[0]?.snapshot).toMatchObject({
        role: "COMPANY_ADMIN",
        scope: { type: "COMPANY", companyId: ids.company },
      });

      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
        ) VALUES (
          $1,(SELECT id FROM permissions WHERE permission_code='user.create'),
          'DENY','PLATFORM',now()-interval '1 minute',true,
          'Explicit denial remains final in the first administrator path',$1
        )
      `, [ids.owner]);
      const denied = await db.query<{ snapshot: unknown }>(`
        SELECT axora_lock_company_admin_invitation_scope(
          $1,NULL,1,$2,now()
        ) AS snapshot
      `, [ids.owner, ids.company]);
      expect(denied.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 45_000);

  it("allows the Platform Owner to lock HR, platform Manager, and Delivery Guy scopes", async () => {
    const db = await fixture();
    try {
      await db.exec("SET ROLE axora_app");
      let result: Awaited<ReturnType<typeof db.query<SnapshotRow>>>;
      try {
        result = await db.query<SnapshotRow>(`
          SELECT
            axora_lock_user_creation_scope(
              $1,$2,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
              NULL,NULL,NULL,NULL,now()
            ) AS hrm,
            axora_lock_user_creation_scope(
              $1,$2,'CLIENT_ACCOUNT_MANAGER','PLATFORM',
              NULL,NULL,NULL,NULL,now()
            ) AS manager,
            axora_lock_user_creation_scope(
              $1,$2,'DELIVERY_GUY','DELIVERY',
              NULL,NULL,NULL,NULL,now()
            ) AS delivery
        `, [ids.owner, ids.ownerAssignment]);
      } finally {
        await db.exec("RESET ROLE");
      }
      expect(result.rows[0]?.hrm).toMatchObject({
        role: "HUMAN_RESOURCES_MANAGEMENT",
        accountKind: "PLATFORM",
        scope: { type: "PLATFORM" },
      });
      expect(result.rows[0]?.manager).toMatchObject({
        role: "CLIENT_ACCOUNT_MANAGER",
        accountKind: "PLATFORM",
        scope: { type: "PLATFORM" },
      });
      expect(result.rows[0]?.delivery).toMatchObject({
        role: "DELIVERY_GUY",
        accountKind: "DELIVERY",
        scope: { type: "DELIVERY" },
      });

      const matrix = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM role_assignment_management_rules rule
        JOIN roles manager ON manager.id=rule.manager_role_id
        JOIN roles target ON target.id=rule.target_role_id
        WHERE manager.role_key='PLATFORM_OWNER'
          AND (target.role_key,rule.scope_type) IN (
            ('HUMAN_RESOURCES_MANAGEMENT','PLATFORM'),
            ('CLIENT_ACCOUNT_MANAGER','PLATFORM'),
            ('DELIVERY_GUY','DELIVERY')
          )
      `);
      expect(matrix.rows[0]?.count).toBe(3);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("denies malformed scopes, missing permissions, revoked actors, and unauthorized managers without writes", async () => {
    const db = await fixture();
    try {
      const baseline = await db.query<{
        users: number;
        assignments: number;
        invitations: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM account_setup_invitations) AS invitations
      `);

      const malformed = await db.query<{
        wrongScope: unknown;
        platformTenant: unknown;
        deliveryTenant: unknown;
        unauthorized: unknown;
      }>(`
        SELECT
          axora_lock_user_creation_scope(
            $1,$2,'HUMAN_RESOURCES_MANAGEMENT','COMPANY',
            $5,NULL,NULL,NULL,now()
          ) AS "wrongScope",
          axora_lock_user_creation_scope(
            $1,$2,'CLIENT_ACCOUNT_MANAGER','PLATFORM',
            $5,NULL,NULL,NULL,now()
          ) AS "platformTenant",
          axora_lock_user_creation_scope(
            $1,$2,'DELIVERY_GUY','DELIVERY',
            $5,NULL,NULL,NULL,now()
          ) AS "deliveryTenant",
          axora_lock_user_creation_scope(
            $3,$4,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
            NULL,NULL,NULL,NULL,now()
          ) AS unauthorized
      `, [
        ids.owner,
        ids.ownerAssignment,
        ids.support,
        ids.supportAssignment,
        ids.company,
      ]);
      expect(malformed.rows[0]).toEqual({
        wrongScope: null,
        platformTenant: null,
        deliveryTenant: null,
        unauthorized: null,
      });

      const permission = await permissionFixtureIds(db);
      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id=$1
          AND permission_id IN ($2,$3)
      `, [
        permission.companyAdminRoleId,
        permission.createPermissionId,
        permission.invitePermissionId,
      ]);

      await db.query(`
        INSERT INTO role_permissions(role_id,permission_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `, [permission.companyAdminRoleId, permission.invitePermissionId]);
      expect(await companyAdminCreationSnapshot(db)).toBeNull();

      await db.query(`
        INSERT INTO role_permissions(role_id,permission_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `, [permission.companyAdminRoleId, permission.createPermissionId]);
      expect(await companyAdminCreationSnapshot(db)).not.toBeNull();

      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id=$1 AND permission_id=$2
      `, [permission.companyAdminRoleId, permission.invitePermissionId]);
      expect(await companyAdminCreationSnapshot(db)).toBeNull();

      await db.query(`
        INSERT INTO role_permissions(role_id,permission_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
      `, [permission.companyAdminRoleId, permission.invitePermissionId]);
      expect(await companyAdminCreationSnapshot(db)).not.toBeNull();

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
          revoke_reason='Revoked actor fixture'
        WHERE id=$1
      `, [ids.companyAdminAssignment, ids.owner]);
      expect(await companyAdminCreationSnapshot(db)).toBeNull();

      const after = await db.query<{
        users: number;
        assignments: number;
        invitations: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM account_setup_invitations) AS invitations
      `);
      expect(after.rows[0]).toEqual(baseline.rows[0]);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("reapplies only the narrow delivery identity column contract", async () => {
    const db = await fixture();
    try {
      const privileges = await db.query<{
        tableSelect: boolean;
        tableInsert: boolean;
        tableUpdate: boolean;
        userIdSelect: boolean;
        activeSelect: boolean;
        userIdInsert: boolean;
        agentCodeInsert: boolean;
        activeInsert: boolean;
        activeUpdate: boolean;
        phoneSelect: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','delivery_agent_profiles','SELECT')
            AS "tableSelect",
          has_table_privilege('axora_app','delivery_agent_profiles','INSERT')
            AS "tableInsert",
          has_table_privilege('axora_app','delivery_agent_profiles','UPDATE')
            AS "tableUpdate",
          has_column_privilege('axora_app','delivery_agent_profiles','user_id','SELECT')
            AS "userIdSelect",
          has_column_privilege('axora_app','delivery_agent_profiles','active','SELECT')
            AS "activeSelect",
          has_column_privilege('axora_app','delivery_agent_profiles','user_id','INSERT')
            AS "userIdInsert",
          has_column_privilege('axora_app','delivery_agent_profiles','agent_code','INSERT')
            AS "agentCodeInsert",
          has_column_privilege('axora_app','delivery_agent_profiles','active','INSERT')
            AS "activeInsert",
          has_column_privilege('axora_app','delivery_agent_profiles','active','UPDATE')
            AS "activeUpdate",
          has_column_privilege('axora_app','delivery_agent_profiles','phone','SELECT')
            AS "phoneSelect"
      `);
      expect(privileges.rows[0]).toEqual({
        tableSelect: false,
        tableInsert: false,
        tableUpdate: false,
        userIdSelect: true,
        activeSelect: true,
        userIdInsert: true,
        agentCodeInsert: true,
        activeInsert: true,
        activeUpdate: true,
        phoneSelect: false,
      });
    } finally {
      await db.close();
    }
  }, 45_000);
});
