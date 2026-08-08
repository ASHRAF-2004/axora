import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "54000000-0000-4000-8000-000000000001",
  assignment: "54000000-0000-4000-8000-000000000002",
} as const;

async function labeledQuery(
  db: PGlite,
  label: string,
  sql: string,
  parameters: unknown[],
) {
  try {
    return await db.query(sql, parameters);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db, { through: "054_company_onboarding_completion.sql" });
  await applyDemoSeed(db);
  const company = await db.query<{ id: string }>(
    "SELECT id::text FROM companies WHERE active ORDER BY id LIMIT 1",
  );
  const companyId = company.rows[0]?.id;
  if (!companyId) throw new Error("Company onboarding fixture has no active company");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      account_kind,account_status,account_setup_completed_at
    ) VALUES (
      $1,'owner-054@example.test','Onboarding Owner','not-a-real-hash',
      (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
      'PLATFORM','ACTIVE',now()
    )
  `, [ids.owner]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by
    ) SELECT $1,$2,id,'PLATFORM',true,$2 FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ids.assignment, ids.owner]);
  await db.query(`
    INSERT INTO company_assignments(
      company_id,manager_user_id,assignment_type,status,assigned_by,assignment_reason
    ) VALUES ($1,$2,'PRIMARY','ACTIVE',$2,'Focused onboarding verification fixture')
  `, [companyId, ids.owner]);
  return { db, companyId };
}

describe("company onboarding completion migration", () => {
  it("provides managed localized taxonomy and a resumable authorized workspace", async () => {
    const { db, companyId } = await fixture();
    try {
      const taxonomy = await db.query<{
        code: string;
        en: string;
        ar: string;
        ms: string;
        custom: boolean;
      }>(`
        SELECT industry_code AS code,name_en AS en,name_ar AS ar,name_ms AS ms,
          allows_custom_label AS custom
        FROM industry_taxonomy WHERE industry_code IN ('TECHNOLOGY','OTHER')
        ORDER BY industry_code
      `);
      expect(taxonomy.rows).toHaveLength(2);
      expect(taxonomy.rows.every((row) => row.en && row.ar && row.ms)).toBe(true);
      expect(taxonomy.rows.find((row) => row.code === "OTHER")?.custom).toBe(true);

      const workspace = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_company_onboarding_workspace($1,$2,$3,now()) AS snapshot
      `, [ids.owner, ids.assignment, companyId]);
      expect(workspace.rows[0]?.snapshot).toMatchObject({
        canEdit: true,
        canApproveExceptions: true,
        canVerify: true,
        company: { id: companyId, verificationStatus: "VERIFIED", version: 1 },
      });
      expect(workspace.rows[0]?.snapshot.industries).toBeInstanceOf(Array);
      expect(workspace.rows[0]?.snapshot.items).toBeInstanceOf(Array);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("saves profile progress, invalidates stale verification, and records reminders and expiring exceptions", async () => {
    const { db, companyId } = await fixture();
    try {
      const profile = await db.query<{
        legalName: string;
        registrationNumber: string;
        mainContactName: string;
        mainContactEmail: string;
        mainContactPhone: string;
        billingContactName: string;
        billingContactEmail: string;
        billingContactPhone: string;
        billingAddress: string;
        billingCycle: string;
      }>(`
        SELECT legal_name AS "legalName",registration_number AS "registrationNumber",
          main_contact_name AS "mainContactName",main_contact_email AS "mainContactEmail",
          main_contact_phone AS "mainContactPhone",billing_contact_name AS "billingContactName",
          billing_contact_email AS "billingContactEmail",billing_contact_phone AS "billingContactPhone",
          billing_address AS "billingAddress",billing_cycle AS "billingCycle"
        FROM companies WHERE id=$1
      `, [companyId]);
      const row = profile.rows[0];
      await db.query(`
        SELECT axora_save_company_onboarding(
          $1,$2,$3,1,$4,$5,'MY','TAX-054','TECHNOLOGY',NULL,
          'Registered address 054','Operating address 054',$6,$7,$8,$9,$10,$11,
          $12,$13,'ar','Asia/Riyadh','CONTACTS',ARRAY['LEGAL_IDENTITY','INDUSTRY'],
          'Save staged onboarding progress',now()
        )
      `, [
        ids.owner, ids.assignment, companyId, row.legalName,
        row.registrationNumber || "REG-054", row.mainContactName,
        row.mainContactEmail, row.mainContactPhone, row.billingContactName,
        row.billingContactEmail, row.billingContactPhone, row.billingAddress,
        row.billingCycle,
      ]);
      const saved = await db.query<{
        version: number;
        locale: string;
        timezone: string;
        step: string;
        verification: string;
      }>(`
        SELECT onboarding_version AS version,default_locale AS locale,timezone,
          onboarding_current_step AS step,verification_status AS verification
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(saved.rows[0]).toEqual({
        version: 2,
        locale: "ar",
        timezone: "Asia/Riyadh",
        step: "CONTACTS",
        verification: "CHANGES_REQUIRED",
      });

      await labeledQuery(db, "pending reminder", `
        SELECT axora_update_company_onboarding_item(
          $1,$2,$3,2,'REGISTERED_ADDRESS','PENDING',$1,
          'Address evidence needs refresh',NULL,now()+interval '1 day',NULL,NULL,
          'Request refreshed address evidence',now()
        )
      `, [ids.owner, ids.assignment, companyId]);
      const reminder = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM company_onboarding_reminders
        WHERE company_id=$1 AND status='PENDING'
      `, [companyId]);
      expect(reminder.rows[0]?.count).toBe(1);

      await labeledQuery(db, "time-bound exception", `
        SELECT axora_update_company_onboarding_item(
          $1,$2,$3,3,'REGISTERED_ADDRESS','WAIVED',$1,
          'Approved temporary address exception','CASE-054',NULL,
          'Temporary registered-address exception',now()+interval '2 hours',
          'Approve a time-bound onboarding exception',now()
        )
      `, [ids.owner, ids.assignment, companyId]);
      const blockers = await db.query<{ current: string[]; expired: string[] }>(`
        SELECT axora_company_onboarding_content_blockers($1,now()) AS current,
          axora_company_onboarding_content_blockers($1,now()+interval '3 hours') AS expired
      `, [companyId]);
      expect(blockers.rows[0]?.current).not.toContain("REGISTERED_ADDRESS");
      expect(blockers.rows[0]?.expired).toContain("REGISTERED_ADDRESS");
      const cancelled = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM company_onboarding_reminders
        WHERE company_id=$1 AND status='CANCELLED'
      `, [companyId]);
      expect(cancelled.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("requires explicit verification before activation and keeps internal helpers private", async () => {
    const { db, companyId } = await fixture();
    try {
      await db.query(`
        UPDATE companies SET verification_status='READY_FOR_REVIEW' WHERE id=$1
      `, [companyId]);
      const blocked = await db.query<{ blockers: string[] }>(`
        SELECT axora_company_activation_blockers($1) AS blockers
      `, [companyId]);
      expect(blocked.rows[0]?.blockers).toContain("ONBOARDING_VERIFICATION");
      await db.query(`
        SELECT axora_verify_company_onboarding(
          $1,$2,$3,1,'Verify all mandatory onboarding evidence',now()
        )
      `, [ids.owner, ids.assignment, companyId]);
      const verified = await db.query<{ status: string; blockers: string[] }>(`
        SELECT verification_status AS status,
          axora_company_activation_blockers(id) AS blockers
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(verified.rows[0]).toEqual({ status: "VERIFIED", blockers: [] });

      const privileges = await db.query<{ workspace: boolean; internal: boolean; public: boolean }>(`
        SELECT
          has_function_privilege('axora_app','axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz)','EXECUTE') AS workspace,
          has_function_privilege('axora_app','axora_company_onboarding_recipients(uuid,uuid,timestamptz)','EXECUTE') AS internal,
          has_function_privilege('public','axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz)','EXECUTE') AS public
      `);
      expect(privileges.rows[0]).toEqual({ workspace: true, internal: false, public: false });
    } finally {
      await db.close();
    }
  }, 30_000);
});
