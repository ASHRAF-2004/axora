import { randomUUID } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  assignCompanyManager,
  CompanyCreationCommandConflictError,
  CompanyLifecycleUnavailableError,
  loadCompanyLifecycleWorkspace,
} from "@/lib/company-lifecycle";
import {
  assignCompanyLead,
  convertCompanyLead,
  createAcquisitionLead,
  loadCompanyLeadWorkspace,
  transitionCompanyLead,
} from "@/lib/company-leads";
import {
  loadOrganizationDirectory,
  loadOrganizationResourceAccess,
} from "@/lib/organization-access";
import { createCompanyWithBrand } from "@/lib/tenant-branding";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

nativeDescribe("Prompt 7 direct company creation native PostgreSQL", () => {
  let admin: Client | undefined;
  let owner: AuthenticatedSessionUser;
  let camA: AuthenticatedSessionUser;
  let camB: AuthenticatedSessionUser;

  async function createPlatformActor(
    label: string,
    role: "PLATFORM_OWNER" | "CLIENT_ACCOUNT_MANAGER",
    isOwner = false,
  ) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const userId = randomUUID();
    const assignmentId = randomUUID();
    const email = `prompt7-direct-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${userId}@example.test`;
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Prompt 7 direct company ${label} fixture`,
      ]);
      await admin.query(`
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,active,is_owner,
          account_setup_completed_at,email_verified_at,auth_version,
          account_kind,account_status
        ) SELECT $1,$2,$3,'not-a-real-hash',role.id,true,$4,
          now(),now(),1,'PLATFORM','ACTIVE'
        FROM public.roles role WHERE role.role_key=$5
      `, [userId,email,`Prompt 7 ${label}`,isOwner,role]);
      await admin.query(`
        INSERT INTO public.user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
      `, [userId,`Prompt 7 ${label}`]);
      await admin.query(`
        INSERT INTO public.role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) SELECT $1,$2,role.id,'PLATFORM',true,$3,now()
        FROM public.roles role WHERE role.role_key=$4
      `, [assignmentId,userId,isOwner ? userId : owner.id,role]);
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return {
      id: userId,
      email,
      name: `Prompt 7 ${label}`,
      role,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      roleAssignmentId: assignmentId,
      isOwner,
      authVersion: 1,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
    } satisfies AuthenticatedSessionUser;
  }

  beforeAll(async () => {
    const port = Number.parseInt(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"),10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("AXORA_NATIVE_POSTGRES_PORT is invalid.");
    }
    admin = new Client({
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),
      port,
      database: requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE"),
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
      ssl: false,
    });
    await admin.connect();
    owner = await createPlatformActor("Owner","PLATFORM_OWNER",true);
    camA = await createPlatformActor("CAM A","CLIENT_ACCOUNT_MANAGER");
    camB = await createPlatformActor("CAM B","CLIENT_ACCOUNT_MANAGER");
  }, 45_000);

  afterAll(async () => {
    if (global.__axoraPool) {
      await global.__axoraPool.end();
      global.__axoraPool = undefined;
    }
    await admin?.end();
  });

  it("serializes a branded command, binds its payload, and keeps CAM access explicit", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const commandId = randomUUID();
    const logo = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: { r: 11, g: 45, b: 82, alpha: 1 },
      },
    }).png().toBuffer();
    const input = {
      name: `Prompt 7 direct ${commandId.slice(0, 8)}`,
      legalName: `Prompt 7 direct ${commandId.slice(0, 8)} Sdn Bhd`,
      industry: "Business services",
      companyInformation: "Native concurrent direct-company creation fixture",
      websiteUrl: "https://example.test",
      mainContactName: "Company coordinator",
      billingCycle: "Monthly",
      notes: "Created directly under Platform Owner oversight",
    };
    const create = () => createCompanyWithBrand(
      input,
      new File([logo],"prompt-7-company-logo.png",{ type: "image/png" }),
      owner,
      commandId,
    );
    const attempts = await Promise.all(Array.from({ length: 10 },create));
    expect(attempts.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(attempts.map((result) => result.companyId)).size).toBe(1);
    expect(new Set(attempts.map((result) => result.logoId)).size).toBe(1);
    expect(new Set(attempts.map((result) => result.themeId)).size).toBe(1);
    const companyId = attempts[0]!.companyId;

    const evidence = async () => (await admin!.query<{
      companies: number;
      statusRows: number;
      logos: number;
      themes: number;
      audits: number;
      workflowEvents: number;
      notifications: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.companies
          WHERE creation_command_id=$1) AS companies,
        (SELECT count(*)::int FROM public.company_status_history
          WHERE company_id=$2) AS "statusRows",
        (SELECT count(*)::int FROM public.company_logos
          WHERE company_id=$2) AS logos,
        (SELECT count(*)::int FROM public.company_brand_themes
          WHERE company_id=$2) AS themes,
        (SELECT count(*)::int FROM public.audit_logs
          WHERE actor_id=$3 AND (
            record_id=$2 OR new_values->>'company_id'=$2::text
              OR old_values->>'company_id'=$2::text
          )) AS audits,
        (SELECT count(*)::int FROM public.workflow_events
          WHERE company_id=$2) AS "workflowEvents",
        (SELECT count(*)::int FROM public.in_app_notifications
          WHERE company_id=$2) AS notifications
    `, [commandId,companyId,owner.id])).rows[0]!;
    const beforeReplay = await evidence();
    expect(beforeReplay).toMatchObject({
      companies: 1,
      statusRows: 1,
      logos: 1,
      themes: 1,
    });
    expect(await create()).toMatchObject({
      created: false,
      companyId,
      logoId: attempts[0]!.logoId,
      themeId: attempts[0]!.themeId,
    });
    expect(await evidence()).toEqual(beforeReplay);

    await expect(createCompanyWithBrand(
      { ...input,name: `${input.name} conflicting reuse` },
      new File([logo],"prompt-7-company-logo.png",{ type: "image/png" }),
      owner,
      commandId,
    )).rejects.toBeInstanceOf(CompanyCreationCommandConflictError);
    expect(await evidence()).toEqual(beforeReplay);

    expect((await loadCompanyLifecycleWorkspace(owner)).companies
      .some((company) => company.id === companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(camA)).companies
      .some((company) => company.id === companyId)).toBe(false);
    expect((await loadCompanyLifecycleWorkspace(camB)).companies
      .some((company) => company.id === companyId)).toBe(false);
    expect((await loadOrganizationDirectory(owner)).companies
      .some((company) => company.id === companyId)).toBe(true);
    expect((await loadOrganizationDirectory(camA)).companies
      .some((company) => company.id === companyId)).toBe(false);
    await expect(loadOrganizationResourceAccess(camA,{
      permission: "company.view.assigned",
      resourceType: "COMPANY",
      resourceId: companyId,
    })).rejects.toThrow(/unavailable/i);
    expect(() => assignCompanyManager(camA,{
      companyId,
      managerUserId: camA.id,
      assignmentType: "PRIMARY",
      accessMode: "NORMAL",
      specificPermissionCodes: [],
      documentVisibility: "STANDARD",
      handoverChecklist: [],
      reason: "A CAM cannot hand a company to themselves",
    })).toThrow(CompanyLifecycleUnavailableError);
    await assignCompanyManager(owner,{
      companyId,
      managerUserId: camA.id,
      assignmentType: "PRIMARY",
      accessMode: "NORMAL",
      specificPermissionCodes: [],
      documentVisibility: "STANDARD",
      handoverChecklist: [],
      reason: "Explicit accountable CAM handover",
    });
    expect((await loadCompanyLifecycleWorkspace(camA)).companies
      .some((company) => company.id === companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(camB)).companies
      .some((company) => company.id === companyId)).toBe(false);
    expect((await loadOrganizationDirectory(camA)).companies
      .some((company) => company.id === companyId)).toBe(true);
    await expect(loadOrganizationResourceAccess(camA,{
      permission: "company.view.assigned",
      resourceType: "COMPANY",
      resourceId: companyId,
    })).resolves.toMatchObject({ resourceId: companyId });
  }, 120_000);

  it("lets the Owner manage a lead through assigned-CAM conversion", async () => {
    const marker = randomUUID().slice(0,8);
    const created = await createAcquisitionLead(owner,{
      companyName: `Native owner lead ${marker}`,
      legalName: `Native owner lead ${marker} Sdn Bhd`,
      contactName: "Native lead coordinator",
      city: "Kuala Lumpur",
      industry: "Business services",
      employeeRange: "11_50",
      branchRange: "2_5",
      spendRange: "50K_250K",
      locale: "en",
      timezone: "Asia/Kuala_Lumpur",
      subject: "Native Owner-managed opportunity",
      message: "Exercise Owner assignment and follow-up through canonical conversion.",
    },randomUUID());
    expect((await loadCompanyLeadWorkspace(owner,{})).leads
      .find((lead) => lead.id === created.leadId)?.availableActions)
      .toEqual(expect.arrayContaining(["ASSIGN","MARK_CONTACTED","QUALIFY"]));
    expect((await loadCompanyLeadWorkspace(camA,{})).leads
      .some((lead) => lead.id === created.leadId)).toBe(false);
    expect((await loadCompanyLeadWorkspace(camB,{})).leads
      .some((lead) => lead.id === created.leadId)).toBe(false);

    await assignCompanyLead(
      owner,created.leadId,camA.id,"Owner assigned native lead for follow-up",
    );
    expect((await loadCompanyLeadWorkspace(camA,{})).leads
      .some((lead) => lead.id === created.leadId)).toBe(true);
    expect((await loadCompanyLeadWorkspace(camB,{})).leads
      .some((lead) => lead.id === created.leadId)).toBe(false);
    await expect(transitionCompanyLead(
      camB,created.leadId,"CONTACTED","Forged native transition outside portfolio",
    )).rejects.toThrow(/unavailable/i);

    await transitionCompanyLead(
      owner,created.leadId,"CONTACTED","Owner confirmed native initial contact",
    );
    await transitionCompanyLead(
      owner,created.leadId,"QUALIFIED","Owner completed native qualification",
    );
    const converted = await convertCompanyLead(
      owner,created.leadId,"Owner approved native canonical onboarding",
    );
    expect(converted).toMatchObject({
      leadId: created.leadId,status: "ONBOARDING",
    });
    expect((await loadCompanyLifecycleWorkspace(owner)).companies
      .some((company) => company.id === converted.companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(camA)).companies
      .some((company) => company.id === converted.companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(camB)).companies
      .some((company) => company.id === converted.companyId)).toBe(false);
  }, 120_000);

  it("keeps company.create out of the CAM preset and obeys an Owner DENY", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const presets = await admin.query<{ roleKey: string }>(`
      SELECT role.role_key AS "roleKey"
      FROM public.role_permissions role_permission
      JOIN public.roles role ON role.id=role_permission.role_id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE permission.permission_code='company.create'
        AND role.role_key IN ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER')
      ORDER BY role.role_key
    `);
    expect(presets.rows).toEqual([{ roleKey: "PLATFORM_OWNER" }]);
    await admin.query(`
      INSERT INTO public.user_permission_overrides(
        user_id,permission_id,effect,scope_type,active,reason,changed_by
      ) VALUES (
        $1,(SELECT id FROM public.permissions WHERE permission_code='company.create'),
        'DENY','PLATFORM',true,'Temporarily withdraw direct creation',$1
      )
    `, [owner.id]);
    const logo = await sharp({
      create: { width: 128,height: 128,channels: 4,background: "#0B2D52" },
    }).png().toBuffer();
    await expect(createCompanyWithBrand({
      name: "Denied direct creation",
      legalName: "Denied direct creation Sdn Bhd",
      industry: "Business services",
      companyInformation: "Must not persist",
      mainContactName: "Company coordinator",
      billingCycle: "Monthly",
    },new File([logo],"denied.png",{ type: "image/png" }),owner,randomUUID()))
      .rejects.toThrow(/company creation scope is unavailable/i);
  }, 60_000);
});
