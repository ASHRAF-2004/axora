import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { SessionUser } from "./auth";
import {
  PENDING_ACCOUNT_PASSWORD_HASH,
  assertPasswordPolicy,
  hashPassword,
} from "./password-policy";
import { accountRoleDefinition, creatableAccountRoles } from "./role-catalog";
import type { AccountKind, RoleScopeType, UserRole } from "./types";
import type { SupportedLocale } from "./i18n";
import { z } from "zod";
import { appendWorkflowEvent, notifyWorkflowUsers } from "./workflow-repository";
import {
  createScopedUserInTransaction,
  resolveUserCreation,
  type ResolvedUserCreation,
  type UserCreationInput,
} from "./users";
import {
  lockAuthorizedInvitationCreationScope,
  lockAuthorizedInvitationTarget,
} from "./account-invitation-isolation";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 24 * 7;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_RESENDS_PER_HOUR = 5;
const MAX_INVITATIONS_PER_ACTOR_HOUR = 20;
const MAX_INVITATIONS_PER_COMPANY_DAY = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AccountSetupInvitationResult {
  invitationId: string;
  userId: string;
  recipientName: string;
  recipientEmail: string;
  companyName: string;
  role: UserRole;
  branchName?: string;
  departmentName?: string;
  expiresAt: string;
  locale: SupportedLocale;
  /** Returned once for synchronous delivery. Never persist or log this value. */
  rawToken: string;
}

export type AccountSetupTokenInspection =
  | {
    valid: true;
    recipientName: string;
    recipientEmail: string;
    companyName: string;
    role: UserRole;
    jobTitle?: string;
    expiresAt: string;
    locale: SupportedLocale;
  }
  | { valid: false };

const activationInputSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  locale: z.enum(["en", "ar", "ms"]),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
}).strict();

export type AccountSetupActivationInput = z.infer<typeof activationInputSchema>;

export class AccountSetupTokenError extends Error {
  constructor() {
    super("This account setup link is invalid or has expired. Request a new invitation from your administrator.");
    this.name = "AccountSetupTokenError";
  }
}

export class AccountSetupResendRateLimitError extends Error {
  constructor(public readonly reason: "cooldown" | "hourly") {
    super(reason === "cooldown"
      ? "Wait one minute before replacing this invitation again."
      : "This account has reached the invitation resend limit. Try again later.");
    this.name = "AccountSetupResendRateLimitError";
  }
}

export class AccountSetupInvitationQuotaError extends Error {
  constructor(public readonly reason: "actor" | "company") {
    super(reason === "actor"
      ? "This administrator has reached the hourly account invitation limit. Try again after earlier invitations leave the one-hour window."
      : "This company has reached the daily account invitation limit. Try again after earlier invitations leave the 24-hour window.");
    this.name = "AccountSetupInvitationQuotaError";
  }
}

async function enforceInvitationQuota(
  client: PoolClient,
  actorId: string,
  companyId?: string,
  allowOnboardingCompany = false,
) {
  // Serialize each quota dimension with transaction-scoped advisory locks.
  // Using advisory locks avoids upgrading a KEY SHARE resource lock to UPDATE,
  // which can deadlock when concurrent administrators invite into one company.
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('axora-account-invite-actor:' || $1::text,0)
     )`,
    [actorId],
  );
  if (companyId) {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('axora-account-invite-company:' || $1::text,0)
       )`,
      [companyId],
    );
  }

  const scope = companyId
    ? await client.query(
      `SELECT u.id::text AS "actorId",c.id::text AS "companyId"
       FROM users u CROSS JOIN companies c
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
         AND c.id=$2 AND (
           c.active=true OR ($3::boolean AND c.lifecycle_status IN (
             'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED'
           ))
         )
       FOR KEY SHARE OF u,c`,
      [actorId, companyId, allowOnboardingCompany],
    )
    : await client.query(
      `SELECT u.id::text AS "actorId"
       FROM users u
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
       FOR KEY SHARE OF u`,
      [actorId],
    );
  if (!scope.rowCount) {
    throw new Error("The account invitation scope is no longer active.");
  }

  const usage = await client.query<{ actorCount: number; companyCount: number }>(
    `SELECT
       count(*) FILTER (
         WHERE created_by=$1 AND created_at > now()-interval '1 hour'
       )::integer AS "actorCount",
       count(*) FILTER (
         WHERE $2::uuid IS NOT NULL AND company_id=$2
           AND created_at > now()-interval '1 day'
       )::integer AS "companyCount"
     FROM account_setup_invitations
     WHERE (created_by=$1 AND created_at > now()-interval '1 hour')
        OR ($2::uuid IS NOT NULL AND company_id=$2
          AND created_at > now()-interval '1 day')`,
    [actorId, companyId ?? null],
  );
  if (Number(usage.rows[0]?.actorCount ?? 0) >= MAX_INVITATIONS_PER_ACTOR_HOUR) {
    throw new AccountSetupInvitationQuotaError("actor");
  }
  if (companyId
    && Number(usage.rows[0]?.companyCount ?? 0) >= MAX_INVITATIONS_PER_COMPANY_DAY) {
    throw new AccountSetupInvitationQuotaError("company");
  }
}

export function generateAccountSetupToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashAccountSetupToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function accountSetupTtlHours() {
  const configured = Number.parseInt(
    process.env.ACCOUNT_SETUP_TTL_HOURS ?? String(DEFAULT_TTL_HOURS),
    10,
  );
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_TTL_HOURS;
  return Math.min(configured, MAX_TTL_HOURS);
}

function expiresAtFrom(now: Date) {
  return new Date(now.getTime() + accountSetupTtlHours() * 60 * 60 * 1000);
}

function validToken(token: string) {
  return TOKEN_PATTERN.test(token);
}

