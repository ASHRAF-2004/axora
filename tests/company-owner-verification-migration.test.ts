import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "81000000-0000-4000-8000-000000000001",
  ownerAssignment: "81000000-0000-4000-8000-000000000002",
  manager: "81000000-0000-4000-8000-000000000003",
  managerAssignment: "81000000-0000-4000-8000-000000000004",
} as const;

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await applyDemoSeed(db);
  const company = await db.query<{ id: string }>(
    "SELECT id::text FROM companies WHERE active ORDER BY id LIMIT 1",
  );
  const companyId = company.rows[0]?.id;
  if (!companyId) throw new Error("Company verification fixture has no company");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      account_kind,account_status,account_setup_completed_at
    ) VALUES
      ($1,'owner-081@example.test','Verification Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
        'PLATFORM','ACTIVE',now()),
      ($2,'manager-081@example.test','Verification Manager','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,true,
        'PLATFORM','ACTIVE',now())
  `, [ids.owner, ids.manager]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by
    ) VALUES
      ($1,$2,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),'PLATFORM',NULL,true,$2),
      ($3,$4,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),'PLATFORM',NULL,true,$2)
  `, [ids.ownerAssignment, ids.owner, ids.managerAssignment, ids.manager]);
  await db.query(`
    UPDATE companies SET active=false,portal_access_enabled=false,
      lifecycle_status='COMPANY_REVIEW',verification_status='DRAFT',
      onboarding_version=1,duplicate_review_status='CLEAR',
      created_by=$2,notes='Private internal verification note'
    WHERE id=$1
  `, [companyId, ids.manager]);
  await db.query(`
    UPDATE company_onboarding_items SET status='PASSED',blocking_reason=NULL,
      completed_at=now(),completed_by=$2 WHERE company_id=$1
  `, [companyId, ids.manager]);
  await db.query(`
    UPDATE company_assignments SET status='ENDED',coverage_ends_at=now(),
      ended_at=now(),end_reason='Verification fixture reassignment'
    WHERE company_id=$1 AND status='ACTIVE'
  `, [companyId]);
  await db.query(`
    INSERT INTO company_assignments(
      company_id,manager_user_id,assignment_type,status,coverage_starts_at,
      assigned_by,assignment_reason
    ) VALUES ($1,$2,'PRIMARY','ACTIVE',now(),$3,'Verification fixture manager');
  `, [companyId, ids.manager, ids.owner]);
  await db.query(`
    INSERT INTO company_verification_history(
      company_id,from_status,to_status,reason,evidence,changed_at
    ) VALUES (
      $1,NULL,'NOT_STARTED','Preserved legacy verification evidence',
      '{"source":"MIGRATION_054"}'::jsonb,now()-interval '1 day'
    )
  `, [companyId]);
  return { db, companyId };
}

