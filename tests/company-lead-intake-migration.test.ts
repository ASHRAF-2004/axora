import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/052_company_lead_intake.sql",
  import.meta.url,
);

const ids = {
  owner: "52000000-0000-4000-8000-000000000001",
  managerA: "52000000-0000-4000-8000-000000000002",
  managerB: "52000000-0000-4000-8000-000000000003",
  ownerAssignment: "52000000-0000-4000-8000-000000000011",
  managerAssignmentA: "52000000-0000-4000-8000-000000000012",
  managerAssignmentB: "52000000-0000-4000-8000-000000000013",
} as const;

interface SnapshotRow { snapshot: Record<string, unknown> | null }

async function fixture(withAppRole = false) {
  const db = new PGlite();
  await applyMigrations(db, { through: "051_company_lifecycle.sql" });
  await applyDemoSeed(db);
  if (withAppRole) await db.exec("CREATE ROLE axora_app NOLOGIN");
  await db.exec(await readFile(migrationUrl, "utf8"));
  const base = await db.query<{ id: string }>(
    "SELECT id::text FROM companies WHERE active ORDER BY id LIMIT 1",
  );
  const companyId = base.rows[0]?.id;
  if (!companyId) throw new Error("Company lead fixture requires an active company");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-052@example.test','Lead Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,
        now(),'PLATFORM','ACTIVE',true,1),
      ($2,'manager-a-052@example.test','Lead Manager A','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($3,'manager-b-052@example.test','Lead Manager B','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner, ids.managerA, ids.managerB]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by
    ) VALUES
      ($1,$4,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
        'PLATFORM',NULL,true,$4),
      ($2,$5,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$7,true,$4),
      ($3,$6,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$7,true,$4)
  `, [ids.ownerAssignment, ids.managerAssignmentA, ids.managerAssignmentB,
    ids.owner, ids.managerA, ids.managerB, companyId]);
  return db;
}

function payload(suffix: string, overrides: Record<string, unknown> = {}) {
  const at = new Date();
  return {
    idempotencyKey: createHash("sha256").update(suffix).digest("hex"),
    locale: "en",
    contactName: `Lead Contact ${suffix}`,
    contactEmail: `contact-${suffix}@company-${suffix}.example`,
    companyName: `Lead Company ${suffix}`,
    companyLegalName: `Lead Company ${suffix} Sdn Bhd`,
    registrationNumber: `REG-052-${suffix}`,
    phoneCountryCode: "+60",
    phone: `12345${suffix}`,
    country: "Malaysia",
    region: "Selangor",
    city: "Shah Alam",
    industry: "Manufacturing",
    employeeRange: "51_200",
    branchRange: "2_5",
    spendRange: "50K_250K",
    contactMethod: "EMAIL",
    contactTime: "Weekday mornings",
    contactTimezone: "Asia/Kuala_Lumpur",
    subject: `Procurement enquiry ${suffix}`,
    message: `A complete procurement enquiry message for ${suffix}.`,
    privacyPolicyVersion: "public-enquiry-2026-08-08",
    sourcePage: "/en/contact",
    sourceMetadata: { source: "website", campaign: "meeting" },
    networkRateKey: "b".repeat(64),
    senderRateKey: "c".repeat(64),
    turnstileChallengeAt: at.toISOString(),
    turnstileHostname: "axora.management",
    ...overrides,
  };
}

async function submit(db: PGlite, input: Record<string, unknown>, at = new Date()) {
  const result = await db.query<SnapshotRow>(
    "SELECT axora_record_public_company_lead($1::jsonb,$2) AS snapshot",
    [JSON.stringify(input), at],
  );
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot) throw new Error("Company lead submission failed");
  return snapshot;
}

async function workspace(db: PGlite, actorId: string, assignmentId: string) {
  const result = await db.query<SnapshotRow>(
    "SELECT axora_company_lead_workspace($1,$2,'{}'::jsonb,now()) AS snapshot",
    [actorId, assignmentId],
  );
  return result.rows[0]?.snapshot as { leads: Array<Record<string, unknown>> } | null;
}

describe("company lead intake migration", () => {
  it("creates one durable lead per idempotency key and preserves duplicate interactions", async () => {
    const db = await fixture();
    try {
      const input = payload("duplicate");
      const first = await submit(db, input);
      const retry = await submit(db, input);
      const second = await submit(db, payload("second", {
        contactEmail: input.contactEmail,
        companyName: input.companyName,
        companyLegalName: input.companyLegalName,
        registrationNumber: input.registrationNumber,
        phone: input.phone,
        message: "A distinct follow-up message that must never be discarded.",
      }));
      expect(first.created).toBe(true);
      expect(retry).toMatchObject({ created: false, leadId: first.leadId, submissionId: first.submissionId });
      expect(second.created).toBe(true);
      expect(second.leadId).not.toBe(first.leadId);
      const state = await db.query<{
        leads: number; submissions: number; candidates: number; message: string;
      }>(`
        SELECT (SELECT count(*)::int FROM company_leads) AS leads,
          (SELECT count(*)::int FROM public_contact_submissions) AS submissions,
          (SELECT count(*)::int FROM company_lead_duplicate_candidates
            WHERE lead_id=$1) AS candidates,
          (SELECT message FROM public_contact_submissions WHERE lead_id=$1) AS message
      `, [second.leadId]);
      expect(state.rows[0]?.leads).toBe(2);
      expect(state.rows[0]?.submissions).toBe(2);
      expect(state.rows[0]?.candidates).toBeGreaterThan(0);
      expect(state.rows[0]?.message).toContain("must never be discarded");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("filters before rows leave PostgreSQL and audits assignment, view, and timeline mutations", async () => {
    const db = await fixture();
    try {
      const created = await submit(db, payload("authorization"));
      expect((await workspace(db, ids.owner, ids.ownerAssignment))?.leads).toHaveLength(1);
      expect((await workspace(db, ids.managerA, ids.managerAssignmentA))?.leads).toHaveLength(0);
      await db.query(`SELECT axora_assign_company_lead(
        $1,$2,$3,$4,'Assigned for secure follow-up',now()
      )`, [ids.owner, ids.ownerAssignment, created.leadId, ids.managerA]);
      expect((await workspace(db, ids.managerA, ids.managerAssignmentA))?.leads).toHaveLength(1);
      expect((await workspace(db, ids.managerB, ids.managerAssignmentB))?.leads).toHaveLength(0);
      await expect(db.query(`SELECT axora_transition_company_lead(
        $1,$2,$3,'CONTACTED','Unauthorized contact attempt',now()
      )`, [ids.managerB, ids.managerAssignmentB, created.leadId])).rejects.toThrow("unavailable");
      await db.query(`SELECT axora_transition_company_lead(
        $1,$2,$3,'CONTACTED','Customer contacted by account manager',now()
      )`, [ids.managerA, ids.managerAssignmentA, created.leadId]);
      await db.query(`SELECT axora_add_company_lead_note(
        $1,$2,$3,'CONTACT_ATTEMPT','Discussed onboarding requirements',now()
      )`, [ids.managerA, ids.managerAssignmentA, created.leadId]);
      const evidence = await db.query<{ views: number; events: number; history: number }>(`
        SELECT
          (SELECT count(*)::int FROM company_lead_access_events WHERE lead_id=$1) AS views,
          (SELECT count(*)::int FROM company_lead_events WHERE lead_id=$1) AS events,
          (SELECT count(*)::int FROM company_lead_status_history WHERE lead_id=$1) AS history
      `, [created.leadId]);
      expect(evidence.rows[0]?.views).toBeGreaterThan(0);
      expect(evidence.rows[0]?.events).toBeGreaterThanOrEqual(4);
      expect(evidence.rows[0]?.history).toBe(3);
      await expect(db.query(
        "UPDATE company_lead_notes SET note='rewritten' WHERE lead_id=$1",
        [created.leadId],
      )).rejects.toThrow("append-only");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("converts only a qualified, duplicate-cleared lead and retains the assigned manager", async () => {
    const db = await fixture();
    try {
      const created = await submit(db, payload("conversion"));
      await db.query(`SELECT axora_assign_company_lead(
        $1,$2,$3,$4,'Assigned for qualification',now()
      )`, [ids.owner, ids.ownerAssignment, created.leadId, ids.managerA]);
      await db.query(`SELECT axora_transition_company_lead(
        $1,$2,$3,'CONTACTED','Company contact completed',now()
      )`, [ids.managerA, ids.managerAssignmentA, created.leadId]);
      await db.query(`SELECT axora_transition_company_lead(
        $1,$2,$3,'QUALIFIED','Company meets onboarding criteria',now()
      )`, [ids.managerA, ids.managerAssignmentA, created.leadId]);
      const converted = await db.query<SnapshotRow>(`SELECT axora_convert_company_lead(
        $1,$2,$3,'Approved for controlled onboarding',now()
      ) AS snapshot`, [ids.owner, ids.ownerAssignment, created.leadId]);
      expect(converted.rows[0]?.snapshot).toMatchObject({ status: "CONVERTED" });
      const state = await db.query<{
        status: string; companyId: string; lifecycle: string; managerCount: number;
      }>(`
        SELECT lead.status,lead.converted_company_id::text AS "companyId",
          company.lifecycle_status AS lifecycle,
          (SELECT count(*)::int FROM company_assignments assignment
            WHERE assignment.company_id=company.id AND assignment.status='ACTIVE'
              AND assignment.manager_user_id=$2) AS "managerCount"
        FROM company_leads lead
        JOIN companies company ON company.id=lead.converted_company_id
        WHERE lead.id=$1
      `, [created.leadId, ids.managerA]);
      expect(state.rows[0]).toMatchObject({ status: "CONVERTED", lifecycle: "ASSIGNED", managerCount: 1 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps lead evidence when email fails and exposes only least-privilege capabilities", async () => {
    const db = await fixture(true);
    try {
      const created = await submit(db, payload("email-outage"));
      await db.query(`
        INSERT INTO transactional_email_outbox(message_kind,contact_submission_id,locale)
        VALUES ('CONTACT_NOTIFICATION',$1,'en'),('CONTACT_ACKNOWLEDGEMENT',$1,'en')
      `, [created.submissionId]);
      await db.query(`
        UPDATE transactional_email_outbox SET delivery_status='FAILED',
          delivery_attempt_count=1,delivery_attempted_at=now(),
          last_delivery_error='provider_unavailable'
        WHERE contact_submission_id=$1
      `, [created.submissionId]);
      const durable = await db.query<{ leads: number; messages: number }>(`
        SELECT (SELECT count(*)::int FROM company_leads WHERE id=$1) AS leads,
          (SELECT count(*)::int FROM public_contact_submissions
            WHERE id=$2 AND message LIKE '%email-outage%') AS messages
      `, [created.leadId, created.submissionId]);
      expect(durable.rows[0]).toEqual({ leads: 1, messages: 1 });
      const privileges = await db.query<{
        intake: boolean; workspace: boolean; helper: boolean; tableRead: boolean; publicWorkspace: boolean;
      }>(`
        SELECT
          has_function_privilege('axora_app','axora_record_public_company_lead(jsonb,timestamptz)','EXECUTE') AS intake,
          has_function_privilege('axora_app','axora_company_lead_workspace(uuid,uuid,jsonb,timestamptz)','EXECUTE') AS workspace,
          has_function_privilege('axora_app','axora_company_lead_record(uuid,jsonb,uuid,timestamptz)','EXECUTE') AS helper,
          has_table_privilege('axora_app','company_leads','SELECT') AS "tableRead",
          has_function_privilege('public','axora_company_lead_workspace(uuid,uuid,jsonb,timestamptz)','EXECUTE') AS "publicWorkspace"
      `);
      expect(privileges.rows[0]).toEqual({
        intake: true, workspace: true, helper: false, tableRead: false, publicWorkspace: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