export async function createInvitedUser(
  input: UserCreationInput,
  actor: SessionUser,
): Promise<AccountSetupInvitationResult> {
  if (isDemoMode()) {
    throw new Error("Account invitation delivery is unavailable in demo mode.");
  }

  const resolved = resolveUserCreation(input, actor);
  const rawToken = generateAccountSetupToken();
  const tokenHash = hashAccountSetupToken(rawToken);
  const expiresAt = expiresAtFrom(new Date());
  const invitationId = randomUUID();

  const result = await withAuditTransaction(
    { actor, reason: "Account invitation created" },
    async (client) => {
      await lockAuthorizedInvitationCreationScope(client, actor, resolved);
      await enforceInvitationQuota(
        client,
        actor.id,
        resolved.companyId,
        resolved.role === "COMPANY_ADMIN",
      );
      const { userId, validated } = await createScopedUserInTransaction(client, resolved, {
        passwordHash: PENDING_ACCOUNT_PASSWORD_HASH,
        setupCompleted: false,
      });
      const intendedRoleId = await initializeInvitedIdentity(
        client,
        userId,
        resolved,
        actor.id,
      );
      const invitation = await client.query<{ id: string; expiresAt: string }>(
        `INSERT INTO account_setup_invitations(
           user_id,company_id,token_hash,expires_at,created_by,id,
           email_locale,
           intended_role_id,intended_branch_id,intended_department_id,
           intended_scope_type,intended_supplier_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id::text,expires_at::text AS "expiresAt"`,
        [
          userId,
          resolved.companyId ?? null,
          tokenHash,
          expiresAt,
          actor.id,
          invitationId,
          resolved.preferredLocale,
          intendedRoleId,
          resolved.branchId ?? null,
          resolved.departmentId ?? null,
          resolved.scopeType,
          resolved.supplierId ?? null,
        ],
      );

      return {
        invitationId: invitation.rows[0].id,
        userId,
        recipientName: resolved.displayName,
        recipientEmail: resolved.email,
        companyName: validated.organizationName,
        role: resolved.role,
        branchName: validated.branchName,
        departmentName: validated.departmentName,
        expiresAt: invitation.rows[0].expiresAt,
        locale: resolved.preferredLocale,
      };
    },
  );

  return { ...result, rawToken };
}

interface ExistingInvitationTarget {
  userId: string;
  recipientName: string;
  recipientEmail: string;
  role: UserRole;
  roleId: string;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  companyName: string;
  branchId?: string;
  branchName?: string;
  departmentId?: string;
  departmentName?: string;
  supplierId?: string;
  active: boolean;
  setupCompleted: boolean;
  organizationActive: boolean;
  membershipReady: boolean;
  preferredLocale: SupportedLocale;
}

