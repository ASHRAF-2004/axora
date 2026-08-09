import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
import { applyDemoSeed,applyMigrations } from "./helpers/pglite";

const migrationUrl=new URL("../database/migrations/065_permission_scoped_procurement_discovery.sql",import.meta.url);

describe("procurement discovery migration",() => {
  it("adds query indexes without rewriting populated procurement records",async () => {
    const db=new PGlite();
    try {
      await applyMigrations(db,{through:"064_versioned_generated_documents.sql"});
      await applyDemoSeed(db);
      const before=await db.query<{requests:number;lines:number;products:number}>(`SELECT (SELECT count(*)::int FROM requests) requests,(SELECT count(*)::int FROM request_lines) lines,(SELECT count(*)::int FROM products) products`);
      await db.exec(await readFile(migrationUrl,"utf8"));
      const after=await db.query<{requests:number;lines:number;products:number;indexes:number}>(`SELECT (SELECT count(*)::int FROM requests) requests,(SELECT count(*)::int FROM request_lines) lines,(SELECT count(*)::int FROM products) products,(SELECT count(*)::int FROM pg_indexes WHERE indexname IN ('requests_filter_scope_date_idx','requests_filter_cost_centre_idx','requests_filter_requester_idx','requests_filter_needed_by_idx','requests_filter_submitted_idx','requests_filter_approved_idx','requests_filter_completed_idx','request_lines_filter_category_idx','request_lines_filter_supplier_idx','request_lines_filter_product_name_idx','approvals_filter_reviewer_idx','request_escalations_filter_idx','delivery_jobs_filter_request_idx','delivery_assignments_filter_driver_idx')) indexes`);
      expect(after.rows[0]).toEqual({...before.rows[0],indexes:14});
    } finally { await db.close(); }
  },30_000);

  it("applies on an empty and current database",async () => {
    const db=new PGlite();
    try {
      const applied=await applyMigrations(db);
      expect(applied.at(-1)).toBe("066_private_profile_image_lifecycle.sql");
    } finally { await db.close(); }
  },30_000);
});
