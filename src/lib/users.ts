import type { PoolClient } from "pg";
import { z } from "zod";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { SessionUser } from "./auth";
import { PENDING_ACCOUNT_PASSWORD_HASH } from "./password-policy";
import {
  accountRoleDefinition,
  canonicalAccountRole,
  creatableAccountRoles,
} from "./role-catalog";
import type { AccountKind, RoleScopeType, UserRecord, UserRole } from "./types";
import type { SupportedLocale } from "./i18n";

declare global {
  var __axoraDemoUsers: UserRecord[] | undefined;
}

function demoUsers() {
  if (!global.__axoraDemoUsers) global.__axoraDemoUsers = [{ id: "demo-admin", email: process.env.DEMO_EMAIL || "demo@axora.local",
    displayName: "Axora demo administrator", role: "ADMIN", active: true, isOwner: true, createdAt: new Date().toISOString() }];
  return global.__axoraDemoUsers;
}

export async function listUsers(actor: SessionUser): Promise<UserRecord[]> {
  if (isDemoMode()) return demoUsers();
  const result = await query<UserRecord>(`SELECT u.id::text,u.email,u.display_name AS "displayName",
    COALESCE(scoped_role.role_key,legacy_role.role_key) AS role,u.active,
    u.is_owner AS "isOwner",u.account_kind AS "accountKind",u.account_status AS "accountStatus",
    assignment.scope_type AS "scopeType",
    COALESCE(assignment.company_id,u.company_id)::text AS "companyId",c.name AS "companyName",
    COALESCE(assignment.branch_id,u.branch_id)::text AS "branchId",b.name AS "branchName",
    assignment.department_id::text AS "departmentId",department.name AS "departmentName",
    assignment.supplier_id::text AS "supplierId",supplier.name AS "supplierName",
    profile.job_title AS "jobTitle",
    u.account_setup_completed_at::text AS "accountSetupCompletedAt",
    setup.delivery_status AS "accountSetupDeliveryStatus",
    setup.expires_at::text AS "accountSetupExpiresAt",
    setup.sent_at::text AS "accountSetupSentAt",
    setup.delivery_attempted_at::text AS "accountSetupDeliveryAttemptedAt",
    u.last_login_at::text AS "lastLoginAt",u.created_at::text AS "createdAt"
    FROM users u
    JOIN roles legacy_role ON legacy_role.id=u.role_id
    LEFT JOIN LATERAL (
      SELECT current_assignment.id,current_assignment.role_id,current_assignment.scope_type,
        current_assignment.company_id,current_assignment.branch_id,
        current_assignment.department_id,current_assignment.supplier_id
      FROM role_assignments current_assignment
      WHERE current_assignment.user_id=u.id
        AND current_assignment.active=true
        AND (
          $1::boolean OR (
            current_assignment.company_id=$2::uuid
            AND (
              $3::uuid IS NULL
              OR current_assignment.branch_id=$3::uuid
              OR u.id=$4::uuid
            )
          )
        )
      ORDER BY current_assignment.assigned_at DESC,current_assignment.id
      LIMIT 1
    ) assignment ON true
    LEFT JOIN roles scoped_role ON scoped_role.id=assignment.role_id
    LEFT JOIN companies c ON c.id=COALESCE(assignment.company_id,u.company_id)
    LEFT JOIN branches b ON b.id=COALESCE(assignment.branch_id,u.branch_id)
    LEFT JOIN departments department
      ON department.id=assignment.department_id
     AND department.company_id=assignment.company_id
    LEFT JOIN suppliers supplier ON supplier.id=assignment.supplier_id
    LEFT JOIN user_profiles profile ON profile.user_id=u.id
    LEFT JOIN LATERAL (
      SELECT i.delivery_status,i.expires_at,i.sent_at,i.delivery_attempted_at
      FROM account_setup_invitations i
      WHERE i.user_id=u.id
      ORDER BY i.created_at DESC
      LIMIT 1
    ) setup ON true
    WHERE ($1::boolean OR (
      u.account_kind='COMPANY'
      AND COALESCE(assignment.company_id,u.company_id)=$2::uuid
      AND ($3::uuid IS NULL OR COALESCE(assignment.branch_id,u.branch_id)=$3 OR u.id=$4::uuid)
    ))
    ORDER BY u.display_name`, [actor.isOwner, actor.companyId ?? null, actor.branchId ?? null, actor.id]);
  return result.rows;
}

