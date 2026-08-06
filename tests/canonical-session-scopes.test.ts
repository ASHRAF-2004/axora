import { describe, expect, it } from "vitest";
import {
  liveSessionScopeMatches,
  resolveActiveIdentityCandidates,
  sessionScopeIsValid,
  type IdentityCandidateRow,
} from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { authorize } from "@/lib/authorization-policy";

const ids = {
  user: "10000000-0000-4000-8000-000000000038",
  assignment: "20000000-0000-4000-8000-000000000038",
  company: "30000000-0000-4000-8000-000000000038",
  branch: "40000000-0000-4000-8000-000000000038",
  department: "50000000-0000-4000-8000-000000000038",
};

function candidate(
  overrides: Partial<IdentityCandidateRow> = {},
): IdentityCandidateRow {
  return {
    id: ids.user,
    email: "canonical-scope@example.test",
    displayName: "Canonical Scope",
    legacyRole: "VIEWER",
    accountKind: "COMPANY",
    isOwner: false,
    authVersion: 9,
    legacyCompanyId: ids.company,
    legacyCompanyActive: true,
    legacyCompanyMembershipStatus: "ACTIVE",
    assignmentId: ids.assignment,
    assignedRole: "AUDITOR",
    assignmentActive: true,
    assignedAt: "2026-08-06T08:00:00.000Z",
    scopeType: "COMPANY",
    companyId: ids.company,
    scopeCompanyActive: true,
    companyMembershipStatus: "ACTIVE",
    companyMembershipPrimary: true,
    ...overrides,
  };
}

describe("canonical authenticated session scopes", () => {
  it("resolves a platform account manager to one assigned active company without tenant membership", () => {
    const manager = resolveActiveIdentityCandidates([candidate({
      legacyRole: "IT_SUPPORT",
      accountKind: "PLATFORM",
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      assignedRole: "CLIENT_ACCOUNT_MANAGER",
      companyMembershipStatus: undefined,
      companyMembershipPrimary: undefined,
    })]);

    expect(manager).toMatchObject({
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      scopeType: "COMPANY",
      companyId: ids.company,
      roleAssignmentId: ids.assignment,
    });
    expect(resolveActiveIdentityCandidates([candidate({
      legacyRole: "IT_SUPPORT",
      accountKind: "PLATFORM",
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      assignedRole: "CLIENT_ACCOUNT_MANAGER",
      companyMembershipStatus: undefined,
      scopeCompanyActive: false,
    })])).toBeNull();
  });

  it("resolves department administrators and requesters only through active exact assignments", () => {
    const department = {
      scopeType: "DEPARTMENT",
      branchId: ids.branch,
      departmentId: ids.department,
      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      scopeDepartmentBranchActive: true,
      departmentAssignmentStatus: "ACTIVE",
      departmentAssignmentPrimary: true,
    } satisfies Partial<IdentityCandidateRow>;

    const administrator = resolveActiveIdentityCandidates([candidate({
      ...department,
      legacyRole: "BRANCH_ADMIN",
      assignedRole: "DEPARTMENT_ADMIN",
    })]);
    expect(administrator).toMatchObject({
      role: "DEPARTMENT_ADMIN",
      scopeType: "DEPARTMENT",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: ids.department,
    });

    const requester = resolveActiveIdentityCandidates([candidate({
      ...department,
      legacyRole: "REQUESTER",
      assignedRole: "REQUESTER",
    })]);
    expect(requester).toMatchObject({
      role: "REQUESTER",
      scopeType: "DEPARTMENT",
      departmentId: ids.department,
    });
    expect(canAccess(requester!, "create_requests")).toBe(true);
    expect(authorize({
      subject: {
        userId: requester!.id,
        role: requester!.role,
        accountKind: requester!.accountKind,
        accountStatus: "ACTIVE",
        isOwner: false,
        scopes: [{
          type: "DEPARTMENT",
          companyId: ids.company,
          branchId: ids.branch,
          departmentId: ids.department,
        }],
      },
      permission: "request.create",
      resource: {
        scope: {
          type: "DEPARTMENT",
          companyId: ids.company,
          branchId: ids.branch,
          departmentId: ids.department,
        },
      },
    }).allowed).toBe(true);

    for (const invalid of [
      candidate({ ...department, assignedRole: "DEPARTMENT_ADMIN", departmentAssignmentStatus: "SUSPENDED" }),
      candidate({ ...department, assignedRole: "DEPARTMENT_ADMIN", scopeDepartmentActive: false }),
      candidate({ ...department, assignedRole: "DEPARTMENT_ADMIN", scopeDepartmentBranchActive: false }),
      candidate({ ...department, assignedRole: "DEPARTMENT_ADMIN", scopeDepartmentBranchId: "40000000-0000-4000-8000-000000000099" }),
      candidate({ ...department, assignedRole: "DEPARTMENT_ADMIN", companyMembershipStatus: "SUSPENDED" }),
    ]) {
      expect(resolveActiveIdentityCandidates([invalid])).toBeNull();
    }
  });

  it("supports delivery supervision without a driver profile and requires an active profile for agents", () => {
    const delivery = {
      accountKind: "DELIVERY",
      legacyRole: "VIEWER",
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      scopeType: "DELIVERY",
      companyId: undefined,
      scopeCompanyActive: undefined,
      companyMembershipStatus: undefined,
    } satisfies Partial<IdentityCandidateRow>;

    expect(resolveActiveIdentityCandidates([candidate({
      ...delivery,
      assignedRole: "DELIVERY_TEAM_SUPERVISOR",
      deliveryProfileActive: undefined,
    })])).toMatchObject({
      role: "DELIVERY_TEAM_SUPERVISOR",
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    });
    expect(resolveActiveIdentityCandidates([candidate({
      ...delivery,
      assignedRole: "DELIVERY_AGENT",
      deliveryProfileActive: false,
    })])).toBeNull();
    expect(resolveActiveIdentityCandidates([candidate({
      ...delivery,
      assignedRole: "DELIVERY_AGENT",
      deliveryProfileActive: true,
    })])).toMatchObject({ role: "DELIVERY_AGENT" });
  });

  it("binds department identity into signed-session structural and live matching", () => {
    const active = resolveActiveIdentityCandidates([candidate({
      legacyRole: "BRANCH_ADMIN",
      assignedRole: "DEPARTMENT_ADMIN",
      scopeType: "DEPARTMENT",
      branchId: ids.branch,
      departmentId: ids.department,
      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      scopeDepartmentBranchActive: true,
      departmentAssignmentStatus: "ACTIVE",
    })])!;

    expect(sessionScopeIsValid(active)).toBe(true);
    expect(sessionScopeIsValid({ ...active, departmentId: undefined })).toBe(false);
    expect(sessionScopeIsValid({ ...active, supplierId: "60000000-0000-4000-8000-000000000038" })).toBe(false);
    expect(liveSessionScopeMatches(active, { ...active })).toBe(true);
    expect(liveSessionScopeMatches(active, {
      ...active,
      departmentId: "50000000-0000-4000-8000-000000000099",
    })).toBe(false);
  });
});
