import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "95000000-0000-4000-8000-000000000001",
  ownerAssignment: "95000000-0000-4000-8000-000000000002",
  backupOwner: "95000000-0000-4000-8000-000000000003",
  backupOwnerAssignment: "95000000-0000-4000-8000-000000000004",
  support: "95000000-0000-4000-8000-000000000005",
  supportAssignment: "95000000-0000-4000-8000-000000000006",
} as const;

interface SnapshotRow {
  hrm: Record<string, unknown> | null;
  manager: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
}

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{
    owner: string;
    support: string;
  }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='TECHNICAL_SUPPORT') AS support
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.support) throw new Error("Current role fixture is unavailable");

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-095@example.test','Owner 095','not-a-real-hash',$4,true,
       now(),'PLATFORM','ACTIVE',true,1),
      ($2,'backup-owner-095@example.test','Backup owner 095','not-a-real-hash',$4,true,
       now(),'PLATFORM','ACTIVE',true,1),
      ($3,'support-095@example.test','Support 095','not-a-real-hash',$5,false,
       now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner, ids.backupOwner, ids.support, role.owner, role.support]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) VALUES
      ($1,$4,$7,'PLATFORM',true,$4,now()),
      ($2,$5,$7,'PLATFORM',true,$4,now()),
      ($3,$6,$8,'PLATFORM',true,$4,now())
  `, [ids.ownerAssignment, ids.backupOwnerAssignment, ids.supportAssignment,
    ids.owner, ids.backupOwner, ids.support, role.owner, role.support]);
  return db;
}

describe("current canonical user-creation database contract", () => {
  it("allows the Platform Owner to lock HR, platform Manager, and Delivery Guy scopes", async () => {
    const db = await fixture();
    try {
      const result = await db.query<SnapshotRow>(`
        SET ROLE axora_app;
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
          ) AS delivery;
        RESET ROLE;
      `, [ids.owner, ids.ownerAssignment]);
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
      const baseline = await db.query<{ users: number; assignments: number; invitations: number }>(`
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
            '10000000-0000-4000-8000-000000000001',NULL,NULL,NULL,now()
          ) AS "wrongScope",
          axora_lock_user_creation_scope(
            $1,$2,'CLIENT_ACCOUNT_MANAGER','PLATFORM',
            '10000000-0000-4000-8000-000000000001',NULL,NULL,NULL,now()
          ) AS "platformTenant",
          axora_lock_user_creation_scope(
            $1,$2,'DELIVERY_GUY','DELIVERY',
            '10000000-0000-4000-8000-000000000001',NULL,NULL,NULL,now()
          ) AS "deliveryTenant",
          axora_lock_user_creation_scope(
            $3,$4,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
            NULL,NULL,NULL,NULL,now()
          ) AS unauthorized
      `, [ids.owner, ids.ownerAssignment, ids.support, ids.supportAssignment]);
      expect(malformed.rows[0]).toEqual({
        wrongScope: null,
        platformTenant: null,
        deliveryTenant: null,
        unauthorized: null,
      });

      const userCreate = await db.query<{ id: string }>(`
        SELECT id::text FROM permissions WHERE permission_code='user.create'
      `);
      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id=(SELECT role_id FROM role_assignments WHERE id=$1)
          AND permission_id=$2
      `, [ids.ownerAssignment, userCreate.rows[0]?.id]);
      const noCreate = await db.query<{ snapshot: unknown }>(`
        SELECT axora_lock_user_creation_scope(
          $1,$2,'HUMAN_RESOURCES_MANAGEMENT','PLATFORM',
          NULL,NULL,NULL,NULL,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment]);
      expect(noCreate.rows[0]?.snapshot).toBeNull();

      await db.query(`
        INSERT INTO role_permissions(role_id,permission_id)
        SELECT role_id,$2 FROM role_assignments WHERE id=$1
        ON CONFLICT DO NOTHING
      `, [ids.ownerAssignment, userCreate.rows[0]?.id]);
      const userInvite = await db.query<{ id: string }>(`
        SELECT id::text FROM permissions WHERE permission_code='user.invite'
      `);
      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id=(SELECT role_id FROM role_assignments WHERE id=$1)
          AND permission_id=$2
      `, [ids.ownerAssignment, userInvite.rows[0]?.id]);
      const noInvite = await db.query<{ snapshot: unknown }>(`
        SELECT axora_lock_user_creation_scope(
          $1,$2,'DELIVERY_GUY','DELIVERY',
          NULL,NULL,NULL,NULL,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment]);
      expect(noInvite.rows[0]?.snapshot).toBeNull();

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
          revoke_reason='Revoked actor fixture'
        WHERE id=$1
      `, [ids.ownerAssignment, ids.backupOwner]);
      const revoked = await db.query<{ snapshot: unknown }>(`
        SELECT axora_lock_user_creation_scope(
          $1,$2,'DELIVERY_GUY','DELIVERY',
          NULL,NULL,NULL,NULL,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment]);
      expect(revoked.rows[0]?.snapshot).toBeNull();

      const after = await db.query<{ users: number; assignments: number; invitations: number }>(`
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