async function initializeInvitedIdentity(
  client: PoolClient,
  userId: string,
  input: ResolvedUserCreation,
  actorId: string,
) {
  const role = await client.query<{ id: string }>(
    "SELECT id::text FROM roles WHERE role_key=$1 FOR KEY SHARE",
    [input.role],
  );
  if (!role.rowCount) throw new Error("The selected account role is unavailable.");

  await client.query(
    "UPDATE users SET account_status='INVITED' WHERE id=$1",
    [userId],
  );
  await client.query(
    `INSERT INTO user_profiles(user_id,display_name,job_title,preferred_locale)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(user_id) DO UPDATE
     SET display_name=EXCLUDED.display_name,job_title=EXCLUDED.job_title,
       preferred_locale=EXCLUDED.preferred_locale`,
    [userId, input.displayName, input.jobTitle ?? "", input.preferredLocale],
  );
  await client.query(
    `INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
     VALUES ($1,NULL,NULL)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId],
  );
  if (input.accountKind === "COMPANY") {
    await client.query(
      `INSERT INTO company_memberships(
         user_id,company_id,status,is_primary,created_by
       ) VALUES ($1,$2,'INVITED',true,$3)
       ON CONFLICT(user_id,company_id) DO UPDATE
       SET status='INVITED',ended_at=NULL`,
      [userId, input.companyId, actorId],
    );
  }
  if (input.branchId) {
    await client.query(
      `INSERT INTO branch_assignments(
         user_id,company_id,branch_id,status,is_primary,created_by
       ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
       ON CONFLICT(user_id,branch_id) DO UPDATE
       SET status='ACTIVE',ended_at=NULL`,
      [userId, input.companyId, input.branchId, actorId],
    );
  }
  if (input.departmentId) {
    await client.query(
      `INSERT INTO department_assignments(
         user_id,company_id,department_id,status,is_primary,assigned_by
       ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
       ON CONFLICT(user_id,department_id) WHERE status='ACTIVE'
       DO UPDATE SET status='ACTIVE',ended_at=NULL`,
      [userId, input.companyId, input.departmentId, actorId],
    );
  }
  if (input.accountKind === "SUPPLIER") {
    await client.query(
      `INSERT INTO supplier_memberships(user_id,supplier_id,status,created_by)
       VALUES ($1,$2,'INVITED',$3)
       ON CONFLICT(user_id,supplier_id) DO UPDATE
       SET status='INVITED',ended_at=NULL`,
      [userId, input.supplierId, actorId],
    );
  }
  if (input.accountKind === "DELIVERY") {
    await client.query(
      `INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
       VALUES ($1,'DRV-' || upper(substr(replace($1::text,'-',''),1,12)),true)
       ON CONFLICT(user_id) DO UPDATE SET active=true`,
      [userId],
    );
  }
  await client.query(
    `INSERT INTO role_assignments(
       user_id,role_id,scope_type,company_id,branch_id,department_id,
       supplier_id,active,assigned_by
     ) VALUES (
       $1,$2,$3,
       CASE WHEN $3 IN ('COMPANY','BRANCH','DEPARTMENT') THEN $4::uuid ELSE NULL END,
       CASE WHEN $3 IN ('BRANCH','DEPARTMENT') THEN $5::uuid ELSE NULL END,
       CASE WHEN $3='DEPARTMENT' THEN $6::uuid ELSE NULL END,
       CASE WHEN $3='SUPPLIER' THEN $7::uuid ELSE NULL END,
       true,$8
     )
     ON CONFLICT DO NOTHING`,
    [
      userId,
      role.rows[0].id,
      input.scopeType,
      input.companyId ?? null,
      input.branchId ?? null,
      input.departmentId ?? null,
      input.supplierId ?? null,
      actorId,
    ],
  );
  await client.query(
    `INSERT INTO onboarding_progress(user_id,profile_stage_status)
     VALUES ($1,'NOT_STARTED')
     ON CONFLICT(user_id) DO NOTHING`,
    [userId],
  );

  return role.rows[0].id;
}

function assertCanResendInvitation(
  target: ExistingInvitationTarget | undefined,
  actor: SessionUser,
) {
  if (!target || target.setupCompleted || !target.active
    || !target.organizationActive || !target.membershipReady) {
    throw new Error("This account is not waiting for setup.");
  }
  const definition = accountRoleDefinition(target.role);
  if (!definition
    || !creatableAccountRoles(actor).some((allowedRole) => allowedRole.key === target.role)) {
    throw new Error("Your account cannot resend this invitation.");
  }
  if (actor.isOwner && actor.accountKind !== "COMPANY") return;
  if ((actor.role === "ADMIN" || actor.role === "COMPANY_ADMIN")
    && target.accountKind === "COMPANY"
    && Boolean(actor.companyId) && actor.companyId === target.companyId) return;
  if (actor.role === "BRANCH_ADMIN"
    && target.accountKind === "COMPANY"
    && actor.companyId === target.companyId
    && Boolean(actor.branchId) && actor.branchId === target.branchId
    && ["DEPARTMENT_ADMIN", "BRANCH_APPROVER", "REQUESTER", "FINANCE_REVIEWER", "AUDITOR", "RECEIVING_USER"].includes(target.role)) return;
  if (actor.role === "DEPARTMENT_ADMIN"
    && target.accountKind === "COMPANY"
    && actor.companyId === target.companyId
    && Boolean(actor.departmentId) && actor.departmentId === target.departmentId
    && ["REQUESTER", "FINANCE_REVIEWER", "AUDITOR", "RECEIVING_USER"].includes(target.role)) return;
  throw new Error("Your account cannot resend this invitation.");
}

export async function resendAccountSetupInvitation(
  userId: string,
  actor: SessionUser,
): Promise<AccountSetupInvitationResult> {
  if (isDemoMode()) {
    throw new Error("Account invitation delivery is unavailable in demo mode.");
  }

  const rawToken = generateAccountSetupToken();
  const tokenHash = hashAccountSetupToken(rawToken);
  const expiresAt = expiresAtFrom(new Date());
  const invitationId = randomUUID();

  const result = await withAuditTransaction(
    { actor, reason: "Account invitation replaced" },
    async (client) => {
      await lockAuthorizedInvitationTarget(client, actor, userId);
      const targetResult = await client.query<ExistingInvitationTarget>(
        `SELECT
           u.id::text AS "userId",u.display_name AS "recipientName",
           u.email AS "recipientEmail",role.role_key AS role,
           role.id::text AS "roleId",u.account_kind AS "accountKind",
           assignment.scope_type AS "scopeType",
           assignment.company_id::text AS "companyId",
           COALESCE(c.name,supplier.name,
             CASE WHEN u.account_kind='DELIVERY' THEN 'Axora delivery network' ELSE 'Axora' END
           ) AS "companyName",
           assignment.branch_id::text AS "branchId",b.name AS "branchName",
           assignment.department_id::text AS "departmentId",
           department.name AS "departmentName",
           assignment.supplier_id::text AS "supplierId",u.active,
           profile.preferred_locale AS "preferredLocale",
           (u.account_setup_completed_at IS NOT NULL) AS "setupCompleted",
           CASE
             WHEN assignment.scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
               THEN COALESCE(c.active,false) AND COALESCE(b.active,true)
                 AND COALESCE(department.active,true)
             WHEN assignment.scope_type='SUPPLIER' THEN COALESCE(supplier.active,false)
             ELSE true
           END AS "organizationActive",
           CASE
             WHEN assignment.scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
               THEN company_membership.status='INVITED'
                 AND (assignment.scope_type NOT IN ('BRANCH','DEPARTMENT')
                   OR assignment.branch_id IS NULL OR branch_assignment.status='ACTIVE')
                 AND (assignment.scope_type<>'DEPARTMENT'
                   OR department_assignment.status='ACTIVE')
             WHEN assignment.scope_type='SUPPLIER'
               THEN supplier_membership.status='INVITED'
             WHEN assignment.scope_type='DELIVERY'
               THEN COALESCE(driver.active,false)
             ELSE true
           END AS "membershipReady"
         FROM users u
         JOIN LATERAL (
           SELECT prior.intended_role_id AS role_id,
             prior.intended_scope_type AS scope_type,
             prior.company_id,prior.intended_branch_id AS branch_id,
             prior.intended_department_id AS department_id,
             prior.intended_supplier_id AS supplier_id
           FROM account_setup_invitations prior
           WHERE prior.user_id=u.id
           ORDER BY prior.created_at DESC,prior.id
           LIMIT 1
         ) invitation_scope ON true
         JOIN role_assignments assignment
           ON assignment.user_id=u.id
          AND assignment.role_id=invitation_scope.role_id
          AND assignment.scope_type=invitation_scope.scope_type
          AND assignment.company_id IS NOT DISTINCT FROM invitation_scope.company_id
          AND assignment.branch_id IS NOT DISTINCT FROM invitation_scope.branch_id
          AND assignment.department_id IS NOT DISTINCT FROM invitation_scope.department_id
          AND assignment.supplier_id IS NOT DISTINCT FROM invitation_scope.supplier_id
          AND assignment.active=true
         JOIN roles role ON role.id=assignment.role_id
         JOIN account_credentials credential
           ON credential.user_id=u.id AND credential.password_hash IS NULL
         JOIN user_profiles profile ON profile.user_id=u.id
         LEFT JOIN companies c ON c.id=assignment.company_id
         LEFT JOIN company_memberships company_membership
           ON company_membership.user_id=u.id
          AND company_membership.company_id=assignment.company_id
         LEFT JOIN branches b ON b.id=assignment.branch_id
           AND b.company_id=assignment.company_id
         LEFT JOIN departments department ON department.id=assignment.department_id
           AND department.company_id=assignment.company_id
         LEFT JOIN branch_assignments branch_assignment
           ON branch_assignment.user_id=u.id
          AND branch_assignment.company_id=assignment.company_id
           AND branch_assignment.branch_id=assignment.branch_id
         LEFT JOIN department_assignments department_assignment
           ON department_assignment.user_id=u.id
          AND department_assignment.company_id=assignment.company_id
          AND department_assignment.department_id=assignment.department_id
         LEFT JOIN suppliers supplier ON supplier.id=assignment.supplier_id
         LEFT JOIN supplier_memberships supplier_membership
           ON supplier_membership.user_id=u.id
          AND supplier_membership.supplier_id=assignment.supplier_id
         LEFT JOIN delivery_agent_profiles driver ON driver.user_id=u.id
         WHERE u.id=$1 AND u.account_status='INVITED'
           AND u.account_setup_completed_at IS NULL AND u.active=true
           AND u.company_id IS NOT DISTINCT FROM assignment.company_id
           AND u.branch_id IS NOT DISTINCT FROM assignment.branch_id
         FOR UPDATE OF u`,
        [userId],
      );
      const target = targetResult.rows[0];
      assertCanResendInvitation(target, actor);
      await enforceInvitationQuota(
        client,
        actor.id,
        target.companyId,
        target.role === "COMPANY_ADMIN",
      );

      const rate = await client.query<{ tooSoon: boolean; lastHour: number }>(
        `SELECT
           bool_or(created_at > now() - make_interval(secs => $2::integer)) AS "tooSoon",
           count(*) FILTER (WHERE created_at > now() - interval '1 hour')::integer AS "lastHour"
         FROM account_setup_invitations
         WHERE user_id=$1`,
        [userId, RESEND_COOLDOWN_SECONDS],
      );
      if (rate.rows[0]?.tooSoon) {
        throw new AccountSetupResendRateLimitError("cooldown");
      }
      if (Number(rate.rows[0]?.lastHour ?? 0) >= MAX_RESENDS_PER_HOUR + 1) {
        throw new AccountSetupResendRateLimitError("hourly");
      }

      await client.query(
        `UPDATE account_setup_invitations
         SET revoked_at=now(),
             delivery_status=CASE
               WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED'
               ELSE delivery_status
             END
         WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [userId],
      );
      const invitation = await client.query<{ id: string; expiresAt: string }>(
        `INSERT INTO account_setup_invitations(
           user_id,company_id,token_hash,expires_at,created_by,id,
           email_locale,
           intended_role_id,intended_branch_id,intended_department_id,
           intended_scope_type,intended_supplier_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id::text,expires_at::text AS "expiresAt"`,
        [
          target.userId,
          target.companyId ?? null,
          tokenHash,
          expiresAt,
          actor.id,
          invitationId,
          target.preferredLocale,
          target.roleId,
          target.branchId ?? null,
          target.departmentId ?? null,
          target.scopeType,
          target.supplierId ?? null,
        ],
      );

      return {
        invitationId: invitation.rows[0].id,
        userId: target.userId,
        recipientName: target.recipientName,
        recipientEmail: target.recipientEmail,
        companyName: target.companyName,
        role: target.role,
        branchName: target.branchName,
        departmentName: target.departmentName,
        expiresAt: invitation.rows[0].expiresAt,
        locale: target.preferredLocale,
      };
    },
  );

  return { ...result, rawToken };
}

