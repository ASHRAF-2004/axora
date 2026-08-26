import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/116_delivery_agent_e2e.sql",
  import.meta.url,
);

describe("Delivery Agent end-to-end migration", () => {
  it("upgrades 115 additively, removes procurement-dashboard authority, and grants only callable projections", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN; CREATE ROLE axora_untrusted NOLOGIN");
      await applyMigrations(db, {
        through: "115_company_admin_direct_purchase.sql",
      });

      const userId = randomUUID();
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at
        )
        SELECT $1,$2,'Migration 116 Delivery Agent','not-a-real-hash',
          role.id,false,'DELIVERY','ACTIVE',now()
        FROM roles role WHERE role.role_key='DELIVERY_GUY'
      `, [userId, `migration-116-${userId}@example.test`]);
      await db.exec("ALTER TABLE user_permission_overrides DISABLE TRIGGER USER");
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,
          reason,changed_by
        )
        SELECT $1,permission.id,'GRANT','DELIVERY',now()-interval '1 minute',
          true,'Legacy dashboard grant preserved but denied by migration 116',$1
        FROM permissions permission
        WHERE permission.permission_code='dashboard.view'
      `, [userId]);
      await db.exec("ALTER TABLE user_permission_overrides ENABLE TRIGGER USER");

      const before = await db.query<{
        users: number;
        overrides: number;
        dashboardDefault: boolean;
        dashboardOverride: boolean;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM user_permission_overrides) AS overrides,
          EXISTS (
            SELECT 1 FROM role_permissions role_permission
            JOIN roles role ON role.id=role_permission.role_id
            JOIN permissions permission ON permission.id=role_permission.permission_id
            WHERE role.role_key='DELIVERY_GUY'
              AND permission.permission_code='dashboard.view'
          ) AS "dashboardDefault",
          EXISTS (
            SELECT 1 FROM user_permission_overrides override_row
            JOIN permissions permission ON permission.id=override_row.permission_id
            WHERE override_row.user_id=$1 AND override_row.active
              AND permission.permission_code='dashboard.view'
          ) AS "dashboardOverride"
      `, [userId]);
      expect(before.rows[0]).toMatchObject({
        dashboardDefault: true,
        dashboardOverride: true,
      });

      await db.exec(await readFile(migrationUrl, "utf8"));

      const after = await db.query<{
        users: number;
        overrides: number;
        roleLabel: string;
        dashboardDefault: boolean;
        dashboardOverride: boolean;
        dashboardAllowed: boolean;
        trackingAllowed: boolean;
        appAvailableJobs: boolean;
        appClaimResult: boolean;
        appCommandResult: boolean;
        appOtpCommand: boolean;
        untrustedCommandResult: boolean;
        untrustedOtpCommand: boolean;
        appDriverTracking: boolean;
        appRecentCompletion: boolean;
        appCompanyTracking: boolean;
        appTrackingControl: boolean;
        untrustedTrackingControl: boolean;
        trackingControlDefinition: string;
        commandResultDefinition: string;
        otpCommandDefinition: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM user_permission_overrides) AS overrides,
          (SELECT label FROM roles WHERE role_key='DELIVERY_GUY') AS "roleLabel",
          EXISTS (
            SELECT 1 FROM role_permissions role_permission
            JOIN roles role ON role.id=role_permission.role_id
            JOIN permissions permission ON permission.id=role_permission.permission_id
            WHERE role.role_key='DELIVERY_GUY'
              AND permission.permission_code='dashboard.view'
          ) AS "dashboardDefault",
          EXISTS (
            SELECT 1 FROM user_permission_overrides override_row
            JOIN permissions permission ON permission.id=override_row.permission_id
            WHERE override_row.user_id=$1 AND override_row.active
              AND permission.permission_code='dashboard.view'
          ) AS "dashboardOverride",
          axora_permission_allowed_for_account_kind(
            'DELIVERY','dashboard.view'
          ) AS "dashboardAllowed",
          axora_permission_allowed_for_account_kind(
            'DELIVERY','delivery.track'
          ) AS "trackingAllowed",
          has_function_privilege(
            'axora_app','axora_driver_available_jobs(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appAvailableJobs",
          has_function_privilege(
            'axora_app','axora_driver_claim_result(uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appClaimResult",
          has_function_privilege(
            'axora_app','axora_driver_delivery_command_result(uuid,uuid,uuid,text,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appCommandResult",
          has_function_privilege(
            'axora_app','axora_verify_delivery_otp_command(uuid,uuid,uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appOtpCommand",
          has_function_privilege(
            'axora_untrusted','axora_driver_delivery_command_result(uuid,uuid,uuid,text,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "untrustedCommandResult",
          has_function_privilege(
            'axora_untrusted','axora_verify_delivery_otp_command(uuid,uuid,uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "untrustedOtpCommand",
          has_function_privilege(
            'axora_app','axora_driver_delivery_tracking_workspace(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appDriverTracking",
          has_function_privilege(
            'axora_app','axora_driver_recent_delivery_completion(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appRecentCompletion",
          has_function_privilege(
            'axora_app','axora_company_delivery_tracking_workspace(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "appCompanyTracking",
          has_function_privilege(
            'axora_app','axora_control_delivery_tracking(uuid,uuid,uuid,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "appTrackingControl",
          has_function_privilege(
            'axora_untrusted','axora_control_delivery_tracking(uuid,uuid,uuid,text,text,text,timestamptz)',
            'EXECUTE'
          ) AS "untrustedTrackingControl",
          pg_get_functiondef(
            'axora_control_delivery_tracking(uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure
          ) AS "trackingControlDefinition",
          pg_get_functiondef(
            'axora_driver_delivery_command_result(uuid,uuid,uuid,text,uuid,uuid,timestamptz)'::regprocedure
          ) AS "commandResultDefinition",
          pg_get_functiondef(
            'axora_verify_delivery_otp_command(uuid,uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure
          ) AS "otpCommandDefinition"
      `, [userId]);
      expect(after.rows[0]).toMatchObject({
        users: before.rows[0]!.users,
        overrides: before.rows[0]!.overrides,
        roleLabel: "Delivery Agent",
        dashboardDefault: false,
        dashboardOverride: true,
        dashboardAllowed: false,
        trackingAllowed: true,
        appAvailableJobs: true,
        appClaimResult: true,
        appCommandResult: true,
        appOtpCommand: true,
        untrustedCommandResult: false,
        untrustedOtpCommand: false,
        appDriverTracking: true,
        appRecentCompletion: true,
        appCompanyTracking: true,
        appTrackingControl: true,
        untrustedTrackingControl: false,
      });
      expect(after.rows[0]!.trackingControlDefinition).toContain("SECURITY DEFINER");
      expect(after.rows[0]!.trackingControlDefinition)
        .toContain("SET search_path TO 'pg_catalog', 'public', 'pg_temp'");
      expect(after.rows[0]!.trackingControlDefinition)
        .toContain("p_operation='END' AND NOT manager_allowed");
      expect(after.rows[0]!.commandResultDefinition).toContain("SECURITY DEFINER");
      expect(after.rows[0]!.commandResultDefinition)
        .toContain("SET search_path TO 'pg_catalog', 'public', 'pg_temp'");
      expect(after.rows[0]!.otpCommandDefinition).toContain("SECURITY DEFINER");
      expect(after.rows[0]!.otpCommandDefinition)
        .toContain("SET search_path TO 'pg_catalog', 'public', 'pg_temp'");
    } finally {
      await db.close();
    }
  }, 45_000);
});
