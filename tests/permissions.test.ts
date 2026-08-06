import { describe, expect, it } from "vitest";
import { canAccess, type AccessSubject, type Permission } from "@/lib/permissions";
import type { LegacyUserRole } from "@/lib/types";

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
  "manage_commercial_pricing",
  "view_system_diagnostics",
  "view_supplier_portal",
  "respond_to_rfqs",
  "view_delivery_portal",
  "update_assigned_deliveries",
  "view_receiving",
  "confirm_receipts",
  "review_three_way_matches",
];

function expectExactPermissions(subject: AccessSubject, allowed: Permission[]) {
  for (const permission of allPermissions) {
    expect(
      canAccess(subject, permission),
      `${subject.role} / ${permission}`,
    ).toBe(allowed.includes(permission));
  }
}

describe("legacy customer role permissions", () => {
  const expected: Record<LegacyUserRole, Permission[]> = {
    ADMIN: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "manage_branches", "manage_branch_budget", "create_requests", "view_approvals", "approve_requests", "view_invoices", "view_documents", "manage_documents", "view_reports", "view_audit", "manage_users", "manage_settings"],
    BRANCH_ADMIN: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_approvals", "approve_requests", "view_invoices", "view_documents", "manage_documents", "view_reports", "manage_users"],
    APPROVER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_approvals", "approve_requests", "view_documents", "manage_documents", "view_reports"],
    REQUESTER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_documents", "manage_documents"],
    OPERATIONS: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "create_requests", "view_documents", "manage_documents"],
    FINANCE: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "view_documents", "manage_documents", "view_reports"],
    VIEWER: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "view_documents", "view_reports", "view_audit"],
    IT_SUPPORT: ["view_system_diagnostics"],
  };

  for (const [role, allowed] of Object.entries(expected) as Array<[
    LegacyUserRole,
    Permission[],
  ]>) {
    it(`preserves the deployed ${role} capabilities`, () => {
      expectExactPermissions({ role, isOwner: false }, allowed);
    });
  }

  it("keeps the legacy platform owner out of tenant approval and budgets", () => {
    const owner = { role: "ADMIN" as const, isOwner: true };
    expect(canAccess(owner, "manage_catalog")).toBe(true);
    expect(canAccess(owner, "manage_suppliers")).toBe(true);
    expect(canAccess(owner, "manage_sourcing")).toBe(true);
    expect(canAccess(owner, "create_requests")).toBe(false);
    expect(canAccess(owner, "approve_requests")).toBe(false);
    expect(canAccess(owner, "manage_branch_budget")).toBe(false);
  });

  it("does not expose company-wide audit history to a branch-scoped account", () => {
    expect(canAccess(
      { role: "VIEWER", isOwner: false, branchId: "branch-1" },
      "view_audit",
    )).toBe(false);
  });
});

