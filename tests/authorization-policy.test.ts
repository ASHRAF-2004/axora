import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  authorize,
  canonicalRoleForAuthorization,
  creationPermissionOptions,
  defaultPermissionsForRole,
  isPermissionCode,
  permissionIsCompatibleWithAccountKind,
  permissionIsCompatibleWithRole,
  type ApprovalLimit,
  type AuthorizationScope,
  type AuthorizationSubject,
} from "@/lib/authorization-policy";

const companyScope = (
  companyId = "company-a",
): AuthorizationScope => ({
  type: "COMPANY",
  companyId,
});

const branchScope: AuthorizationScope = {
  type: "BRANCH",
  companyId: "company-a",
  branchId: "branch-a",
};

const departmentScope: AuthorizationScope = {
  type: "DEPARTMENT",
  companyId: "company-a",
  branchId: "branch-a",
  departmentId: "department-a",
};

function subject(
  overrides: Partial<AuthorizationSubject> = {},
): AuthorizationSubject {
  return {
    userId: "user-a",
    role: "COMPANY_APPROVER",
    accountKind: "COMPANY",
    accountStatus: "ACTIVE",
    isOwner: false,
    scopes: [companyScope()],
    ...overrides,
  };
}

function limit(
  overrides: Partial<ApprovalLimit> = {},
): ApprovalLimit {
  return {
    permission: "request.approve.other",
    currency: "MYR",
    maximumAmount: 1_000,
    allowSelfApproval: false,
    active: true,
    scope: companyScope(),
    ...overrides,
  };
}

