import { describe, expect, it } from "vitest";
import {
  liveSessionScopeMatches,
  resolveActiveIdentityCandidates,
  sessionScopeIsValid,
  type IdentityCandidateRow,
} from "@/lib/auth";

const companyOne = "10000000-0000-4000-8000-000000000001";
const companyTwo = "10000000-0000-4000-8000-000000000002";
const branchOne = "20000000-0000-4000-8000-000000000001";

function companyCandidate(
  overrides: Partial<IdentityCandidateRow> = {},
): IdentityCandidateRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "person@example.test",
    displayName: "Person",
    legacyRole: "VIEWER",
    accountKind: "COMPANY",
    isOwner: false,
    authVersion: 3,
    legacyCompanyId: companyOne,
    legacyCompanyActive: true,
    legacyCompanyMembershipStatus: "ACTIVE",
    assignmentId: "40000000-0000-4000-8000-000000000001",
    assignedRole: "AUDITOR",
    assignmentActive: true,
    assignedAt: "2026-08-01T00:00:00.000Z",
    scopeType: "COMPANY",
    companyId: companyOne,
    scopeCompanyActive: true,
    companyMembershipStatus: "ACTIVE",
    companyMembershipPrimary: true,
    ...overrides,
  };
}

describe("active normalized identity resolution", () => {
  it("returns the canonical assignment and structural tenant scope", () => {
    expect(resolveActiveIdentityCandidates([companyCandidate()])).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      email: "person@example.test",
      name: "Person",
      role: "AUDITOR",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      roleAssignmentId: "40000000-0000-4000-8000-000000000001",
      companyId: companyOne,
      isOwner: false,
      authVersion: 3,
    });
  });

  it("never falls back to legacy access after assignment history exists", () => {
    expect(resolveActiveIdentityCandidates([
      companyCandidate({ assignmentActive: false, assignmentRevokedAt: "2026-08-02" }),
    ])).toBeNull();
    expect(resolveActiveIdentityCandidates([
      companyCandidate({ assignmentActive: true, assignmentRevokedAt: "2026-08-02" }),
    ])).toBeNull();
  });

  it("rejects suspended companies, memberships, branches and branch assignments", () => {
    const branch = {
      scopeType: "BRANCH",
      branchId: branchOne,
      assignedRole: "BRANCH_APPROVER",
      legacyRole: "APPROVER",
      scopeBranchActive: true,
      branchAssignmentStatus: "ACTIVE",
    } satisfies Partial<IdentityCandidateRow>;
    const invalidRows = [
      companyCandidate({ scopeCompanyActive: false }),
      companyCandidate({ companyMembershipStatus: "SUSPENDED" }),
      companyCandidate({ ...branch, scopeBranchActive: false }),
      companyCandidate({ ...branch, branchAssignmentStatus: "SUSPENDED" }),
    ];
    for (const row of invalidRows) {
      expect(resolveActiveIdentityCandidates([row])).toBeNull();
    }
  });

  it("admits only the activated Company Administrator before Company activation", () => {
    expect(resolveActiveIdentityCandidates([companyCandidate({
      legacyRole: "ADMIN",
      assignedRole: "COMPANY_ADMIN",
      scopeCompanyActive: false,
      scopeCompanyLifecycleStatus: "COMPANY_ADMINISTRATOR_ACTIVATED",
    })])).toMatchObject({
      role: "COMPANY_ADMIN",
      companyId: companyOne,
      scopeType: "COMPANY",
    });
    expect(resolveActiveIdentityCandidates([companyCandidate({
      assignedRole: "COMPANY_APPROVER",
      scopeCompanyActive: false,
      scopeCompanyLifecycleStatus: "COMPANY_ADMINISTRATOR_ACTIVATED",
    })])).toBeNull();
  });

  it("does not reuse one tenant's legacy membership for another tenant", () => {
    const crossTenant = companyCandidate({
      companyId: companyTwo,
      scopeCompanyActive: true,
      companyMembershipStatus: undefined,
    });
    expect(crossTenant.legacyCompanyId).toBe(companyOne);
    expect(resolveActiveIdentityCandidates([crossTenant])).toBeNull();
  });

  it("rejects a branch that is not joined through its assignment company", () => {
    expect(resolveActiveIdentityCandidates([
      companyCandidate({
        scopeType: "BRANCH",
        branchId: branchOne,
        assignedRole: "BRANCH_APPROVER",
        legacyRole: "APPROVER",
        scopeBranchActive: undefined,
        branchAssignmentStatus: "ACTIVE",
      }),
    ])).toBeNull();
  });

  it("rejects the removed supplier actor even with an exact active membership", () => {
    const supplier = companyCandidate({
      legacyRole: "VIEWER",
      accountKind: "SUPPLIER",
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      assignedRole: "SUPPLIER_USER",
      scopeType: "SUPPLIER",
      companyId: undefined,
      scopeCompanyActive: undefined,
      companyMembershipStatus: undefined,
      supplierId: "30000000-0000-4000-8000-000000000001",
      scopeSupplierActive: true,
      supplierMembershipStatus: "ACTIVE",
    });
    expect(resolveActiveIdentityCandidates([supplier])).toBeNull();
  });

  it("supports only active delivery profiles for company-less driver accounts", () => {
    const driver = companyCandidate({
      legacyRole: "VIEWER",
      accountKind: "DELIVERY",
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      assignedRole: "DELIVERY_DRIVER",
      scopeType: "DELIVERY",
      companyId: undefined,
      scopeCompanyActive: undefined,
      companyMembershipStatus: undefined,
      deliveryProfileActive: true,
    });
    expect(resolveActiveIdentityCandidates([driver])).toMatchObject({
      role: "DELIVERY_DRIVER",
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    });
    expect(resolveActiveIdentityCandidates([
      { ...driver, deliveryProfileActive: false },
    ])).toBeNull();
  });

  it("supports canonical platform accounts without a company", () => {
    const owner = companyCandidate({
      legacyRole: "ADMIN",
      accountKind: "PLATFORM",
      isOwner: true,
      legacyCompanyId: undefined,
      legacyCompanyActive: undefined,
      legacyCompanyMembershipStatus: undefined,
      assignedRole: "PLATFORM_OWNER",
      scopeType: "PLATFORM",
      companyId: undefined,
      scopeCompanyActive: undefined,
      companyMembershipStatus: undefined,
    });
    expect(resolveActiveIdentityCandidates([owner])).toMatchObject({
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: true,
    });

    const support = {
      ...owner,
      legacyRole: "IT_SUPPORT",
      isOwner: false,
      assignedRole: "TECHNICAL_SUPPORT",
    };
    expect(resolveActiveIdentityCandidates([support])).toMatchObject({
      role: "TECHNICAL_SUPPORT",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: false,
    });
  });

  it("fails closed for unknown roles and role/account/scope mismatches", () => {
    const invalidRows = [
      companyCandidate({ assignedRole: "SUPER_ADMIN" }),
      companyCandidate({ assignedRole: "SUPPLIER_USER" }),
      companyCandidate({ assignedRole: "COMPANY_ADMIN", scopeType: "BRANCH", branchId: branchOne, scopeBranchActive: true, branchAssignmentStatus: "ACTIVE" }),
      companyCandidate({ accountKind: "SUPPLIER", assignedRole: "AUDITOR" }),
    ];
    for (const row of invalidRows) {
      expect(resolveActiveIdentityCandidates([row])).toBeNull();
    }
  });

  it("preserves legacy behavior only for accounts with no assignment history", () => {
    const legacy = companyCandidate({
      assignmentId: undefined,
      assignedRole: undefined,
      assignmentActive: undefined,
      scopeType: undefined,
      companyId: undefined,
      scopeCompanyActive: undefined,
      companyMembershipStatus: undefined,
    });
    expect(resolveActiveIdentityCandidates([legacy])).toMatchObject({
      role: "VIEWER",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId: companyOne,
    });
    expect(resolveActiveIdentityCandidates([
      { ...legacy, legacyCompanyMembershipStatus: "SUSPENDED" },
    ])).toBeNull();
    expect(resolveActiveIdentityCandidates([
      { ...legacy, legacyRole: "TECHNICAL_SUPPORT" },
    ])).toBeNull();
  });

  it("selects a deterministic preferred active scope", () => {
    const preferred = companyCandidate({
      assignmentId: "40000000-0000-4000-8000-000000000010",
      assignedAt: "2026-07-01T00:00:00.000Z",
    });
    const secondary = companyCandidate({
      assignmentId: "40000000-0000-4000-8000-000000000002",
      companyId: companyTwo,
      assignedAt: "2026-08-02T00:00:00.000Z",
      companyMembershipStatus: "ACTIVE",
      companyMembershipPrimary: false,
    });
    expect(resolveActiveIdentityCandidates([secondary, preferred]))
      .toMatchObject({ companyId: companyOne, roleAssignmentId: preferred.assignmentId });
  });
});

describe("session scope invariants", () => {
  const active = resolveActiveIdentityCandidates([companyCandidate()])!;

  it("requires structural scope and a positive auth version", () => {
    expect(sessionScopeIsValid(active)).toBe(true);
    expect(sessionScopeIsValid({ ...active, authVersion: 0 })).toBe(false);
    expect(sessionScopeIsValid({ ...active, branchId: branchOne })).toBe(false);
    expect(sessionScopeIsValid({ ...active, role: "SUPER_ADMIN" })).toBe(false);
  });

  it("invalidates signed state after any live role, tenant or version change", () => {
    expect(liveSessionScopeMatches(active, { ...active })).toBe(true);
    expect(liveSessionScopeMatches(active, { ...active, authVersion: 4 })).toBe(false);
    expect(liveSessionScopeMatches(active, { ...active, companyId: companyTwo })).toBe(false);
    expect(liveSessionScopeMatches(active, { ...active, role: "FINANCE_REVIEWER" })).toBe(false);
    expect(liveSessionScopeMatches(active, { ...active, roleAssignmentId: "changed" }))
      .toBe(false);
  });
});
