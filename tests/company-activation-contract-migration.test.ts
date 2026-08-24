import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const PENDING_HASH = "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";

const ids = {
  company: "a1200000-0000-4000-8000-000000000001",
  otherCompany: "a1200000-0000-4000-8000-000000000002",
  owner: "a1200000-0000-4000-8000-000000000003",
  ownerAssignment: "a1200000-0000-4000-8000-000000000004",
  administrator: "a1200000-0000-4000-8000-000000000005",
  administratorAssignment: "a1200000-0000-4000-8000-000000000006",
  invitation: "a1200000-0000-4000-8000-000000000007",
} as const;

type CommandResult = {
  status: string;
  blockedReasons?: string[];
  mutation?: {
    company?: {
      status: string;
      active: boolean;
      portalAccessEnabled: boolean;
      isPubliclyListed: boolean;
    };
  };
};

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await db.query(`
    INSERT INTO companies(
      id,company_code,name,legal_name,main_contact_name,industry_code,
      default_locale,timezone,active,lifecycle_status,lifecycle_version,
      portal_access_enabled,verification_status,is_publicly_listed
    ) VALUES
      ($1,'ACT-112','Activation Contract','Activation Contract Sdn Bhd',
        'Activation owner','OTHER','en','Asia/Kuala_Lumpur',false,
        'COMPANY_REVIEW',1,false,'DRAFT',false),
      ($2,'OTHER-112','Other Company','Other Company Sdn Bhd',
        'Other owner','OTHER','en','Asia/Kuala_Lumpur',false,
        'COMPANY_ADMINISTRATOR_ACTIVATED',3,false,'VERIFIED',false)
  `, [ids.company, ids.otherCompany]);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      company_id,account_setup_completed_at,auth_version,account_kind,account_status
    ) VALUES
      ($1,'owner-activation-112@example.test','Activation Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
        NULL,now(),1,'PLATFORM','ACTIVE'),
      ($2,'administrator-activation-112@example.test','Activation Administrator',
        $4,(SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),
        false,true,$3,NULL,1,'COMPANY','INVITED')
  `, [ids.owner, ids.administrator, ids.company, PENDING_HASH]);
  await db.query(`
    INSERT INTO account_credentials(
      user_id,password_hash,password_algorithm,password_changed_at,credential_version
    ) VALUES
      ($1,'not-a-real-hash','bcrypt',now(),1),
      ($2,NULL,NULL,NULL,1)
  `, [ids.owner, ids.administrator]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) VALUES ($1,$2,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
      'PLATFORM',NULL,true,$2,now())
  `, [ids.ownerAssignment, ids.owner]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at,created_by
    ) VALUES ($1,$2,'INVITED',true,NULL,$3)
  `, [ids.administrator, ids.company, ids.owner]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) VALUES ($1,$2,(SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),
      'COMPANY',$3,true,$4,now())
  `, [
    ids.administratorAssignment,
    ids.administrator,
    ids.company,
    ids.owner,
  ]);
  await db.query(`
    INSERT INTO account_setup_invitations(
      id,user_id,company_id,token_hash,expires_at,consumed_at,email_locale,
      delivery_status,delivery_attempt_count,delivery_attempted_at,sent_at,
      provider_message_id,created_by,created_at,intended_role_id,
      intended_scope_type,accepted_provider_name,recipient_units
    ) VALUES (
      $1,$2,$3,$4,now()+interval '1 day',NULL,'en',
      'PENDING',0,NULL,NULL,
      NULL,$5,now(),
      (SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),'COMPANY',NULL,1
    )
  `, [ids.invitation, ids.administrator, ids.company, "a".repeat(64), ids.owner]);
  await db.query(`
    UPDATE account_setup_invitations
    SET delivery_status='SENDING',delivery_attempt_count=1,
      delivery_attempted_at=now()
    WHERE id=$1
  `, [ids.invitation]);
  await db.query(`
    UPDATE account_setup_invitations
    SET delivery_status='SENT',sent_at=now(),
      provider_message_id='activation-contract-fixture',
      accepted_provider_name='test'
    WHERE id=$1
  `, [ids.invitation]);
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
  await db.query(
    "SELECT axora_complete_company_administrator_setup($1,now())",
    [ids.invitation],
  );
  return db;
}

