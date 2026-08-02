import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PENDING_ACCOUNT_PASSWORD_HASH } from "@/lib/password-policy";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const companyA = "10000000-0000-4000-8000-000000000001";
const companyB = "10000000-0000-4000-8000-000000000002";
const pendingUser = "a1000000-0000-4000-8000-000000000001";
const existingUser = "a1000000-0000-4000-8000-000000000002";
const migrationUrl = new URL(
  "../database/migrations/014_account_setup_invitations.sql",
  import.meta.url,
);

describe("account setup invitation migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "013_trusted_interactions.sql" });
    await applyDemoSeed(db);
    await db.query(
      `INSERT INTO users(
         id,email,display_name,password_hash,role_id,company_id,is_owner
       ) VALUES (
         $1,'existing.user@example.test','Existing User','existing-hash',
         (SELECT id FROM roles WHERE role_key='VIEWER'),$2,false
       )`,
      [existingUser, companyA],
    );
    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      `INSERT INTO users(
         id,email,display_name,password_hash,role_id,company_id,is_owner,
         account_setup_completed_at
       ) VALUES (
         $1,'pending.user@example.test','Pending User',$3,
         (SELECT id FROM roles WHERE role_key='VIEWER'),$2,false,NULL
       )`,
      [pendingUser, companyA, PENDING_ACCOUNT_PASSWORD_HASH],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("backfills existing credentials and keeps pending hashes rollback-compatible", async () => {
    const existing = await db.query<{
      completed: boolean;
      auth_version: number;
    }>(`
      SELECT account_setup_completed_at IS NOT NULL AS completed,auth_version
      FROM users WHERE id=$1
    `, [existingUser]);
    const pending = await db.query<{
      password_hash: string;
      account_setup_completed_at: string | null;
    }>(`
      SELECT password_hash,account_setup_completed_at::text
      FROM users WHERE id=$1
    `, [pendingUser]);
    const passwordColumn = await db.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
        AND column_name='password_hash'
    `);

    expect(existing.rows[0]).toEqual({ completed: true, auth_version: 1 });
    expect(pending.rows[0]).toEqual({
      password_hash: PENDING_ACCOUNT_PASSWORD_HASH,
      account_setup_completed_at: null,
    });
    expect(passwordColumn.rows[0].is_nullable).toBe("NO");

    await expect(db.query(
      `UPDATE users SET password_hash='partial-credential' WHERE id=$1`,
      [pendingUser],
    )).rejects.toThrow();
    await expect(db.query(
      "UPDATE users SET password_hash=NULL WHERE id=$1",
      [pendingUser],
    )).rejects.toThrow();
  });

  it("removes password verifiers from existing and future user audit records", async () => {
    await db.query(
      "UPDATE users SET last_login_at=now() WHERE id=$1",
      [existingUser],
    );
    const logs = await db.query<{
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
    }>(`
      SELECT old_values,new_values FROM audit_logs
      WHERE entity_type='users' AND record_id IN ($1,$2)
    `, [existingUser, pendingUser]);

    expect(logs.rows.length).toBeGreaterThan(0);
    for (const log of logs.rows) {
      expect(log.old_values ?? {}).not.toHaveProperty("password_hash");
      expect(log.new_values ?? {}).not.toHaveProperty("password_hash");
    }
  });

  it("binds invitations to the correct tenant and limits their lifetime", async () => {
    await expect(db.query(
      `INSERT INTO account_setup_invitations(
         user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,now()+interval '1 day')`,
      [pendingUser, companyB, "a".repeat(64)],
    )).rejects.toThrow();

    await expect(db.query(
      `INSERT INTO account_setup_invitations(
         user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,now()+interval '8 days')`,
      [pendingUser, companyA, "b".repeat(64)],
    )).rejects.toThrow();
  });

  it("allows one live token and makes replacement and consumption irreversible", async () => {
    const firstId = "a2000000-0000-4000-8000-000000000001";
    const secondId = "a2000000-0000-4000-8000-000000000002";
    await db.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,$4,now()+interval '1 day')`,
      [firstId, pendingUser, companyA, "c".repeat(64)],
    );
    await expect(db.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,$4,now()+interval '1 day')`,
      [secondId, pendingUser, companyA, "d".repeat(64)],
    )).rejects.toThrow();

    await db.query(
      "UPDATE account_setup_invitations SET revoked_at=now() WHERE id=$1",
      [firstId],
    );
    await db.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,$4,now()+interval '1 day')`,
      [secondId, pendingUser, companyA, "d".repeat(64)],
    );
    await db.query(
      "UPDATE account_setup_invitations SET consumed_at=now() WHERE id=$1",
      [secondId],
    );

    await expect(db.query(
      "UPDATE account_setup_invitations SET revoked_at=NULL WHERE id=$1",
      [firstId],
    )).rejects.toThrow(/cannot be changed/i);
    await expect(db.query(
      "UPDATE account_setup_invitations SET consumed_at=NULL WHERE id=$1",
      [secondId],
    )).rejects.toThrow(/cannot be changed/i);
    await expect(db.query(
      "UPDATE account_setup_invitations SET token_hash=$2 WHERE id=$1",
      [secondId, "e".repeat(64)],
    )).rejects.toThrow(/immutable/i);
  });

  it("never records token hashes or provider identifiers in audit history", async () => {
    const invitationId = "a2000000-0000-4000-8000-000000000003";
    await db.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,$4,now()+interval '1 day')`,
      [invitationId, pendingUser, companyA, "f".repeat(64)],
    );
    await db.query(
      `UPDATE account_setup_invitations
       SET delivery_status='SENDING',delivery_attempt_count=1,
           delivery_attempted_at=now()
       WHERE id=$1`,
      [invitationId],
    );
    await db.query(
      `UPDATE account_setup_invitations
       SET delivery_status='SENT',sent_at=now(),
           provider_message_id='provider-sensitive-correlation-id'
       WHERE id=$1`,
      [invitationId],
    );

    const audits = await db.query<{
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
    }>(`
      SELECT old_values,new_values
      FROM audit_logs
      WHERE entity_type='account_setup_invitations' AND record_id=$1
      ORDER BY id
    `, [invitationId]);

    expect(audits.rows.length).toBe(3);
    for (const row of audits.rows) {
      expect(row.old_values ?? {}).not.toHaveProperty("token_hash");
      expect(row.new_values ?? {}).not.toHaveProperty("token_hash");
      expect(row.old_values ?? {}).not.toHaveProperty("provider_message_id");
      expect(row.new_values ?? {}).not.toHaveProperty("provider_message_id");
    }
    await expect(db.query(
      `UPDATE account_setup_invitations
       SET provider_message_id='rewritten-provider-id'
       WHERE id=$1`,
      [invitationId],
    )).rejects.toThrow(/metadata is final/i);
    await db.query(
      "UPDATE account_setup_invitations SET revoked_at=now() WHERE id=$1",
      [invitationId],
    );
  });

  it("permits one synchronous attempt and makes its result final", async () => {
    const invitationId = "a2000000-0000-4000-8000-000000000004";
    await db.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at
       ) VALUES ($1,$2,$3,$4,now()+interval '1 day')`,
      [invitationId, pendingUser, companyA, "9".repeat(64)],
    );
    await db.query(
      `UPDATE account_setup_invitations
       SET delivery_status='SENDING',delivery_attempt_count=1,
           delivery_attempted_at=now()
       WHERE id=$1`,
      [invitationId],
    );
    await db.query(
      `UPDATE account_setup_invitations
       SET delivery_status='UNCERTAIN',last_delivery_error='delivery_uncertain'
       WHERE id=$1`,
      [invitationId],
    );

    const final = await db.query<{
      delivery_status: string;
      delivery_attempt_count: number;
    }>(`
      SELECT delivery_status,delivery_attempt_count
      FROM account_setup_invitations WHERE id=$1
    `, [invitationId]);
    expect(final.rows[0]).toEqual({
      delivery_status: "UNCERTAIN",
      delivery_attempt_count: 1,
    });
    await expect(db.query(
      `UPDATE account_setup_invitations
       SET delivery_status='SENT',sent_at=now(),provider_message_id='replay'
       WHERE id=$1`,
      [invitationId],
    )).rejects.toThrow(/metadata is final|status is final/i);
    await expect(db.query(
      `UPDATE account_setup_invitations SET delivery_attempt_count=2 WHERE id=$1`,
      [invitationId],
    )).rejects.toThrow();
  });
});
