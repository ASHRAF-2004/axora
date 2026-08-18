import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "97100000-0000-4000-8000-000000000001",
  ownerAssignment: "97100000-0000-4000-8000-000000000002",
  hr: "97100000-0000-4000-8000-000000000003",
  hrAssignment: "97100000-0000-4000-8000-000000000004",
  hrInvitation: "97100000-0000-4000-8000-000000000005",
  manager: "97100000-0000-4000-8000-000000000006",
  managerAssignment: "97100000-0000-4000-8000-000000000007",
  managerInvitation: "97100000-0000-4000-8000-000000000008",
  delivery: "97100000-0000-4000-8000-000000000009",
  deliveryAssignment: "97100000-0000-4000-8000-00000000000a",
  deliveryInvitation: "97100000-0000-4000-8000-00000000000b",
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
    delivery: string;
  }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles
        WHERE role_key='HUMAN_RESOURCES_MANAGEMENT') AS hr,
      (SELECT id::text FROM roles
        WHERE role_key='CLIENT_ACCOUNT_MANAGER') AS manager,
      (SELECT id::text FROM roles WHERE role_key='DELIVERY_GUY') AS delivery
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.hr || !role.manager || !role.delivery) {
    throw new Error("Current invitation roles are unavailable");
  }

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,
      auth_version,email_verified_at
    ) VALUES
      ($1,'owner-097@example.test','Owner 097','not-a-real-hash',$8,true,
       now(),'PLATFORM','ACTIVE',true,1,now()),
      ($2,'hr-097@example.test','HR 097',$9,$5,false,
       NULL,'PLATFORM','INVITED',true,1,NULL),
      ($3,'manager-097@example.test','Manager 097',$9,$6,false,
       NULL,'PLATFORM','INVITED',true,1,NULL),
      ($4,'delivery-097@example.test','Delivery 097',$9,$7,false,
       NULL,'DELIVERY','INVITED',true,1,NULL)
  `, [
    ids.owner,
    ids.hr,
    ids.manager,
    ids.delivery,
    role.hr,
    role.manager,
    role.delivery,
    role.owner,
    pendingPasswordHash,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) VALUES
      ($1,$5,$9,'PLATFORM',true,$5,now()),
      ($2,$6,$10,'PLATFORM',true,$5,now()),
      ($3,$7,$11,'PLATFORM',true,$5,now()),
      ($4,$8,$12,'DELIVERY',true,$5,now())
  `, [
    ids.ownerAssignment,
    ids.hrAssignment,
    ids.managerAssignment,
    ids.deliveryAssignment,
    ids.owner,
    ids.hr,
    ids.manager,
    ids.delivery,
    role.owner,
    role.hr,
    role.manager,
    role.delivery,
  ]);

  await db.query(`
    INSERT INTO user_profiles(user_id,display_name,preferred_locale)
    VALUES
      ($1,'HR 097','en'),
      ($2,'Manager 097','en'),
      ($3,'Delivery 097','en')
    ON CONFLICT(user_id) DO NOTHING
  `, [ids.hr, ids.manager, ids.delivery]);

  await db.query(`
    INSERT INTO account_credentials(
      user_id,password_hash,password_algorithm
    ) VALUES
      ($1,NULL,NULL),
      ($2,NULL,NULL),
      ($3,NULL,NULL)
    ON CONFLICT(user_id) DO NOTHING
  `, [ids.hr, ids.manager, ids.delivery]);

  await db.query(`
    INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
    VALUES ($1,'DRV-971000000000',true)
    ON CONFLICT(user_id) DO UPDATE SET active=true
  `, [ids.delivery]);

  return { db, role };
}

describe("current-role invitation trigger", () => {
  it("creates Human Resources, platform Manager, and Delivery Guy invitations as axora_app", async () => {
    const { db, role } = await fixture();
    try {
      await db.exec("SET ROLE axora_app");
      try {
        await db.query(`
          INSERT INTO account_setup_invitations(
            id,user_id,token_hash,expires_at,email_locale,created_by,
            intended_role_id,intended_scope_type
          ) VALUES
            ($1,$4,repeat('a',64),now()+interval '1 day','en',$7,$8,'PLATFORM'),
            ($2,$5,repeat('b',64),now()+interval '1 day','en',$7,$9,'PLATFORM'),
            ($3,$6,repeat('c',64),now()+interval '1 day','en',$7,$10,'DELIVERY')
        `, [
          ids.hrInvitation,
          ids.managerInvitation,
          ids.deliveryInvitation,
          ids.hr,
          ids.manager,
          ids.delivery,
          ids.owner,
          role.hr,
          role.manager,
          role.delivery,
        ]);
      } finally {
        await db.exec("RESET ROLE");
      }

      const invitations = await db.query<{
        role: string;
        scope: string;
        userId: string;
      }>(`
        SELECT role.role_key AS role,
          invitation.intended_scope_type AS scope,
          invitation.user_id::text AS "userId"
        FROM account_setup_invitations invitation
        JOIN roles role ON role.id=invitation.intended_role_id
        WHERE invitation.id IN ($1,$2,$3)
        ORDER BY role.role_key
      `, [ids.hrInvitation, ids.managerInvitation, ids.deliveryInvitation]);

      expect(invitations.rows).toEqual([
        {
          role: "CLIENT_ACCOUNT_MANAGER",
          scope: "PLATFORM",
          userId: ids.manager,
        },
        {
          role: "DELIVERY_GUY",
          scope: "DELIVERY",
          userId: ids.delivery,
        },
        {
          role: "HUMAN_RESOURCES_MANAGEMENT",
          scope: "PLATFORM",
          userId: ids.hr,
        },
      ]);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("rejects a current role with the wrong exact scope and inserts no invitation", async () => {
    const { db, role } = await fixture();
    try {
      await db.exec("SET ROLE axora_app");
      try {
        await expect(db.query(`
          INSERT INTO account_setup_invitations(
            id,user_id,token_hash,expires_at,email_locale,created_by,
            intended_role_id,intended_scope_type
          ) VALUES (
            $1,$2,repeat('d',64),now()+interval '1 day','en',$3,$4,'DELIVERY'
          )
        `, [ids.hrInvitation, ids.hr, ids.owner, role.hr]))
          .rejects.toThrow();
      } finally {
        await db.exec("RESET ROLE");
      }

      const persisted = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM account_setup_invitations
        WHERE id=$1
      `, [ids.hrInvitation]);
      expect(persisted.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 45_000);
});
