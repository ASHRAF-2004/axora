import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/020_contact_and_security_tokens.sql",
  import.meta.url,
);
const contactId = "c1000000-0000-4000-8000-000000000001";
const contactOutboxId = "c2000000-0000-4000-8000-000000000001";
const leaseId = "c3000000-0000-4000-8000-000000000001";

describe("contact and security notification migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "019_supplier_delivery_receiving.sql" });
    await applyDemoSeed(db);
    await db.exec(await readFile(migrationUrl, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates bounded contact, rate-limit, token and durable outbox structures", async () => {
    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "public_request_rate_buckets",
      "public_contact_submissions",
      "transactional_email_outbox",
    ]));
  });

  it("persists a verified contact submission without copying its PII into audit JSON", async () => {
    await db.query(`
      INSERT INTO public_contact_submissions(
        id,locale,contact_name,contact_email,company_name,subject,message,
        privacy_accepted_at,network_rate_key,sender_rate_key,
        turnstile_success,turnstile_challenge_at,turnstile_hostname,
        turnstile_action
      ) VALUES (
        $1,'en','Private Contact','private@example.test','Example Company',
        'Procurement discussion','A sufficiently detailed private message.',
        now(),$2,$3,true,now(),'axora.management','contact'
      )
    `, [contactId, "a".repeat(64), "b".repeat(64)]);
    await db.query(`
      INSERT INTO transactional_email_outbox(
        id,message_kind,contact_submission_id,locale
      ) VALUES ($1,'CONTACT_NOTIFICATION',$2,'en')
    `, [contactOutboxId, contactId]);

    const audit = await db.query<{ old_values: unknown; new_values: unknown }>(`
      SELECT old_values,new_values FROM audit_logs
      WHERE entity_type='public_contact_submissions' AND record_id=$1
    `, [contactId]);
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("Private Contact");
    expect(serialized).not.toContain("sufficiently detailed");
    expect(serialized).not.toContain("network_rate_key");
  });

  it("enforces monotonic rate buckets and explicit delivery transitions", async () => {
    await db.query(`
      INSERT INTO public_request_rate_buckets(
        action_key,scope_kind,scope_hash,bucket_started_at
      ) VALUES ('CONTACT','NETWORK',$1,date_trunc('hour',now()))
    `, ["c".repeat(64)]);
    await db.query(`
      UPDATE public_request_rate_buckets SET request_count=2
      WHERE action_key='CONTACT' AND scope_kind='NETWORK' AND scope_hash=$1
    `, ["c".repeat(64)]);
    await expect(db.query(`
      UPDATE public_request_rate_buckets SET request_count=1
      WHERE action_key='CONTACT' AND scope_kind='NETWORK' AND scope_hash=$1
    `, ["c".repeat(64)])).rejects.toThrow(/monotonic/i);

    await db.query(`
      UPDATE transactional_email_outbox
      SET delivery_status='SENDING',delivery_attempt_count=1,
          delivery_attempted_at=now(),delivery_lease_id=$2,
          delivery_lease_expires_at=now()+interval '90 seconds'
      WHERE id=$1
    `, [contactOutboxId, leaseId]);
    await db.query(`
      UPDATE transactional_email_outbox
      SET delivery_status='SENT',delivery_lease_id=NULL,
          delivery_lease_expires_at=NULL,sent_at=now(),
          provider_message_id='provider-fixture'
      WHERE id=$1
    `, [contactOutboxId]);
    await expect(db.query(`
      UPDATE transactional_email_outbox SET delivery_status='PENDING'
      WHERE id=$1
    `, [contactOutboxId])).rejects.toThrow(/final/i);

    const outboxAudit = await db.query<{ old_values: unknown; new_values: unknown }>(`
      SELECT old_values,new_values FROM audit_logs
      WHERE entity_type='transactional_email_outbox' AND record_id=$1
    `, [contactOutboxId]);
    expect(JSON.stringify(outboxAudit.rows)).not.toContain("provider-fixture");
  });

  it("protects reset token identity and requires an explicit revocation reason", async () => {
    const userId = "c5000000-0000-4000-8000-000000000001";
    await db.query(`
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner)
      SELECT $1,'security-owner@example.test','Security Owner','fixture-hash',id,true
      FROM roles WHERE role_key='ADMIN'
    `, [userId]);
    const tokenId = "c4000000-0000-4000-8000-000000000001";
    await db.query(`
      INSERT INTO password_reset_tokens(
        id,user_id,token_hash,expires_at,request_network_hash,locale
      ) VALUES ($1,$2,$3,now()+interval '30 minutes',$4,'en')
    `, [tokenId, userId, "d".repeat(64), "e".repeat(64)]);
    await expect(db.query(`
      UPDATE password_reset_tokens SET revoked_at=now() WHERE id=$1
    `, [tokenId])).rejects.toThrow(/requires a reason/i);
    await expect(db.query(`
      UPDATE password_reset_tokens
      SET revoked_at=now(),revoked_reason='replaced' WHERE id=$1
    `, [tokenId])).resolves.not.toThrow();
    await expect(db.query(`
      UPDATE password_reset_tokens SET token_hash=$2 WHERE id=$1
    `, [tokenId, "f".repeat(64)])).rejects.toThrow(/immutable/i);
  });
});