function safeProviderMessageId(value: string | undefined) {
  const normalized = value?.trim();
  if (normalized && (normalized.length > 255 || /[\r\n]/.test(normalized))) {
    throw new Error("The email provider message identifier is invalid.");
  }
  return normalized || null;
}

interface InvitationWorkflowContext {
  companyId?: string;
  branchId?: string;
  createdBy: string;
  creatorRole: UserRole;
  creatorAccountKind: AccountKind;
  creatorIsOwner: boolean;
  creatorCompanyId?: string;
  creatorBranchId?: string;
}

async function recordCompanyInvitationSent(
  client: PoolClient,
  invitationId: string,
) {
  const context = await client.query<InvitationWorkflowContext>(
    `SELECT invitation.company_id::text AS "companyId",
       invitation.intended_branch_id::text AS "branchId",
       invitation.created_by::text AS "createdBy",
       creator.role AS "creatorRole",
       creator.account_kind AS "creatorAccountKind",
       creator.is_owner AS "creatorIsOwner",
       creator.company_id::text AS "creatorCompanyId",
       creator.branch_id::text AS "creatorBranchId"
     FROM account_setup_invitations invitation
     JOIN users creator ON creator.id=invitation.created_by
     WHERE invitation.id=$1`,
    [invitationId],
  );
  const invitation = context.rows[0];
  // Workflow events and in-app notifications are intentionally tenant scoped.
  // Platform, supplier, and delivery invitations have no company and remain
  // represented by the account-setup audit trail instead of a fabricated tenant.
  if (!invitation?.companyId) return;
  // Delivery confirmation runs outside an authenticated browser session. Bind
  // the transaction to the recorded issuer before the tenant-scoped event is
  // inserted so workflow RLS evaluates the real, previously authorized actor.
  await client.query(
    "SELECT set_config('axora.user_id',$1,true)",
    [invitation.createdBy],
  );
  await appendWorkflowEvent(client, {
    companyId: invitation.companyId,
    ...(invitation.branchId ? { branchId: invitation.branchId } : {}),
    aggregateType: "account-invitation",
    aggregateId: invitationId,
    eventKey: "invitation.sent",
    stableKey: "provider-confirmed",
    actor: {
      id: invitation.createdBy,
      role: invitation.creatorRole,
      accountKind: invitation.creatorAccountKind,
      isOwner: invitation.creatorIsOwner,
      companyId: invitation.creatorCompanyId,
      branchId: invitation.creatorBranchId,
    },
    newState: "SENT",
    source: "SYSTEM",
  });
}

