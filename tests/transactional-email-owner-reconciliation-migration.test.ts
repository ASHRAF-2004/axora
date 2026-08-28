import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const signature = "axora_reconcile_transactional_email_delivery(uuid,text,text,timestamp with time zone,text)";

describe("database-owner transactional email reconciliation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    const applied = await applyMigrations(db);
    expect(applied.at(-1)).toBe("127_transactional_email_owner_reconciliation.sql");
    await db.exec(`CREATE TABLE schema_migrations(
      filename text PRIMARY KEY,sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const grantSource = await readFile(
      new URL("../database/admin/apply-app-grants.sql", import.meta.url),
      "utf8",
    );
    await db.exec(grantSource
      .split("\n")
      .filter((line) => (
        !line.trimStart().startsWith("\\")
        && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
      ))
      .join("\n"));
  }, 30_000);

  afterAll(async () => db.close());

  it("keeps recovery unavailable to the application and PUBLIC roles", async () => {
    const result = await db.query<{
      appExecute: boolean;
      publicExecute: boolean;
      securityDefiner: boolean;
      configuration: string[] | null;
    }>(`
      SELECT
        has_function_privilege('axora_app',procedure.oid,'EXECUTE') AS "appExecute",
        has_function_privilege('public',procedure.oid,'EXECUTE') AS "publicExecute",
        procedure.prosecdef AS "securityDefiner",
        procedure.proconfig AS configuration
      FROM pg_proc procedure WHERE procedure.oid=$1::regprocedure
    `, [signature]);
    expect(result.rows[0]).toMatchObject({
      appExecute: false,
      publicExecute: false,
      securityDefiner: false,
    });
    expect(result.rows[0].configuration).toContain(
      "search_path=pg_catalog, public, pg_temp",
    );
  });

  it("reconciles one lease-expired provider delivery with append-only evidence", async () => {
    const created = await db.query<{ value: Record<string, unknown> }>(`
      SELECT axora_record_public_contact_submission(jsonb_build_object(
        'idempotencyKey',repeat('a',64),'locale','en',
        'fullName','Controlled reconciliation','email','visitor@example.com',
        'phone','+60183816023','message','Controlled reconciliation fixture.',
        'privacyPolicyVersion','2026-08-28','sourcePage','/en/contact',
        'sourceMetadata','{}'::jsonb,'networkRateKey',repeat('b',64),
        'senderRateKey',repeat('c',64),'turnstileChallengeAt',now()::text,
        'turnstileHostname','axora.management'
      ),now()) AS value
    `);
    const contactId = String(created.rows[0].value.submissionId);
    const outbox = await db.query<{ id: string }>(`
      INSERT INTO transactional_email_outbox(
        message_kind,contact_submission_id,locale
      ) VALUES ('CONTACT_NOTIFICATION',$1,'en') RETURNING id::text
    `, [contactId]);
    const deliveryId = outbox.rows[0].id;
    await db.query(`
      UPDATE transactional_email_outbox
      SET delivery_status='SENDING',delivery_attempt_count=1,
          delivery_attempted_at=now(),delivery_lease_id=$2,
          delivery_lease_expires_at=now()+interval '60 seconds'
      WHERE id=$1
    `, [deliveryId, "20000000-0000-4000-8000-000000000001"]);
    await db.query(`
      UPDATE transactional_email_outbox
      SET delivery_status='UNCERTAIN',delivery_lease_id=NULL,
          delivery_lease_expires_at=NULL,last_delivery_error='lease_expired'
      WHERE id=$1
    `, [deliveryId]);
    await db.query(`
      UPDATE public_contact_submissions
      SET notification_status='NOTIFICATION_UNCERTAIN',
          notification_finalized_at=now()
      WHERE id=$1
    `, [contactId]);

    const reconciled = await db.query<{ value: boolean }>(`
      SELECT axora_reconcile_transactional_email_delivery(
        $1,$2,'resend',now(),'Confirmed controlled provider delivery'
      ) AS value
    `, [deliveryId, "20000000-0000-4000-8000-000000000002"]);
    expect(reconciled.rows[0].value).toBe(true);

    const evidence = await db.query<{
      status: string;
      providerId: string;
      notificationStatus: string;
      attempts: number;
    }>(`
      SELECT outbox.delivery_status AS status,
        outbox.provider_message_id AS "providerId",
        submission.notification_status AS "notificationStatus",
        (SELECT count(*)::int FROM email_delivery_attempts attempt
          WHERE attempt.delivery_id=outbox.id) AS attempts
      FROM transactional_email_outbox outbox
      JOIN public_contact_submissions submission
        ON submission.id=outbox.contact_submission_id
      WHERE outbox.id=$1
    `, [deliveryId]);
    expect(evidence.rows[0]).toEqual({
      status: "SENT",
      providerId: "20000000-0000-4000-8000-000000000002",
      notificationStatus: "NOTIFIED",
      attempts: 1,
    });
  });
});
