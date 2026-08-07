import { describe, expect, it } from "vitest";
import {
  authorize,
  type AuthorizationSubject,
} from "@/lib/authorization-policy";

const companyId = "10000000-0000-4000-8000-000000000041";
const homeBranchId = "20000000-0000-4000-8000-000000000041";
const coveredBranchId = "30000000-0000-4000-8000-000000000041";
const now = new Date("2026-08-07T02:00:00.000Z");

function subject(): AuthorizationSubject {
  return {
    userId: "40000000-0000-4000-8000-000000000041",
    role: "REQUESTER",
    accountKind: "COMPANY",
    accountStatus: "ACTIVE",
    isOwner: false,
    scopes: [{
      type: "BRANCH",
      companyId,
      branchId: homeBranchId,
    }],
    delegations: [{
      active: true,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60 * 1000),
      permissions: ["request.view", "request.approve.other"],
      scopes: [{
        type: "BRANCH",
        companyId,
        branchId: coveredBranchId,
      }],
    }],
    approvalLimits: [],
  };
}

const coveredResource = {
  scope: {
    type: "BRANCH" as const,
    companyId,
    branchId: coveredBranchId,
  },
};

describe("delegated authorization policy", () => {
  it("extends both permission and resource scope only while active", () => {
    expect(authorize({
      subject: subject(),
      permission: "request.view",
      resource: coveredResource,
      now,
    })).toEqual({
      allowed: true,
      permission: "request.view",
      source: "DELEGATION",
    });

    const expired = subject();
    expired.delegations = [{
      ...expired.delegations![0],
      startsAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() - 60_000),
    }];
    expect(authorize({
      subject: expired,
      permission: "request.view",
      resource: coveredResource,
      now,
    })).toMatchObject({
      allowed: false,
      reason: "RESOURCE_OUT_OF_SCOPE",
    });
  });

  it("keeps matching explicit denial above delegated authority", () => {
    const denied = subject();
    denied.permissionOverrides = [{
      permission: "request.view",
      effect: "DENY",
      scope: coveredResource.scope,
      active: true,
      startsAt: new Date(now.getTime() - 60_000),
    }];

    expect(authorize({
      subject: denied,
      permission: "request.view",
      resource: coveredResource,
      now,
    })).toEqual({
      allowed: false,
      permission: "request.view",
      reason: "PERMISSION_DENIED",
    });
  });

  it("requires a separate scoped approval limit for delegated approvals", () => {
    const delegatedApprover = subject();
    expect(authorize({
      subject: delegatedApprover,
      permission: "request.approve.other",
      resource: {
        ...coveredResource,
        ownerUserId: "50000000-0000-4000-8000-000000000041",
        amount: 500,
        currency: "MYR",
      },
      now,
    })).toEqual({
      allowed: false,
      permission: "request.approve.other",
      reason: "APPROVAL_LIMIT_MISSING",
    });

    delegatedApprover.approvalLimits = [{
      permission: "request.approve.other",
      currency: "MYR",
      maximumAmount: 1_000,
      allowSelfApproval: false,
      active: true,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60 * 1000),
      scope: coveredResource.scope,
    }];
    expect(authorize({
      subject: delegatedApprover,
      permission: "request.approve.other",
      resource: {
        ...coveredResource,
        ownerUserId: "50000000-0000-4000-8000-000000000041",
        amount: 500,
        currency: "MYR",
      },
      now,
    })).toEqual({
      allowed: true,
      permission: "request.approve.other",
      source: "DELEGATION",
    });
  });
});
