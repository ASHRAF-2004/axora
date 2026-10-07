import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const transport = vi.hoisted(() => ({
  transaction: undefined as undefined | ((context: { reason?: string; systemIdentity?: string }, work: (client: PoolClient) => Promise<unknown>) => Promise<unknown>),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: (context: { reason?: string; systemIdentity?: string }, work: (client: PoolClient) => Promise<unknown>) => transport.transaction!(context, work),
}));

import { recordPublicContactSubmission } from "@/lib/public-contact-persistence";
import { claimTransactionalEmailOutbox, completeTransactionalEmailOutbox } from "@/lib/transactional-email";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const grantsUrl = new URL("../database/admin/apply-app-grants.sql", import.meta.url);

describe("Contact email runtime with the deployed application grants", () => {
  let db: PGlite;
  let client: PoolClient;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    await applyMigrations(db);
    await db.exec("CREATE TABLE schema_migrations(filename text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
    const grants = await readFile(grantsUrl, "utf8");
    const executableGrants = grants.split("\n").filter((line) => (
      !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
    )).join("\n");
    // A fresh service/deployment grants replay must preserve worker capabilities.
    await db.exec(executableGrants);
    await db.exec(executableGrants);
    client = {
      query: async (sql: string, values: unknown[] = []) => {
        const result = await db.query(sql, values);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length };
      },
    } as unknown as PoolClient;
    transport.transaction = async (context, work) => {
      await db.exec("BEGIN; SET LOCAL ROLE axora_app");
      try {
        await db.query("SELECT set_config('axora.change_reason',$1,true),set_config('axora.correlation_id',$2,true),set_config('axora.system_identity',$3,true)", [context.reason ?? "Controlled Contact runtime regression", randomUUID(), context.systemIdentity ?? ""]);
        const result = await work(client);
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    };
    process.env.AXORA_CONTACT_NOTIFICATION_TO = "monitored-inbox@example.test";
    process.env.APP_BASE_URL = "https://axora.management";
  }, 30_000);

  afterAll(async () => { await db.close(); });

  async function enquiry(label: string) {
    const at = new Date();
    return transport.transaction!({ reason: "Controlled Contact runtime regression" }, (activeClient) => recordPublicContactSubmission(activeClient, {
      idempotencyKey: digest(label), locale: "en", fullName: "Recovery Fixture",
      email: "visitor@example.test", phone: "+60123456789",
      message: "Synthetic Contact enquiry for an isolated recovery regression.",
      privacyPolicyVersion: "privacy-policy-2026-08-28", sourcePage: "/en/contact",
      sourceMetadata: {}, networkRateKey: digest("network"), senderRateKey: digest(label),
      turnstileChallengeAt: at.toISOString(), turnstileHostname: "axora.management",
    }, "en", at)) as Promise<{ created: boolean; submissionId: string }>;
  }

  it("claims and completes one durable enquiry without a visitor acknowledgement", async () => {
    const submission = await enquiry("contact-ordinary");
    const replay = await enquiry("contact-ordinary");
    expect(replay).toEqual({ ...submission, created: false });
    const job = await claimTransactionalEmailOutbox();
    expect(job).toMatchObject({ messageKind: "CONTACT_NOTIFICATION", recipientEmail: "monitored-inbox@example.test" });
    expect(await completeTransactionalEmailOutbox(job!.deliveryId, job!.leaseId, "sent", {
      providerMessageId: "isolated-provider-ordinary", providerName: "test", providerAgent: "axora-platform",
    })).toBe(true);
    expect(await claimTransactionalEmailOutbox()).toBeNull();
    const record = await db.query<{ notification_status: string; acknowledgement_status: string; attempts: number }>(`SELECT submission.notification_status,submission.acknowledgement_status,
      (SELECT count(*)::integer FROM email_delivery_attempts attempt WHERE attempt.delivery_id=outbox.id) AS attempts
      FROM public_contact_submissions submission JOIN transactional_email_outbox outbox ON outbox.contact_submission_id=submission.id
      WHERE submission.id=$1`, [submission.submissionId]);
    expect(record.rows[0]).toEqual({ notification_status: "NOTIFIED", acknowledgement_status: "CANCELLED", attempts: 1 });
  });

  it("keeps an externally accepted but unacknowledged job uncertain after restart", async () => {
    const submission = await enquiry("contact-interrupted-ack");
    const job = await claimTransactionalEmailOutbox();
    expect(job?.messageKind).toBe("CONTACT_NOTIFICATION");
    // Simulate process loss after provider acceptance and before local completion.
    // The persisted lease survives; a new worker must never invent another send.
    await db.query(`UPDATE transactional_email_outbox SET delivery_attempted_at=now()-interval '100 seconds',
      delivery_lease_expires_at=now()-interval '1 second' WHERE id=$1`, [job!.deliveryId]);
    expect(await claimTransactionalEmailOutbox()).toBeNull();
    expect(await completeTransactionalEmailOutbox(job!.deliveryId, job!.leaseId, "sent", {
      providerMessageId: "isolated-provider-interrupted", providerName: "test", providerAgent: "axora-platform",
    })).toBe(false);
    const record = await db.query<{ delivery_status: string; delivery_attempt_count: number; last_delivery_error: string; notification_status: string }>(`SELECT outbox.delivery_status,outbox.delivery_attempt_count,outbox.last_delivery_error,submission.notification_status
      FROM transactional_email_outbox outbox JOIN public_contact_submissions submission ON submission.id=outbox.contact_submission_id WHERE submission.id=$1`, [submission.submissionId]);
    expect(record.rows[0]).toEqual({ delivery_status: "UNCERTAIN", delivery_attempt_count: 1, last_delivery_error: "lease_expired", notification_status: "NOTIFICATION_UNCERTAIN" });
    expect(await claimTransactionalEmailOutbox()).toBeNull();
  });

  it("persists retry backoff and lets a fresh worker complete the same delivery", async () => {
    await enquiry("contact-retry");
    const first = await claimTransactionalEmailOutbox();
    expect(await completeTransactionalEmailOutbox(first!.deliveryId, first!.leaseId, "retry", {
      providerName: "test", providerAgent: "axora-platform", httpStatus: 503, errorCode: "provider_unavailable",
    })).toBe(true);
    expect(await claimTransactionalEmailOutbox()).toBeNull();
    await db.query("UPDATE transactional_email_outbox SET delivery_available_at=now() WHERE id=$1", [first!.deliveryId]);
    const second = await claimTransactionalEmailOutbox();
    expect(second?.deliveryId).toBe(first?.deliveryId);
    expect(second?.leaseId).not.toBe(first?.leaseId);
    expect(await completeTransactionalEmailOutbox(second!.deliveryId, second!.leaseId, "sent", {
      providerName: "test", providerAgent: "axora-platform", providerMessageId: "isolated-provider-retry",
    })).toBe(true);
    const attempts = await db.query<{ outcome: string }>("SELECT outcome FROM email_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt_number", [first!.deliveryId]);
    expect(attempts.rows).toEqual([{ outcome: "retry" }, { outcome: "sent" }]);
  });

  it("keeps raw invoice helpers private and requires a non-user worker context plus a live lease", async () => {
    const privileges = await db.query<{ proname: string; app: boolean; public: boolean }>(`SELECT proname,
      has_function_privilege('axora_app',oid,'EXECUTE') AS app,
      has_function_privilege('public',oid,'EXECUTE') AS public FROM pg_proc
      WHERE proname IN ('axora_invoice_email_payload','axora_invoice_email_ready','axora_invoice_email_recipient_suppressed',
        'axora_transactional_invoice_email_state','axora_claimed_invoice_email_payload') ORDER BY proname`);
    expect(privileges.rows).toEqual([
      { proname: "axora_claimed_invoice_email_payload", app: true, public: false },
      { proname: "axora_invoice_email_payload", app: false, public: false },
      { proname: "axora_invoice_email_ready", app: false, public: false },
      { proname: "axora_invoice_email_recipient_suppressed", app: false, public: false },
      { proname: "axora_transactional_invoice_email_state", app: true, public: false },
    ]);
    await expect(transport.transaction!({}, async (activeClient) => activeClient.query(
      "SELECT axora_transactional_invoice_email_state($1)", [randomUUID()],
    ))).rejects.toMatchObject({ code: "42501" });
    await expect(transport.transaction!({ systemIdentity: "transactional-email-worker" }, async (activeClient) => {
      await activeClient.query("SELECT set_config('axora.user_id',$1,true)", [randomUUID()]);
      return activeClient.query("SELECT axora_claimed_invoice_email_payload($1,$2)", [randomUUID(), randomUUID()]);
    })).rejects.toMatchObject({ code: "42501" });
    const result = await transport.transaction!({ systemIdentity: "transactional-email-worker" }, async (activeClient) => activeClient.query(
      "SELECT axora_transactional_invoice_email_state($1) AS state,axora_claimed_invoice_email_payload($1,$2) AS payload",
      [randomUUID(), randomUUID()],
    )) as { rows: Array<{ state: { ready: boolean; suppressed: boolean }; payload: unknown }> };
    expect(result.rows).toEqual([{ state: { ready: false, suppressed: false }, payload: null }]);
  });
});
