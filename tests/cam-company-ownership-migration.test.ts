import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "c1250000-0000-4000-8000-000000000001",
  camA: "c1250000-0000-4000-8000-000000000002",
  camB: "c1250000-0000-4000-8000-000000000003",
  ownerRole: "c1250000-0000-4000-8000-000000000011",
  camARole: "c1250000-0000-4000-8000-000000000012",
  camBRole: "c1250000-0000-4000-8000-000000000013",
  ownerCommand: "c1250000-0000-4000-8000-000000000021",
  camACommand: "c1250000-0000-4000-8000-000000000022",
  camBCommand: "c1250000-0000-4000-8000-000000000023",
  workflow: "c1250000-0000-4000-8000-000000000031",
} as const;

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,email_verified_at,account_kind,
      account_status,active,auth_version
    ) VALUES
      ($1,'owner-125@example.test','Owner 125','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,
        now(),now(),'PLATFORM','ACTIVE',true,1),
      ($2,'cam-a-125@example.test','CAM A 125','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),now(),'PLATFORM','ACTIVE',true,1),
      ($3,'cam-b-125@example.test','CAM B 125','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner,ids.camA,ids.camB]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) VALUES
      ($1,$4,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
        'PLATFORM',true,$4,now()),
      ($2,$5,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'PLATFORM',true,$4,now()),
      ($3,$6,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'PLATFORM',true,$4,now())
  `, [ids.ownerRole,ids.camARole,ids.camBRole,ids.owner,ids.camA,ids.camB]);
  await db.query(`
    INSERT INTO user_profiles(
      user_id,display_name,preferred_locale,timezone,profile_completed_at
    ) VALUES
      ($1,'Owner 125','en','Asia/Kuala_Lumpur',now()),
      ($2,'CAM A 125','en','Asia/Kuala_Lumpur',now()),
      ($3,'CAM B 125','en','Asia/Kuala_Lumpur',now())
  `, [ids.owner,ids.camA,ids.camB]);
  return db;
}

async function createCompany(
  db: PGlite,
  actorId: string,
  roleAssignmentId: string,
  commandId: string,
  name: string,
) {
  await db.exec("SET ROLE axora_app");
  try {
    const result = await db.query<{ payload: {
      companyId: string; created: boolean; status?: string;
    } }>(`
      SELECT public.axora_create_company_direct(
        $1,$2,$3,$4,$4,'','','',$5,'Monthly',NULL,now()
      ) payload
    `, [actorId,roleAssignmentId,commandId,name,"Main contact"]);
    return result.rows[0]!.payload;
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function canView(
  db: PGlite,
  actorId: string,
  roleAssignmentId: string,
  companyId: string,
) {
  const result = await db.query<{ allowed: boolean }>(`
    SELECT public.axora_actor_company_accessible($1,$2,$3,now()) allowed
  `, [actorId,roleAssignmentId,companyId]);
  return result.rows[0]?.allowed;
}

describe("migration 125 canonical CAM company ownership", () => {
  it("upgrades the protected-main 124 head without rewriting company history", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, {
        through: "124_requests_canonical_order_workspace.sql",
      });
      const before = await db.query<{ companies: number; assignments: number }>(`
        SELECT (SELECT count(*)::int FROM companies) companies,
          (SELECT count(*)::int FROM company_assignments) assignments
      `);
      await db.exec(await readFile(new URL(
        "../database/migrations/125_cam_company_ownership_and_notification_policy.sql",
        import.meta.url,
      ), "utf8"));
      const after = await db.query<{
        companies: number; assignments: number; grantOk: boolean;
      }>(`
        SELECT (SELECT count(*)::int FROM companies) companies,
          (SELECT count(*)::int FROM company_assignments) assignments,
          has_function_privilege(
            'axora_app',
            'public.axora_actor_company_accessible(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) "grantOk"
      `);
      expect(after.rows[0]).toEqual({ ...before.rows[0], grantOk: true });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("keeps Owner global and isolates CAM-A and CAM-B through one active assignment", async () => {
    const db = await fixture();
    try {
      const ownerCompany = await createCompany(
        db,ids.owner,ids.ownerRole,ids.ownerCommand,"Owner Company 125",
      );
      const companyA = await createCompany(
        db,ids.camA,ids.camARole,ids.camACommand,"CAM A Company 125",
      );
      const replayA = await createCompany(
        db,ids.camA,ids.camARole,ids.camACommand,"CAM A Company 125",
      );
      const companyB = await createCompany(
        db,ids.camB,ids.camBRole,ids.camBCommand,"CAM B Company 125",
      );

      expect(replayA).toMatchObject({
        companyId: companyA.companyId,
        created: false,
      });
      const assignments = await db.query<{
        companyId: string; managerId: string; source: string;
      }>(`
        SELECT company_id::text "companyId",manager_user_id::text "managerId",
          assignment_source source
        FROM company_assignments
        WHERE company_id=ANY($1::uuid[]) AND status='ACTIVE'
        ORDER BY company_id
      `, [[ownerCompany.companyId,companyA.companyId,companyB.companyId]]);
      expect(assignments.rows).toHaveLength(2);
      expect(assignments.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          companyId: companyA.companyId,
          managerId: ids.camA,
          source: "CREATED_BY_CAM",
        }),
        expect.objectContaining({
          companyId: companyB.companyId,
          managerId: ids.camB,
          source: "CREATED_BY_CAM",
        }),
      ]));

      await expect(canView(db,ids.owner,ids.ownerRole,ownerCompany.companyId))
        .resolves.toBe(true);
      await expect(canView(db,ids.owner,ids.ownerRole,companyA.companyId))
        .resolves.toBe(true);
      await expect(canView(db,ids.owner,ids.ownerRole,companyB.companyId))
        .resolves.toBe(true);
      await expect(canView(db,ids.camA,ids.camARole,companyA.companyId))
        .resolves.toBe(true);
      await expect(canView(db,ids.camA,ids.camARole,ownerCompany.companyId))
        .resolves.toBe(false);
      await expect(canView(db,ids.camA,ids.camARole,companyB.companyId))
        .resolves.toBe(false);
      await expect(canView(db,ids.camB,ids.camBRole,companyB.companyId))
        .resolves.toBe(true);
      await expect(canView(db,ids.camB,ids.camBRole,companyA.companyId))
        .resolves.toBe(false);
      await expect(canView(
        db,ids.camA,ids.camARole,"c1250000-0000-4000-8000-000000009999",
      )).resolves.toBe(false);

      const workspaces = await Promise.all([
        db.query<{ payload: { companies: Array<{ id: string }> } }>(`
          SELECT axora_company_lifecycle_workspace($1,$2,now()) payload
        `, [ids.owner,ids.ownerRole]),
        db.query<{ payload: { companies: Array<{ id: string }> } }>(`
          SELECT axora_company_lifecycle_workspace($1,$2,now()) payload
        `, [ids.camA,ids.camARole]),
        db.query<{ payload: { companies: Array<{ id: string }> } }>(`
          SELECT axora_company_lifecycle_workspace($1,$2,now()) payload
        `, [ids.camB,ids.camBRole]),
      ]);
      expect(workspaces[0].rows[0]?.payload.companies.map(({ id }) => id))
        .toEqual(expect.arrayContaining([
          ownerCompany.companyId,companyA.companyId,companyB.companyId,
        ]));
      expect(workspaces[1].rows[0]?.payload.companies.map(({ id }) => id))
        .toEqual([companyA.companyId]);
      expect(workspaces[2].rows[0]?.payload.companies.map(({ id }) => id))
        .toEqual([companyB.companyId]);

      await db.query(`
        INSERT INTO workflow_events(
          id,company_id,aggregate_type,aggregate_id,event_key,event_version,
          actor_user_id,actor_kind,correlation_id,idempotency_key,occurred_at,metadata
        ) VALUES ($1,$2,'company',$2,'company.activated',1,$3,'PLATFORM',
          $1,'company-125-notification',now(),'{}'::jsonb)
      `, [ids.workflow,companyB.companyId,ids.owner]);
      const recipients = await db.query<{ camA: boolean; camB: boolean }>(`
        SELECT
          axora_workflow_notification_recipient_is_valid($1,$2,$3) "camA",
          axora_workflow_notification_recipient_is_valid($1,$2,$4) "camB"
      `, [companyB.companyId,ids.workflow,ids.camA,ids.camB]);
      expect(recipients.rows[0]).toEqual({ camA: false, camB: true });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("makes explicit DENY, ended ownership, and revoked CAM status final", async () => {
    const db = await fixture();
    try {
      const companyA = await createCompany(
        db,ids.camA,ids.camARole,ids.camACommand,"CAM A Revocation 125",
      );
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
        ) SELECT $1,permission.id,'DENY','PLATFORM',now(),true,
          'CAM_COMPANY_ACCESS_BLOCKED',$2
        FROM permissions permission
        WHERE permission.permission_code='company.view.assigned'
      `, [ids.camA,ids.owner]);
      await expect(canView(db,ids.camA,ids.camARole,companyA.companyId))
        .resolves.toBe(false);

      await db.query(`DELETE FROM user_permission_overrides WHERE user_id=$1`, [ids.camA]);
      await db.query(`
        UPDATE company_assignments SET status='ENDED',ended_by=$1,ended_at=now(),
          end_reason='Ownership ended for test'
        WHERE company_id=$2 AND manager_user_id=$3 AND status='ACTIVE'
      `, [ids.owner,companyA.companyId,ids.camA]);
      await expect(canView(db,ids.camA,ids.camARole,companyA.companyId))
        .resolves.toBe(false);

      await db.query(`
        UPDATE company_assignments SET status='ACTIVE',ended_by=NULL,ended_at=NULL,
          end_reason=NULL
        WHERE company_id=$1 AND manager_user_id=$2
      `, [companyA.companyId,ids.camA]);
      await db.query(`
        UPDATE role_assignments SET active=false,revoked_at=now(),revoked_by=$1
        WHERE id=$2
      `, [ids.owner,ids.camARole]);
      await expect(canView(db,ids.camA,ids.camARole,companyA.companyId))
        .resolves.toBe(false);
      await expect(canView(db,ids.owner,ids.ownerRole,companyA.companyId))
        .resolves.toBe(true);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("keeps company creation and routine delivery transitions out of email", async () => {
    const db = await fixture();
    try {
      const result = await db.query<{ key: string; allowed: boolean }>(`
        SELECT key,axora_workflow_event_email_allowed(key) allowed
        FROM unnest(ARRAY[
          'company.created','delivery.accepted','delivery.shopping_started',
          'delivery.items_acquired','delivery.out_for_delivery',
          'delivery.arrived','delivery.delivered','delivery.completed',
          'invoice.finalized','security.password_changed'
        ]) key
        ORDER BY key
      `);
      const policy = new Map(result.rows.map((row) => [row.key,row.allowed]));
      expect(policy.get("company.created")).toBe(false);
      expect(policy.get("delivery.accepted")).toBe(false);
      expect(policy.get("delivery.completed")).toBe(false);
      expect(policy.get("invoice.finalized")).toBe(true);
      expect(policy.get("security.password_changed")).toBe(true);
    } finally {
      await db.close();
    }
  }, 60_000);
});
