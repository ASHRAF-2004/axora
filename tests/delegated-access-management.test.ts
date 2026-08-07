import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  createDelegatedAccess,
  DelegatedAccessManagementUnavailableError,
  revokeDelegatedAccess,
} from "@/lib/delegated-access-management";

const ids = {
  actor: "10000000-0000-4000-8000-000000000041",
  actorAssignment: "20000000-0000-4000-8000-000000000041",
  grantee: "30000000-0000-4000-8000-000000000041",
  granteeAssignment: "40000000-0000-4000-8000-000000000041",
  command: "50000000-0000-4000-8000-000000000041",
  delegation: "60000000-0000-4000-8000-000000000041",
  company: "70000000-0000-4000-8000-000000000041",
  branch: "80000000-0000-4000-8000-000000000041",
  department: "90000000-0000-4000-8000-000000000041",
} as const;

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "owner@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.actorAssignment,
  isOwner: false,
  authVersion: 4,
};

const startsAt = new Date("2026-08-07T02:00:00.000Z");
const endsAt = new Date("2026-08-21T02:00:00.000Z");

function validInput() {
  return {
    commandId: ids.command,
    granteeUserId: ids.grantee,
    granteeRoleAssignmentId: ids.granteeAssignment,
    permissions: ["request.view", "document.download"],
    scopes: [
      {
        type: "DEPARTMENT" as const,
        companyId: ids.company,
        departmentId: ids.department,
      },
      {
        type: "BRANCH" as const,
        companyId: ids.company,
        branchId: ids.branch,
      },
    ],
    startsAt,
    endsAt,
    reason: "Temporary procurement coverage",
  };
}

describe("delegated access management service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        delegatedAccessId: ids.delegation,
        authVersion: 5,
        revokedSessions: 2,
        changed: true,
      }],
    });
  });

  it("submits one normalized, idempotent delegation command", async () => {
    const result = await createDelegatedAccess(actor, validInput());

    expect(result).toEqual({
      delegatedAccessId: ids.delegation,
      authVersion: 5,
      revokedSessions: 2,
      changed: true,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(sql).toContain("axora_create_delegated_access");
    expect(parameters).toEqual([
      ids.command,
      ids.actor,
      ids.actorAssignment,
      ids.grantee,
      ids.granteeAssignment,
      ["document.download", "request.view"],
      JSON.stringify([
        {
          type: "BRANCH",
          companyId: ids.company,
          branchId: ids.branch,
        },
        {
          type: "DEPARTMENT",
          companyId: ids.company,
          departmentId: ids.department,
        },
      ]),
      startsAt,
      endsAt,
      "Temporary procurement coverage",
    ]);
  });

  it("rejects self-delegation and malformed or excessive authority before SQL", async () => {
    const invalidInputs = [
      { ...validInput(), granteeUserId: ids.actor },
      {
        ...validInput(),
        permissions: ["request.view", "request.view"],
      },
      {
        ...validInput(),
        scopes: [
          {
            type: "BRANCH" as const,
            companyId: ids.company,
            branchId: ids.branch,
          },
          {
            type: "BRANCH" as const,
            companyId: ids.company,
            branchId: ids.branch,
          },
        ],
      },
      {
        ...validInput(),
        endsAt: new Date(startsAt.getTime() + 31 * 24 * 60 * 60 * 1000),
      },
      {
        ...validInput(),
        scopes: [{ type: "BRANCH", companyId: ids.company }],
      },
      {
        ...validInput(),
        permissions: ["forged.root"],
      },
    ];

    for (const input of invalidInputs) {
      await expect(createDelegatedAccess(
        actor,
        input as Parameters<typeof createDelegatedAccess>[1],
      )).rejects.toThrow();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a normalized actor and hides database policy details", async () => {
    await expect(createDelegatedAccess(
      { ...actor, roleAssignmentId: undefined },
      validInput(),
    )).rejects.toBeInstanceOf(DelegatedAccessManagementUnavailableError);

    mocks.query.mockRejectedValueOnce(new Error(
      "private tenant and permission details must not escape",
    ));
    await expect(createDelegatedAccess(actor, validInput()))
      .rejects.toThrow(
        "The requested delegated-access change could not be completed.",
      );
  });

  it("revokes through the audited command and validates its result", async () => {
    await expect(revokeDelegatedAccess(actor, {
      delegatedAccessId: ids.delegation,
      reason: "Coverage period ended early",
    })).resolves.toEqual({
      delegatedAccessId: ids.delegation,
      authVersion: 5,
      revokedSessions: 2,
      changed: true,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_revoke_delegated_access"),
      [
        ids.actor,
        ids.actorAssignment,
        ids.delegation,
        "Coverage period ended early",
      ],
    );

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        delegatedAccessId: "invalid",
        authVersion: 0,
        revokedSessions: -1,
        changed: true,
      }],
    });
    await expect(revokeDelegatedAccess(actor, {
      delegatedAccessId: ids.delegation,
      reason: "Invalid result should fail closed",
    })).rejects.toBeInstanceOf(DelegatedAccessManagementUnavailableError);
  });
});