export async function recordAccountSetupDelivery(
  invitationId: string,
  delivery: {
    succeeded: boolean;
    providerMessageId?: string;
    status?: "sent" | "disabled" | "failed" | "uncertain";
  },
) {
  if (isDemoMode()) return false;
  if (!UUID_PATTERN.test(invitationId)) return false;
  const providerMessageId = safeProviderMessageId(delivery.providerMessageId);

  const deliveryStatus = delivery.succeeded
    ? "SENT"
    : delivery.status === "disabled" ? "DISABLED"
      : delivery.status === "uncertain" ? "UNCERTAIN"
        : "FAILED";
  return withAuditTransaction(
    { reason: delivery.succeeded
      ? "Account setup email sent"
      : deliveryStatus === "DISABLED"
        ? "Account setup email delivery disabled"
        : "Account setup email failed" },
    async (client) => {
      const result = await client.query(
        `UPDATE account_setup_invitations
         SET delivery_status=$2,
             delivery_attempted_at=now(),
             delivery_attempt_count=1,
             sent_at=CASE WHEN $3::boolean THEN now() ELSE NULL END,
             provider_message_id=CASE WHEN $3::boolean THEN $4 ELSE NULL END,
             last_delivery_error=CASE WHEN $3::boolean THEN NULL
               WHEN $2='UNCERTAIN' THEN 'delivery_uncertain'
               WHEN $2='DISABLED' THEN 'delivery_disabled'
               ELSE 'delivery_failed' END
         WHERE id=$1 AND delivery_status IN ('PENDING','SENDING')
         RETURNING id`,
        [
          invitationId,
          deliveryStatus,
          delivery.succeeded,
          providerMessageId,
        ],
      );
      if (result.rowCount) {
        if (delivery.succeeded) {
          await recordCompanyInvitationSent(client, invitationId);
        }
        return true;
      }
      const existing = await client.query<{ deliveryStatus: string; providerMessageId?: string }>(
        `SELECT delivery_status AS "deliveryStatus",
           provider_message_id AS "providerMessageId"
         FROM account_setup_invitations WHERE id=$1`,
        [invitationId],
      );
      const row = existing.rows[0];
      return row?.deliveryStatus === deliveryStatus
        && (!delivery.succeeded || !providerMessageId
          || row.providerMessageId === providerMessageId);
    },
  );
}

/**
 * Re-check a one-shot delivery immediately before the raw token leaves the app
 * process. The token itself remains only in memory; the comparison uses its
 * digest and fails closed after revocation, expiry, deactivation, or recipient
 * suppression.
 */
export async function authorizeAccountSetupDelivery(
  invitationId: string,
  rawToken: string,
) {
  if (isDemoMode() || !UUID_PATTERN.test(invitationId) || !validToken(rawToken)) {
    return false;
  }
  return withAuditTransaction(
    { reason: "Account setup email send claimed" },
    async (client) => {
      const result = await client.query(
        `UPDATE account_setup_invitations invitation
         SET delivery_status='SENDING',delivery_attempt_count=1,
             delivery_attempted_at=now(),last_delivery_error=NULL
         FROM users account
         WHERE invitation.id=$1
           AND invitation.token_hash=$2
           AND invitation.delivery_status='PENDING'
           AND invitation.delivery_attempt_count=0
           AND invitation.consumed_at IS NULL
           AND invitation.revoked_at IS NULL
           AND invitation.expires_at > now()
           AND account.id=invitation.user_id
           AND account.active=true
           AND account.account_status='INVITED'
           AND account.account_setup_completed_at IS NULL
           AND NOT axora_email_agent_is_paused('axora-auth')
           AND NOT axora_email_recipient_is_suppressed(account.email)
         RETURNING invitation.id`,
        [invitationId, hashAccountSetupToken(rawToken)],
      );
      return result.rowCount === 1;
    },
  );
}

