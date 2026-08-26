import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/121_e164_phone_write_boundary.sql",
  import.meta.url,
);
const profileId = "a2100000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

describe.sequential("E.164 phone write boundary migration", () => {
  let db: PGlite;
  let migration: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "120_cam_customer_invoice_access.sql" });
    await applyDemoSeed(db);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,'phone-boundary@example.test','Phone boundary fixture',
        'not-a-real-hash',id,true,now(),now(),'PLATFORM','ACTIVE',true,1
      FROM roles WHERE role_key='PLATFORM_OWNER'
    `, [profileId]);
    await db.query(`
      INSERT INTO user_profiles(user_id,display_name,phone,preferred_locale,timezone)
      VALUES ($1,'Phone boundary fixture','03 legacy profile','en','Asia/Kuala_Lumpur')
    `, [profileId]);
    await db.query("UPDATE branches SET contact_phone='03 legacy branch' WHERE id=$1", [branchId]);
    migration = await readFile(migrationUrl, "utf8");
    await db.exec(migration);
  }, 45_000);

  afterAll(async () => { await db.close(); });

  it("preserves legacy rows and permits unrelated updates without a backfill", async () => {
    await expect(db.query(
      "UPDATE user_profiles SET timezone=timezone WHERE user_id=$1",
      [profileId],
    )).resolves.not.toThrow();
    await expect(db.query(
      "UPDATE branches SET city=city WHERE id=$1",
      [branchId],
    )).resolves.not.toThrow();
    await expect(db.query(
      "UPDATE user_profiles SET phone=phone WHERE user_id=$1",
      [profileId],
    )).resolves.not.toThrow();
    const legacy = await db.query<{ profile: string; branch: string }>(`
      SELECT
        (SELECT phone FROM user_profiles WHERE user_id=$1) AS profile,
        (SELECT contact_phone FROM branches WHERE id=$2) AS branch
    `, [profileId, branchId]);
    expect(legacy.rows[0]).toEqual({
      profile: "03 legacy profile",
      branch: "03 legacy branch",
    });
  });

  it("rejects changed noncanonical values and accepts canonical E.164", async () => {
    await expect(db.query(
      "UPDATE user_profiles SET phone='letters' WHERE user_id=$1",
      [profileId],
    )).rejects.toThrow(/canonical E\.164/);
    await expect(db.query(
      "UPDATE branches SET contact_phone='+60 +60 12' WHERE id=$1",
      [branchId],
    )).rejects.toThrow(/canonical E\.164/);
    await db.query("UPDATE user_profiles SET phone='+12025550123' WHERE user_id=$1", [profileId]);
    await db.query("UPDATE branches SET contact_phone='+12025550124' WHERE id=$1", [branchId]);
    const canonical = await db.query<{ profile: string; branch: string }>(`
      SELECT
        (SELECT phone FROM user_profiles WHERE user_id=$1) AS profile,
        (SELECT contact_phone FROM branches WHERE id=$2) AS branch
    `, [profileId, branchId]);
    expect(canonical.rows[0]).toEqual({
      profile: "+12025550123",
      branch: "+12025550124",
    });
  });

  it("keeps trigger helpers private, search paths bounded and application-role writes functional", async () => {
    const state = await db.query<{
      app_profile_trigger_execute: boolean;
      public_profile_trigger_execute: boolean;
      trigger_count: number;
      unsafe_path_count: number;
    }>(`
      SELECT
        has_function_privilege('axora_app','public.axora_enforce_profile_phone_e164()','EXECUTE')
          AS app_profile_trigger_execute,
        has_function_privilege('public','public.axora_enforce_profile_phone_e164()','EXECUTE')
          AS public_profile_trigger_execute,
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN ('user_profiles_phone_e164','branches_contact_phone_e164')
            AND NOT tgisinternal) AS trigger_count,
        (SELECT count(*)::int FROM pg_proc procedure
          JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname='public'
            AND procedure.proname IN (
              'axora_enforce_profile_phone_e164',
              'axora_enforce_branch_phone_e164'
            )
            AND NOT EXISTS (
              SELECT 1 FROM unnest(COALESCE(procedure.proconfig,ARRAY[]::text[])) setting
              WHERE setting LIKE 'search_path=%'
            )) AS unsafe_path_count
    `);
    expect(state.rows[0]).toEqual({
      app_profile_trigger_execute: false,
      public_profile_trigger_execute: false,
      trigger_count: 2,
      unsafe_path_count: 0,
    });

    await db.exec(`
      CREATE TABLE phone_trigger_probe(phone text NOT NULL);
      CREATE TRIGGER phone_trigger_probe_e164
        BEFORE INSERT OR UPDATE OF phone ON phone_trigger_probe
        FOR EACH ROW EXECUTE FUNCTION public.axora_enforce_profile_phone_e164();
      GRANT SELECT,INSERT,UPDATE ON phone_trigger_probe TO axora_app;
      SET ROLE axora_app;
      INSERT INTO phone_trigger_probe(phone) VALUES ('+12025550125');
      RESET ROLE;
    `);
    await expect(db.exec(`
      SET ROLE axora_app;
      INSERT INTO phone_trigger_probe(phone) VALUES ('not-e164');
    `)).rejects.toThrow(/canonical E\.164/);
    await db.exec("RESET ROLE");
    await expect(db.exec(migration)).resolves.not.toThrow();
  });
});
