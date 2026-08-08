import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SupportSystemSummary {
  checkedAt: string;
  latestMigration: string;
  activeSessions: number;
  pendingInvitations: number;
  emailExceptions: number;
  workflowExceptions: number;
}

export interface SupportAccountDiagnostic {
  id: string;
  displayName: string;
  maskedEmail: string;
  role: string;
  accountKind: string;
  accountStatus: string;
  active: boolean;
  setupCompleted: boolean;
  emailVerified: boolean;
  organization?: string;
  branch?: string;
  lastLoginAt?: string;
  activeSessionCount: number;
  protectedPlatformAccount: boolean;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error("invalid_email");
  }
  return email;
}

function supportReason(value: string) {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 10 || reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new Error("invalid_reason");
  }
  return reason;
}

function requireSupportDiagnosticPermission(actor: SessionUser) {
  if (!canAccess(actor, "view_system_diagnostics")) {
    throw new Error("support_forbidden");
  }
}

const SUPPORT_SYSTEM_SUMMARY_SQL = `
  SELECT
    checked_at::text AS "checkedAt",
    latest_migration AS "latestMigration",
    active_sessions AS "activeSessions",
    pending_invitations AS "pendingInvitations",
    email_exceptions AS "emailExceptions",
    workflow_exceptions AS "workflowExceptions"
  FROM axora_support_system_summary()
`;

const SUPPORT_ACCOUNT_DIAGNOSTIC_SQL = `
  SELECT account.id::text,account.email,
    COALESCE(profile.display_name,account.display_name) AS "displayName",
    COALESCE(scoped_role.role_key,legacy_role.role_key) AS role,
    account.account_kind AS "accountKind",
    account.account_status AS "accountStatus",account.active,
    (account.account_setup_completed_at IS NOT NULL) AS "setupCompleted",
    (account.email_verified_at IS NOT NULL) AS "emailVerified",
    company.name AS organization,branch.name AS branch,
    account.last_login_at::text AS "lastLoginAt",
    (SELECT count(*)::int FROM user_sessions session
     WHERE session.user_id=account.id AND session.revoked_at IS NULL
       AND session.expires_at>now()) AS "activeSessionCount",
    (account.is_owner OR account.account_kind='PLATFORM')
      AS "protectedPlatformAccount"
  FROM users account
  JOIN roles legacy_role ON legacy_role.id=account.role_id
  LEFT JOIN LATERAL (
    SELECT assignment.role_id,assignment.company_id,assignment.branch_id
    FROM role_assignments assignment
    WHERE assignment.user_id=account.id AND assignment.active=true
      AND assignment.revoked_at IS NULL
    ORDER BY assignment.assigned_at DESC,assignment.id
    LIMIT 1
  ) assignment ON true
  LEFT JOIN roles scoped_role ON scoped_role.id=assignment.role_id
  LEFT JOIN user_profiles profile ON profile.user_id=account.id
  LEFT JOIN companies company
    ON company.id=COALESCE(assignment.company_id,account.company_id)
  LEFT JOIN branches branch
    ON branch.id=COALESCE(assignment.branch_id,account.branch_id)
  WHERE lower(account.email)=lower($1)
  LIMIT 1
`;

const SUPPORT_TARGET_LOCK_SQL = `
  SELECT id::text,
    (is_owner OR account_kind='PLATFORM') AS "protectedPlatformAccount"
  FROM users
  WHERE id=$1
  FOR UPDATE
`;

const SUPPORT_REVOKE_SESSIONS_SQL = `
  UPDATE user_sessions
  SET revoked_at=now(),revoked_by=$2,
    revoke_reason='revoked_by_technical_support'
  WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
  RETURNING id::text
`;

const SUPPORT_AUDIT_SQL = `
  SELECT axora_record_support_audit($1,$2,$3,$4,$5)
`;

