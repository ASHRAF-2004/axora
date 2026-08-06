import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { canAccess, type Permission } from "./permissions";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password-policy";
import {
  isAccountKind,
  isRoleScopeType,
  isUserRole,
  type AccountKind,
  type KnownUserRole,
  type RoleScopeType,
  type UserRole,
} from "./types";
import { isSupportedLocale, type SupportedLocale } from "./i18n";
import { hasCompletedRequiredProfile } from "./onboarding-policy";

const COOKIE_NAME = "axora_session";
const STEP_UP_COOKIE_NAME = "axora_stepup";
const SESSION_HOURS = 8;
const SESSION_SECONDS = SESSION_HOURS * 60 * 60;
const STEP_UP_SECONDS = 15 * 60;

type StepUpSessionPurpose = "sensitive-admin-action";

interface StepUpClaim {
  actorId: string;
  sessionTokenHash: string;
  role: UserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  roleAssignmentId?: string;
  authVersion: number;
  purpose: StepUpSessionPurpose;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  accountKind?: AccountKind;
  scopeType?: RoleScopeType;
  roleAssignmentId?: string;
  isOwner: boolean;
  /** Database-bound session generation used to revoke older signed cookies. */
  authVersion?: number;
  /** Current profile preference; live DB state, not an authorization claim. */
  preferredLocale?: SupportedLocale;
  /** Current profile timezone; live DB state, not an authorization claim. */
  timezone?: string;
}

export type AuthenticatedSessionUser = Omit<
  SessionUser,
  "role" | "accountKind" | "scopeType" | "authVersion"
> & {
  role: KnownUserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  authVersion: number;
};

export interface IdentityCandidateRow {
  id: string;
  email: string;
  displayName: string;
  preferredLocale?: string;
  timezone?: string;
  profileCompletedAt?: string;
  requiredPolicyVersion?: string;
  requiredPolicyAcceptedAt?: string;
  legacyRole: string;
  accountKind: string;
  isOwner: boolean;
  authVersion: number;
  legacyCompanyId?: string;
  legacyBranchId?: string;
  legacyCompanyActive?: boolean;
  legacyCompanyMembershipStatus?: string;
  legacyBranchActive?: boolean;
  legacyBranchAssignmentStatus?: string;
  assignmentId?: string;
  assignedRole?: string;
  assignmentActive?: boolean;
  assignmentRevokedAt?: string;
  assignedAt?: string;
  scopeType?: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  scopeCompanyActive?: boolean;
  companyMembershipStatus?: string;
  companyMembershipPrimary?: boolean;
  scopeBranchActive?: boolean;
  branchAssignmentStatus?: string;
  branchAssignmentPrimary?: boolean;
  scopeDepartmentActive?: boolean;
  scopeDepartmentBranchId?: string;
  departmentAssignmentStatus?: string;
  departmentAssignmentPrimary?: boolean;
  scopeSupplierActive?: boolean;
  supplierMembershipStatus?: string;
  deliveryProfileActive?: boolean;
}

interface LoginAccountRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  authVersion: number;
  lockedUntil?: string;
}

function safePathReturn(rawNext?: string) {
  if (!rawNext || rawNext.includes("\u0000")) return "/account";
  const candidate = String(rawNext).trim();
  if (!candidate) return "/account";
  const trimmed = candidate.slice(0, 2048);
  try {
    const parsed = new URL(trimmed, "https://axora.management");
    if (parsed.origin !== "https://axora.management" || !parsed.pathname.startsWith("/")) return "/account";
    if (parsed.pathname.startsWith("//")) return "/account";
    const safe = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return safe.length <= 2048 ? safe : "/account";
  } catch {
    return "/account";
  }
}

