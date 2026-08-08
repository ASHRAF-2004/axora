import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { hashPassword } from "./password-policy";
import {
  consumePublicRequestRateLimit,
  insertSecurityEmailOutbox,
  insertPasswordChangedEmailOutbox,
  prepareSecurityEmailOutbox,
  publicRequestRateKey,
  PublicRequestRateLimitError,
  type SupportedEmailLocale,
} from "./transactional-email";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailSchema = z.email().max(254).transform((value) => value.trim().toLowerCase());
const localeSchema = z.enum(["en", "ar", "ms"]);
const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_VERIFICATION_TTL_HOURS = 24;

export class SecurityTokenError extends Error {
  constructor() {
    super("This security link is invalid or has expired.");
    this.name = "SecurityTokenError";
  }
}

export function generateSecurityToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSecurityToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function validToken(rawToken: string) {
  return TOKEN_PATTERN.test(rawToken);
}

/**
 * Always returns the same public result for valid email-shaped input. Unknown,
 * inactive, and rate-limited accounts create no token and remain
 * indistinguishable to the caller.
 */
export async function requestPasswordReset(
  email: string,
  networkIdentifier: string,
  locale: SupportedEmailLocale = "en",
) {
  const normalizedEmail = emailSchema.parse(email);
  const normalizedLocale = localeSchema.parse(locale);
  if (isDemoMode()) return { accepted: true as const };
  const rawToken = generateSecurityToken();
  const tokenHash = hashSecurityToken(rawToken);
  const tokenId = randomUUID();
  const prepared = prepareSecurityEmailOutbox({
    rawToken,
    tokenHash,
    sourceId: tokenId,
    messageKind: "PASSWORD_RESET",
    locale: normalizedLocale,
  });
  const networkHash = publicRequestRateKey("network", networkIdentifier);
  const identifierHash = publicRequestRateKey("identifier", normalizedEmail);

  try {
    await withAuditTransaction(
      { reason: "Password reset requested" },
      async (client) => {
        await consumePublicRequestRateLimit(client, "PASSWORD_RESET", [
          { kind: "NETWORK", hash: networkHash, hourlyLimit: 12 },
          { kind: "IDENTIFIER", hash: identifierHash, hourlyLimit: 4 },
        ]);
        const account = await client.query<{ id: string }>(
          `SELECT id::text FROM users
           WHERE lower(email)=lower($1) AND active=true
             AND account_status='ACTIVE'
             AND account_setup_completed_at IS NOT NULL
           FOR UPDATE`,
          [normalizedEmail],
        );
        const userId = account.rows[0]?.id;
        if (!userId) return;

        await client.query(
          `UPDATE password_reset_tokens
           SET revoked_at=now(),revoked_reason='replaced'
           WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,
          [userId],
        );
        await client.query(
          `UPDATE transactional_email_outbox outbox
           SET delivery_status='CANCELLED',delivery_lease_id=NULL,
               delivery_lease_expires_at=NULL,
               token_ciphertext=NULL,token_nonce=NULL,
               token_authentication_tag=NULL
           WHERE outbox.delivery_status IN ('PENDING','SENDING')
             AND EXISTS (
               SELECT 1 FROM password_reset_tokens reset
               WHERE reset.id=outbox.password_reset_token_id
                 AND reset.user_id=$1 AND reset.revoked_at IS NOT NULL
             )`,
          [userId],
        );
        await client.query(
          `INSERT INTO password_reset_tokens(
             id,user_id,token_hash,expires_at,request_network_hash,locale
           ) VALUES (
             $1,$2,$3,now()+make_interval(mins => $4::integer),$5,$6
           )`,
          [
            tokenId,
            userId,
            tokenHash,
            PASSWORD_RESET_TTL_MINUTES,
            networkHash,
            normalizedLocale,
          ],
        );
        await insertSecurityEmailOutbox(client, prepared);
      },
    );
  } catch (error) {
    if (!(error instanceof PublicRequestRateLimitError)) throw error;
  }
  return { accepted: true as const };
}

export async function requestEmailVerification(
  userId: string,
  email: string,
  locale: SupportedEmailLocale = "en",
  networkIdentifier?: string,
) {
  if (!UUID_PATTERN.test(userId)) throw new Error("The account identifier is invalid.");
  const normalizedEmail = emailSchema.parse(email);
  const normalizedLocale = localeSchema.parse(locale);
  if (isDemoMode()) return { accepted: true as const };
  const rawToken = generateSecurityToken();
  const tokenHash = hashSecurityToken(rawToken);
  const tokenId = randomUUID();
  const prepared = prepareSecurityEmailOutbox({
    rawToken,
    tokenHash,
    sourceId: tokenId,
    messageKind: "EMAIL_VERIFICATION",
    locale: normalizedLocale,
  });
  const identifierHash = publicRequestRateKey("identifier", normalizedEmail);
  const networkHash = networkIdentifier
    ? publicRequestRateKey("network", networkIdentifier)
    : undefined;
  await withAuditTransaction(
    { userId, reason: "Email verification requested" },
    async (client) => {
      await consumePublicRequestRateLimit(client, "EMAIL_VERIFICATION", [
        ...(networkHash
          ? [{ kind: "NETWORK" as const, hash: networkHash, hourlyLimit: 12 }]
          : []),
        { kind: "IDENTIFIER", hash: identifierHash, hourlyLimit: 4 },
      ]);
      const account = await client.query<{ id: string }>(
        `SELECT id::text FROM users
         WHERE id=$1 AND lower(email)=lower($2)
           AND active=true AND account_status='ACTIVE'
         FOR UPDATE`,
        [userId, normalizedEmail],
      );
      if (!account.rowCount) throw new Error("The account email cannot be verified.");

      await client.query(
        `UPDATE email_verification_tokens
         SET revoked_at=now(),revoked_reason='replaced'
         WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,
        [userId],
      );
      await client.query(
        `UPDATE transactional_email_outbox outbox
         SET delivery_status='CANCELLED',delivery_lease_id=NULL,
             delivery_lease_expires_at=NULL,
             token_ciphertext=NULL,token_nonce=NULL,
             token_authentication_tag=NULL
         WHERE outbox.delivery_status IN ('PENDING','SENDING')
           AND EXISTS (
             SELECT 1 FROM email_verification_tokens verification
             WHERE verification.id=outbox.email_verification_token_id
               AND verification.user_id=$1 AND verification.revoked_at IS NOT NULL
           )`,
        [userId],
      );
      await client.query(
        `INSERT INTO email_verification_tokens(
           id,user_id,email,token_hash,expires_at,locale
         ) VALUES (
           $1,$2,$3,$4,now()+make_interval(hours => $5::integer),$6
         )`,
        [
          tokenId,
          userId,
          normalizedEmail,
          tokenHash,
          EMAIL_VERIFICATION_TTL_HOURS,
          normalizedLocale,
        ],
      );
      await insertSecurityEmailOutbox(client, prepared);
    },
  );
  return { accepted: true as const };
}

export async function inspectPasswordResetToken(rawToken: string) {
  if (isDemoMode() || !validToken(rawToken)) return { valid: false as const };
  const result = await query<{ locale: SupportedEmailLocale }>(
    `SELECT reset.locale FROM password_reset_tokens reset
     JOIN users account ON account.id=reset.user_id
     WHERE reset.token_hash=$1
       AND reset.used_at IS NULL AND reset.revoked_at IS NULL
       AND reset.expires_at > now()
       AND account.active=true AND account.account_status='ACTIVE'
       AND account.account_setup_completed_at IS NOT NULL`,
    [hashSecurityToken(rawToken)],
  );
  const parsedLocale = localeSchema.safeParse(result.rows[0]?.locale);
  return result.rowCount
    ? { valid: true as const, locale: parsedLocale.success ? parsedLocale.data : "en" }
    : { valid: false as const };
}

export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string,
) {
  if (!validToken(rawToken)) throw new SecurityTokenError();
  const inspection = await inspectPasswordResetToken(rawToken);
  if (!inspection.valid) throw new SecurityTokenError();
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashSecurityToken(rawToken);

  return withAuditTransaction(
    { reason: "Password reset completed" },
    async (client) => {
      const selected = await client.query<{
        tokenId: string;
        userId: string;
      }>(
        `SELECT reset.id::text AS "tokenId",account.id::text AS "userId"
         FROM password_reset_tokens reset
         JOIN users account ON account.id=reset.user_id
         JOIN account_credentials credential ON credential.user_id=account.id
         WHERE reset.token_hash=$1
           AND reset.used_at IS NULL AND reset.revoked_at IS NULL
           AND reset.expires_at > now()
           AND account.active=true AND account.account_status='ACTIVE'
           AND account.account_setup_completed_at IS NOT NULL
         FOR UPDATE OF reset,account,credential`,
        [tokenHash],
      );
      const token = selected.rows[0];
      if (!token) throw new SecurityTokenError();
      const updated = await client.query<{ authVersion: number }>(
        `UPDATE users
         SET password_hash=$2,auth_version=auth_version+1
         WHERE id=$1
         RETURNING auth_version AS "authVersion"`,
        [token.userId, passwordHash],
      );
      await client.query(
        `UPDATE account_credentials
         SET password_hash=$2,password_algorithm='argon2id',
             password_changed_at=now(),failed_sign_in_count=0,
             first_failed_sign_in_at=NULL,locked_until=NULL,
             credential_version=$3
         WHERE user_id=$1`,
        [token.userId, passwordHash, Number(updated.rows[0].authVersion)],
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE id=$1",
        [token.tokenId],
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET revoked_at=now(),revoked_reason='password_changed'
         WHERE user_id=$1 AND id<>$2
           AND used_at IS NULL AND revoked_at IS NULL`,
        [token.userId, token.tokenId],
      );
      await client.query(
        `UPDATE transactional_email_outbox outbox
         SET delivery_status='CANCELLED',delivery_lease_id=NULL,
             delivery_lease_expires_at=NULL,
             token_ciphertext=NULL,token_nonce=NULL,
             token_authentication_tag=NULL
         WHERE outbox.delivery_status IN ('PENDING','SENDING')
           AND EXISTS (
             SELECT 1 FROM password_reset_tokens reset
             WHERE reset.id=outbox.password_reset_token_id
               AND reset.user_id=$1
           )`,
        [token.userId],
      );
      await insertPasswordChangedEmailOutbox(
        client,
        token.tokenId,
        inspection.locale,
      );
      await client.query(
        `UPDATE user_sessions
         SET revoked_at=now(),revoke_reason='password_reset'
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [token.userId],
      );
      return { completed: true as const };
    },
  );
}

