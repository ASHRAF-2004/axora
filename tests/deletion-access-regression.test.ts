import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isPermissionCode } from "@/lib/authorization-policy";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "82000000-0000-4000-8000-000000000001",
  ownerAssignment: "82000000-0000-4000-8000-000000000002",
  target: "82000000-0000-4000-8000-000000000003",
  targetAssignment: "82000000-0000-4000-8000-000000000004",
  invitation: "82000000-0000-4000-8000-000000000005",
  override: "82000000-0000-4000-8000-000000000006",
  replacement: "82000000-0000-4000-8000-000000000007",
  session: "82000000-0000-4000-8000-000000000008",
} as const;

const originalEmail = "target-082@example.test";

describe("deletion and access regressions", () => {
  it("keeps every live database permission parseable by the application catalog", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const result = await db.query<{ code: string }>(`
        SELECT permission_code AS code FROM permissions
        WHERE active ORDER BY permission_code
      `);
      expect(result.rows.map((row) => row.code).filter((code) => !isPermissionCode(code)))
        .toEqual([]);
      expect(isPermissionCode("delivery.tracking.history")).toBe(true);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("permanently erases a non-owner identity and immediately releases its email", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const roles = await db.query<{ ownerRole: string; operationsRole: string }>(`
        SELECT
          (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS "ownerRole",
          (SELECT id::text FROM roles WHERE role_key='PLATFORM_OPERATIONS') AS "operationsRole"
      `);
      const role = roles.rows[0];
      if (!role?.ownerRole || !role.operationsRole) throw new Error("Missing roles");
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_setup_completed_at,account_kind,account_status,active,
          auth_version,email_verified_at,last_login_at
        ) VALUES
          ($1,'owner-096@example.test','Owner 096','not-a-real-hash',$3,true,
           now(),'PLATFORM','ACTIVE',true,1,now(),now()),
          ($2,$5,'Personal Name To Remove',
           '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
           $4,false,now(),'PLATFORM','ACTIVE',true,3,now(),now())
      `, [ids.owner, ids.target, role.ownerRole, role.operationsRole, originalEmail]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) VALUES
          ($1,$3,$5,'PLATFORM',true,$3,now()),
          ($2,$4,$6,'PLATFORM',true,$3,now())
      `, [ids.ownerAssignment, ids.targetAssignment, ids.owner, ids.target,
        role.ownerRole, role.operationsRole]);
      await db.query(`
        INSERT INTO user_profiles(
          user_id,display_name,job_title,phone,preferred_locale,
          profile_completed_at
        ) VALUES ($1,'Personal Name To Remove','Private role','+60123456789','en',now())
        ON CONFLICT(user_id) DO UPDATE SET
          display_name=EXCLUDED.display_name,
          job_title=EXCLUDED.job_title,
          phone=EXCLUDED.phone,
          profile_completed_at=EXCLUDED.profile_completed_at;
        INSERT INTO account_credentials(
          user_id,password_hash,password_algorithm,password_changed_at
        ) VALUES (
          $1,'$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
          'bcrypt',now()
        ) ON CONFLICT(user_id) DO UPDATE SET
          password_hash=EXCLUDED.password_hash,
          password_algorithm=EXCLUDED.password_algorithm;
        INSERT INTO user_sessions(
          id,user_id,token_hash,issued_at,last_seen_at,expires_at,
          network_hash,user_agent_summary
        ) VALUES ($2,$1,repeat('b',64),now(),now(),now()+interval '1 day',
          repeat('c',64),'Private browser description');
        INSERT INTO account_setup_invitations(
          id,user_id,token_hash,expires_at,email_locale,created_by,
          intended_role_id,intended_scope_type,consumed_at,delivery_status,
          sent_at,delivery_attempted_at,delivery_attempt_count,
          provider_message_id
        ) VALUES (
          $3,$1,repeat('a',64),now()+interval '1 day','en',$4,$5,'PLATFORM',
          now(),'SENT',now(),now(),1,'provider-private-identifier'
        );
      `, [ids.target, ids.session, ids.invitation, ids.owner, role.operationsRole]);
      const permission = await db.query<{ id: string }>(`
        SELECT id::text FROM permissions WHERE permission_code='dashboard.view'
      `);
      await db.query(`
        INSERT INTO user_permission_overrides(
          id,user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
        ) VALUES ($1,$2,$3,'GRANT','PLATFORM',now(),true,'Removal fixture',$4)
      `, [ids.override, ids.target, permission.rows[0]?.id, ids.owner]);

      const removed = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_remove_user_account($1,$2,$3,$4,now()) AS snapshot
      `, [ids.owner, ids.ownerAssignment, ids.target, "Owner permanently deleted obsolete account"]);
      expect(removed.rows[0]?.snapshot).toMatchObject({
        removed: true,
        userId: ids.target,
        authVersion: 4,
        revokedAssignments: 1,
        revokedInvitations: 1,
        disabledOverrides: 1,
      });

      const state = await db.query<{
        email: string;
        displayName: string;
        passwordHash: string;
        active: boolean;
        accountStatus: string;
        accountKind: string;
        authVersion: number;
        verified: boolean;
        setupComplete: boolean;
        hasLastLogin: boolean;
        personalRows: number;
        activeAssignments: number;
        activeOverrides: number;
        originalEmailRows: number;
      }>(`
        SELECT account.email,
          account.display_name AS "displayName",
          account.password_hash AS "passwordHash",
          account.active,
          account.account_status AS "accountStatus",
          account.account_kind AS "accountKind",
          account.auth_version AS "authVersion",
          account.email_verified_at IS NOT NULL AS verified,
          account.account_setup_completed_at IS NOT NULL AS "setupComplete",
          account.last_login_at IS NOT NULL AS "hasLastLogin",
          (
            (SELECT count(*) FROM user_profiles WHERE user_id=account.id)
            +(SELECT count(*) FROM account_credentials WHERE user_id=account.id)
            +(SELECT count(*) FROM user_sessions WHERE user_id=account.id)
            +(SELECT count(*) FROM account_setup_invitations WHERE user_id=account.id)
            +(SELECT count(*) FROM password_reset_tokens WHERE user_id=account.id)
            +(SELECT count(*) FROM email_verification_tokens WHERE user_id=account.id)
          )::int AS "personalRows",
          (SELECT count(*)::int FROM role_assignments
            WHERE user_id=account.id AND active) AS "activeAssignments",
          (SELECT count(*)::int FROM user_permission_overrides
            WHERE user_id=account.id AND active) AS "activeOverrides",
          (SELECT count(*)::int FROM users
            WHERE lower(email)=lower($2)) AS "originalEmailRows"
        FROM users account WHERE account.id=$1
      `, [ids.target, originalEmail]);
      expect(state.rows[0]).toEqual({
        email: `deleted-${ids.target.replaceAll("-", "")}@deleted.invalid`,
        displayName: "Deleted user",
        passwordHash: "!permanently-deleted!",
        active: false,
        accountStatus: "DEACTIVATED",
        accountKind: "PLATFORM",
        authVersion: 4,
        verified: false,
        setupComplete: false,
        hasLastLogin: false,
        personalRows: 0,
        activeAssignments: 0,
        activeOverrides: 0,
        originalEmailRows: 0,
      });

      await expect(db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_setup_completed_at,account_kind,account_status,active,auth_version
        ) VALUES (
          $1,$2,'Completely New Identity','new-unrelated-hash',$3,false,
          NULL,'PLATFORM','INVITED',true,1
        )
      `, [ids.replacement, originalEmail, role.operationsRole]))
        .resolves.not.toThrow();

      const replacement = await db.query<{
        count: number;
        inheritedAssignments: number;
        inheritedInvitations: number;
      }>(`
        SELECT count(*)::int AS count,
          (SELECT count(*)::int FROM role_assignments WHERE user_id=$1)
            AS "inheritedAssignments",
          (SELECT count(*)::int FROM account_setup_invitations WHERE user_id=$1)
            AS "inheritedInvitations"
        FROM users WHERE id=$1 AND lower(email)=lower($2)
      `, [ids.replacement, originalEmail]);
      expect(replacement.rows[0]).toEqual({
        count: 1,
        inheritedAssignments: 0,
        inheritedInvitations: 0,
      });

      const integrity = await db.query<{ valid: boolean }>(`
        SELECT bool_and(valid) AS valid
        FROM (
          SELECT (axora_verify_audit_integrity(partition)).valid
          FROM (
            SELECT DISTINCT integrity_partition AS partition
            FROM audit_logs
          ) partitions
        ) checks
      `);
      expect(integrity.rows[0]?.valid ?? true).toBe(true);

      await expect(db.query(`
        UPDATE users SET active=true,account_status='ACTIVE' WHERE id=$1
      `, [ids.target])).rejects.toThrow(/cannot be reactivated/i);
      await expect(db.query(`
        SELECT axora_remove_user_account($1,$2,$1,$3,now())
      `, [ids.owner, ids.ownerAssignment, "Cannot remove owner"])).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 45_000);

  it("exposes explicit irreversible owner deletion controls", async () => {
    const [companies, users, lifecycle] = await Promise.all([
      readFile(new URL("../src/app/(portal)/companies/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/users/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/company-lifecycle-i18n.ts", import.meta.url), "utf8"),
    ]);
    expect(companies).toContain('company.status !== "ARCHIVED"');
    expect(lifecycle).toContain('ARCHIVE: "Delete company"');
    expect(users).toContain("actor.isOwner && !isPlatformOwner");
    expect(users).toContain("removeUserAction.bind(null, user.id)");
    expect(users).toContain('user.accountStatus !== "DEACTIVATED"');
  });
});
