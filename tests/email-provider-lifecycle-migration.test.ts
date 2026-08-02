import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

type LifecycleType =
  | "MESSAGE_DELIVERED"
  | "MESSAGE_DEFERRED"
  | "MESSAGE_BOUNCED"
  | "MESSAGE_FAILED"
  | "MESSAGE_REJECTED"
  | "MESSAGE_COMPLAINED";

type Fixture = {
  id: string;
  type: LifecycleType;
  terminal: boolean;
  bounce: "HARD" | "SOFT" | null;
  providerMessageId: string;
  recipientEmail?: string;
};

const occurredAt = "2026-08-02T10:00:00.000Z";
const recipient = "lifecycle-recipient@example.test";
const recipientFingerprint = createHash("sha256").update(recipient).digest("hex");
const fixtures: Fixture[] = [
  {
    id: "e8300000-0000-4000-8000-000000000001",
    type: "MESSAGE_DELIVERED",
    terminal: true,
    bounce: null,
    providerMessageId: "provider-lifecycle-delivered",
  },
  {
    id: "e8300000-0000-4000-8000-000000000002",
    type: "MESSAGE_DEFERRED",
    terminal: false,
    bounce: null,
    providerMessageId: "provider-lifecycle-deferred",
  },
  {
    id: "e8300000-0000-4000-8000-000000000003",
    type: "MESSAGE_BOUNCED",
    terminal: true,
    bounce: "HARD",
    providerMessageId: "provider-lifecycle-bounced",
  },
  {
    id: "e8300000-0000-4000-8000-000000000004",
    type: "MESSAGE_FAILED",
    terminal: true,
    bounce: null,
    providerMessageId: "provider-lifecycle-failed",
  },
  {
    id: "e8300000-0000-4000-8000-000000000005",
    type: "MESSAGE_REJECTED",
    terminal: true,
    bounce: null,
    providerMessageId: "provider-lifecycle-rejected",
  },
  {
    id: "e8300000-0000-4000-8000-000000000006",
    type: "MESSAGE_COMPLAINED",
    terminal: true,
    bounce: null,
    providerMessageId: "provider-lifecycle-complained",
  },
];
const accountFixture: Fixture = {
  id: "e8300000-0000-4000-8000-000000000007",
  type: "MESSAGE_DELIVERED",
  terminal: true,
  bounce: null,
  providerMessageId: "provider-lifecycle-account-setup",
  recipientEmail: "lifecycle-owner@example.test",
};
const workflowFixture: Fixture = {
  id: "e8300000-0000-4000-8000-000000000008",
  type: "MESSAGE_FAILED",
  terminal: true,
  bounce: null,
  providerMessageId: "provider-lifecycle-workflow",
  recipientEmail: "lifecycle-workflow@example.test",
};
const allFixtures = [...fixtures, accountFixture, workflowFixture];

function messageFingerprint(providerMessageId: string) {
  return createHash("sha256").update(providerMessageId).digest("hex");
}

