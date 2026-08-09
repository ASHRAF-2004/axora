import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/069_company_manager_coverage.sql",
  import.meta.url,
);

const ids = {
  owner: "69000000-0000-4000-8000-000000000001",
  managerA: "69000000-0000-4000-8000-000000000002",
  managerB: "69000000-0000-4000-8000-000000000003",
  managerC: "69000000-0000-4000-8000-000000000004",
  ownerAssignment: "69000000-0000-4000-8000-000000000011",
  managerAssignmentA: "69000000-0000-4000-8000-000000000012",
  managerAssignmentB: "69000000-0000-4000-8000-000000000013",
  managerAssignmentC: "69000000-0000-4000-8000-000000000014",
} as const;

interface Fixture {
  db: PGlite;
  baseCompanyId: string;
}

interface Mutation {
  companyId: string;
  companyName: string;
  eventKey: string;
  eventSequence?: string;
  notificationRecipientIds: string[];
}

async function fixture(): Promise<Fixture> {
  const db = new PGlite();
  await applyMigrations(db, { through: "068_live_delivery_tracking.sql" });
  await applyDemoSeed(db);
  await db.exec(await readFile(migrationUrl, "utf8"));

  const company = await db.query<{ id: string }>(`
    SELECT id::text FROM companies ORDER BY id LIMIT 1
  `);
  const baseCompanyId = company.rows[0]?.id;
  if (!baseCompanyId) throw new Error("Manager coverage fixture requires a company");

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-069@example.test','Coverage Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,
        now(),'PLATFORM','ACTIVE',true,1),
      ($2,'manager-a-069@example.test','Coverage Manager A','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($3,'manager-b-069@example.test','Coverage Manager B','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($4,'manager-c-069@example.test','Coverage Manager C','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner, ids.managerA, ids.managerB, ids.managerC]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by
    ) VALUES
      ($1,$5,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
        'PLATFORM',NULL,true,$5),
      ($2,$6,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5),
      ($3,$7,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5),
      ($4,$8,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5)
  `, [
    ids.ownerAssignment,
    ids.managerAssignmentA,
    ids.managerAssignmentB,
    ids.managerAssignmentC,
    ids.owner,
    ids.managerA,
    ids.managerB,
    ids.managerC,
    baseCompanyId,
  ]);
  return { db, baseCompanyId };
}

async function createCompany(db: PGlite, suffix: string) {
  const result = await db.query<{ snapshot: Mutation }>(`
    SELECT axora_create_company_lead(
      $1,$2,$3,$4,$5,'Professional services','Coverage fixture',NULL,
      'Primary Contact',$6,$7,'Billing Contact',$6,$7,
      'Coverage fixture address','Cash on delivery (COD)','Monthly',NULL,now()
    ) AS snapshot
  `, [
    ids.owner,
    ids.ownerAssignment,
    `Coverage ${suffix}`,
    `Coverage ${suffix} Sdn Bhd`,
    `REG-069-${suffix}`,
    `contact-${suffix.toLowerCase()}@coverage.example.test`,
    `+60369${suffix.replace(/\D/g, "").padStart(6, "0")}`,
  ]);
  const companyId = result.rows[0]?.snapshot.companyId;
  if (!companyId) throw new Error("Coverage company creation failed");
  return companyId;
}

async function assignLegacy(
  db: PGlite,
  companyId: string,
  managerId: string,
  assignmentType: "PRIMARY" | "BACKUP" = "PRIMARY",
  startsAt: Date | null = null,
  endsAt: Date | null = null,
) {
  return db.query<{ snapshot: Mutation }>(`
    SELECT axora_assign_company_manager(
      $1,$2,$3,$4,$5,$6,$7,'Coverage test assignment',now()
    ) AS snapshot
  `, [
    ids.owner,
    ids.ownerAssignment,
    companyId,
    managerId,
    assignmentType,
    startsAt,
    endsAt,
  ]);
}

async function assignRich(
  db: PGlite,
  companyId: string,
  managerId: string,
  options: Partial<{
    assignmentType: "PRIMARY" | "BACKUP";
    startsAt: Date;
    endsAt: Date;
    accessMode: "NORMAL" | "TEMPORARY" | "READ_ONLY" | "SPECIFIC_PERMISSIONS";
    permissions: string[];
    documentVisibility: "STANDARD" | "COMPANY_SHARED_ONLY" | "NONE";
    actorId: string;
    actorAssignmentId: string;
    allowSelfClaim: boolean;
  }> = {},
) {
  return db.query<{ snapshot: Mutation }>(`
    SELECT axora_manage_company_assignment(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,
      'Private handover evidence',$11::text[],
      'Coverage manager transaction',$12,now()
    ) AS snapshot
  `, [
    options.actorId ?? ids.owner,
    options.actorAssignmentId ?? ids.ownerAssignment,
    companyId,
    managerId,
    options.assignmentType ?? "PRIMARY",
    options.startsAt ?? null,
    options.endsAt ?? null,
    options.accessMode ?? "NORMAL",
    options.permissions ?? [],
    options.documentVisibility ?? "STANDARD",
    ["Confirm open onboarding work", "Confirm private document policy"],
    options.allowSelfClaim ?? false,
  ]);
}

async function addOpenWork(db: PGlite, companyId: string, managerId: string) {
  const item = await db.query<{ id: string }>(`
    SELECT id::text FROM company_onboarding_items
    WHERE company_id=$1 AND status IN ('PENDING','FAILED')
    ORDER BY item_code LIMIT 1
  `, [companyId]);
  const onboardingItemId = item.rows[0]?.id;
  if (!onboardingItemId) throw new Error("Coverage fixture requires open onboarding work");
  await db.query(`
    INSERT INTO company_onboarding_reminders(
      company_id,onboarding_item_id,recipient_user_id,due_at,created_by
    ) VALUES ($1,$2,$3,now()+interval '1 day',$4)
  `, [companyId, onboardingItemId, managerId, ids.owner]);
  await db.query(`
    WITH lead AS (
      INSERT INTO company_leads(status,lead_source,converted_company_id)
      VALUES ('CONVERTED','MANUAL_ENTRY',$1)
      RETURNING id
    )
    INSERT INTO company_lead_tasks(lead_id,title,due_at,assigned_user_id,created_by)
    SELECT id,'Complete converted lead handover',now()+interval '1 day',$2,$3
    FROM lead
  `, [companyId, managerId, ids.owner]);
  return onboardingItemId;
}

describe("company manager coverage migration", () => {
  it("reassigns atomically, transfers only open work, restricts access modes, and preserves history", { timeout: 30_000 }, async () => {
    const { db } = await fixture();
    try {
      const companyId = await createCompany(db, "TRANSFER-1");
      await assignLegacy(db, companyId, ids.managerA);
      const onboardingItemId = await addOpenWork(db, companyId, ids.managerA);

      const reassigned = await assignRich(db, companyId, ids.managerC, {
        accessMode: "SPECIFIC_PERMISSIONS",
        permissions: ["company.view.assigned", "company.edit"],
        documentVisibility: "NONE",
      });
      expect(reassigned.rows[0]?.snapshot).toMatchObject({
        companyId,
        eventKey: "company.reassigned",
      });
      expect(reassigned.rows[0]?.snapshot.eventSequence).toMatch(/^[0-9a-f-]{36}$/);
      expect(reassigned.rows[0]?.snapshot.notificationRecipientIds).toEqual(
        expect.arrayContaining([ids.managerA, ids.managerC]),
      );

      const assignments = await db.query<{
        manager: string;
        status: string;
        accessMode: string;
        predecessor: string | null;
      }>(`
        SELECT manager_user_id::text AS manager,status,
          access_mode AS "accessMode",predecessor_assignment_id::text AS predecessor
        FROM company_assignments
        WHERE company_id=$1 AND assignment_type='PRIMARY'
        ORDER BY assigned_at
      `, [companyId]);
      expect(assignments.rows).toHaveLength(2);
      expect(assignments.rows[0]).toMatchObject({ manager: ids.managerA, status: "ENDED" });
      expect(assignments.rows[1]).toMatchObject({
        manager: ids.managerC,
        status: "ACTIVE",
        accessMode: "SPECIFIC_PERMISSIONS",
      });
      expect(assignments.rows[1]?.predecessor).toBeTruthy();

      const transferred = await db.query<{
        onboardingManager: string;
        reminderManager: string;
        taskManager: string;
      }>(`
        SELECT
          (SELECT assigned_manager_user_id::text FROM company_onboarding_items WHERE id=$2) AS "onboardingManager",
          (SELECT recipient_user_id::text FROM company_onboarding_reminders WHERE company_id=$1 AND status='PENDING' LIMIT 1) AS "reminderManager",
          (SELECT task.assigned_user_id::text FROM company_lead_tasks task
            JOIN company_leads lead ON lead.id=task.lead_id
            WHERE lead.converted_company_id=$1 AND task.status='OPEN' LIMIT 1) AS "taskManager"
      `, [companyId, onboardingItemId]);
      expect(transferred.rows[0]).toEqual({
        onboardingManager: ids.managerC,
        reminderManager: ids.managerC,
        taskManager: ids.managerC,
      });

      const permission = await db.query<{ edit: boolean; documents: boolean }>(`
        WITH snapshot AS (
          SELECT axora_live_authorization_snapshot($1,$2,now()) AS value
        )
        SELECT
          axora_company_actor_has_permission(value,$1,$3,'company.edit',now()) AS edit,
          axora_company_actor_has_permission(value,$1,$3,'document.view',now()) AS documents
        FROM snapshot
      `, [ids.managerC, ids.managerAssignmentC, companyId]);
      expect(permission.rows[0]).toEqual({ edit: true, documents: false });
      await expect(db.query(`
        UPDATE company_manager_continuity_events SET reason='rewritten' WHERE company_id=$1
      `, [companyId])).rejects.toThrow("append-only");
    } finally {
      await db.close();
    }
  });

  it("validates region and workload before replacing the accountable primary", { timeout: 30_000 }, async () => {
    const { db } = await fixture();
    try {
      const firstCompanyId = await createCompany(db, "CAPACITY-1");
      const secondCompanyId = await createCompany(db, "CAPACITY-2");
      await db.query(`
        INSERT INTO company_manager_profiles(
          manager_user_id,service_region_code,max_primary_companies,availability_status,updated_by
        ) VALUES ($1,'MY-CENTRAL',1,'AVAILABLE',$2)
      `, [ids.managerA, ids.owner]);
      await db.query(`UPDATE companies SET service_region_code='MY-CENTRAL' WHERE id IN ($1,$2)`, [
        firstCompanyId,
        secondCompanyId,
      ]);
      await assignLegacy(db, firstCompanyId, ids.managerA);
      await assignLegacy(db, secondCompanyId, ids.managerC);

      await expect(assignRich(db, secondCompanyId, ids.managerA)).rejects.toThrow(
        "selected manager is unavailable",
      );
      let active = await db.query<{ manager: string }>(`
        SELECT manager_user_id::text AS manager FROM company_assignments
        WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE'
      `, [secondCompanyId]);
      expect(active.rows[0]?.manager).toBe(ids.managerC);

      await db.query(`
        UPDATE company_manager_profiles
        SET max_primary_companies=2,service_region_code='MY-NORTH'
        WHERE manager_user_id=$1
      `, [ids.managerA]);
      await expect(assignRich(db, secondCompanyId, ids.managerA)).rejects.toThrow(
        "selected manager is unavailable",
      );
      active = await db.query<{ manager: string }>(`
        SELECT manager_user_id::text AS manager FROM company_assignments
        WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE'
      `, [secondCompanyId]);
      expect(active.rows[0]?.manager).toBe(ids.managerC);
    } finally {
      await db.close();
    }
  });

  it("promotes eligible backup coverage and revokes the deactivated primary in the same transaction", { timeout: 30_000 }, async () => {
    const { db } = await fixture();
    try {
      const companyId = await createCompany(db, "FAILOVER-1");
      await assignLegacy(db, companyId, ids.managerA);
      await addOpenWork(db, companyId, ids.managerA);
      const startsAt = new Date(Date.now() - 60_000);
      const endsAt = new Date(Date.now() + 86_400_000);
      await assignRich(db, companyId, ids.managerB, {
        assignmentType: "BACKUP",
        startsAt,
        endsAt,
        accessMode: "TEMPORARY",
      });

      await db.query(`UPDATE users SET active=false WHERE id=$1`, [ids.managerA]);
      const result = await db.query<{
        primaryManager: string;
        primaryMode: string;
        activeBackups: number;
        eventType: string;
        openWorkManager: string;
      }>(`
        SELECT
          (SELECT manager_user_id::text FROM company_assignments
            WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE') AS "primaryManager",
          (SELECT access_mode FROM company_assignments
            WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE') AS "primaryMode",
          (SELECT count(*)::int FROM company_assignments
            WHERE company_id=$1 AND assignment_type='BACKUP' AND status='ACTIVE') AS "activeBackups",
          (SELECT event_type FROM company_manager_continuity_events
            WHERE company_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "eventType",
          (SELECT assigned_manager_user_id::text FROM company_onboarding_items
            WHERE company_id=$1 AND status IN ('PENDING','FAILED') LIMIT 1) AS "openWorkManager"
      `, [companyId]);
      expect(result.rows[0]).toEqual({
        primaryManager: ids.managerB,
        primaryMode: "NORMAL",
        activeBackups: 0,
        eventType: "AUTO_FAILOVER",
        openWorkManager: ids.managerB,
      });

      const denied = await db.query<{ active: boolean }>(`
        SELECT axora_company_assignment_is_active($1,$2,now()) AS active
      `, [ids.managerA, companyId]);
      expect(denied.rows[0]?.active).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("records an owner-accountable gap when both primary and backup are unavailable", { timeout: 30_000 }, async () => {
    const { db } = await fixture();
    try {
      const companyId = await createCompany(db, "GAP-1");
      await assignLegacy(db, companyId, ids.managerA);
      await addOpenWork(db, companyId, ids.managerA);
      await assignRich(db, companyId, ids.managerB, {
        assignmentType: "BACKUP",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
        accessMode: "READ_ONLY",
      });
      await db.query(`UPDATE users SET active=false WHERE id=$1`, [ids.managerB]);
      await db.query(`UPDATE users SET active=false WHERE id=$1`, [ids.managerA]);

      const gap = await db.query<{
        activePrimary: number;
        activeBackup: number;
        eventType: string;
        ownerId: string;
        openWorkManager: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM company_assignments
            WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE') AS "activePrimary",
          (SELECT count(*)::int FROM company_assignments
            WHERE company_id=$1 AND assignment_type='BACKUP' AND status='ACTIVE') AS "activeBackup",
          (SELECT event_type FROM company_manager_continuity_events
            WHERE company_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "eventType",
          (SELECT accountable_owner_user_id::text FROM company_manager_continuity_events
            WHERE company_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "ownerId",
          (SELECT assigned_manager_user_id::text FROM company_onboarding_items
            WHERE company_id=$1 AND status IN ('PENDING','FAILED') LIMIT 1) AS "openWorkManager"
      `, [companyId]);
      expect(gap.rows[0]).toEqual({
        activePrimary: 0,
        activeBackup: 0,
        eventType: "COVERAGE_GAP",
        ownerId: ids.owner,
        openWorkManager: ids.owner,
      });
    } finally {
      await db.close();
    }
  });
});
