import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { isDemoMode, withAuditTransaction } from "./db";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_SERVICE_SECRET_MINIMUM_LENGTH = 32;
const OUTBOX_LEASE_SECONDS = 90;
const OUTBOX_MAX_ATTEMPTS = 3;
const OUTBOX_RETRY_SECONDS = 60;

export type TransactionalEmailKind =
  | "CONTACT_NOTIFICATION"
  | "CONTACT_ACKNOWLEDGEMENT"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED"
  | "EMAIL_VERIFICATION";

export type TransactionalEmailOutcome =
  | "sent"
  | "retry"
  | "failed"
  | "disabled"
  | "uncertain";

export type SupportedEmailLocale = "en" | "ar" | "ms";

export interface PreparedSecurityEmailOutbox {
  outboxId: string;
  sourceId: string;
  messageKind: "PASSWORD_RESET" | "EMAIL_VERIFICATION";
  locale: SupportedEmailLocale;
  tokenCiphertext: string;
  tokenNonce: string;
  tokenAuthenticationTag: string;
}

export interface TransactionalEmailOutboxJob {
  deliveryId: string;
  leaseId: string;
  messageKind: TransactionalEmailKind;
  locale: SupportedEmailLocale;
  recipientEmail: string;
  recipientName: string;
  replyToEmail?: string;
  expiresAt?: string;
  actionUrl?: string;
  contact?: {
    name: string;
    email: string;
    company: string;
    phone?: string;
    subject: string;
    message: string;
    submittedAt: string;
  };
}

export class PublicRequestRateLimitError extends Error {
  constructor() {
    super("This public request has been rate limited.");
    this.name = "PublicRequestRateLimitError";
  }
}

function emailServiceSecret() {
  const secretFile = process.env.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE;
  let value = "";
  if (secretFile) {
    try {
      value = readFileSync(secretFile, "utf8").trim();
    } catch {
      throw new Error("The private email service key is unavailable.");
    }
  } else if (process.env.NODE_ENV !== "production") {
    value = (process.env.AXORA_EMAIL_SERVICE_AUTH_KEY ?? "").trim();
  }
  if (value.length < EMAIL_SERVICE_SECRET_MINIMUM_LENGTH
    || value.length > 4_096 || /[\s\u0000-\u001F\u007F]/.test(value)) {
    throw new Error("The private email service key is unavailable.");
  }
  return value;
}

function deriveKey(domain: string) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(emailServiceSecret(), "utf8")
    .digest();
}

function normalizedFingerprintInput(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512
    || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error("The rate limit context is invalid.");
  }
  return normalized;
}

/** Keyed fingerprints prevent offline recovery of low-entropy IP addresses. */
export function publicRequestRateKey(scope: "network" | "identifier", value: string) {
  return createHmac(
    "sha256",
    deriveKey(`axora-public-request-${scope}-fingerprint-v1`),
  ).update(normalizedFingerprintInput(value), "utf8").digest("hex");
}

export async function consumePublicRequestRateLimit(
  client: PoolClient,
  action: "CONTACT" | "PASSWORD_RESET" | "EMAIL_VERIFICATION",
  scopes: Array<{
    kind: "NETWORK" | "IDENTIFIER";
    hash: string;
    hourlyLimit: number;
  }>,
) {
  for (const scope of scopes) {
    if (!HASH_PATTERN.test(scope.hash)
      || !Number.isInteger(scope.hourlyLimit)
      || scope.hourlyLimit < 1 || scope.hourlyLimit > 1_000) {
      throw new Error("The public request rate limit configuration is invalid.");
    }
    const consumed = await client.query(
      `INSERT INTO public_request_rate_buckets(
         action_key,scope_kind,scope_hash,bucket_started_at,request_count
       ) VALUES ($1,$2,$3,date_trunc('hour',now()),1)
       ON CONFLICT(action_key,scope_kind,scope_hash,bucket_started_at)
       DO UPDATE SET request_count=public_request_rate_buckets.request_count+1
       WHERE public_request_rate_buckets.request_count < $4
       RETURNING request_count`,
      [action, scope.kind, scope.hash, scope.hourlyLimit],
    );
    if (!consumed.rowCount) throw new PublicRequestRateLimitError();
  }
}

