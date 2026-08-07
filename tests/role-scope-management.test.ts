import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  assignUserRoleScope,
  revokeUserRoleScope,
  RoleScopeManagementUnavailableError,
} from "@/lib/role-scope-management";

const ids = {
  actor: "10000000-0000-4000-8000-000000000042",
  actorAssignment: "20000000-0000-4000-8000-000000000042",
  target: "30000000-0000-4000-8000-000000000042",
  command: "40000000-0000-4000-8000-000000000042",
  assignment: "50000000-0000-4000-8000-000000000042",
  company: "60000000-0000-4000-8000-000000000042",
  branch: "70000000-0000-4000-8000-000000000042",
} as const;

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "admin@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.actorAssignment,
  isOwner: false,
  authVersion: 5,
};

describe("role and scope management service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        roleAssignmentId: ids.assignment,
        authVersion: 6,
        revokedSessions: 2,
        changed: true,
      }],
    });
  });

  it("submits a canonical branch-scoped assignment command", async () => {
    const result = await assignUserRoleScope(actor, {
      commandId: ids.command,
      targetUserId: ids.target,
      role: "BRANCH_ADMIN",
      scope: {
        type: "BRANCH",
        companyId: ids.company,
        branchId: ids.branch,
      },
      reason: "Appoint branch administrator",
    });

    expect(result).toEqual({
      roleAssignmentId: ids.assignment,
      authVersion: 6,
      revokedSessions: 2,
      changed: true,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_assign_user_role_scope"),
      [
        ids.command,
        ids.actor,
        ids.actorAssignment,
        ids.target,
        "BRANCH_ADMIN",
        "BRANCH",
        ids.company,
        ids.branch,
        null,
        null,
        "Appoint branch administrator",
      ],
    );
  });

  it("rejects self-change, malformed scopes, and incompatible role scopes before SQL", async () => {
    const invalidInputs = [
      {
        commandId: ids.command,
        targetUserId: ids.actor,
        role: "BRANCH_ADMIN",
        scope: {
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        },
        reason: "Self role change is prohibited",
      },
      {
        commandId: ids.command,
        targetUserId: ids.target,
        role: "BRANCH_ADMIN",
        scope: { type: "BRANCH", companyId: ids.company },
        reason: "Missing branch identifier",
      },
      {
        commandId: ids.command,
        targetUserId: ids.target,
        role: "COMPANY_ADMIN",
        scope: {
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        },
        reason: "Company role cannot use branch scope",
      },
      {
        commandId: ids.command,
        targetUserId: ids.target,
        role: "ADMIN",
        scope: { type: "COMPANY", companyId: ids.company },
        reason: "Legacy role cannot be assigned",
      },
    ];

    for (const input of invalidInputs) {
      await expect(assignUserRoleScope(
        actor,
        input as Parameters<typeof assignUserRoleScope>[1],
      )).rejects.toThrow();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires an exact actor assignment and hides database policy details", async () => {
    await expect(assignUserRoleScope(
      { ...actor, roleAssignmentId: undefined },
      {
        commandId: ids.command,
        targetUserId: ids.target,
        role: "BRANCH_ADMIN",
        scope: {
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        },
        reason: "Missing normalized actor assignment",
      },
    )).rejects.toBeInstanceOf(RoleScopeManagementUnavailableError);

    mocks.query.mockRejectedValueOnce(new Error(
      "private target role and tenant details",
    ));
    await expect(assignUserRoleScope(actor, {
      commandId: ids.command,
      targetUserId: ids.target,
      role: "BRANCH_ADMIN",
      scope: {
        type: "BRANCH",
        companyId: ids.company,
        branchId: ids.branch,
      },
      reason: "Database denial remains private",
    })).rejects.toThrow(
      "The requested role or scope change could not be completed.",
    );
  });

  it("revokes through the audited command and validates its result", async () => {
    await expect(revokeUserRoleScope(actor, {
      commandId: ids.command,
      roleAssignmentId: ids.assignment,
      reason: "Role coverage ended",
    })).resolves.toEqual({
      roleAssignmentId: ids.assignment,
      authVersion: 6,
      revokedSessions: 2,
      changed: true,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_revoke_user_role_scope"),
      [
        ids.command,
        ids.actor,
        ids.actorAssignment,
        ids.assignment,
        "Role coverage ended",
      ],
    );

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        roleAssignmentId: "invalid",
        authVersion: 0,
        revokedSessions: -1,
        changed: true,
      }],
    });
    await expect(revokeUserRoleScope(actor, {
      commandId: ids.command,
      roleAssignmentId: ids.assignment,
      reason: "Malformed result fails closed",
    })).rejects.toBeInstanceOf(RoleScopeManagementUnavailableError);
  });
});
