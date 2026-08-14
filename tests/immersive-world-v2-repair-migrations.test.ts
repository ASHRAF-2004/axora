import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ownerId = "d0000000-0000-4000-8000-000000000001";
const ownerAssignmentId = "d0000000-0000-4000-8000-000000000002";

async function installOwner(db: PGlite) {
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_kind,
      account_status,account_setup_completed_at
    ) SELECT $1,'owner@fixture.invalid','Fixture owner','fixture-hash',id,true,
      'PLATFORM','ACTIVE',now()
    FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ownerId]);
  await db.query(`
    INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
    SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ownerAssignmentId, ownerId]);
}

async function applyMigration(db: PGlite, filename: string) {
  await db.exec(await readFile(new URL(`../database/migrations/${filename}`, import.meta.url), "utf8"));
}

async function makePaymentDeliverable(db: PGlite, paymentId: string) {
  await db.exec("SET session_replication_role=replica");
  await db.query(`UPDATE requests request SET
      status_id=lookup_id('request_status','Preparing for Delivery'),completed_at=NULL
    FROM invoices invoice WHERE invoice.id=(SELECT payment.invoice_id FROM payments payment WHERE payment.id=$1)
      AND request.id=invoice.request_id`, [paymentId]);
  await db.query(`UPDATE request_line_receipt_baselines baseline SET
      legacy_accepted_quantity_snapshot=0,independent_accepted_quantity_snapshot=0,
      baseline_accepted_quantity=0
    WHERE baseline.request_line_id IN (
      SELECT line.id FROM request_lines line JOIN invoices invoice ON invoice.request_id=line.request_id
      JOIN payments payment ON payment.invoice_id=invoice.id WHERE payment.id=$1
    )`, [paymentId]);
  await db.exec("SET session_replication_role=origin");
}

describe("immersive world V2 repair migrations", () => {
  it("backfills pre-existing paid finalized work exactly once", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db, { through: "083_immersive_world_preferences_and_visitor_readiness.sql" });
      await applyDemoSeed(db);
      await installOwner(db);
      const fixturePaymentId = "90000000-0000-4000-8000-000000000009";
      await makePaymentDeliverable(db, fixturePaymentId);
      expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM delivery_jobs")).rows[0]?.count).toBe(0);

      for (const migration of [
        "084_driver_self_claim_and_management.sql",
        "085_company_deletion_guardrails.sql",
        "086_customer_catalog_public_references.sql",
        "087_visitor_cookie_primary_identity.sql",
        "088_delivery_recovery_and_paid_backfill.sql",
      ]) await applyMigration(db, migration);

      const eligible = await db.query<{ jobs: number; lines: number; expected_lines: number }>(`
        SELECT
          (SELECT count(*)::int FROM delivery_jobs) AS jobs,
          (SELECT count(*)::int FROM delivery_job_lines) AS lines,
          (SELECT count(*)::int FROM request_lines line
            JOIN invoices invoice ON invoice.request_id=line.request_id
            JOIN payments payment ON payment.invoice_id=invoice.id
            WHERE payment.id=$1) AS expected_lines
      `, [fixturePaymentId]);
      expect(eligible.rows[0]?.jobs).toBe(1);
      expect(eligible.rows[0]?.lines).toBe(eligible.rows[0]?.expected_lines);

      const payments = await db.query<{ id: string }>(`
        SELECT payment.id FROM payments payment JOIN invoices invoice ON invoice.id=payment.invoice_id
        WHERE payment.payment_status='PAID' AND invoice.lifecycle_status='FINALIZED'
          AND invoice.company_id IS NOT NULL ORDER BY payment.id
      `);
      for (const payment of payments.rows) {
        await db.query("SELECT axora_ensure_available_job_for_paid_payment($1,now())", [payment.id]);
      }
      const repeated = await db.query<{ jobs: number; keys: number }>(`
        SELECT count(*)::int AS jobs,count(DISTINCT idempotency_key)::int AS keys FROM delivery_jobs
      `);
      expect(repeated.rows[0]).toEqual({ jobs: eligible.rows[0]?.jobs, keys: eligible.rows[0]?.jobs });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("allows one concurrent driver claim and only recovers objectively stale work", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      await applyDemoSeed(db);
      await installOwner(db);
      const payment = (await db.query<{ id: string }>("SELECT id FROM payments ORDER BY id LIMIT 1")).rows[0]!.id;
      await makePaymentDeliverable(db, payment);
      const jobId = (await db.query<{ value: string }>("SELECT axora_ensure_available_job_for_paid_payment($1,now()) AS value", [payment])).rows[0]!.value;

      const drivers = [
        { user: "d8000000-0000-4000-8000-000000000001", assignment: "d8000000-0000-4000-8000-000000000002", command: "d8000000-0000-4000-8000-000000000003", code: "DRIVER-A" },
        { user: "d9000000-0000-4000-8000-000000000001", assignment: "d9000000-0000-4000-8000-000000000002", command: "d9000000-0000-4000-8000-000000000003", code: "DRIVER-B" },
      ];
      for (const driver of drivers) {
        await db.query(`
          INSERT INTO users(id,email,display_name,password_hash,role_id,account_kind,account_status,account_setup_completed_at)
          SELECT $1,$2,$3,'fixture-hash',id,'DELIVERY','ACTIVE',now() FROM roles WHERE role_key='DELIVERY_GUY'
        `, [driver.user, `${driver.code.toLowerCase()}@fixture.invalid`, driver.code]);
        await db.query(`
          INSERT INTO role_assignments(id,user_id,role_id,scope_type,active,assigned_by)
          SELECT $1,$2,id,'DELIVERY',true,$3 FROM roles WHERE role_key='DELIVERY_GUY'
        `, [driver.assignment, driver.user, ownerId]);
        await db.query("INSERT INTO delivery_agent_profiles(user_id,agent_code,active) VALUES($1,$2,true)", [driver.user, driver.code]);
      }

      for (const driver of drivers) {
        const readiness = await db.query<{ snapshot_ready: boolean; claim_allowed: boolean; profile_ready: boolean }>(`
          SELECT snapshot IS NOT NULL AS snapshot_ready,
            axora_snapshot_has_permission(snapshot,'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL) AS claim_allowed,
            EXISTS (
              SELECT 1 FROM delivery_agent_profiles profile
              WHERE profile.user_id=$1 AND profile.active AND profile.availability_status='AVAILABLE'
            ) AS profile_ready
          FROM (SELECT axora_live_authorization_snapshot($1,$2,now()) AS snapshot) auth_snapshot
        `, [driver.user, driver.assignment]);
        expect(readiness.rows[0]).toEqual({ snapshot_ready: true, claim_allowed: true, profile_ready: true });
      }

      const claims = await Promise.allSettled(drivers.map((driver) => db.query(
        "SELECT axora_claim_available_delivery_job($1,$2,$3,$4,now()) AS value",
        [driver.user, driver.assignment, jobId, driver.command],
      )));
      const claimOutcomes = claims.map((claim) => claim.status === "fulfilled"
        ? "fulfilled"
        : `rejected: ${claim.reason instanceof Error ? claim.reason.message : String(claim.reason)}`);
      expect(claimOutcomes.join("\n")).toContain("fulfilled");
      expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
      const assignmentCount = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM delivery_job_assignments
        WHERE delivery_job_id=$1 AND ended_at IS NULL
      `, [jobId]);
      expect(assignmentCount.rows[0]?.count).toBe(1);

      await expect(db.query(
        "SELECT axora_release_stuck_delivery_job($1,$2,$3,$4,$5,now())",
        [ownerId, ownerAssignmentId, jobId, "da000000-0000-4000-8000-000000000001", "Routine recovery check"],
      )).rejects.toThrow(/not eligible|healthy|recovery/i);

      const eligibility = await db.query<{ value: { eligible: boolean; facts: { acceptanceExpired: boolean } } }>(
        "SELECT axora_delivery_recovery_eligibility($1,$2,$3,now()+interval '3 hours') AS value", [ownerId, ownerAssignmentId, jobId],
      );
      expect(eligibility.rows[0]?.value).toMatchObject({ eligible: true, facts: { acceptanceExpired: true } });

      const recoveryCommand = "da000000-0000-4000-8000-000000000002";
      const recovered = await db.query<{ value: Record<string, unknown> }>(
        "SELECT axora_release_stuck_delivery_job($1,$2,$3,$4,$5,now()+interval '3 hours') AS value",
        [ownerId, ownerAssignmentId, jobId, recoveryCommand, "Acceptance deadline expired"],
      );
      const repeated = await db.query<{ value: Record<string, unknown> }>(
        "SELECT axora_release_stuck_delivery_job($1,$2,$3,$4,$5,now()+interval '3 hours') AS value",
        [ownerId, ownerAssignmentId, jobId, recoveryCommand, "Acceptance deadline expired"],
      );
      expect(repeated.rows[0]?.value).toEqual(recovered.rows[0]?.value);
      const state = await db.query<{ status: string; active_assignments: number; commands: number }>(`
        SELECT job.status,
          (SELECT count(*)::int FROM delivery_job_assignments assignment
            WHERE assignment.delivery_job_id=job.id AND assignment.ended_at IS NULL) AS active_assignments,
          (SELECT count(*)::int FROM delivery_recovery_commands command
            WHERE command.command_id=$2) AS commands
        FROM delivery_jobs job WHERE job.id=$1
      `, [jobId, recoveryCommand]);
      expect(state.rows[0]).toEqual({ status: "AWAITING_ASSIGNMENT", active_assignments: 0, commands: 1 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("cascades disposable children while retaining protected evidence and tenant isolation", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      await applyDemoSeed(db);
      await installOwner(db);
      const companyId = "db000000-0000-4000-8000-000000000001";
      const branchId = "db000000-0000-4000-8000-000000000002";
      const userId = "db000000-0000-4000-8000-000000000003";
      const userAssignmentId = "db000000-0000-4000-8000-000000000004";
      const departmentId = "db000000-0000-4000-8000-000000000005";
      const budgetId = "db000000-0000-4000-8000-000000000006";
      const budgetPeriodId = "db000000-0000-4000-8000-000000000007";
      const policyId = "db000000-0000-4000-8000-000000000008";
      const requestId = "db000000-0000-4000-8000-000000000009";
      const lineId = "db000000-0000-4000-8000-000000000010";
      const logoId = "db000000-0000-4000-8000-000000000011";
      const themeId = "db000000-0000-4000-8000-000000000012";
      const commandId = "db000000-0000-4000-8000-000000000013";
      const pendingHash = "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";

      await db.exec("SET session_replication_role=replica");
      await db.query(`INSERT INTO companies
        SELECT (jsonb_populate_record(NULL::companies,
          to_jsonb(source)||jsonb_build_object(
            'id',$1::uuid,'company_code','TEST-CASCADE','name','TEST disposable company',
            'legal_name','TEST disposable company','created_by',$2::uuid,'active',true,
            'lifecycle_status','ACTIVE','portal_access_enabled',true))).*
        FROM companies source WHERE source.id='10000000-0000-4000-8000-000000000001'`, [companyId, ownerId]);
      await db.query(`INSERT INTO branches
        SELECT (jsonb_populate_record(NULL::branches,
          to_jsonb(source)||jsonb_build_object(
            'id',$1::uuid,'company_id',$2::uuid,'branch_code_id','TEST-CASCADE-BRANCH',
            'branch_code','TEST-CASCADE-BRANCH','name','Disposable branch'))).*
        FROM branches source WHERE source.id='20000000-0000-4000-8000-000000000001'`, [branchId, companyId]);
      await db.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,account_kind,account_status,account_setup_completed_at)
        SELECT $1,'disposable@fixture.invalid','Disposable member',$2,id,$3,'COMPANY','INVITED',NULL
        FROM roles WHERE role_key='COMPANY_ADMIN'`, [userId, pendingHash, companyId]);
      await db.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,active,assigned_by)
        SELECT $1,$2,id,'COMPANY',$3,true,$4 FROM roles WHERE role_key='COMPANY_ADMIN'`, [userAssignmentId, userId, companyId, ownerId]);
      await db.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,repeat('a',64),now()+interval '1 day')", [userId]);
      await db.query(`INSERT INTO account_setup_invitations(user_id,company_id,token_hash,expires_at,created_by,intended_role_id,intended_scope_type)
        SELECT $1,$2,repeat('b',64),now()+interval '1 day',$3,id,'COMPANY' FROM roles WHERE role_key='COMPANY_ADMIN'`, [userId, companyId, ownerId]);
      await db.query("INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at,created_by) VALUES($1,$2,'ACTIVE',true,now(),$3)", [userId, companyId, ownerId]);
      await db.query("INSERT INTO departments(id,company_id,branch_id,department_code,name,created_by) VALUES($1,$2,$3,'TEST-D','Disposable department',$4)", [departmentId, companyId, branchId, ownerId]);
      await db.query(`INSERT INTO budget_accounts
        SELECT (jsonb_populate_record(NULL::budget_accounts,
          to_jsonb(source)||jsonb_build_object('id',$1::uuid,'company_id',$2::uuid,
            'parent_account_id',NULL,'level_type','COMPANY','branch_id',NULL,'department_id',NULL,
            'cost_centre_id',NULL,'account_code','TEST-BUDGET','name','Disposable budget'))).*
        FROM budget_accounts source WHERE source.company_id='10000000-0000-4000-8000-000000000001' LIMIT 1`, [budgetId, companyId]);
      await db.query(`INSERT INTO budget_periods
        SELECT (jsonb_populate_record(NULL::budget_periods,
          to_jsonb(source)||jsonb_build_object('id',$1::uuid,'company_id',$2::uuid,
            'budget_account_id',$3::uuid,'previous_period_id',NULL,'schedule_id',NULL,
            'schedule_version',NULL,'period_name','Disposable period'))).*
        FROM budget_periods source WHERE source.company_id='10000000-0000-4000-8000-000000000001' LIMIT 1`, [budgetPeriodId, companyId, budgetId]);
      await db.query(`INSERT INTO request_approval_policies
        SELECT (jsonb_populate_record(NULL::request_approval_policies,
          to_jsonb(source)||jsonb_build_object('id',$1::uuid,'company_id',$2::uuid,
            'name','Disposable policy','created_by',$3::uuid))).*
        FROM request_approval_policies source WHERE source.company_id='10000000-0000-4000-8000-000000000001' LIMIT 1`, [policyId, companyId, ownerId]);
      await db.query(`INSERT INTO requests
        SELECT (jsonb_populate_record(NULL::requests,
          to_jsonb(source)||jsonb_build_object('id',$1::uuid,'order_code','TEST-REQUEST',
            'company_id',$2::uuid,'branch_id',$3::uuid,'department_id',$4::uuid,'budget_account_id',$5::uuid,
            'budget_period_id',$6::uuid,'approval_policy_id',$7::uuid,'created_by',$8::uuid,
            'client_submission_key','db000000-0000-4000-8000-000000000014'))).*
        FROM requests source WHERE source.id='50000000-0000-4000-8000-000000000001'`, [requestId, companyId, branchId, departmentId, budgetId, budgetPeriodId, policyId, userId]);
      await db.query(`INSERT INTO request_lines
        SELECT (jsonb_populate_record(NULL::request_lines,
          to_jsonb(source)||jsonb_build_object('id',$1::uuid,
            'request_line_code','TEST-REQUEST-LINE','request_id',$2::uuid))).*
        FROM request_lines source WHERE source.id='60000000-0000-4000-8000-000000000001'`, [lineId, requestId]);
      await db.query("INSERT INTO company_logos(id,company_id,version,file_name,content_type,logo_content,sha256,width,height,active,uploaded_by) VALUES($1,$2,1,'fixture.png','image/png',decode('89504e47','hex'),repeat('c',64),1,1,true,$3)", [logoId, companyId, ownerId]);
      await db.query(`INSERT INTO company_brand_themes(id,company_id,source_logo_id,version,algorithm_version,
          primary_color,secondary_color,accent_color,primary_foreground,secondary_foreground,
          page_background,surface_color,muted_surface,border_color,success_color,warning_color,
          danger_color,focus_ring,link_color,chart_colors,created_by)
        VALUES($1,$2,$3,1,'fixture','#174F42','#276B5D','#D99B2B','#FFFFFF','#FFFFFF',
          '#F5F7F6','#FFFFFF','#EDF3F1','#CCD8D4','#14804A','#9A6700','#B42318','#174F42','#174F42',
          ARRAY['#174F42','#276B5D','#D99B2B'],$4)`, [themeId, companyId, logoId, ownerId]);
      await db.query("INSERT INTO in_app_notifications(company_id,recipient_user_id,event_key,dedupe_key,title,body,category,workflow_event_id,expires_at) VALUES($1,$2,'fixture.created','delete-fixture','Fixture','Fixture','WORKFLOW','db000000-0000-4000-8000-000000000015',now()+interval '1 day')", [companyId, userId]);
      await db.exec("SET session_replication_role=origin");

      const impact = (await db.query<{ value: { confirmation: string; recommendedMode: string; users: number; requests: number } }>(
        "SELECT axora_company_deletion_impact_v2($1,$2,$3,now()) AS value", [ownerId, ownerAssignmentId, companyId],
      )).rows[0]!.value;
      expect(impact).toMatchObject({ recommendedMode: "HARD_DELETE", users: 1, requests: 1 });
      const deleted = await db.query<{ value: Record<string, unknown> }>(
        "SELECT axora_delete_or_archive_company_v2($1,$2,$3,$4,$5,$6,now()) AS value",
        [ownerId, ownerAssignmentId, companyId, commandId, impact.confirmation, "Remove disposable TEST fixture"],
      );
      const repeated = await db.query<{ value: Record<string, unknown> }>(
        "SELECT axora_delete_or_archive_company_v2($1,$2,$3,$4,$5,$6,now()) AS value",
        [ownerId, ownerAssignmentId, companyId, commandId, impact.confirmation, "Remove disposable TEST fixture"],
      );
      expect(repeated.rows[0]?.value).toEqual(deleted.rows[0]?.value);
      const gone = await db.query<{ companies: number; users: number; branches: number; departments: number; requests: number; budgets: number; invitations: number; sessions: number; notifications: number; themes: number; other_tenant: number; tombstones: number }>(`
        SELECT
          (SELECT count(*)::int FROM companies WHERE id=$1) AS companies,
          (SELECT count(*)::int FROM users WHERE company_id=$1) AS users,
          (SELECT count(*)::int FROM branches WHERE company_id=$1) AS branches,
          (SELECT count(*)::int FROM departments WHERE company_id=$1) AS departments,
          (SELECT count(*)::int FROM requests WHERE company_id=$1) AS requests,
          (SELECT count(*)::int FROM budget_accounts WHERE company_id=$1) AS budgets,
          (SELECT count(*)::int FROM account_setup_invitations WHERE company_id=$1) AS invitations,
          (SELECT count(*)::int FROM user_sessions WHERE user_id=$2) AS sessions,
          (SELECT count(*)::int FROM in_app_notifications WHERE company_id=$1) AS notifications,
          (SELECT count(*)::int FROM company_brand_themes WHERE company_id=$1) AS themes,
          (SELECT count(*)::int FROM companies WHERE id='10000000-0000-4000-8000-000000000001') AS other_tenant,
          (SELECT count(*)::int FROM company_deletion_tombstones WHERE company_id=$1) AS tombstones
      `, [companyId, userId]);
      expect(gone.rows[0]).toEqual({ companies: 0, users: 0, branches: 0, departments: 0, requests: 0, budgets: 0, invitations: 0, sessions: 0, notifications: 0, themes: 0, other_tenant: 1, tombstones: 1 });

      const protectedCompanyId = "10000000-0000-4000-8000-000000000002";
      const protectedImpact = (await db.query<{ value: { confirmation: string; recommendedMode: string; protectedEvidence: number } }>(
        "SELECT axora_company_deletion_impact_v2($1,$2,$3,now()) AS value", [ownerId, ownerAssignmentId, protectedCompanyId],
      )).rows[0]!.value;
      expect(protectedImpact.recommendedMode).toBe("ARCHIVE_RETAIN");
      expect(protectedImpact.protectedEvidence).toBeGreaterThan(0);
      const invoiceCount = (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM invoices WHERE company_id=$1", [protectedCompanyId])).rows[0]!.count;
      await db.query(
        "SELECT axora_delete_or_archive_company_v2($1,$2,$3,$4,$5,$6,now())",
        [ownerId, ownerAssignmentId, protectedCompanyId, "dc000000-0000-4000-8000-000000000001", protectedImpact.confirmation, "Retain protected evidence"],
      );
      const retained = await db.query<{ active: boolean; lifecycle_status: string; invoices: number; tombstones: number }>(`
        SELECT company.active,company.lifecycle_status,
          (SELECT count(*)::int FROM invoices WHERE company_id=company.id) AS invoices,
          (SELECT count(*)::int FROM company_deletion_tombstones WHERE company_id=company.id) AS tombstones
        FROM companies company WHERE company.id=$1
      `, [protectedCompanyId]);
      expect(retained.rows[0]).toEqual({ active: false, lifecycle_status: "ARCHIVED", invoices: invoiceCount, tombstones: 1 });
    } finally {
      await db.close();
    }
  }, 30_000);
});
