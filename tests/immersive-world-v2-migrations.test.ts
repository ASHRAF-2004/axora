import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe("immersive world V2 database boundaries", () => {
  it("installs least-privilege staff preferences, driver claim, recovery and deletion capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      const result = await db.query<{
        preference_rls: boolean; tombstone_rls: boolean; direct_profile: boolean;
        claim_execute: boolean; release_execute: boolean; deletion_v1_execute: boolean;
        deletion_v2_execute: boolean; deletion_preview_execute: boolean;
        direct_operational_check: boolean; customer_reference: boolean;
      }>(`
        SELECT
          (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='user_atmosphere_preferences') AS preference_rls,
          (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='company_deletion_tombstones') AS tombstone_rls,
          has_table_privilege('axora_app','delivery_agent_profiles','SELECT') AS direct_profile,
          has_function_privilege('axora_app','axora_claim_available_delivery_job(uuid,uuid,uuid,uuid,timestamptz)','EXECUTE') AS claim_execute,
          has_function_privilege('axora_app','axora_release_stuck_delivery_job(uuid,uuid,uuid,uuid,text,timestamptz)','EXECUTE') AS release_execute,
          has_function_privilege('axora_app','axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz)','EXECUTE') AS deletion_v1_execute,
          has_function_privilege('axora_app','axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz)','EXECUTE') AS deletion_v2_execute,
          has_function_privilege('axora_app','axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz)','EXECUTE') AS deletion_preview_execute,
          has_function_privilege('axora_app','axora_company_is_operational(uuid)','EXECUTE') AS direct_operational_check,
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='public_reference' AND is_nullable='NO') AS customer_reference
      `);
      expect(result.rows[0]).toEqual({ preference_rls: true, tombstone_rls: true, direct_profile: false, claim_execute: true, release_execute: true, deletion_v1_execute: false, deletion_v2_execute: true, deletion_preview_execute: true, direct_operational_check: false, customer_reference: true });
    } finally {
      await db.close();
    }
  }, 30_000);
});
