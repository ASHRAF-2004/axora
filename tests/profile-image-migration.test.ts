import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../database/migrations/066_private_profile_image_lifecycle.sql", import.meta.url);

describe("private profile image lifecycle migration", () => {
  it("is additive, versioned, audited, and private by default", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.profile_image_versions/i);
    expect(sql).toMatch(/status[^;]+ACTIVE[^;]+RETIRED/is);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/audit_change/i);
  });
  it("keeps authorization, activation, removal, and reads in PostgreSQL", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/axora_activate_profile_image/i);
    expect(sql).toMatch(/axora_remove_profile_image/i);
    expect(sql).toMatch(/axora_profile_image_file/i);
    expect(sql).toMatch(/axora_lock_user_target_access/i);
    expect(sql).toMatch(/delivery_job_assignments[\s\S]+ended_at IS NULL/i);
    expect(sql).toMatch(/company_photo_display_enabled/i);
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC/i);
  });
  it("enforces delivery identity and hides deactivated accounts", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/delivery_agent_photo_required/i);
    expect(sql).toMatch(/validate_delivery_assignment/i);
    expect(sql).toMatch(/ADMINISTRATOR_DEACTIVATED|ACCOUNT_DEACTIVATED/i);
    expect(sql).toMatch(/active_avatar_version_id/i);
  });
});