describe("Platform Owner company verification migration", () => {
  it("upgrades populated legacy verification states before installing the new constraint", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "080_operating_model_simplification.sql" });
      await applyDemoSeed(db);
      const company = await db.query<{ id: string }>(
        "SELECT id::text FROM companies ORDER BY id LIMIT 1",
      );
      const companyId = company.rows[0]?.id;
      if (!companyId) throw new Error("Populated verification fixture has no company");
      await db.query(`
        UPDATE companies SET active=false,portal_access_enabled=false,
          lifecycle_status='NEW_LEAD',verification_status='CHANGES_REQUIRED'
        WHERE id=$1
      `, [companyId]);

      await db.exec(await readFile(
        new URL("../database/migrations/081_platform_owner_company_verification.sql", import.meta.url),
        "utf8",
      ));

      const migrated = await db.query<{ status: string }>(`
        SELECT verification_status AS status FROM companies WHERE id=$1
      `, [companyId]);
      expect(migrated.rows[0]?.status).toBe("CHANGES_REQUESTED");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("requires Manager submission and an owner-only decision before activation", async () => {
    const { db, companyId } = await fixture();
    try {
      const managerWorkspace = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_company_verification_workspace($1,$2,$3,now()) AS snapshot
      `, [ids.manager, ids.managerAssignment, companyId]);
      expect(managerWorkspace.rows[0]?.snapshot).toMatchObject({
        canEdit: true, canSubmit: true, canReview: false,
        company: {
          id: companyId,
          verificationStatus: "DRAFT",
          internalNotes: "Private internal verification note",
        },
      });

      await db.query(`
        SELECT axora_submit_company_verification(
          $1,$2,$3,1,'Submit completed company for owner verification',now()
        )
      `, [ids.manager, ids.managerAssignment, companyId]);
      const submitted = await db.query<{ status: string; version: number }>(`
        SELECT verification_status AS status,onboarding_version AS version
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(submitted.rows[0]).toEqual({ status: "PENDING_VERIFICATION", version: 2 });

      await expect(db.query(`
        SELECT axora_review_company_verification(
          $1,$2,$3,2,'APPROVE','Manager cannot self-verify company',now()
        )
      `, [ids.manager, ids.managerAssignment, companyId])).rejects.toThrow(
        "company verification decision is unavailable",
      );
      await expect(db.query(
        "UPDATE companies SET active=true,portal_access_enabled=true WHERE id=$1",
        [companyId],
      )).rejects.toThrow();

      const ownerWorkspace = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_company_verification_workspace($1,$2,$3,now()) AS snapshot
      `, [ids.owner, ids.ownerAssignment, companyId]);
      expect(ownerWorkspace.rows[0]?.snapshot).toMatchObject({
        canEdit: true, canSubmit: false, canReview: true,
      });
      await db.query(`
        SELECT axora_review_company_verification(
          $1,$2,$3,2,'REQUEST_CHANGES','Clarify the submitted company evidence',now()
        )
      `, [ids.owner, ids.ownerAssignment, companyId]);
      const changes = await db.query<{ status: string; version: number }>(`
        SELECT verification_status AS status,onboarding_version AS version
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(changes.rows[0]).toEqual({ status: "CHANGES_REQUESTED", version: 3 });

      await db.query(`
        SELECT axora_submit_company_verification(
          $1,$2,$3,3,'Resubmit corrected company evidence',now()
        )
      `, [ids.manager, ids.managerAssignment, companyId]);
      await db.query(`
        SELECT axora_review_company_verification(
          $1,$2,$3,4,'APPROVE','Approve corrected company evidence',now()
        )
      `, [ids.owner, ids.ownerAssignment, companyId]);
      const approved = await db.query<{ status: string; blockers: string[] }>(`
        SELECT verification_status AS status,
          axora_company_activation_blockers(id) AS blockers
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(approved.rows[0]).toEqual({ status: "VERIFIED", blockers: [] });

      const history = await db.query<{ states: string[] }>(`
        SELECT array_agg(to_status ORDER BY changed_at,id) AS states
        FROM company_verification_history WHERE company_id=$1
      `, [companyId]);
      expect(history.rows[0]?.states).toEqual(expect.arrayContaining([
        "PENDING_VERIFICATION", "CHANGES_REQUESTED", "VERIFIED",
      ]));
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps legacy evidence and exposes only narrow app capabilities", async () => {
    const { db, companyId } = await fixture();
    try {
      const evidence = await db.query<{ legacy: number }>(`
        SELECT count(*)::integer AS legacy
        FROM company_verification_history
        WHERE company_id=$1 AND evidence->>'source'='MIGRATION_054'
      `, [companyId]);
      expect(evidence.rows[0]?.legacy).toBe(1);
      const privileges = await db.query<{
        workspace: boolean; oldWorkspace: boolean; submit: boolean; review: boolean;
      }>(`
        SELECT
          has_function_privilege('axora_app','axora_company_verification_workspace(uuid,uuid,uuid,timestamptz)','EXECUTE') AS workspace,
          has_function_privilege('axora_app','axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz)','EXECUTE') AS "oldWorkspace",
          has_function_privilege('axora_app','axora_submit_company_verification(uuid,uuid,uuid,integer,text,timestamptz)','EXECUTE') AS submit,
          has_function_privilege('axora_app','axora_review_company_verification(uuid,uuid,uuid,integer,text,text,timestamptz)','EXECUTE') AS review
      `);
      expect(privileges.rows[0]).toEqual({
        workspace: true, oldWorkspace: false, submit: true, review: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
