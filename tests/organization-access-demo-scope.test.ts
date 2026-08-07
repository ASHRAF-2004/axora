import { describe, expect, it } from "vitest";
import type { AuthorizationSubject } from "@/lib/authorization-policy";
import { organizationAccessInternals } from "@/lib/organization-access";

const ids = {
  actor: "10000000-0000-4000-8000-000000000145",
  companyA: "20000000-0000-4000-8000-000000000145",
  companyB: "30000000-0000-4000-8000-000000000145",
  branchA: "40000000-0000-4000-8000-000000000145",
  branchB: "50000000-0000-4000-8000-000000000145",
  departmentA: "60000000-0000-4000-8000-000000000145",
} as const;

function subject(
  input: Pick<
    AuthorizationSubject,
    "role" | "accountKind" | "isOwner" | "scopes"
  >,
): AuthorizationSubject {
  return {
    userId: ids.actor,
    accountStatus: "ACTIVE",
    roleGrants: [],
    permissionOverrides: [],
    delegations: [],
    approvalLimits: [],
    ...input,
  };
}

describe("demo organization scope parity", () => {
  it("materializes trusted company and branch resources for platform scope", () => {
    const platform = subject({
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      isOwner: true,
      scopes: [{ type: "PLATFORM" }],
    });

    expect(organizationAccessInternals.companyPermissionContexts(
      platform,
      ids.companyA,
    )).toEqual([{ type: "COMPANY", companyId: ids.companyA }]);
    expect(organizationAccessInternals.branchPermissionContexts(
      platform,
      { id: ids.branchA, companyId: ids.companyA },
    )).toEqual([{
      type: "BRANCH",
      companyId: ids.companyA,
      branchId: ids.branchA,
    }]);
  });

  it("uses the exact branch context and excludes sibling branches", () => {
    const branchActor = subject({
      role: "BRANCH_ADMIN",
      accountKind: "COMPANY",
      isOwner: false,
      scopes: [{
        type: "BRANCH",
        companyId: ids.companyA,
        branchId: ids.branchA,
      }],
    });

    expect(organizationAccessInternals.companyPermissionContexts(
      branchActor,
      ids.companyA,
    )).toEqual([{
      type: "BRANCH",
      companyId: ids.companyA,
      branchId: ids.branchA,
    }]);
    expect(organizationAccessInternals.branchPermissionContexts(
      branchActor,
      { id: ids.branchA, companyId: ids.companyA },
    )).toEqual([{
      type: "BRANCH",
      companyId: ids.companyA,
      branchId: ids.branchA,
    }]);
    expect(organizationAccessInternals.branchPermissionContexts(
      branchActor,
      { id: ids.branchB, companyId: ids.companyA },
    )).toEqual([]);
    expect(organizationAccessInternals.companyPermissionContexts(
      branchActor,
      ids.companyB,
    )).toEqual([]);
  });

  it("retains department scope only for its parent branch context", () => {
    const departmentScope = {
      type: "DEPARTMENT" as const,
      companyId: ids.companyA,
      branchId: ids.branchA,
      departmentId: ids.departmentA,
    };
    const departmentActor = subject({
      role: "DEPARTMENT_ADMIN",
      accountKind: "COMPANY",
      isOwner: false,
      scopes: [departmentScope],
    });

    expect(organizationAccessInternals.companyPermissionContexts(
      departmentActor,
      ids.companyA,
    )).toEqual([departmentScope]);
    expect(organizationAccessInternals.branchPermissionContexts(
      departmentActor,
      { id: ids.branchA, companyId: ids.companyA },
    )).toEqual([departmentScope]);
    expect(organizationAccessInternals.branchPermissionContexts(
      departmentActor,
      { id: ids.branchB, companyId: ids.companyA },
    )).toEqual([]);
  });
});