describe("canonical authorization policy", () => {
  it("publishes unique stable dot-delimited permission codes", () => {
    const codes = PERMISSION_CATALOG.map((entry) => entry.code);
    expect(codes.length).toBeGreaterThanOrEqual(80);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => (
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(code)
    ))).toBe(true);
    expect(isPermissionCode("request.approve.self")).toBe(true);
    expect(isPermissionCode("approve_requests")).toBe(false);
  });

  it("normalizes legacy roles without treating a job title as authority", () => {
    expect(canonicalRoleForAuthorization(
      "ADMIN",
      "COMPANY",
      false,
    )).toBe("COMPANY_ADMIN");
    expect(canonicalRoleForAuthorization(
      "ADMIN",
      "PLATFORM",
      true,
    )).toBe("PLATFORM_OWNER");
    expect(canonicalRoleForAuthorization(
      "APPROVER",
      "BRANCH",
      false,
    )).toBe("BRANCH_APPROVER");
    expect(canonicalRoleForAuthorization(
      "DELIVERY_DRIVER",
      "DELIVERY",
      false,
    )).toBe("DELIVERY_AGENT");
    const camDefaults = defaultPermissionsForRole(
      "CLIENT_ACCOUNT_MANAGER",
      "COMPANY",
    );
    expect(camDefaults).toContain("company.view.assigned");
    expect(camDefaults).toContain("company.create");
  });

  it("keeps permission customization inside the target account kind", () => {
    expect(permissionIsCompatibleWithAccountKind(
      "company_user.create",
      "COMPANY",
    )).toBe(true);
    expect(permissionIsCompatibleWithAccountKind(
      "commercial.cost.view",
      "COMPANY",
    )).toBe(false);
    expect(permissionIsCompatibleWithAccountKind(
      "delivery.view",
      "COMPANY",
    )).toBe(true);
    expect(permissionIsCompatibleWithAccountKind(
      "delivery.claim",
      "COMPANY",
    )).toBe(false);
    expect(permissionIsCompatibleWithAccountKind(
      "finance.wallet.top_up.record",
      "COMPANY",
    )).toBe(false);
    expect(permissionIsCompatibleWithAccountKind(
      "commercial.company_ceiling.override",
      "COMPANY",
    )).toBe(false);
    for (const platformOnly of [
      "analytics.revenue.view",
      "finance.manage",
      "delivery.manage",
      "delivery.assign",
    ] as const) {
      expect(permissionIsCompatibleWithAccountKind(
        platformOnly,
        "COMPANY",
      )).toBe(false);
    }
    expect(permissionIsCompatibleWithAccountKind(
      "delivery.claim",
      "DELIVERY",
    )).toBe(true);
    expect(permissionIsCompatibleWithAccountKind(
      "company_user.create",
      "DELIVERY",
    )).toBe(false);
    expect(permissionIsCompatibleWithAccountKind(
      "document.download",
      "DELIVERY",
    )).toBe(true);
    expect(permissionIsCompatibleWithAccountKind(
      "delivery.view",
      "PLATFORM",
    )).toBe(true);
    expect(permissionIsCompatibleWithAccountKind(
      "delivery.claim",
      "PLATFORM",
    )).toBe(false);

    const requesterDefaults = defaultPermissionsForRole(
      "REQUESTER",
      "BRANCH",
    );
    const narrowed = creationPermissionOptions(
      "COMPANY",
      requesterDefaults,
      false,
    );
    expect(narrowed.map((permission) => permission.code).sort())
      .toEqual([...requesterDefaults].sort());
    const expanded = creationPermissionOptions(
      "COMPANY",
      requesterDefaults,
      true,
    );
    expect(expanded.some((permission) => permission.code === "company_user.edit"))
      .toBe(true);
    expect(expanded.some((permission) => permission.code === "platform_user.edit"))
      .toBe(false);
  });

  it("does not let explicit grants cross the CAM commercial role ceiling", () => {
    const platformScope: AuthorizationScope = { type: "PLATFORM" };
    const manager = subject({
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      scopes: [platformScope],
      explicitGrants: [
        "commercial.cost.view",
        "commercial.markup.view",
        "commercial.platform_margin.view",
        "commercial.pricing.manage",
      ],
    });
    for (const permission of manager.explicitGrants ?? []) {
      expect(permissionIsCompatibleWithRole(
        permission,
        manager.role,
        "PLATFORM",
      )).toBe(false);
      expect(authorize({
        subject: manager,
        permission,
        resource: { scope: platformScope },
      })).toEqual({
        allowed: false,
        permission,
        reason: "PERMISSION_DENIED",
      });
    }

    const options = creationPermissionOptions(
      "PLATFORM",
      defaultPermissionsForRole("CLIENT_ACCOUNT_MANAGER", "PLATFORM"),
      true,
      "CLIENT_ACCOUNT_MANAGER",
      "PLATFORM",
    );
    expect(options.map((option) => option.code)).not.toEqual(expect.arrayContaining([
      "commercial.cost.view",
      "commercial.markup.view",
      "commercial.platform_margin.view",
      "commercial.pricing.manage",
    ]));
  });

  it("keeps an assigned client account manager inside assigned companies", () => {
    const manager = subject({
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      scopes: [companyScope("company-a")],
    });
    expect(authorize({
      subject: manager,
      permission: "company.view.assigned",
      resource: { scope: companyScope("company-a") },
    })).toMatchObject({ allowed: true, source: "ROLE" });
    expect(authorize({
      subject: manager,
      permission: "company.view.assigned",
      resource: { scope: companyScope("company-b") },
    })).toEqual({
      allowed: false,
      permission: "company.view.assigned",
      reason: "RESOURCE_OUT_OF_SCOPE",
    });
  });

  it("accepts the canonical HR, Agent, and Delivery Guy scope contracts", () => {
    const platformScope: AuthorizationScope = { type: "PLATFORM" };
    expect(authorize({
      subject: subject({
        role: "HUMAN_RESOURCES_MANAGEMENT",
        accountKind: "PLATFORM",
        scopes: [platformScope],
      }),
      permission: "company.lead.view",
      resource: { scope: platformScope },
    }).allowed).toBe(true);
    expect(authorize({
      subject: subject({
        role: "CLIENT_ACCOUNT_MANAGER",
        accountKind: "PLATFORM",
        scopes: [platformScope],
      }),
      permission: "company.lead.view",
      resource: { scope: platformScope },
    }).allowed).toBe(true);
    expect(authorize({
      subject: subject({
        role: "DELIVERY_GUY",
        accountKind: "DELIVERY",
        scopes: [{ type: "DELIVERY" }],
      }),
      permission: "delivery.portal.view",
      resource: { scope: { type: "DELIVERY" } },
    }).allowed).toBe(true);
  });

  it("keeps department administrators inside one department", () => {
    const administrator = subject({
      role: "DEPARTMENT_ADMIN",
      scopes: [departmentScope],
    });
    expect(authorize({
      subject: administrator,
      permission: "request.create",
      resource: { scope: departmentScope },
    }).allowed).toBe(true);
    expect(authorize({
      subject: administrator,
      permission: "request.create",
      resource: {
        scope: {
          ...departmentScope,
          departmentId: "department-b",
        },
      },
    })).toMatchObject({
      allowed: false,
      reason: "RESOURCE_OUT_OF_SCOPE",
    });
  });

  it("lets explicit denials override role defaults and grants", () => {
    const denied = subject({
      explicitGrants: ["request.approve.other"],
      explicitDenies: ["request.approve.other"],
      approvalLimits: [limit()],
    });
    expect(authorize({
      subject: denied,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 100,
        currency: "MYR",
      },
    })).toEqual({
      allowed: false,
      permission: "request.approve.other",
      reason: "PERMISSION_DENIED",
    });
  });

  it("requires a separate self-approval permission and self-enabled limit", () => {
    const approver = subject({
      approvalLimits: [limit()],
    });
    expect(authorize({
      subject: approver,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "user-a",
        amount: 100,
        currency: "MYR",
      },
    })).toMatchObject({
      allowed: false,
      permission: "request.approve.self",
      reason: "SELF_APPROVAL_DENIED",
    });

    const selfApprover = subject({
      explicitGrants: ["request.approve.self"],
      approvalLimits: [limit({
        permission: "request.approve.self",
        allowSelfApproval: true,
      })],
    });
    expect(authorize({
      subject: selfApprover,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "user-a",
        amount: 100,
        currency: "MYR",
      },
    })).toMatchObject({
      allowed: true,
      permission: "request.approve.self",
      source: "EXPLICIT_GRANT",
    });
  });

  it("enforces approval amount, currency, budget, and company ceiling separately", () => {
    const approver = subject({
      approvalLimits: [limit({ maximumAmount: 500 })],
    });
    expect(authorize({
      subject: approver,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 501,
        currency: "MYR",
      },
    })).toMatchObject({
      allowed: false,
      reason: "APPROVAL_LIMIT_EXCEEDED",
    });
    expect(authorize({
      subject: approver,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 100,
        currency: "USD",
      },
    })).toMatchObject({
      allowed: false,
      reason: "CURRENCY_MISMATCH",
    });
    expect(authorize({
      subject: approver,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 400,
        currency: "MYR",
        availableBudget: 300,
      },
    })).toMatchObject({
      allowed: false,
      reason: "BUDGET_INSUFFICIENT",
    });

    const exceptionApprover = subject({
      explicitGrants: [
        "request.approve.over_budget",
        "commercial.company_ceiling.override",
      ],
      approvalLimits: [limit({ maximumAmount: 500 })],
    });
    expect(authorize({
      subject: exceptionApprover,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 400,
        currency: "MYR",
        availableBudget: 300,
        companyCeilingRemaining: 350,
      },
    })).toMatchObject({ allowed: true });
  });

  it("accepts only active, in-scope delegated permissions", () => {
    const now = new Date("2026-08-06T08:00:00.000Z");
    const delegated = subject({
      role: "AUDITOR",
      delegations: [{
        active: true,
        startsAt: new Date("2026-08-06T07:00:00.000Z"),
        endsAt: new Date("2026-08-06T09:00:00.000Z"),
        permissions: ["request.approve.other"],
        scopes: [companyScope()],
      }],
      approvalLimits: [limit()],
    });
    expect(authorize({
      subject: delegated,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 100,
        currency: "MYR",
      },
      now,
    })).toMatchObject({
      allowed: true,
      source: "DELEGATION",
    });

    expect(authorize({
      subject: delegated,
      permission: "request.approve.other",
      resource: {
        scope: companyScope(),
        ownerUserId: "requester-b",
        amount: 100,
        currency: "MYR",
      },
      now: new Date("2026-08-06T10:00:00.000Z"),
    })).toMatchObject({
      allowed: false,
      reason: "PERMISSION_DENIED",
    });
  });

  it("fails closed for inactive, malformed, or invalid-state subjects", () => {
    expect(authorize({
      subject: subject({ accountStatus: "SUSPENDED" }),
      permission: "request.view",
      resource: { scope: companyScope() },
    })).toMatchObject({
      allowed: false,
      reason: "ACCOUNT_INACTIVE",
    });
    expect(authorize({
      subject: subject({ role: "FORGED_OWNER", isOwner: true }),
      permission: "platform.view",
      resource: { scope: { type: "PLATFORM" } },
    })).toMatchObject({
      allowed: false,
      reason: "ROLE_INVALID",
    });
    expect(authorize({
      subject: subject(),
      permission: "request.view",
      resource: {
        scope: companyScope(),
        stateAllowsAction: false,
      },
    })).toMatchObject({
      allowed: false,
      reason: "INVALID_RESOURCE_STATE",
    });
  });

  it("separates delivery supervision from one agent's operational work", () => {
    const supervisor = subject({
      role: "DELIVERY_TEAM_SUPERVISOR",
      accountKind: "DELIVERY",
      scopes: [{ type: "DELIVERY" }],
    });
    const agent = subject({
      role: "DELIVERY_AGENT",
      accountKind: "DELIVERY",
      scopes: [{
        type: "DELIVERY",
        deliveryAssignmentId: "assignment-a",
      }],
    });
    expect(authorize({
      subject: supervisor,
      permission: "delivery.assign",
      resource: {
        scope: {
          type: "DELIVERY",
          deliveryAssignmentId: "assignment-b",
        },
      },
    }).allowed).toBe(true);
    expect(authorize({
      subject: agent,
      permission: "delivery.assignment.update",
      resource: {
        scope: {
          type: "DELIVERY",
          deliveryAssignmentId: "assignment-b",
        },
      },
    })).toMatchObject({
      allowed: false,
      reason: "RESOURCE_OUT_OF_SCOPE",
    });
  });

  it("lets a company scope contain its branches but not another company", () => {
    const administrator = subject({
      role: "COMPANY_ADMIN",
      scopes: [companyScope()],
    });
    expect(authorize({
      subject: administrator,
      permission: "organization.branch.view",
      resource: { scope: branchScope },
    }).allowed).toBe(true);
    expect(authorize({
      subject: administrator,
      permission: "organization.branch.view",
      resource: {
        scope: {
          type: "BRANCH",
          companyId: "company-b",
          branchId: "branch-b",
        },
      },
    }).allowed).toBe(false);
  });
});