export async function consumeEmailVerificationToken(rawToken: string) {
  if (!validToken(rawToken)) throw new SecurityTokenError();
  const tokenHash = hashSecurityToken(rawToken);
  return withAuditTransaction(
    { reason: "Email verification completed" },
    async (client) => {
      const selected = await client.query<{
        tokenId: string;
        userId: string;
        locale: SupportedEmailLocale;
      }>(
        `SELECT verification.id::text AS "tokenId",
           account.id::text AS "userId",verification.locale
         FROM email_verification_tokens verification
         JOIN users account ON account.id=verification.user_id
         WHERE verification.token_hash=$1
           AND verification.used_at IS NULL
           AND verification.revoked_at IS NULL
           AND verification.expires_at > now()
           AND lower(verification.email)=lower(account.email)
           AND account.active=true AND account.account_status='ACTIVE'
         FOR UPDATE OF verification,account`,
        [tokenHash],
      );
      const token = selected.rows[0];
      if (!token) throw new SecurityTokenError();
      await client.query(
        "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
        [token.userId],
      );
      await client.query(
        "UPDATE email_verification_tokens SET used_at=now() WHERE id=$1",
        [token.tokenId],
      );
      await client.query(
        `UPDATE transactional_email_outbox
         SET delivery_status='CANCELLED',delivery_lease_id=NULL,
             delivery_lease_expires_at=NULL,
             token_ciphertext=NULL,token_nonce=NULL,
             token_authentication_tag=NULL
         WHERE email_verification_token_id=$1
           AND delivery_status IN ('PENDING','SENDING')`,
        [token.tokenId],
      );
      const parsedLocale = localeSchema.safeParse(token.locale);
      return { verified: true as const, locale: parsedLocale.success ? parsedLocale.data : "en" };
    },
  );
}

export const securityNotificationInternals = {
  passwordResetTtlMinutes: PASSWORD_RESET_TTL_MINUTES,
  emailVerificationTtlHours: EMAIL_VERIFICATION_TTL_HOURS,
};
