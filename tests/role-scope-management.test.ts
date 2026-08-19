import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { ACCOUNT_ROLE_CATALOG } from "@/lib/role-catalog";
import {
  assignUserRoleScope,
  MANAGED_ROLE_KEYS,
  replaceUserRoleScope,
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
  department: "80000000-0000-4000-8000-000000000042",
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

  it("derives routine management roles from the canonical Prompt 4 catalogue", () => {
    const canonical = ACCOUNT_ROLE_CATALOG
      .filter((definition) => definition.availableForCreation !== false)
      .map((definition) => definition.key);
    expect(MANAGED_ROLE_KEYS).toEqual(canonical);
    expect(MANAGED_ROLE_KEYS).toEqual(expect.arrayContaining([
      "HUMAN_RESOURCES_MANAGEMENT",
      "CLIENT_ACCOUNT_MANAGER",
      "DELIVERY_GUY",
    ]));
    expect(MANAGED_ROLE_KEYS).not.toEqual(expect.arrayContaining([
      "PLATFORM_OPERATIONS",
      "FINANCE_REVIEWER",
      "DELIVERY_AGENT",
      "DELIVERY_DRIVER",
    ]));
  });

  it("submits a canonical branch-scoped assignment command", async () => {
    const result = await assignUserRoleScope(actor, {
      commandId: ids.command,
      targetUserId: ids.target,
      role: "BRANCH_ADMIN",
      scope: { type: "BRANCH", companyId: ids.company, branchId: ids.branch },
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
      [ids.command,ids.actor,ids.actorAssignment,ids.target,"BRANCH_ADMIN",
        "BRANCH",ids.company,ids.branch,null,null,"Appoint branch administrator"],
    );
  });

  it("replaces one selected assignment with explicit PostgreSQL parameter types", async () => {
    await expect(replaceUserRoleScope(actor, {
      commandId: ids.command,
      targetUserId: ids.target,
      currentRoleAssignmentId: ids.assignment,
      role: "DEPARTMENT_ADMIN",
      scope: {
        type: "DEPARTMENT",
        companyId: ids.company,
        branchId: ids.branch,
        departmentId: ids.department,
      },
      reason: "Move administration to one department",
    })).resolves.toMatchObject({ changed: true, revokedSessions: 2 });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/axora_replace_user_role_scope[\s\S]*\$1::uuid[\s\S]*\$6::text/),
      [
        ids.command,ids.actor,ids.actorAssignment,ids.target,ids.assignment,
        "DEPARTMENT_ADMIN","DEPARTMENT",ids.company,ids.branch,ids.department,
        null,"Move administration to one department",
      ],
    );
  });

  it("recognizes HRM and Client Account Manager only with Platform scope and Delivery Guy only with Delivery scope", async () => {
    const owner = { ...actor, role: "PLATFORM_OWNER" as const, accountKind: "PLATFORM" as const,
      scopeType: "PLATFORM" as const, companyId: undefined, isOwner: true };
    for (const role of ["HUMAN_RESOURCES_MANAGEMENT", "CLIENT_ACCOUNT_MANAGER"] as const) {
      await expect(assignUserRoleScope(owner, {
        commandId: ids.command,targetUserId: ids.target,role,
        scope: { type: "PLATFORM" },reason: "Canonical platform role change",
      })).resolves.toMatchObject({ changed: true });
    }
    await expect(assignUserRoleScope(owner, {
      commandId: ids.command,targetUserId: ids.target,role: "DELIVERY_GUY",
      scope: { type: "DELIVERY" },reason: "Canonical delivery role change",
    })).resolves.toMatchObject({ changed: true });
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it("rejects self-change, malformed scopes, incompatible role scopes, and historical roles before SQL", async () => {
    const invalidInputs = [
      { commandId: ids.command,targetUserId: ids.actor,role: "BRANCH_ADMIN",
        scope: { type: "BRANCH",companyId: ids.company,branchId: ids.branch },reason: "Self role change is prohibited" },
      { commandId: ids.command,targetUserId: ids.target,role: "BRANCH_ADMIN",
        scope: { type: "BRANCH",companyId: ids.company },reason: "Missing branch identifier" },
      { commandId: ids.command,targetUserId: ids.target,role: "COMPANY_ADMIN",
        scope: { type: "BRANCH",companyId: ids.company,branchId: ids.branch },reason: "Company role cannot use branch scope" },
      { commandId: ids.command,targetUserId: ids.target,role: "PLATFORM_OPERATIONS",
        scope: { type: "PLATFORM" },reason: "Historical role cannot be newly assigned" },
    ];
    for (const input of invalidInputs) {
      await expect(assignUserRoleScope(
        actor,input as Parameters<typeof assignUserRoleScope>[1],
      )).rejects.toThrow();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires an exact actor assignment and hides database policy details", async () => {
    await expect(assignUserRoleScope(
      { ...actor, roleAssignmentId: undefined },
      { commandId: ids.command,targetUserId: ids.target,role: "BRANCH_ADMIN",
        scope: { type: "BRANCH",companyId: ids.company,branchId: ids.branch },reason: "Missing normalized actor assignment" },
    )).rejects.toBeInstanceOf(RoleScopeManagementUnavailableError);
    mocks.query.mockRejectedValueOnce(new Error("private target role and tenant details"));
    await expect(assignUserRoleScope(actor, {
      commandId: ids.command,targetUserId: ids.target,role: "BRANCH_ADMIN",
      scope: { type: "BRANCH",companyId: ids.company,branchId: ids.branch },reason: "Database denial remains private",
    })).rejects.toThrow("The requested role or scope change could not be completed.");
  });

  it("revokes through the audited command and validates its result", async () => {
    await expect(revokeUserRoleScope(actor, {
      commandId: ids.command,roleAssignmentId: ids.assignment,reason: "Role coverage ended",
    })).resolves.toEqual({ roleAssignmentId: ids.assignment,authVersion: 6,revokedSessions: 2,changed: true });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_revoke_user_role_scope"),
      [ids.command,ids.actor,ids.actorAssignment,ids.assignment,"Role coverage ended"],
    );
    mocks.query.mockResolvedValueOnce({ rowCount: 1,rows: [{ roleAssignmentId: "invalid",authVersion: 0,revokedSessions: -1,changed: true }] });
    await expect(revokeUserRoleScope(actor, {
      commandId: ids.command,roleAssignmentId: ids.assignment,reason: "Malformed result fails closed",
    })).rejects.toBeInstanceOf(RoleScopeManagementUnavailableError);
  });
});
