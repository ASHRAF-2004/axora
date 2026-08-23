import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import {
  AccountInvitationAccessUnavailableError,
  accountInvitationIsolationInternals,
  lockAuthorizedInvitationCreationScope,
  lockAuthorizedInvitationTarget,
} from "@/lib/account-invitation-isolation";
import type { ResolvedUserCreation } from "@/lib/users";

const ids = {
  actor: "10000000-0000-4000-8000-000000000048",
  assignment: "20000000-0000-4000-8000-000000000048",
  company: "30000000-0000-4000-8000-000000000048",
  branch: "40000000-0000-4000-8000-000000000048",
  role: "50000000-0000-4000-8000-000000000048",
  target: "60000000-0000-4000-8000-000000000048",
  targetAssignment: "70000000-0000-4000-8000-000000000048",
} as const;
const capturedAt = new Date("2026-08-08T02:45:00.000Z");

const actor: SessionUser = {
  id: ids.actor,
  email: "admin@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 3,
};

const resolved: ResolvedUserCreation = {
  email: "requester@example.test",
  displayName: "Purchase requester",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: ids.company,
  branchId: ids.branch,
  preferredLocale: "en",
};

function creationSnapshot() {
  return {
    capturedAt: capturedAt.toISOString(),
    roleId: ids.role,
    role: "REQUESTER",
    accountKind: "COMPANY",
    isOwner: false,
    organizationName: "Northwind Services",
    branchName: "Cyberjaya",
    scope: {
      type: "BRANCH",
      companyId: ids.company,
      branchId: ids.branch,
    },
  };
}

function targetSnapshot() {
  return {
    capturedAt: capturedAt.toISOString(),
    permission: "user.invite",
    userId: ids.target,
    active: true,
    isOwner: false,
    accountKind: "COMPANY",
    accountStatus: "INVITED",
    setupCompleted: false,
    roleAssignmentId: ids.targetAssignment,
    role: "REQUESTER",
    scope: {
      type: "BRANCH",
      companyId: ids.company,
      branchId: ids.branch,
    },
  };
}

describe("account invitation isolation", () => {
  it("locks and validates the exact account creation scope", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: creationSnapshot() }],
      }),
    };
    const result = await lockAuthorizedInvitationCreationScope(
      client as never,
      actor,
      resolved,
      capturedAt,
    );
    expect(result.organizationName).toBe("Northwind Services");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_lock_user_creation_scope"),
      [
        ids.actor,
        ids.assignment,
        3,
        "REQUESTER",
        "BRANCH",
        ids.company,
        ids.branch,
        null,
        null,
        capturedAt,
      ],
    );
  });

  it("rejects a database snapshot that changes tenant, role, or scope", async () => {
    for (const snapshot of [
      { ...creationSnapshot(), role: "BRANCH_APPROVER" },
      {
        ...creationSnapshot(),
        scope: {
          type: "BRANCH",
          companyId: "80000000-0000-4000-8000-000000000048",
          branchId: ids.branch,
        },
      },
      {
        ...creationSnapshot(),
        accountKind: "PLATFORM",
      },
    ]) {
      const client = {
        query: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [{ snapshot }],
        }),
      };
      await expect(lockAuthorizedInvitationCreationScope(
        client as never,
        actor,
        resolved,
        capturedAt,
      )).rejects.toBeInstanceOf(AccountInvitationAccessUnavailableError);
    }
  });

  it("lets PostgreSQL resolve a canonical Owner whose session omits an assignment claim", async () => {
    const owner = {
      ...actor,
      role: "PLATFORM_OWNER" as const,
      accountKind: "PLATFORM" as const,
      scopeType: "PLATFORM" as const,
      companyId: undefined,
      roleAssignmentId: undefined,
      isOwner: true,
    };
    const firstAdministrator: ResolvedUserCreation = {
      ...resolved,
      role: "COMPANY_ADMIN",
      scopeType: "COMPANY",
      branchId: undefined,
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: {
          ...creationSnapshot(),
          role: "COMPANY_ADMIN",
          scope: { type: "COMPANY", companyId: ids.company },
          branchName: undefined,
        } }],
      }),
    };

    await expect(lockAuthorizedInvitationCreationScope(
      client as never,
      owner,
      firstAdministrator,
      capturedAt,
    )).resolves.toMatchObject({ role: "COMPANY_ADMIN" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_lock_company_admin_invitation_scope"),
      [ids.actor, null, 3, ids.company, capturedAt],
    );
  });

  it("locks invitation replacement through the exact target assignment", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: targetSnapshot() }],
      }),
    };
    const result = await lockAuthorizedInvitationTarget(
      client as never,
      actor,
      ids.target,
      capturedAt,
    );
    expect(result.roleAssignmentId).toBe(ids.targetAssignment);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_lock_user_target_access"),
      [ids.actor, ids.assignment, ids.target, capturedAt],
    );
  });

  it("fails closed without a normalized live assignment or valid result", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: null }],
      }),
    };
    await expect(lockAuthorizedInvitationCreationScope(
      client as never,
      { ...actor, roleAssignmentId: undefined },
      resolved,
      capturedAt,
    )).rejects.toBeInstanceOf(AccountInvitationAccessUnavailableError);
    await expect(lockAuthorizedInvitationTarget(
      client as never,
      actor,
      ids.target,
      capturedAt,
    )).rejects.toBeInstanceOf(AccountInvitationAccessUnavailableError);
  });

  it("keeps schemas strict and rejects private or conflicting fields", () => {
    expect(accountInvitationIsolationInternals.creationScopeSchema.safeParse({
      ...creationSnapshot(),
      passwordHash: "must-not-leak",
    }).success).toBe(false);
    expect(accountInvitationIsolationInternals.targetSchema.safeParse({
      ...targetSnapshot(),
      permission: "user.deactivate",
    }).success).toBe(false);
  });
});
