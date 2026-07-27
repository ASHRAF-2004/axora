import { describe, expect, it } from "vitest";
import { canAccess, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

describe("customer role permissions", () => {
  const expected: Record<UserRole, Permission[]> = {
    ADMIN: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "manage_branches", "manage_branch_budget", "create_requests", "view_approvals", "approve_requests", "view_invoices", "view_documents", "manage_documents", "view_reports", "view_audit", "manage_users", "manage_settings"],
    BRANCH_ADMIN: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_approvals", "approve_requests", "view_invoices", "view_documents", "manage_documents", "view_reports", "manage_users"],
    APPROVER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_approvals", "approve_requests", "view_documents", "manage_documents", "view_reports"],
    REQUESTER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_documents", "manage_documents"],
    OPERATIONS: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_documents", "manage_documents"],
    FINANCE: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "view_documents", "manage_documents", "view_reports"],
    VIEWER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "view_documents", "view_reports", "view_audit"],
    IT_SUPPORT: ["manage_settings"],
  };

  const allPermissions: Permission[] = [
    "view_dashboard",
    "view_catalog",
    "view_requests",
    "view_deliveries",
    "view_branches",
    "manage_companies",
    "manage_catalog",
    "manage_suppliers",
    "manage_branches",
    "manage_branch_budget",
    "create_requests",
    "view_approvals",
    "approve_requests",
    "manage_sourcing",
    "manage_deliveries",
    "view_invoices",
    "manage_finance",
    "view_documents",
    "manage_documents",
    "view_reports",
    "view_audit",
    "manage_users",
    "manage_settings",
  ];

  for (const [role, allowed] of Object.entries(expected) as Array<[UserRole, Permission[]]>) {
    it(`grants only the intended ${role} capabilities`, () => {
      for (const permission of allPermissions) {
        expect(canAccess({ role, isOwner: false }, permission), `${role} / ${permission}`).toBe(allowed.includes(permission));
      }
    });
  }

  it("keeps platform owners out of customer request approval and branch budgets", () => {
    const owner = { role: "ADMIN" as const, isOwner: true };
    expect(canAccess(owner, "manage_catalog")).toBe(true);
    expect(canAccess(owner, "manage_suppliers")).toBe(true);
    expect(canAccess(owner, "manage_sourcing")).toBe(true);
    expect(canAccess(owner, "create_requests")).toBe(false);
    expect(canAccess(owner, "approve_requests")).toBe(false);
    expect(canAccess(owner, "manage_branch_budget")).toBe(false);
  });

  it("does not expose company-wide audit history to a branch-scoped account", () => {
    expect(canAccess({ role: "VIEWER", isOwner: false, branchId: "branch-1" }, "view_audit")).toBe(false);
  });
});
