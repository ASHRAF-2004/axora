import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PENDING_ACCOUNT_PASSWORD_HASH } from "@/lib/password-policy";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/053_account_access_completion.sql",
  import.meta.url,
);
const targetId = "53000000-0000-4000-8000-000000000001";
const invitationId = "53000000-0000-4000-8000-000000000002";
const ownerFixtureId = "53000000-0000-4000-8000-000000000010";
const standbyOwnerFixtureId = "53000000-0000-4000-8000-000000000011";

async function fixture(withAppRole = false) {
  const db = new PGlite();
  await applyMigrations(db, { through: "052_company_lead_intake.sql" });
  await applyDemoSeed(db);
  if (withAppRole) await db.exec("CREATE ROLE axora_app NOLOGIN");
  await db.exec(await readFile(migrationUrl, "utf8"));
  const context = await db.query<{ companyId: string }>(`
    SELECT id::text AS "companyId" FROM companies WHERE active ORDER BY id LIMIT 1
  `);
  const row = context.rows[0];
  if (!row?.companyId) throw new Error("Account access fixture is incomplete");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      account_kind,account_status,account_setup_completed_at
    ) VALUES (
      $1,'owner-053@example.test','Account Access Owner','not-a-real-hash',
      (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
      'PLATFORM','ACTIVE',now()
    )
  `, [ownerFixtureId]);
  await db.query(`
    INSERT INTO role_assignments(
      user_id,role_id,scope_type,active,assigned_by
    ) SELECT $1,id,'PLATFORM',true,$1 FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ownerFixtureId]);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      account_kind,account_status,account_setup_completed_at
    ) VALUES (
      $1,'standby-owner-053@example.test','Standby Account Access Owner','not-a-real-hash',
      (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
      'PLATFORM','ACTIVE',now()
    )
  `, [standbyOwnerFixtureId]);
  await db.query(`
    INSERT INTO role_assignments(
      user_id,role_id,scope_type,active,assigned_by
    ) SELECT $1,id,'PLATFORM',true,$2 FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [standbyOwnerFixtureId, ownerFixtureId]);
  return { db, ownerId: ownerFixtureId, companyId: row.companyId };
}

async function insertInvitation(db: PGlite, ownerId: string, companyId: string) {
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      active,account_kind,account_status,account_setup_completed_at
    ) VALUES (
      $1,'activation-053@example.test','Activation Target',$2,
      (SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),$3,false,
      true,'COMPANY','INVITED',NULL
    )
  `, [targetId, PENDING_ACCOUNT_PASSWORD_HASH, companyId]);
  await db.query(`
    INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
    VALUES ($1,NULL,NULL)
  `, [targetId]);
  await db.query(`
    INSERT INTO company_memberships(user_id,company_id,status,is_primary)
    VALUES ($1,$2,'INVITED',true)
  `, [targetId, companyId]);
  await db.query(`
    INSERT INTO role_assignments(
      user_id,role_id,scope_type,company_id,active,assigned_by
    ) SELECT $1,id,'COMPANY',$2,true,$3 FROM roles WHERE role_key='COMPANY_ADMIN'
  `, [targetId, companyId, ownerId]);
  await db.query(`
    INSERT INTO account_setup_invitations(
      id,user_id,company_id,token_hash,expires_at,created_by,email_locale,
      intended_role_id,intended_scope_type
    ) SELECT $4,$1,$2,repeat('a',64),now()+interval '1 day',$3,'en',id,'COMPANY'
      FROM roles WHERE role_key='COMPANY_ADMIN';
  `, [targetId, companyId, ownerId, invitationId]);
}

describe("account access completion migration", () => {
  it("revalidates the inviter and records explicit activation consent", async () => {
    const { db, ownerId, companyId } = await fixture();
    try {
      await insertInvitation(db, ownerId, companyId);
      const authorized = await db.query<{ allowed: boolean }>(
        "SELECT axora_account_setup_inviter_can_activate($1,now()) AS allowed",
        [invitationId],
      );
      expect(authorized.rows[0]?.allowed).toBe(true);
      await db.query("UPDATE users SET active=false WHERE id=$1", [ownerId]);
      const stale = await db.query<{ allowed: boolean }>(
        "SELECT axora_account_setup_inviter_can_activate($1,now()) AS allowed",
        [invitationId],
      );
      expect(stale.rows[0]?.allowed).toBe(false);
      await db.query("UPDATE users SET active=true WHERE id=$1", [ownerId]);
      await db.query(`
        UPDATE users SET
          password_hash='not-a-real-activated-hash',
          account_status='ACTIVE',
          account_setup_completed_at=now()
        WHERE id=$1
      `, [targetId]);
      await expect(db.query(
        "UPDATE account_setup_invitations SET consumed_at=now() WHERE id=$1",
        [invitationId],
      )).rejects.toThrow("policy_evidence");
      await db.query(`
        UPDATE account_setup_invitations SET
          terms_policy_version='account-terms-2026-08-08',terms_accepted_at=now(),
          privacy_policy_version='account-privacy-2026-08-08',privacy_accepted_at=now(),
          consumed_at=now()
        WHERE id=$1
      `, [invitationId]);
      const evidence = await db.query<{ terms: string; privacy: string }>(`
        SELECT terms_policy_version AS terms,privacy_policy_version AS privacy
        FROM account_setup_invitations WHERE id=$1
      `, [invitationId]);
      expect(evidence.rows[0]).toEqual({
        terms: "account-terms-2026-08-08",
        privacy: "account-privacy-2026-08-08",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("allows one reset link and one tokenless password-change confirmation", async () => {
    const { db, ownerId } = await fixture();
    try {
      const resetId = "53000000-0000-4000-8000-000000000003";
      await db.query(`
        INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,locale)
        VALUES ($1,$2,repeat('b',64),now()+interval '30 minutes','ar')
      `, [resetId, ownerId]);
      await db.query(`
        INSERT INTO transactional_email_outbox(
          message_kind,password_reset_token_id,locale,
          token_ciphertext,token_nonce,token_authentication_tag
        ) VALUES ('PASSWORD_RESET',$1,'ar',repeat('A',58),repeat('B',16),repeat('C',22))
      `, [resetId]);
      await db.query(`
        INSERT INTO transactional_email_outbox(
          message_kind,password_reset_token_id,locale
        ) VALUES ('PASSWORD_CHANGED',$1,'ar')
      `, [resetId]);
      const kinds = await db.query<{ kind: string }>(`
        SELECT message_kind AS kind FROM transactional_email_outbox
        WHERE password_reset_token_id=$1 ORDER BY message_kind
      `, [resetId]);
      expect(kinds.rows.map((row) => row.kind)).toEqual(["PASSWORD_CHANGED", "PASSWORD_RESET"]);
      await expect(db.query(`
        INSERT INTO transactional_email_outbox(message_kind,password_reset_token_id,locale)
        VALUES ('PASSWORD_CHANGED',$1,'ar')
      `, [resetId])).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps the inviter helper private and grants only the application capability", async () => {
    const { db } = await fixture(true);
    try {
      const privileges = await db.query<{ app: boolean; public: boolean }>(`
        SELECT
          has_function_privilege('axora_app','axora_account_setup_inviter_can_activate(uuid,timestamptz)','EXECUTE') AS app,
          has_function_privilege('public','axora_account_setup_inviter_can_activate(uuid,timestamptz)','EXECUTE') AS public
      `);
      expect(privileges.rows[0]).toEqual({ app: true, public: false });
    } finally {
      await db.close();
    }
  }, 30_000);
});
