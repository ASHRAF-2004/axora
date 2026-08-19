import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvitedUser,
  inspectAccountSetupToken,
} from "@/lib/account-setup";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { listAuthorizedUsers } from "@/lib/user-isolation";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

interface PersistenceCounts {
  users: number;
  assignments: number;
  deliveryProfiles: number;
  invitations: number;
}

nativeDescribe("Delivery Guy invitation native PostgreSQL regression", () => {
  let admin: Client | undefined;
  let owner: AuthenticatedSessionUser;

  beforeAll(async () => {
    const port = Number.parseInt(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"), 10);
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

    const ownerId = randomUUID();
    const ownerAssignmentId = randomUUID();
    const ownerRole = await admin.query<{ id: string }>(
      "SELECT id::text FROM public.roles WHERE role_key='PLATFORM_OWNER'",
    );
    const ownerRoleId = ownerRole.rows[0]?.id;
    if (!ownerRoleId) throw new Error("The native Platform Owner role fixture is unavailable.");

    await admin.query("BEGIN");
    try {
      await admin.query(
        "SELECT set_config('axora.change_reason',$1,true)",
        ["Native Delivery Guy invitation regression fixture"],
      );
      await admin.query(
        `INSERT INTO public.users(
           id,email,display_name,password_hash,role_id,active,is_owner,
           company_id,branch_id,account_setup_completed_at,auth_version,
           account_kind,account_status,email_verified_at
         ) VALUES (
           $1,$2,'Native Platform Owner','not-a-real-hash',$3,true,true,
           NULL,NULL,now(),1,'PLATFORM','ACTIVE',now()
         )`,
        [ownerId, `native-owner-${ownerId}@example.test`, ownerRoleId],
      );
      await admin.query(
        `INSERT INTO public.user_profiles(
           user_id,display_name,preferred_locale,profile_completed_at
         ) VALUES ($1,'Native Platform Owner','en',now())`,
        [ownerId],
      );
      await admin.query(
        `INSERT INTO public.role_assignments(
           id,user_id,role_id,scope_type,company_id,branch_id,department_id,
           supplier_id,active,assigned_by,assigned_at
         ) VALUES (
           $1,$2,$3,'PLATFORM',NULL,NULL,NULL,NULL,true,$2,now()
         )`,
        [ownerAssignmentId, ownerId, ownerRoleId],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }

    owner = {
      id: ownerId,
      email: `native-owner-${ownerId}@example.test`,
      name: "Native Platform Owner",
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      roleAssignmentId: ownerAssignmentId,
      isOwner: true,
      authVersion: 1,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
    };
  }, 30_000);

  afterAll(async () => {
    if (global.__axoraPool) {
      await global.__axoraPool.end();
      global.__axoraPool = undefined;
    }
    await admin?.end();
  });

  async function persistenceCounts() {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const result = await admin.query<PersistenceCounts>(`
      SELECT
        (SELECT count(*)::int FROM public.users) AS users,
        (SELECT count(*)::int FROM public.role_assignments) AS assignments,
        (SELECT count(*)::int FROM public.delivery_agent_profiles) AS "deliveryProfiles",
        (SELECT count(*)::int FROM public.account_setup_invitations) AS invitations
    `);
    return result.rows[0];
  }

  it("creates a committed Delivery Guy invitation with UUID-safe identity and a listable directory row", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const email = `native-delivery-${randomUUID()}@example.test`;

    const invitation = await createInvitedUser({
      email,
      displayName: "Native Delivery Guy",
      role: "DELIVERY_GUY",
      preferredLocale: "en",
    }, owner);

    expect(invitation).toMatchObject({
      recipientEmail: email,
      recipientName: "Native Delivery Guy",
      companyName: "Axora",
      role: "DELIVERY_GUY",
      locale: "en",
    });
    expect(invitation.userId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(invitation.invitationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(invitation.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const state = await admin.query<{
      userId: string;
      accountKind: string;
      accountStatus: string;
      accountSetupCompletedAt: string | null;
      role: string;
      scopeType: string;
      companyId: string | null;
      branchId: string | null;
      departmentId: string | null;
      supplierId: string | null;
      deliveryUserId: string;
      agentCode: string;
      invitationId: string;
      invitationUserId: string;
      tokenHash: string;
      intendedScopeType: string;
      intendedCompanyId: string | null;
      intendedBranchId: string | null;
      intendedDepartmentId: string | null;
      intendedSupplierId: string | null;
    }>(`
      SELECT
        account.id::text AS "userId",
        account.account_kind AS "accountKind",
        account.account_status AS "accountStatus",
        account.account_setup_completed_at::text AS "accountSetupCompletedAt",
        role.role_key AS role,
        assignment.scope_type AS "scopeType",
        assignment.company_id::text AS "companyId",
        assignment.branch_id::text AS "branchId",
        assignment.department_id::text AS "departmentId",
        assignment.supplier_id::text AS "supplierId",
        driver.user_id::text AS "deliveryUserId",
        driver.agent_code AS "agentCode",
        invitation.id::text AS "invitationId",
        invitation.user_id::text AS "invitationUserId",
        invitation.token_hash AS "tokenHash",
        invitation.intended_scope_type AS "intendedScopeType",
        invitation.company_id::text AS "intendedCompanyId",
        invitation.intended_branch_id::text AS "intendedBranchId",
        invitation.intended_department_id::text AS "intendedDepartmentId",
        invitation.intended_supplier_id::text AS "intendedSupplierId"
      FROM public.users account
      JOIN public.role_assignments assignment
        ON assignment.user_id=account.id AND assignment.active=true
      JOIN public.roles role ON role.id=assignment.role_id
      JOIN public.delivery_agent_profiles driver ON driver.user_id=account.id
      JOIN public.account_setup_invitations invitation
        ON invitation.id=$2 AND invitation.user_id=account.id
      WHERE account.id=$1
    `, [invitation.userId, invitation.invitationId]);

    expect(state.rowCount).toBe(1);
    expect(state.rows[0]).toMatchObject({
      userId: invitation.userId,
      accountKind: "DELIVERY",
      accountStatus: "INVITED",
      accountSetupCompletedAt: null,
      role: "DELIVERY_GUY",
      scopeType: "DELIVERY",
      companyId: null,
      branchId: null,
      departmentId: null,
      supplierId: null,
      deliveryUserId: invitation.userId,
      invitationId: invitation.invitationId,
      invitationUserId: invitation.userId,
      intendedScopeType: "DELIVERY",
      intendedCompanyId: null,
      intendedBranchId: null,
      intendedDepartmentId: null,
      intendedSupplierId: null,
    });
    expect(state.rows[0].agentCode).toMatch(/^DRV-[0-9A-F]{12}$/);
    expect(state.rows[0].tokenHash).toBe(
      createHash("sha256").update(invitation.rawToken, "utf8").digest("hex"),
    );

    const inspection = await inspectAccountSetupToken(invitation.rawToken);
    expect(inspection).toMatchObject({
      valid: true,
      recipientName: "Native Delivery Guy",
      recipientEmail: email,
      companyName: "Axora delivery network",
      role: "DELIVERY_GUY",
      locale: "en",
    });

    const directory = await listAuthorizedUsers(owner);
    const created = directory.find((user) => user.id === invitation.userId);
    expect(created).toMatchObject({
      email,
      displayName: "Native Delivery Guy",
      role: "DELIVERY_GUY",
      accountKind: "DELIVERY",
      accountStatus: "INVITED",
      scopeType: "DELIVERY",
      active: true,
      isOwner: false,
    });
    expect(created?.companyId).toBeUndefined();
    expect(created?.branchId).toBeUndefined();
    expect(created?.departmentId).toBeUndefined();
    expect(created?.supplierId).toBeUndefined();
  }, 30_000);

  it("rolls back every partial account row when delivery identity initialization fails", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const before = await persistenceCounts();
    const email = `native-delivery-rollback-${randomUUID()}@example.test`;

    await admin.query(`
      CREATE OR REPLACE FUNCTION public.axora_test_fail_delivery_profile_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION USING
          ERRCODE='P0001',
          MESSAGE='native delivery profile rollback fixture';
      END
      $function$
    `);
    await admin.query(`
      CREATE TRIGGER axora_test_fail_delivery_profile_insert
      BEFORE INSERT ON public.delivery_agent_profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.axora_test_fail_delivery_profile_insert()
    `);

    try {
      await expect(createInvitedUser({
        email,
        displayName: "Rollback Delivery Guy",
        role: "DELIVERY_GUY",
        preferredLocale: "en",
      }, owner)).rejects.toThrow("native delivery profile rollback fixture");
    } finally {
      await admin.query(
        "DROP TRIGGER IF EXISTS axora_test_fail_delivery_profile_insert ON public.delivery_agent_profiles",
      );
      await admin.query(
        "DROP FUNCTION IF EXISTS public.axora_test_fail_delivery_profile_insert()",
      );
    }

    const after = await persistenceCounts();
    expect(after).toEqual(before);
    const failedAccount = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.users WHERE email=$1",
      [email],
    );
    expect(failedAccount.rows[0]?.count).toBe(0);
  }, 30_000);
});