function securityTokenAssociatedData(input: {
  outboxId: string;
  sourceId: string;
  messageKind: "PASSWORD_RESET" | "EMAIL_VERIFICATION";
  tokenHash: string;
}) {
  return Buffer.from(
    `axora-transactional-email-token-v1:${input.outboxId}:${input.sourceId}:${input.messageKind}:${input.tokenHash}`,
    "utf8",
  );
}

export function prepareSecurityEmailOutbox(input: {
  rawToken: string;
  tokenHash: string;
  sourceId: string;
  messageKind: "PASSWORD_RESET" | "EMAIL_VERIFICATION";
  locale: SupportedEmailLocale;
  outboxId?: string;
}): PreparedSecurityEmailOutbox {
  const outboxId = input.outboxId ?? randomUUID();
  if (!TOKEN_PATTERN.test(input.rawToken) || !HASH_PATTERN.test(input.tokenHash)
    || !UUID_PATTERN.test(input.sourceId) || !UUID_PATTERN.test(outboxId)
    || !["en", "ar", "ms"].includes(input.locale)) {
    throw new Error("The security email payload is invalid.");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey("axora-transactional-email-token-encryption-v1"),
    nonce,
  );
  cipher.setAAD(securityTokenAssociatedData({
    outboxId,
    sourceId: input.sourceId,
    messageKind: input.messageKind,
    tokenHash: input.tokenHash,
  }));
  const ciphertext = Buffer.concat([
    cipher.update(input.rawToken, "utf8"),
    cipher.final(),
  ]);
  return {
    outboxId,
    sourceId: input.sourceId,
    messageKind: input.messageKind,
    locale: input.locale,
    tokenCiphertext: ciphertext.toString("base64url"),
    tokenNonce: nonce.toString("base64url"),
    tokenAuthenticationTag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptSecurityToken(input: {
  outboxId: string;
  sourceId: string;
  messageKind: "PASSWORD_RESET" | "EMAIL_VERIFICATION";
  tokenHash: string;
  tokenCiphertext: string;
  tokenNonce: string;
  tokenAuthenticationTag: string;
}) {
  try {
    const nonce = Buffer.from(input.tokenNonce, "base64url");
    const tag = Buffer.from(input.tokenAuthenticationTag, "base64url");
    const ciphertext = Buffer.from(input.tokenCiphertext, "base64url");
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length !== 43) {
      throw new Error("invalid_payload");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey("axora-transactional-email-token-encryption-v1"),
      nonce,
    );
    decipher.setAAD(securityTokenAssociatedData(input));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!TOKEN_PATTERN.test(token)
      || createHash("sha256").update(token, "utf8").digest("hex") !== input.tokenHash) {
      throw new Error("invalid_payload");
    }
    return token;
  } catch {
    throw new Error("The transactional email payload could not be recovered.");
  }
}

export async function insertSecurityEmailOutbox(
  client: PoolClient,
  prepared: PreparedSecurityEmailOutbox,
) {
  const sourceColumn = prepared.messageKind === "PASSWORD_RESET"
    ? "password_reset_token_id"
    : "email_verification_token_id";
  await client.query(
    `INSERT INTO transactional_email_outbox(
       id,message_kind,${sourceColumn},locale,
       token_ciphertext,token_nonce,token_authentication_tag
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      prepared.outboxId,
      prepared.messageKind,
      prepared.sourceId,
      prepared.locale,
      prepared.tokenCiphertext,
      prepared.tokenNonce,
      prepared.tokenAuthenticationTag,
    ],
  );
}

export async function insertContactEmailOutbox(
  client: PoolClient,
  submissionId: string,
  locale: SupportedEmailLocale,
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO transactional_email_outbox(
       message_kind,contact_submission_id,locale
     ) VALUES ('CONTACT_NOTIFICATION',$1,$2)
     RETURNING id::text`,
    [submissionId, locale],
  );
  return result.rows[0].id;
}

