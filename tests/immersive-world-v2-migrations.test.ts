import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

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

  it("converts every legacy value and mirrors deployment-window legacy writes", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db, { through: "098_role_template_permission_selection.sql" });
      await applyDemoSeed(db);

      const users = await db.query<{ id: string }>(
        "SELECT id::text AS id FROM public.users ORDER BY email LIMIT 4",
      );
      expect(users.rows).toHaveLength(4);
      const legacy = ["Aurora", "Solar", "Ember", "Midnight"] as const;
      for (const [index, atmosphere] of legacy.entries()) {
        await db.query(
          `INSERT INTO public.user_atmosphere_preferences(user_id,atmosphere,updated_at)
           VALUES ($1,$2,now())`,
          [users.rows[index].id, atmosphere],
        );
      }

      await db.exec(await readFile(appearanceMigrationUrl, "utf8"));

      const converted = await db.query<{ appearance: string }>(`
        SELECT appearance
        FROM public.user_appearance_preferences
        WHERE user_id = ANY($1::uuid[])
        ORDER BY array_position($1::uuid[], user_id)
      `, [users.rows.map((user) => user.id)]);
      expect(converted.rows.map((row) => row.appearance)).toEqual([
        "light", "light", "light", "dark",
      ]);

      await db.query(
        "UPDATE public.user_atmosphere_preferences SET atmosphere='Midnight',updated_at=now() WHERE user_id=$1",
        [users.rows[0].id],
      );
      const mirrored = await db.query<{ appearance: string }>(
        "SELECT appearance FROM public.user_appearance_preferences WHERE user_id=$1",
        [users.rows[0].id],
      );
      expect(mirrored.rows[0]?.appearance).toBe("dark");

      await expect(db.query(
        "SELECT public.axora_set_user_appearance($1,$2,now())",
        [users.rows[0].id, "system"],
      )).rejects.toThrow();

      const setResult = await db.query<{ appearance: string }>(
        "SELECT public.axora_set_user_appearance($1,'light',now()) AS appearance",
        [users.rows[0].id],
      );
      expect(setResult.rows[0]?.appearance).toBe("light");

      await db.query(
        "DELETE FROM public.user_atmosphere_preferences WHERE user_id=$1",
        [users.rows[0].id],
      );
      const deleted = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.user_appearance_preferences WHERE user_id=$1",
        [users.rows[0].id],
      );
      expect(deleted.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
