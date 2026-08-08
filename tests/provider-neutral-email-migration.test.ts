import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe("P0-09 provider-neutral email migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const applied = await applyMigrations(db);
    expect(applied.at(-1)).toBe("059_immutable_accountability_and_scope_closure.sql");
  }, 30_000);

  afterAll(async () => db.close());

  it("installs six retry intervals, priority claims, and atomic approval fan-out", async () => {
    const delays = await db.query<{ attempt: number; seconds: number }>(`
      SELECT attempt,extract(epoch FROM axora_email_retry_delay(attempt))::int AS seconds
      FROM generate_series(1,6) attempt ORDER BY attempt
    `);
    expect(delays.rows.map((row) => row.seconds)).toEqual([60, 300, 900, 3600, 14400, 43200]);
    const contracts = await db.query<{
      workflowClaim: string | null;
      zeptoRecorder: string | null;
      approvalTrigger: number;
      attemptConstraint: string;
    }>(`
      SELECT
        to_regprocedure('public.axora_claim_workflow_email_v2(integer,integer)')::text AS "workflowClaim",
        to_regprocedure('public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)')::text AS "zeptoRecorder",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname='dispatch_request_approval_notification' AND NOT tgisinternal)
          AS "approvalTrigger",
        (SELECT pg_get_constraintdef(oid) FROM pg_constraint
          WHERE conname='workflow_email_outbox_delivery_attempt_count_check')
          AS "attemptConstraint"
    `);
    expect(contracts.rows[0]).toMatchObject({
      workflowClaim: "axora_claim_workflow_email_v2(integer,integer)",
      zeptoRecorder:
        "axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamp with time zone,integer)",
      approvalTrigger: 1,
    });
    expect(contracts.rows[0].attemptConstraint).toContain("7");
  });

  it("records ZeptoMail lifecycle events idempotently and suppresses only hard bounce", async () => {
    const occurredAt = "2026-08-08T12:00:00.000Z";
    const values = [
      "40000000-0000-4000-8000-000000000901",
      "MESSAGE_BOUNCED",
      "a".repeat(64),
      "b".repeat(64),
      "HARD",
      true,
      occurredAt,
      1,
    ];
    const first = await db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT * FROM axora_record_zeptomail_email_event($1,$2,$3,$4,$5,$6,$7,$8)
    `, values);
    expect(first.rows[0]).toEqual({ recorded: true, suppressed: true });
    const duplicate = await db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT * FROM axora_record_zeptomail_email_event($1,$2,$3,$4,$5,$6,$7,$8)
    `, values);
    expect(duplicate.rows[0]).toEqual({ recorded: false, suppressed: true });

    const soft = await db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT * FROM axora_record_zeptomail_email_event(
        '40000000-0000-4000-8000-000000000902','MESSAGE_BOUNCED',$1,$2,
        'SOFT',true,'2026-08-08T11:59:00.000Z',1
      )
    `, ["c".repeat(64), "d".repeat(64)]);
    expect(soft.rows[0]).toEqual({ recorded: true, suppressed: false });
    const suppression = await db.query<{ count: number; hard: number }>(`
      SELECT count(*)::int AS count,sum(hard_bounce_count)::int AS hard
      FROM email_recipient_suppressions
    `);
    expect(suppression.rows[0]).toEqual({ count: 1, hard: 1 });
  });

  it("keeps privacy-minimized attempt evidence append-only and counts recipients", async () => {
    await db.query(`
      INSERT INTO email_delivery_attempts(
        id,delivery_kind,delivery_id,event_type,template_key,template_version,
        provider_name,provider_agent,attempt_number,outcome,correlation_id
      ) VALUES ($1,'WORKFLOW',$2,'request.approved','request-approved',1,
        'zeptomail','axora-procurement',1,'sent',$3)
    `, [
      "40000000-0000-4000-8000-000000000911",
      "40000000-0000-4000-8000-000000000912",
      "40000000-0000-4000-8000-000000000913",
    ]);
    await expect(db.query(`
      UPDATE email_delivery_attempts SET outcome='failed'
      WHERE id='40000000-0000-4000-8000-000000000911'
    `)).rejects.toThrow(/append-only/i);
    const usage = await db.query<{ units: bigint; attempts: bigint }>(`
      SELECT submitted_recipient_units AS units,submission_attempts AS attempts
      FROM email_delivery_usage_daily WHERE template_key='request-approved'
    `);
    expect(Number(usage.rows[0].units)).toBe(1);
    expect(Number(usage.rows[0].attempts)).toBe(1);
  });
});
