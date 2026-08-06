import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migration032Url = new URL(
  "../database/migrations/032_user_session_revocation_audit.sql",
  import.meta.url,
);

const ids = {
  actor: "d3200000-0000-4000-8000-000000000001",
  current: "d3200000-0000-4000-8000-000000000002",
  passwordOne: "d3200000-0000-4000-8000-000000000003",
  passwordTwo: "d3200000-0000-4000-8000-000000000004",
  individual: "d3200000-0000-4000-8000-000000000005",
  fallback: "d3200000-0000-4000-8000-000000000006",
  invalidActor: "d3200000-0000-4000-8000-000000000099",
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
     VALUES ($1,repeat('c',64)) ON CONFLICT(filename) DO NOTHING`,
    [filename],
  );
}

async function createSessionFixtures(db: PGlite) {
  await applyDemoSeed(db);
  await db.exec(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_kind,account_status,email_verified_at
    ) SELECT
      '${ids.actor}','session-audit-032@example.test','Session audit 032',
      'not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE',now()
    FROM roles WHERE role_key='AUDITOR';

    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES ('${ids.actor}','${ids.company}','ACTIVE',true,now());
    INSERT INTO role_assignments(user_id,role_id,scope_type,company_id)
    SELECT '${ids.actor}',id,'COMPANY','${ids.company}'
    FROM roles WHERE role_key='AUDITOR';

    INSERT INTO user_sessions(
      id,user_id,token_hash,expires_at,network_hash,user_agent_summary
    ) VALUES
      ('${ids.current}','${ids.actor}',repeat('1',64),now()+interval '8 hours',
        repeat('a',64),'Sensitive current browser marker'),
      ('${ids.passwordOne}','${ids.actor}',repeat('2',64),now()+interval '8 hours',
        repeat('b',64),'Sensitive password browser one'),
      ('${ids.passwordTwo}','${ids.actor}',repeat('3',64),now()+interval '8 hours',
        repeat('c',64),'Sensitive password browser two'),
      ('${ids.individual}','${ids.actor}',repeat('4',64),now()+interval '8 hours',
        repeat('d',64),'Sensitive individual browser marker'),
      ('${ids.fallback}','${ids.actor}',repeat('5',64),now()+interval '8 hours',
        repeat('e',64),'Sensitive fallback browser marker');
  `);
}

async function assumeAppUser(db: PGlite, userId: string, reason: string) {
  await db.exec("SET ROLE axora_app");
  await db.query("SELECT set_config('axora.user_id',$1,false)", [userId]);
  await db.query("SELECT set_config('axora.change_reason',$1,false)", [reason]);
}

async function resetRole(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('axora.user_id','',false)");
  await db.query("SELECT set_config('axora.change_reason','',false)");
}