describe("normalized least-privilege permissions", () => {
  const companyId = "company-1";
  const branchId = "branch-1";
  const supplierId = "supplier-1";
  const cases: Array<{
    subject: AccessSubject;
    allowed: Permission[];
  }> = [
    {
      subject: {
        role: "PLATFORM_OWNER",
        isOwner: true,
        accountKind: "PLATFORM",
        scopeType: "PLATFORM",
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "manage_companies", "manage_catalog", "manage_suppliers", "manage_branches", "manage_sourcing", "manage_deliveries", "view_invoices", "manage_finance", "view_documents", "manage_documents", "view_reports", "view_audit", "manage_users", "manage_settings", "manage_commercial_pricing", "view_system_diagnostics", "view_receiving", "review_three_way_matches"],
    },
    {
      subject: {
        role: "PLATFORM_OPERATIONS",
        isOwner: false,
        accountKind: "PLATFORM",
        scopeType: "PLATFORM",
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "manage_catalog", "manage_suppliers", "manage_sourcing", "manage_deliveries", "view_documents", "manage_documents", "view_reports", "view_receiving"],
    },
    {
      subject: {
        role: "COMPANY_ADMIN",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "COMPANY",
        companyId,
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "manage_branches", "manage_branch_budget", "view_approvals", "approve_requests", "view_invoices", "view_documents", "manage_documents", "view_reports", "view_audit", "manage_users", "manage_settings"],
    },
    {
      subject: {
        role: "BRANCH_APPROVER",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "BRANCH",
        companyId,
        branchId,
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_approvals", "approve_requests", "view_documents", "view_reports"],
    },
    {
      subject: {
        role: "COMPANY_APPROVER",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "COMPANY",
        companyId,
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_approvals", "approve_requests", "view_documents", "view_reports"],
    },
    {
      subject: {
        role: "FINANCE_REVIEWER",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "COMPANY",
        companyId,
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "manage_finance", "view_documents", "view_reports", "review_three_way_matches"],
    },
    {
      subject: {
        role: "AUDITOR",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "COMPANY",
        companyId,
      },
      allowed: ["view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches", "view_invoices", "view_documents", "view_reports", "view_audit"],
    },
    {
      subject: {
        role: "TECHNICAL_SUPPORT",
        isOwner: false,
        accountKind: "PLATFORM",
        scopeType: "PLATFORM",
      },
      allowed: ["view_system_diagnostics"],
    },
    {
      subject: {
        role: "SUPPLIER_USER",
        isOwner: false,
        accountKind: "SUPPLIER",
        scopeType: "SUPPLIER",
        supplierId,
      },
      allowed: ["view_supplier_portal", "respond_to_rfqs"],
    },
    {
      subject: {
        role: "DELIVERY_DRIVER",
        isOwner: false,
        accountKind: "DELIVERY",
        scopeType: "DELIVERY",
      },
      allowed: ["view_delivery_portal", "update_assigned_deliveries"],
    },
    {
      subject: {
        role: "RECEIVING_USER",
        isOwner: false,
        accountKind: "COMPANY",
        scopeType: "BRANCH",
        companyId,
        branchId,
      },
      allowed: ["view_receiving", "confirm_receipts"],
    },
  ];

  for (const { subject, allowed } of cases) {
    it(`grants only the ${subject.role} capability set`, () => {
      expectExactPermissions(subject, allowed);
    });
  }

  it("fails closed for unknown roles, including forged owners", () => {
    expect(canAccess({ role: "SUPER_ADMIN", isOwner: false }, "view_dashboard"))
      .toBe(false);
    expect(canAccess({ role: "SUPER_ADMIN", isOwner: true }, "manage_companies"))
      .toBe(false);
  });

  it("fails closed for incomplete or structurally inconsistent scopes", () => {
    const invalidSubjects: AccessSubject[] = [
      { role: "PLATFORM_OWNER", isOwner: false, accountKind: "PLATFORM", scopeType: "PLATFORM" },
      { role: "PLATFORM_OPERATIONS", isOwner: false, accountKind: "PLATFORM", scopeType: "PLATFORM", companyId },
      { role: "COMPANY_ADMIN", isOwner: false, accountKind: "COMPANY", scopeType: "COMPANY", companyId, branchId },
      { role: "BRANCH_ADMIN", isOwner: false, accountKind: "COMPANY", scopeType: "COMPANY", companyId },
      { role: "REQUESTER", isOwner: false, accountKind: "COMPANY", scopeType: "BRANCH", companyId },
      { role: "BRANCH_APPROVER", isOwner: false, accountKind: "COMPANY", scopeType: "BRANCH", companyId },
      { role: "SUPPLIER_USER", isOwner: false, accountKind: "SUPPLIER", scopeType: "SUPPLIER", supplierId, companyId },
      { role: "DELIVERY_DRIVER", isOwner: false, accountKind: "DELIVERY", scopeType: "DELIVERY", supplierId },
      { role: "IT_SUPPORT", isOwner: false, accountKind: "PLATFORM", scopeType: "PLATFORM", companyId },
    ];
    for (const subject of invalidSubjects) {
      for (const permission of allPermissions) {
        expect(canAccess(subject, permission), `${subject.role} / ${permission}`)
          .toBe(false);
      }
    }
  });
});

describe("new canonical role compatibility permissions", () => {
  const companyId = "company-1";
  const branchId = "branch-1";
  const departmentId = "department-1";

  it("scopes a client account manager to one assigned company", () => {
    expectExactPermissions({
      role: "CLIENT_ACCOUNT_MANAGER",
      isOwner: false,
      accountKind: "PLATFORM",
      scopeType: "COMPANY",
      companyId,
    }, [
      "view_dashboard",
      "view_catalog",
      "view_requests",
      "view_deliveries",
      "view_branches",
      "manage_companies",
      "view_documents",
      "view_reports",
      "manage_users",
    ]);
  });

  it("scopes a department administrator to one department", () => {
    expectExactPermissions({
      role: "DEPARTMENT_ADMIN",
      isOwner: false,
      accountKind: "COMPANY",
      scopeType: "DEPARTMENT",
      companyId,
      branchId,
      departmentId,
    }, [
      "view_dashboard",
      "view_catalog",
      "view_requests",
      "view_deliveries",
      "view_branches",
      "create_requests",
      "view_approvals",
      "approve_requests",
      "view_documents",
      "manage_documents",
      "view_reports",
      "manage_users",
    ]);
  });

  it("separates delivery supervision from delivery-agent updates", () => {
    expectExactPermissions({
      role: "DELIVERY_TEAM_SUPERVISOR",
      isOwner: false,
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    }, [
      "view_dashboard",
      "view_deliveries",
      "manage_deliveries",
      "view_reports",
      "view_delivery_portal",
      "update_assigned_deliveries",
    ]);
    expectExactPermissions({
      role: "DELIVERY_AGENT",
      isOwner: false,
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    }, [
      "view_delivery_portal",
      "update_assigned_deliveries",
    ]);
  });

  it("fails closed when a new role carries a structurally wrong scope", () => {
    expect(canAccess({
      role: "CLIENT_ACCOUNT_MANAGER",
      isOwner: false,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    }, "manage_companies")).toBe(false);
    expect(canAccess({
      role: "DEPARTMENT_ADMIN",
      isOwner: false,
      accountKind: "COMPANY",
      scopeType: "DEPARTMENT",
      companyId,
    }, "create_requests")).toBe(false);
  });
});
