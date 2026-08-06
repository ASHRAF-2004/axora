import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: mocks.isDemoMode,
  query: mocks.query,
}));

import type { SessionUser } from "@/lib/auth";
import {
  EffectiveAccessUnavailableError,
  loadEffectiveAccess,
} from "@/lib/effective-access";

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  assignment: "20000000-0000-4000-8000-000000000001",
  company: "30000000-0000-4000-8000-000000000001",
  branch: "40000000-0000-4000-8000-000000000001",
  otherCompany: "30000000-0000-4000-8000-000000000002",
};

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: ids.user,
    name: "Policy User",
    email: "policy.user@example.test",
    role: "COMPANY_APPROVER",
    roleAssignmentId: ids.assignment,
    isOwner: false,
    accountKind: "COMPANY",
    accountStatus: "ACTIVE",
    authVersion: 7,
    scopeType: "COMPANY",
    companyId: ids.company,
    locale: "en",
    timezone: "Asia/Kuala_Lumpur",
    onboardingRequired: false,
    ...overrides,
  };
}

function liveSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: "2026-08-06T05:00:00.000Z",
    accountStatus: "ACTIVE",
    accountKind: "COMPANY",
    isOwner: false,
    authVersion: 7,
    roleAssignmentId: ids.assignment,
    roleKey: "COMPANY_APPROVER",
    scopes: [{ type: "COMPANY", companyId: ids.company }],
    rolePermissions: [
      "request.view",
      "request.approve.other",
      "budget.view",
    ],
    permissionOverrides: [{
      permission: "request.approve.other",
      effect: "DENY",
      scope: { type: "COMPANY", companyId: ids.otherCompany },
      active: true,
      startsAt: "2026-08-06T04:00:00.000Z",
      endsAt: "2026-08-06T06:00:00.000Z",
    }],
    delegations: [{
      active: true,
      startsAt: "2026-08-06T04:00:00.000Z",
      endsAt: "2026-08-06T06:00:00.000Z",
      permissions: ["request.approve.over_budget"],
      scopes: [{ type: "COMPANY", companyId: ids.company }],
    }],
    approvalLimits: [{
      permission: "request.approve.other",
      currency: "MYR",
      maximumAmount: 2500,
      allowSelfApproval: false,
      active: true,
      startsAt: "2026-08-06T04:00:00.000Z",
      scope: { type: "COMPANY", companyId: ids.company },
    }],
    ...overrides,
  };
}

describe("live effective authorization access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ snapshot: liveSnapshot() }],
    });
  });

  it("loads only validated policy facts for the selected live assignment", async () => {
    const capturedAt = new Date("2026-08-06T05:00:00.000Z");
    const result = await loadEffectiveAccess(session(), capturedAt);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_effective_access_snapshot"),
      [ids.user, ids.assignment, capturedAt],
    );
    expect(result).toMatchObject({
      source: "LIVE_DATABASE",
      roleAssignmentId: ids.assignment,
      authVersion: 7,
      subject: {
        userId: ids.user,
        role: "COMPANY_APPROVER",
        accountKind: "COMPANY",
        accountStatus: "ACTIVE",
        isOwner: false,
      },
    });
    expect(result.subject.roleGrants).toEqual([
      "request.view",
      "request.approve.other",
      "budget.view",
    ]);
    expect(result.subject.permissionOverrides).toHaveLength(1);
    expect(result.subject.delegations).toHaveLength(1);
    expect(result.subject.approvalLimits).toHaveLength(1);
    expect(result.subject.approvalLimits?.[0]?.maximumAmount).toBe(2500);
  });

  it("fails closed when live account or assignment facts disagree with the session", async () => {
    for (const snapshot of [
      liveSnapshot({ authVersion: 8 }),
      liveSnapshot({ roleAssignmentId: "20000000-0000-4000-8000-000000000002" }),
      liveSnapshot({ accountKind: "PLATFORM" }),
      liveSnapshot({ isOwner: true }),
      liveSnapshot({ roleKey: "AUDITOR" }),
      liveSnapshot({
        scopes: [{ type: "COMPANY", companyId: ids.otherCompany }],
      }),
    ]) {
      mocks.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ snapshot }],
      });
      await expect(loadEffectiveAccess(session()))
        .rejects.toBeInstanceOf(EffectiveAccessUnavailableError);
    }
  });

  it("fails closed for absent, malformed, or unknown permission snapshots", async () => {
    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ snapshot: null }] });
    await expect(loadEffectiveAccess(session()))
      .rejects.toBeInstanceOf(EffectiveAccessUnavailableError);

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        snapshot: liveSnapshot({
          rolePermissions: ["forged.root"],
        }),
      }],
    });
    await expect(loadEffectiveAccess(session()))
      .rejects.toBeInstanceOf(EffectiveAccessUnavailableError);
  });

  it("retains a bounded compatibility path for demo and pre-normalization sessions", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    const demo = await loadEffectiveAccess(session());
    expect(demo.source).toBe("SESSION_COMPATIBILITY");
    expect(demo.subject.roleGrants).toContain("request.approve.other");
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.isDemoMode.mockReturnValueOnce(false);
    const legacy = await loadEffectiveAccess(session({
      roleAssignmentId: undefined,
    }));
    expect(legacy.source).toBe("SESSION_COMPATIBILITY");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not invent department context before department sessions are normalized", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    await expect(loadEffectiveAccess(session({
      role: "DEPARTMENT_ADMIN",
      scopeType: "DEPARTMENT",
      companyId: ids.company,
      branchId: ids.branch,
      roleAssignmentId: undefined,
    }))).rejects.toBeInstanceOf(EffectiveAccessUnavailableError);
  });
});
