import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "./helpers/pglite";

describe("delivery operations completion migration", () => {
  it("adds paid-safe acquisition evidence and tightens the canonical workflow", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      const state = await db.query<{
        acquisition_table: string | null;
        receipt_table: string | null;
        line_table: string | null;
        forced_rls: number;
        event_definition: string;
        evidence_definition: string;
        tracking_definition: string;
        document_definition: string;
        app_can_register: boolean;
        direct_cost_grants: number;
      }>(`
        SELECT
          to_regclass('public.delivery_acquisition_submissions')::text AS acquisition_table,
          to_regclass('public.delivery_acquisition_receipts')::text AS receipt_table,
          to_regclass('public.delivery_acquisition_lines')::text AS line_table,
          (SELECT count(*)::int FROM pg_class
            WHERE relnamespace='public'::regnamespace
              AND relname IN ('delivery_acquisition_submissions',
                'delivery_acquisition_receipts','delivery_acquisition_lines')
              AND relrowsecurity AND relforcerowsecurity) AS forced_rls,
          pg_get_functiondef('public.axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz)'::regprocedure) AS event_definition,
          pg_get_functiondef('public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz)'::regprocedure) AS evidence_definition,
          pg_get_functiondef('public.axora_delivery_tracking_assignment_lifecycle()'::regprocedure) AS tracking_definition,
          pg_get_functiondef('public.axora_build_final_delivery_document_snapshot(uuid,timestamptz)'::regprocedure) AS document_definition,
          has_function_privilege('axora_app',
            'public.axora_register_delivery_acquisition(uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,text,bigint,timestamptz,text,jsonb,timestamptz)',
            'EXECUTE') AS app_can_register,
          (SELECT count(*)::int FROM information_schema.role_table_grants grant_row
            WHERE grant_row.grantee='axora_app' AND grant_row.table_schema='public'
              AND grant_row.table_name='delivery_acquisition_lines') AS direct_cost_grants
      `);
      expect(state.rows[0]).toMatchObject({
        acquisition_table: "delivery_acquisition_submissions",
        receipt_table: "delivery_acquisition_receipts",
        line_table: "delivery_acquisition_lines",
        forced_rls: 3,
        app_can_register: true,
        direct_cost_grants: 0,
      });
      expect(state.rows[0]!.event_definition).toContain("assignment.acceptance_deadline<p_at");
      expect(state.rows[0]!.event_definition).toContain("axora_delivery_acquisition_is_complete(job.id)");
      expect(state.rows[0]!.event_definition).toMatch(
        /job\.status='SHOPPING'\s+AND\s+\(\s*EXISTS[\s\S]*axora_delivery_acquisition_is_complete\(job\.id\)\s*\)/,
      );
      expect(state.rows[0]!.event_definition).toContain("job.status='DELIVERED'");
      expect(state.rows[0]!.event_definition).toContain("value_key='COMPLETED'");
      expect((state.rows[0]!.event_definition.match(/value_key='COMPLETED'/g) ?? [])).toHaveLength(1);
      expect(state.rows[0]!.evidence_definition).toContain("existing.delivery_job_event_id IS DISTINCT");
      expect(state.rows[0]!.evidence_definition).toContain("event.event_type NOT IN ('ARRIVED'");
      expect(state.rows[0]!.tracking_definition).toContain("job.destination_latitude");
      expect(state.rows[0]!.document_definition).toContain("delivery_acquisition_submissions");
      expect(state.rows[0]!.document_definition).not.toContain("actual_internal_unit_cost");
      expect(state.rows[0]!.document_definition).not.toContain("storage_path");
    } finally {
      await db.close();
    }
  }, 45_000);
});
