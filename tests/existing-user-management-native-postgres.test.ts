import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvitedUser,
  consumeAccountSetupToken,
  inspectAccountSetupToken,
  resendAccountSetupInvitation,
} from "@/lib/account-setup";
import {
  removeUserPermissionOverride,
  replaceUserPermissionSet,
  setUserPermissionOverride,
} from "@/lib/access-management";
import { loadAccessAdministration } from "@/lib/access-administration";
import { removeApprovalLimit, setApprovalLimit } from "@/lib/approval-limit-management";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { updateManagedUserProfile } from "@/lib/existing-user-management";
import { replaceUserRoleScope } from "@/lib/role-scope-management";
import type { AccountKind, KnownUserRole, RoleScopeType } from "@/lib/types";
import { listAuthorizedUsers, setAuthorizedUserActive } from "@/lib/user-isolation";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

interface OrganizationFixture {
  companyId: string;
  branchOneId: string;
  branchTwoId: string;
  departmentOneId: string;
  departmentTwoId: string;
}

nativeDescribe("Prompt 5 existing-user management native PostgreSQL", () => {
  let admin: Client | undefined;
  let owner: AuthenticatedSessionUser;
  let companyAdmin: AuthenticatedSessionUser;
  let branchAdmin: AuthenticatedSessionUser;
  let departmentAdmin: AuthenticatedSessionUser;
  let organizationA: OrganizationFixture;
  let organizationB: OrganizationFixture;
  let requester: AuthenticatedSessionUser;
  let requesterAssignmentId: string;

  async function roleId(roleKey: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{ id: string }>(
      "SELECT id::text FROM public.roles WHERE role_key=$1",
      [roleKey],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`Role ${roleKey} is unavailable.`);
    return id;
  }

  async function createOrganization(label: string): Promise<OrganizationFixture> {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const companyId = randomUUID();
    const branchOneId = randomUUID();
    const branchTwoId = randomUUID();
    const departmentOneId = randomUUID();
    const departmentTwoId = randomUUID();
    const code = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    await admin.query(
      `INSERT INTO public.companies(id,company_code,name,active)
       VALUES ($1,$2,$3,true)`,
      [companyId, `N-${code}`, `${label} Company`],
    );
    await admin.query(
      `INSERT INTO public.branches(
         id,branch_code_id,company_id,name,branch_code,delivery_address,active
       ) VALUES
         ($1,$2,$5,$6,$8,'Native address one',true),
         ($3,$4,$5,$7,$9,'Native address two',true)`,
      [
        branchOneId,`NB1-${code}`,branchTwoId,`NB2-${code}`,companyId,
        `${label} Branch One`,`${label} Branch Two`,`${label}-1`,`${label}-2`,
      ],
    );
    await admin.query(
      `INSERT INTO public.departments(
         id,company_id,branch_id,department_code,name,active
       ) VALUES
         ($1,$3,$4,$6,$8,true),
         ($2,$3,$5,$7,$9,true)`,
      [
        departmentOneId,departmentTwoId,companyId,branchOneId,branchTwoId,
        `${label}-D1`,`${label}-D2`,`${label} Department One`,`${label} Department Two`,
      ],
    );
    return { companyId,branchOneId,branchTwoId,departmentOneId,departmentTwoId };
  }

  async function createActiveUser(input: {
    name: string;
    role: KnownUserRole;
    accountKind: AccountKind;
    scopeType: RoleScopeType;
    companyId?: string;
    branchId?: string;
    departmentId?: string;
    isOwner?: boolean;
  }): Promise<AuthenticatedSessionUser> {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const userId = randomUUID();
    const assignmentId = randomUUID();
    const selectedRoleId = await roleId(input.role);
    const email = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${userId}@example.test`;
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Prompt 5 native ${input.name} fixture`,
      ]);
      await admin.query(
        `INSERT INTO public.users(
           id,email,display_name,password_hash,role_id,active,is_owner,
           company_id,branch_id,account_setup_completed_at,auth_version,
           account_kind,account_status,email_verified_at
         ) VALUES (
           $1,$2,$3,'not-a-real-hash',$4,true,$5,$6,$7,now(),1,$8,'ACTIVE',now()
         )`,
        [
          userId,email,input.name,selectedRoleId,Boolean(input.isOwner),
          input.companyId ?? null,
          input.scopeType === "BRANCH" || input.scopeType === "DEPARTMENT"
            ? input.branchId ?? null : null,
          input.accountKind,
        ],
      );
      await admin.query(
        `INSERT INTO public.user_profiles(
           user_id,display_name,preferred_locale,profile_completed_at
         ) VALUES ($1,$2,'en',now())`,
        [userId,input.name],
      );
      if (input.accountKind === "COMPANY") {
        await admin.query(
          `INSERT INTO public.company_memberships(
             user_id,company_id,status,is_primary,joined_at,created_by
           ) VALUES ($1,$2,'ACTIVE',true,now(),$3)`,
          [userId,input.companyId,owner.id],
        );
      }
      if (input.branchId) {
        await admin.query(
          `INSERT INTO public.branch_assignments(
             user_id,company_id,branch_id,status,is_primary,created_by
           ) VALUES ($1,$2,$3,'ACTIVE',true,$4)`,
          [userId,input.companyId,input.branchId,owner.id],
        );
      }
      if (input.departmentId) {
        await admin.query(
          `INSERT INTO public.department_assignments(
             user_id,company_id,department_id,status,is_primary,assigned_by
           ) VALUES ($1,$2,$3,'ACTIVE',true,$4)`,
          [userId,input.companyId,input.departmentId,owner.id],
        );
      }
      await admin.query(
        `INSERT INTO public.role_assignments(
           id,user_id,role_id,scope_type,company_id,branch_id,department_id,
           supplier_id,active,assigned_by,assigned_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,true,$8,now())`,
        [
          assignmentId,userId,selectedRoleId,input.scopeType,
          input.companyId ?? null,input.branchId ?? null,input.departmentId ?? null,
          owner.id,
        ],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return {
      id: userId,email,name: input.name,role: input.role,
      accountKind: input.accountKind,scopeType: input.scopeType,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      roleAssignmentId: assignmentId,isOwner: Boolean(input.isOwner),authVersion: 1,
      preferredLocale: "en",timezone: "Asia/Kuala_Lumpur",
    };
  }

  async function activeAssignment(userId: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{
      id: string;
      role: string;
      scopeType: RoleScopeType;
      companyId: string | null;
      branchId: string | null;
      departmentId: string | null;
    }>(
      `SELECT assignment.id::text AS id,role.role_key AS role,
         assignment.scope_type AS "scopeType",
         assignment.company_id::text AS "companyId",
         assignment.branch_id::text AS "branchId",
         assignment.department_id::text AS "departmentId"
       FROM public.role_assignments assignment
       JOIN public.roles role ON role.id=assignment.role_id
       WHERE assignment.user_id=$1
         AND assignment.active AND assignment.revoked_at IS NULL
       ORDER BY assignment.assigned_at DESC,assignment.id DESC`,
      [userId],
    );
    const current = result.rows[0];
    if (!current) throw new Error("Active role assignment is unavailable.");
    return { current, rows: result.rows };
  }

  async function createSession(userId: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const sessionId = randomUUID();
    const hash = createHash("sha256").update(randomUUID()).digest("hex");
    await admin.query(
      `INSERT INTO public.user_sessions(id,user_id,token_hash,expires_at)
       VALUES ($1,$2,$3,now()+interval '2 hours')`,
      [sessionId,userId,hash],
    );
    return sessionId;
  }

  async function sessionRevoked(sessionId: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{ revoked: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked FROM public.user_sessions WHERE id=$1`,
      [sessionId],
    );
    return Boolean(result.rows[0]?.revoked);
  }

  async function accountState(userId: string) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<{
      active: boolean;
      accountStatus: string;
      authVersion: number;
    }>(
      `SELECT active,account_status AS "accountStatus",
         auth_version::int AS "authVersion"
       FROM public.users WHERE id=$1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Native account state is unavailable.");
    return row;
  }

  beforeAll(async () => {
    const port = Number.parseInt(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("AXORA_NATIVE_POSTGRES_PORT is invalid.");
    }
    admin = new Client({
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),port,
      database: requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE"),
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),ssl: false,
    });
    await admin.connect();

    const ownerId = randomUUID();
    const ownerAssignmentId = randomUUID();
    const ownerRoleId = await roleId("PLATFORM_OWNER");
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        "Prompt 5 native owner fixture",
      ]);
      await admin.query(
        `INSERT INTO public.users(
           id,email,display_name,password_hash,role_id,active,is_owner,
           company_id,branch_id,account_setup_completed_at,auth_version,
           account_kind,account_status,email_verified_at
         ) VALUES ($1,$2,'Prompt 5 Owner','not-a-real-hash',$3,true,true,
           NULL,NULL,now(),1,'PLATFORM','ACTIVE',now())`,
        [ownerId, `prompt5-owner-${ownerId}@example.test`, ownerRoleId],
      );
      await admin.query(
        `INSERT INTO public.user_profiles(
           user_id,display_name,preferred_locale,profile_completed_at
         ) VALUES ($1,'Prompt 5 Owner','en',now())`,
        [ownerId],
      );
      await admin.query(
        `INSERT INTO public.role_assignments(
           id,user_id,role_id,scope_type,company_id,branch_id,department_id,
           supplier_id,active,assigned_by,assigned_at
         ) VALUES ($1,$2,$3,'PLATFORM',NULL,NULL,NULL,NULL,true,$2,now())`,
        [ownerAssignmentId,ownerId,ownerRoleId],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    owner = {
      id: ownerId,email: `prompt5-owner-${ownerId}@example.test`,name: "Prompt 5 Owner",
      role: "PLATFORM_OWNER",accountKind: "PLATFORM",scopeType: "PLATFORM",
      roleAssignmentId: ownerAssignmentId,isOwner: true,authVersion: 1,
      preferredLocale: "en",timezone: "Asia/Kuala_Lumpur",
    };

    organizationA = await createOrganization("Prompt5A");
    organizationB = await createOrganization("Prompt5B");
    companyAdmin = await createActiveUser({
      name: "Prompt 5 Company Admin",role: "COMPANY_ADMIN",accountKind: "COMPANY",
      scopeType: "COMPANY",companyId: organizationA.companyId,
    });
    branchAdmin = await createActiveUser({
      name: "Prompt 5 Branch Admin",role: "BRANCH_ADMIN",accountKind: "COMPANY",
      scopeType: "BRANCH",companyId: organizationA.companyId,
      branchId: organizationA.branchOneId,
    });
    departmentAdmin = await createActiveUser({
      name: "Prompt 5 Department Admin",role: "DEPARTMENT_ADMIN",accountKind: "COMPANY",
      scopeType: "DEPARTMENT",companyId: organizationA.companyId,
      branchId: organizationA.branchOneId,departmentId: organizationA.departmentOneId,
    });
  }, 40_000);

  afterAll(async () => {
    if (global.__axoraPool) {
      await global.__axoraPool.end();
      global.__axoraPool = undefined;
    }
    await admin?.end();
  });

  it("changes another active Platform user between current canonical Platform roles and revokes the stale session", async () => {
    const platformUser = await createActiveUser({
      name: "Prompt 5 HRM",role: "HUMAN_RESOURCES_MANAGEMENT",
      accountKind: "PLATFORM",scopeType: "PLATFORM",
    });
    const sessionId = await createSession(platformUser.id);
    const changed = await replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: platformUser.id,
      currentRoleAssignmentId: platformUser.roleAssignmentId!,role: "CLIENT_ACCOUNT_MANAGER",
      scope: { type: "PLATFORM" },reason: "Move HR employee to client account management",
    });
    expect(changed.changed).toBe(true);
    expect(changed.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(await sessionRevoked(sessionId)).toBe(true);
    const state = await activeAssignment(platformUser.id);
    expect(state.current).toMatchObject({ role: "CLIENT_ACCOUNT_MANAGER",scopeType: "PLATFORM" });
    expect(state.current.companyId).toBeNull();
    expect(state.rows).toHaveLength(1);
    const snapshot = await loadAccessAdministration(owner,platformUser.id,changed.roleAssignmentId);
    expect(snapshot.identity.accountKind).toBe("PLATFORM");
    expect(snapshot.selectedScope.type).toBe("PLATFORM");
    const back = await replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: platformUser.id,
      currentRoleAssignmentId: changed.roleAssignmentId,role: "HUMAN_RESOURCES_MANAGEMENT",
      scope: { type: "PLATFORM" },reason: "Return employee to Human Resources Management",
    });
    expect((await activeAssignment(platformUser.id)).current).toMatchObject({
      id: back.roleAssignmentId,role: "HUMAN_RESOURCES_MANAGEMENT",scopeType: "PLATFORM",
    });
  }, 30_000);

  it("lets a Company Administrator replace an authorized company role and move Requester BRANCH to DEPARTMENT and back atomically", async () => {
    requester = await createActiveUser({
      name: "Prompt 5 Managed Buyer",role: "BRANCH_APPROVER",accountKind: "COMPANY",
      scopeType: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId,
    });
    const firstSession = await createSession(requester.id);
    const asRequester = await replaceUserRoleScope(companyAdmin, {
      commandId: randomUUID(),targetUserId: requester.id,
      currentRoleAssignmentId: requester.roleAssignmentId!,role: "REQUESTER",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      reason: "Move branch approver to purchasing requester",
    });
    expect(await sessionRevoked(firstSession)).toBe(true);
    const departmentSession = await createSession(requester.id);
    const toDepartment = await replaceUserRoleScope(companyAdmin, {
      commandId: randomUUID(),targetUserId: requester.id,
      currentRoleAssignmentId: asRequester.roleAssignmentId,role: "REQUESTER",
      scope: {
        type: "DEPARTMENT",companyId: organizationA.companyId,
        branchId: organizationA.branchOneId,departmentId: organizationA.departmentOneId,
      },reason: "Limit requester to one department",
    });
    expect(await sessionRevoked(departmentSession)).toBe(true);
    expect((await activeAssignment(requester.id)).current).toMatchObject({
      id: toDepartment.roleAssignmentId,role: "REQUESTER",scopeType: "DEPARTMENT",
      companyId: organizationA.companyId,branchId: organizationA.branchOneId,
      departmentId: organizationA.departmentOneId,
    });
    expect((await listAuthorizedUsers(companyAdmin)).find((user) => user.id === requester.id))
      .toMatchObject({ role: "REQUESTER",scopeType: "DEPARTMENT",departmentId: organizationA.departmentOneId });
    expect((await loadAccessAdministration(companyAdmin,requester.id,toDepartment.roleAssignmentId)).selectedScope)
      .toMatchObject({ type: "DEPARTMENT",departmentId: organizationA.departmentOneId });

    const backSession = await createSession(requester.id);
    const backToBranch = await replaceUserRoleScope(companyAdmin, {
      commandId: randomUUID(),targetUserId: requester.id,
      currentRoleAssignmentId: toDepartment.roleAssignmentId,role: "REQUESTER",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      reason: "Return requester to branch scope",
    });
    requesterAssignmentId = backToBranch.roleAssignmentId;
    expect(await sessionRevoked(backSession)).toBe(true);
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const membershipState = await admin.query<{ departmentStatus: string; branchStatus: string }>(`
      SELECT
        (SELECT status FROM public.department_assignments
         WHERE user_id=$1 AND department_id=$2 ORDER BY assigned_at DESC LIMIT 1) AS "departmentStatus",
        (SELECT status FROM public.branch_assignments
         WHERE user_id=$1 AND branch_id=$3) AS "branchStatus"
    `,[requester.id,organizationA.departmentOneId,organizationA.branchOneId]);
    expect(membershipState.rows[0]).toEqual({ departmentStatus: "ENDED",branchStatus: "ACTIVE" });
    expect((await activeAssignment(requester.id)).rows).toHaveLength(1);
    const history = await admin.query<{ changeType: string }>(
      `SELECT change_type AS "changeType" FROM public.permission_change_history
       WHERE target_user_id=$1 AND change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED')`,
      [requester.id],
    );
    expect(history.rows.some((row) => row.changeType === "ROLE_ASSIGNED")).toBe(true);
    expect(history.rows.some((row) => row.changeType === "ROLE_REVOKED")).toBe(true);
  }, 35_000);

  it("fails cross-company, cross-branch, and Department Administrator broadening with zero target writes", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const before = await admin.query<{ assignments: number; history: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.role_assignments WHERE user_id=$1) AS assignments,
        (SELECT count(*)::int FROM public.permission_change_history WHERE target_user_id=$1) AS history
    `,[requester.id]);
    await expect(replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: requester.id,currentRoleAssignmentId: requesterAssignmentId,
      role: "REQUESTER",scope: { type: "BRANCH",companyId: organizationB.companyId,branchId: organizationB.branchOneId },
      reason: "Cross company scope must fail closed",
    })).rejects.toThrow("The requested role or scope change could not be completed.");
    await expect(replaceUserRoleScope(branchAdmin, {
      commandId: randomUUID(),targetUserId: requester.id,currentRoleAssignmentId: requesterAssignmentId,
      role: "REQUESTER",scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchTwoId },
      reason: "Branch administrator cannot broaden scope",
    })).rejects.toThrow("The requested role or scope change could not be completed.");
    const departmentRequester = await createActiveUser({
      name: "Prompt 5 Department Requester",role: "REQUESTER",accountKind: "COMPANY",
      scopeType: "DEPARTMENT",companyId: organizationA.companyId,
      branchId: organizationA.branchOneId,departmentId: organizationA.departmentOneId,
    });
    await expect(replaceUserRoleScope(departmentAdmin, {
      commandId: randomUUID(),targetUserId: departmentRequester.id,
      currentRoleAssignmentId: departmentRequester.roleAssignmentId!,role: "REQUESTER",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      reason: "Department administrator cannot broaden to branch scope",
    })).rejects.toThrow("The requested role or scope change could not be completed.");
    const after = await admin.query<{ assignments: number; history: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.role_assignments WHERE user_id=$1) AS assignments,
        (SELECT count(*)::int FROM public.permission_change_history WHERE target_user_id=$1) AS history
    `,[requester.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, 30_000);

  it("replaces permissions, rejects unauthorized escalation, and makes DENY authoritative until audited removal", async () => {
    const before = await loadAccessAdministration(owner,requester.id,requesterAssignmentId);
    const currentPermissions = before.permissionOptions.filter((permission) => permission.effective)
      .map((permission) => permission.code);
    expect(currentPermissions).toContain("request.submit");
    const permissionSession = await createSession(requester.id);
    const replaced = await replaceUserPermissionSet(owner, {
      targetUserId: requester.id,targetRoleAssignmentId: requesterAssignmentId,
      permissions: currentPermissions.filter((permission) => permission !== "request.submit"),
      reason: "Remove submit authority for native Prompt 5 test",
    });
    expect(replaced.changed).toBe(true);
    expect(await sessionRevoked(permissionSession)).toBe(true);
    let snapshot = await loadAccessAdministration(owner,requester.id,requesterAssignmentId);
    expect(snapshot.permissionOptions.find((permission) => permission.code === "request.submit")?.effective).toBe(false);
    await expect(setUserPermissionOverride(branchAdmin, {
      targetUserId: requester.id,targetRoleAssignmentId: requesterAssignmentId,
      permission: "analytics.platform.view",effect: "GRANT",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      startsAt: new Date(),reason: "Unauthorized platform permission must fail",
    })).rejects.toThrow("The requested access change could not be completed.");
    expect(snapshot.permissionOptions.find((permission) => permission.code === "product.view")?.effective).toBe(true);
    const denySession = await createSession(requester.id);
    const denied = await setUserPermissionOverride(owner, {
      targetUserId: requester.id,targetRoleAssignmentId: requesterAssignmentId,
      permission: "product.view",effect: "DENY",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      startsAt: new Date(),reason: "Temporarily deny catalogue access",
    });
    expect(await sessionRevoked(denySession)).toBe(true);
    snapshot = await loadAccessAdministration(owner,requester.id,requesterAssignmentId);
    expect(snapshot.permissionOptions.find((permission) => permission.code === "product.view")?.effective).toBe(false);
    await removeUserPermissionOverride(owner, {
      overrideId: denied.overrideId,reason: "Restore role-provided catalogue access",
    });
    snapshot = await loadAccessAdministration(owner,requester.id,requesterAssignmentId);
    expect(snapshot.permissionOptions.find((permission) => permission.code === "product.view")?.effective).toBe(true);
    expect(snapshot.permissionOptions.find((permission) => permission.code === "request.submit")?.effective).toBe(false);
  }, 35_000);

  it("sets and removes a USER-specific approval limit, revokes sessions, and rejects invalid self-approval configuration", async () => {
    const approver = await createActiveUser({
      name: "Prompt 5 Branch Approver",role: "BRANCH_APPROVER",accountKind: "COMPANY",
      scopeType: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId,
    });
    const session = await createSession(approver.id);
    const limit = await setApprovalLimit(owner, {
      subject: { type: "USER",userId: approver.id,roleAssignmentId: approver.roleAssignmentId! },
      permission: "request.approve.other",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      currency: "MYR",maximumAmount: "500.00",allowSelfApproval: false,
      startsAt: new Date(),reason: "Native branch approval ceiling",
    });
    expect(limit.changed).toBe(true);
    expect(await sessionRevoked(session)).toBe(true);
    let snapshot = await loadAccessAdministration(owner,approver.id,approver.roleAssignmentId);
    expect(snapshot.approvalLimits.some((item) => (
      item.subjectType === "USER" && item.permission === "request.approve.other"
        && item.currency === "MYR" && Number(item.maximumAmount) === 500
    ))).toBe(true);
    await expect(setApprovalLimit(owner, {
      subject: { type: "USER",userId: approver.id,roleAssignmentId: approver.roleAssignmentId! },
      permission: "request.approve.other",
      scope: { type: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId },
      currency: "MYR",maximumAmount: "600.00",allowSelfApproval: true,
      startsAt: new Date(),reason: "Invalid self approval combination",
    })).rejects.toThrow();
    const removalSession = await createSession(approver.id);
    await removeApprovalLimit(owner, {
      approvalLimitId: limit.approvalLimitId,reason: "Remove native branch approval ceiling",
    });
    expect(await sessionRevoked(removalSession)).toBe(true);
    snapshot = await loadAccessAdministration(owner,approver.id,approver.roleAssignmentId);
    expect(snapshot.approvalLimits.some((item) => item.id === limit.approvalLimitId)).toBe(false);
  }, 30_000);

  it("updates safe profile metadata without changing email and immediately updates the directory", async () => {
    const before = (await listAuthorizedUsers(owner)).find((user) => user.id === requester.id);
    if (!before) throw new Error("Managed requester is unavailable.");
    await updateManagedUserProfile(owner, {
      targetUserId: requester.id,displayName: "Prompt 5 Updated Buyer",
      jobTitle: "Purchasing Assistant",preferredLocale: "ms",
    });
    const after = (await listAuthorizedUsers(owner)).find((user) => user.id === requester.id);
    expect(after).toMatchObject({ displayName: "Prompt 5 Updated Buyer",jobTitle: "Purchasing Assistant",email: before.email });
    expect((await loadAccessAdministration(owner,requester.id,requesterAssignmentId)).identity)
      .toMatchObject({ displayName: "Prompt 5 Updated Buyer",jobTitle: "Purchasing Assistant",preferredLocale: "ms",email: before.email });
  }, 20_000);

  it("revokes stale pending role intent and creates exactly one new valid invitation through existing resend", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const invited = await createInvitedUser({
      email: `prompt5-hrm-${randomUUID()}@example.test`,displayName: "Prompt 5 Pending HRM",
      role: "HUMAN_RESOURCES_MANAGEMENT",preferredLocale: "en",
    }, owner);
    const current = await activeAssignment(invited.userId);
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(true);
    const changed = await replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: invited.userId,currentRoleAssignmentId: current.current.id,
      role: "CLIENT_ACCOUNT_MANAGER",scope: { type: "PLATFORM" },
      reason: "Move pending employee to account management",
    });
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(false);
    const pending = await loadAccessAdministration(owner,invited.userId,changed.roleAssignmentId);
    expect(pending.identity).toMatchObject({ accountStatus: "INVITED",setupCompleted: false });
    expect(pending.assignments[0]).toMatchObject({ roleKey: "CLIENT_ACCOUNT_MANAGER",scope: { type: "PLATFORM" } });
    const replacement = await resendAccountSetupInvitation(invited.userId,owner);
    expect(replacement.rawToken).not.toBe(invited.rawToken);
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(false);
    expect(await inspectAccountSetupToken(replacement.rawToken)).toMatchObject({ valid: true,role: "CLIENT_ACCOUNT_MANAGER" });
    const liveTokens = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.account_setup_invitations
       WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [invited.userId],
    );
    expect(liveTokens.rows[0]?.count).toBe(1);
  }, 30_000);

  it("invalidates stale pending scope intent and binds replacement invitation to the new department", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const invited = await createInvitedUser({
      email: `prompt5-scope-${randomUUID()}@example.test`,displayName: "Prompt 5 Pending Requester",
      role: "REQUESTER",companyId: organizationA.companyId,branchId: organizationA.branchOneId,
      preferredLocale: "en",
    }, owner);
    const current = await activeAssignment(invited.userId);
    const changed = await replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: invited.userId,currentRoleAssignmentId: current.current.id,
      role: "REQUESTER",scope: {
        type: "DEPARTMENT",companyId: organizationA.companyId,
        branchId: organizationA.branchOneId,departmentId: organizationA.departmentOneId,
      },reason: "Move pending requester to one department",
    });
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(false);
    const replacement = await resendAccountSetupInvitation(invited.userId,owner);
    expect((await inspectAccountSetupToken(replacement.rawToken)).valid).toBe(true);
    const intent = await admin.query<{ scopeType: string; branchId: string; departmentId: string }>(
      `SELECT intended_scope_type AS "scopeType",intended_branch_id::text AS "branchId",
         intended_department_id::text AS "departmentId"
       FROM public.account_setup_invitations WHERE id=$1`,
      [replacement.invitationId],
    );
    expect(intent.rows[0]).toEqual({
      scopeType: "DEPARTMENT",branchId: organizationA.branchOneId,departmentId: organizationA.departmentOneId,
    });
    expect((await activeAssignment(invited.userId)).current.id).toBe(changed.roleAssignmentId);
  }, 30_000);

  it("does not let an old setup bearer restore permissions changed while invited", async () => {
    const invited = await createInvitedUser({
      email: `prompt5-permissions-${randomUUID()}@example.test`,displayName: "Prompt 5 Permission Invite",
      role: "REQUESTER",companyId: organizationA.companyId,branchId: organizationA.branchOneId,
      preferredLocale: "en",
    }, owner);
    const current = await activeAssignment(invited.userId);
    const pending = await loadAccessAdministration(owner,invited.userId,current.current.id);
    const selected = pending.permissionOptions.filter((permission) => permission.effective)
      .map((permission) => permission.code).filter((permission) => permission !== "request.submit");
    await replaceUserPermissionSet(owner, {
      targetUserId: invited.userId,targetRoleAssignmentId: current.current.id,
      permissions: selected,reason: "Remove submit before account activation",
    });
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(true);
    await consumeAccountSetupToken(invited.rawToken,"Prompt5-Native-Strong-Password!2026", {
      displayName: "Prompt 5 Permission Invite",locale: "en",termsAccepted: true,privacyAccepted: true,
    });
    const activated = await loadAccessAdministration(owner,invited.userId,current.current.id);
    expect(activated.identity.accountStatus).toBe("ACTIVE");
    expect(activated.permissionOptions.find((permission) => permission.code === "request.submit")?.effective).toBe(false);
  }, 40_000);

  it("deactivation invalidates pending setup and reactivation cannot revive the old bearer", async () => {
    const invited = await createInvitedUser({
      email: `prompt5-deactivate-${randomUUID()}@example.test`,displayName: "Prompt 5 Pending Deactivation",
      role: "CLIENT_ACCOUNT_MANAGER",preferredLocale: "en",
    }, owner);
    const before = await accountState(invited.userId);
    await setAuthorizedUserActive(invited.userId,false,owner);
    const suspended = await accountState(invited.userId);
    expect(suspended).toMatchObject({ active: false,accountStatus: "SUSPENDED" });
    expect(suspended.authVersion).toBeGreaterThan(before.authVersion);
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(false);
    await setAuthorizedUserActive(invited.userId,true,owner);
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(false);
    const replacement = await resendAccountSetupInvitation(invited.userId,owner);
    expect((await inspectAccountSetupToken(replacement.rawToken)).valid).toBe(true);
  }, 30_000);

  it("makes active deactivation immediately obsolete through account state and auth version", async () => {
    const activeUser = await createActiveUser({
      name: "Prompt 5 Deactivation User",role: "REQUESTER",accountKind: "COMPANY",
      scopeType: "BRANCH",companyId: organizationA.companyId,branchId: organizationA.branchOneId,
    });
    await createSession(activeUser.id);
    const before = await accountState(activeUser.id);
    await setAuthorizedUserActive(activeUser.id,false,owner);
    const after = await accountState(activeUser.id);
    expect(after.active).toBe(false);
    expect(after.accountStatus).toBe("SUSPENDED");
    expect(after.authVersion).toBeGreaterThan(before.authVersion);
  }, 20_000);

  it("rolls a replacement back completely when failure occurs after new assignment insert", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const invited = await createInvitedUser({
      email: `prompt5-rollback-${randomUUID()}@example.test`,displayName: "Prompt 5 Rollback Invite",
      role: "HUMAN_RESOURCES_MANAGEMENT",preferredLocale: "en",
    }, owner);
    const current = await activeAssignment(invited.userId);
    const commandId = randomUUID();
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.axora_test_fail_prompt5_role_revoke()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF OLD.user_id='${invited.userId}'::uuid AND OLD.active AND NOT NEW.active THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Prompt 5 injected role replacement failure';
        END IF;
        RETURN NEW;
      END $function$
    `);
    await admin.query(`
      CREATE TRIGGER axora_test_fail_prompt5_role_revoke
      BEFORE UPDATE ON public.role_assignments
      FOR EACH ROW EXECUTE FUNCTION public.axora_test_fail_prompt5_role_revoke()
    `);
    try {
      await expect(replaceUserRoleScope(owner, {
        commandId,targetUserId: invited.userId,currentRoleAssignmentId: current.current.id,
        role: "CLIENT_ACCOUNT_MANAGER",scope: { type: "PLATFORM" },reason: "Injected atomic rollback check",
      })).rejects.toThrow("The requested role or scope change could not be completed.");
    } finally {
      await admin.query("DROP TRIGGER IF EXISTS axora_test_fail_prompt5_role_revoke ON public.role_assignments");
      await admin.query("DROP FUNCTION IF EXISTS public.axora_test_fail_prompt5_role_revoke()");
    }
    expect((await activeAssignment(invited.userId)).current).toMatchObject({
      id: current.current.id,role: "HUMAN_RESOURCES_MANAGEMENT",scopeType: "PLATFORM",
    });
    const partial = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.role_assignments WHERE id=$1",
      [commandId],
    );
    expect(partial.rows[0]?.count).toBe(0);
    expect((await inspectAccountSetupToken(invited.rawToken)).valid).toBe(true);
  }, 30_000);

  it("preserves the last required Company Administrator", async () => {
    const organization = await createOrganization("Prompt5LastAdmin");
    const lastAdmin = await createActiveUser({
      name: "Prompt 5 Last Company Admin",role: "COMPANY_ADMIN",accountKind: "COMPANY",
      scopeType: "COMPANY",companyId: organization.companyId,
    });
    await expect(replaceUserRoleScope(owner, {
      commandId: randomUUID(),targetUserId: lastAdmin.id,currentRoleAssignmentId: lastAdmin.roleAssignmentId!,
      role: "COMPANY_APPROVER",scope: { type: "COMPANY",companyId: organization.companyId },
      reason: "Last company administrator must remain protected",
    })).rejects.toThrow("The requested role or scope change could not be completed.");
    expect((await activeAssignment(lastAdmin.id)).current.role).toBe("COMPANY_ADMIN");
  }, 25_000);

  it("renders an invited Delivery Guy with DELIVERY scope and preserves the PR 137 UUID profile contract", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const invited = await createInvitedUser({
      email: `prompt5-delivery-${randomUUID()}@example.test`,displayName: "Prompt 5 Delivery Guy",
      role: "DELIVERY_GUY",preferredLocale: "en",
    }, owner);
    const snapshot = await loadAccessAdministration(owner,invited.userId);
    expect(snapshot.identity).toMatchObject({ accountKind: "DELIVERY",accountStatus: "INVITED",setupCompleted: false });
    expect(snapshot.selectedScope).toMatchObject({ type: "DELIVERY" });
    expect(snapshot.selectedScope.companyId).toBeUndefined();
    expect(snapshot.selectedScope.branchId).toBeUndefined();
    expect(snapshot.selectedScope.departmentId).toBeUndefined();
    expect(snapshot.assignments[0]?.roleKey).toBe("DELIVERY_GUY");
    const profile = await admin.query<{ userId: string; agentCode: string }>(
      `SELECT user_id::text AS "userId",agent_code AS "agentCode"
       FROM public.delivery_agent_profiles WHERE user_id=$1`,
      [invited.userId],
    );
    expect(profile.rows[0]?.userId).toBe(invited.userId);
    expect(profile.rows[0]?.agentCode).toMatch(/^DRV-[0-9A-F]{12}$/);
  }, 25_000);

  it("keeps the database last-Platform-Owner invariant authoritative", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    await admin.query(
      `UPDATE public.users SET active=false,account_status='SUSPENDED'
       WHERE id<>$1 AND is_owner AND active`,
      [owner.id],
    );
    const count = await admin.query<{ count: number }>(
      `SELECT public.axora_active_platform_owner_count(NULL,NULL)::int AS count`,
    );
    expect(count.rows[0]?.count).toBe(1);
    await expect(admin.query(
      `UPDATE public.role_assignments
       SET active=false,revoked_at=now(),revoked_by=$2,
           revoke_reason='Native last owner protection'
       WHERE id=$1`,
      [owner.roleAssignmentId,owner.id],
    )).rejects.toThrow(/last active Platform Owner/i);
    expect((await activeAssignment(owner.id)).current.role).toBe("PLATFORM_OWNER");
  }, 25_000);
});