describe("live policy facts", () => {
  const companyA = { type: "COMPANY" as const, companyId: "company-a" };
  const companyB = { type: "COMPANY" as const, companyId: "company-b" };
  const now = new Date("2026-08-06T05:00:00.000Z");

  function liveApprover() {
    return {
      userId: "approver-1",
      role: "COMPANY_APPROVER" as const,
      accountKind: "COMPANY" as const,
      accountStatus: "ACTIVE" as const,
      isOwner: false,
      scopes: [companyA, companyB],
      roleGrants: ["request.approve.other" as const],
      permissionOverrides: [],
      delegations: [],
      approvalLimits: [{
        permission: "request.approve.other" as const,
        currency: "MYR",
        maximumAmount: 1000,
        allowSelfApproval: false,
        active: true,
        scope: companyA,
      }, {
        permission: "request.approve.other" as const,
        currency: "MYR",
        maximumAmount: 1000,
        allowSelfApproval: false,
        active: true,
        scope: companyB,
      }],
    };
  }

  it("uses the live database role grant set instead of stale static defaults", () => {
    expect(authorize({
      subject: liveApprover(),
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 500, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });

    expect(authorize({
      subject: { ...liveApprover(), roleGrants: [] },
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 500, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: false, reason: "PERMISSION_DENIED" });
  });

  it("applies a scoped denial only to its matching company", () => {
    const subject = {
      ...liveApprover(),
      permissionOverrides: [{
        permission: "request.approve.other" as const,
        effect: "DENY" as const,
        scope: companyA,
        active: true,
        startsAt: new Date("2026-08-06T04:00:00.000Z"),
        endsAt: new Date("2026-08-06T06:00:00.000Z"),
      }],
    };
    expect(authorize({
      subject,
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: false, reason: "PERMISSION_DENIED" });
    expect(authorize({
      subject,
      permission: "request.approve.other",
      resource: { scope: companyB, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });
  });

  it("allows an active delegation to extend both permission and scope", () => {
    const subject = {
      userId: "auditor-1",
      role: "AUDITOR" as const,
      accountKind: "COMPANY" as const,
      accountStatus: "ACTIVE" as const,
      isOwner: false,
      scopes: [companyA],
      roleGrants: [],
      permissionOverrides: [],
      delegations: [{
        active: true,
        startsAt: new Date("2026-08-06T04:00:00.000Z"),
        endsAt: new Date("2026-08-06T06:00:00.000Z"),
        permissions: ["request.view" as const],
        scopes: [companyB],
      }],
      approvalLimits: [],
    };
    expect(authorize({
      subject,
      permission: "request.view",
      resource: { scope: companyB },
      now,
    })).toMatchObject({ allowed: true, source: "DELEGATION" });
  });

  it("ignores expired scoped overrides", () => {
    expect(authorize({
      subject: {
        ...liveApprover(),
        permissionOverrides: [{
          permission: "request.approve.other" as const,
          effect: "DENY" as const,
          scope: companyA,
          active: true,
          endsAt: new Date("2026-08-06T04:59:59.000Z"),
        }],
      },
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });
  });
});