async function encodeStepUpCookie(
  actor: SessionUser,
  sessionTokenHash: string,
  purpose: StepUpSessionPurpose,
) {
  const secret = secretKey();
  return new SignJWT({
    actorId: actor.id,
    sessionTokenHash,
    role: actor.role,
    accountKind: actor.accountKind,
    scopeType: actor.scopeType,
    companyId: actor.companyId,
    branchId: actor.branchId,
    departmentId: actor.departmentId,
    supplierId: actor.supplierId,
    roleAssignmentId: actor.roleAssignmentId,
    authVersion: actor.authVersion ?? 1,
    purpose,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("stepup")
    .setIssuedAt()
    .setExpirationTime(`${STEP_UP_SECONDS}s`)
    .sign(secret);
}

async function stepUpState() {
  const store = await cookies();
  const stepToken = store.get(STEP_UP_COOKIE_NAME)?.value;
  if (!stepToken) return null;
  try {
    const { payload } = await jwtVerify(stepToken, secretKey(), {
      algorithms: ["HS256"],
      subject: "stepup",
    });
    const claims = payload as unknown as StepUpClaim & {
      purpose: StepUpSessionPurpose;
      iat?: number;
    };
    if (claims.purpose !== "sensitive-admin-action") return null;
    if (!isUserRole(claims.role) || !isAccountKind(claims.accountKind)
      || !isRoleScopeType(claims.scopeType)
      || typeof claims.sessionTokenHash !== "string"
      || typeof claims.actorId !== "string"
      || claims.actorId.length < 10
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.actorId)
      || typeof claims.authVersion !== "number"
      || claims.authVersion < 1
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

const AUTHENTICATION_DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=1$m9vEaBMebZQ51/24iNTNzQ$uZKeQkj7f+HkjFqHIj8er6tsu1anDuLYQ3T+/ZAKcDQ";
const ACCOUNT_FAILURE_WINDOW_MINUTES = 15;
const ACCOUNT_FAILURE_LIMIT = 5;
const ACCOUNT_LOCK_MINUTES = 15;

const identityRowsSql = `
  SELECT
    account.id::text AS id,
    account.email,
    COALESCE(profile.display_name,account.display_name) AS "displayName",
    profile.preferred_locale AS "preferredLocale",
    profile.timezone,
    profile.profile_completed_at::text AS "profileCompletedAt",
    profile.required_policy_version AS "requiredPolicyVersion",
    profile.required_policy_accepted_at::text AS "requiredPolicyAcceptedAt",
    legacy_role.role_key AS "legacyRole",
    account.account_kind AS "accountKind",
    account.is_owner AS "isOwner",
    account.auth_version::int AS "authVersion",
    account.company_id::text AS "legacyCompanyId",
    account.branch_id::text AS "legacyBranchId",
    legacy_company.active AS "legacyCompanyActive",
    legacy_membership.status AS "legacyCompanyMembershipStatus",
    legacy_branch.active AS "legacyBranchActive",
    legacy_branch_assignment.status AS "legacyBranchAssignmentStatus",
    assignment.id::text AS "assignmentId",
    assigned_role.role_key AS "assignedRole",
    assignment.active AS "assignmentActive",
    assignment.revoked_at::text AS "assignmentRevokedAt",
    assignment.assigned_at::text AS "assignedAt",
    assignment.scope_type AS "scopeType",
    assignment.company_id::text AS "companyId",
    assignment.branch_id::text AS "branchId",
    assignment.department_id::text AS "departmentId",
    assignment.supplier_id::text AS "supplierId",
    scope_company.active AS "scopeCompanyActive",
    scope_membership.status AS "companyMembershipStatus",
    scope_membership.is_primary AS "companyMembershipPrimary",
    scope_branch.active AS "scopeBranchActive",
    scope_branch_assignment.status AS "branchAssignmentStatus",
    scope_branch_assignment.is_primary AS "branchAssignmentPrimary",
    scope_department.active AS "scopeDepartmentActive",
    scope_department.branch_id::text AS "scopeDepartmentBranchId",
    scope_department_assignment.status AS "departmentAssignmentStatus",
    scope_department_assignment.is_primary AS "departmentAssignmentPrimary",
    scope_supplier.active AS "scopeSupplierActive",
    scope_supplier_membership.status AS "supplierMembershipStatus",
    delivery_profile.active AS "deliveryProfileActive"
  FROM users account
  JOIN roles legacy_role ON legacy_role.id=account.role_id
  LEFT JOIN user_profiles profile ON profile.user_id=account.id
  LEFT JOIN companies legacy_company ON legacy_company.id=account.company_id
  LEFT JOIN company_memberships legacy_membership
    ON legacy_membership.user_id=account.id
   AND legacy_membership.company_id=account.company_id
  LEFT JOIN branches legacy_branch
    ON legacy_branch.id=account.branch_id
   AND legacy_branch.company_id=account.company_id
  LEFT JOIN branch_assignments legacy_branch_assignment
    ON legacy_branch_assignment.user_id=account.id
   AND legacy_branch_assignment.company_id=account.company_id
   AND legacy_branch_assignment.branch_id=account.branch_id
  LEFT JOIN role_assignments assignment ON assignment.user_id=account.id
  LEFT JOIN roles assigned_role ON assigned_role.id=assignment.role_id
  LEFT JOIN companies scope_company ON scope_company.id=assignment.company_id
  LEFT JOIN company_memberships scope_membership
    ON scope_membership.user_id=account.id
   AND scope_membership.company_id=assignment.company_id
  LEFT JOIN branches scope_branch
    ON scope_branch.id=assignment.branch_id
   AND scope_branch.company_id=assignment.company_id
  LEFT JOIN branch_assignments scope_branch_assignment
    ON scope_branch_assignment.user_id=account.id
   AND scope_branch_assignment.company_id=assignment.company_id
   AND scope_branch_assignment.branch_id=assignment.branch_id
  LEFT JOIN departments scope_department
    ON scope_department.id=assignment.department_id
   AND scope_department.company_id=assignment.company_id
  LEFT JOIN department_assignments scope_department_assignment
    ON scope_department_assignment.user_id=account.id
   AND scope_department_assignment.company_id=assignment.company_id
   AND scope_department_assignment.department_id=assignment.department_id
  LEFT JOIN suppliers scope_supplier ON scope_supplier.id=assignment.supplier_id
  LEFT JOIN supplier_memberships scope_supplier_membership
    ON scope_supplier_membership.user_id=account.id
   AND scope_supplier_membership.supplier_id=assignment.supplier_id
  LEFT JOIN delivery_agent_profiles delivery_profile
    ON delivery_profile.user_id=account.id
  WHERE account.id=$1
    AND account.active=true
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL
    AND (
      $2::text IS NULL
      OR EXISTS (
        SELECT 1
        FROM user_sessions live_session
        WHERE live_session.user_id=account.id
          AND live_session.token_hash=$2
          AND live_session.revoked_at IS NULL
          AND live_session.expires_at > now()
      )
    )
  ORDER BY assignment.assigned_at DESC NULLS LAST, assignment.id`;

const platformOwnerRoles = new Set(["PLATFORM_OWNER", "ADMIN"]);
const platformActorRoles = new Set([
  "PLATFORM_OPERATIONS",
  "TECHNICAL_SUPPORT",
  "IT_SUPPORT",
]);
const companyScopeRoles = new Set([
  "COMPANY_ADMIN",
  "COMPANY_APPROVER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "RECEIVING_USER",
  "REQUESTER",
  "ADMIN",
  "APPROVER",
  "OPERATIONS",
  "FINANCE",
  "VIEWER",
]);
const branchScopeRoles = new Set([
  "BRANCH_ADMIN",
  "BRANCH_APPROVER",
  "REQUESTER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "RECEIVING_USER",
  "APPROVER",
  "OPERATIONS",
  "FINANCE",
  "VIEWER",
]);
const departmentScopeRoles = new Set([
  "DEPARTMENT_ADMIN",
  "REQUESTER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "RECEIVING_USER",
]);
const deliveryScopeRoles = new Set([
  "DELIVERY_TEAM_SUPERVISOR",
  "DELIVERY_AGENT",
  "DELIVERY_DRIVER",
]);
const legacyCompanyRoles = new Set([
  "ADMIN",
  "BRANCH_ADMIN",
  "APPROVER",
  "REQUESTER",
  "OPERATIONS",
  "FINANCE",
  "VIEWER",
]);

function secretKey() {
  const value = process.env.SESSION_SECRET_FILE && fs.existsSync(process.env.SESSION_SECRET_FILE)
    ? fs.readFileSync(process.env.SESSION_SECRET_FILE, "utf8").trim()
    : process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function authenticationRateKey(scope: "network" | "identifier", value: string) {
  const normalized = value.trim().toLowerCase().slice(0, 512) || "unavailable";
  return createHmac("sha256", secretKey())
    .update(`axora-login-${scope}-v1\0`, "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

async function consumeAuthenticationRateLimits(email: string, networkIdentifier?: string) {
  const scopes = [
    { kind: "IDENTIFIER", hash: authenticationRateKey("identifier", email), limit: 12 },
    ...(networkIdentifier?.trim()
      ? [{ kind: "NETWORK" as const, hash: authenticationRateKey("network", networkIdentifier), limit: 60 }]
      : []),
  ] as const;
  return withAuditTransaction(
    { reason: "Authentication rate-limit check" },
    async (client) => {
      for (const scope of scopes) {
        const consumed = await client.query(
          `INSERT INTO public_request_rate_buckets(
             action_key,scope_kind,scope_hash,bucket_started_at,request_count
           ) VALUES ('LOGIN',$1,$2,date_trunc('hour',now()),1)
           ON CONFLICT(action_key,scope_kind,scope_hash,bucket_started_at)
           DO UPDATE SET request_count=public_request_rate_buckets.request_count+1
           WHERE public_request_rate_buckets.request_count < $3
           RETURNING request_count`,
          [scope.kind, scope.hash, scope.limit],
        );
        if (!consumed.rowCount) return false;
      }
      return true;
    },
  );
}

async function recordFailedSignIn(userId: string) {
  await withAuditTransaction(
    { userId, reason: "Failed authentication attempt recorded" },
    async (client) => {
      await client.query(
        `UPDATE account_credentials
         SET failed_sign_in_count=CASE
               WHEN first_failed_sign_in_at IS NULL
                 OR first_failed_sign_in_at < now()-interval '${ACCOUNT_FAILURE_WINDOW_MINUTES} minutes'
               THEN 1 ELSE failed_sign_in_count+1 END,
             first_failed_sign_in_at=CASE
               WHEN first_failed_sign_in_at IS NULL
                 OR first_failed_sign_in_at < now()-interval '${ACCOUNT_FAILURE_WINDOW_MINUTES} minutes'
               THEN now() ELSE first_failed_sign_in_at END,
             locked_until=CASE
               WHEN (CASE
                 WHEN first_failed_sign_in_at IS NULL
                   OR first_failed_sign_in_at < now()-interval '${ACCOUNT_FAILURE_WINDOW_MINUTES} minutes'
                 THEN 1 ELSE failed_sign_in_count+1 END) >= ${ACCOUNT_FAILURE_LIMIT}
               THEN now()+interval '${ACCOUNT_LOCK_MINUTES} minutes'
               ELSE locked_until END,
             updated_at=now()
         WHERE user_id=$1`,
        [userId],
      );
    },
  );
}

function roleMatchesLegacyPreference(
  legacyRole: string,
  assignedRole: string,
  scopeType: RoleScopeType,
) {
  if (legacyRole === assignedRole) return true;
  if (legacyRole === "ADMIN") return assignedRole === "COMPANY_ADMIN";
  if (legacyRole === "APPROVER") {
    return assignedRole === (scopeType === "BRANCH" ? "BRANCH_APPROVER" : "COMPANY_APPROVER");
  }
  if (legacyRole === "OPERATIONS") return assignedRole === "REQUESTER";
  if (legacyRole === "FINANCE") return assignedRole === "FINANCE_REVIEWER";
  if (legacyRole === "VIEWER") return assignedRole === "AUDITOR";
  if (legacyRole === "IT_SUPPORT") return assignedRole === "TECHNICAL_SUPPORT";
  return false;
}

function roleFitsAccountScope(
  accountKind: AccountKind,
  isOwner: boolean,
  role: KnownUserRole,
  scopeType: RoleScopeType,
) {
  if (accountKind === "PLATFORM") {
    if (isOwner) {
      return scopeType === "PLATFORM" && platformOwnerRoles.has(role);
    }
    if (role === "CLIENT_ACCOUNT_MANAGER") return scopeType === "COMPANY";
    return scopeType === "PLATFORM" && platformActorRoles.has(role);
  }
  if (isOwner) return false;
  if (accountKind === "COMPANY") {
    if (scopeType === "COMPANY") return companyScopeRoles.has(role);
    if (scopeType === "BRANCH") return branchScopeRoles.has(role);
    return scopeType === "DEPARTMENT" && departmentScopeRoles.has(role);
  }
  if (accountKind === "SUPPLIER") {
    return scopeType === "SUPPLIER" && role === "SUPPLIER_USER";
  }
  return scopeType === "DELIVERY" && deliveryScopeRoles.has(role);
}

function validAssignmentCandidate(row: IdentityCandidateRow) {
  if (!row.assignmentId || row.assignmentActive !== true || row.assignmentRevokedAt
    || !isUserRole(row.assignedRole) || !isAccountKind(row.accountKind)
    || !isRoleScopeType(row.scopeType)) return false;
  if (!roleFitsAccountScope(row.accountKind, row.isOwner, row.assignedRole, row.scopeType)) {
    return false;
  }
  if (row.scopeType === "PLATFORM") {
    return !row.companyId && !row.branchId && !row.departmentId && !row.supplierId;
  }
  if (row.scopeType === "COMPANY") {
    const platformManager = row.accountKind === "PLATFORM"
      && row.assignedRole === "CLIENT_ACCOUNT_MANAGER";
    return Boolean(row.companyId) && !row.branchId && !row.departmentId && !row.supplierId
      && row.scopeCompanyActive === true
      && (platformManager || (
        row.accountKind === "COMPANY"
        && row.companyMembershipStatus === "ACTIVE"
      ));
  }
  if (row.scopeType === "BRANCH") {
    return Boolean(row.companyId && row.branchId) && !row.departmentId && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === "ACTIVE"
      && row.scopeBranchActive === true
      && row.branchAssignmentStatus === "ACTIVE";
  }
  if (row.scopeType === "DEPARTMENT") {
    return Boolean(row.companyId && row.departmentId) && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === "ACTIVE"
      && row.scopeDepartmentActive === true
      && row.departmentAssignmentStatus === "ACTIVE"
      && (!row.branchId || row.scopeDepartmentBranchId === row.branchId);
  }
  if (row.scopeType === "SUPPLIER") {
    return Boolean(row.supplierId) && !row.companyId && !row.branchId
      && !row.departmentId
      && row.scopeSupplierActive === true
      && row.supplierMembershipStatus === "ACTIVE";
  }
  return !row.companyId && !row.branchId && !row.departmentId && !row.supplierId
    && (row.assignedRole === "DELIVERY_TEAM_SUPERVISOR"
      || row.deliveryProfileActive === true);
}

function candidateScore(row: IdentityCandidateRow) {
  let score = roleMatchesLegacyPreference(
    row.legacyRole,
    row.assignedRole!,
    row.scopeType as RoleScopeType,
  ) ? 0 : 100;
  if (row.companyId && row.companyId !== row.legacyCompanyId) score += 20;
  if (row.branchId && row.branchId !== row.legacyBranchId) score += 10;
  if (row.companyMembershipPrimary === false) score += 2;
  if (row.branchAssignmentPrimary === false) score += 1;
  if (row.departmentAssignmentPrimary === false) score += 1;
  return score;
}

function sessionFromAssignment(row: IdentityCandidateRow): AuthenticatedSessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.displayName,
    role: row.assignedRole as KnownUserRole,
    accountKind: row.accountKind as AccountKind,
    scopeType: row.scopeType as RoleScopeType,
    roleAssignmentId: row.assignmentId,
    ...(row.companyId ? { companyId: row.companyId } : {}),
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.departmentId ? { departmentId: row.departmentId } : {}),
    ...(row.supplierId ? { supplierId: row.supplierId } : {}),
    isOwner: row.isOwner,
    authVersion: Number(row.authVersion),
    ...(isSupportedLocale(row.preferredLocale) ? { preferredLocale: row.preferredLocale } : {}),
    ...(row.timezone ? { timezone: row.timezone } : {}),
  };
}

function legacyFallback(row: IdentityCandidateRow): AuthenticatedSessionUser | null {
  if (!isUserRole(row.legacyRole) || !isAccountKind(row.accountKind)) return null;
  if (row.accountKind === "PLATFORM") {
    const validPlatformRole = row.isOwner
      ? row.legacyRole === "ADMIN"
      : row.legacyRole === "IT_SUPPORT";
    if (!validPlatformRole) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.displayName,
      role: row.legacyRole,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: row.isOwner,
      authVersion: Number(row.authVersion),
      ...(isSupportedLocale(row.preferredLocale) ? { preferredLocale: row.preferredLocale } : {}),
      ...(row.timezone ? { timezone: row.timezone } : {}),
    };
  }
  if (row.accountKind !== "COMPANY" || row.isOwner
    || !legacyCompanyRoles.has(row.legacyRole)
    || !row.legacyCompanyId || row.legacyCompanyActive !== true
    || row.legacyCompanyMembershipStatus !== "ACTIVE") return null;
  const hasBranch = Boolean(row.legacyBranchId);
  if (hasBranch && (row.legacyBranchActive !== true
    || row.legacyBranchAssignmentStatus !== "ACTIVE")) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.displayName,
    role: row.legacyRole,
    accountKind: "COMPANY",
    scopeType: hasBranch ? "BRANCH" : "COMPANY",
    companyId: row.legacyCompanyId,
    ...(row.legacyBranchId ? { branchId: row.legacyBranchId } : {}),
    isOwner: false,
    authVersion: Number(row.authVersion),
    ...(isSupportedLocale(row.preferredLocale) ? { preferredLocale: row.preferredLocale } : {}),
    ...(row.timezone ? { timezone: row.timezone } : {}),
  };
}

export function sessionScopeIsValid(user: SessionUser): user is AuthenticatedSessionUser {
  if (!isUserRole(user.role) || !isAccountKind(user.accountKind)
    || !isRoleScopeType(user.scopeType)
    || !Number.isInteger(Number(user.authVersion)) || Number(user.authVersion) < 1
    || !roleFitsAccountScope(user.accountKind, user.isOwner, user.role, user.scopeType)) {
    return false;
  }
  if (user.scopeType === "PLATFORM" || user.scopeType === "DELIVERY") {
    return !user.companyId && !user.branchId && !user.departmentId && !user.supplierId;
  }
  if (user.scopeType === "SUPPLIER") {
    return Boolean(user.supplierId) && !user.companyId && !user.branchId
      && !user.departmentId;
  }
  if (!user.companyId || user.supplierId) return false;
  if (user.scopeType === "COMPANY") return !user.branchId && !user.departmentId;
  if (user.scopeType === "BRANCH") return Boolean(user.branchId) && !user.departmentId;
  return user.scopeType === "DEPARTMENT" && Boolean(user.departmentId);
}

export function resolveActiveIdentityCandidates(
  rows: readonly IdentityCandidateRow[],
): AuthenticatedSessionUser | null {
  const first = rows[0];
  if (!first || !isAccountKind(first.accountKind)
    || !Number.isInteger(Number(first.authVersion)) || Number(first.authVersion) < 1) return null;
  const hasAssignmentHistory = rows.some((row) => Boolean(row.assignmentId));
  if (!hasAssignmentHistory) {
    const fallback = legacyFallback(first);
    return fallback && sessionScopeIsValid(fallback) ? fallback : null;
  }
  const candidates = rows.filter(validAssignmentCandidate).sort((left, right) => (
    candidateScore(left) - candidateScore(right)
      || String(right.assignedAt ?? "").localeCompare(String(left.assignedAt ?? ""))
      || String(left.assignmentId).localeCompare(String(right.assignmentId))
  ));
  const resolved = candidates[0] ? sessionFromAssignment(candidates[0]) : null;
  return resolved && sessionScopeIsValid(resolved) ? resolved : null;
}

export function liveSessionScopeMatches(tokenUser: SessionUser, liveUser: SessionUser) {
  return tokenUser.id === liveUser.id
    && tokenUser.role === liveUser.role
    && tokenUser.accountKind === liveUser.accountKind
    && tokenUser.scopeType === liveUser.scopeType
    && tokenUser.roleAssignmentId === liveUser.roleAssignmentId
    && tokenUser.companyId === liveUser.companyId
    && tokenUser.branchId === liveUser.branchId
    && tokenUser.departmentId === liveUser.departmentId
    && tokenUser.supplierId === liveUser.supplierId
    && tokenUser.isOwner === liveUser.isOwner
    && Number(tokenUser.authVersion) === Number(liveUser.authVersion);
}

interface LiveIdentity {
  user: AuthenticatedSessionUser;
  onboardingComplete: boolean;
}

async function loadActiveIdentity(userId: string, liveTokenHash?: string): Promise<LiveIdentity | null> {
  const result = await query<IdentityCandidateRow>(identityRowsSql, [
    userId,
    liveTokenHash ?? null,
  ]);
  const user = resolveActiveIdentityCandidates(result.rows);
  if (!user) return null;
  return {
    user,
    onboardingComplete: hasCompletedRequiredProfile(result.rows[0] ?? {}),
  };
}

async function createToken(user: SessionUser) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    accountKind: user.accountKind,
    scopeType: user.scopeType,
    roleAssignmentId: user.roleAssignmentId,
    companyId: user.companyId,
    branchId: user.branchId,
    departmentId: user.departmentId,
    supplierId: user.supplierId,
    isOwner: user.isOwner,
    authVersion: user.authVersion ?? 1,
    preferredLocale: user.preferredLocale,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function authenticate(
  email: string,
  password: string,
  context?: { networkIdentifier?: string },
): Promise<AuthenticatedSessionUser | null> {
  if (isDemoMode()) {
    if (email.toLowerCase() === (process.env.DEMO_EMAIL ?? "").toLowerCase()
      && password === process.env.DEMO_PASSWORD) {
      return {
        id: "demo-admin",
        email,
        name: "Axora demo administrator",
        role: "PLATFORM_OWNER",
        accountKind: "PLATFORM",
        scopeType: "PLATFORM",
        isOwner: true,
        authVersion: 1,
      };
    }
    return null;
  }
  const normalizedEmail = email.trim().toLowerCase().slice(0, 254);
  let rateLimitAccepted = false;
  try {
    rateLimitAccepted = await consumeAuthenticationRateLimits(
      normalizedEmail,
      context?.networkIdentifier,
    );
  } catch {
    // Authentication fails closed when its durable throttle is unavailable.
    return null;
  }
  if (!rateLimitAccepted) return null;

  const result = await query<LoginAccountRow>(
    `SELECT account.id::text,account.email,
       COALESCE(profile.display_name,account.display_name) AS "displayName",
       CASE WHEN credential.user_id IS NULL THEN account.password_hash
         ELSE credential.password_hash END AS "passwordHash",
       account.auth_version::int AS "authVersion",
       credential.locked_until::text AS "lockedUntil"
     FROM users account
     LEFT JOIN user_profiles profile ON profile.user_id=account.id
     LEFT JOIN account_credentials credential ON credential.user_id=account.id
     WHERE lower(account.email)=lower($1)
       AND account.active=true
       AND account.account_status='ACTIVE'
       AND account.account_setup_completed_at IS NOT NULL
       AND CASE WHEN credential.user_id IS NULL THEN account.password_hash
         ELSE credential.password_hash END IS NOT NULL`,
    [normalizedEmail],
  );
  const account = result.rows[0];
  const passwordMatches = await verifyPassword(
    password,
    account?.passwordHash ?? AUTHENTICATION_DUMMY_HASH,
  );
  if (!account?.passwordHash || !passwordMatches) {
    if (account?.id) await recordFailedSignIn(account.id);
    return null;
  }
  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) return null;
  const identity = await loadActiveIdentity(account.id);
  const user = identity?.user;
  if (!user || Number(user.authVersion) !== Number(account.authVersion)) return null;

  // Existing bcrypt accounts remain valid and move to Argon2id after their
  // next successful login. Hashing failure must not turn a valid credential
  // into an outage; the conditional update simply leaves it for a later login.
  let upgradedHash: string | undefined;
  if (passwordHashNeedsUpgrade(account.passwordHash)) {
    try {
      upgradedHash = await hashPassword(password);
    } catch {
      upgradedHash = undefined;
    }
  }
  await withAuditTransaction(
    { userId: user.id, reason: upgradedHash ? "Successful login; password hash upgraded" : "Successful login" },
    async (client) => {
      await client.query(
        `UPDATE users
         SET last_login_at=now(),
             password_hash=CASE
               WHEN $2::text IS NOT NULL AND password_hash=$3 THEN $2
               ELSE password_hash
             END
         WHERE id=$1`,
        [user.id, upgradedHash ?? null, account.passwordHash],
      );
      await client.query(
        `UPDATE account_credentials
         SET failed_sign_in_count=0,first_failed_sign_in_at=NULL,
             locked_until=NULL,updated_at=now()
         WHERE user_id=$1`,
        [user.id],
      );
      await client.query(
        `INSERT INTO account_credentials(
           user_id,password_hash,password_algorithm,credential_version
         ) VALUES (
           $1,COALESCE($2::text,$3),
           CASE WHEN $2::text IS NOT NULL THEN 'argon2id'
             WHEN $3 LIKE '$argon2id$%' THEN 'argon2id' ELSE 'bcrypt' END,
           $4
         )
         ON CONFLICT(user_id) DO UPDATE
         SET password_hash=EXCLUDED.password_hash,
             password_algorithm='argon2id'
         WHERE $2::text IS NOT NULL
           AND account_credentials.password_hash=$3`,
        [user.id, upgradedHash ?? null, account.passwordHash, Number(user.authVersion)],
      );
    },
  );
  return user;
}

export const authenticationInternals = {
  accountFailureLimit: ACCOUNT_FAILURE_LIMIT,
  accountFailureWindowMinutes: ACCOUNT_FAILURE_WINDOW_MINUTES,
  accountLockMinutes: ACCOUNT_LOCK_MINUTES,
  authenticationRateKey,
};

export async function setSession(user: SessionUser) {
  const liveUser = isDemoMode()
    ? user
    : (await loadActiveIdentity(user.id))?.user;
  if (!liveUser || !sessionScopeIsValid(liveUser)
    || (user.authVersion !== undefined
      && Number(user.authVersion) !== Number(liveUser.authVersion))) {
    throw new Error("This account no longer has an active access scope.");
  }
  const token = await createToken(liveUser);
  if (!isDemoMode()) {
    await query(
      `INSERT INTO user_sessions(user_id,token_hash,expires_at)
       VALUES ($1,$2,now()+interval '8 hours')`,
      [liveUser.id, tokenHash(token)],
    );
  }
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

async function readLiveSession(): Promise<LiveIdentity | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || !payload.email || !payload.name || !isUserRole(payload.role)
      || !isAccountKind(payload.accountKind) || !isRoleScopeType(payload.scopeType)
      || typeof payload.isOwner !== "boolean") return null;
    const authVersion = Number(payload.authVersion);
    if (!Number.isInteger(authVersion) || authVersion < 1) return null;
    const preferredLocale = typeof payload.preferredLocale === "string" && isSupportedLocale(payload.preferredLocale)
      ? payload.preferredLocale
      : undefined;
    const tokenUser: SessionUser = {
      id: payload.sub,
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role,
      accountKind: payload.accountKind,
      scopeType: payload.scopeType,
      ...(payload.roleAssignmentId ? { roleAssignmentId: String(payload.roleAssignmentId) } : {}),
      ...(payload.companyId ? { companyId: String(payload.companyId) } : {}),
      ...(payload.branchId ? { branchId: String(payload.branchId) } : {}),
      ...(payload.departmentId ? { departmentId: String(payload.departmentId) } : {}),
      ...(payload.supplierId ? { supplierId: String(payload.supplierId) } : {}),
      isOwner: payload.isOwner,
      authVersion,
      ...(preferredLocale ? { preferredLocale } : {}),
    };
    if (!sessionScopeIsValid(tokenUser)) return null;
    if (isDemoMode()) return { user: tokenUser, onboardingComplete: true };
    const liveTokenHash = tokenHash(token);
    const liveIdentity = await loadActiveIdentity(tokenUser.id, liveTokenHash);
    if (!liveIdentity || !liveSessionScopeMatches(tokenUser, liveIdentity.user)) return null;
    await query(
      `UPDATE user_sessions SET last_seen_at=now()
       WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL
         AND last_seen_at < now()-interval '5 minutes'`,
      [liveTokenHash, liveIdentity.user.id],
    );
    return liveIdentity;
  } catch {
    return null;
  }
}

