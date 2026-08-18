import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const appearanceMigrationUrl = new URL(
  "../database/migrations/099_unified_user_appearance.sql",
  import.meta.url,
);

describe("immersive world V2 database boundaries", () => {
  it("installs least-privilege appearance preferences, driver claim, recovery and deletion capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      const result = await db.query<{
        preference_rls: boolean; legacy_preference_rls: boolean; direct_appearance: boolean;
        appearance_get_execute: boolean; appearance_set_execute: boolean;
        tombstone_rls: boolean; direct_profile: boolean;
        claim_execute: boolean; release_execute: boolean; deletion_v1_execute: boolean;
        deletion_v2_execute: boolean; deletion_preview_execute: boolean;
        direct_operational_check: boolean; customer_reference: boolean;
      }>(`
        SELECT
          (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='user_appearance_preferences') AS preference_rls,
          (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='user_atmosphere_preferences') AS legacy_preference_rls,
          has_table_privilege('axora_app','user_appearance_preferences','SELECT') AS direct_appearance,
          has_function_privilege('axora_app','axora_get_user_appearance(uuid,timestamptz)','EXECUTE') AS appearance_get_execute,
          has_function_privilege('axora_app','axora_set_user_appearance(uuid,text,timestamptz)','EXECUTE') AS appearance_set_execute,
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
      expect(result.rows[0]).toEqual({
        preference_rls: true,
        legacy_preference_rls: true,
        direct_appearance: false,
        appearance_get_execute: true,
        appearance_set_execute: true,
        tombstone_rls: true,
        direct_profile: false,
        claim_execute: true,
        release_execute: true,
        deletion_v1_execute: false,
        deletion_v2_execute: true,
        deletion_preview_execute: true,
        direct_operational_check: false,
        customer_reference: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("defines deterministic legacy conversion and a narrow transition bridge", async () => {
    const sql = await readFile(appearanceMigrationUrl, "utf8");

    expect(sql).toContain("appearance text NOT NULL CHECK (appearance IN ('light','dark'))");
    expect(sql).toContain("WHEN 'Aurora' THEN 'light'");
    expect(sql).toContain("WHEN 'Solar' THEN 'light'");
    expect(sql).toContain("WHEN 'Ember' THEN 'light'");
    expect(sql).toContain("WHEN 'Midnight' THEN 'dark'");
    expect(sql).toContain("ALTER TABLE public.user_appearance_preferences ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.user_appearance_preferences FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.user_appearance_preferences FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON public.user_appearance_preferences FROM axora_app");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.axora_get_user_appearance");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.axora_set_user_appearance");
    expect(sql).toContain("p_appearance IS NULL OR p_appearance NOT IN ('light','dark')");
    expect(sql).toContain("CREATE TRIGGER mirror_legacy_atmosphere_preference");
    expect(sql).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.user_atmosphere_preferences");
    expect(sql).toContain("DELETE FROM public.user_appearance_preferences WHERE user_id=OLD.user_id");
  });
});