export async function insertContactAcknowledgementEmailOutbox(
  client: PoolClient,
  submissionId: string,
  locale: SupportedEmailLocale,
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO transactional_email_outbox(
       message_kind,contact_submission_id,locale
     ) VALUES ('CONTACT_ACKNOWLEDGEMENT',$1,$2)
     RETURNING id::text`,
    [submissionId, locale],
  );
  return result.rows[0].id;
}

export async function insertPasswordChangedEmailOutbox(
  client: PoolClient,
  passwordResetTokenId: string,
  locale: SupportedEmailLocale,
) {
  await client.query(
    `INSERT INTO transactional_email_outbox(
       message_kind,password_reset_token_id,locale
     ) VALUES ('PASSWORD_CHANGED',$1,$2)`,
    [passwordResetTokenId, locale],
  );
}

function contactNotificationRecipient() {
  const value = (process.env.AXORA_CONTACT_NOTIFICATION_TO ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value.length > 254 || !EMAIL_PATTERN.test(value) || /[\r\n]/.test(value)) {
    throw new Error("The private contact notification recipient is invalid.");
  }
  return value;
}

function canonicalApplicationBaseUrl() {
  const parsed = new URL(process.env.APP_BASE_URL ?? "https://axora.management");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("APP_BASE_URL must be the canonical Axora HTTPS origin.");
  }
  return parsed;
}

function securityActionUrl(
  kind: "PASSWORD_RESET" | "EMAIL_VERIFICATION",
  rawToken: string,
) {
  const url = new URL(
    kind === "PASSWORD_RESET" ? "/account/reset-password" : "/account/verify-email",
    canonicalApplicationBaseUrl(),
  );
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

interface OutboxRow {
  deliveryId: string;
  messageKind: TransactionalEmailKind;
  locale: SupportedEmailLocale;
  sourceId?: string;
  tokenHash?: string;
  tokenCiphertext?: string;
  tokenNonce?: string;
  tokenAuthenticationTag?: string;
  recipientName?: string;
  recipientEmail?: string;
  expiresAt?: string;
  contactName?: string;
  contactEmail?: string;
  companyName?: string;
  phone?: string;
  subject?: string;
  message?: string;
  submittedAt?: string;
}

export async function claimTransactionalEmailOutbox(): Promise<TransactionalEmailOutboxJob | null> {
  if (isDemoMode()) return null;
  const privateContactRecipient = contactNotificationRecipient();
  return withAuditTransaction(
    { reason: "Transactional email claimed" },
    async (client) => {
      // Provider hard-bounce and complaint events suppress only email. Contact
      // records remain durable and in-app workflow notifications are unrelated.
      // Purge encrypted bearer material before selecting any suppressed job.
      await client.query(
        `WITH cancelled AS (
           UPDATE transactional_email_outbox outbox
           SET delivery_status='CANCELLED',
               last_delivery_error='recipient_suppressed',
               token_ciphertext=NULL,token_nonce=NULL,
               token_authentication_tag=NULL
           WHERE outbox.delivery_status='PENDING'
             AND (
               (outbox.message_kind='CONTACT_NOTIFICATION'
                 AND $1::text IS NOT NULL
                 AND axora_email_recipient_is_suppressed($1::text))
               OR (outbox.message_kind='CONTACT_ACKNOWLEDGEMENT' AND EXISTS (
                 SELECT 1 FROM public_contact_submissions submission
                 WHERE submission.id=outbox.contact_submission_id
                   AND axora_email_recipient_is_suppressed(submission.contact_email)
               ))
               OR (outbox.message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED') AND EXISTS (
                 SELECT 1
                 FROM password_reset_tokens reset
                 JOIN users account ON account.id=reset.user_id
                 WHERE reset.id=outbox.password_reset_token_id
                   AND axora_email_recipient_is_suppressed(account.email)
               ))
               OR (outbox.message_kind='EMAIL_VERIFICATION' AND EXISTS (
                 SELECT 1
                 FROM email_verification_tokens verification
                 WHERE verification.id=outbox.email_verification_token_id
                   AND axora_email_recipient_is_suppressed(verification.email)
               ))
             )
           RETURNING contact_submission_id,message_kind
         )
         UPDATE public_contact_submissions submission
         SET notification_status=CASE WHEN EXISTS (
               SELECT 1 FROM cancelled WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_NOTIFICATION'
             ) THEN 'NOTIFICATION_FAILED' ELSE notification_status END,
             notification_finalized_at=CASE WHEN EXISTS (
               SELECT 1 FROM cancelled WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_NOTIFICATION'
             ) THEN now() ELSE notification_finalized_at END,
             acknowledgement_status=CASE WHEN EXISTS (
               SELECT 1 FROM cancelled WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_ACKNOWLEDGEMENT'
             ) THEN 'FAILED' ELSE acknowledgement_status END,
             acknowledgement_finalized_at=CASE WHEN EXISTS (
               SELECT 1 FROM cancelled WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_ACKNOWLEDGEMENT'
             ) THEN now() ELSE acknowledgement_finalized_at END
         WHERE submission.id IN (
           SELECT contact_submission_id FROM cancelled
           WHERE contact_submission_id IS NOT NULL
         )`,
        [privateContactRecipient],
      );

      await client.query(
        `UPDATE transactional_email_outbox outbox
         SET delivery_status='CANCELLED',delivery_lease_id=NULL,
             delivery_lease_expires_at=NULL,
             token_ciphertext=NULL,token_nonce=NULL,
             token_authentication_tag=NULL
         WHERE outbox.delivery_status='PENDING' AND (
           (outbox.message_kind='PASSWORD_RESET' AND EXISTS (
             SELECT 1 FROM password_reset_tokens reset
             WHERE reset.id=outbox.password_reset_token_id
               AND (reset.used_at IS NOT NULL OR reset.revoked_at IS NOT NULL
                 OR reset.expires_at <= now())
           ))
           OR (outbox.message_kind='EMAIL_VERIFICATION' AND EXISTS (
             SELECT 1 FROM email_verification_tokens verification
             WHERE verification.id=outbox.email_verification_token_id
               AND (verification.used_at IS NOT NULL
                 OR verification.revoked_at IS NOT NULL
                 OR verification.expires_at <= now())
           ))
         )`,
      );
      await client.query(
        `WITH expired AS (
           UPDATE transactional_email_outbox
           SET delivery_status='UNCERTAIN',delivery_lease_id=NULL,
               delivery_lease_expires_at=NULL,last_delivery_error='lease_expired',
               token_ciphertext=NULL,token_nonce=NULL,
               token_authentication_tag=NULL
           WHERE delivery_status='SENDING'
             AND delivery_lease_expires_at <= now()
           RETURNING contact_submission_id,message_kind
         )
         UPDATE public_contact_submissions submission
         SET notification_status=CASE WHEN EXISTS (
               SELECT 1 FROM expired WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_NOTIFICATION'
             ) THEN 'NOTIFICATION_UNCERTAIN' ELSE notification_status END,
             notification_finalized_at=CASE WHEN EXISTS (
               SELECT 1 FROM expired WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_NOTIFICATION'
             ) THEN now() ELSE notification_finalized_at END,
             acknowledgement_status=CASE WHEN EXISTS (
               SELECT 1 FROM expired WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_ACKNOWLEDGEMENT'
             ) THEN 'UNCERTAIN' ELSE acknowledgement_status END,
             acknowledgement_finalized_at=CASE WHEN EXISTS (
               SELECT 1 FROM expired WHERE contact_submission_id=submission.id
                 AND message_kind='CONTACT_ACKNOWLEDGEMENT'
             ) THEN now() ELSE acknowledgement_finalized_at END
         WHERE submission.id IN (
           SELECT contact_submission_id FROM expired
           WHERE contact_submission_id IS NOT NULL
         )`,
      );

      const selected = await client.query<OutboxRow>(
        `SELECT outbox.id::text AS "deliveryId",outbox.message_kind AS "messageKind",
           outbox.locale,
           COALESCE(reset.id,verification.id)::text AS "sourceId",
           COALESCE(reset.token_hash,verification.token_hash) AS "tokenHash",
           outbox.token_ciphertext AS "tokenCiphertext",
           outbox.token_nonce AS "tokenNonce",
           outbox.token_authentication_tag AS "tokenAuthenticationTag",
           COALESCE(reset_user.display_name,verification_user.display_name)
             AS "recipientName",
           COALESCE(reset_user.email,verification.email) AS "recipientEmail",
           COALESCE(reset.expires_at,verification.expires_at)::text AS "expiresAt",
           submission.contact_name AS "contactName",
           submission.contact_email AS "contactEmail",
           submission.company_name AS "companyName",submission.phone,
           submission.subject,submission.message,
           submission.created_at::text AS "submittedAt"
         FROM transactional_email_outbox outbox
         LEFT JOIN public_contact_submissions submission
           ON submission.id=outbox.contact_submission_id
         LEFT JOIN password_reset_tokens reset
           ON reset.id=outbox.password_reset_token_id
         LEFT JOIN users reset_user ON reset_user.id=reset.user_id
         LEFT JOIN email_verification_tokens verification
           ON verification.id=outbox.email_verification_token_id
         LEFT JOIN users verification_user ON verification_user.id=verification.user_id
         WHERE outbox.delivery_status='PENDING'
           AND outbox.delivery_attempt_count < $2
           AND outbox.delivery_available_at <= now()
           AND (
             (outbox.message_kind='CONTACT_NOTIFICATION'
               AND $1::text IS NOT NULL
               AND submission.notification_status='RECEIVED'
               AND NOT axora_email_recipient_is_suppressed($1::text))
             OR (outbox.message_kind='CONTACT_ACKNOWLEDGEMENT'
               AND submission.acknowledgement_status='QUEUED'
               AND NOT axora_email_recipient_is_suppressed(submission.contact_email))
             OR (outbox.message_kind='PASSWORD_RESET'
               AND reset.used_at IS NULL AND reset.revoked_at IS NULL
               AND reset.expires_at > now()
               AND reset_user.active=true
               AND reset_user.account_status='ACTIVE'
               AND reset_user.account_setup_completed_at IS NOT NULL
               AND NOT axora_email_recipient_is_suppressed(reset_user.email))
             OR (outbox.message_kind='PASSWORD_CHANGED'
               AND reset.used_at IS NOT NULL
               AND reset_user.active=true
               AND reset_user.account_status='ACTIVE'
               AND reset_user.account_setup_completed_at IS NOT NULL
               AND NOT axora_email_recipient_is_suppressed(reset_user.email))
             OR (outbox.message_kind='EMAIL_VERIFICATION'
               AND verification.used_at IS NULL
               AND verification.revoked_at IS NULL
               AND verification.expires_at > now()
               AND lower(verification.email)=lower(verification_user.email)
               AND verification_user.active=true
               AND verification_user.account_status='ACTIVE'
               AND NOT axora_email_recipient_is_suppressed(verification.email))
           )
         ORDER BY outbox.created_at,outbox.id
         FOR UPDATE OF outbox SKIP LOCKED
         LIMIT 1`,
        [privateContactRecipient, OUTBOX_MAX_ATTEMPTS],
      );
      const row = selected.rows[0];
      if (!row) return null;

      let rawToken: string | undefined;
      if (row.messageKind === "PASSWORD_RESET"
        || row.messageKind === "EMAIL_VERIFICATION") {
        try {
          rawToken = decryptSecurityToken({
            outboxId: row.deliveryId,
            sourceId: String(row.sourceId),
            messageKind: row.messageKind,
            tokenHash: String(row.tokenHash),
            tokenCiphertext: String(row.tokenCiphertext),
            tokenNonce: String(row.tokenNonce),
            tokenAuthenticationTag: String(row.tokenAuthenticationTag),
          });
        } catch {
          await client.query(
            `UPDATE transactional_email_outbox
             SET delivery_status='FAILED',delivery_attempted_at=now(),
                 last_delivery_error='payload_decryption_failed',
                 token_ciphertext=NULL,token_nonce=NULL,
                 token_authentication_tag=NULL
             WHERE id=$1 AND delivery_status='PENDING'`,
            [row.deliveryId],
          );
          return null;
        }
      }

      const leaseId = randomUUID();
      const claimed = await client.query(
        `UPDATE transactional_email_outbox
         SET delivery_status='SENDING',delivery_attempted_at=now(),
             delivery_attempt_count=delivery_attempt_count+1,
             delivery_lease_id=$2,
             delivery_lease_expires_at=now()+make_interval(secs => $3::integer),
             last_delivery_error=NULL
         WHERE id=$1 AND delivery_status='PENDING'
         RETURNING id`,
        [row.deliveryId, leaseId, OUTBOX_LEASE_SECONDS],
      );
      if (!claimed.rowCount) return null;

      if (row.messageKind === "CONTACT_NOTIFICATION"
        || row.messageKind === "CONTACT_ACKNOWLEDGEMENT") {
        const acknowledgement = row.messageKind === "CONTACT_ACKNOWLEDGEMENT";
        return {
          deliveryId: row.deliveryId,
          leaseId,
          messageKind: row.messageKind,
          locale: row.locale,
          recipientEmail: acknowledgement
            ? String(row.contactEmail)
            : String(privateContactRecipient),
          recipientName: acknowledgement
            ? String(row.contactName)
            : "Axora contact team",
          replyToEmail: acknowledgement ? undefined : String(row.contactEmail),
          contact: {
            name: String(row.contactName),
            email: String(row.contactEmail),
            company: String(row.companyName),
            ...(row.phone ? { phone: row.phone } : {}),
            subject: String(row.subject),
            message: String(row.message),
            submittedAt: String(row.submittedAt),
          },
        };
      }

      if (row.messageKind === "PASSWORD_CHANGED") {
        return {
          deliveryId: row.deliveryId,
          leaseId,
          messageKind: row.messageKind,
          locale: row.locale,
          recipientEmail: String(row.recipientEmail),
          recipientName: String(row.recipientName),
        };
      }

      return {
        deliveryId: row.deliveryId,
        leaseId,
        messageKind: row.messageKind,
        locale: row.locale,
        recipientEmail: String(row.recipientEmail),
        recipientName: String(row.recipientName),
        expiresAt: String(row.expiresAt),
        actionUrl: securityActionUrl(row.messageKind, String(rawToken)),
      };
    },
  );
}

function safeErrorCode(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(normalized)) {
    throw new Error("The transactional email error code is invalid.");
  }
  return normalized;
}

function safeProviderMessageId(value: string | undefined) {
  const normalized = value?.trim();
  if (normalized && (normalized.length > 255 || /[\r\n]/.test(normalized))) {
    throw new Error("The email provider message identifier is invalid.");
  }
  return normalized || null;
}

export async function completeTransactionalEmailOutbox(
  deliveryId: string,
  leaseId: string,
  outcome: TransactionalEmailOutcome,
  details: { providerMessageId?: string; errorCode?: string } = {},
) {
  if (isDemoMode()) return false;
  if (!UUID_PATTERN.test(deliveryId) || !UUID_PATTERN.test(leaseId)) {
    throw new Error("The transactional email lease is invalid.");
  }
  const providerMessageId = safeProviderMessageId(details.providerMessageId);
  const errorCode = safeErrorCode(details.errorCode);
  if (outcome === "sent" && errorCode) {
    throw new Error("A successful transactional email cannot contain an error code.");
  }

  return withAuditTransaction(
    { reason: `Transactional email ${outcome}` },
    async (client) => {
      const updated = await client.query<{
        contactSubmissionId?: string;
        deliveryStatus: string;
        messageKind: TransactionalEmailKind;
      }>(
        `UPDATE transactional_email_outbox
         SET delivery_status=CASE
               WHEN $3='sent' THEN 'SENT'
               WHEN $3='retry' AND delivery_attempt_count < $6
                 THEN 'PENDING'
               WHEN $3='uncertain' THEN 'UNCERTAIN'
               WHEN $3='disabled' THEN 'DISABLED'
               ELSE 'FAILED'
             END,
             delivery_available_at=CASE WHEN $3='retry'
               THEN now()+make_interval(secs => $7::integer)
               ELSE delivery_available_at END,
             sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,
             provider_message_id=CASE WHEN $3='sent' THEN $4 ELSE NULL END,
             last_delivery_error=CASE
               WHEN $3='sent' THEN NULL
               WHEN $3='retry' AND delivery_attempt_count >= $6
                 THEN 'retry_exhausted'
               WHEN $3='disabled' THEN COALESCE($5,'delivery_disabled')
               WHEN $3='uncertain' THEN COALESCE($5,'delivery_uncertain')
               ELSE COALESCE($5,'delivery_failed') END,
             delivery_lease_id=NULL,delivery_lease_expires_at=NULL,
             token_ciphertext=CASE
               WHEN $3='retry' AND delivery_attempt_count < $6
                 THEN token_ciphertext ELSE NULL END,
             token_nonce=CASE
               WHEN $3='retry' AND delivery_attempt_count < $6
                 THEN token_nonce ELSE NULL END,
             token_authentication_tag=CASE
               WHEN $3='retry' AND delivery_attempt_count < $6
                 THEN token_authentication_tag ELSE NULL END
         WHERE id=$1 AND delivery_status='SENDING' AND delivery_lease_id=$2
         RETURNING contact_submission_id::text AS "contactSubmissionId",
           delivery_status AS "deliveryStatus",message_kind AS "messageKind"`,
        [
          deliveryId,
          leaseId,
          outcome,
          providerMessageId,
          errorCode,
          OUTBOX_MAX_ATTEMPTS,
          OUTBOX_RETRY_SECONDS,
        ],
      );
      const row = updated.rows[0];
      if (!row) return false;
      const messageKind = row.messageKind ?? "CONTACT_NOTIFICATION";
      if (row.contactSubmissionId && row.deliveryStatus !== "PENDING") {
        if (messageKind === "CONTACT_NOTIFICATION") {
          const status = row.deliveryStatus === "SENT"
            ? "NOTIFIED"
            : row.deliveryStatus === "UNCERTAIN"
              ? "NOTIFICATION_UNCERTAIN"
              : "NOTIFICATION_FAILED";
          await client.query(
            `UPDATE public_contact_submissions
             SET notification_status=$2,
                 notified_at=CASE WHEN $2='NOTIFIED' THEN now() ELSE NULL END,
                 notification_finalized_at=now()
             WHERE id=$1 AND notification_status='RECEIVED'`,
            [row.contactSubmissionId, status],
          );
        } else if (messageKind === "CONTACT_ACKNOWLEDGEMENT") {
          const status = row.deliveryStatus === "SENT"
            ? "SENT"
            : row.deliveryStatus === "UNCERTAIN" ? "UNCERTAIN" : "FAILED";
          await client.query(
            `UPDATE public_contact_submissions
             SET acknowledgement_status=$2,
                 acknowledged_at=CASE WHEN $2='SENT' THEN now() ELSE NULL END,
                 acknowledgement_finalized_at=now()
             WHERE id=$1 AND acknowledgement_status='QUEUED'`,
            [row.contactSubmissionId, status],
          );
        }
      }
      return true;
    },
  );
}

export const transactionalEmailInternals = {
  contactNotificationRecipient,
  decryptSecurityToken,
};
