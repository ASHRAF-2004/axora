import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { hashPassword, verifyPassword } from "./password-policy";

const SESSION_COOKIE_NAME = "axora_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ActiveAccountSession {
  id: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgentSummary?: string;
  isCurrent: boolean;
}

export interface AccountSecurityOverview {
  email: string;
  emailVerifiedAt?: string;
  passwordChangedAt?: string;
  preferredLocale: "en" | "ar" | "ms";
  timezone: string;
  emailNotifications: boolean;
  inAppNotifications: boolean;
  unreadNotifications: number;
  activeSessions: ActiveAccountSession[];
}

interface SecuritySummaryRow {
  email: string;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  preferredLocale: "en" | "ar" | "ms";
  timezone: string;
  emailNotifications: boolean;
  inAppNotifications: boolean;
  unreadNotifications: string;
}

interface ActiveSessionRow {
  id: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgentSummary: string | null;
  isCurrent: boolean;
}

interface CredentialRow {
  passwordHash: string;
  authVersion: number;
}

async function currentSessionTokenHash() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new Error("The current session is unavailable.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function getAccountSecurityOverview(
  actor: SessionUser,
): Promise<AccountSecurityOverview> {
  if (isDemoMode()) {
    const now = new Date();
    return {
      email: actor.email,
      emailVerifiedAt: now.toISOString(),
      passwordChangedAt: now.toISOString(),
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
      emailNotifications: true,
      inAppNotifications: true,
      unreadNotifications: 0,
      activeSessions: [{
        id: "demo-session",
        issuedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString(),
        isCurrent: true,
      }],
    };
  }
  const currentHash = await currentSessionTokenHash();
  return withAuditTransaction(
    { actor, reason: "Viewed account security" },
    async (client) => {
      const summary = await client.query<SecuritySummaryRow>(`
        SELECT account.email,
          account.email_verified_at::text AS "emailVerifiedAt",
          credential.password_changed_at::text AS "passwordChangedAt",
          profile.preferred_locale AS "preferredLocale",
          profile.timezone,
          profile.notification_email_enabled AS "emailNotifications",
          profile.notification_in_app_enabled AS "inAppNotifications",
          COALESCE(public.axora_notification_summary($1,$2,now())
            ->>'unreadCount','0')
            AS "unreadNotifications"
        FROM users account
        JOIN user_profiles profile ON profile.user_id=account.id
        JOIN account_credentials credential ON credential.user_id=account.id
        WHERE account.id=$1 AND account.active=true
          AND account.account_status='ACTIVE'
      `, [actor.id, actor.roleAssignmentId ?? null]);
      const account = summary.rows[0];
      if (!account) throw new Error("Account security information is unavailable.");

      const sessions = await client.query<ActiveSessionRow>(`
        SELECT session.id::text,session.issued_at::text AS "issuedAt",
          session.last_seen_at::text AS "lastSeenAt",
          session.expires_at::text AS "expiresAt",
          session.user_agent_summary AS "userAgentSummary",
          (session.token_hash=$2) AS "isCurrent"
        FROM user_sessions session
        WHERE session.user_id=$1 AND session.revoked_at IS NULL
          AND session.expires_at > now()
        ORDER BY (session.token_hash=$2) DESC,session.last_seen_at DESC,session.id
      `, [actor.id, currentHash]);
      return {
        email: account.email,
        ...(account.emailVerifiedAt
          ? { emailVerifiedAt: account.emailVerifiedAt }
          : {}),
        ...(account.passwordChangedAt
          ? { passwordChangedAt: account.passwordChangedAt }
          : {}),
        preferredLocale: account.preferredLocale,
        timezone: account.timezone,
        emailNotifications: account.emailNotifications,
        inAppNotifications: account.inAppNotifications,
        unreadNotifications: Number(account.unreadNotifications),
        activeSessions: sessions.rows.map((session) => ({
          id: session.id,
          issuedAt: session.issuedAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          ...(session.userAgentSummary
            ? { userAgentSummary: session.userAgentSummary }
            : {}),
          isCurrent: session.isCurrent,
        })),
      };
    },
  );
}

export type OwnPasswordChangeResult =
  | { status: "changed"; authVersion: number }
  | { status: "invalid_current" }
  | { status: "reused" };

/**
 * Change a signed-in user's password without ever returning or auditing a
 * credential. All verification failures are represented by the same public
 * action message; password reuse is reported only after the current password
 * has been proven.
 */
