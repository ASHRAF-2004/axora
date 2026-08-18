import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";
import { accountSetupInvitationReplacementBlocker } from "@/lib/account-invitation-eligibility";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ids = {
  owner: "79000000-0000-4000-8000-000000000001",
  target: "79000000-0000-4000-8000-000000000002",
  unprivileged: "79000000-0000-4000-8000-000000000003",
  ownerAssignment: "79100000-0000-4000-8000-000000000001",
  targetAssignment: "79100000-0000-4000-8000-000000000002",
  unprivilegedAssignment: "79100000-0000-4000-8000-000000000003",
  failedInvitation: "79200000-0000-4000-8000-000000000001",
  pendingInvitation: "79200000-0000-4000-8000-000000000002",
  duplicateInvitation: "79200000-0000-4000-8000-000000000003",
  providerEvent: "79300000-0000-4000-8000-000000000001",
} as const;

async function invitationFixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{ owner: string; target: string }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OPERATIONS') AS target
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.target) {
    throw new Error("Invitation fixture roles are unavailable.");
  }
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-079@example.test','Owner 079','not-a-real-hash',$4,true,
        now(),'PLATFORM','ACTIVE',true,1),
      ($2,'target-079@example.test','Target 079',
        '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
        $5,false,NULL,'PLATFORM','INVITED',true,1),
      ($3,'operations-079@example.test','Operations 079','not-a-real-hash',$5,false,
        now(),'PLATFORM','ACTIVE',true,1)
  `, [
    ids.owner,
    ids.target,
    ids.unprivileged,
    role.owner,
    role.target,
  ]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) VALUES
      ($1,$4,$7,'PLATFORM',true,$4,now()-interval '1 day'),
      ($2,$5,$8,'PLATFORM',true,$4,now()-interval '1 day'),
      ($3,$6,$9,'PLATFORM',true,$4,now()-interval '1 day')
  `, [
    ids.ownerAssignment,
    ids.targetAssignment,
    ids.unprivilegedAssignment,
    ids.owner,
    ids.target,
    ids.unprivileged,
    role.owner,
    role.target,
    role.target,
  ]);
  await db.query(`
    INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
    VALUES ($1,NULL,NULL)
  `, [ids.target]);
  await db.query(`
    INSERT INTO user_profiles(user_id,display_name,preferred_locale)
    VALUES ($1,'Target 079','en')
  `, [ids.target]);
  return { db, role };
}

async function resendSnapshot(
  db: PGlite,
  actorId: string = ids.owner,
  assignmentId: string = ids.ownerAssignment,
) {
  const result = await db.query<{ snapshot: Record<string, unknown> | null }>(`
    SELECT axora_account_setup_resend_target($1,$2,$3,now()) AS snapshot
  `, [actorId, assignmentId, ids.target]);
  return result.rows[0]?.snapshot ?? null;
}