export interface UserCreationInput {
  email: string;
  displayName: string;
  role: UserRole;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  jobTitle?: string;
  preferredLocale?: SupportedLocale;
}

export interface ResolvedUserCreation {
  email: string;
  displayName: string;
  role: UserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  jobTitle?: string;
  preferredLocale: SupportedLocale;
}

export interface ValidatedUserCreation extends ResolvedUserCreation {
  organizationName: string;
  branchName?: string;
}

const USER_EMAIL_SCHEMA = z.email().max(254);

/** Resolve actor-controlled tenant and role scope before any credential work. */
export function resolveUserCreation(
  input: UserCreationInput,
  actor: SessionUser,
): ResolvedUserCreation {
  const role = canonicalAccountRole(input.role, actor.branchId ?? input.branchId);
  const definition = accountRoleDefinition(role);
  if (!definition || !creatableAccountRoles(actor).some((allowedRole) => allowedRole.key === role)) {
    throw new Error("Your account cannot create this role.");
  }

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!USER_EMAIL_SCHEMA.safeParse(email).success) {
    throw new Error("Enter a valid work email address.");
  }
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error("Enter a name between 2 and 200 characters.");
  }
  const jobTitle = input.jobTitle?.trim() || undefined;
  if (jobTitle && jobTitle.length > 160) throw new Error("Job title cannot exceed 160 characters.");
  const preferredLocale = input.preferredLocale ?? actor.preferredLocale ?? "en";

  if (definition.accountKind === "PLATFORM") {
    return { email, displayName, role, accountKind: "PLATFORM", scopeType: "PLATFORM", jobTitle, preferredLocale };
  }
  if (definition.accountKind === "SUPPLIER") {
    if (!actor.isOwner || !input.supplierId) throw new Error("Select the supplier organization for this user.");
    return { email, displayName, role, accountKind: "SUPPLIER", scopeType: "SUPPLIER", supplierId: input.supplierId, jobTitle, preferredLocale };
  }
  if (definition.accountKind === "DELIVERY") {
    return { email, displayName, role, accountKind: "DELIVERY", scopeType: "DELIVERY", jobTitle, preferredLocale };
  }

  const companyId = actor.isOwner ? input.companyId : actor.companyId;
  if (!companyId) throw new Error("Select the approved customer company for this user.");
  const requestedBranchId = actor.branchId ?? input.branchId;
  const scopeType: RoleScopeType = requestedBranchId && definition.allowedScopes.includes("BRANCH")
    ? "BRANCH"
    : "COMPANY";
  if (!definition.allowedScopes.includes(scopeType)) {
    throw new Error("Select the branch this person will work with.");
  }
  const branchId = scopeType === "BRANCH" ? requestedBranchId : undefined;
  if (actor.role === "BRANCH_ADMIN" && (!branchId || branchId !== actor.branchId)) {
    throw new Error("A branch administrator can create users only in their assigned branch.");
  }

  return { email, displayName, role, accountKind: "COMPANY", scopeType, companyId, branchId, jobTitle, preferredLocale };
}

/** Lock and validate the tenant records used by a new account transaction. */
async function validateUserCreation(
  client: PoolClient,
  input: ResolvedUserCreation,
): Promise<ValidatedUserCreation> {
  let organizationName = "Axora";
  let branchName: string | undefined;
  if (input.accountKind === "COMPANY") {
    const company = await client.query<{ name: string }>(
      "SELECT name FROM companies WHERE id=$1 AND active=true FOR KEY SHARE",
      [input.companyId],
    );
    if (!company.rowCount) throw new Error("The selected company is not active.");
    organizationName = company.rows[0].name;
  }
  if (input.scopeType === "BRANCH") {
    const branch = await client.query<{ name: string }>(
      `SELECT name FROM branches
       WHERE id=$1 AND company_id=$2 AND active=true
       FOR KEY SHARE`,
      [input.branchId, input.companyId],
    );
    if (!branch.rowCount) {
      throw new Error("The selected branch is not active or belongs to another company.");
    }
    branchName = branch.rows[0].name;
  }
  if (input.accountKind === "SUPPLIER") {
    const supplier = await client.query<{ name: string }>(
      "SELECT name FROM suppliers WHERE id=$1 AND active=true FOR KEY SHARE",
      [input.supplierId],
    );
    if (!supplier.rowCount) throw new Error("The selected supplier is not active.");
    organizationName = supplier.rows[0].name;
  }

  return { ...input, organizationName, branchName };
}

