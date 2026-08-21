import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "a7000000-0000-4000-8000-000000000001",
  camA: "a7000000-0000-4000-8000-000000000002",
  camB: "a7000000-0000-4000-8000-000000000003",
  ownerAssignment: "a7000000-0000-4000-8000-000000000011",
  camAssignmentA: "a7000000-0000-4000-8000-000000000012",
  camAssignmentB: "a7000000-0000-4000-8000-000000000013",
} as const;

interface LifecycleWorkspace {
  canViewAll: boolean;
  managers: Array<{ id: string }>;
  companies: Array<{
    id: string;
    primaryManager: { id: string } | null;
    availableActions: string[];
  }>;
}

interface LeadWorkspace {
  canViewAll: boolean;
  managers: Array<{ id: string }>;
  leads: Array<{
    id: string;
    status: string;
    availableActions: string[];
    assignment: { managerId: string } | null;
  }>;
}

async function createFixture() {
  const db = new PGlite();
  await applyMigrations(db, { through: "103_operating_model_company_and_location.sql" });
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-p7@example.test','Prompt 7 Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,
        now(),'PLATFORM','ACTIVE',true,1),
      ($2,'cam-a-p7@example.test','Prompt 7 CAM A','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($3,'cam-b-p7@example.test','Prompt 7 CAM B','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner, ids.camA, ids.camB]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by
    ) VALUES
      ($1,$4,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
        'PLATFORM',NULL,true,$4),
      ($2,$5,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'PLATFORM',NULL,true,$4),
      ($3,$6,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'PLATFORM',NULL,true,$4)
  `, [
    ids.ownerAssignment, ids.camAssignmentA, ids.camAssignmentB,
    ids.owner, ids.camA, ids.camB,
  ]);
  await db.query(`
    INSERT INTO user_profiles(
      user_id,display_name,preferred_locale,timezone,profile_completed_at
    ) VALUES
      ($1,'Prompt 7 Owner','en','Asia/Kuala_Lumpur',now()),
      ($2,'Prompt 7 CAM A','en','Asia/Kuala_Lumpur',now()),
      ($3,'Prompt 7 CAM B','en','Asia/Kuala_Lumpur',now())
  `, [ids.owner,ids.camA,ids.camB]);
  return db;
}

async function workspace(
  db: PGlite,
  userId: string,
  assignmentId: string,
) {
  const result = await db.query<{ snapshot: LifecycleWorkspace }>(`
    SELECT public.axora_company_lifecycle_workspace($1,$2,now()) AS snapshot
  `, [userId, assignmentId]);
  return result.rows[0]?.snapshot;
}

async function handover(db: PGlite, companyId: string, managerId: string) {
  await db.query(`
    SELECT public.axora_manage_company_assignment(
      $1,$2,$3,$4,'PRIMARY',NULL,NULL,'NORMAL',ARRAY[]::text[],
      'STANDARD',NULL,ARRAY[]::text[],
      'Prompt 7 accountable company handover',false,now()
    )
  `, [ids.owner, ids.ownerAssignment, companyId, managerId]);
}

describe("Prompt 7 company ownership operating model", () => {
  it("separates Contact Us, direct company ownership, and explicit CAM portfolio handover", async () => {
    const db = await createFixture();
    try {
      const capturedAt = new Date();
      const digest = (value: string) => createHash("sha256").update(value).digest("hex");
      const contact = await db.query<{ snapshot: { submissionId: string; created: boolean } }>(`
        SELECT public.axora_record_public_contact_submission($1::jsonb,$2) AS snapshot
      `, [{
        idempotencyKey: digest("prompt-7-contact"),
        locale: "en",
        contactName: "Public Enquiry",
        companyName: "Enquiry Trading",
        companyLegalName: "Enquiry Trading Sdn Bhd",
        city: "Kuala Lumpur",
        industry: "Business services",
        employeeRange: "11_50",
        branchRange: "2_5",
        spendRange: "50K_250K",
        contactMethod: "EMAIL",
        contactTimezone: "Asia/Kuala_Lumpur",
        subject: "Procurement platform enquiry",
        message: "Please provide information about Axora procurement services.",
        privacyPolicyVersion: "public-enquiry-2026-08-08",
        sourcePage: "/en/contact",
        sourceMetadata: { source: "prompt-7-test" },
        networkRateKey: digest("prompt-7-network"),
        senderRateKey: digest("prompt-7-sender"),
        turnstileChallengeAt: capturedAt.toISOString(),
        turnstileHostname: "axora.management",
      }, capturedAt]);
      expect(contact.rows[0]?.snapshot.created).toBe(true);

      const enquiryState = await db.query<{
        leadId: string | null;
        leadCount: number;
        contactEmail: string;
        registrationNumber: string;
        countryCode: string;
        phone: string | null;
        country: string;
        region: string;
        contactTime: string;
      }>(`
        SELECT submission.lead_id::text AS "leadId",
          (SELECT count(*)::int FROM company_leads) AS "leadCount",
          submission.contact_email AS "contactEmail",
          submission.company_registration_number AS "registrationNumber",
          submission.phone_country_code AS "countryCode",
          submission.phone,submission.country,submission.region,
          submission.preferred_contact_time AS "contactTime"
        FROM public_contact_submissions submission WHERE submission.id=$1
      `, [contact.rows[0]?.snapshot.submissionId]);
      expect(enquiryState.rows[0]).toEqual({
        leadId: null,
        leadCount: 0,
        contactEmail: "",
        registrationNumber: "",
        countryCode: "",
        phone: null,
        country: "",
        region: "",
        contactTime: "",
      });

      const creationCommandId = "a7000000-0000-4000-8000-000000000071";
      const logoSha256 = digest("owner-direct-company-logo");
      const direct = await db.query<{ snapshot: {
        companyId: string; created: boolean;
      } }>(`
        SELECT public.axora_create_company_direct(
          $1,$2,$3,$4,'Owner Direct Company','Owner Direct Company Sdn Bhd',
          'Business services','Direct owner-created customer company',NULL,
          'Company coordinator','Monthly','Created after reviewed enquiry',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, creationCommandId, logoSha256]);
      const companyId = direct.rows[0]?.snapshot.companyId;
      expect(companyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(direct.rows[0]?.snapshot.created).toBe(true);

      const replay = await db.query<{ snapshot: {
        companyId: string; created: boolean;
      } }>(`
        SELECT public.axora_create_company_direct(
          $1,$2,$3,$4,'Owner Direct Company','Owner Direct Company Sdn Bhd',
          'Business services','Direct owner-created customer company',NULL,
          'Company coordinator','Monthly','Created after reviewed enquiry',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, creationCommandId, logoSha256]);
      expect(replay.rows[0]?.snapshot).toMatchObject({ companyId, created: false });

      const conflict = await db.query<{ snapshot: { status: string } }>(`
        SELECT public.axora_create_company_direct(
          $1,$2,$3,$4,'Different Company','Owner Direct Company Sdn Bhd',
          'Business services','Direct owner-created customer company',NULL,
          'Company coordinator','Monthly','Created after reviewed enquiry',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, creationCommandId, logoSha256]);
      expect(conflict.rows[0]?.snapshot).toEqual({ status: "COMMAND_CONFLICT" });

      const companyState = await db.query<{
        status: string;
        registrationNumber: string;
        contactEmail: string;
        contactPhone: string;
        assignments: number;
      }>(`
        SELECT lifecycle_status AS status,
          registration_number AS "registrationNumber",
          main_contact_email AS "contactEmail",
          main_contact_phone AS "contactPhone",
          (SELECT count(*)::int FROM company_assignments assignment
            WHERE assignment.company_id=company.id AND assignment.status='ACTIVE')
            AS assignments
        FROM companies company WHERE id=$1
      `, [companyId]);
      expect(companyState.rows[0]).toMatchObject({
        status: "ONBOARDING",
        registrationNumber: "",
        contactEmail: "",
        contactPhone: "",
        assignments: 0,
      });

      await db.query(`
        UPDATE companies SET billing_contact_phone='Historical billing phone'
        WHERE id=$1
      `, [companyId]);
      await db.query(`
        SELECT public.axora_save_company_onboarding(
          $1,$2,$3,1,'Owner Direct Company Sdn Bhd','','MY','TAX-P7',
          'TECHNOLOGY',NULL,'Registered address','Operating address',
          'Company coordinator','','','Billing coordinator','billing@example.test',
          'Retired replacement must be ignored','Billing address','Monthly',
          'en','Asia/Kuala_Lumpur','CONTACTS',ARRAY['LEGAL_IDENTITY','INDUSTRY'],
          'Preserve retired historical company contact evidence',now()
        )
      `, [ids.owner, ids.ownerAssignment, companyId]);
      const preservedPhone = await db.query<{ value: string }>(`
        SELECT billing_contact_phone AS value FROM companies WHERE id=$1
      `, [companyId]);
      expect(preservedPhone.rows[0]?.value).toBe("Historical billing phone");

      const ownerBefore = await workspace(db, ids.owner, ids.ownerAssignment);
      const camABefore = await workspace(db, ids.camA, ids.camAssignmentA);
      const camBBefore = await workspace(db, ids.camB, ids.camAssignmentB);
      expect(ownerBefore?.canViewAll).toBe(true);
      expect(ownerBefore?.companies.some((company) => company.id === companyId)).toBe(true);
      expect(camABefore?.companies.some((company) => company.id === companyId)).toBe(false);
      expect(camBBefore?.companies.some((company) => company.id === companyId)).toBe(false);
      expect(camABefore?.managers).toEqual([]);
      expect(camBBefore?.managers).toEqual([]);

      await handover(db, companyId, ids.camA);
      const camAAfter = await workspace(db, ids.camA, ids.camAssignmentA);
      const camBAfter = await workspace(db, ids.camB, ids.camAssignmentB);
      expect(camAAfter?.companies.some((company) => company.id === companyId)).toBe(true);
      expect(camBAfter?.companies.some((company) => company.id === companyId)).toBe(false);
      expect(camAAfter?.managers).toEqual([]);
      expect(camAAfter?.companies.find((company) => company.id === companyId)
        ?.availableActions).not.toEqual(expect.arrayContaining([
        "ASSIGN", "REASSIGN", "ADD_BACKUP", "REPLACE_BACKUP",
      ]));

      await expect(db.query(`
        SELECT public.axora_manage_company_assignment(
          $1,$2,$3,$4,'BACKUP',now(),now()+interval '1 day','TEMPORARY',
          ARRAY[]::text[],'STANDARD',NULL,ARRAY[]::text[],
          'Assigned CAM must not expand the company portfolio',false,now()
        )
      `, [ids.camA, ids.camAssignmentA, companyId, ids.camB]))
        .rejects.toThrow(/assignment is unavailable/i);

      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id=(SELECT id FROM roles
          WHERE role_key='CLIENT_ACCOUNT_MANAGER')
          AND permission_id=(SELECT id FROM permissions
            WHERE permission_code='company.edit');
      `);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,company_id,active,reason,changed_by
        ) VALUES (
          $1,(SELECT id FROM permissions WHERE permission_code='company.edit'),
          'GRANT','COMPANY',$2,true,'Delegated company onboarding edit',$3
        )
      `, [ids.camA, companyId, ids.owner]);
      const granted = await db.query<{
        allowed: boolean; baseAllowed: boolean; coverageAllowed: boolean;
        snapshot: Record<string, unknown>;
      }>(`
        SELECT public.axora_company_actor_has_permission(snapshot,$1,$3,
            'company.edit',now()) AS allowed,
          public.axora_snapshot_has_permission_base(snapshot,
            'company.edit','COMPANY',$3,NULL,NULL,NULL) AS "baseAllowed",
          public.axora_company_assignment_allows_permission(
            $1,$3,'company.edit',now()) AS "coverageAllowed",
          snapshot
        FROM (SELECT public.axora_live_authorization_snapshot(
          $1,$2,now()) AS snapshot) authorized
      `, [ids.camA, ids.camAssignmentA, companyId]);
      expect(granted.rows[0]).toMatchObject({
        allowed: true,baseAllowed: true,coverageAllowed: true,
      });
      await db.query(`
        UPDATE user_permission_overrides SET effect='DENY',
          reason='Delegated company onboarding edit withdrawn'
        WHERE user_id=$1 AND company_id=$2
          AND permission_id=(SELECT id FROM permissions
            WHERE permission_code='company.edit')
      `, [ids.camA, companyId]);
      const denied = await db.query<{ allowed: boolean }>(`
        SELECT public.axora_company_actor_has_permission(
          public.axora_live_authorization_snapshot($1,$2,now()),
          $1,$3,'company.edit',now()
        ) AS allowed
      `, [ids.camA, ids.camAssignmentA, companyId]);
      expect(denied.rows[0]?.allowed).toBe(false);

      await handover(db, companyId, ids.camB);
      await db.query(`
        UPDATE user_permission_overrides SET effect='GRANT',
          reason='Grant remains bounded by live company coverage'
        WHERE user_id=$1 AND company_id=$2
          AND permission_id=(SELECT id FROM permissions
            WHERE permission_code='company.edit')
      `, [ids.camA, companyId]);
      const unassignedGrant = await db.query<{ allowed: boolean }>(`
        SELECT public.axora_company_actor_has_permission(
          public.axora_live_authorization_snapshot($1,$2,now()),
          $1,$3,'company.edit',now()
        ) AS allowed
      `, [ids.camA, ids.camAssignmentA, companyId]);
      expect(unassignedGrant.rows[0]?.allowed).toBe(false);
      const camAReassigned = await workspace(db, ids.camA, ids.camAssignmentA);
      const camBReassigned = await workspace(db, ids.camB, ids.camAssignmentB);
      const ownerAfter = await workspace(db, ids.owner, ids.ownerAssignment);
      expect(camAReassigned?.companies.some((company) => company.id === companyId)).toBe(false);
      expect(camBReassigned?.companies.some((company) => company.id === companyId)).toBe(true);
      expect(ownerAfter?.companies.some((company) => company.id === companyId)).toBe(true);

      const assignmentState = await db.query<{ active: number; primary: string }>(`
        SELECT count(*)::int AS active,
          min(manager_user_id::text) AS primary
        FROM company_assignments
        WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE'
      `, [companyId]);
      expect(assignmentState.rows[0]).toEqual({ active: 1, primary: ids.camB });
      const mutationEvidence = await db.query<{
        companies: number; statusRows: number;
      }>(`
        SELECT count(*)::int AS companies,
          (SELECT count(*)::int FROM company_status_history history
            WHERE history.company_id=$1) AS "statusRows"
        FROM companies WHERE creation_command_id=$2
      `, [companyId, creationCommandId]);
      expect(mutationEvidence.rows[0]).toEqual({ companies: 1, statusRows: 1 });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("binds generic organization and company-user helpers to the CAM portfolio", async () => {
    const db = await createFixture();
    try {
      const companyA = "a7100000-0000-4000-8000-000000000001";
      const companyB = "a7100000-0000-4000-8000-000000000002";
      const branchA = "a7100000-0000-4000-8000-000000000011";
      const branchB = "a7100000-0000-4000-8000-000000000012";
      await db.query(`
        INSERT INTO companies(id,company_code,name,industry,active,created_by)
        VALUES
          ($1,'P7-PORTFOLIO-A','Prompt 7 Portfolio A','Services',true,$3),
          ($2,'P7-PORTFOLIO-B','Prompt 7 Portfolio B','Services',true,$3)
      `,[companyA,companyB,ids.owner]);
      await db.query(`
        INSERT INTO branches(
          id,branch_code_id,company_id,name,branch_code,delivery_address,city,active
        ) VALUES
          ($3,'P7-BRANCH-A',$1,'Portfolio A branch','PORT-A',
            'Original A address','Kuala Lumpur',true),
          ($4,'P7-BRANCH-B',$2,'Portfolio B branch','PORT-B',
            'Original B address','Shah Alam',true)
      `,[companyA,companyB,branchA,branchB]);
      await handover(db,companyA,ids.camA);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,active,reason,changed_by
        ) VALUES (
          $1,(SELECT id FROM permissions
            WHERE permission_code='organization.delivery_location.manage'),
          'GRANT','PLATFORM',true,
          'Test delivery-location capability without widening CAM portfolio',$2
        )
      `,[ids.camA,ids.owner]);

      const directory = await db.query<{ snapshot: {
        companies: Array<{ id: string }>;
        branches: Array<{ id: string }>;
      } }>(`
        SELECT public.axora_organization_directory_snapshot($1,$2,now())
          AS snapshot
      `,[ids.camA,ids.camAssignmentA]);
      expect(directory.rows[0]!.snapshot.companies.map((company) => company.id))
        .toContain(companyA);
      expect(directory.rows[0]!.snapshot.companies.map((company) => company.id))
        .not.toContain(companyB);
      expect(directory.rows[0]!.snapshot.branches.map((branch) => branch.id))
        .toContain(branchA);
      expect(directory.rows[0]!.snapshot.branches.map((branch) => branch.id))
        .not.toContain(branchB);

      const access = await db.query<{
        allowedCompany: unknown; deniedCompany: unknown;
        allowedBranch: unknown; deniedBranch: unknown;
        allowedUserCreation: unknown; deniedUserCreation: unknown;
        allowedLocation: unknown; deniedLocation: unknown;
      }>(`
        SELECT
          public.axora_organization_resource_access(
            $1,$2,'company.view.assigned','COMPANY',$3,now()
          ) AS "allowedCompany",
          public.axora_organization_resource_access(
            $1,$2,'company.view.assigned','COMPANY',$4,now()
          ) AS "deniedCompany",
          public.axora_organization_resource_access(
            $1,$2,'organization.branch.view','BRANCH',$5,now()
          ) AS "allowedBranch",
          public.axora_organization_resource_access(
            $1,$2,'organization.branch.view','BRANCH',$6,now()
          ) AS "deniedBranch",
          public.axora_lock_user_creation_scope(
            $1,$2,'COMPANY_ADMIN','COMPANY',$3,NULL,NULL,NULL,now()
          ) AS "allowedUserCreation",
          public.axora_lock_user_creation_scope(
            $1,$2,'COMPANY_ADMIN','COMPANY',$4,NULL,NULL,NULL,now()
          ) AS "deniedUserCreation",
          public.axora_branch_delivery_location_workspace($1,$2,$5,now())
            AS "allowedLocation",
          public.axora_branch_delivery_location_workspace($1,$2,$6,now())
            AS "deniedLocation"
      `,[ids.camA,ids.camAssignmentA,companyA,companyB,branchA,branchB]);
      expect(access.rows[0]).toMatchObject({
        allowedCompany: { resourceId: companyA },
        deniedCompany: null,
        allowedBranch: { resourceId: branchA },
        deniedBranch: null,
        allowedUserCreation: { scope: { type: "COMPANY",companyId: companyA } },
        deniedUserCreation: null,
        allowedLocation: { companyId: companyA,branchId: branchA,canManage: true },
        deniedLocation: null,
      });
      await expect(db.query(`
        SELECT public.axora_save_branch_delivery_location(
          $1,$2,$3,'Forged unrelated destination',3.100000,101.600000,
          'Unrelated branch','Must fail outside CAM portfolio',$4,now()
        )
      `,[
        ids.camA,ids.camAssignmentA,branchB,
        "a7100000-0000-4000-8000-000000000021",
      ])).rejects.toThrow(/location is unavailable/i);
      await db.query(`
        SELECT public.axora_save_branch_delivery_location(
          $1,$2,$3,'Authorized portfolio destination',3.139000,101.686900,
          'Use the controlled entrance','Assigned CAM location update',$4,now()
        )
      `,[
        ids.camA,ids.camAssignmentA,branchA,
        "a7100000-0000-4000-8000-000000000022",
      ]);
      const ownerDirectory = await db.query<{ snapshot: {
        companies: Array<{ id: string }>;
      } }>(`
        SELECT public.axora_organization_directory_snapshot($1,$2,now())
          AS snapshot
      `,[ids.owner,ids.ownerAssignment]);
      expect(ownerDirectory.rows[0]!.snapshot.companies.map((company) => company.id))
        .toEqual(expect.arrayContaining([companyA,companyB]));
    } finally {
      await db.close();
    }
  }, 60_000);

  it("lets the Owner assign and progress a lead while CAM access stays assignment-bound", async () => {
    const db = await createFixture();
    try {
      const commandId = "a7000000-0000-4000-8000-000000000081";
      const created = await db.query<{ snapshot: { leadId: string } }>(`
        SELECT public.axora_create_acquisition_lead($1,$2,$3::jsonb,$4,now())
          AS snapshot
      `, [ids.owner,ids.ownerAssignment,{
        companyName: "Owner Managed Lead",
        legalName: "Owner Managed Lead Sdn Bhd",
        contactName: "Lead coordinator",
        city: "Kuala Lumpur",
        industry: "Business services",
        employeeRange: "11_50",
        branchRange: "2_5",
        spendRange: "50K_250K",
        locale: "en",
        timezone: "Asia/Kuala_Lumpur",
        subject: "Owner managed procurement opportunity",
        message: "The Platform Owner will manage this reviewed lead through conversion.",
      },commandId]);
      const leadId = created.rows[0]!.snapshot.leadId;

      const leadWorkspace = async (userId: string,assignmentId: string) =>
        (await db.query<{ snapshot: LeadWorkspace }>(`
          SELECT public.axora_company_lead_workspace($1,$2,'{}'::jsonb,now())
            AS snapshot
        `,[userId,assignmentId])).rows[0]!.snapshot;
      const ownerCreated = await leadWorkspace(ids.owner,ids.ownerAssignment);
      expect(ownerCreated.canViewAll).toBe(true);
      expect(ownerCreated.managers.map((manager) => manager.id)).toEqual(
        expect.arrayContaining([ids.camA,ids.camB]),
      );
      expect(ownerCreated.leads.find((lead) => lead.id === leadId)?.availableActions)
        .toEqual(expect.arrayContaining([
          "ASSIGN","MARK_CONTACTED","QUALIFY","ADD_NOTE","ADD_TASK",
        ]));
      expect((await leadWorkspace(ids.camA,ids.camAssignmentA)).leads)
        .toHaveLength(0);
      expect((await leadWorkspace(ids.camB,ids.camAssignmentB)).leads)
        .toHaveLength(0);

      const ownerLeadAuthority = await db.query<{
        owner: boolean; assignAllowed: boolean; rolePermissions: string[];
      }>(`
        SELECT public.axora_company_actor_is_owner(snapshot) AS owner,
          public.axora_snapshot_has_permission(
            snapshot,'company.lead.assign','PLATFORM',NULL,NULL,NULL,NULL
          ) AS "assignAllowed",
          ARRAY(SELECT jsonb_array_elements_text(snapshot->'rolePermissions'))
            AS "rolePermissions"
        FROM (SELECT public.axora_live_authorization_snapshot(
          $1,$2,now()
        ) AS snapshot) authorized
      `,[ids.owner,ids.ownerAssignment]);
      expect(ownerLeadAuthority.rows[0]?.rolePermissions)
        .toContain("company.lead.assign");
      expect(ownerLeadAuthority.rows[0]).toMatchObject({
        owner: true,assignAllowed: true,
      });

      await db.query(`
        SELECT public.axora_assign_company_lead(
          $1,$2,$3,$4,'Owner assigned reviewed lead for follow-up',now()
        )
      `,[ids.owner,ids.ownerAssignment,leadId,ids.camA]);
      expect((await leadWorkspace(ids.camA,ids.camAssignmentA)).leads[0])
        .toMatchObject({ id: leadId,status: "ASSIGNED",assignment: { managerId: ids.camA } });
      expect((await leadWorkspace(ids.camB,ids.camAssignmentB)).leads)
        .toHaveLength(0);
      await expect(db.query(`
        SELECT public.axora_transition_company_lead(
          $1,$2,$3,'CONTACTED','Forged transition outside CAM portfolio',now()
        )
      `,[ids.camB,ids.camAssignmentB,leadId]))
        .rejects.toThrow(/transition is unavailable/i);

      await db.query(`
        SELECT public.axora_add_company_lead_note(
          $1,$2,$3,'CONTACT_ATTEMPT','Owner recorded the first contact attempt.',now()
        )
      `,[ids.owner,ids.ownerAssignment,leadId]);
      await db.query(`
        SELECT public.axora_add_company_lead_task(
          $1,$2,$3,'Prepare qualification summary',now()+interval '1 day',$4,now()
        )
      `,[ids.owner,ids.ownerAssignment,leadId,ids.camA]);
      await db.query(`
        SELECT public.axora_transition_company_lead(
          $1,$2,$3,'CONTACTED','Owner confirmed the initial company contact',now()
        )
      `,[ids.owner,ids.ownerAssignment,leadId]);
      await db.query(`
        SELECT public.axora_transition_company_lead(
          $1,$2,$3,'QUALIFIED','Owner completed qualification review',now()
        )
      `,[ids.owner,ids.ownerAssignment,leadId]);
      const qualified = await leadWorkspace(ids.owner,ids.ownerAssignment);
      expect(qualified.leads.find((lead) => lead.id === leadId))
        .toMatchObject({ status: "QUALIFIED" });
      expect(qualified.leads.find((lead) => lead.id === leadId)?.availableActions)
        .toContain("CONVERT");

      const converted = await db.query<{
        snapshot: { leadId: string; status: string; companyId: string };
      }>(`
        SELECT public.axora_convert_company_lead(
          $1,$2,$3,'Owner approved conversion into canonical onboarding',now()
        ) AS snapshot
      `,[ids.owner,ids.ownerAssignment,leadId]);
      const companyId = converted.rows[0]!.snapshot.companyId;
      expect(converted.rows[0]!.snapshot).toMatchObject({
        leadId,status: "ONBOARDING",
      });
      const evidence = await db.query<{
        leadStatus: string;
        registrationNumber: string;
        email: string;
        phone: string;
        managerId: string;
        noteCount: number;
        taskCount: number;
      }>(`
        SELECT lead.status AS "leadStatus",
          company.registration_number AS "registrationNumber",
          company.main_contact_email AS email,
          company.main_contact_phone AS phone,
          assignment.manager_user_id::text AS "managerId",
          (SELECT count(*)::int FROM company_lead_notes note
            WHERE note.lead_id=lead.id) AS "noteCount",
          (SELECT count(*)::int FROM company_lead_tasks task
            WHERE task.lead_id=lead.id) AS "taskCount"
        FROM company_leads lead
        JOIN companies company ON company.id=lead.converted_company_id
        JOIN company_assignments assignment ON assignment.company_id=company.id
          AND assignment.assignment_type='PRIMARY' AND assignment.status='ACTIVE'
        WHERE lead.id=$1 AND company.id=$2
      `,[leadId,companyId]);
      expect(evidence.rows[0]).toEqual({
        leadStatus: "ONBOARDING",
        registrationNumber: "",
        email: "",
        phone: "",
        managerId: ids.camA,
        noteCount: 1,
        taskCount: 1,
      });
      expect((await workspace(db,ids.owner,ids.ownerAssignment)).companies
        .some((company) => company.id === companyId)).toBe(true);
      expect((await workspace(db,ids.camA,ids.camAssignmentA)).companies
        .some((company) => company.id === companyId)).toBe(true);
      expect((await workspace(db,ids.camB,ids.camAssignmentB)).companies
        .some((company) => company.id === companyId)).toBe(false);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("requires the Owner's live canonical company.create permission", async () => {
    const db = await createFixture();
    try {
      const creationDefaults = await db.query<{ roleKey: string }>(`
        SELECT role.role_key AS "roleKey"
        FROM role_permissions role_permission
        JOIN roles role ON role.id=role_permission.role_id
        JOIN permissions permission ON permission.id=role_permission.permission_id
        WHERE permission.permission_code='company.create'
          AND role.role_key IN ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER')
        ORDER BY role.role_key
      `);
      expect(creationDefaults.rows).toEqual([{ roleKey: "PLATFORM_OWNER" }]);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,active,reason,changed_by
        ) VALUES (
          $1,(SELECT id FROM permissions WHERE permission_code='company.create'),
          'DENY','PLATFORM',true,'Direct company creation temporarily withdrawn',$1
        )
      `, [ids.owner]);
      await expect(db.query(`
        SELECT public.axora_create_company_direct(
          $1,$2,$3,$4,'Denied Company','Denied Company Sdn Bhd',
          'Business services','Company creation must fail closed',NULL,
          'Company coordinator','Monthly',NULL,now()
        )
      `, [
        ids.owner,ids.ownerAssignment,
        "a7000000-0000-4000-8000-000000000072","b".repeat(64),
      ])).rejects.toThrow(/creation scope is unavailable/i);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("anonymizes Owner-created lead profile data without allowing ordinary rewrites", async () => {
    const db = await createFixture();
    try {
      const commandId = "a7000000-0000-4000-8000-000000000099";
      const created = await db.query<{ snapshot: { leadId: string } }>(`
        SELECT public.axora_create_acquisition_lead($1,$2,$3::jsonb,$4,now())
          AS snapshot
      `, [ids.owner,ids.ownerAssignment,{
        companyName: "Private Lead Company",
        legalName: "Private Lead Company Sdn Bhd",
        contactName: "Private Contact",
        city: "Shah Alam",
        industry: "Manufacturing",
        employeeRange: "11_50",
        branchRange: "2_5",
        spendRange: "50K_250K",
        locale: "en",
        timezone: "Asia/Kuala_Lumpur",
        subject: "Private procurement enquiry",
        message: "Private lead details that must be removed after retention.",
      },commandId]);
      const leadId = created.rows[0]!.snapshot.leadId;

      await expect(db.query(`
        UPDATE public.company_lead_profiles SET contact_name='Rewritten'
        WHERE lead_id=$1
      `, [leadId])).rejects.toThrow(/immutable/i);

      await db.exec("SET session_replication_role=replica");
      await db.query(`
        UPDATE public.company_leads SET status='ARCHIVED',
          created_at=now()-interval '3 years',
          sla_due_at=now()-interval '3 years'+interval '1 day',
          retention_until=now()-interval '1 day'
        WHERE id=$1
      `, [leadId]);
      await db.exec("SET session_replication_role=origin");

      await db.query(`
        SELECT public.axora_anonymize_company_lead(
          $1,$2,$3,'Retention period expired for owner-created lead',now()
        )
      `, [ids.owner,ids.ownerAssignment,leadId]);
      const profile = await db.query<{
        companyName: string; contactName: string; city: string;
        subject: string; message: string; anonymized: boolean;
      }>(`
        SELECT profile.company_name AS "companyName",
          profile.contact_name AS "contactName",profile.city,
          profile.subject,profile.message,
          lead.anonymized_at IS NOT NULL AS anonymized
        FROM public.company_lead_profiles profile
        JOIN public.company_leads lead ON lead.id=profile.lead_id
        WHERE profile.lead_id=$1
      `, [leadId]);
      expect(profile.rows[0]).toEqual({
        companyName: "Anonymized company",
        contactName: "Anonymized contact",
        city: "Removed",
        subject: "Anonymized lead",
        message: "Personal data removed under the company lead retention policy.",
        anonymized: true,
      });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("exposes both rollback-safe direct-create signatures without exposing private evidence", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "103_operating_model_company_and_location.sql" });
      const privileges = await db.query<{
        legacySignature: boolean;
        commandSignature: boolean;
        legacyExecute: boolean;
        commandExecute: boolean;
        publicCommandExecute: boolean;
        internalExecute: boolean;
        commandTableAccess: boolean;
        rowSecurity: boolean;
        forceRowSecurity: boolean;
      }>(`
        SELECT
          to_regprocedure(
            'public.axora_create_company_direct(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz)'
          ) IS NOT NULL AS "legacySignature",
          to_regprocedure(
            'public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz)'
          ) IS NOT NULL AS "commandSignature",
          has_function_privilege(
            'axora_app',
            'public.axora_create_company_direct(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "legacyExecute",
          has_function_privilege(
            'axora_app',
            'public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "commandExecute",
          has_function_privilege(
            'public',
            'public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "publicCommandExecute",
          has_function_privilege(
            'axora_app',
            'public.axora_create_company_record_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "internalExecute",
          has_table_privilege(
            'axora_app','public.branch_delivery_location_commands',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS "commandTableAccess",
          class.relrowsecurity AS "rowSecurity",
          class.relforcerowsecurity AS "forceRowSecurity"
        FROM pg_class class
        WHERE class.oid='public.branch_delivery_location_commands'::regclass
      `);
      expect(privileges.rows[0]).toEqual({
        legacySignature: true,
        commandSignature: true,
        legacyExecute: true,
        commandExecute: true,
        publicCommandExecute: false,
        internalExecute: false,
        commandTableAccess: false,
        rowSecurity: true,
        forceRowSecurity: true,
      });
    } finally {
      await db.close();
    }
  }, 60_000);
});