async function currentSessionTokenHash() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) throw new Error("The current session is unavailable.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function persistStepUpSession(user: SessionUser, nextPath?: string) {
  const store = await cookies();
  const sessionHash = await currentSessionTokenHash();
  const token = await encodeStepUpCookie(user, sessionHash, "sensitive-admin-action");
  store.set(STEP_UP_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: STEP_UP_SECONDS,
  });
  return nextPath ? safePathReturn(nextPath) : "/account";
}

function stepUpClaimsMatch(user: SessionUser, claims: StepUpClaim) {
  return claims.actorId === user.id
    && claims.role === user.role
    && claims.accountKind === user.accountKind
    && claims.scopeType === user.scopeType
    && Number(claims.authVersion) === Number(user.authVersion)
    && ((claims.companyId ?? "") === (user.companyId ?? ""))
    && ((claims.branchId ?? "") === (user.branchId ?? ""))
    && ((claims.departmentId ?? "") === (user.departmentId ?? ""))
    && ((claims.supplierId ?? "") === (user.supplierId ?? ""))
    && ((claims.roleAssignmentId ?? "") === (user.roleAssignmentId ?? ""));
}

export async function requireRecentStepUp(actor: AuthenticatedSessionUser | SessionUser, next?: string) {
  if (isDemoMode()) return;
  const claims = await stepUpState();
  if (!claims) redirect(`/account?reauth=1&next=${encodeURIComponent(safePathReturn(next))}`);
  const sessionHash = await currentSessionTokenHash();
  if (claims.sessionTokenHash !== sessionHash
    || !stepUpClaimsMatch(actor, claims)) {
    redirect(`/account?reauth=1&next=${encodeURIComponent(safePathReturn(next))}`);
  }
}

