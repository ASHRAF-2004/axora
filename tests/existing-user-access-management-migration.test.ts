import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "database/migrations/101_existing_user_access_management.sql";

async function migration() {
  return readFile(migrationPath, "utf8");
}

describe("Prompt 5 existing-user access management migration", () => {
  it("adds one atomic replacement capability without changing migration 100", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.axora_replace_user_role_scope");
    expect(sql).toContain("INSERT INTO public.role_assignments");
    expect(sql).toContain("UPDATE public.role_assignments");
    expect(sql).toContain("ROLE_REVOKED");
    expect(sql).toContain("ROLE_ASSIGNED");
    expect(sql).toContain("axora_invalidate_authorization_sessions");
    expect(sql).toContain("account_setup_invitations");
    expect(sql).toContain("CANCELLED");
    expect(sql).toContain("Cross-account-kind role conversion is unavailable");
  });

  it("reuses an existing matching assignment instead of accumulating duplicate live roles", async () => {
    const sql = await migration();
    expect(sql).toContain("existing_matching_assignment_id");
    expect(sql).toContain("assignment.id<>p_current_role_assignment_id");
    expect(sql).toContain("reusedExistingAssignment");
  });

  it("retires stale branch and department membership only when no live role still references it", async () => {
    const sql = await migration();
    expect(sql).toContain("UPDATE public.department_assignments department_assignment");
    expect(sql).toContain("SET status='ENDED'");
    expect(sql).toContain("role_assignment.scope_type='DEPARTMENT'");
    expect(sql).toContain("UPDATE public.branch_assignments branch_assignment");
    expect(sql).toContain("role_assignment.scope_type IN ('BRANCH','DEPARTMENT')");
  });

  it("reconciles the three Prompt 4 catalogue regressions without reviving historical roles", async () => {
    const sql = await migration();
    expect(sql).toContain("('PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT','PLATFORM')");
    expect(sql).toContain("('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','PLATFORM')");
    expect(sql).toContain("('PLATFORM_OWNER','DELIVERY_GUY','DELIVERY')");
    expect(sql).not.toMatch(/\('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','COMPANY'\)/);
    const canonicalGuard = sql.slice(
      sql.indexOf("IF p_role_key NOT IN"),
      sql.indexOf("SELECT history.* INTO existing_command"),
    );
    expect(canonicalGuard).not.toContain("PLATFORM_OPERATIONS");
    expect(canonicalGuard).not.toContain("FINANCE_REVIEWER");
    expect(canonicalGuard).not.toContain("DELIVERY_AGENT");
  });

  it("keeps pending administration separate from live authentication", async () => {
    const sql = await migration();
    expect(sql).toContain("axora_pending_access_administration_snapshot");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.axora_effective_access_snapshot");
    expect(sql).toContain("account.account_status IN ('INVITED','SUSPENDED')");
    expect(sql).toContain("setupCompleted");
  });

  it("validates organization relationships and preserves Delivery Guy identity", async () => {
    const sql = await migration();
    expect(sql).toContain("branch.id=p_branch_id AND branch.company_id=p_company_id");
    expect(sql).toContain("department_branch_id IS DISTINCT FROM p_branch_id");
    expect(sql).toContain("delivery_agent_profiles");
    expect(sql).toContain("p_role_key='DELIVERY_GUY'");
  });
});