export async function changeOwnPassword(
  actor: SessionUser,
  currentPassword: string,
  newPassword: string,
): Promise<OwnPasswordChangeResult> {
  if (isDemoMode()) return { status: "invalid_current" };
  const initial = await query<CredentialRow>(`
    SELECT credential.password_hash AS "passwordHash",
      account.auth_version::int AS "authVersion"
    FROM users account
    JOIN account_credentials credential ON credential.user_id=account.id
    WHERE account.id=$1 AND account.active=true
      AND account.account_status='ACTIVE'
      AND credential.password_hash IS NOT NULL
  `, [actor.id]);
  const credential = initial.rows[0];
  if (!credential?.passwordHash) return { status: "invalid_current" };

  // Hash first so a valid new password follows the same expensive work before
  // a generic current-credential failure is returned.
  const replacementHash = await hashPassword(newPassword);
  const currentMatches = await verifyPassword(currentPassword, credential.passwordHash);
  const reusesCurrent = await verifyPassword(newPassword, credential.passwordHash);
  if (!currentMatches) return { status: "invalid_current" };
  if (reusesCurrent) return { status: "reused" };

  return withAuditTransaction(
    { actor, reason: "Changed own password and rotated sessions" },
    async (client) => {
      const locked = await client.query<CredentialRow>(`
        SELECT credential.password_hash AS "passwordHash",
          account.auth_version::int AS "authVersion"
        FROM users account
        JOIN account_credentials credential ON credential.user_id=account.id
        WHERE account.id=$1 AND account.active=true
          AND account.account_status='ACTIVE'
          AND credential.password_hash IS NOT NULL
        FOR UPDATE OF account,credential
      `, [actor.id]);
      if (locked.rows[0]?.passwordHash !== credential.passwordHash) {
        return { status: "invalid_current" as const };
      }
      const updated = await client.query<{ authVersion: number }>(`
        UPDATE users SET password_hash=$2,auth_version=auth_version+1
        WHERE id=$1 RETURNING auth_version::int AS "authVersion"
      `, [actor.id, replacementHash]);
      const authVersion = Number(updated.rows[0]?.authVersion);
      if (!Number.isInteger(authVersion) || authVersion <= credential.authVersion) {
        throw new Error("The account session generation was not rotated.");
      }
      const normalized = await client.query(`
        UPDATE account_credentials SET
          password_hash=$2,password_algorithm='argon2id',
          password_changed_at=now(),failed_sign_in_count=0,
          first_failed_sign_in_at=NULL,locked_until=NULL,
          credential_version=$3
        WHERE user_id=$1
      `, [actor.id, replacementHash, authVersion]);
      if (normalized.rowCount !== 1) {
        throw new Error("The normalized account credential was not updated.");
      }
      await client.query(`
        UPDATE user_sessions
        SET revoked_at=now(),revoked_by=$1,revoke_reason='password_changed'
        WHERE user_id=$1 AND revoked_at IS NULL
        RETURNING id::text
      `, [actor.id]);
      return { status: "changed" as const, authVersion };
    },
  );
}

export async function revokeOtherSession(actor: SessionUser, sessionId: string) {
  if (isDemoMode()) return false;
  if (!UUID_PATTERN.test(sessionId)) throw new Error("The session identifier is invalid.");
  const currentHash = await currentSessionTokenHash();
  return withAuditTransaction(
    { actor, reason: "Revoked another active session" },
    async (client) => {
      const result = await client.query<{ recordId: string }>(`
        UPDATE user_sessions
        SET revoked_at=now(),revoked_by=$1,
          revoke_reason='revoked_by_account_owner'
        WHERE id=$2 AND user_id=$1 AND token_hash<>$3
          AND revoked_at IS NULL AND expires_at > now()
        RETURNING id::text AS "recordId"
      `, [actor.id, sessionId, currentHash]);
      return result.rowCount === 1;
    },
  );
}

export async function revokeAllOtherSessions(actor: SessionUser) {
  if (isDemoMode()) return 0;
  const currentHash = await currentSessionTokenHash();
  return withAuditTransaction(
    { actor, reason: "Revoked all other active sessions" },
    async (client) => {
      const result = await client.query<{ recordId: string }>(`
        UPDATE user_sessions
        SET revoked_at=now(),revoked_by=$1,
          revoke_reason='revoked_by_account_owner'
        WHERE user_id=$1 AND token_hash<>$2
          AND revoked_at IS NULL AND expires_at > now()
        RETURNING id::text AS "recordId"
      `, [actor.id, currentHash]);
      return result.rowCount ?? 0;
    },
  );
}

export const accountSecurityInternals = {
  currentSessionTokenHash,
};