describe("session-revocation audit migration", () => {
  it("installs on an empty schema and records only minimized transition evidence", async () => {
    const db = new PGlite();
    try {
      await createMigrationLedger(db);
      const applied = await applyMigrations(db);
      expect(applied.at(-1)).toBe("038_canonical_session_scopes.sql");
      await markMigration(db, "032_user_session_revocation_audit.sql");
      await createSessionFixtures(db);

      await assumeAppUser(
        db,
        ids.actor,
        "Changed own password and rotated sessions",
      );
      try {
        const revoked = await db.query<{ id: string }>(`
          UPDATE user_sessions
          SET revoked_at=now(),revoked_by=$1,revoke_reason='password_changed'
          WHERE id IN ($2,$3) AND revoked_at IS NULL
          RETURNING id::text
        `, [ids.actor, ids.passwordOne, ids.passwordTwo]);
        expect(revoked.rows).toHaveLength(2);

        await expect(db.query(`
          INSERT INTO audit_logs(entity_type,action)
          VALUES ('forged_session_audit','UPDATE')
        `)).rejects.toThrow();
      } finally {
        await resetRole(db);
      }

      const evidence = await db.query<{
        recordId: string;
        oldValues: unknown;
        newValues: Record<string, unknown>;
        actorId: string;
        companyId: string;
        reason: string;
        leaked: boolean;
      }>(`
        SELECT record_id::text AS "recordId",old_values AS "oldValues",
          new_values AS "newValues",actor_id::text AS "actorId",
          company_id::text AS "companyId",reason,
          (COALESCE(old_values,'{}'::jsonb)||COALESCE(new_values,'{}'::jsonb))
            ?| ARRAY[
              'token_hash','network_hash','user_agent_summary','user_id',
              'issued_at','last_seen_at','expires_at','revoked_by'
            ] AS leaked
        FROM audit_logs
        WHERE entity_type='user_sessions'
          AND record_id IN ($1,$2)
        ORDER BY record_id
      `, [ids.passwordOne, ids.passwordTwo]);
      expect(evidence.rows).toHaveLength(2);
      for (const row of evidence.rows) {
        expect(row).toMatchObject({
          oldValues: null,
          newValues: { revoked: true },
          actorId: ids.actor,
          companyId: ids.company,
          reason: "Changed own password and rotated sessions",
          leaked: false,
        });
        expect(Object.keys(row.newValues)).toEqual(["revoked"]);
      }

      await db.query(`
        UPDATE user_sessions
        SET last_seen_at=now(),revoked_at=revoked_at+interval '1 second'
        WHERE id=$1
      `, [ids.passwordOne]);
      const unchanged = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM audit_logs
        WHERE entity_type='user_sessions'
          AND record_id IN ($1,$2)
      `, [ids.passwordOne, ids.passwordTwo]);
      expect(unchanged.rows[0].count).toBe(2);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails malformed actor context and supports a safe revoked_by fallback", async () => {
    const db = new PGlite();
    try {
      await createMigrationLedger(db);
      await applyMigrations(db);
      await createSessionFixtures(db);

      await assumeAppUser(
        db,
        ids.invalidActor,
        "Attempt session revocation with invalid actor",
      );
      try {
        await expect(db.query(`
          UPDATE user_sessions
          SET revoked_at=now(),revoked_by=$1,
            revoke_reason='revoked_by_account_owner'
          WHERE id=$2
        `, [ids.actor, ids.individual])).rejects.toThrow(
          "Session revocation actor context is invalid",
        );
      } finally {
        await resetRole(db);
      }
      const refused = await db.query<{ active: boolean }>(`
        SELECT revoked_at IS NULL AS active
        FROM user_sessions WHERE id=$1
      `, [ids.individual]);
      expect(refused.rows[0].active).toBe(true);

      await db.exec("SET ROLE axora_app");
      try {
        await db.query(`
          UPDATE user_sessions
          SET revoked_at=now(),revoked_by=$1,revoke_reason='User signed out'
          WHERE id=$2
        `, [ids.actor, ids.fallback]);
      } finally {
        await resetRole(db);
      }
      const fallback = await db.query<{
        actorId: string;
        reason: string;
        newValues: Record<string, unknown>;
      }>(`
        SELECT actor_id::text AS "actorId",reason,new_values AS "newValues"
        FROM audit_logs
        WHERE entity_type='user_sessions' AND record_id=$1
      `, [ids.fallback]);
      expect(fallback.rows[0]).toEqual({
        actorId: ids.actor,
        reason: "User signed out",
        newValues: { revoked: true },
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps the trigger function private and audit inserts denied", async () => {
    const db = new PGlite();
    try {
      await createMigrationLedger(db);
      await applyMigrations(db);
      const boundary = await db.query<{
        appExecute: boolean;
        auditInsert: boolean;
        securityDefiner: boolean;
        hardenedPath: boolean;
        publicExecuteDenied: boolean;
        triggerCount: number;
        containsSensitiveField: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app','audit_user_session_revocation()','EXECUTE'
          ) AS "appExecute",
          has_table_privilege('axora_app','audit_logs','INSERT')
            AS "auditInsert",
          routine.prosecdef AS "securityDefiner",
          routine.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
            AS "hardenedPath",
          NOT EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(routine.proacl,acldefault('f',routine.proowner))
            ) privilege
            WHERE privilege.grantee=0
              AND privilege.privilege_type='EXECUTE'
          ) AS "publicExecuteDenied",
          (SELECT count(*)::int FROM pg_trigger
           WHERE tgname='audit_user_session_revocations'
             AND NOT tgisinternal) AS "triggerCount",
          pg_get_functiondef(routine.oid)
            ~* '(token_hash|network_hash|user_agent_summary|to_jsonb\\s*\\(\\s*(OLD|NEW))'
            AS "containsSensitiveField"
        FROM pg_proc routine
        WHERE routine.oid='audit_user_session_revocation()'::regprocedure
      `);
      expect(boundary.rows[0]).toEqual({
        appExecute: false,
        auditInsert: false,
        securityDefiner: true,
        hardenedPath: true,
        publicExecuteDenied: true,
        triggerCount: 1,
        containsSensitiveField: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("upgrades a populated 031 schema without rewriting prior sessions or audit", async () => {
    const db = new PGlite();
    try {
      await createMigrationLedger(db);
      await applyMigrations(db, {
        through: "031_support_diagnostics_security.sql",
      });
      await markMigration(db, "031_support_diagnostics_security.sql");
      await createSessionFixtures(db);
      await db.query(`
        INSERT INTO audit_logs(entity_type,record_id,action,reason)
        VALUES ('pre_032_evidence',$1,'READ','Preserved 031 evidence')
      `, [ids.actor]);
      await db.query(`
        UPDATE user_sessions
        SET revoked_at=now(),revoked_by=$1,revoke_reason='password_changed'
        WHERE id=$2
      `, [ids.actor, ids.passwordOne]);

      await db.exec(await readFile(migration032Url, "utf8"));
      await markMigration(db, "032_user_session_revocation_audit.sql");

      const beforeNewRevocation = await db.query<{
        priorSession: number;
        priorSessionAudit: number;
        priorEvidence: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM user_sessions
           WHERE id=$1 AND revoked_at IS NOT NULL) AS "priorSession",
          (SELECT count(*)::int FROM audit_logs
           WHERE entity_type='user_sessions' AND record_id=$1)
            AS "priorSessionAudit",
          (SELECT count(*)::int FROM audit_logs
           WHERE entity_type='pre_032_evidence') AS "priorEvidence"
      `, [ids.passwordOne]);
      expect(beforeNewRevocation.rows[0]).toEqual({
        priorSession: 1,
        priorSessionAudit: 0,
        priorEvidence: 1,
      });

      await assumeAppUser(
        db,
        ids.actor,
        "Revoked another active session",
      );
      try {
        await db.query(`
          UPDATE user_sessions
          SET revoked_at=now(),revoked_by=$1,
            revoke_reason='revoked_by_account_owner'
          WHERE id=$2 AND revoked_at IS NULL
        `, [ids.actor, ids.individual]);
      } finally {
        await resetRole(db);
      }
      const after = await db.query<{ sessionAudit: number; latest: string }>(`
        SELECT
          (SELECT count(*)::int FROM audit_logs
           WHERE entity_type='user_sessions' AND record_id=$1)
            AS "sessionAudit",
          (SELECT filename FROM schema_migrations
           ORDER BY filename DESC LIMIT 1) AS latest
      `, [ids.individual]);
      expect(after.rows[0]).toEqual({
        sessionAudit: 1,
        latest: "032_user_session_revocation_audit.sql",
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});