describe("Cloudflare Email Sending lifecycle migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);

    for (const [index, fixture] of fixtures.entries()) {
      const suffix = String(index + 1).padStart(12, "0");
      const contactId = `e8400000-0000-4000-8000-${suffix}`;
      const outboxId = `e8500000-0000-4000-8000-${suffix}`;
      await db.query(`
        INSERT INTO public_contact_submissions(
          id,locale,contact_name,contact_email,company_name,subject,message,
          privacy_accepted_at,network_rate_key,sender_rate_key,
          turnstile_success,turnstile_challenge_at,
          turnstile_hostname,turnstile_action
        ) VALUES (
          $1,'en','Lifecycle fixture','contact@example.test','Fixture company',
          'Lifecycle fixture','Provider lifecycle fixture message',now(),
          $2,$3,true,now(),'axora.management','contact'
        )
      `, [contactId, String(index + 1).repeat(64), String(index + 2).repeat(64)]);
      await db.query(`
        INSERT INTO transactional_email_outbox(
          id,message_kind,contact_submission_id,locale,delivery_status,
          delivery_attempt_count,delivery_attempted_at,sent_at,provider_message_id
        ) VALUES ($1,'CONTACT_NOTIFICATION',$2,'en','SENT',1,now(),now(),$3)
      `, [outboxId, contactId, fixture.providerMessageId]);
    }

    await db.exec(`
      BEGIN;
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status
      ) SELECT
        'e8700000-0000-4000-8000-000000000001',
        'lifecycle-owner@example.test','Lifecycle owner','not-a-real-hash',
        id,true,'PLATFORM','INVITED'
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO user_profiles(user_id,display_name,preferred_locale)
      VALUES (
        'e8700000-0000-4000-8000-000000000001','Lifecycle owner','en'
      );
      INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
      VALUES ('e8700000-0000-4000-8000-000000000001',NULL,NULL);
      INSERT INTO role_assignments(user_id,role_id,scope_type)
      SELECT 'e8700000-0000-4000-8000-000000000001',id,'PLATFORM'
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO onboarding_progress(user_id,profile_stage_status)
      VALUES ('e8700000-0000-4000-8000-000000000001','NOT_STARTED');
      INSERT INTO account_setup_invitations(
        id,user_id,company_id,token_hash,expires_at,intended_role_id,
        intended_scope_type,delivery_status,delivery_attempt_count,
        delivery_attempted_at,sent_at,provider_message_id
      ) SELECT
        'e8700000-0000-4000-8000-000000000002',
        'e8700000-0000-4000-8000-000000000001',NULL,
        repeat('a',64),now()+interval '1 day',id,'PLATFORM','SENT',1,
        now(),now(),'provider-lifecycle-account-setup'
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO platform_owner_bootstrap_audits(
        invitation_id,user_id,operator_identity,reason
      ) VALUES (
        'e8700000-0000-4000-8000-000000000002',
        'e8700000-0000-4000-8000-000000000001',
        'lifecycle-test-operator','Approved lifecycle correlation fixture'
      );
      COMMIT;

      INSERT INTO companies(id,company_code,name)
      VALUES (
        'e8800000-0000-4000-8000-000000000001',
        'LIFECYCLE-TEST','Lifecycle test company'
      );
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT
        'e8800000-0000-4000-8000-000000000002',
        'lifecycle-workflow@example.test','Lifecycle workflow recipient',
        'not-a-real-hash',id,'e8800000-0000-4000-8000-000000000001',
        false,'COMPANY','ACTIVE',now()
      FROM roles WHERE role_key='COMPANY_ADMIN';
      INSERT INTO workflow_events(
        id,company_id,aggregate_type,aggregate_id,event_key,event_version,
        actor_kind,correlation_id,idempotency_key,occurred_at,metadata
      ) VALUES (
        'e8800000-0000-4000-8000-000000000003',
        'e8800000-0000-4000-8000-000000000001','request',
        'e8800000-0000-4000-8000-000000000004','request.lifecycle',1,
        'SYSTEM','e8800000-0000-4000-8000-000000000004',
        'lifecycle:workflow:event',now(),'{"source":"SYSTEM"}'::jsonb
      );
      INSERT INTO workflow_email_outbox(
        id,company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
        title,body,route_path,locale,delivery_schedule,delivery_status,
        delivery_attempt_count,delivery_available_at,delivery_attempted_at,
        sent_at,provider_message_id
      ) VALUES (
        'e8800000-0000-4000-8000-000000000005',
        'e8800000-0000-4000-8000-000000000001',
        'e8800000-0000-4000-8000-000000000002',
        'e8800000-0000-4000-8000-000000000003','request.lifecycle',
        'lifecycle:workflow:outbox','Lifecycle title','Lifecycle body',
        '/notifications','en','IMMEDIATE','SENT',1,now(),now(),now(),
        'provider-lifecycle-workflow'
      );
    `);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function record(fixture: Fixture) {
    return db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT recorded,suppressed
      FROM axora_record_cloudflare_email_event($1,$2,$3,$4,$5,$6,$7,1)
    `, [
      fixture.id,
      fixture.type,
      createHash("sha256")
        .update(fixture.recipientEmail ?? recipient)
        .digest("hex"),
      messageFingerprint(fixture.providerMessageId),
      fixture.bounce,
      fixture.terminal,
      occurredAt,
    ]);
  }

  it("records all six official lifecycle types with exact terminal semantics", async () => {
    for (const fixture of allFixtures) {
      const result = await record(fixture);
      expect(result.rows[0]).toEqual({
        recorded: true,
        suppressed: fixture.type === "MESSAGE_BOUNCED"
          || fixture.type === "MESSAGE_COMPLAINED",
      });
    }

    const rows = await db.query<{
      event_type: LifecycleType;
      terminal: boolean;
      bounce_type: string | null;
      suppresses_recipient: boolean;
    }>(`
      SELECT event_type,terminal,bounce_type,suppresses_recipient
      FROM email_provider_events ORDER BY event_type
    `);
    expect(new Set(rows.rows.map((row) => row.event_type))).toEqual(
      new Set(allFixtures.map((fixture) => fixture.type)),
    );
    expect(rows.rows.find((row) => row.event_type === "MESSAGE_DEFERRED"))
      .toMatchObject({ terminal: false, suppresses_recipient: false });
    expect(rows.rows.filter((row) => row.suppresses_recipient).map(
      (row) => row.event_type,
    ).sort()).toEqual(["MESSAGE_BOUNCED", "MESSAGE_COMPLAINED"]);
  });

  it("correlates immutable send outcomes without rewriting terminal outbox rows", async () => {
    const lifecycle = await db.query<{
      outbox_kind: string;
      outbox_delivery_status: string;
      provider_status: LifecycleType;
      provider_terminal: boolean;
      correlation_state: string;
    }>(`
      SELECT outbox_kind,outbox_delivery_status,provider_status,
        provider_terminal,correlation_state
      FROM email_provider_delivery_lifecycle
      WHERE outbox_kind IS NOT NULL
      ORDER BY provider_status
    `);
    expect(lifecycle.rows).toHaveLength(8);
    expect(lifecycle.rows.every((row) => (
      row.outbox_delivery_status === "SENT" && row.correlation_state === "MATCHED"
    ))).toBe(true);
    expect(new Set(lifecycle.rows.map((row) => row.provider_status))).toEqual(
      new Set(allFixtures.map((fixture) => fixture.type)),
    );
    expect(lifecycle.rows.map((row) => row.outbox_kind).sort()).toEqual([
      "ACCOUNT_SETUP",
      "TRANSACTIONAL",
      "TRANSACTIONAL",
      "TRANSACTIONAL",
      "TRANSACTIONAL",
      "TRANSACTIONAL",
      "TRANSACTIONAL",
      "WORKFLOW",
    ]);

    const outboxes = await db.query<{ status: string; count: number }>(`
      SELECT delivery_status AS status,count(*)::integer AS count
      FROM transactional_email_outbox GROUP BY delivery_status
    `);
    expect(outboxes.rows).toEqual([{ status: "SENT", count: 6 }]);
  });

  it("makes unmatched and ambiguous provider correlation visible", async () => {
    await db.exec(`
      INSERT INTO public_contact_submissions(
        id,locale,contact_name,contact_email,company_name,subject,message,
        privacy_accepted_at,network_rate_key,sender_rate_key,
        turnstile_success,turnstile_challenge_at,
        turnstile_hostname,turnstile_action
      ) VALUES (
        'e8900000-0000-4000-8000-000000000001','en','Ambiguous fixture',
        'ambiguous@example.test','Fixture company','Ambiguous fixture',
        'Ambiguous lifecycle fixture message',now(),repeat('c',64),
        repeat('d',64),true,now(),'axora.management','contact'
      );
      INSERT INTO transactional_email_outbox(
        id,message_kind,contact_submission_id,locale,delivery_status,
        delivery_attempt_count,delivery_attempted_at,sent_at,provider_message_id
      ) VALUES (
        'e8900000-0000-4000-8000-000000000002','CONTACT_NOTIFICATION',
        'e8900000-0000-4000-8000-000000000001','en','SENT',1,now(),now(),
        'provider-lifecycle-delivered'
      );
      INSERT INTO public_contact_submissions(
        id,locale,contact_name,contact_email,company_name,subject,message,
        privacy_accepted_at,network_rate_key,sender_rate_key,
        turnstile_success,turnstile_challenge_at,
        turnstile_hostname,turnstile_action
      ) VALUES (
        'e8900000-0000-4000-8000-000000000003','en','Missing ID fixture',
        'missing-id@example.test','Fixture company','Missing ID fixture',
        'Missing provider identifier fixture',now(),repeat('e',64),
        repeat('f',64),true,now(),'axora.management','contact'
      );
      INSERT INTO transactional_email_outbox(
        id,message_kind,contact_submission_id,locale,delivery_status,
        delivery_attempt_count,delivery_attempted_at,sent_at
      ) VALUES (
        'e8900000-0000-4000-8000-000000000004','CONTACT_NOTIFICATION',
        'e8900000-0000-4000-8000-000000000003','en','SENT',1,now(),now()
      );
    `);
    const ambiguous = await db.query<{ state: string }>(`
      SELECT correlation_state AS state
      FROM email_provider_delivery_lifecycle WHERE provider_event_id=$1
    `, [fixtures[0]!.id]);
    expect(ambiguous.rows).toEqual([
      { state: "AMBIGUOUS" },
      { state: "AMBIGUOUS" },
    ]);
    const missingIdentifier = await db.query<{ state: string }>(`
      SELECT correlation_state AS state
      FROM email_provider_delivery_lifecycle WHERE outbox_id=$1
    `, ["e8900000-0000-4000-8000-000000000004"]);
    expect(missingIdentifier.rows).toEqual([{ state: "NO_PROVIDER_MESSAGE_ID" }]);

    const unmatched: Fixture = {
      id: "e8300000-0000-4000-8000-000000000099",
      type: "MESSAGE_REJECTED",
      terminal: true,
      bounce: null,
      providerMessageId: "provider-lifecycle-unmatched",
    };
    await record(unmatched);
    const unmatchedState = await db.query<{
      outbox_id: string | null;
      correlation_state: string;
    }>(`
      SELECT outbox_id::text,correlation_state
      FROM email_provider_delivery_lifecycle WHERE provider_event_id=$1
    `, [unmatched.id]);
    expect(unmatchedState.rows[0]).toEqual({
      outbox_id: null,
      correlation_state: "UNMATCHED",
    });
  });

  it("is idempotent and rejects conflicting reuse of an event identifier", async () => {
    await expect(record(fixtures[0]!)).resolves.toMatchObject({
      rows: [{ recorded: false, suppressed: false }],
    });
    await expect(db.query(`
      SELECT * FROM axora_record_cloudflare_email_event(
        $1,$2,$3,$4,$5,$6,$7,1
      )
    `, [
      fixtures[0]!.id,
      fixtures[0]!.type,
      recipientFingerprint,
      messageFingerprint("different-provider-message"),
      null,
      true,
      occurredAt,
    ])).rejects.toThrow(/identifier conflict/i);
    await expect(db.query(`
      SELECT * FROM axora_record_cloudflare_email_event(
        $1,'MESSAGE_FAILED',$2,$3,NULL,true,$4,1
      )
    `, [
      fixtures[0]!.id,
      recipientFingerprint,
      messageFingerprint(fixtures[0]!.providerMessageId),
      occurredAt,
    ])).rejects.toThrow(/identifier conflict/i);
  });

  it("rejects invalid event shapes and keeps provider evidence append-only", async () => {
    await expect(db.query(`
      SELECT * FROM axora_record_cloudflare_email_event(
        'e8300000-0000-4000-8000-000000000090','MESSAGE_DEFERRED',
        $1,$2,NULL,true,$3,1
      )
    `, [recipientFingerprint, messageFingerprint("invalid-terminal"), occurredAt]))
      .rejects.toThrow(/lifecycle event is invalid/i);
    await expect(db.query(`
      SELECT * FROM axora_record_cloudflare_email_event(
        'e8300000-0000-4000-8000-000000000091','MESSAGE_DELIVERED',
        $1,$2,'HARD',true,$3,1
      )
    `, [recipientFingerprint, messageFingerprint("invalid-bounce"), occurredAt]))
      .rejects.toThrow(/lifecycle event is invalid/i);
    await expect(db.query(`
      UPDATE email_provider_events SET terminal=false WHERE provider_event_id=$1
    `, [fixtures[0]!.id])).rejects.toThrow(/append-only/i);
  });

  it("persists no plaintext message ID, address, subject or SMTP detail", async () => {
    const stored = await db.query<{ payload: string }>(`
      SELECT jsonb_agg(to_jsonb(event))::text AS payload
      FROM email_provider_events event
    `);
    expect(stored.rows[0]?.payload).not.toContain(recipient);
    for (const fixture of allFixtures) {
      expect(stored.rows[0]?.payload).not.toContain(fixture.providerMessageId);
    }
    expect(stored.rows[0]?.payload).not.toContain("subject");
    expect(stored.rows[0]?.payload).not.toContain("smtp");

    await db.exec("SET ROLE axora_app");
    await expect(db.query("SELECT * FROM email_provider_delivery_lifecycle"))
      .rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");
  });
});

describe("Cloudflare lifecycle migration upgrade compatibility", () => {
  it("preserves pre-030 events without inventing message correlation", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "028_email_provider_events_and_suppression.sql" });
      const legacyEvent = "e8600000-0000-4000-8000-000000000001";
      await db.query(`
        SELECT * FROM axora_record_cloudflare_email_event(
          $1,'MESSAGE_BOUNCED',$2,'SOFT',$3,1
        )
      `, [legacyEvent, recipientFingerprint, occurredAt]);
      for (const filename of [
        "029_delivery_driver_event_evidence.sql",
        "030_email_provider_lifecycle_events.sql",
      ]) {
        await db.exec(await readFile(
          new URL(`../database/migrations/${filename}`, import.meta.url),
          "utf8",
        ));
      }

      const upgraded = await db.query<{
        provider_message_fingerprint: string | null;
        terminal: boolean;
        correlation_state: string;
      }>(`
        SELECT event.provider_message_fingerprint,event.terminal,
          lifecycle.correlation_state
        FROM email_provider_events event
        JOIN email_provider_delivery_lifecycle lifecycle
          ON lifecycle.provider_event_id=event.provider_event_id
        WHERE event.provider_event_id=$1
      `, [legacyEvent]);
      expect(upgraded.rows[0]).toEqual({
        provider_message_fingerprint: null,
        terminal: true,
        correlation_state: "LEGACY_UNCORRELATED",
      });

      await expect(db.query(`
        SELECT * FROM axora_record_cloudflare_email_event(
          $1,'MESSAGE_BOUNCED',$2,$3,'SOFT',true,$4,1
        )
      `, [
        legacyEvent,
        recipientFingerprint,
        messageFingerprint("late-retry-provider-message"),
        occurredAt,
      ])).resolves.toMatchObject({ rows: [{ recorded: false, suppressed: false }] });
    } finally {
      await db.close();
    }
  }, 30_000);
});
