import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supportDiagnosticInternals } from "@/lib/support-diagnostics";
import { applyDemoSeed, applyMigrations, migrationFiles } from "./helpers/pglite";

const migration031Url = new URL(
  "../database/migrations/031_support_diagnostics_security.sql",
  import.meta.url,
);

const ids = {
  support: "d3100000-0000-4000-8000-000000000001",
  owner: "d3100000-0000-4000-8000-000000000002",
  operations: "d3100000-0000-4000-8000-000000000003",
  target: "d3100000-0000-4000-8000-000000000004",
  session: "d3100000-0000-4000-8000-000000000005",
  company: "10000000-0000-4000-8000-000000000001",
} as const;

async function createMigrationLedger(db: PGlite) {
  await db.exec(`
    CREATE ROLE axora_app NOLOGIN;
    CREATE TABLE schema_migrations(
      filename text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function markMigration(db: PGlite, filename: string) {
  await db.query(
    `INSERT INTO schema_migrations(filename,sha256)
     VALUES ($1,repeat('a',64)) ON CONFLICT(filename) DO NOTHING`,
    [filename],
  );
}

async function createSupportFixtures(db: PGlite) {
  await applyDemoSeed(db);
  await db.exec(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_kind,
      account_status,email_verified_at
    ) SELECT
      '${ids.support}','support-031@example.test','Support 031',
      'not-a-real-hash',id,false,'PLATFORM','ACTIVE',now()
    FROM roles WHERE role_key='TECHNICAL_SUPPORT';

    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_kind,
      account_status,email_verified_at
    ) SELECT
      '${ids.owner}','owner-031@example.test','Owner 031',
      'not-a-real-hash',id,true,'PLATFORM','ACTIVE',now()
    FROM roles WHERE role_key='PLATFORM_OWNER';

    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,account_kind,
      account_status,email_verified_at
    ) SELECT
      '${ids.operations}','operations-031@example.test','Operations 031',
      'not-a-real-hash',id,false,'PLATFORM','ACTIVE',now()
    FROM roles WHERE role_key='PLATFORM_OPERATIONS';

    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_kind,account_status,email_verified_at
    ) SELECT
      '${ids.target}','target-031@example.test','Target 031',
      'not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE',now()
    FROM roles WHERE role_key='COMPANY_ADMIN';

    INSERT INTO role_assignments(user_id,role_id,scope_type)
    SELECT '${ids.support}',id,'PLATFORM'
    FROM roles WHERE role_key='TECHNICAL_SUPPORT';
    INSERT INTO role_assignments(user_id,role_id,scope_type)
    SELECT '${ids.owner}',id,'PLATFORM'
    FROM roles WHERE role_key='PLATFORM_OWNER';
    INSERT INTO role_assignments(user_id,role_id,scope_type)
    SELECT '${ids.operations}',id,'PLATFORM'
    FROM roles WHERE role_key='PLATFORM_OPERATIONS';
    INSERT INTO role_assignments(user_id,role_id,scope_type,company_id)
    SELECT '${ids.target}',id,'COMPANY','${ids.company}'
    FROM roles WHERE role_key='COMPANY_ADMIN';

    INSERT INTO user_profiles(user_id,display_name,profile_completed_at)
    VALUES ('${ids.target}','Target profile 031',now());

    INSERT INTO user_sessions(id,user_id,token_hash,expires_at)
    VALUES (
      '${ids.session}','${ids.target}',repeat('b',64),now()+interval '1 hour'
    );
  `);
}

async function assumeAppUser(db: PGlite, userId: string) {
  await db.exec("SET ROLE axora_app");
  await db.query("SELECT set_config('axora.user_id',$1,false)", [userId]);
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('axora.user_id','',false)");
}

