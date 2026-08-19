import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  lockAuthorizedUserTarget: vi.fn(),
  withAuditTransaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  withAuditTransaction: mocks.withAuditTransaction,
}));
vi.mock("@/lib/user-isolation", () => ({
  lockAuthorizedUserTarget: mocks.lockAuthorizedUserTarget,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  ExistingUserManagementUnavailableError,
  updateManagedUserProfile,
} from "@/lib/existing-user-management";

const actor: AuthenticatedSessionUser = {
  id: "10000000-0000-4000-8000-000000000101",
  email: "owner@example.test",
  name: "Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "20000000-0000-4000-8000-000000000101",
  isOwner: true,
  authVersion: 1,
};
const targetId = "30000000-0000-4000-8000-000000000101";

describe("existing user profile management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockAuthorizedUserTarget.mockResolvedValue({ userId: targetId });
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: targetId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mocks.withAuditTransaction.mockImplementation(async (_context, callback) => (
      callback({ query: mocks.clientQuery })
    ));
  });

  it("updates only canonical profile/display metadata after reauthorizing the target", async () => {
    await updateManagedUserProfile(actor, {
      targetUserId: targetId,
      displayName: "Updated Person",
      jobTitle: "Purchasing Assistant",
      preferredLocale: "ms",
    });
    expect(mocks.lockAuthorizedUserTarget).toHaveBeenCalledWith(
      actor,targetId,"user.edit",expect.objectContaining({ query: mocks.clientQuery }),
    );
    expect(String(mocks.clientQuery.mock.calls[0]?.[0])).toContain("UPDATE public.user_profiles");
    expect(mocks.clientQuery.mock.calls[0]?.[1]).toEqual([
      targetId,"Updated Person","Purchasing Assistant","ms",
    ]);
    expect(String(mocks.clientQuery.mock.calls[1]?.[0])).toContain("UPDATE public.users SET display_name");
    const sql = mocks.clientQuery.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).not.toMatch(/password|token_hash|email\s*=/i);
  });

  it("rejects self-management and unsupported locale before any database mutation", async () => {
    await expect(updateManagedUserProfile(actor, {
      targetUserId: actor.id,displayName: "Owner Updated",jobTitle: "Owner",
      preferredLocale: "en",
    })).rejects.toBeInstanceOf(ExistingUserManagementUnavailableError);
    await expect(updateManagedUserProfile(actor, {
      targetUserId: targetId,displayName: "Target",jobTitle: "Buyer",
      preferredLocale: "xx",
    })).rejects.toThrow();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical profile row is unavailable", async () => {
    mocks.clientQuery.mockReset();
    mocks.clientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(updateManagedUserProfile(actor, {
      targetUserId: targetId,displayName: "Target",jobTitle: "Buyer",
      preferredLocale: "ar",
    })).rejects.toBeInstanceOf(ExistingUserManagementUnavailableError);
  });
});
