import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const softEvent = "e8100000-0000-4000-8000-000000000001";
const hardEvent = "e8100000-0000-4000-8000-000000000002";
const complaintEvent = "e8100000-0000-4000-8000-000000000003";
const occurredAt = "2026-08-02T10:00:00.000Z";
const normalizedEmail = "recipient@example.test";
const fingerprint = createHash("sha256").update(normalizedEmail).digest("hex");
const messageFingerprint = createHash("sha256")
  .update("provider-message-suppression-fixture")
  .digest("hex");
const transactionalRecipient = "queued-recipient@example.test";
const transactionalFingerprint = createHash("sha256")
  .update(transactionalRecipient)
  .digest("hex");

describe("Resend provider-event suppression migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function record(
    eventId: string,
    eventType: "MESSAGE_BOUNCED" | "MESSAGE_COMPLAINED",
    bounceType: "HARD" | "SOFT" | null,
  ) {
    return db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT recorded,suppressed
      FROM axora_record_resend_email_event($1,$2,$3,$4,$5,$6,$7,1)
    `, [
      eventId,
      eventType,
      fingerprint,
      messageFingerprint,
      bounceType,
      true,
      occurredAt,
    ]);
  }

  it("uses the same normalized SHA-256 recipient fingerprint as the edge consumer", async () => {
    const result = await db.query<{ fingerprint: string }>(`
      SELECT axora_email_recipient_fingerprint($1) AS fingerprint
    `, ["  Recipient@Example.Test "]);
    expect(result.rows[0]?.fingerprint).toBe(fingerprint);
  });

  it("records a soft bounce without suppressing future delivery", async () => {
    await expect(record(softEvent, "MESSAGE_BOUNCED", "SOFT"))
      .resolves.toMatchObject({ rows: [{ recorded: true, suppressed: false }] });
    const state = await db.query<{ events: number; suppressions: number }>(`
      SELECT
        (SELECT count(*)::integer FROM email_provider_events) AS events,
        (SELECT count(*)::integer FROM email_recipient_suppressions) AS suppressions
    `);
    expect(state.rows[0]).toEqual({ events: 1, suppressions: 0 });
  });

  it("suppresses hard bounces and complaints with durable idempotency", async () => {
    await expect(record(hardEvent, "MESSAGE_BOUNCED", "HARD"))
      .resolves.toMatchObject({ rows: [{ recorded: true, suppressed: true }] });
    await expect(record(hardEvent, "MESSAGE_BOUNCED", "HARD"))
      .resolves.toMatchObject({ rows: [{ recorded: false, suppressed: true }] });
    await expect(record(complaintEvent, "MESSAGE_COMPLAINED", null))
      .resolves.toMatchObject({ rows: [{ recorded: true, suppressed: true }] });

    const state = await db.query<{
      event_count: number;
      hard_bounce_count: number;
      complaint_count: number;
    }>(`
      SELECT event_count,hard_bounce_count,complaint_count
      FROM email_recipient_suppressions
      WHERE recipient_fingerprint=$1
    `, [fingerprint]);
    expect(state.rows[0]).toEqual({
      event_count: 2,
      hard_bounce_count: 1,
      complaint_count: 1,
    });
  });

  it("cancels pending token email and erases encrypted bearer material", async () => {
    const userId = "e8200000-0000-4000-8000-000000000001";
    const verificationId = "e8200000-0000-4000-8000-000000000002";
    const outboxId = "e8200000-0000-4000-8000-000000000003";
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,email_verified_at
      )
      SELECT $1,$2,'Queued recipient','fixture-password-hash',id,true,now()
      FROM roles WHERE role_key='PLATFORM_OWNER'
    `, [userId, transactionalRecipient]);
    await db.query(`
      INSERT INTO email_verification_tokens(
        id,user_id,email,token_hash,expires_at,locale
      ) VALUES ($1,$2,$3,$4,now()+interval '1 hour','en')
    `, [verificationId, userId, transactionalRecipient, "e".repeat(64)]);
    await db.query(`
      INSERT INTO transactional_email_outbox(
        id,message_kind,email_verification_token_id,locale,
        token_ciphertext,token_nonce,token_authentication_tag
      ) VALUES ($1,'EMAIL_VERIFICATION',$2,'en',$3,$4,$5)
    `, [outboxId, verificationId, "A".repeat(58), "B".repeat(16), "C".repeat(22)]);

    const event = await db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT recorded,suppressed
      FROM axora_record_resend_email_event(
        'e8200000-0000-4000-8000-000000000004',
        'MESSAGE_BOUNCED',$1,$2,'HARD',true,$3,1
      )
    `, [transactionalFingerprint, messageFingerprint, occurredAt]);
    expect(event.rows[0]).toEqual({ recorded: true, suppressed: true });

    const cancelled = await db.query<{
      status: string;
      error: string;
      has_payload: boolean;
    }>(`
      SELECT delivery_status AS status,last_delivery_error AS error,
        token_ciphertext IS NOT NULL OR token_nonce IS NOT NULL
          OR token_authentication_tag IS NOT NULL AS has_payload
      FROM transactional_email_outbox WHERE id=$1
    `, [outboxId]);
    expect(cancelled.rows[0]).toEqual({
      status: "CANCELLED",
      error: "recipient_suppressed",
      has_payload: false,
    });
  });

  it("rejects conflicting reuse and mutation of append-only evidence", async () => {
    await expect(record(hardEvent, "MESSAGE_BOUNCED", "SOFT"))
      .rejects.toThrow(/identifier conflict/i);
    await expect(db.query(`
      UPDATE email_provider_events SET event_schema_version=2
      WHERE provider_event_id=$1
    `, [hardEvent])).rejects.toThrow(/append-only/i);
    await expect(db.query(`
      DELETE FROM email_provider_events WHERE provider_event_id=$1
    `, [hardEvent])).rejects.toThrow(/append-only/i);
  });

  it("does not persist recipient, subject or SMTP response and hides tables from the app role", async () => {
    const stored = await db.query<{ payload: string }>(`
      SELECT jsonb_agg(to_jsonb(event))::text AS payload
      FROM email_provider_events event
    `);
    expect(stored.rows[0]?.payload).not.toContain(normalizedEmail);
    expect(stored.rows[0]?.payload).not.toContain("subject");
    expect(stored.rows[0]?.payload).not.toContain("smtp");

    await db.exec("SET ROLE axora_app");
    await expect(db.query("SELECT * FROM email_provider_events"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query("SELECT * FROM email_recipient_suppressions"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query<{ suppressed: boolean }>(`
      SELECT axora_email_recipient_is_suppressed($1) AS suppressed
    `, [normalizedEmail])).resolves.toMatchObject({
      rows: [{ suppressed: true }],
    });
    await expect(db.query(`
      SELECT axora_email_recipient_fingerprint($1)
    `, [normalizedEmail])).rejects.toThrow(/permission denied/i);
    await expect(record(
      "e8100000-0000-4000-8000-000000000004",
      "MESSAGE_BOUNCED",
      "SOFT",
    )).resolves.toMatchObject({ rows: [{ recorded: true, suppressed: false }] });
    await db.exec("RESET ROLE");
  });

  it("lets the application role authorize one-shot setup delivery and claim transactional mail", async () => {
    await db.exec("SET ROLE axora_app");
    await expect(db.query<{ allowed: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM account_setup_invitations invitation
        JOIN users account ON account.id=invitation.user_id
        WHERE invitation.id=$1 AND invitation.token_hash=$2
          AND invitation.delivery_status='PENDING'
          AND NOT axora_email_recipient_is_suppressed(account.email)
      ) AS allowed
    `, ["e8200000-0000-4000-8000-000000000099", "f".repeat(64)]))
      .resolves.toMatchObject({ rows: [{ allowed: false }] });
    await expect(db.query(`
      SELECT outbox.id
      FROM transactional_email_outbox outbox
      LEFT JOIN password_reset_tokens reset
        ON reset.id=outbox.password_reset_token_id
      LEFT JOIN users account ON account.id=reset.user_id
      WHERE outbox.delivery_status='PENDING'
        AND NOT axora_email_recipient_is_suppressed(
          COALESCE(account.email,$1::text)
        )
      FOR UPDATE OF outbox SKIP LOCKED
      LIMIT 1
    `, ["unsuppressed@example.test"])).resolves.toMatchObject({ rows: [] });
    await db.exec("RESET ROLE");
  });
});