async function activate(db: PGlite, options: {
  companyId?: string;
  authVersion?: number;
  expectedVersion?: number;
} = {}) {
  const result = await db.query<{ snapshot: CommandResult }>(`
    SELECT axora_activate_company($1,$2,$3,$4,$5,$6,now()) AS snapshot
  `, [
    ids.owner,
    ids.ownerAssignment,
    options.authVersion ?? 1,
    options.companyId ?? ids.company,
    options.expectedVersion ?? 3,
    "COMPANY_ACTIVATED",
  ]);
  return result.rows[0]?.snapshot;
}

async function approveVerification(db: PGlite, options: {
  actorId?: string;
  assignmentId?: string;
  authVersion?: number;
  companyId?: string;
  expectedVersion?: number;
  decision?: string;
  reason?: string;
} = {}) {
  const result = await db.query<{ snapshot: CommandResult }>(`
    SELECT axora_review_company_verification(
      $1,$2,$3,$4,$5,$6,$7,now()
    ) AS snapshot
  `, [
    options.actorId ?? ids.owner,
    options.assignmentId ?? ids.ownerAssignment,
    options.authVersion ?? 1,
    options.companyId ?? ids.company,
    options.expectedVersion ?? 1,
    options.decision ?? "APPROVE",
    options.reason ?? "COMPANY_VERIFICATION_APPROVED",
  ]);
  return result.rows[0]?.snapshot;
}