export async function inspectAccountSetupToken(
  rawToken: string,
): Promise<AccountSetupTokenInspection> {
  if (isDemoMode() || !validToken(rawToken)) return { valid: false };
  const tokenHash = hashAccountSetupToken(rawToken);
  const result = await query<{
    recipientName: string;
    recipientEmail: string;
    companyName: string;
    role: UserRole;
    jobTitle?: string;
    expiresAt: string;
    locale: SupportedLocale;
  }>(
    `SELECT u.display_name AS "recipientName",u.email AS "recipientEmail",
       COALESCE(c.name,supplier.name,
         CASE WHEN i.intended_scope_type='DELIVERY'
           THEN 'Axora delivery network' ELSE 'Axora' END
       ) AS "companyName",
       intended_role.role_key AS role,profile.job_title AS "jobTitle",
       i.expires_at::text AS "expiresAt",i.email_locale AS locale
     FROM account_setup_invitations i
     JOIN users u ON u.id=i.user_id
       AND u.company_id IS NOT DISTINCT FROM i.company_id
       AND u.branch_id IS NOT DISTINCT FROM i.intended_branch_id
     LEFT JOIN user_profiles profile ON profile.user_id=u.id
     JOIN roles intended_role ON intended_role.id=i.intended_role_id
     JOIN role_assignments intended_assignment
       ON intended_assignment.user_id=u.id
      AND intended_assignment.role_id=i.intended_role_id
      AND intended_assignment.scope_type=i.intended_scope_type
      AND intended_assignment.company_id IS NOT DISTINCT FROM i.company_id
     AND intended_assignment.branch_id IS NOT DISTINCT FROM i.intended_branch_id
      AND intended_assignment.department_id IS NOT DISTINCT FROM i.intended_department_id
      AND intended_assignment.supplier_id IS NOT DISTINCT FROM i.intended_supplier_id
      AND intended_assignment.active=true
     LEFT JOIN companies c ON c.id=i.company_id
     LEFT JOIN suppliers supplier ON supplier.id=i.intended_supplier_id
     JOIN account_credentials credential
       ON credential.user_id=u.id AND credential.password_hash IS NULL
     LEFT JOIN company_memberships company_membership
       ON company_membership.user_id=u.id
      AND company_membership.company_id=i.company_id
     LEFT JOIN branches b ON b.id=i.intended_branch_id
       AND b.company_id=i.company_id
     LEFT JOIN departments department ON department.id=i.intended_department_id
       AND department.company_id=i.company_id
     LEFT JOIN branch_assignments branch_assignment
       ON branch_assignment.user_id=u.id
      AND branch_assignment.company_id=i.company_id
      AND branch_assignment.branch_id=i.intended_branch_id
     LEFT JOIN department_assignments department_assignment
       ON department_assignment.user_id=u.id
      AND department_assignment.company_id=i.company_id
      AND department_assignment.department_id=i.intended_department_id
     LEFT JOIN supplier_memberships supplier_membership
       ON supplier_membership.user_id=u.id
      AND supplier_membership.supplier_id=i.intended_supplier_id
     LEFT JOIN delivery_agent_profiles driver ON driver.user_id=u.id
     WHERE i.token_hash=$1
       AND i.consumed_at IS NULL AND i.revoked_at IS NULL
       AND i.expires_at > now()
       AND u.account_setup_completed_at IS NULL AND u.password_hash=$2
       AND u.account_status='INVITED'
       AND u.active=true
       AND public.axora_account_setup_inviter_can_activate(i.id,now())
       AND (
         (i.intended_scope_type='PLATFORM'
           AND u.account_kind='PLATFORM'
           AND intended_role.role_key IN (
             'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT'
           )
           AND u.is_owner=(intended_role.role_key='PLATFORM_OWNER'))
         OR (i.intended_scope_type='COMPANY'
           AND u.account_kind='COMPANY' AND u.is_owner=false
           AND c.lifecycle_status IN (
             'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
             'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
           ) AND company_membership.status='INVITED'
           AND intended_role.role_key IN (
             'COMPANY_ADMIN','COMPANY_APPROVER','FINANCE_REVIEWER',
             'AUDITOR','RECEIVING_USER'
           ))
         OR (i.intended_scope_type='BRANCH'
           AND u.account_kind='COMPANY' AND u.is_owner=false
           AND c.lifecycle_status IN (
             'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
             'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
           ) AND b.active=true
           AND company_membership.status='INVITED'
           AND branch_assignment.status='ACTIVE'
           AND intended_role.role_key IN (
             'BRANCH_ADMIN','BRANCH_APPROVER','REQUESTER',
             'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
           ))
         OR (i.intended_scope_type='DEPARTMENT'
           AND u.account_kind='COMPANY' AND u.is_owner=false
           AND c.lifecycle_status IN (
             'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
             'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
           ) AND COALESCE(b.active,true) AND department.active=true
           AND company_membership.status='INVITED'
           AND (i.intended_branch_id IS NULL OR branch_assignment.status='ACTIVE')
           AND department_assignment.status='ACTIVE'
           AND intended_role.role_key IN (
             'DEPARTMENT_ADMIN','REQUESTER','FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
           ))
         OR (i.intended_scope_type='SUPPLIER'
           AND u.account_kind='SUPPLIER' AND u.is_owner=false
           AND supplier.active=true AND supplier_membership.status='INVITED'
           AND intended_role.role_key='SUPPLIER_USER')
         OR (i.intended_scope_type='DELIVERY'
           AND u.account_kind='DELIVERY' AND u.is_owner=false
           AND driver.active=true
           AND intended_role.role_key='DELIVERY_DRIVER')
       )
    `,
    [tokenHash, PENDING_ACCOUNT_PASSWORD_HASH],
  );
  return result.rows[0] ? { valid: true, ...result.rows[0] } : { valid: false };
}

