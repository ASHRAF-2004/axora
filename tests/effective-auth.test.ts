import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  loadEffectiveAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/effective-access", () => ({
  loadEffectiveAccess: mocks.loadEffectiveAccess,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import {
  evaluateStablePermission,
  requireStablePagePermission,
  requireStablePermission,
  StablePermissionDeniedError,
} from "@/lib/effective-auth";
import type { SessionUser } from "@/lib/auth";

const companyId = "30000000-0000-4000-8000-000000000001";

const user: SessionUser = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Approver",
  email: "approver@example.test",
  role: "COMPANY_APPROVER",
  roleAssignmentId: "20000000-0000-4000-8000-000000000001",
  isOwner: false,
  accountKind: "COMPANY",
  accountStatus: "ACTIVE",
  authVersion: 4,
  scopeType: "COMPANY",
  companyId,
  locale: "en",
  timezone: "Asia/Kuala_Lumpur",
  onboardingRequired: false,
};

function access(roleGrants: string[]) {
  return {
    source: "LIVE_DATABASE" as const,
    capturedAt: new Date("2026-08-06T05:00:00.000Z"),
    roleAssignmentId: user.roleAssignmentId,
    authVersion: user.authVersion,
    subject: {
      userId: user.id,
      role: user.role,
      accountKind: user.accountKind,
      accountStatus: "ACTIVE" as const,
      isOwner: false,
      scopes: [{ type: "COMPANY" as const, companyId }],
      roleGrants,
      permissionOverrides: [],
      delegations: [],
      approvalLimits: [{
        permission: "request.approve.other" as const,
        currency: "MYR",
        maximumAmount: 2_000,
        allowSelfApproval: false,
        active: true,
        scope: { type: "COMPANY" as const, companyId },
      }],
    },
  };
}

describe("session-integrated stable authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(user);
    mocks.loadEffectiveAccess.mockResolvedValue(access([
      "request.approve.other",
    ]));
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("evaluates one resource using the current live access snapshot", async () => {
    const now = new Date("2026-08-06T05:00:00.000Z");
    const result = await evaluateStablePermission(
      user,
      "request.approve.other",
      {
        scope: { type: "COMPANY", companyId },
        ownerUserId: "another-user",
        amount: 1_500,
        currency: "MYR",
        availableBudget: 5_000,
        companyCeilingRemaining: 10_000,
        stateAllowsAction: true,
      },
      now,
    );

    expect(mocks.loadEffectiveAccess).toHaveBeenCalledWith(user, now);
    expect(result.decision).toMatchObject({
      allowed: true,
      permission: "request.approve.other",
      source: "ROLE",
    });
  });

  it("throws a generic server error when the live policy denies an API action", async () => {
    mocks.loadEffectiveAccess.mockResolvedValue(access([]));

    await expect(requireStablePermission(
      "request.approve.other",
      {
        scope: { type: "COMPANY", companyId },
        ownerUserId: "another-user",
        amount: 100,
        currency: "MYR",
      },
    )).rejects.toBeInstanceOf(StablePermissionDeniedError);

    try {
      await requireStablePermission(
        "request.approve.other",
        { scope: { type: "COMPANY", companyId } },
      );
    } catch (error) {
      expect(String(error)).not.toContain(companyId);
      expect(String(error)).not.toContain(user.email);
    }
  });

  it("uses the existing non-revealing access-denied route for pages", async () => {
    mocks.loadEffectiveAccess.mockResolvedValue(access([]));

    await expect(requireStablePagePermission(
      "request.approve.other",
      { scope: { type: "COMPANY", companyId } },
    )).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/access-denied");
  });
});
