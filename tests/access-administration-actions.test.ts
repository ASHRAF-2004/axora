import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class AccessManagementUnavailableError extends Error {}
  return {
    AccessManagementUnavailableError,
    requirePermission: vi.fn(),
    requireRecentStepUp: vi.fn(),
    setUserPermissionOverride: vi.fn(),
    removeUserPermissionOverride: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  };
});

vi.mock("@/lib/access-management", () => ({
  AccessManagementUnavailableError: mocks.AccessManagementUnavailableError,
  setUserPermissionOverride: mocks.setUserPermissionOverride,
  removeUserPermissionOverride: mocks.removeUserPermissionOverride,
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
  requireRecentStepUp: mocks.requireRecentStepUp,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  removePermissionOverrideAction,
  setPermissionOverrideAction,
} from "@/app/(portal)/users/[id]/access/actions";

const ids = {
  actor: "10000000-0000-4000-8000-000000000143",
  actorAssignment: "20000000-0000-4000-8000-000000000143",
  target: "30000000-0000-4000-8000-000000000143",
  targetAssignment: "40000000-0000-4000-8000-000000000143",
  company: "50000000-0000-4000-8000-000000000143",
  branch: "60000000-0000-4000-8000-000000000143",
  override: "70000000-0000-4000-8000-000000000143",
};

const actor = {
  id: ids.actor,
  email: "administrator@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.actorAssignment,
  isOwner: false,
  authVersion: 4,
  timezone: "Asia/Kuala_Lumpur",
};

function changeForm() {
  const form = new FormData();
  form.set("permission", "request.submit");
  form.set("effect", "DENY");
  form.set("startsAt", "2026-08-07T04:00:00.000Z");
  form.set("endsAt", "");
  form.set("reason", "Temporary separation of purchasing duties");
  return form;
}

describe("access administration server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.requireRecentStepUp.mockResolvedValue(undefined);
    mocks.setUserPermissionOverride.mockResolvedValue({
      overrideId: ids.override,
      authVersion: 5,
      revokedSessions: 1,
      changed: true,
    });
    mocks.removeUserPermissionOverride.mockResolvedValue({
      overrideId: ids.override,
      authVersion: 6,
      revokedSessions: 1,
      changed: true,
    });
  });

  it("requires step-up and submits the selected server-bound scope", async () => {
    await expect(setPermissionOverrideAction(
      ids.target,
      ids.targetAssignment,
      "BRANCH",
      ids.company,
      ids.branch,
      undefined,
      undefined,
      changeForm(),
    )).rejects.toThrow(
      `REDIRECT:/users/${ids.target}/access?assignment=${ids.targetAssignment}&notice=override-applied`,
    );

    expect(mocks.requirePermission).toHaveBeenCalledWith("manage_users");
    expect(mocks.requireRecentStepUp).toHaveBeenCalledWith(
      actor,
      `/users/${ids.target}/access?assignment=${ids.targetAssignment}`,
    );
    expect(mocks.setUserPermissionOverride).toHaveBeenCalledWith(actor, {
      targetUserId: ids.target,
      targetRoleAssignmentId: ids.targetAssignment,
      permission: "request.submit",
      effect: "DENY",
      scope: {
        type: "BRANCH",
        companyId: ids.company,
        branchId: ids.branch,
      },
      startsAt: new Date("2026-08-07T04:00:00.000Z"),
      endsAt: undefined,
      reason: "Temporary separation of purchasing duties",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/users/${ids.target}/access`,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/users");
  });

  it("converts a local expiry using the actor's IANA timezone", async () => {
    const form = changeForm();
    form.set("endsAt", "2026-08-08T09:30");
    await expect(setPermissionOverrideAction(
      ids.target,
      ids.targetAssignment,
      "BRANCH",
      ids.company,
      ids.branch,
      undefined,
      undefined,
      form,
    )).rejects.toThrow(
      `REDIRECT:/users/${ids.target}/access?assignment=${ids.targetAssignment}&notice=override-applied`,
    );
    expect(mocks.setUserPermissionOverride).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        endsAt: new Date("2026-08-08T01:30:00.000Z"),
      }),
    );
  });

  it("rejects invalid form data before invoking the management command", async () => {
    const form = changeForm();
    form.set("reason", "x");
    await expect(setPermissionOverrideAction(
      ids.target,
      ids.targetAssignment,
      "BRANCH",
      ids.company,
      ids.branch,
      undefined,
      undefined,
      form,
    )).rejects.toThrow(
      `REDIRECT:/users/${ids.target}/access?assignment=${ids.targetAssignment}&notice=invalid-change`,
    );
    expect(mocks.setUserPermissionOverride).not.toHaveBeenCalled();
  });

  it("uses one non-revealing failure notice for a rejected database command", async () => {
    mocks.setUserPermissionOverride.mockRejectedValueOnce(
      new mocks.AccessManagementUnavailableError("private policy failure"),
    );
    await expect(setPermissionOverrideAction(
      ids.target,
      ids.targetAssignment,
      "BRANCH",
      ids.company,
      ids.branch,
      undefined,
      undefined,
      changeForm(),
    )).rejects.toThrow(
      `REDIRECT:/users/${ids.target}/access?assignment=${ids.targetAssignment}&notice=change-unavailable`,
    );
  });

  it("removes an override only through the audited service", async () => {
    const form = new FormData();
    form.set("reason", "Temporary coverage has ended");
    await expect(removePermissionOverrideAction(
      ids.target,
      ids.targetAssignment,
      ids.override,
      form,
    )).rejects.toThrow(
      `REDIRECT:/users/${ids.target}/access?assignment=${ids.targetAssignment}&notice=override-removed`,
    );
    expect(mocks.removeUserPermissionOverride).toHaveBeenCalledWith(actor, {
      overrideId: ids.override,
      reason: "Temporary coverage has ended",
    });
  });
});