async function insertUser(
  client: PoolClient,
  input: ResolvedUserCreation,
  credentials: UserCredentialState,
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users(
       email,display_name,password_hash,role_id,company_id,branch_id,is_owner,
       account_setup_completed_at,account_kind,account_status
     ) VALUES (
       $1,$2,$3,(SELECT id FROM roles WHERE role_key=$4),$5,$6,$7,
       CASE WHEN $8::boolean THEN now() ELSE NULL END,$9,
       CASE WHEN $8::boolean THEN 'ACTIVE' ELSE 'INVITED' END
     ) RETURNING id::text`,
    [
      input.email,
      input.displayName,
      credentials.passwordHash,
      input.role,
      input.companyId ?? null,
      input.branchId ?? null,
      input.role === "PLATFORM_OWNER",
      credentials.setupCompleted,
      input.accountKind,
    ],
  );
  return result.rows[0].id;
}

export async function createScopedUserInTransaction(
  client: PoolClient,
  input: ResolvedUserCreation,
  credentials: UserCredentialState,
) {
  const validated = await validateUserCreation(client, input);
  const userId = await insertUser(client, input, credentials);
  return { userId, validated };
}

type UserCredentialState =
  | { passwordHash: string; setupCompleted: true }
  | {
    passwordHash: typeof PENDING_ACCOUNT_PASSWORD_HASH;
    setupCompleted: false;
  };

export async function setUserActive(id: string, active: boolean, actor: SessionUser) {
  if (id === actor.id && !active) throw new Error("You cannot deactivate your own signed-in account.");
  if (isDemoMode()) {
    const user = demoUsers().find((item) => item.id === id);
    if (!user) throw new Error("User not found.");
    if (user.isOwner && !active
      && demoUsers().filter((item) => item.active && item.isOwner).length <= 1) {
      throw new Error("The last active platform owner cannot be deactivated.");
    }
    user.active = active;
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: active ? "Account activated" : "Account deactivated" }, async (client) => {
    const targetResult = await selectManagedTarget(client, id);
    const target = targetResult.rows[0];
    assertActorCanManageTarget(target, actor);
    if (!active && target.active && target.setupCompleted) {
      await protectLastRequiredAdministrator(client, target);
    }
    // Revoke a pending bearer link while the invitation trigger still sees an
    // INVITED account. The account status is suspended immediately afterward
    // in the same transaction, so no setup link can race the deactivation.
    if (!active) {
      await client.query(
        `UPDATE account_setup_invitations
         SET revoked_at=now(),
             delivery_status=CASE
               WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED'
               ELSE delivery_status
             END
         WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [id],
      );
    }
    await client.query(
      `UPDATE users
       SET active=$2,
           account_status=CASE
             WHEN $2 AND account_setup_completed_at IS NOT NULL THEN 'ACTIVE'
             WHEN $2 THEN 'INVITED'
             ELSE 'SUSPENDED'
           END,
           auth_version=CASE WHEN active IS DISTINCT FROM $2
             THEN auth_version+1 ELSE auth_version END
       WHERE id=$1`,
      [id, active],
    );
  });
}

interface ManagedUserTarget {
  active: boolean;
  isOwner: boolean;
  role: UserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  setupCompleted: boolean;
}

