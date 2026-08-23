import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAccountSetupDelivery,
  consumeAccountSetupToken,
  createInvitedUser,
  inspectAccountSetupToken,
  recordAccountSetupDelivery,
} from "@/lib/account-setup";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { authenticate } from "@/lib/auth";
import { verifyPassword } from "@/lib/password-policy";
import { listAuthorizedUsers } from "@/lib/user-isolation";
import {
  defaultPermissionsForRole,
  type PermissionCode,
} from "@/lib/authorization-policy";
import { syncCompanyAdministrator } from "@/lib/company-lifecycle";

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
  let ownerAssignmentId: string;

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
    ownerAssignmentId = randomUUID();
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

    await expect(authorizeAccountSetupDelivery(
      invitation.invitationId,
      invitation.rawToken,
    )).resolves.toBe(true);
    await expect(recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: true,
      providerMessageId: "native-delivery-provider-fixture",
      providerName: "resend",
      status: "sent",
    })).resolves.toBe(true);

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

    const directory = await listAuthorizedUsers({ ...owner, roleAssignmentId: ownerAssignmentId });
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

  it("creates one onboarding Company Administrator graph on the first attempt without an assignment claim", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const companyId = randomUUID();
    const email = `native-company-admin-${randomUUID()}@example.test`;
    await admin.query(
      `INSERT INTO public.companies(
         id,company_code,name,legal_name,registration_number,industry,
         active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
       ) VALUES (
         $1,$2,'Native onboarding company','Native onboarding company','',
         'Operations',false,'ONBOARDING',false,0,$3
       )`,
      [companyId, `NATIVE-${companyId.slice(0, 8)}`, owner.id],
    );

    const invitation = await createInvitedUser({
      email,
      displayName: "Native Company Administrator",
      role: "COMPANY_ADMIN",
      companyId,
      preferredLocale: "ar",
    }, owner);

    const graph = await admin.query<{
      users: number;
      profiles: number;
      credentials: number;
      memberships: number;
      assignments: number;
      invitations: number;
    }>(`
      SELECT
        count(DISTINCT account.id)::int AS users,
        count(DISTINCT profile.user_id)::int AS profiles,
        count(DISTINCT credential.user_id)::int AS credentials,
        count(DISTINCT membership.user_id)::int AS memberships,
        count(DISTINCT assignment.id)::int AS assignments,
        count(DISTINCT invitation.id)::int AS invitations
      FROM public.users account
      LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
      LEFT JOIN public.account_credentials credential ON credential.user_id=account.id
      LEFT JOIN public.company_memberships membership
        ON membership.user_id=account.id AND membership.company_id=$2
      LEFT JOIN public.role_assignments assignment
        ON assignment.user_id=account.id AND assignment.company_id=$2 AND assignment.active
      LEFT JOIN public.account_setup_invitations invitation
        ON invitation.user_id=account.id AND invitation.company_id=$2
      WHERE account.id=$1
    `, [invitation.userId, companyId]);
    expect(graph.rows[0]).toEqual({
      users: 1,
      profiles: 1,
      credentials: 1,
      memberships: 1,
      assignments: 1,
      invitations: 1,
    });

    await expect(createInvitedUser({
      email,
      displayName: "Native Company Administrator",
      role: "COMPANY_ADMIN",
      companyId,
      preferredLocale: "ar",
    }, owner)).rejects.toMatchObject({
      name: "UserCreationError",
      reason: "invitation-pending",
    });

    const afterDuplicate = await admin.query<{ users: number; invitations: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.users WHERE lower(email)=lower($1)) AS users,
        (SELECT count(*)::int FROM public.account_setup_invitations
          WHERE company_id=$2) AS invitations
    `, [email, companyId]);
    expect(afterDuplicate.rows[0]).toEqual({ users: 1, invitations: 1 });

    await expect(authorizeAccountSetupDelivery(
      invitation.invitationId,
      invitation.rawToken,
    )).resolves.toBe(true);
    await recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: true,
      providerMessageId: "native-provider-fixture",
      providerName: "resend",
      status: "sent",
    });
    await expect(syncCompanyAdministrator(
      owner,
      companyId,
      "Native delivered invitation lifecycle synchronization",
    )).resolves.toMatchObject({
      companyId,
      eventKey: "company.administrator_invited",
    });
    await expect(inspectAccountSetupToken(invitation.rawToken)).resolves.toMatchObject({
      valid: true,
      role: "COMPANY_ADMIN",
      locale: "ar",
    });

    const password = "Native-First-Admin-Setup-Password!2026";
    const completions = await Promise.allSettled([
      consumeAccountSetupToken(invitation.rawToken, password, {
        displayName: "Native Company Administrator",
        locale: "ar",
        termsAccepted: true,
        privacyAccepted: true,
      }),
      consumeAccountSetupToken(invitation.rawToken, password, {
        displayName: "Native Company Administrator",
        locale: "ar",
        termsAccepted: true,
        privacyAccepted: true,
      }),
    ]);
    expect(completions.filter((outcome) => outcome.status === "fulfilled"))
      .toHaveLength(1);
    expect(completions.filter((outcome) => outcome.status === "rejected"))
      .toHaveLength(1);

    const lifecycle = await admin.query<{
      status: string;
      accountStatus: string;
      membershipStatus: string;
      consumed: number;
      assignments: number;
    }>(`
      SELECT company.lifecycle_status AS status,
        account.account_status AS "accountStatus",
        membership.status AS "membershipStatus",
        (SELECT count(*)::int FROM public.account_setup_invitations current
          WHERE current.id=$2 AND current.consumed_at IS NOT NULL) AS consumed,
        (SELECT count(*)::int FROM public.role_assignments current
          WHERE current.user_id=$3 AND current.active AND current.revoked_at IS NULL)
          AS assignments
      FROM public.companies company
      JOIN public.users account ON account.id=$3
      JOIN public.company_memberships membership
        ON membership.user_id=account.id AND membership.company_id=company.id
      WHERE company.id=$1
    `, [companyId, invitation.invitationId, invitation.userId]);
    expect(lifecycle.rows[0]).toEqual({
      status: "COMPANY_ADMINISTRATOR_ACTIVATED",
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      consumed: 1,
      assignments: 1,
    });
    const credential = await admin.query<{ passwordHash: string }>(`
      SELECT password_hash AS "passwordHash"
      FROM public.account_credentials WHERE user_id=$1
    `, [invitation.userId]);
    await expect(verifyPassword(
      password,
      credential.rows[0]?.passwordHash ?? "invalid",
    )).resolves.toBe(true);
    const previousSessionSecret = process.env.SESSION_SECRET;
    const authenticated = await (async () => {
      process.env.SESSION_SECRET = previousSessionSecret
        ?? "public-native-postgres-session-secret-fixture";
      try {
        return await authenticate(email, password, {
          networkIdentifier: "127.0.0.1",
        });
      } finally {
        if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = previousSessionSecret;
      }
    })();
    expect(authenticated).toMatchObject({
      id: invitation.userId,
      role: "COMPANY_ADMIN",
      companyId,
      scopeType: "COMPANY",
    });
  }, 30_000);

  it("creates Platform and later active-Company users without an assignment claim", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const companyId = randomUUID();
    const platformEmail = `native-platform-${randomUUID()}@example.test`;
    const companyEmail = `native-company-later-${randomUUID()}@example.test`;
    await admin.query(
      `INSERT INTO public.companies(
         id,company_code,name,legal_name,registration_number,industry,
         active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
       ) VALUES (
         $1,$2,'Native active company','Native active company','',
         'Operations',true,'ACTIVE',true,0,$3
       )`,
      [companyId, `ACTIVE-${companyId.slice(0, 8)}`, owner.id],
    );

    const [platformInvitation, companyInvitation] = await Promise.all([
      createInvitedUser({
        email: platformEmail,
        displayName: "Native Human Resources",
        role: "HUMAN_RESOURCES_MANAGEMENT",
        preferredLocale: "en",
      }, owner),
      createInvitedUser({
        email: companyEmail,
        displayName: "Native Company Approver",
        role: "COMPANY_APPROVER",
        companyId,
        preferredLocale: "ms",
      }, owner),
    ]);

    const graph = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM public.users account
      JOIN public.role_assignments assignment
        ON assignment.user_id=account.id AND assignment.active
      JOIN public.account_setup_invitations invitation
        ON invitation.user_id=account.id
      WHERE account.id IN ($1,$2)
        AND (
          (account.account_kind='PLATFORM' AND assignment.scope_type='PLATFORM')
          OR (
            account.account_kind='COMPANY'
            AND assignment.scope_type='COMPANY'
            AND assignment.company_id=$3
          )
        )
    `, [platformInvitation.userId, companyInvitation.userId, companyId]);
    expect(graph.rows[0]?.count).toBe(2);
  }, 30_000);

  it("serializes concurrent duplicate invitations into one account graph", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const companyId = randomUUID();
    const email = `native-concurrent-${randomUUID()}@example.test`;
    await admin.query(
      `INSERT INTO public.companies(
         id,company_code,name,legal_name,registration_number,industry,
         active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
       ) VALUES (
         $1,$2,'Native concurrent company','Native concurrent company','',
         'Operations',true,'ACTIVE',true,0,$3
       )`,
      [companyId, `RACE-${companyId.slice(0, 8)}`, owner.id],
    );
    const payload = {
      email,
      displayName: "Native Concurrent Approver",
      role: "COMPANY_APPROVER" as const,
      companyId,
      preferredLocale: "en" as const,
    };

    const outcomes = await Promise.allSettled([
      createInvitedUser(payload, owner),
      createInvitedUser(payload, owner),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { name: "UserCreationError", reason: "invitation-pending" },
    });

    const graph = await admin.query<{ users: number; invitations: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.users
          WHERE lower(email)=lower($1)) AS users,
        (SELECT count(*)::int
          FROM public.account_setup_invitations invitation
          JOIN public.users account ON account.id=invitation.user_id
          WHERE lower(account.email)=lower($1)) AS invitations
    `, [email]);
    expect(graph.rows[0]).toEqual({ users: 1, invitations: 1 });
  }, 30_000);

  it("applies a valid customized Company Administrator permission selection without an assignment claim", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const companyId = randomUUID();
    const email = `native-company-custom-${randomUUID()}@example.test`;
    const defaults = defaultPermissionsForRole("COMPANY_ADMIN", "COMPANY", false);
    const extraPermission = await admin.query<{ code: PermissionCode }>(`
      SELECT permission.permission_code AS code
      FROM public.permissions permission
      JOIN public.role_permissions owner_permission
        ON owner_permission.permission_id=permission.id
      JOIN public.roles owner_role
        ON owner_role.id=owner_permission.role_id
       AND owner_role.role_key='PLATFORM_OWNER'
      WHERE permission.active
        AND public.axora_permission_allowed_for_account_kind(
          'COMPANY',permission.permission_code
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.role_permissions target_permission
          JOIN public.roles target_role ON target_role.id=target_permission.role_id
          WHERE target_role.role_key='COMPANY_ADMIN'
            AND target_permission.permission_id=permission.id
        )
      ORDER BY permission.permission_code
      LIMIT 1
    `);
    const extra = extraPermission.rows[0]?.code;
    if (!extra) throw new Error("A compatible custom permission fixture is unavailable.");
    await admin.query(
      `INSERT INTO public.companies(
         id,company_code,name,legal_name,registration_number,industry,
         active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
       ) VALUES (
         $1,$2,'Native custom company','Native custom company','',
         'Operations',false,'ONBOARDING',false,0,$3
       )`,
      [companyId, `CUSTOM-${companyId.slice(0, 8)}`, owner.id],
    );

    const invitation = await createInvitedUser({
      email,
      displayName: "Native Custom Administrator",
      role: "COMPANY_ADMIN",
      companyId,
      preferredLocale: "en",
      permissions: [...defaults, extra],
    }, owner);
    expect(invitation.userId).toMatch(/^[0-9a-f-]{36}$/i);

    const history = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM public.permission_change_history
      WHERE actor_user_id=$1 AND target_user_id=$2
        AND reason='INITIAL_USER_PERMISSIONS_APPLIED'
    `, [owner.id, invitation.userId]);
    expect(history.rows[0]?.count).toBe(1);
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
