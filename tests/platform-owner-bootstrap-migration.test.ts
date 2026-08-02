import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PENDING_ACCOUNT_PASSWORD_HASH } from "@/lib/password-policy";
import { applyMigrations } from "./helpers/pglite";

const ownerUserId = "71000000-0000-4000-8000-000000000001";
const ownerInvitationId = "72000000-0000-4000-8000-000000000001";

describe("first platform owner setup migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "021_platform_owner_setup_invitation.sql" });
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("bootstraps an invited owner on an empty database with immutable operator evidence", async () => {
    await db.exec("BEGIN");
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,active,is_owner,
        company_id,branch_id,account_setup_completed_at,account_kind,account_status
      ) VALUES (
        $1,'first.owner@example.test','First Owner',$2,
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
        NULL,NULL,NULL,'PLATFORM','INVITED'
      )
    `, [ownerUserId, PENDING_ACCOUNT_PASSWORD_HASH]);
    await db.query(`
      INSERT INTO user_profiles(user_id,display_name,preferred_locale)
      VALUES ($1,'First Owner','en')
    `, [ownerUserId]);
    await db.query(`
      INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
      VALUES ($1,NULL,NULL)
    `, [ownerUserId]);
    await db.query(`
      INSERT INTO role_assignments(user_id,role_id,scope_type)
      SELECT $1,id,'PLATFORM' FROM roles WHERE role_key='PLATFORM_OWNER'
    `, [ownerUserId]);
    await db.query(`
      INSERT INTO onboarding_progress(user_id,profile_stage_status)
      VALUES ($1,'NOT_STARTED')
    `, [ownerUserId]);
    await db.query(`
      INSERT INTO account_setup_invitations(
        id,user_id,company_id,token_hash,expires_at,
        intended_role_id,intended_branch_id
      ) VALUES (
        $1,$2,NULL,$3,now()+interval '1 day',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),NULL
      )
    `, [
      ownerInvitationId,
      ownerUserId,
      "a".repeat(64),
    ]);
    await db.query(`
      INSERT INTO platform_owner_bootstrap_audits(
        invitation_id,user_id,operator_identity,reason
      ) VALUES ($1,$2,'test-operator@example.test','Approved empty-database bootstrap')
    `, [ownerInvitationId, ownerUserId]);
    await db.exec("COMMIT");

    const state = await db.query<{
      account_status: string;
      company_id: string | null;
      password_hash: string | null;
      role_key: string;
      audit_count: number;
    }>(`
      SELECT account.account_status,account.company_id::text,
        credential.password_hash,role.role_key,
        (SELECT count(*)::int FROM platform_owner_bootstrap_audits) AS audit_count
      FROM users account
      JOIN account_credentials credential ON credential.user_id=account.id
      JOIN role_assignments assignment ON assignment.user_id=account.id AND assignment.active
      JOIN roles role ON role.id=assignment.role_id
      WHERE account.id=$1
    `, [ownerUserId]);
    expect(state.rows[0]).toEqual({
      account_status: "INVITED",
      company_id: null,
      password_hash: null,
      role_key: "PLATFORM_OWNER",
      audit_count: 1,
    });

    await expect(db.query(
      "UPDATE platform_owner_bootstrap_audits SET reason='Rewritten evidence is forbidden'",
    )).rejects.toThrow(/immutable/i);
    await expect(db.query(
      "DELETE FROM platform_owner_bootstrap_audits",
    )).rejects.toThrow(/immutable/i);
  });

  it("rejects company-less invitations for non-owners", async () => {
    const company = await db.query<{ id: string }>(`
      INSERT INTO companies(company_code,name) VALUES ('COMPANY-TEST','Company Test')
      RETURNING id::text
    `);
    const user = await db.query<{ id: string }>(`
      INSERT INTO users(
        email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,account_kind,account_status
      ) VALUES (
        'company.user@example.test','Company User',$1,
        (SELECT id FROM roles WHERE role_key='REQUESTER'),$2,false,
        NULL,'COMPANY','INVITED'
      ) RETURNING id::text
    `, [PENDING_ACCOUNT_PASSWORD_HASH, company.rows[0].id]);
    await expect(db.query(`
      INSERT INTO account_setup_invitations(
        user_id,company_id,token_hash,expires_at,
        intended_role_id
      ) VALUES (
        $1,NULL,$2,now()+interval '1 day',
        (SELECT id FROM roles WHERE role_key='REQUESTER')
      )
    `, [user.rows[0].id, "b".repeat(64)]))
      .rejects.toThrow(/restricted to the first platform_owner/i);
  });

  it("keeps ordinary company invitations tenant-bound", async () => {
    const company = await db.query<{ id: string }>(
      "SELECT id::text FROM companies WHERE company_code='COMPANY-TEST'",
    );
    const user = await db.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email='company.user@example.test'",
    );
    await db.query(`
      INSERT INTO account_setup_invitations(
        user_id,company_id,token_hash,expires_at,
        intended_role_id
      ) VALUES (
        $1,$2,$3,now()+interval '1 day',
        (SELECT id FROM roles WHERE role_key='REQUESTER')
      )
    `, [
      user.rows[0].id,
      company.rows[0].id,
      "c".repeat(64),
    ]);
    const invitation = await db.query<{ company_id: string | null }>(`
      SELECT company_id::text FROM account_setup_invitations WHERE user_id=$1
    `, [user.rows[0].id]);
    expect(invitation.rows[0].company_id).toBe(company.rows[0].id);
  });

  it("allows the audited owner invitation to complete once without a company membership", async () => {
    await db.exec("BEGIN");
    await db.query(`
      UPDATE users
      SET password_hash='completed-password-hash',account_setup_completed_at=now(),
          account_status='ACTIVE',auth_version=auth_version+1
      WHERE id=$1
    `, [ownerUserId]);
    await db.query(`
      UPDATE account_credentials
      SET password_hash='completed-password-hash',password_algorithm='argon2id'
      WHERE user_id=$1
    `, [ownerUserId]);
    await db.query(`
      UPDATE account_setup_invitations
      SET consumed_at=now(),delivery_status='CANCELLED'
      WHERE id=$1
    `, [ownerInvitationId]);
    await db.exec("COMMIT");

    const result = await db.query<{ status: string; memberships: number; consumed: boolean }>(`
      SELECT account.account_status AS status,
        (SELECT count(*)::int FROM company_memberships WHERE user_id=account.id) AS memberships,
        invitation.consumed_at IS NOT NULL AS consumed
      FROM users account
      JOIN account_setup_invitations invitation ON invitation.user_id=account.id
      WHERE account.id=$1
    `, [ownerUserId]);
    expect(result.rows[0]).toEqual({ status: "ACTIVE", memberships: 0, consumed: true });
  });
});