describe("support diagnostics migration and SQL contract", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await createMigrationLedger(db);
    const applied = await applyMigrations(db);
    expect(applied.at(-1)).toBe("034_public_visitor_network_fallback.sql");
    await markMigration(db, "032_user_session_revocation_audit.sql");
    await createSupportFixtures(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("executes every support query against the complete schema", async () => {
    await assumeAppUser(db, ids.support);
    try {
      const summary = await db.query<{
        latestMigration: string;
        workflowExceptions: number;
      }>(supportDiagnosticInternals.sql.systemSummary);
      expect(summary.rows[0]).toMatchObject({
        latestMigration: "032_user_session_revocation_audit.sql",
        workflowExceptions: 2,
      });

      const diagnostic = await db.query<{
        id: string;
        displayName: string;
        activeSessionCount: number;
        protectedPlatformAccount: boolean;
      }>(supportDiagnosticInternals.sql.accountDiagnostic, [
        "TARGET-031@EXAMPLE.TEST",
      ]);
      expect(diagnostic.rows[0]).toMatchObject({
        id: ids.target,
        displayName: "Target profile 031",
        activeSessionCount: 1,
        protectedPlatformAccount: false,
      });

      await db.query(supportDiagnosticInternals.sql.audit, [
        "ACCOUNT_DIAGNOSTIC",
        ids.target,
        true,
        null,
        "Investigate verified sign-in report",
      ]);

      const locked = await db.query<{
        id: string;
        protectedPlatformAccount: boolean;
      }>(supportDiagnosticInternals.sql.targetLock, [ids.target]);
      expect(locked.rows[0]).toEqual({
        id: ids.target,
        protectedPlatformAccount: false,
      });

      await db.query(
        "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
        [ids.target],
      );
      const revoked = await db.query(
        supportDiagnosticInternals.sql.revokeSessions,
        [ids.target, ids.support],
      );
      const revokedCount = revoked.rows.length;
      expect(revokedCount).toBe(1);
      await db.query(supportDiagnosticInternals.sql.audit, [
        "SESSION_CONTROL",
        ids.target,
        null,
        revokedCount,
        "Revoke sessions after verified report",
      ]);
    } finally {
      await resetRole(db);
    }

    const state = await db.query<{
      authVersion: number;
      revokedBy: string;
      revokeReason: string;
      diagnosticAudits: number;
      sessionAudits: number;
      sessionRevocationAudits: number;
    }>(`
      SELECT
        (SELECT auth_version FROM users WHERE id=$1) AS "authVersion",
        (SELECT revoked_by::text FROM user_sessions WHERE id=$2) AS "revokedBy",
        (SELECT revoke_reason FROM user_sessions WHERE id=$2) AS "revokeReason",
        (SELECT count(*)::int FROM audit_logs
         WHERE entity_type='support_account_diagnostic'
           AND actor_id=$3) AS "diagnosticAudits",
        (SELECT count(*)::int FROM audit_logs
         WHERE entity_type='support_session_control'
           AND actor_id=$3) AS "sessionAudits",
        (SELECT count(*)::int FROM audit_logs
         WHERE entity_type='user_sessions' AND record_id=$2
           AND actor_id=$3
           AND new_values='{"revoked":true}'::jsonb)
          AS "sessionRevocationAudits"
    `, [ids.target, ids.session, ids.support]);
    expect(state.rows[0]).toEqual({
      authVersion: 2,
      revokedBy: ids.support,
      revokeReason: "revoked_by_technical_support",
      diagnosticAudits: 1,
      sessionAudits: 1,
      sessionRevocationAudits: 1,
    });
  });

  it("keeps the audit table private and rejects unauthorized or unsafe calls", async () => {
    await assumeAppUser(db, ids.support);
    try {
      await expect(db.query(`
        INSERT INTO audit_logs(entity_type,action)
        VALUES ('forged_support_event','READ')
      `)).rejects.toThrow();
      await expect(db.query(supportDiagnosticInternals.sql.audit, [
        "SESSION_CONTROL",
        ids.owner,
        null,
        0,
        "Attempt protected platform session action",
      ])).rejects.toThrow("Support session audit shape is invalid");
      await expect(db.query(supportDiagnosticInternals.sql.audit, [
        "ACCOUNT_DIAGNOSTIC",
        ids.target,
        false,
        null,
        "Mismatched diagnostic audit shape",
      ])).rejects.toThrow("Support diagnostic audit shape is invalid");
      await expect(db.query(supportDiagnosticInternals.sql.audit, [
        "UNSUPPORTED_EVENT",
        null,
        null,
        null,
        "Unsupported support audit event",
      ])).rejects.toThrow("Support audit event is invalid");
      await expect(db.query(supportDiagnosticInternals.sql.audit, [
        "ACCOUNT_DIAGNOSTIC",
        null,
        false,
        null,
        "short",
      ])).rejects.toThrow("Support audit reason is invalid");
    } finally {
      await resetRole(db);
    }

    await assumeAppUser(db, ids.operations);
    try {
      await expect(db.query(
        supportDiagnosticInternals.sql.systemSummary,
      )).rejects.toThrow("Support actor is not authorized");
    } finally {
      await resetRole(db);
    }

    await assumeAppUser(db, ids.owner);
    try {
      const summary = await db.query(
        supportDiagnosticInternals.sql.systemSummary,
      );
      expect(summary.rows).toHaveLength(1);
    } finally {
      await resetRole(db);
    }

    await db.query(
      "UPDATE users SET account_status='SUSPENDED' WHERE id=$1",
      [ids.support],
    );
    await assumeAppUser(db, ids.support);
    try {
      await expect(db.query(
        supportDiagnosticInternals.sql.systemSummary,
      )).rejects.toThrow("Support actor is not authorized");
    } finally {
      await resetRole(db);
      await db.query(
        "UPDATE users SET account_status='ACTIVE' WHERE id=$1",
        [ids.support],
      );
    }
  });

  it("grants only the intended application capabilities", async () => {
    const privileges = await db.query<{
      summaryExecute: boolean;
      auditExecute: boolean;
      helperExecute: boolean;
      auditInsert: boolean;
      publicSummaryExecute: boolean;
      publicAuditExecute: boolean;
    }>(`
      SELECT
        has_function_privilege(
          'axora_app','axora_support_system_summary()','EXECUTE'
        ) AS "summaryExecute",
        has_function_privilege(
          'axora_app',
          'axora_record_support_audit(text,uuid,boolean,integer,text)',
          'EXECUTE'
        ) AS "auditExecute",
        has_function_privilege(
          'axora_app','axora_authorized_support_actor()','EXECUTE'
        ) AS "helperExecute",
        has_table_privilege(
          'axora_app','audit_logs','INSERT'
        ) AS "auditInsert",
        NOT EXISTS (
          SELECT 1
          FROM pg_proc function
          CROSS JOIN LATERAL aclexplode(
            COALESCE(function.proacl,acldefault('f',function.proowner))
          ) privilege
          WHERE function.oid='axora_support_system_summary()'::regprocedure
            AND privilege.grantee=0
            AND privilege.privilege_type='EXECUTE'
        ) AS "publicSummaryExecute",
        NOT EXISTS (
          SELECT 1
          FROM pg_proc function
          CROSS JOIN LATERAL aclexplode(
            COALESCE(function.proacl,acldefault('f',function.proowner))
          ) privilege
          WHERE function.oid=(
            'axora_record_support_audit(text,uuid,boolean,integer,text)'
          )::regprocedure
            AND privilege.grantee=0
            AND privilege.privilege_type='EXECUTE'
        ) AS "publicAuditExecute"
    `);
    expect(privileges.rows[0]).toEqual({
      summaryExecute: true,
      auditExecute: true,
      helperExecute: false,
      auditInsert: false,
      publicSummaryExecute: true,
      publicAuditExecute: true,
    });
  });
});

