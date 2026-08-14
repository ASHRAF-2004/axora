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
} as const;

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

  it("permanently removes a non-owner while preserving invitation evidence", async () => {
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
          account_setup_completed_at,account_kind,account_status,active,auth_version
        ) VALUES
          ($1,'owner-082@example.test','Owner 082','not-a-real-hash',$3,true,
           now(),'PLATFORM','ACTIVE',true,1),
          ($2,'target-082@example.test','Target 082',
           '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
           $4,false,NULL,'PLATFORM','INVITED',true,3)
      `, [ids.owner, ids.target, role.ownerRole, role.operationsRole]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) VALUES
          ($1,$3,$5,'PLATFORM',true,$3,now()),
          ($2,$4,$6,'PLATFORM',true,$3,now())
      `, [ids.ownerAssignment, ids.targetAssignment, ids.owner, ids.target,
        role.ownerRole, role.operationsRole]);
      await db.query(`
        INSERT INTO account_setup_invitations(
          id,user_id,token_hash,expires_at,email_locale,created_by,
          intended_role_id,intended_scope_type
        ) VALUES ($1,$2,repeat('a',64),now()+interval '1 day','en',$3,$4,'PLATFORM')
      `, [ids.invitation, ids.target, ids.owner, role.operationsRole]);
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
      `, [ids.owner, ids.ownerAssignment, ids.target, "Owner removed obsolete account"]);
      expect(removed.rows[0]?.snapshot).toMatchObject({
        removed: true,
        userId: ids.target,
        authVersion: 4,
        revokedAssignments: 1,
        revokedInvitations: 1,
        disabledOverrides: 1,
      });
      const state = await db.query<{
        active: boolean; accountStatus: string; authVersion: number;
        activeAssignments: number; activeOverrides: number;
        invitations: number; activeInvitations: number;
      }>(`
        SELECT account.active,account.account_status AS "accountStatus",
          account.auth_version AS "authVersion",
          (SELECT count(*)::int FROM role_assignments WHERE user_id=account.id AND active) AS "activeAssignments",
          (SELECT count(*)::int FROM user_permission_overrides WHERE user_id=account.id AND active) AS "activeOverrides",
          (SELECT count(*)::int FROM account_setup_invitations WHERE user_id=account.id) AS invitations,
          (SELECT count(*)::int FROM account_setup_invitations WHERE user_id=account.id AND revoked_at IS NULL AND consumed_at IS NULL) AS "activeInvitations"
        FROM users account WHERE account.id=$1
      `, [ids.target]);
      expect(state.rows[0]).toEqual({
        active: false,
        accountStatus: "DEACTIVATED",
        authVersion: 4,
        activeAssignments: 0,
        activeOverrides: 0,
        invitations: 1,
        activeInvitations: 0,
      });
      await expect(db.query(`
        UPDATE users SET active=true,account_status='ACTIVE' WHERE id=$1
      `, [ids.target])).rejects.toThrow(/cannot be reactivated/i);
      await expect(db.query(`
        SELECT axora_remove_user_account($1,$2,$1,$3,now())
      `, [ids.owner, ids.ownerAssignment, "Cannot remove owner"])).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes explicit archived-company and owner-removal controls without hard deletion", async () => {
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
