import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(() => false),
  query: vi.fn(),
  withAuditTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: mocks.isDemoMode,
  query: mocks.query,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { getAuthorizedRequest } from "@/lib/request-reader";

const cam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "request-boundary@fixture.invalid",
  name: "Request boundary fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "21222222-2222-4222-8222-222222222222",
  isOwner: false,
  authVersion: 1,
  effectivePermissions: ["view_requests"],
} satisfies AuthenticatedSessionUser;

describe("request detail identifier boundary", () => {
  beforeEach(() => {
    mocks.isDemoMode.mockReturnValue(false);
    mocks.query.mockReset();
    mocks.withAuditTransaction.mockReset();
  });

  it("returns a controlled missing result before malformed production input reaches PostgreSQL", async () => {
    await expect(getAuthorizedRequest(cam, "not-a-valid-id"))
      .resolves.toBeUndefined();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("keeps bounded non-UUID demo request identifiers supported", async () => {
    mocks.isDemoMode.mockReturnValue(true);

    await expect(getAuthorizedRequest(cam, "order-1"))
      .resolves.toMatchObject({ id: "order-1" });
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });
});