export async function clearStepUpSessionCookie() {
  const store = await cookies();
  store.delete(STEP_UP_COOKIE_NAME);
}

export async function setStepUpAfterPassword(actor: SessionUser, next?: string) {
  return persistStepUpSession(actor, next);
}

/**
 * Returns only a fully onboarded live session. Authenticated API routes use
 * this fail-closed accessor so an activated but incomplete account cannot
 * bypass the page redirect by calling an endpoint directly.
 */
export async function getSession(): Promise<AuthenticatedSessionUser | null> {
  const identity = await readLiveSession();
  return identity?.onboardingComplete ? identity.user : null;
}

/**
 * Narrow accessor for the account-lifecycle allowlist. Do not use this for a
 * procurement, administration, supplier, delivery, reporting, or data API.
 */
export async function getAccountLifecycleSession(): Promise<AuthenticatedSessionUser | null> {
  return (await readLiveSession())?.user ?? null;
}

export async function requireSession() {
  const identity = await readLiveSession();
  if (!identity) redirect("/login");
  if (!identity.onboardingComplete) redirect("/profile?onboarding=1");
  return identity.user;
}

/**
 * Page/action counterpart to getAccountLifecycleSession. Its imports are kept
 * on an explicit regression-tested allowlist.
 */
export async function requireAccountLifecycleSession() {
  const identity = await readLiveSession();
  if (!identity) redirect("/login");
  return identity.user;
}

export async function requireRole(allowed: UserRole[]) {
  const user = await requireSession();
  if (!allowed.includes(user.role)) {
    throw new Error("Your account does not have permission to perform this action.");
  }
  return user;
}

export async function requirePermission(permission: Permission) {
  const user = await requireSession();
  if (!canAccess(user, permission)) {
    throw new Error("Your account does not have permission to perform this action.");
  }
  return user;
}

export async function requirePagePermission(permission: Permission) {
  const user = await requireSession();
  if (!canAccess(user, permission)) redirect("/access-denied");
  return user;
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  try {
    if (token && !isDemoMode()) {
      await query(
        `UPDATE user_sessions
         SET revoked_at=COALESCE(revoked_at,now()),
             revoked_by=COALESCE(revoked_by,user_id),
             revoke_reason=COALESCE(revoke_reason,'User signed out')
         WHERE token_hash=$1`,
        [tokenHash(token)],
      );
    }
  } finally {
    store.delete(COOKIE_NAME);
    store.delete(STEP_UP_COOKIE_NAME);
  }
}
