import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAccountSetupDelivery,
  consumeAccountSetupToken,
  createInvitedUser,
  recordAccountSetupDelivery,
} from "@/lib/account-setup";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  assignCompanyLead,
  convertCompanyLead,
  loadCompanyLeadWorkspace,
  transitionCompanyLead,
} from "@/lib/company-leads";
import {
  activateCompany,
  assignCompanyManager,
  loadCompanyLifecycleWorkspace,
  setCompanyPublication,
  syncCompanyAdministrator,
  transitionCompanyLifecycle,
} from "@/lib/company-lifecycle";
import type { KnownUserRole } from "@/lib/types";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

interface PublicLeadResult {
  created: boolean;
  leadId: string;
  submissionId: string;
}

nativeDescribe("Prompt 6 company acquisition native PostgreSQL", () => {
  let admin: Client | undefined;
  let app: Client | undefined;
  let owner: AuthenticatedSessionUser;
  let managerA: AuthenticatedSessionUser;
  let managerB: AuthenticatedSessionUser;

  async function roleId(roleKey: KnownUserRole) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{ id: string }>(
      "SELECT id::text FROM public.roles WHERE role_key=$1",
      [roleKey],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`Role ${roleKey} is unavailable.`);
    return id;
  }

  async function createPlatformActor(
    label: string,
    role: "PLATFORM_OWNER" | "CLIENT_ACCOUNT_MANAGER",
    isOwner = false,
  ): Promise<AuthenticatedSessionUser> {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const userId = randomUUID();
    const assignmentId = randomUUID();
    const selectedRoleId = await roleId(role);
    const email = `prompt6-${label.toLowerCase()}-${userId}@example.test`;
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Prompt 6 ${label} fixture`,
      ]);
      await admin.query(
        `INSERT INTO public.users(
           id,email,display_name,password_hash,role_id,active,is_owner,
           company_id,branch_id,account_setup_completed_at,auth_version,
           account_kind,account_status,email_verified_at
         ) VALUES (
           $1,$2,$3,'not-a-real-hash',$4,true,$5,NULL,NULL,now(),1,
           'PLATFORM','ACTIVE',now()
         )`,
        [userId,email,`Prompt 6 ${label}`,selectedRoleId,isOwner],
      );
      await admin.query(
        `INSERT INTO public.user_profiles(
           user_id,display_name,preferred_locale,profile_completed_at
         ) VALUES ($1,$2,'en',now())`,
        [userId,`Prompt 6 ${label}`],
      );
      await admin.query(
        `INSERT INTO public.role_assignments(
           id,user_id,role_id,scope_type,company_id,branch_id,department_id,
           supplier_id,active,assigned_by,assigned_at
         ) VALUES ($1,$2,$3,'PLATFORM',NULL,NULL,NULL,NULL,true,$4,now())`,
        [assignmentId,userId,selectedRoleId,isOwner ? userId : owner.id],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return {
      id: userId,email,name: `Prompt 6 ${label}`,role,
      accountKind: "PLATFORM",scopeType: "PLATFORM",
      roleAssignmentId: assignmentId,isOwner,authVersion: 1,
      preferredLocale: "en",timezone: "Asia/Kuala_Lumpur",
    };
  }

  async function createPublicLead(label: string, idempotencySeed = randomUUID()) {
    if (!app) throw new Error("Native PostgreSQL application fixture is unavailable.");
    const now = new Date();
    const compact = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const input = {
      idempotencyKey: digest(`submission:${idempotencySeed}`),
      locale: "en",
      contactName: `Contact ${label}`,
      contactEmail: `${compact}@${digest(idempotencySeed).slice(0, 16)}.example.test`,
      companyName: `Prompt 6 ${label}`,
      companyLegalName: `Prompt 6 ${label} Sdn Bhd`,
      registrationNumber: `P6-${digest(label).slice(0, 18)}`,
      phoneCountryCode: "+60",
      phone: `1${digest(idempotencySeed).slice(0, 9)}`,
      country: "Malaysia",
      region: "Selangor",
      city: "Shah Alam",
      industry: "Technology",
      employeeRange: "11_50",
      branchRange: "2_5",
      spendRange: "50K_250K",
      contactMethod: "EMAIL",
      contactTime: "09:00",
      contactTimezone: "Asia/Kuala_Lumpur",
      subject: `Acquisition request ${label}`,
      message: `PRIVATE-ACQUISITION-${digest(label).slice(0, 16)} must remain internal.`,
      privacyPolicyVersion: "contact-privacy-2026-08-08",
      sourcePage: "/en/contact",
      sourceMetadata: { source: "prompt6-native" },
      networkRateKey: digest(`network:${idempotencySeed}`),
      senderRateKey: digest(`sender:${idempotencySeed}`),
      turnstileChallengeAt: now.toISOString(),
      turnstileHostname: "axora.management",
    };
    const result = await app.query<{ snapshot: PublicLeadResult }>(
      `SELECT public.axora_record_public_company_lead(
         $1::jsonb,$2::timestamptz
       ) AS snapshot`,
      [input,now],
    );
    const snapshot = result.rows[0]?.snapshot;
    if (!snapshot) throw new Error("Public company lead was not recorded.");
    return { snapshot,input,now };
  }

  async function prepareQualifiedLead(label: string, manager: AuthenticatedSessionUser) {
    const created = await createPublicLead(label);
    await assignCompanyLead(
      owner,created.snapshot.leadId,manager.id,"Assign acquisition follow-up owner",
    );
    await transitionCompanyLead(
      manager,created.snapshot.leadId,"CONTACTED","Contact completed with company representative",
    );
    await transitionCompanyLead(
      manager,created.snapshot.leadId,"QUALIFIED","Company requirements and identity qualified",
    );
    return created;
  }

  async function convertedCompany(label: string, manager: AuthenticatedSessionUser) {
    const lead = await prepareQualifiedLead(label,manager);
    await convertCompanyLead(
      manager,lead.snapshot.leadId,"Create the reviewed onboarding company",
    );
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{ companyId: string }>(
      `SELECT converted_company_id::text AS "companyId"
       FROM public.company_leads WHERE id=$1`,
      [lead.snapshot.leadId],
    );
    const companyId = result.rows[0]?.companyId;
    if (!companyId) throw new Error("Converted company reference is unavailable.");
    return { ...lead,companyId };
  }

  async function prepareActivationEvidence(companyId: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.user_id',$1,true)", [owner.id]);
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        "Prompt 6 activation evidence fixture",
      ]);
      await admin.query(
        `UPDATE public.company_onboarding_items
         SET status='PASSED',blocking_reason=NULL,completed_by=$2,
           completed_at=now(),exception_reason=NULL,exception_approved_by=NULL,
           exception_approved_at=NULL,exception_expires_at=NULL
         WHERE company_id=$1`,
        [companyId,owner.id],
      );
      await admin.query(
        `UPDATE public.companies
         SET verification_status='VERIFIED',verification_updated_at=now(),
           verification_updated_by=$2,updated_at=now()
         WHERE id=$1`,
        [companyId,owner.id],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }

  beforeAll(async () => {
    const port = Number.parseInt(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("AXORA_NATIVE_POSTGRES_PORT is invalid.");
    }
    const connection = {
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),port,
      database: requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE"),ssl: false,
    } as const;
    admin = new Client({
      ...connection,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
    });
    app = new Client({
      ...connection,
      user: requiredEnvironment("DB_USER"),password: requiredEnvironment("DB_PASSWORD"),
    });
    await admin.connect();
    await app.connect();
    owner = await createPlatformActor("Owner","PLATFORM_OWNER",true);
    managerA = await createPlatformActor("Manager A","CLIENT_ACCOUNT_MANAGER");
    managerB = await createPlatformActor("Manager B","CLIENT_ACCOUNT_MANAGER");
  }, 45_000);

  afterAll(async () => {
    if (global.__axoraPool) {
      await global.__axoraPool.end();
      global.__axoraPool = undefined;
    }
    await app?.end();
    await admin?.end();
  });

  it("persists one public lead and enforces owner assignment plus immediate manager isolation", async () => {
    if (!admin || !app) throw new Error("Native PostgreSQL fixture is unavailable.");
    const idempotencySeed = randomUUID();
    const first = await createPublicLead("Idempotent Lead",idempotencySeed);
    const retryResult = await app.query<{ snapshot: PublicLeadResult }>(
      `SELECT public.axora_record_public_company_lead(
         $1::jsonb,$2::timestamptz
       ) AS snapshot`,
      [first.input,first.now],
    );
    expect(first.snapshot.created).toBe(true);
    expect(retryResult.rows[0]?.snapshot).toMatchObject({
      created: false,leadId: first.snapshot.leadId,submissionId: first.snapshot.submissionId,
    });
    const distinct = await createPublicLead("Distinct Lead");
    expect(distinct.snapshot.leadId).not.toBe(first.snapshot.leadId);

    const ownerBefore = await loadCompanyLeadWorkspace(owner,{});
    expect(ownerBefore.managers.map((manager) => manager.id)).toEqual(
      expect.arrayContaining([managerA.id,managerB.id]),
    );
    expect(ownerBefore.leads.some((lead) => lead.id === first.snapshot.leadId)).toBe(true);
    expect((await loadCompanyLeadWorkspace(managerA,{})).leads).toHaveLength(0);

    await assignCompanyLead(
      owner,first.snapshot.leadId,managerA.id,"Assign initial company acquisition owner",
    );
    expect((await loadCompanyLeadWorkspace(managerA,{})).leads
      .some((lead) => lead.id === first.snapshot.leadId)).toBe(true);
    expect((await loadCompanyLeadWorkspace(managerB,{})).leads
      .some((lead) => lead.id === first.snapshot.leadId)).toBe(false);
    await expect(assignCompanyLead(
      managerB,distinct.snapshot.leadId,managerB.id,"Forged self assignment must fail",
    )).rejects.toThrow();

    await assignCompanyLead(
      owner,first.snapshot.leadId,managerB.id,"Reassign acquisition ownership with handover",
    );
    expect((await loadCompanyLeadWorkspace(managerA,{})).leads
      .some((lead) => lead.id === first.snapshot.leadId)).toBe(false);
    const managerBWorkspace = await loadCompanyLeadWorkspace(managerB,{});
    const reassigned = managerBWorkspace.leads.find((lead) => lead.id === first.snapshot.leadId);
    expect(reassigned?.assignment?.managerId).toBe(managerB.id);
    expect(reassigned?.assignmentHistory).toHaveLength(2);
    const assignments = await admin.query<{ active: number; ended: number }>(
      `SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,
         count(*) FILTER (WHERE status='ENDED')::int AS ended
       FROM public.company_lead_assignments WHERE lead_id=$1`,
      [first.snapshot.leadId],
    );
    expect(assignments.rows[0]).toEqual({ active: 1,ended: 1 });
  }, 45_000);

  it("serializes conversion to one company and rolls back an injected company-create failure", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const concurrent = await prepareQualifiedLead("Concurrent Conversion",managerA);
    const outcomes = await Promise.allSettled([
      convertCompanyLead(
        managerA,concurrent.snapshot.leadId,"Convert qualified lead concurrently A",
      ),
      convertCompanyLead(
        managerA,concurrent.snapshot.leadId,"Convert qualified lead concurrently B",
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const converted = await admin.query<{
      companyId: string;
      status: string;
      companyStatus: string;
      active: boolean;
      portalAccessEnabled: boolean;
      isPubliclyListed: boolean;
      companyInformation: string;
      notes: string;
      managerId: string;
    }>(
      `SELECT lead.converted_company_id::text AS "companyId",lead.status,
         company.lifecycle_status AS "companyStatus",company.active,
         company.portal_access_enabled AS "portalAccessEnabled",
         company.is_publicly_listed AS "isPubliclyListed",
         company.company_information AS "companyInformation",company.notes,
         assignment.manager_user_id::text AS "managerId"
       FROM public.company_leads lead
       JOIN public.companies company ON company.id=lead.converted_company_id
       JOIN public.company_assignments assignment
         ON assignment.company_id=company.id
        AND assignment.assignment_type='PRIMARY' AND assignment.status='ACTIVE'
       WHERE lead.id=$1`,
      [concurrent.snapshot.leadId],
    );
    const row = converted.rows[0];
    expect(row).toMatchObject({
      status: "ONBOARDING",companyStatus: "ASSIGNED",active: false,
      portalAccessEnabled: false,isPubliclyListed: false,managerId: managerA.id,
    });
    expect(row?.companyInformation).not.toContain("PRIVATE-ACQUISITION");
    expect(row?.notes ?? "").not.toContain("PRIVATE-ACQUISITION");
    await expect(convertCompanyLead(
      managerA,concurrent.snapshot.leadId,"Retry after an uncertain response",
    )).rejects.toThrow();
    expect((await admin.query(
      "SELECT count(*)::int AS count FROM public.companies WHERE id=$1",
      [row?.companyId],
    )).rows[0]?.count).toBe(1);
    expect((await loadCompanyLifecycleWorkspace(managerA)).companies
      .some((company) => company.id === row?.companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(managerB)).companies
      .some((company) => company.id === row?.companyId)).toBe(false);

    const rollbackLead = await prepareQualifiedLead("Rollback Conversion",managerA);
    await admin.query(`
      CREATE FUNCTION public.axora_prompt6_reject_company_insert()
      RETURNS trigger LANGUAGE plpgsql AS $trigger$
      BEGIN
        IF NEW.name LIKE 'Prompt 6 Rollback Conversion%' THEN
          RAISE EXCEPTION 'Injected Prompt 6 company insert failure';
        END IF;
        RETURN NEW;
      END $trigger$;
      CREATE TRIGGER prompt6_reject_company_insert
      BEFORE INSERT ON public.companies
      FOR EACH ROW EXECUTE FUNCTION public.axora_prompt6_reject_company_insert()
    `);
    try {
      await expect(convertCompanyLead(
        managerA,rollbackLead.snapshot.leadId,"Conversion must roll back completely",
      )).rejects.toThrow();
    } finally {
      await admin.query(`
        DROP TRIGGER prompt6_reject_company_insert ON public.companies;
        DROP FUNCTION public.axora_prompt6_reject_company_insert()
      `);
    }
    const rollbackState = await admin.query<{
      status: string;
      companyId: string | null;
      companies: number;
    }>(
      `SELECT lead.status,lead.converted_company_id::text AS "companyId",
         (SELECT count(*)::int FROM public.companies company
          WHERE company.name='Prompt 6 Rollback Conversion') AS companies
       FROM public.company_leads lead WHERE lead.id=$1`,
      [rollbackLead.snapshot.leadId],
    );
    expect(rollbackState.rows[0]).toEqual({ status: "QUALIFIED",companyId: null,companies: 0 });
  }, 70_000);

  it("requires live manager/admin state, keeps publication separate, and isolates the activated tenant", async () => {
    if (!admin || !app) throw new Error("Native PostgreSQL fixture is unavailable.");
    const acquisition = await convertedCompany("Activation Company",managerA);
    await assignCompanyManager(owner,{
      companyId: acquisition.companyId,managerUserId: managerB.id,
      assignmentType: "PRIMARY",accessMode: "NORMAL",specificPermissionCodes: [],
      documentVisibility: "STANDARD",handoverChecklist: ["Transfer acquisition context"],
      handoverNotes: "Prompt 6 controlled handover",reason: "Reassign onboarding ownership",
    });
    expect((await loadCompanyLifecycleWorkspace(managerA)).companies
      .some((company) => company.id === acquisition.companyId)).toBe(false);
    expect((await loadCompanyLifecycleWorkspace(managerB)).companies
      .some((company) => company.id === acquisition.companyId)).toBe(true);
    const assignmentHistory = await admin.query<{ active: number; ended: number }>(
      `SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,
         count(*) FILTER (WHERE status='ENDED')::int AS ended
       FROM public.company_assignments
       WHERE company_id=$1 AND assignment_type='PRIMARY'`,
      [acquisition.companyId],
    );
    expect(assignmentHistory.rows[0]).toEqual({ active: 1,ended: 1 });

    for (const status of ["CONTACTED","ONBOARDING","PORTAL_DRAFT","COMPANY_REVIEW"] as const) {
      await transitionCompanyLifecycle(
        managerB,acquisition.companyId,status,`Advance controlled onboarding to ${status}`,
      );
    }
    await expect(setCompanyPublication(
      owner,acquisition.companyId,true,"Do not publish an inactive company",
    )).rejects.toThrow();

    const invitationAt = new Date();
    const invitationAuthority = await admin.query<{
      lifecycleStatus: string;
      snapshotPresent: boolean;
      ownerActor: boolean;
      canCreate: boolean;
      canInvite: boolean;
    }>(
      `SELECT company.lifecycle_status AS "lifecycleStatus",
         live.snapshot IS NOT NULL AS "snapshotPresent",
         public.axora_company_actor_is_owner(live.snapshot) AS "ownerActor",
         public.axora_company_snapshot_role_permission(
           live.snapshot,'user.create'
         ) AS "canCreate",
         public.axora_company_snapshot_role_permission(
           live.snapshot,'user.invite'
         ) AS "canInvite"
       FROM public.companies company
       CROSS JOIN LATERAL (
         SELECT public.axora_live_authorization_snapshot($1::uuid,$2::uuid,$4::timestamptz)
           AS snapshot
       ) live
       WHERE company.id=$3::uuid`,
      [owner.id,owner.roleAssignmentId,acquisition.companyId,invitationAt],
    );
    expect(invitationAuthority.rows[0]).toEqual({
      lifecycleStatus: "COMPANY_REVIEW",snapshotPresent: true,ownerActor: true,
      canCreate: true,canInvite: true,
    });
    const invitationScope = await app.query<{ snapshot: unknown }>(
      `SELECT public.axora_lock_company_admin_invitation_scope(
         $1::uuid,$2::uuid,$3::uuid,$4::timestamptz
       ) AS snapshot`,
      [owner.id,owner.roleAssignmentId,acquisition.companyId,invitationAt],
    );
    expect(invitationScope.rows[0]?.snapshot).toMatchObject({
      role: "COMPANY_ADMIN",accountKind: "COMPANY",isOwner: false,
      scope: { type: "COMPANY",companyId: acquisition.companyId },
    });

    const invitation = await createInvitedUser({
      email: `prompt6-admin-${randomUUID()}@example.test`,
      displayName: "Prompt 6 Company Administrator",role: "COMPANY_ADMIN",
      companyId: acquisition.companyId,preferredLocale: "en",
    },owner);
    expect(await authorizeAccountSetupDelivery(
      invitation.invitationId,invitation.rawToken,
    )).toBe(true);
    await recordAccountSetupDelivery(invitation.invitationId,{
      succeeded: true,status: "sent",providerMessageId: `prompt6-${randomUUID()}`,
    });
    await syncCompanyAdministrator(
      owner,acquisition.companyId,"Record delivered Company Administrator invitation",
    );
    const setupEligibility = await admin.query<{
      invitationCurrent: boolean;
      invitationUnexpired: boolean;
      identityScopeMatches: boolean;
      accountInvited: boolean;
      setupPending: boolean;
      credentialPending: boolean;
      assignmentCurrent: boolean;
      membershipStatus: string;
      inviterCurrent: boolean;
      lifecycleStatus: string;
      intendedRole: string;
    }>(
      `SELECT invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL
           AS "invitationCurrent",
         invitation.expires_at>now() AS "invitationUnexpired",
         account.company_id IS NOT DISTINCT FROM invitation.company_id
           AND account.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
           AS "identityScopeMatches",
         account.active AND account.account_status='INVITED' AS "accountInvited",
         account.account_setup_completed_at IS NULL AS "setupPending",
         EXISTS (
           SELECT 1 FROM public.account_credentials credential
           WHERE credential.user_id=account.id AND credential.password_hash IS NULL
         ) AS "credentialPending",
         EXISTS (
           SELECT 1 FROM public.role_assignments current_assignment
           WHERE current_assignment.user_id=account.id
             AND current_assignment.role_id=invitation.intended_role_id
             AND current_assignment.scope_type=invitation.intended_scope_type
             AND current_assignment.company_id IS NOT DISTINCT FROM invitation.company_id
             AND current_assignment.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
             AND current_assignment.department_id IS NOT DISTINCT FROM invitation.intended_department_id
             AND current_assignment.supplier_id IS NOT DISTINCT FROM invitation.intended_supplier_id
             AND current_assignment.active AND current_assignment.revoked_at IS NULL
         ) AS "assignmentCurrent",
         membership.status AS "membershipStatus",
         public.axora_account_setup_inviter_can_activate(invitation.id,now())
           AS "inviterCurrent",
         company.lifecycle_status AS "lifecycleStatus",role.role_key AS "intendedRole"
       FROM public.account_setup_invitations invitation
       JOIN public.users account ON account.id=invitation.user_id
       JOIN public.roles role ON role.id=invitation.intended_role_id
       JOIN public.companies company ON company.id=invitation.company_id
       LEFT JOIN public.company_memberships membership
         ON membership.user_id=account.id AND membership.company_id=invitation.company_id
       WHERE invitation.id=$1`,
      [invitation.invitationId],
    );
    expect(setupEligibility.rows[0]).toEqual({
      invitationCurrent: true,invitationUnexpired: true,identityScopeMatches: true,
      accountInvited: true,setupPending: true,credentialPending: true,
      assignmentCurrent: true,membershipStatus: "INVITED",inviterCurrent: true,
      lifecycleStatus: "COMPANY_ADMINISTRATOR_INVITED",intendedRole: "COMPANY_ADMIN",
    });
    const activatedAdministrator = await consumeAccountSetupToken(
      invitation.rawToken,`Prompt6-${randomUUID()}-Strong!`,{
        displayName: "Prompt 6 Company Administrator",locale: "en",
        termsAccepted: true,privacyAccepted: true,
      },
    );
    if (activatedAdministrator.role !== "COMPANY_ADMIN"
      || activatedAdministrator.accountKind !== "COMPANY"
      || activatedAdministrator.scopeType !== "COMPANY"
      || typeof activatedAdministrator.authVersion !== "number") {
      throw new Error("Activated Company Administrator scope is invalid.");
    }
    const companyAdministrator: AuthenticatedSessionUser = {
      ...activatedAdministrator,
      role: "COMPANY_ADMIN",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      authVersion: activatedAdministrator.authVersion,
    };
    await syncCompanyAdministrator(
      owner,acquisition.companyId,"Synchronize authoritative administrator activation",
    );
    const storedInvitation = await admin.query<{
      tokenHash: string;
      consumed: boolean;
      revoked: boolean;
    }>(
      `SELECT token_hash AS "tokenHash",consumed_at IS NOT NULL AS consumed,
         revoked_at IS NOT NULL AS revoked
       FROM public.account_setup_invitations WHERE id=$1`,
      [invitation.invitationId],
    );
    expect(storedInvitation.rows[0]).toMatchObject({ consumed: true,revoked: false });
    expect(storedInvitation.rows[0]?.tokenHash).not.toBe(invitation.rawToken);
    expect(storedInvitation.rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    await prepareActivationEvidence(acquisition.companyId);
    expect((await admin.query<{ blockers: string[] }>(
      "SELECT public.axora_company_activation_blockers($1::uuid) AS blockers",
      [acquisition.companyId],
    )).rows[0]?.blockers).toEqual([]);
    await activateCompany(owner,acquisition.companyId,"Activate verified private company portal");
    const activeState = await admin.query<{
      active: boolean;
      portalAccessEnabled: boolean;
      isPubliclyListed: boolean;
      lifecycleStatus: string;
    }>(
      `SELECT active,portal_access_enabled AS "portalAccessEnabled",
         is_publicly_listed AS "isPubliclyListed",
         lifecycle_status AS "lifecycleStatus"
       FROM public.companies WHERE id=$1`,
      [acquisition.companyId],
    );
    expect(activeState.rows[0]).toEqual({
      active: true,portalAccessEnabled: true,isPubliclyListed: false,lifecycleStatus: "ACTIVE",
    });
    const activeHistoryBefore = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.company_status_history
       WHERE company_id=$1 AND to_status='ACTIVE'`,
      [acquisition.companyId],
    );
    await expect(activateCompany(
      owner,acquisition.companyId,"Repeated activation must not duplicate effects",
    )).rejects.toThrow();
    expect((await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.company_status_history
       WHERE company_id=$1 AND to_status='ACTIVE'`,
      [acquisition.companyId],
    )).rows[0]).toEqual(activeHistoryBefore.rows[0]);

    const stale = await convertedCompany("Stale Administrator Company",managerA);
    await prepareActivationEvidence(stale.companyId);
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.user_id',$1,true)", [owner.id]);
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        "Prompt 6 stale administrator fixture",
      ]);
      await admin.query(
        `UPDATE public.companies
         SET lifecycle_status='COMPANY_ADMINISTRATOR_ACTIVATED',
           lifecycle_version=lifecycle_version+1,updated_at=now()
         WHERE id=$1`,
        [stale.companyId],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    const staleBlockers = (await admin.query<{ blockers: string[] }>(
      "SELECT public.axora_company_activation_blockers($1::uuid) AS blockers",
      [stale.companyId],
    )).rows[0]?.blockers ?? [];
    expect(staleBlockers).toContain("ADMIN_ACTIVATION");
    await activateCompany(owner,stale.companyId,"Activation must remain blocked without active admin");
    expect((await admin.query<{ active: boolean }>(
      "SELECT active FROM public.companies WHERE id=$1",
      [stale.companyId],
    )).rows[0]?.active).toBe(false);
    await expect(app.query(
      "SELECT public.axora_company_has_active_administrator($1::uuid)",
      [stale.companyId],
    )).rejects.toThrow(/permission denied/i);

    const administratorWorkspace = await loadCompanyLifecycleWorkspace(companyAdministrator);
    expect(administratorWorkspace.companies.map((company) => company.id)).toEqual([
      acquisition.companyId,
    ]);
    await expect(loadCompanyLeadWorkspace(companyAdministrator,{})).rejects.toThrow();
  }, 100_000);
});