describe("account invitation resend resilience", () => {
  it("keeps the authorized resend snapshot behind a narrow capability", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      const result = await db.query<{ execute: boolean; departmentSelect: boolean; definition: string }>(`
        SELECT
          has_function_privilege('axora_app','axora_account_setup_resend_target(uuid,uuid,uuid,timestamptz)','EXECUTE') AS execute,
          has_table_privilege('axora_app','departments','SELECT') AS "departmentSelect",
          pg_get_functiondef('axora_account_setup_resend_target(uuid,uuid,uuid,timestamptz)'::regprocedure) AS definition
      `);
      expect(result.rows[0]?.execute).toBe(true);
      expect(result.rows[0]?.departmentSelect).toBe(false);
      expect(result.rows[0]?.definition).toContain("axora_lock_user_target_access");
      expect(result.rows[0]?.definition).toContain("LEFT JOIN LATERAL");
      expect(result.rows[0]?.definition).toContain("email_recipient_suppressions");
      expect(result.rows[0]?.definition).toContain("latestDeliveryStatus");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("uses one locked snapshot and a structured client action", async () => {
    const setup = await source("src/lib/account-setup.ts");
    const action = await source("src/app/(portal)/users/actions.ts");
    const form = await source("src/components/InvitationResendForm.tsx");
    expect(setup).toContain("lockAuthorizedInvitationResendTarget(");
    expect(setup).not.toContain("const targetResult = await client.query<ExistingInvitationTarget>");
    expect(setup).toContain("assertInvitationMayBeReplaced(target)");
    expect(action).toContain("Promise<InvitationResendActionState>");
    expect(action).toContain('return { status: "error", code: error.reason }');
    expect(form).toContain("useActionState(");
    expect(form).toContain('data-draft-ignore="true"');
  });

  it("treats absent and revoked history as eligible while preserving evidence", async () => {
    const { db, role } = await invitationFixture();
    try {
      expect(await resendSnapshot(db)).toMatchObject({
        userId: ids.target,
        currentInvitationPresent: false,
      });

      await db.query(`
        INSERT INTO account_setup_invitations(
          id,user_id,token_hash,expires_at,created_by,email_locale,
          delivery_status,delivery_attempt_count,delivery_attempted_at,
          last_delivery_error,created_at,revoked_at,intended_role_id,
          intended_scope_type
        ) VALUES (
          $1,$2,repeat('a',64),now()+interval '1 day',$3,'en',
          'FAILED',1,now()-interval '2 hours','synthetic_provider_failure',
          now()-interval '2 hours',now()-interval '90 minutes',$4,'PLATFORM'
        )
      `, [ids.failedInvitation, ids.target, ids.owner, role.target]);
      const before = await db.query(`
        SELECT delivery_status,revoked_at,last_delivery_error
        FROM account_setup_invitations WHERE id=$1
      `, [ids.failedInvitation]);

      expect(await resendSnapshot(db)).toMatchObject({
        userId: ids.target,
        currentInvitationPresent: false,
      });
      const after = await db.query(`
        SELECT delivery_status,revoked_at,last_delivery_error
        FROM account_setup_invitations WHERE id=$1
      `, [ids.failedInvitation]);
      expect(after.rows).toEqual(before.rows);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps active accounts, permissions, suppressions, and one-live-token constraints", async () => {
    const { db, role } = await invitationFixture();
    try {
      await db.query(`
        INSERT INTO account_setup_invitations(
          id,user_id,token_hash,expires_at,created_by,email_locale,
          intended_role_id,intended_scope_type
        ) VALUES ($1,$2,repeat('b',64),now()+interval '1 day',$3,'en',$4,'PLATFORM')
      `, [ids.pendingInvitation, ids.target, ids.owner, role.target]);
      expect(await resendSnapshot(db)).toMatchObject({
        currentInvitationPresent: true,
        latestDeliveryStatus: "PENDING",
      });
      await expect(db.query(`
        INSERT INTO account_setup_invitations(
          id,user_id,token_hash,expires_at,created_by,email_locale,
          intended_role_id,intended_scope_type
        ) VALUES ($1,$2,repeat('c',64),now()+interval '1 day',$3,'en',$4,'PLATFORM')
      `, [ids.duplicateInvitation, ids.target, ids.owner, role.target])).rejects.toThrow();

      expect(await resendSnapshot(
        db, ids.unprivileged, ids.unprivilegedAssignment,
      )).toBeNull();
      await db.query("UPDATE users SET active=false WHERE id=$1", [ids.target]);
      expect(await resendSnapshot(db)).toBeNull();
      await db.query(`
        UPDATE users
        SET active=true,account_status='ACTIVE',account_setup_completed_at=now(),
            email_verified_at=now(),password_hash='not-a-real-hash'
        WHERE id=$1
      `, [ids.target]);
      expect(await resendSnapshot(db)).toBeNull();
      await db.query(`
        UPDATE users
        SET account_status='INVITED',account_setup_completed_at=NULL,
            email_verified_at=NULL,
            password_hash='$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By'
        WHERE id=$1
      `, [ids.target]);
      await db.query(`
        UPDATE account_setup_invitations
        SET revoked_at=now(),delivery_status='CANCELLED'
        WHERE id=$1
      `, [ids.pendingInvitation]);
      await db.query(`
        SELECT * FROM axora_record_resend_email_event(
          $1,'MESSAGE_COMPLAINED',
          axora_email_recipient_fingerprint('target-079@example.test'),
          repeat('d',64),NULL,true,now(),1
        )
      `, [ids.providerEvent]);
      expect(await resendSnapshot(db)).toBeNull();
      const history = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM account_setup_invitations WHERE user_id=$1
      `, [ids.target]);
      expect(history.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("classifies current invitation states without making history a prerequisite", () => {
    const future = new Date("2026-08-14T00:00:00.000Z");
    const past = new Date("2026-08-12T00:00:00.000Z");
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: false,
    }, now)).toBeUndefined();
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: true,
      deliveryStatus: "FAILED",
      expiresAt: future,
    }, now)).toBeUndefined();
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: true,
      deliveryStatus: "SENT",
      expiresAt: past,
    }, now)).toBeUndefined();
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: true,
      deliveryStatus: "PENDING",
      expiresAt: future,
    }, now)).toBe("pending");
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: true,
      deliveryStatus: "SENT",
      expiresAt: future,
    }, now)).toBe("delivered");
  });
});