describe("company activation contract reconciliation migration", () => {
  it.each(["DRAFT", "PENDING_VERIFICATION"])(
    "returns a controlled verification blocker for %s without mutation",
    async (verificationStatus) => {
      const db = await fixture();
      try {
        await db.query(
          "UPDATE companies SET verification_status=$2 WHERE id=$1",
          [ids.company, verificationStatus],
        );
        const before = await db.query<{ history: number; notifications: number }>(`
          SELECT
            (SELECT count(*)::int FROM company_status_history WHERE company_id=$1) AS history,
            (SELECT count(*)::int FROM in_app_notifications WHERE company_id=$1) AS notifications
        `, [ids.company]);
        const result = await activate(db);
        expect(result).toEqual({
          status: "BLOCKED",
          blockedReasons: ["COMPANY_VERIFICATION_REQUIRED"],
        });
        const after = await db.query<{
          active: boolean;
          portal: boolean;
          lifecycle: string;
          history: number;
          notifications: number;
        }>(`
          SELECT company.active,company.portal_access_enabled AS portal,
            company.lifecycle_status AS lifecycle,
            (SELECT count(*)::int FROM company_status_history WHERE company_id=company.id) AS history,
            (SELECT count(*)::int FROM in_app_notifications WHERE company_id=company.id) AS notifications
          FROM companies company WHERE company.id=$1
        `, [ids.company]);
        expect(after.rows[0]).toEqual({
          active: false,
          portal: false,
          lifecycle: "COMPANY_ADMINISTRATOR_ACTIVATED",
          history: before.rows[0]?.history,
          notifications: before.rows[0]?.notifications,
        });
      } finally {
        await db.close();
      }
    },
    30_000,
  );

  it("approves reviewed evidence, activates once, and keeps publication separate", async () => {
    const db = await fixture();
    try {
      expect((await approveVerification(db)).status).toBe("VERIFIED");
      const activated = await activate(db);
      expect(activated).toMatchObject({
        status: "ACTIVATED",
        mutation: {
          company: {
            status: "ACTIVE",
            active: true,
            portalAccessEnabled: true,
            isPubliclyListed: false,
          },
        },
      });
      expect((await activate(db, { expectedVersion: 4 }))).toEqual({
        status: "ALREADY_ACTIVE",
      });
      const state = await db.query<{
        verification: string;
        lifecycle: string;
        version: number;
        history: number;
        verificationHistory: number;
        publicRows: number;
      }>(`
        SELECT company.verification_status AS verification,
          company.lifecycle_status AS lifecycle,
          company.lifecycle_version::int AS version,
          (SELECT count(*)::int FROM company_status_history history
            WHERE history.company_id=company.id AND history.to_status='ACTIVE') AS history,
          (SELECT count(*)::int FROM company_verification_history history
            WHERE history.company_id=company.id AND history.to_status='VERIFIED'
              AND history.reason='COMPANY_VERIFICATION_APPROVED') AS "verificationHistory",
          (SELECT count(*)::int FROM axora_public_company_listing_rows() listing
            WHERE listing.company_id=company.id) AS "publicRows"
        FROM companies company WHERE company.id=$1
      `, [ids.company]);
      expect(state.rows[0]).toEqual({
        verification: "VERIFIED",
        lifecycle: "ACTIVE",
        version: 4,
        history: 1,
        verificationHistory: 1,
        publicRows: 0,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("controls stale and forged verification or activation calls and preserves explicit DENY", async () => {
    const db = await fixture();
    try {
      expect(await approveVerification(db, { authVersion: 2 })).toEqual({
        status: "DENIED",
      });
      expect(await approveVerification(db, {
        actorId: ids.administrator,
        assignmentId: ids.administratorAssignment,
        authVersion: 2,
      })).toEqual({ status: "DENIED" });
      expect(await approveVerification(db, { expectedVersion: 2 })).toEqual({
        status: "STALE",
      });
      expect(await approveVerification(db, { reason: "BROWSER_FORGED_REASON" })).toEqual({
        status: "DENIED",
      });
      await db.query(
        "UPDATE companies SET verification_status='VERIFIED' WHERE id=$1",
        [ids.company],
      );
      expect(await activate(db, { authVersion: 2 })).toEqual({ status: "DENIED" });
      expect(await activate(db, { expectedVersion: 2 })).toEqual({ status: "STALE" });
      const foreign = await db.query<{ snapshot: CommandResult }>(`
        SELECT axora_activate_company($1,$2,2,$3,3,$4,now()) AS snapshot
      `, [
        ids.administrator,
        ids.administratorAssignment,
        ids.otherCompany,
        "FORGED_FOREIGN_COMPANY_ACTIVATION",
      ]);
      expect(foreign.rows[0]?.snapshot).toEqual({ status: "DENIED" });
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,company_id,starts_at,
          active,reason,changed_by
        ) SELECT $1,permission.id,'DENY','COMPANY',$2,now(),true,
          'Explicit activation denial fixture',$1
        FROM permissions permission
        WHERE permission.permission_code='company.activate'
      `, [ids.owner, ids.company]);
      expect(await activate(db)).toEqual({ status: "DENIED" });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("upgrades 111 in place, preserves rows, and installs least-privilege grants", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "111_account_setup_link_reliability.sql" });
      await db.exec(`
        INSERT INTO companies(id,company_code,name,active,lifecycle_status,verification_status)
        VALUES ('a1200000-0000-4000-8000-000000000099','UPGRADE-112',
          'Upgrade fixture',false,'COMPANY_ADMINISTRATOR_ACTIVATED','DRAFT')
      `);
      await db.exec(await readFile(
        new URL(
          "../database/migrations/112_company_activation_contract_reconciliation.sql",
          import.meta.url,
        ),
        "utf8",
      ));
      const state = await db.query<{
        companies: number;
        blocker: string[];
        commandGrant: boolean;
        verificationGrant: boolean;
        previousReviewGrant: boolean;
        internalGrant: boolean;
        publicGrant: boolean;
      }>(`
        SELECT
          (SELECT count(*)::int FROM companies WHERE company_code='UPGRADE-112') AS companies,
          (SELECT axora_company_activation_blockers(id) FROM companies
            WHERE company_code='UPGRADE-112') AS blocker,
          has_function_privilege('axora_app',
            'axora_activate_company(uuid,uuid,integer,uuid,integer,text,timestamptz)',
            'EXECUTE') AS "commandGrant",
          has_function_privilege('axora_app',
            'axora_review_company_verification(uuid,uuid,integer,uuid,integer,text,text,timestamptz)',
            'EXECUTE') AS "verificationGrant",
          has_function_privilege('axora_app',
            'axora_review_company_verification(uuid,uuid,uuid,integer,text,text,timestamptz)',
            'EXECUTE') AS "previousReviewGrant",
          has_function_privilege('axora_app',
            'axora_company_verification_readiness_blockers(uuid)',
            'EXECUTE') AS "internalGrant",
          has_function_privilege('public',
            'axora_review_company_verification(uuid,uuid,integer,uuid,integer,text,text,timestamptz)',
            'EXECUTE') AS "publicGrant"
      `);
      expect(state.rows[0]).toEqual({
        companies: 1,
        blocker: ["ADMIN_ACTIVATION", "COMPANY_VERIFICATION_REQUIRED"],
        commandGrant: true,
        verificationGrant: true,
        previousReviewGrant: true,
        internalGrant: false,
        publicGrant: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
