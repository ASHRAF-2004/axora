import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(() => true),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: mocks.isDemoMode,
  query: mocks.query,
  withAuditTransaction: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  CompanyLifecycleUnavailableError,
  loadCompanyActivationContract,
} from "@/lib/company-lifecycle";

const cam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "cam-company-detail@fixture.invalid",
  name: "CAM company detail fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "21222222-2222-4222-8222-222222222222",
  isOwner: false,
  authVersion: 1,
  effectivePermissions: ["manage_companies"],
} satisfies AuthenticatedSessionUser;

describe("company activation contract identifier boundary", () => {
  it("supports an authorized non-UUID demo company identifier", async () => {
    mocks.isDemoMode.mockReturnValue(true);

    await expect(loadCompanyActivationContract(cam, "co-youruni"))
      .resolves.toMatchObject({
        companyId: "co-youruni",
        verificationStatus: "VERIFIED",
        verificationApprovalAvailable: false,
        verificationApprovalBlockers: [],
      });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("keeps the production database contract UUID-bound", async () => {
    mocks.isDemoMode.mockReturnValue(false);

    await expect(loadCompanyActivationContract(cam, "co-youruni"))
      .rejects.toBeInstanceOf(CompanyLifecycleUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
