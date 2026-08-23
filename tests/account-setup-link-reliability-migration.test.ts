import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const PENDING_HASH = "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";

const ids = {
  owner: "b1000000-0000-4000-8000-000000000001",
  ownerAssignment: "b1000000-0000-4000-8000-000000000002",
  company: "b1000000-0000-4000-8000-000000000003",
  administrator: "b1000000-0000-4000-8000-000000000004",
  administratorAssignment: "b1000000-0000-4000-8000-000000000005",
  invitation: "b1000000-0000-4000-8000-000000000006",
} as const;

async function fixture(
  lifecycle: "ONBOARDING" | "PORTAL_DRAFT" | "COMPANY_REVIEW",
) {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{ owner: string; administrator: string }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN') AS administrator
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.administrator) throw new Error("Role fixture unavailable");

  await db.query(`
    INSERT INTO companies(
      id,company_code,name,active,lifecycle_status,portal_access_enabled,
      verification_status
    ) VALUES ($1,'SETUP-RELIABILITY','Setup Reliability Company',false,$2,false,'DRAFT')
  `, [ids.company, lifecycle]);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,active,is_owner,
      company_id,account_setup_completed_at,auth_version,account_kind,account_status
    ) VALUES (
      $1,'owner-setup-reliability@example.test','Platform Owner',
      'not-a-real-hash',$3,true,true,NULL,now(),1,'PLATFORM','ACTIVE'
    ),(
      $2,'administrator-setup-reliability@example.test','Company Administrator',
      $5,$4,true,false,$6,NULL,1,'COMPANY','INVITED'
    )
  `, [
    ids.owner,ids.administrator,role.owner,role.administrator,PENDING_HASH,ids.company,
  ]);
  await db.query(`
    INSERT INTO account_credentials(
      user_id,password_hash,password_algorithm,password_changed_at,credential_version
    ) VALUES ($1,'not-a-real-hash','bcrypt',now(),1),($2,NULL,NULL,NULL,1)
  `, [ids.owner, ids.administrator]);
  await db.query(`
    INSERT INTO user_profiles(user_id,display_name,preferred_locale)
    VALUES
      ($1,'Platform Owner','en'),
      ($2,'Company Administrator','en')
  `, [ids.owner, ids.administrator]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,created_by
    ) VALUES ($1,$2,'INVITED',true,$3)
  `, [ids.administrator, ids.company, ids.owner]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$3,$5,'PLATFORM',NULL,true,$3,now()),
      ($2,$4,$6,'COMPANY',$7,true,$3,now())
  `, [
    ids.ownerAssignment,
    ids.administratorAssignment,
    ids.owner,
    ids.administrator,
    role.owner,
    role.administrator,
    ids.company,
  ]);
  await db.query(`
    INSERT INTO account_setup_invitations(
      id,user_id,company_id,token_hash,expires_at,created_by,email_locale,
      intended_role_id,intended_scope_type
    ) VALUES ($1,$2,$3,$4,now()+interval '1 day',$5,'en',$6,'COMPANY')
  `, [
    ids.invitation,
    ids.administrator,
    ids.company,
    "a".repeat(64),
    ids.owner,
    role.administrator,
  ]);
  await db.query(`
    UPDATE account_setup_invitations
    SET delivery_status='SENDING',delivery_attempt_count=1,
      delivery_attempted_at=now()
    WHERE id=$1
  `, [ids.invitation]);
  await db.query(`
    UPDATE account_setup_invitations
    SET delivery_status='SENT',sent_at=now(),provider_message_id='provider-fixture',
      accepted_provider_name='resend',recipient_units=1
    WHERE id=$1
  `, [ids.invitation]);
  return db;
}

describe("account setup link reliability migration", () => {
  it.each(["ONBOARDING", "PORTAL_DRAFT", "COMPANY_REVIEW"] as const)(
    "accepts and activates the exact first Company Administrator from %s",
    async (lifecycle) => {
      const db = await fixture(lifecycle);
      try {
        const eligible = await db.query<{ eligible: boolean }>(`
          SELECT axora_account_setup_invitation_is_eligible($1,now()) AS eligible
        `, [ids.invitation]);
        expect(eligible.rows[0]?.eligible).toBe(true);
        const repeatedOpen = await db.query<{
          eligible: boolean;
          consumed: boolean;
        }>(`
          SELECT axora_account_setup_invitation_is_eligible(id,now()) AS eligible,
            consumed_at IS NOT NULL AS consumed
          FROM account_setup_invitations WHERE id=$1
        `, [ids.invitation]);
        expect(repeatedOpen.rows[0]).toEqual({ eligible: true, consumed: false });

        await db.query(`
          INSERT INTO user_permission_overrides(
            user_id,permission_id,effect,scope_type,company_id,starts_at,
            active,reason,changed_by
          ) SELECT $1,id,'GRANT','COMPANY',$2,now(),true,
            'Customized first administrator fixture',$3
          FROM permissions
          WHERE permission_code IN ('request.create','request.edit','request.cancel')
        `, [ids.administrator, ids.company, ids.owner]);
        await db.query(`
          UPDATE users
          SET password_hash='argon2id-test-hash',account_setup_completed_at=now(),
            account_status='ACTIVE',auth_version=auth_version+1
          WHERE id=$1
        `, [ids.administrator]);
        await db.query(`
          UPDATE account_credentials
          SET password_hash='argon2id-test-hash',password_algorithm='argon2id',
            password_changed_at=now(),credential_version=2
          WHERE user_id=$1
        `, [ids.administrator]);
        await db.query(`
          UPDATE company_memberships
          SET status='ACTIVE',joined_at=now()
          WHERE user_id=$1 AND company_id=$2
        `, [ids.administrator, ids.company]);
        await db.query(`
          UPDATE account_setup_invitations
          SET consumed_at=now(),
            terms_policy_version='account-terms-2026-08-08',terms_accepted_at=now(),
            privacy_policy_version='account-privacy-2026-08-08',privacy_accepted_at=now()
          WHERE id=$1
        `, [ids.invitation]);
        const completed = await db.query<{ completed: boolean }>(`
          SELECT axora_complete_company_administrator_setup($1,now()) AS completed
        `, [ids.invitation]);
        expect(completed.rows[0]?.completed).toBe(true);

        const state = await db.query<{
          lifecycle: string;
          invitationItem: string;
          activationItem: string;
          permissionOverrides: number;
          transitions: number;
        }>(`
          SELECT company.lifecycle_status AS lifecycle,
            (SELECT status FROM company_onboarding_items
              WHERE company_id=company.id AND item_code='ADMIN_INVITATION')
              AS "invitationItem",
            (SELECT status FROM company_onboarding_items
              WHERE company_id=company.id AND item_code='ADMIN_ACTIVATION')
              AS "activationItem",
            (SELECT count(*)::int FROM user_permission_overrides
              WHERE user_id=$2 AND active) AS "permissionOverrides",
            (SELECT count(*)::int FROM company_status_history
              WHERE company_id=company.id
                AND to_status IN (
                  'COMPANY_ADMINISTRATOR_INVITED',
                  'COMPANY_ADMINISTRATOR_ACTIVATED'
                )) AS transitions
          FROM companies company WHERE company.id=$1
        `, [ids.company, ids.administrator]);
        expect(state.rows[0]).toEqual({
          lifecycle: "COMPANY_ADMINISTRATOR_ACTIVATED",
          invitationItem: "PASSED",
          activationItem: "PASSED",
          permissionOverrides: 3,
          transitions: 2,
        });

        await expect(db.query(`
          SELECT axora_complete_company_administrator_setup($1,now())
        `, [ids.invitation])).resolves.not.toThrow();
        const replay = await db.query<{ transitions: number }>(`
          SELECT count(*)::int AS transitions
          FROM company_status_history
          WHERE company_id=$1
            AND to_status IN (
              'COMPANY_ADMINISTRATOR_INVITED',
              'COMPANY_ADMINISTRATOR_ACTIVATED'
            )
        `, [ids.company]);
        expect(replay.rows[0]?.transitions).toBe(2);
      } finally {
        await db.close();
      }
    },
    30_000,
  );

  it("keeps failed delivery ineligible and makes first-administrator resend recoverable", async () => {
    const db = await fixture("ONBOARDING");
    try {
      await db.query(`
        UPDATE account_setup_invitations
        SET revoked_at=now()
        WHERE id=$1
      `, [ids.invitation]);
      const eligible = await db.query<{ eligible: boolean }>(`
        SELECT axora_account_setup_invitation_is_eligible($1,now()) AS eligible
      `, [ids.invitation]);
      expect(eligible.rows[0]?.eligible).toBe(false);

      const resend = await db.query<{ snapshot: Record<string, unknown> | null }>(`
        SELECT axora_account_setup_resend_target(
          $1,$2,1,$3,now()
        ) - 'recipientEmail' AS snapshot
      `, [ids.owner, ids.ownerAssignment, ids.administrator]);
      expect(resend.rows[0]?.snapshot).toMatchObject({
        userId: ids.administrator,
        role: "COMPANY_ADMIN",
        scopeType: "COMPANY",
        companyId: ids.company,
        organizationActive: true,
        membershipReady: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("does not broaden the onboarding exception across competing administrators", async () => {
    const db = await fixture("ONBOARDING");
    const competingUser = "b1000000-0000-4000-8000-000000000007";
    const competingAssignment = "b1000000-0000-4000-8000-000000000008";
    try {
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,active,is_owner,
          company_id,account_setup_completed_at,auth_version,account_kind,
          account_status
        ) SELECT $1,'competing-administrator@example.test','Competing Administrator',
          $2,role.id,true,false,$3,NULL,1,'COMPANY','INVITED'
        FROM roles role WHERE role.role_key='COMPANY_ADMIN'
      `, [competingUser, PENDING_HASH, ids.company]);
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,created_by
        ) VALUES ($1,$2,'INVITED',true,$3)
      `, [competingUser, ids.company, ids.owner]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
        ) SELECT $1,$2,role.id,'COMPANY',$3,true,$4,now()
        FROM roles role WHERE role.role_key='COMPANY_ADMIN'
      `, [competingAssignment, competingUser, ids.company, ids.owner]);

      const eligibility = await db.query<{ eligible: boolean }>(`
        SELECT axora_account_setup_invitation_is_eligible($1,now()) AS eligible
      `, [ids.invitation]);
      expect(eligibility.rows[0]?.eligible).toBe(false);
    } finally {
      await db.close();
    }
  }, 30_000);
});
