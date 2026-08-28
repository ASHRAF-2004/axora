import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  isDemoMode: vi.fn(() => false),
}));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  isDemoMode: mocks.isDemoMode,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  loadOrganizationDirectory,
  loadOrganizationResourceAccess,
  OrganizationAccessUnavailableError,
} from "@/lib/organization-access";

const ids = {
  actor: "10000000-0000-4000-8000-000000000044",
  assignment: "20000000-0000-4000-8000-000000000044",
  company: "30000000-0000-4000-8000-000000000044",
  branch: "40000000-0000-4000-8000-000000000044",
} as const;
const capturedAt = new Date("2026-08-07T06:30:00.000Z");

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "manager@example.test",
  name: "Client account manager",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 4,
};

function validDirectory() {
  return {
    capturedAt: capturedAt.toISOString(),
    companies: [{
      id: ids.company,
      code: "C-044",
      name: "Northwind Services",
      industry: "Facilities",
      mainContactName: "Operations Lead",
      mainContactEmail: "operations@example.test",
      mainContactPhone: "+601100000001",
      billingContactName: "Finance Lead",
      billingContactEmail: "finance@example.test",
      billingContactPhone: "+601100000002",
      billingAddress: "Cyberjaya",
      paymentTerms: "Standard billing terms",
      billingCycle: "Monthly",
      taxRate: 0,
      estimatedDeliveryFee: 15,
      status: "Active",
    }],
    branches: [{
      id: ids.branch,
      code: "B-044",
      companyId: ids.company,
      companyName: "Northwind Services",
      name: "Cyberjaya",
      branchCode: "CYB-044",
      deliveryAddress: "Cyberjaya",
      city: "Cyberjaya",
      contactName: "Branch Lead",
      contactPhone: "+601100000003",
      contactEmail: "branch@example.test",
      canViewBudget: true,
      monthlyBudget: 10000,
      committedAmount: 2500,
      remainingAmount: 7500,
      status: "Active",
    }],
  };
}

function validResourceAccess(): {
  capturedAt: string;
  permission: string;
  resourceType: string;
  resourceId: string;
  active: boolean;
  scope: {
    type: string;
    companyId: string;
    branchId: string;
  };
} {
  return {
    capturedAt: capturedAt.toISOString(),
    permission: "organization.branch.view",
    resourceType: "BRANCH",
    resourceId: ids.branch,
    active: true,
    scope: {
      type: "BRANCH",
      companyId: ids.company,
      branchId: ids.branch,
    },
  };
}

describe("organization isolation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ snapshot: validDirectory() }],
    });
  });

  it("loads and strictly validates the minimized organization directory", async () => {
    const directory = await loadOrganizationDirectory(actor, capturedAt);
    expect(directory.companies.map((company) => company.id))
      .toEqual([ids.company]);
    expect(directory.branches[0]).toMatchObject({
      id: ids.branch,
      canViewBudget: true,
      remainingAmount: 7500,
    });
    expect(directory.capturedAt).toEqual(capturedAt);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_organization_directory_snapshot"),
      [ids.actor, ids.assignment, capturedAt],
    );
  });

  it("rejects duplicate rows, leaked fields, and hidden budget values", async () => {
    const duplicate = validDirectory();
    duplicate.companies.push({ ...duplicate.companies[0] });
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: duplicate }],
    });
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toBeInstanceOf(OrganizationAccessUnavailableError);

    const leaked = {
      ...validDirectory(),
      passwordHash: "must-not-parse",
    };
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: leaked }],
    });
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toBeInstanceOf(OrganizationAccessUnavailableError);

    const hidden = validDirectory();
    hidden.branches[0] = {
      ...hidden.branches[0],
      canViewBudget: false,
    };
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: hidden }],
    });
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toBeInstanceOf(OrganizationAccessUnavailableError);
  });

  it("loads only a matching trusted resource decision", async () => {
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: validResourceAccess() }],
    });
    const access = await loadOrganizationResourceAccess(actor, {
      permission: "organization.branch.view",
      resourceType: "BRANCH",
      resourceId: ids.branch,
      capturedAt,
    });
    expect(access.scope).toEqual({
      type: "BRANCH",
      companyId: ids.company,
      branchId: ids.branch,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_organization_resource_access"),
      [
        ids.actor,
        ids.assignment,
        "organization.branch.view",
        "BRANCH",
        ids.branch,
        capturedAt,
      ],
    );

    const mismatched = validResourceAccess();
    mismatched.resourceId = ids.company;
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: mismatched }],
    });
    await expect(loadOrganizationResourceAccess(actor, {
      permission: "organization.branch.view",
      resourceType: "BRANCH",
      resourceId: ids.branch,
      capturedAt,
    })).rejects.toBeInstanceOf(OrganizationAccessUnavailableError);
  });

  it("fails before querying for malformed or non-normalized requests", async () => {
    await expect(loadOrganizationResourceAccess(actor, {
      permission: "organization.branch.view",
      resourceType: "BRANCH",
      resourceId: "not-a-uuid",
      capturedAt,
    })).rejects.toBeInstanceOf(OrganizationAccessUnavailableError);
    await expect(loadOrganizationDirectory(
      { ...actor, roleAssignmentId: undefined },
      capturedAt,
    )).rejects.toBeInstanceOf(OrganizationAccessUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("uses one generic error for database denial, missing rows, and malformed snapshots", async () => {
    mocks.query.mockRejectedValueOnce(new Error(
      "private company a1000000 denied to actor d2000000",
    ));
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toThrow("The requested organization resource is unavailable.");

    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ snapshot: null }] });
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toThrow("The requested organization resource is unavailable.");

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ snapshot: { ...validDirectory(), capturedAt: "invalid" } }],
    });
    await expect(loadOrganizationDirectory(actor, capturedAt))
      .rejects.toThrow("The requested organization resource is unavailable.");
  });

  it("gives a permitted demo CAM only its assigned company directory", async () => {
    mocks.isDemoMode.mockReturnValue(true);
    global.__axoraDemoCompanyManagerAssignments = undefined;
    const cam: AuthenticatedSessionUser = {
      ...actor,
      id: "20222222-2222-4222-8222-222222222222",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      companyId: undefined,
    };
    const directory = await loadOrganizationDirectory(cam, capturedAt);
    expect(directory.companies.map((company) => company.id).sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "co-youruni",
    ]);
    expect(directory.companies.map((company) => company.id))
      .not.toContain("co-excel");
    expect(directory.companies.map((company) => company.id))
      .not.toContain("co-unibax");
    expect(directory.branches.length).toBeGreaterThan(0);
  });
});
