import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  AccessManagementUnavailableError,
  removeUserPermissionOverride,
  setUserPermissionOverride,
} from "@/lib/access-management";

const ids = {
  actor: "10000000-0000-4000-8000-000000000039",
  actorAssignment: "20000000-0000-4000-8000-000000000039",
  target: "30000000-0000-4000-8000-000000000039",
  targetAssignment: "40000000-0000-4000-8000-000000000039",
  company: "50000000-0000-4000-8000-000000000039",
  override: "60000000-0000-4000-8000-000000000039",
};

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "admin@example.test",
  name: "Company Admin",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.actorAssignment,
  isOwner: false,
  authVersion: 3,
};

describe("scoped permission management service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        overrideId: ids.override,
        authVersion: 4,
        revokedSessions: 2,
        changed: true,
      }],
    });
  });

  it("submits a normalized scoped grant to the database command", async () => {
    const startsAt = new Date("2026-08-06T10:00:00.000Z");
    const result = await setUserPermissionOverride(actor, {
      targetUserId: ids.target,
      targetRoleAssignmentId: ids.targetAssignment,
      permission: "request.approve.other",
      effect: "GRANT",
      scope: { type: "COMPANY", companyId: ids.company },
      startsAt,
      reason: "Temporary approval responsibility",
    });

    expect(result).toEqual({
      overrideId: ids.override,
      authVersion: 4,
      revokedSessions: 2,
      changed: true,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_set_user_permission_override"),
      [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        "request.approve.other",
        "GRANT",
        "COMPANY",
        ids.company,
        null,
        null,
        null,
        startsAt,
        null,
        "Temporary approval responsibility",
      ],
    );
  });

  it("rejects self-escalation, malformed scopes, unknown permissions, and invalid periods before SQL", async () => {
    const invalidInputs = [
      {
        targetUserId: ids.actor,
        targetRoleAssignmentId: ids.targetAssignment,
        permission: "request.approve.other",
        effect: "GRANT",
        scope: { type: "COMPANY", companyId: ids.company },
        reason: "Self change is prohibited",
      },
      {
        targetUserId: ids.target,
        targetRoleAssignmentId: ids.targetAssignment,
        permission: "request.approve.other",
        effect: "GRANT",
        scope: { type: "BRANCH", companyId: ids.company },
        reason: "Missing branch identifier",
      },
      {
        targetUserId: ids.target,
        targetRoleAssignmentId: ids.targetAssignment,
        permission: "forged.root",
        effect: "GRANT",
        scope: { type: "COMPANY", companyId: ids.company },
        reason: "Unknown permission",
      },
      {
        targetUserId: ids.target,
        targetRoleAssignmentId: ids.targetAssignment,
        permission: "request.approve.other",
        effect: "GRANT",
        scope: { type: "COMPANY", companyId: ids.company },
        startsAt: new Date("2026-08-07T00:00:00.000Z"),
        endsAt: new Date("2026-08-06T00:00:00.000Z"),
        reason: "Invalid time period",
      },
    ];

    for (const input of invalidInputs) {
      await expect(setUserPermissionOverride(
        actor,
        input as Parameters<typeof setUserPermissionOverride>[1],
      )).rejects.toThrow();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a normalized actor assignment and hides database policy details", async () => {
    await expect(setUserPermissionOverride(
      { ...actor, roleAssignmentId: undefined },
      {
        targetUserId: ids.target,
        targetRoleAssignmentId: ids.targetAssignment,
        permission: "request.approve.other",
        effect: "GRANT",
        scope: { type: "COMPANY", companyId: ids.company },
        reason: "No normalized actor assignment",
      },
    )).rejects.toBeInstanceOf(AccessManagementUnavailableError);

    mocks.query.mockRejectedValueOnce(new Error(
      "actor cannot grant request.approve.other to private target",
    ));
    await expect(setUserPermissionOverride(actor, {
      targetUserId: ids.target,
      targetRoleAssignmentId: ids.targetAssignment,
      permission: "request.approve.other",
      effect: "GRANT",
      scope: { type: "COMPANY", companyId: ids.company },
      reason: "Database denial remains private",
    })).rejects.toThrow("The requested access change could not be completed.");
  });

  it("removes an override through the audited command and validates its result", async () => {
    await expect(removeUserPermissionOverride(actor, {
      overrideId: ids.override,
      reason: "Coverage period ended",
    })).resolves.toMatchObject({ overrideId: ids.override, changed: true });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_remove_user_permission_override"),
      [ids.actor, ids.actorAssignment, ids.override, "Coverage period ended"],
    );

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ overrideId: "bad", authVersion: 0, revokedSessions: -1, changed: true }],
    });
    await expect(removeUserPermissionOverride(actor, {
      overrideId: ids.override,
      reason: "Invalid command result",
    })).rejects.toBeInstanceOf(AccessManagementUnavailableError);
  });
});