describe("support diagnostics 030 to 031 upgrade", () => {
  it("preserves populated identity, sessions, and audit history", async () => {
    const db = new PGlite();
    try {
      await createMigrationLedger(db);
      await applyMigrations(db, {
        through: "030_email_provider_lifecycle_events.sql",
      });
      await markMigration(db, "030_email_provider_lifecycle_events.sql");
      await createSupportFixtures(db);
      await db.query(`
        INSERT INTO audit_logs(entity_type,record_id,action,reason)
        VALUES ('pre_031_evidence',$1,'READ','Preserved upgrade evidence')
      `, [ids.target]);

      await db.exec(await readFile(migration031Url, "utf8"));
      await markMigration(db, "031_support_diagnostics_security.sql");

      const preserved = await db.query<{
        users: number;
        sessions: number;
        evidence: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users
           WHERE id IN ($1,$2,$3,$4)) AS users,
          (SELECT count(*)::int FROM user_sessions WHERE id=$5) AS sessions,
          (SELECT count(*)::int FROM audit_logs
           WHERE entity_type='pre_031_evidence') AS evidence
      `, [ids.support, ids.owner, ids.operations, ids.target, ids.session]);
      expect(preserved.rows[0]).toEqual({ users: 4, sessions: 1, evidence: 1 });

      await assumeAppUser(db, ids.support);
      try {
        const result = await db.query<{ latestMigration: string }>(
          supportDiagnosticInternals.sql.systemSummary,
        );
        expect(result.rows[0].latestMigration)
          .toBe("031_support_diagnostics_security.sql");
      } finally {
        await resetRole(db);
      }

      const available = await migrationFiles();
      expect(available).toContain("031_support_diagnostics_security.sql");
    } finally {
      await db.close();
    }
  }, 30_000);
});