export function maskSupportEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "••••";
  const visible = local.length > 1 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}${"•".repeat(Math.min(8, Math.max(3, local.length - visible.length)))}@${domain}`;
}

export async function getSupportSystemSummary(
  actor: SessionUser,
): Promise<SupportSystemSummary> {
  requireSupportDiagnosticPermission(actor);
  if (isDemoMode()) {
    return {
      checkedAt: new Date().toISOString(),
      latestMigration: "safe-review-fixture",
      activeSessions: 4,
      pendingInvitations: 1,
      emailExceptions: 0,
      workflowExceptions: 2,
    };
  }
  return withAuditTransaction(
    { actor, reason: "Technical support system summary" },
    async (client) => {
      const result = await client.query<SupportSystemSummary>(
        SUPPORT_SYSTEM_SUMMARY_SQL,
      );
      if (!result.rows[0]) throw new Error("support_summary_unavailable");
      return result.rows[0];
    },
  );
}

export async function diagnoseSupportAccount(
  actor: SessionUser,
  emailInput: string,
  reasonInput: string,
): Promise<SupportAccountDiagnostic | null> {
  requireSupportDiagnosticPermission(actor);
  const email = normalizeEmail(emailInput);
  const reason = supportReason(reasonInput);
  if (isDemoMode()) {
    if (!email.endsWith("@axora.invalid")) return null;
    return {
      id: "00000000-0000-4000-8000-000000000090",
      displayName: "Review support account",
      maskedEmail: maskSupportEmail(email),
      role: "REQUESTER",
      accountKind: "COMPANY",
      accountStatus: "ACTIVE",
      active: true,
      setupCompleted: true,
      emailVerified: true,
      organization: "Safe sample company",
      branch: "Review branch",
      lastLoginAt: new Date().toISOString(),
      activeSessionCount: 1,
      protectedPlatformAccount: false,
    };
  }

  return withAuditTransaction(
    { actor, reason: "Technical support account diagnostic" },
    async (client) => {
      const result = await client.query<{
        id: string;
        email: string;
        displayName: string;
        role: string;
        accountKind: string;
        accountStatus: string;
        active: boolean;
        setupCompleted: boolean;
        emailVerified: boolean;
        organization?: string;
        branch?: string;
        lastLoginAt?: string;
        activeSessionCount: number;
        protectedPlatformAccount: boolean;
      }>(SUPPORT_ACCOUNT_DIAGNOSTIC_SQL, [email]);
      const account = result.rows[0];
      if (!account) {
        await client.query(SUPPORT_AUDIT_SQL, [
          "ACCOUNT_DIAGNOSTIC", null, false, null, reason,
        ]);
        return null;
      }
      await client.query(SUPPORT_AUDIT_SQL, [
        "ACCOUNT_DIAGNOSTIC", account.id, true, null, reason,
      ]);
      return {
        ...account,
        maskedEmail: maskSupportEmail(account.email),
      };
    },
  );
}

export async function revokeSupportTargetSessions(
  actor: SessionUser,
  targetIdInput: string,
  reasonInput: string,
) {
  requireSupportDiagnosticPermission(actor);
  if (!UUID_PATTERN.test(targetIdInput)) throw new Error("invalid_target");
  const reason = supportReason(reasonInput);
  if (targetIdInput === actor.id) throw new Error("self_target");
  if (isDemoMode()) return 1;

  return withAuditTransaction(
    { actor, reason: "Technical support session revocation" },
    async (client) => {
      const targetResult = await client.query<{
        id: string;
        protectedPlatformAccount: boolean;
      }>(SUPPORT_TARGET_LOCK_SQL, [targetIdInput]);
      const target = targetResult.rows[0];
      if (!target) throw new Error("target_unavailable");
      if (target.protectedPlatformAccount) throw new Error("protected_target");

      await client.query(
        "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
        [target.id],
      );
      const revoked = await client.query<{ id: string }>(
        SUPPORT_REVOKE_SESSIONS_SQL,
        [target.id, actor.id],
      );
      await client.query(SUPPORT_AUDIT_SQL, [
        "SESSION_CONTROL", target.id, null, revoked.rowCount ?? 0, reason,
      ]);
      return revoked.rowCount ?? 0;
    },
  );
}

export const supportDiagnosticInternals = {
  normalizeEmail,
  supportReason,
  requireSupportDiagnosticPermission,
  sql: {
    systemSummary: SUPPORT_SYSTEM_SUMMARY_SQL,
    accountDiagnostic: SUPPORT_ACCOUNT_DIAGNOSTIC_SQL,
    targetLock: SUPPORT_TARGET_LOCK_SQL,
    revokeSessions: SUPPORT_REVOKE_SESSIONS_SQL,
    audit: SUPPORT_AUDIT_SQL,
  },
};
