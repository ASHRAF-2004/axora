import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("normalized identity and access baseline", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "015_zzzz.sql" });
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(email,display_name,password_hash,role_id,is_owner)
      SELECT 'identity-owner@example.test','Identity Owner','not-a-real-hash',id,true
      FROM roles WHERE role_key='ADMIN';

      INSERT INTO users(email,display_name,password_hash,role_id,company_id,is_owner)
      SELECT 'identity-admin@example.test','Identity Admin','not-a-real-hash',role.id,
        '10000000-0000-4000-8000-000000000001',false
      FROM roles role WHERE role.role_key='ADMIN';

      INSERT INTO users(email,display_name,password_hash,role_id,company_id,branch_id,is_owner)
      SELECT 'identity-approver@example.test','Identity Approver','not-a-real-hash',role.id,
        branch.company_id,branch.id,false
      FROM roles role
      CROSS JOIN LATERAL (SELECT id,company_id FROM branches ORDER BY id LIMIT 1) branch
      WHERE role.role_key='APPROVER';

      INSERT INTO users(email,display_name,password_hash,role_id,company_id,branch_id,is_owner)
      SELECT 'identity-support@example.test','Identity Support','not-a-real-hash',role.id,
        branch.company_id,branch.id,false
      FROM roles role
      CROSS JOIN LATERAL (SELECT id,company_id FROM branches ORDER BY id LIMIT 1) branch
      WHERE role.role_key='IT_SUPPORT';
    `);
    await db.exec(await readFile(
      new URL("../database/migrations/016_identity_profiles_and_scopes.sql", import.meta.url),
      "utf8",
    ));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("separates profiles, credentials, memberships, assignments and onboarding", async () => {
    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "user_profiles",
      "account_credentials",
      "company_memberships",
      "branch_assignments",
      "role_assignments",
      "supplier_memberships",
      "delivery_agent_profiles",
      "user_sessions",
      "password_reset_tokens",
      "email_verification_tokens",
      "onboarding_progress",
      "tutorial_step_progress",
      "notification_preferences",
    ]));
  });

  it("backfills every seeded account without creating a cross-tenant membership", async () => {
    const result = await db.query<{
      users: number;
      profiles: number;
      credentials: number;
      bad_memberships: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM user_profiles) AS profiles,
        (SELECT count(*)::int FROM account_credentials) AS credentials,
        (SELECT count(*)::int
         FROM company_memberships membership
         JOIN users account ON account.id=membership.user_id
         WHERE membership.status='ACTIVE'
           AND account.company_id IS DISTINCT FROM membership.company_id) AS bad_memberships
    `);
    expect(result.rows[0].profiles).toBe(result.rows[0].users);
    expect(result.rows[0].credentials).toBe(result.rows[0].users);
    expect(result.rows[0].bad_memberships).toBe(0);
  });

  it("maps legacy permissions into explicit generic scoped roles", async () => {
    const roles = await db.query<{ role_key: string; scope_type: string; company_id?: string; branch_id?: string }>(`
      SELECT role.role_key, assignment.scope_type,
        assignment.company_id::text, assignment.branch_id::text
      FROM role_assignments assignment
      JOIN roles role ON role.id=assignment.role_id
      ORDER BY role.role_key
    `);
    expect(roles.rows.some((row) => row.role_key === "PLATFORM_OWNER" && row.scope_type === "PLATFORM")).toBe(true);
    expect(roles.rows.some((row) => row.role_key === "COMPANY_ADMIN" && row.scope_type === "COMPANY" && Boolean(row.company_id))).toBe(true);
    expect(roles.rows.some((row) => row.role_key === "BRANCH_APPROVER" && row.scope_type === "BRANCH" && Boolean(row.branch_id))).toBe(true);
  });

  it("converts legacy technical support into usable company-less platform access", async () => {
    const support = await db.query<{
      account_kind: string;
      account_status: string;
      company_id: string | null;
      branch_id: string | null;
      role_key: string;
      scope_type: string;
      assignment_company_id: string | null;
      assignment_branch_id: string | null;
      assignment_active: boolean;
      former_company_status: string;
      former_branch_status: string;
    }>(`
      SELECT account.account_kind,account.account_status,
        account.company_id::text,account.branch_id::text,
        assigned_role.role_key,assignment.scope_type,
        assignment.company_id::text AS assignment_company_id,
        assignment.branch_id::text AS assignment_branch_id,
        assignment.active AS assignment_active,
        former_company.status AS former_company_status,
        former_branch.status AS former_branch_status
      FROM users account
      JOIN role_assignments assignment ON assignment.user_id=account.id
      JOIN roles assigned_role ON assigned_role.id=assignment.role_id
      JOIN company_memberships former_company
        ON former_company.user_id=account.id
      JOIN branch_assignments former_branch
        ON former_branch.user_id=account.id
      WHERE account.email='identity-support@example.test'
    `);
    expect(support.rows[0]).toMatchObject({
      account_kind: "PLATFORM",
      account_status: "ACTIVE",
      company_id: null,
      branch_id: null,
      role_key: "TECHNICAL_SUPPORT",
      scope_type: "PLATFORM",
      assignment_company_id: null,
      assignment_branch_id: null,
      assignment_active: true,
      former_company_status: "ENDED",
      former_branch_status: "ENDED",
    });
  });

  it("supports several branches per user while allowing only one active primary", async () => {
    const user = await db.query<{ id: string; company_id: string; branch_id: string }>(`
      SELECT user_row.id::text, user_row.company_id::text, user_row.branch_id::text
      FROM users user_row
      WHERE user_row.branch_id IS NOT NULL
      LIMIT 1
    `);
    const otherBranch = await db.query<{ id: string }>(`
      SELECT id::text FROM branches
      WHERE company_id=$1 AND id<>$2
      LIMIT 1
    `, [user.rows[0].company_id, user.rows[0].branch_id]);

    if (otherBranch.rows.length) {
      await expect(db.query(`
        INSERT INTO branch_assignments(user_id,company_id,branch_id,is_primary)
        VALUES ($1,$2,$3,false)
      `, [user.rows[0].id, user.rows[0].company_id, otherBranch.rows[0].id])).resolves.not.toThrow();
      await expect(db.query(`
        UPDATE branch_assignments SET is_primary=true
        WHERE user_id=$1 AND branch_id=$2
      `, [user.rows[0].id, otherBranch.rows[0].id])).rejects.toThrow();
    }
  });

  it("rejects a branch role whose branch belongs to another company", async () => {
    const account = await db.query<{ id: string; company_id: string }>(`
      SELECT id::text, company_id::text FROM users WHERE company_id IS NOT NULL LIMIT 1
    `);
    const foreignBranch = await db.query<{ id: string; company_id: string }>(`
      SELECT id::text, company_id::text FROM branches WHERE company_id<>$1 LIMIT 1
    `, [account.rows[0].company_id]);
    const role = await db.query<{ id: string }>(`
      SELECT id::text FROM roles WHERE role_key='BRANCH_APPROVER'
    `);

    await expect(db.query(`
      INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,branch_id)
      VALUES ($1,$2,'BRANCH',$3,$4)
    `, [account.rows[0].id, role.rows[0].id, account.rows[0].company_id, foreignBranch.rows[0].id])).rejects.toThrow();
  });

  it("stores invited credentials as null in the normalized credential table", async () => {
    const company = await db.query<{ id: string }>("SELECT id::text FROM companies LIMIT 1");
    const role = await db.query<{ id: string }>("SELECT id::text FROM roles WHERE role_key='REQUESTER'");
    const invited = await db.query<{ id: string }>(`
      INSERT INTO users(
        email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,account_status
      ) VALUES (
        'identity-invited@example.test','Identity invited',
        '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
        $1,$2,false,NULL,'INVITED'
      ) RETURNING id::text
    `, [role.rows[0].id, company.rows[0].id]);
    await db.query(`
      INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
      VALUES ($1,NULL,NULL)
    `, [invited.rows[0].id]);
    const credential = await db.query<{ password_hash: string | null }>(`
      SELECT password_hash FROM account_credentials WHERE user_id=$1
    `, [invited.rows[0].id]);
    expect(credential.rows[0].password_hash).toBeNull();
  });

  it("does not allow an issued invitation to be retargeted to another role", async () => {
    const company = await db.query<{ id: string }>("SELECT id::text FROM companies LIMIT 1");
    const legacyRole = await db.query<{ id: string }>("SELECT id::text FROM roles WHERE role_key='REQUESTER'");
    const intendedRole = await db.query<{ id: string }>("SELECT id::text FROM roles WHERE role_key='REQUESTER'");
    const otherRole = await db.query<{ id: string }>("SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN'");
    const account = await db.query<{ id: string }>(`
      INSERT INTO users(
        email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,account_status
      ) VALUES (
        'identity-scope-lock@example.test','Scope lock',
        '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',
        $1,$2,false,NULL,'INVITED'
      ) RETURNING id::text
    `, [legacyRole.rows[0].id, company.rows[0].id]);
    const invitation = await db.query<{ id: string }>(`
      INSERT INTO account_setup_invitations(
        user_id,company_id,token_hash,expires_at,intended_role_id
      ) VALUES ($1,$2,$3,now()+interval '1 hour',$4)
      RETURNING id::text
    `, [
      account.rows[0].id,
      company.rows[0].id,
      "a".repeat(64),
      intendedRole.rows[0].id,
    ]);
    await expect(db.query(`
      UPDATE account_setup_invitations SET intended_role_id=$2 WHERE id=$1
    `, [invitation.rows[0].id, otherRole.rows[0].id])).rejects.toThrow(/scope are immutable/i);
  });
});
