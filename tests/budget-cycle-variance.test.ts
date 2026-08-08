import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("P1-06 budget cycles and P1-07 actual variance", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    await applyDemoSeed(db);
  }, 90_000);

  afterAll(async () => {
    await db.close();
  });

  it("installs the complete cycle, worker, adjustment, and actual-cost model", async () => {
    const state = await db.query<{
      cycle_table: string | null;
      job_table: string | null;
      rollover_table: string | null;
      variance_table: string | null;
      actual_table: string | null;
      adjustment_table: string | null;
      refresh_function: string | null;
      actual_function: string | null;
    }>(`
      SELECT
        to_regclass('public.budget_cycle_schedules')::text AS cycle_table,
        to_regclass('public.budget_refresh_jobs')::text AS job_table,
        to_regclass('public.budget_reservation_rollovers')::text AS rollover_table,
        to_regclass('public.procurement_variance_policies')::text AS variance_table,
        to_regclass('public.request_actual_submissions')::text AS actual_table,
        to_regclass('public.budget_adjustment_requests')::text AS adjustment_table,
        to_regprocedure(
          'public.axora_refresh_budget_period_internal(uuid,uuid,uuid,text,text,text,timestamptz)'
        )::text AS refresh_function,
        to_regprocedure(
          'public.axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz)'
        )::text AS actual_function
    `);

    expect(state.rows[0]).toMatchObject({
      cycle_table: "budget_cycle_schedules",
      job_table: "budget_refresh_jobs",
      rollover_table: "budget_reservation_rollovers",
      variance_table: "procurement_variance_policies",
      actual_table: "request_actual_submissions",
      adjustment_table: "budget_adjustment_requests",
      refresh_function:
        "axora_refresh_budget_period_internal(uuid,uuid,uuid,text,text,text,timestamp with time zone)",
      actual_function:
        "axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamp with time zone)",
    });
  });

  it("resolves ambiguous DST boundaries with an explicit earlier or later policy", async () => {
    const result = await db.query<{ difference_seconds: number }>(`
      SELECT extract(epoch FROM (
        public.axora_resolve_budget_local_boundary(
          timestamp '2026-11-01 01:30:00','America/New_York','LATER'
        ) - public.axora_resolve_budget_local_boundary(
          timestamp '2026-11-01 01:30:00','America/New_York','EARLIER'
        )
      ))::int AS difference_seconds
    `);

    expect(result.rows[0].difference_seconds).toBe(3600);
  });

  it("seeds one strict variance policy per company and keeps policy evidence append-only", async () => {
    const counts = await db.query<{ companies: number; policies: number }>(`
      SELECT
        (SELECT count(*)::int FROM companies) AS companies,
        (SELECT count(*)::int FROM procurement_variance_policies) AS policies
    `);
    expect(counts.rows[0].policies).toBe(counts.rows[0].companies);

    const policy = await db.query<{ id: string }>(`
      SELECT id FROM procurement_variance_policies ORDER BY created_at LIMIT 1
    `);
    expect(policy.rows[0]?.id).toBeTruthy();
    await expect(db.query(
      `UPDATE procurement_variance_policies SET approval_reason=$2 WHERE id=$1`,
      [policy.rows[0]!.id, "Attempted rewrite"],
    )).rejects.toThrow();
  });

  it("keeps sensitive rows behind capabilities and persists retry keys", async () => {
    const migration = await readFile(
      new URL(
        "../database/migrations/061_budget_cycles_and_actual_variance.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("refresh_idempotency_key text");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("ADDITIONAL_APPROVAL_REQUIRED");
    expect(migration).toContain("PENDING_AXORA");
    expect(migration).toContain("PARTIAL_PERCENT");
    expect(migration).toContain("request_actual_lines_append_only");
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE[\s\S]*public\.request_actual_submissions[\s\S]*FROM PUBLIC/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*public\.axora_submit_request_actual/,
    );
  });
});