export async function consumeAccountSetupToken(
  rawToken: string,
  newPassword: string,
  activationInput: AccountSetupActivationInput,
): Promise<SessionUser> {
  if (!validToken(rawToken)) throw new AccountSetupTokenError();
  assertPasswordPolicy(newPassword);
  const activation = activationInputSchema.parse(activationInput);

  // Avoid an expensive public Argon2id operation for random or stale links. The
  // transaction below repeats every condition under row locks for single use.
  const inspection = await inspectAccountSetupToken(rawToken);
  if (!inspection.valid) throw new AccountSetupTokenError();
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashAccountSetupToken(rawToken);

  return withAuditTransaction(
    { reason: "Account setup completed" },
    async (client) => {
      const invitationResult = await client.query<{
        invitationId: string;
        userId: string;
        email: string;
        displayName: string;
        role: UserRole;
        roleAssignmentId: string;
        accountKind: AccountKind;
        scopeType: RoleScopeType;
        companyId?: string;
        branchId?: string;
        departmentId?: string;
        supplierId?: string;
        createdBy: string;
        isOwner: boolean;
      }>(
        `SELECT i.id::text AS "invitationId",u.id::text AS "userId",u.email,
           u.display_name AS "displayName",intended_role.role_key AS role,
           intended_assignment.id::text AS "roleAssignmentId",
           u.account_kind AS "accountKind",i.intended_scope_type AS "scopeType",
           i.company_id::text AS "companyId",
           i.intended_branch_id::text AS "branchId",
           i.intended_department_id::text AS "departmentId",
           i.intended_supplier_id::text AS "supplierId",
           i.created_by::text AS "createdBy",
           u.is_owner AS "isOwner"
         FROM account_setup_invitations i
         JOIN users u ON u.id=i.user_id
           AND u.company_id IS NOT DISTINCT FROM i.company_id
           AND u.branch_id IS NOT DISTINCT FROM i.intended_branch_id
         JOIN roles intended_role ON intended_role.id=i.intended_role_id
         JOIN role_assignments intended_assignment
           ON intended_assignment.user_id=u.id
          AND intended_assignment.role_id=i.intended_role_id
          AND intended_assignment.scope_type=i.intended_scope_type
          AND intended_assignment.company_id IS NOT DISTINCT FROM i.company_id
          AND intended_assignment.branch_id IS NOT DISTINCT FROM i.intended_branch_id
          AND intended_assignment.department_id IS NOT DISTINCT FROM i.intended_department_id
          AND intended_assignment.supplier_id IS NOT DISTINCT FROM i.intended_supplier_id
          AND intended_assignment.active=true
         LEFT JOIN companies c ON c.id=i.company_id
         LEFT JOIN suppliers supplier ON supplier.id=i.intended_supplier_id
         JOIN account_credentials credential
           ON credential.user_id=u.id AND credential.password_hash IS NULL
         LEFT JOIN company_memberships company_membership
           ON company_membership.user_id=u.id
          AND company_membership.company_id=i.company_id
         LEFT JOIN branches b ON b.id=i.intended_branch_id
           AND b.company_id=i.company_id
         LEFT JOIN departments department ON department.id=i.intended_department_id
           AND department.company_id=i.company_id
         LEFT JOIN branch_assignments branch_assignment
           ON branch_assignment.user_id=u.id
          AND branch_assignment.company_id=i.company_id
          AND branch_assignment.branch_id=i.intended_branch_id
         LEFT JOIN department_assignments department_assignment
           ON department_assignment.user_id=u.id
          AND department_assignment.company_id=i.company_id
          AND department_assignment.department_id=i.intended_department_id
         LEFT JOIN supplier_memberships supplier_membership
           ON supplier_membership.user_id=u.id
          AND supplier_membership.supplier_id=i.intended_supplier_id
         LEFT JOIN delivery_agent_profiles driver ON driver.user_id=u.id
         WHERE i.token_hash=$1
           AND i.consumed_at IS NULL AND i.revoked_at IS NULL
           AND i.expires_at > now()
           AND u.account_setup_completed_at IS NULL AND u.password_hash=$2
           AND u.account_status='INVITED'
           AND u.active=true
           AND public.axora_account_setup_inviter_can_activate(i.id,now())
           AND (
             (i.intended_scope_type='PLATFORM'
               AND u.account_kind='PLATFORM'
               AND intended_role.role_key IN (
                 'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT'
               )
               AND u.is_owner=(intended_role.role_key='PLATFORM_OWNER'))
             OR (i.intended_scope_type='COMPANY'
               AND u.account_kind='COMPANY' AND u.is_owner=false
               AND c.lifecycle_status IN (
                 'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
                 'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
               ) AND company_membership.status='INVITED'
               AND intended_role.role_key IN (
                 'COMPANY_ADMIN','COMPANY_APPROVER','FINANCE_REVIEWER',
                 'AUDITOR','RECEIVING_USER'
               ))
             OR (i.intended_scope_type='BRANCH'
               AND u.account_kind='COMPANY' AND u.is_owner=false
               AND c.lifecycle_status IN (
                 'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
                 'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
               ) AND b.active=true
               AND company_membership.status='INVITED'
               AND branch_assignment.status='ACTIVE'
               AND intended_role.role_key IN (
                 'BRANCH_ADMIN','BRANCH_APPROVER','REQUESTER',
                 'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
               ))
             OR (i.intended_scope_type='DEPARTMENT'
               AND u.account_kind='COMPANY' AND u.is_owner=false
               AND c.lifecycle_status IN (
                 'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
                 'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
               ) AND COALESCE(b.active,true) AND department.active=true
               AND company_membership.status='INVITED'
               AND (i.intended_branch_id IS NULL OR branch_assignment.status='ACTIVE')
               AND department_assignment.status='ACTIVE'
               AND intended_role.role_key IN (
                 'DEPARTMENT_ADMIN','REQUESTER','FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
               ))
             OR (i.intended_scope_type='SUPPLIER'
               AND u.account_kind='SUPPLIER' AND u.is_owner=false
               AND supplier.active=true AND supplier_membership.status='INVITED'
               AND intended_role.role_key='SUPPLIER_USER')
             OR (i.intended_scope_type='DELIVERY'
               AND u.account_kind='DELIVERY' AND u.is_owner=false
               AND driver.active=true
               AND intended_role.role_key='DELIVERY_DRIVER')
           )
         FOR UPDATE OF i,u`,
        [tokenHash, PENDING_ACCOUNT_PASSWORD_HASH],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) throw new AccountSetupTokenError();
      // The public setup request starts without a session. Once the one-time
      // token has been validated under locks, bind the transaction to the
      // activating account so audit triggers and notification RLS attribute
      // the remaining changes to the real actor.
      await client.query(
        "SELECT set_config('axora.user_id',$1,true)",
        [invitation.userId],
      );

      const updated = await client.query<{ authVersion: number }>(
        `UPDATE users
         SET password_hash=$2,account_setup_completed_at=now(),
             account_status='ACTIVE',
             display_name=$3,
             email_verified_at=COALESCE(email_verified_at,now()),
             auth_version=auth_version+1
         WHERE id=$1
         RETURNING auth_version AS "authVersion"`,
        [invitation.userId, passwordHash, activation.displayName],
      );
      await client.query(
        `INSERT INTO account_credentials(
           user_id,password_hash,password_algorithm,password_changed_at,
           failed_sign_in_count,first_failed_sign_in_at,locked_until,
           credential_version
         ) VALUES ($1,$2,'argon2id',now(),0,NULL,NULL,$3)
         ON CONFLICT(user_id) DO UPDATE
         SET password_hash=EXCLUDED.password_hash,
             password_algorithm=EXCLUDED.password_algorithm,
             password_changed_at=EXCLUDED.password_changed_at,
             failed_sign_in_count=0,
             first_failed_sign_in_at=NULL,
             locked_until=NULL,
             credential_version=EXCLUDED.credential_version`,
        [invitation.userId, passwordHash, Number(updated.rows[0].authVersion)],
      );
      await client.query(
        `INSERT INTO user_profiles(user_id,display_name,preferred_locale)
         VALUES ($1,$2,$3)
         ON CONFLICT(user_id) DO UPDATE
         SET display_name=EXCLUDED.display_name,
             preferred_locale=EXCLUDED.preferred_locale`,
        [invitation.userId, activation.displayName, activation.locale],
      );
      if (invitation.companyId) {
        await client.query(
          `INSERT INTO company_memberships(
             user_id,company_id,status,is_primary,joined_at
           ) VALUES ($1,$2,'ACTIVE',true,now())
           ON CONFLICT(user_id,company_id) DO UPDATE
           SET status='ACTIVE',joined_at=COALESCE(company_memberships.joined_at,now()),
               ended_at=NULL`,
          [invitation.userId, invitation.companyId],
        );
      }
      if (invitation.supplierId) {
        await client.query(
          `INSERT INTO supplier_memberships(user_id,supplier_id,status)
           VALUES ($1,$2,'ACTIVE')
           ON CONFLICT(user_id,supplier_id) DO UPDATE
           SET status='ACTIVE',ended_at=NULL`,
          [invitation.userId, invitation.supplierId],
        );
      }
      if (invitation.branchId) {
        await client.query(
          `INSERT INTO branch_assignments(
             user_id,company_id,branch_id,status,is_primary
           ) VALUES ($1,$2,$3,'ACTIVE',true)
           ON CONFLICT(user_id,branch_id) DO UPDATE
           SET status='ACTIVE',ended_at=NULL`,
          [invitation.userId, invitation.companyId, invitation.branchId],
        );
      }
      if (invitation.departmentId) {
        await client.query(
          `INSERT INTO department_assignments(
             user_id,company_id,department_id,status,is_primary
           ) VALUES ($1,$2,$3,'ACTIVE',true)
           ON CONFLICT(user_id,department_id) WHERE status='ACTIVE'
           DO UPDATE SET status='ACTIVE',ended_at=NULL`,
          [invitation.userId, invitation.companyId, invitation.departmentId],
        );
      }
      await client.query(
        `INSERT INTO onboarding_progress(user_id,profile_stage_status)
         VALUES ($1,'NOT_STARTED')
         ON CONFLICT(user_id) DO NOTHING`,
        [invitation.userId],
      );
      await client.query(
        `UPDATE account_setup_invitations
         SET consumed_at=now(),
             terms_policy_version='account-terms-2026-08-08',
             terms_accepted_at=now(),
             privacy_policy_version='account-privacy-2026-08-08',
             privacy_accepted_at=now(),
             delivery_status=CASE
               WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED'
               ELSE delivery_status
             END
         WHERE id=$1`,
        [invitation.invitationId],
      );
      await client.query(
        `UPDATE account_setup_invitations
         SET revoked_at=now(),
             delivery_status=CASE
               WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED'
               ELSE delivery_status
             END
         WHERE user_id=$1 AND id<>$2
           AND consumed_at IS NULL AND revoked_at IS NULL`,
        [invitation.userId, invitation.invitationId],
      );

      if (invitation.companyId) {
        const acceptedEvent = await appendWorkflowEvent(client, {
          companyId: invitation.companyId,
          ...(invitation.branchId ? { branchId: invitation.branchId } : {}),
          aggregateType: "account-invitation",
          aggregateId: invitation.invitationId,
          eventKey: "invitation.accepted",
          stableKey: "account-activated",
          actor: {
            id: invitation.userId,
            role: invitation.role,
            accountKind: invitation.accountKind,
            isOwner: invitation.isOwner,
            companyId: invitation.companyId,
            branchId: invitation.branchId,
            departmentId: invitation.departmentId,
          },
          previousState: "INVITED",
          newState: "ACTIVE",
          source: "WEB",
        });
        await notifyWorkflowUsers(client, acceptedEvent, {
          recipientUserIds: [invitation.createdBy],
          message: {
            key: "invitation_accepted",
            accountName: activation.displayName,
          },
          routePath: "/users",
        });
      }

      return {
        id: invitation.userId,
        email: invitation.email,
        name: activation.displayName,
        role: invitation.role,
        companyId: invitation.companyId,
        branchId: invitation.branchId,
        departmentId: invitation.departmentId,
        supplierId: invitation.supplierId,
        accountKind: invitation.accountKind,
        scopeType: invitation.scopeType,
        roleAssignmentId: invitation.roleAssignmentId,
        isOwner: invitation.isOwner,
        authVersion: Number(updated.rows[0].authVersion),
      };
    },
  );
}
