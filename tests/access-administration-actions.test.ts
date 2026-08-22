import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  replaceUserPermissionSet: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("@/lib/access-management", () => ({
  replaceUserPermissionSet: mocks.replaceUserPermissionSet,
}));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { replacePermissionSetAction } from "@/app/(portal)/users/[id]/access/actions";

const target = "30000000-0000-4000-8000-000000000143";
const assignment = "40000000-0000-4000-8000-000000000143";
const actor = { id: "10000000-0000-4000-8000-000000000143", role: "PLATFORM_OWNER", isOwner: true };

describe("simple access administration action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.replaceUserPermissionSet.mockResolvedValue({ changed: true });
  });

  it("saves checked permissions once with an automatic audit reason", async () => {
    const form = new FormData();
    form.append("permissions", "company.view.assigned");
    form.append("permissions", "product.manage");
    await expect(replacePermissionSetAction(target, assignment, form)).rejects.toThrow(
      `REDIRECT:/users/${target}/access?assignment=${assignment}&notice=permissions-updated`,
    );
    expect(mocks.replaceUserPermissionSet).toHaveBeenCalledWith(actor, {
      targetUserId: target,
      targetRoleAssignmentId: assignment,
      permissions: ["company.view.assigned", "product.manage"],
      reason: "USER_PERMISSION_UPDATED",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/users");
  });

  it("uses a non-revealing result when the audited command is denied", async () => {
    mocks.replaceUserPermissionSet.mockRejectedValueOnce(new Error("private"));
    await expect(replacePermissionSetAction(target, assignment, new FormData())).rejects.toThrow(
      `REDIRECT:/users/${target}/access?assignment=${assignment}&notice=change-unavailable`,
    );
  });
});
