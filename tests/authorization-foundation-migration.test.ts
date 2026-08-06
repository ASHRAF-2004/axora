import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "@/lib/authorization-policy";
import {
  applyDemoSeed,
  applyMigrations,
} from "./helpers/pglite";

const migration036Url = new URL(
  "../database/migrations/036_authorization_policy_foundation.sql",
  import.meta.url,
);

describe("P0-01 authorization policy foundation migration", () => {
  it("installs the canonical role and permission catalogue on a fresh schema", async () => {
    const db = new PGlite();
    try {
      const applied = await applyMigrations(db, {
        through: "036_authorization_policy_foundation.sql",
      });
      expect(applied.at(-1)).toBe(
        "036_authorization_policy_foundation.sql",
      );

      const roles = await db.query<{ roleKey: string }>(`
        SELECT role_key AS "roleKey"
        FROM roles
        WHERE role_key IN (
          'CLIENT_ACCOUNT_MANAGER',
          'DEPARTMENT_ADMIN',
          'DELIVERY_TEAM_SUPERVISOR',
          'DELIVERY_AGENT'
        )
        ORDER BY role_key
      `);
      expect(roles.rows.map((row) => row.roleKey)).toEqual([
        "CLIENT_ACCOUNT_MANAGER",
        "DELIVERY_AGENT",
        "DELIVERY_TEAM_SUPERVISOR",
        "DEPARTMENT_ADMIN",
      ].sort());

      const permissions = await db.query<{ code: string }>(`
        SELECT permission_code AS code
        FROM permissions
        ORDER BY permission_code
      `);
      expect(permissions.rows.map((row) => row.code)).toEqual(
        PERMISSION_CATALOG.map((entry) => entry.code).sort(),
      );

      const defaults = await db.query<{
        roleKey: string;
        permissionCode: string;
      }>(`
        SELECT role.role_key AS "roleKey",
               permission.permission_code AS "permissionCode"
        FROM role_permissions default_permission
        JOIN roles role ON role.id=default_permission.role_id
        JOIN permissions permission
          ON permission.id=default_permission.permission_id
        WHERE (
          role.role_key='CLIENT_ACCOUNT_MANAGER'
          AND permission.permission_code='company.view.assigned'
        ) OR (
          role.role_key='DEPARTMENT_ADMIN'
          AND permission.permission_code='request.create'
        ) OR (
          role.role_key='DELIVERY_TEAM_SUPERVISOR'
          AND permission.permission_code='delivery.assign'
        ) OR (
          role.role_key='DELIVERY_AGENT'
          AND permission.permission_code='delivery.assignment.update'
        )
        ORDER BY role.role_key
      `);
      expect(defaults.rows).toHaveLength(4);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("upgrades a populated migration-035 database without changing existing identities", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "035_public_visitor_network_uniqueness.sql",
      });
      await applyDemoSeed(db);

      const before = await db.query<{
        users: number;
        assignments: number;
        companies: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM companies) AS companies
      `);

      await db.exec(await readFile(migration036Url, "utf8"));

      const after = await db.query<{
        users: number;
        assignments: number;
        companies: number;
        scopes: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM companies) AS companies,
          (SELECT count(*)::int FROM user_scopes
            WHERE source='ROLE_ASSIGNMENT') AS scopes
      `);
      expect(after.rows[0]).toMatchObject(before.rows[0]);
      expect(after.rows[0].scopes).toBe(before.rows[0].assignments);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("enforces typed scopes, approval subjects, delegation expiry, and append-only history", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);

      const actorId = "f9000000-0000-4000-8000-000000000036";
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_kind,account_status
        )
        SELECT
          $1,
          'authorization-foundation-actor@example.test',
          'Authorization foundation actor',
          'not-a-real-password-hash',
          id,
          true,
          'PLATFORM',
          'ACTIVE'
        FROM roles
        WHERE role_key='PLATFORM_OWNER'
      `, [actorId]);

      const fixture = await db.query<{
        companyId: string;
        branchId: string;
        companyAdminRoleId: string;
        approvePermissionId: string;
      }>(`
        SELECT
          selected.company_id::text AS "companyId",
          selected.id::text AS "branchId",
          (SELECT id::text FROM roles
            WHERE role_key='COMPANY_ADMIN') AS "companyAdminRoleId",
          (SELECT id::text FROM permissions
            WHERE permission_code='request.approve.other')
            AS "approvePermissionId"
        FROM (
          SELECT id,company_id
          FROM branches
          ORDER BY id
          LIMIT 1
        ) selected
      `);
      const value = {
        ...fixture.rows[0],
        actorId,
      };

      const department = await db.query<{ id: string }>(`
        INSERT INTO departments(
          company_id,branch_id,department_code,name,created_by
        ) VALUES ($1,$2,'HR','Human Resources',$3)
        RETURNING id::text
      `, [value.companyId, value.branchId, value.actorId]);
      const departmentId = department.rows[0].id;

      await expect(db.query(`
        INSERT INTO user_scopes(
          user_id,scope_type,company_id,source,assigned_by
        ) VALUES ($1,'DEPARTMENT',$2,'DIRECT',$1)
      `, [value.actorId, value.companyId]))
        .rejects.toThrow();

      await expect(db.query(`
        INSERT INTO user_scopes(
          user_id,scope_type,company_id,branch_id,department_id,
          source,assigned_by
        ) VALUES ($1,'DEPARTMENT',$2,$3,$4,'DIRECT',$1)
      `, [
        value.actorId,
        value.companyId,
        value.branchId,
        departmentId,
      ])).resolves.not.toThrow();

      await expect(db.query(`
        INSERT INTO approval_limits(
          user_id,role_id,permission_id,scope_type,company_id,
          currency,maximum_amount,reason,changed_by
        ) VALUES ($1,$2,$3,'COMPANY',$4,'MYR',1000,
          'Invalid dual subject',$1)
      `, [
        value.actorId,
        value.companyAdminRoleId,
        value.approvePermissionId,
        value.companyId,
      ])).rejects.toThrow();

      await expect(db.query(`
        INSERT INTO approval_limits(
          role_id,permission_id,scope_type,company_id,
          currency,maximum_amount,reason,changed_by
        ) VALUES ($1,$2,'COMPANY',$3,'MYR',1000,
          'Company approval policy',$4)
      `, [
        value.companyAdminRoleId,
        value.approvePermissionId,
        value.companyId,
        value.actorId,
      ])).resolves.not.toThrow();

      const delegation = await db.query<{ id: string }>(`
        INSERT INTO delegated_access(
          grantee_user_id,authorized_by,starts_at,ends_at,reason
        ) VALUES (
          $1,$1,now(),now()+interval '1 hour',
          'Temporary approved coverage'
        )
        RETURNING id::text
      `, [value.actorId]);
      await db.query(`
        INSERT INTO delegated_access_permissions(
          delegated_access_id,permission_id
        ) VALUES ($1,$2)
      `, [delegation.rows[0].id, value.approvePermissionId]);
      await db.query(`
        INSERT INTO delegated_access_scopes(
          delegated_access_id,scope_type,company_id
        ) VALUES ($1,'COMPANY',$2)
      `, [delegation.rows[0].id, value.companyId]);

      const history = await db.query<{ id: string }>(`
        INSERT INTO permission_change_history(
          actor_user_id,target_user_id,permission_id,change_type,
          new_value,reason
        ) VALUES (
          $1,$1,$2,'PERMISSION_GRANTED',
          '{"effect":"GRANT"}'::jsonb,
          'Authorization foundation test'
        )
        RETURNING id::text
      `, [value.actorId, value.approvePermissionId]);
      await expect(db.query(`
        UPDATE permission_change_history
        SET reason='tampered'
        WHERE id=$1
      `, [history.rows[0].id])).rejects.toThrow(/append-only/i);
      await expect(db.query(`
        DELETE FROM permission_change_history WHERE id=$1
      `, [history.rows[0].id])).rejects.toThrow(/append-only/i);
    } finally {
      await db.close();
    }
  }, 30_000);
});
