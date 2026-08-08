import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe("budget worker claim migration", () => {
  it("compiles and returns an empty lease set without an output-column ambiguity", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "062_budget_worker_claim_disambiguation.sql",
      });
      const claimed = await db.query<{ job_id: string; lease_token: string }>(`
        SELECT job_id::text,lease_token::text
        FROM public.axora_claim_budget_refresh_jobs(
          'budget-regression-worker',10,90,now()
        )
      `);
      expect(claimed.rows).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