function selectManagedTarget(client: PoolClient, id: string) {
  return client.query<ManagedUserTarget>(
    `SELECT u.active,u.is_owner AS "isOwner",
       COALESCE(scoped_role.role_key,legacy_role.role_key) AS role,
       u.account_kind AS "accountKind",
       COALESCE(assignment.scope_type,
         CASE WHEN u.is_owner THEN 'PLATFORM'
              WHEN u.branch_id IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END
       ) AS "scopeType",
       COALESCE(assignment.company_id,u.company_id)::text AS "companyId",
       COALESCE(assignment.branch_id,u.branch_id)::text AS "branchId",
       assignment.supplier_id::text AS "supplierId",
       (u.account_setup_completed_at IS NOT NULL) AS "setupCompleted"
     FROM users u
     JOIN roles legacy_role ON legacy_role.id=u.role_id
     LEFT JOIN LATERAL (
       SELECT scoped.id,scoped.role_id,scoped.scope_type,scoped.company_id,
         scoped.branch_id,scoped.supplier_id
       FROM role_assignments scoped
       WHERE scoped.user_id=u.id AND scoped.active=true
       ORDER BY scoped.assigned_at DESC,scoped.id
       LIMIT 1
     ) assignment ON true
     LEFT JOIN roles scoped_role ON scoped_role.id=assignment.role_id
     WHERE u.id=$1
     FOR UPDATE OF u`,
    [id],
  );
}

const BRANCH_MANAGED_ROLES = new Set<UserRole>([
  "BRANCH_APPROVER", "APPROVER", "REQUESTER", "RECEIVING_USER",
]);

function assertActorCanManageTarget(
  target: ManagedUserTarget | undefined,
  actor: SessionUser,
) {
  if (!target) throw new Error("User not found.");
  if (actor.isOwner && actor.accountKind !== "COMPANY") return;
  if ((actor.role === "ADMIN" || actor.role === "COMPANY_ADMIN")
    && target.accountKind === "COMPANY"
    && Boolean(actor.companyId) && actor.companyId === target.companyId) return;
  if (actor.role === "BRANCH_ADMIN"
    && target.accountKind === "COMPANY"
    && actor.companyId === target.companyId
    && Boolean(actor.branchId) && actor.branchId === target.branchId
    && BRANCH_MANAGED_ROLES.has(target.role)) return;
  throw new Error("Your account cannot manage this user.");
}

async function protectLastRequiredAdministrator(
  client: PoolClient,
  target: ManagedUserTarget,
) {
  if (target.role === "PLATFORM_OWNER" || target.isOwner) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('axora-platform-owner-protection',0))");
    const owners = await client.query<{ count: string }>(
      `SELECT count(DISTINCT account.id)::text AS count
       FROM users account
       WHERE account.active=true
         AND account.account_status='ACTIVE'
         AND account.account_setup_completed_at IS NOT NULL
         AND (
           account.is_owner=true OR EXISTS (
             SELECT 1 FROM role_assignments assignment
             JOIN roles role ON role.id=assignment.role_id
             WHERE assignment.user_id=account.id AND assignment.active=true
               AND assignment.scope_type='PLATFORM'
               AND role.role_key='PLATFORM_OWNER'
           )
         )`,
    );
    if (Number(owners.rows[0]?.count ?? 0) <= 1) {
      throw new Error("The last active platform owner cannot be deactivated.");
    }
  }

  if ((target.role === "COMPANY_ADMIN" || target.role === "ADMIN") && target.companyId) {
    await client.query("SELECT 1 FROM companies WHERE id=$1 FOR UPDATE", [target.companyId]);
    const administrators = await client.query<{ count: string }>(
      `SELECT count(DISTINCT account.id)::text AS count
       FROM users account
       JOIN roles legacy_role ON legacy_role.id=account.role_id
       WHERE account.active=true
         AND account.account_status='ACTIVE'
         AND account.account_setup_completed_at IS NOT NULL
         AND account.company_id=$1::uuid
         AND (
           legacy_role.role_key IN ('ADMIN','COMPANY_ADMIN') OR EXISTS (
             SELECT 1 FROM role_assignments assignment
             JOIN roles role ON role.id=assignment.role_id
             WHERE assignment.user_id=account.id AND assignment.active=true
               AND assignment.scope_type='COMPANY'
               AND assignment.company_id=$1::uuid
               AND role.role_key='COMPANY_ADMIN'
           )
         )`,
      [target.companyId],
    );
    if (Number(administrators.rows[0]?.count ?? 0) <= 1) {
      throw new Error("The last active company administrator cannot be deactivated.");
    }
  }
}