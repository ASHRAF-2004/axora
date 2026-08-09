import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../database/migrations/067_reviewed_company_branding.sql",
  import.meta.url,
);

describe("reviewed company branding migration", () => {
  it("adds an explicit human workflow and preserves existing publication", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/REVIEW_REQUIRED[^;]+APPROVED[^;]+PUBLISHED/is);
    expect(sql).toMatch(/Preserved previously published company branding/i);
    expect(sql).toMatch(/company_brand_theme_events/i);
    expect(sql).toMatch(/append-only/i);
  });

  it("keeps live authorization and publication in PostgreSQL", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/axora_live_authorization_snapshot/i);
    expect(sql).toMatch(/axora_company_actor_has_permission/i);
    expect(sql).toMatch(/company\.portal\.preview/i);
    expect(sql).toMatch(/company\.portal\.publish/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(/axora_transition_company_brand_theme/i);
    expect(sql).toMatch(/axora_rollback_company_brand_theme/i);
  });

  it("enforces least privilege, RLS, immutability, and safe components", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE/i);
    expect(sql).toMatch(/Company brand theme evidence is immutable/i);
    expect(sql).toMatch(/requestSummary[^;]+budgetSummary[^;]+recentActivity/is);
    expect(sql).not.toMatch(/dangerouslySetInnerHTML|<script/i);
  });
});
