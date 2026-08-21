import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePagePermission: vi.fn(),
  loadCompanyLifecycleWorkspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({
  requirePagePermission: mocks.requirePagePermission,
}));
vi.mock("@/lib/company-lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/company-lifecycle")>(),
  findAuthorizedCompanyLifecycleRecord: vi.fn(),
  loadCompanyLifecycleWorkspace: mocks.loadCompanyLifecycleWorkspace,
}));

import CompanyAssignmentPage from "@/app/(portal)/companies/[companyId]/assignment/page";

describe("company CAM assignment route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed for an assigned CAM before loading the company or manager roster", async () => {
    mocks.requirePagePermission.mockResolvedValue({
      id: "d9000000-0000-4000-8000-000000000001",
      email: "cam@example.test",
      name: "Assigned CAM",
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      roleAssignmentId: "d9000000-0000-4000-8000-000000000002",
      isOwner: false,
      authVersion: 1,
      preferredLocale: "en",
    });
    await expect(CompanyAssignmentPage({
      params: Promise.resolve({
        companyId: "d9000000-0000-4000-8000-000000000003",
      }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
    expect(mocks.loadCompanyLifecycleWorkspace).not.toHaveBeenCalled();
  });
});
