import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "a1200000-0000-4000-8000-000000000001",
  ownerAssignment: "a1200000-0000-4000-8000-000000000002",
  cam: "a1200000-0000-4000-8000-000000000003",
  camAssignment: "a1200000-0000-4000-8000-000000000004",
  createOne: "a1200000-0000-4000-8000-000000000005",
  createTwo: "a1200000-0000-4000-8000-000000000006",
} as const;

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{ owner: string; cam: string }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') owner,
      (SELECT id::text FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER') cam
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.cam) throw new Error("MVP role fixture unavailable");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,
      auth_version,email_verified_at
    ) VALUES
      ($1,'owner-p12@example.test','Owner P12','not-a-real-hash',$3,true,
       now(),'PLATFORM','ACTIVE',true,1,now()),
      ($2,'cam-p12@example.test','CAM P12','not-a-real-hash',$4,false,
       now(),'PLATFORM','ACTIVE',true,1,now())
  `, [ids.owner, ids.cam, role.owner, role.cam]);
  await db.query(`
    INSERT INTO role_assignments(id,user_id,role_id,scope_type,active,assigned_by,assigned_at)
    VALUES ($1,$3,$5,'PLATFORM',true,$3,now()),($2,$4,$6,'PLATFORM',true,$3,now())
  `, [ids.ownerAssignment, ids.camAssignment, ids.owner, ids.cam, role.owner, role.cam]);
  return db;
}

async function createCompany(db: PGlite, commandId: string, name: string) {
  await db.exec("SET ROLE axora_app");
  try {
    const result = await db.query<{ payload: { companyId: string; created: boolean } }>(`
      SELECT public.axora_create_company_direct(
        $1,$2,$3,$4,$4,'','','',$5,'Monthly',NULL,now()
      ) payload
    `, [ids.cam, ids.camAssignment, commandId, name, "Main contact"]);
    return result.rows[0]!.payload;
  } finally {
    await db.exec("RESET ROLE");
  }
}

describe("migration 107 MVP authorization", () => {
  it("atomically assigns a permitted CAM to each created company while DENY remains final", async () => {
    const db = await fixture();
    try {
      const first = await createCompany(db, ids.createOne, "Prompt Twelve One");
      const replay = await createCompany(db, ids.createOne, "Prompt Twelve One");
      const second = await createCompany(db, ids.createTwo, "Prompt Twelve Two");
      expect(first.created).toBe(true);
      expect(replay).toMatchObject({ companyId: first.companyId, created: false });
      expect(second.created).toBe(true);

      const creatorAssignments = await db.query<{ count: number }>(`
        SELECT count(*)::int count FROM company_assignments
        WHERE company_id IN ($1,$2)
          AND manager_user_id=$3
          AND assignment_source='CREATED_BY_CAM'
          AND status='ACTIVE'
      `, [first.companyId, second.companyId, ids.cam]);
      expect(creatorAssignments.rows[0]?.count).toBe(2);

      const canView = async () => (await db.query<{ allowed: boolean }>(`
        WITH snapshot AS (
          SELECT public.axora_live_authorization_snapshot($1,$2,now()) value
        )
        SELECT bool_and(public.axora_company_actor_can_view(
          snapshot.value,$1,company.id,now()
        )) allowed
        FROM snapshot CROSS JOIN companies company
        WHERE company.id IN ($3,$4)
      `, [ids.cam, ids.camAssignment, first.companyId, second.companyId])).rows[0]?.allowed;
      expect(await canView()).toBe(true);

      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
        ) SELECT $1,permission.id,'DENY','PLATFORM',now(),true,
          'CAM_COMPANY_ACCESS_BLOCKED',$2
        FROM permissions permission WHERE permission.permission_code='company.view.assigned'
      `, [ids.cam, ids.owner]);
      expect(await canView()).toBe(false);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("turns a stale product DENY into an effective Manage Products grant without commercial pricing", async () => {
    const db = await fixture();
    try {
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
        ) SELECT $1,permission.id,'DENY','PLATFORM',now(),true,'STALE_DENY',$2
        FROM permissions permission WHERE permission.permission_code='product.manage'
      `, [ids.cam, ids.owner]);
      await db.exec("SET ROLE axora_app");
      try {
        await db.query(`SELECT public.axora_replace_user_permission_set(
          $1,$2,$3,$4,ARRAY['product.manage']::text[],'USER_PERMISSION_UPDATED',now()
        )`, [ids.owner, ids.ownerAssignment, ids.cam, ids.camAssignment]);
        await expect(db.query(`SELECT public.axora_product_administration_catalog($1,$2,now())`, [
          ids.cam, ids.camAssignment,
        ])).resolves.toBeDefined();
      } finally {
        await db.exec("RESET ROLE");
      }
      const overrides = await db.query<{ effect: string }>(`
        SELECT override_row.effect
        FROM user_permission_overrides override_row
        JOIN permissions permission ON permission.id=override_row.permission_id
        WHERE override_row.user_id=$1 AND override_row.active
          AND permission.permission_code='product.manage'
      `, [ids.cam]);
      expect(overrides.rows).toEqual([{ effect: "GRANT" }]);
      const commercial = await db.query<{ count: number }>(`
        SELECT count(*)::int count
        FROM user_permission_overrides override_row
        JOIN permissions permission ON permission.id=override_row.permission_id
        WHERE override_row.user_id=$1 AND override_row.active
          AND permission.permission_code LIKE 'commercial.%'
      `, [ids.cam]);
      expect(commercial.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 45_000);
});
