import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("P0-10 immutable accountability migration", () => {
  it("redacts evidence, chains events, rejects mutation, and rolls back atomically", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await applyDemoSeed(db);
      const first = await db.query<{
        id: string;
        old_values: Record<string, unknown>;
        new_values: Record<string, unknown>;
        safe_diff: { changedFields: string[] };
        integrity_hash: string;
      }>(`
        INSERT INTO public.audit_logs(
          entity_type,record_id,action,reason,old_values,new_values
        ) VALUES (
          'accountability_probe',gen_random_uuid(),'UPDATE','Focused migration verification',
          '{"status":"OLD","password":"never-store-this","nested":{"api_token":"never-store-this"}}'::jsonb,
          '{"status":"NEW","email":"private@example.test","latitude":3.14}'::jsonb
        )
        RETURNING id,old_values,new_values,safe_diff,integrity_hash
      `);

      expect(first.rows[0].old_values).toMatchObject({
        password: "[REDACTED]",
        nested: { api_token: "[REDACTED]" },
      });
      expect(first.rows[0].new_values).toMatchObject({
        email: "[REDACTED]",
        latitude: "[REDACTED]",
      });
      expect(first.rows[0].safe_diff.changedFields).toEqual(expect.arrayContaining(["status"]));
      expect(first.rows[0].integrity_hash).toMatch(/^[0-9a-f]{64}$/);

      await expect(db.query(`UPDATE public.audit_logs SET reason='tampered' WHERE id=$1`, [first.rows[0].id]))
        .rejects.toThrow(/append-only/i);
      await expect(db.query(`DELETE FROM public.audit_logs WHERE id=$1`, [first.rows[0].id]))
        .rejects.toThrow(/append-only/i);

      const correction = await db.query<{ previous_integrity_hash: string; integrity_hash: string }>(`
        INSERT INTO public.audit_logs(
          entity_type,record_id,action,reason,reason_code,correction_of,old_values,new_values
        ) VALUES ('accountability_probe',gen_random_uuid(),'CORRECTION','Corrected reason','CORRECTION',$1,'{}','{}')
        RETURNING previous_integrity_hash,integrity_hash
      `, [first.rows[0].id]);
      expect(correction.rows[0].previous_integrity_hash).toBe(first.rows[0].integrity_hash);
      expect(correction.rows[0].integrity_hash).toMatch(/^[0-9a-f]{64}$/);

      const beforeRollback = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.audit_logs");
      await db.exec("BEGIN");
      await db.exec(`INSERT INTO public.audit_logs(entity_type,record_id,action,old_values,new_values) VALUES ('rollback_probe',gen_random_uuid(),'INSERT','{}','{}')`);
      await db.exec("ROLLBACK");
      const afterRollback = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.audit_logs");
      expect(afterRollback.rows[0].count).toBe(beforeRollback.rows[0].count);

      await db.exec(`
        INSERT INTO public.audit_logs(entity_type,record_id,action,old_values,new_values)
        SELECT 'volume_probe',gen_random_uuid(),'READ','{}',jsonb_build_object('sequence',number)
        FROM generate_series(1,25) AS number
      `);
      const integrity = await db.query<{ invalid_count: number }>(`
        SELECT count(*) FILTER (WHERE NOT is_valid)::int AS invalid_count
        FROM public.axora_verify_audit_integrity('PLATFORM')
      `);
      expect(integrity.rows[0].invalid_count).toBe(0);

      const fixtureCompany = await db.query<{ id: string }>(`
        SELECT id::text AS id FROM public.companies ORDER BY id LIMIT 1
      `);
      const actorId = "91000000-0000-4000-8000-000000000001";
      const assignmentId = "92000000-0000-4000-8000-000000000001";
      await db.query(`
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,active,company_id,is_owner,
          account_kind,account_status,account_setup_completed_at,auth_version
        )
        SELECT
          $1,'accountability-admin@example.test','Accountability admin',
          '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture',role.id,true,$2,false,
          'COMPANY','ACTIVE',clock_timestamp(),1
        FROM public.roles AS role WHERE role.role_key='COMPANY_ADMIN'
      `, [actorId, fixtureCompany.rows[0].id]);
      await db.query(`
        INSERT INTO public.company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES ($1,$2,'ACTIVE',true,clock_timestamp())
      `, [actorId, fixtureCompany.rows[0].id]);
      await db.query(`
        INSERT INTO public.role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_at
        )
        SELECT $1,$2,role.id,'COMPANY',$3,true,clock_timestamp()
        FROM public.roles AS role WHERE role.role_key='COMPANY_ADMIN'
      `, [assignmentId, actorId, fixtureCompany.rows[0].id]);
      const authority = await db.query<{
        actor_id: string;
        assignment_id: string;
        company_id: string;
      }>(`
        SELECT
          assignment.user_id::text AS actor_id,
          assignment.id::text AS assignment_id,
          assignment.company_id::text AS company_id
        FROM public.role_assignments AS assignment
        WHERE assignment.active
          AND assignment.revoked_at IS NULL
          AND assignment.company_id IS NOT NULL
          AND assignment.scope_type='COMPANY'
          AND public.axora_snapshot_has_permission(
            public.axora_effective_access_snapshot(
              assignment.user_id,
              assignment.id,
              clock_timestamp()
            ),
            'audit.view',
            'COMPANY',
            assignment.company_id,
            NULL,
            NULL,
            NULL
          )
        ORDER BY assignment.assigned_at,assignment.id
        LIMIT 1
      `);
      expect(authority.rows).toHaveLength(1);
      const authorized = authority.rows[0];
      const otherCompany = await db.query<{ id: string }>(`
        SELECT id::text AS id FROM public.companies WHERE id<>$1 ORDER BY id LIMIT 1
      `, [authorized.company_id]);
      expect(otherCompany.rows).toHaveLength(1);

      await db.exec("BEGIN");
      await db.query(`
        SELECT
          set_config('axora.user_id',$1,true),
          set_config('axora.role_assignment_id',$2,true),
          set_config('axora.display_timezone','Asia/Kuala_Lumpur',true),
          set_config('axora.correlation_id','focused-scope-proof',true)
      `, [authorized.actor_id, authorized.assignment_id]);
      const scopedEvent = await db.query<{ id: string }>(`
        INSERT INTO public.audit_logs(
          entity_type,record_id,action,company_id,reason,old_values,new_values
        ) VALUES ('company_scope_probe',gen_random_uuid(),'READ',$1,'Scoped read proof','{}','{}')
        RETURNING id::text AS id
      `, [authorized.company_id]);
      await db.exec("COMMIT");
      await db.query(`
        INSERT INTO public.audit_logs(
          entity_type,record_id,action,company_id,reason,old_values,new_values
        ) VALUES ('other_company_probe',gen_random_uuid(),'READ',$1,'Must remain hidden','{}','{}')
      `, [otherCompany.rows[0].id]);

      const snapshot = await db.query<{
        actor_role_assignment_id: string;
        actor_role_snapshot: string;
        actor_authority_snapshot: Record<string, unknown>;
        display_timezone: string;
        correlation_id: string;
      }>(`
        SELECT
          actor_role_assignment_id::text,
          actor_role_snapshot,
          actor_authority_snapshot,
          display_timezone,
          correlation_id
        FROM public.audit_logs WHERE id=$1
      `, [scopedEvent.rows[0].id]);
      expect(snapshot.rows[0]).toMatchObject({
        actor_role_assignment_id: authorized.assignment_id,
        display_timezone: "Asia/Kuala_Lumpur",
        correlation_id: "focused-scope-proof",
      });
      expect(snapshot.rows[0].actor_role_snapshot).toBeTruthy();
      expect(snapshot.rows[0].actor_authority_snapshot).not.toMatchObject({ capture: "legacy_unknown" });

      const accessEvent = await db.query<{ event_id: string }>(`
        SELECT public.axora_record_accountability_access(
          $1,$2,'AUDIT_EXPORT',$3,7,clock_timestamp()
        )::text AS event_id
      `, [authorized.actor_id, authorized.assignment_id, authorized.company_id]);
      const accessEvidence = await db.query<{
        event_type: string;
        company_id: string;
        related_document_id: string | null;
      }>(`
        SELECT event_type,company_id::text,related_document_id::text
        FROM public.audit_logs WHERE id=$1
      `, [accessEvent.rows[0].event_id]);
      expect(accessEvidence.rows[0]).toEqual({
        event_type: "AUDIT_EXPORT",
        company_id: authorized.company_id,
        related_document_id: null,
      });

      const visible = await db.query<{ id: string; company_id: string }>(`
        SELECT id::text AS id,company_id::text AS company_id
        FROM public.axora_audit_rows($1,$2)
      `, [authorized.actor_id, authorized.assignment_id]);
      expect(visible.rows.some((row) => row.id === scopedEvent.rows[0].id)).toBe(true);
      expect(visible.rows.some((row) => row.company_id === otherCompany.rows[0].id)).toBe(false);

      await db.exec("SET ROLE axora_app");
      await expect(db.query("SELECT id FROM public.audit_logs LIMIT 1"))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query("UPDATE public.audit_logs SET reason='runtime tamper' WHERE false"))
        .rejects.toThrow(/permission denied/i);
      const runtimeVisible = await db.query<{ id: string }>(`
        SELECT id::text AS id FROM public.axora_audit_rows($1,$2)
      `, [authorized.actor_id, authorized.assignment_id]);
      expect(runtimeVisible.rows.some((row) => row.id === scopedEvent.rows[0].id)).toBe(true);
      await db.exec("RESET ROLE");
    } finally {
      await db.close();
    }
  }, 120_000);

  it("defines scoped capabilities and strips direct runtime table privileges", async () => {
    const migration = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../database/migrations/059_immutable_accountability_and_scope_closure.sql", import.meta.url),
      "utf8",
    ));
    expect(migration).toContain("axora_effective_access_snapshot");
    expect(migration).toContain("axora_snapshot_has_permission");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.axora_audit_rows");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.axora_record_accountability_access");
    expect(migration).toContain("REVOKE ALL ON TABLE public.audit_logs FROM axora_app");
    expect(migration).toContain("LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500)");
    expect(migration).not.toContain("GRANT SELECT ON TABLE public.audit_logs TO axora_app");
  });
});
