import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { defaultPermissionsForRole } from "../src/lib/authorization-policy";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "98200000-0000-4000-8000-000000000001",
  ownerAssignment: "98200000-0000-4000-8000-000000000002",
  hr: "98200000-0000-4000-8000-000000000003",
  hrAssignment: "98200000-0000-4000-8000-000000000004",
  manager: "98200000-0000-4000-8000-000000000005",
  managerAssignment: "98200000-0000-4000-8000-000000000006",
} as const;

const pendingPasswordHash =
  "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);

  const roles = await db.query<{
    owner: string;
    hr: string;
    manager: string;
  }>(`
    SELECT
      (SELECT id::text FROM roles
        WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles
        WHERE role_key='HUMAN_RESOURCES_MANAGEMENT') AS hr,
      (SELECT id::text FROM roles
        WHERE role_key='CLIENT_ACCOUNT_MANAGER') AS manager
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.hr || !role.manager) {
    throw new Error("Role-template permission fixture is unavailable");
  }

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,
      auth_version,email_verified_at
    ) VALUES
      ($1,'owner-098@example.test','Owner 098','not-a-real-hash',$7,true,
       now(),'PLATFORM','ACTIVE',true,1,now()),
      ($2,'hr-098@example.test','HR 098',$8,$5,false,
       NULL,'PLATFORM','INVITED',true,1,NULL),
      ($3,'manager-098@example.test','Manager 098',$8,$6,false,
       NULL,'PLATFORM','INVITED',true,1,NULL)
  `, [
    ids.owner,
    ids.hr,
    ids.manager,
    ids.ownerAssignment,
    role.hr,
    role.manager,
    role.owner,
    pendingPasswordHash,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) VALUES
      ($1,$4,$7,'PLATFORM',true,$4,now()),
      ($2,$5,$8,'PLATFORM',true,$4,now()),
      ($3,$6,$9,'PLATFORM',true,$4,now())
  `, [
    ids.ownerAssignment,
    ids.hrAssignment,
    ids.managerAssignment,
    ids.owner,
    ids.hr,
    ids.manager,
    role.owner,
    role.hr,
    role.manager,
  ]);

  return db;
}

async function replacePermissionSet(
  db: PGlite,
  targetUserId: string,
  targetAssignmentId: string,
  permissions: readonly string[],
) {
  await db.exec("SET ROLE axora_app");
  try {
    const result = await db.query<{ payload: unknown }>(`
      SELECT public.axora_replace_user_permission_set(
        $1,$2,$3,$4,$5::text[],$6,now()
      ) AS payload
    `, [
      ids.owner,
      ids.ownerAssignment,
      targetUserId,
      targetAssignmentId,
      [...permissions],
      "Initial permissions selected during account invitation",
    ]);
    return result.rows[0]?.payload;
  } finally {
    await db.exec("RESET ROLE");
  }
}

describe("invited role-template permission selection", () => {
  it("accepts target role defaults that the owner cannot operate personally", async () => {
    const db = await fixture();
    try {
      const ownerLeadAuthority = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM role_permissions role_permission
        JOIN roles role ON role.id=role_permission.role_id
        JOIN permissions permission
          ON permission.id=role_permission.permission_id
        WHERE role.role_key='PLATFORM_OWNER'
          AND permission.permission_code IN (
            'company.lead.assign','company.lead.reassign'
          )
      `);
      expect(ownerLeadAuthority.rows[0]?.count).toBe(0);

      const hrDefaults = defaultPermissionsForRole(
        "HUMAN_RESOURCES_MANAGEMENT",
        "PLATFORM",
        false,
      );
      const managerDefaults = defaultPermissionsForRole(
        "CLIENT_ACCOUNT_MANAGER",
        "PLATFORM",
        false,
      );
      expect(hrDefaults).toContain("company.lead.assign");
      expect(hrDefaults).toContain("company.lead.reassign");
      expect(managerDefaults).toContain("company.lead.assign");
      expect(managerDefaults).not.toContain("company.lead.reassign");

      await expect(replacePermissionSet(
        db,
        ids.hr,
        ids.hrAssignment,
        hrDefaults,
      )).resolves.toBeDefined();
      await expect(replacePermissionSet(
        db,
        ids.manager,
        ids.managerAssignment,
        managerDefaults,
      )).resolves.toBeDefined();

      const templateOverrides = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM user_permission_overrides override_row
        JOIN permissions permission
          ON permission.id=override_row.permission_id
        WHERE override_row.user_id IN ($1,$2)
          AND override_row.active
          AND permission.permission_code IN (
            'company.lead.assign','company.lead.reassign'
          )
      `, [ids.hr, ids.manager]);
      expect(templateOverrides.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("still rejects a true explicit grant outside the inviter's authority", async () => {
    const db = await fixture();
    try {
      const managerDefaults = defaultPermissionsForRole(
        "CLIENT_ACCOUNT_MANAGER",
        "PLATFORM",
        false,
      );
      const before = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM user_permission_overrides
        WHERE user_id=$1 AND active
      `, [ids.manager]);

      await expect(replacePermissionSet(
        db,
        ids.manager,
        ids.managerAssignment,
        [...managerDefaults, "company.lead.reassign"],
      )).rejects.toThrow(
        /cannot grant permission company\.lead\.reassign/i,
      );

      const after = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM user_permission_overrides
        WHERE user_id=$1 AND active
      `, [ids.manager]);
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      await db.close();
    }
  }, 45_000);
});
