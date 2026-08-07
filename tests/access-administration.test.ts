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
  AccessAdministrationUnavailableError,
  loadAccessAdministration,
} from "@/lib/access-administration";

const ids = {
  actor: "10000000-0000-4000-8000-000000000043",
  actorAssignment: "20000000-0000-4000-8000-000000000043",
  target: "30000000-0000-4000-8000-000000000043",
  targetAssignment: "40000000-0000-4000-8000-000000000043",
  company: "50000000-0000-4000-8000-000000000043",
  branch: "60000000-0000-4000-8000-000000000043",
};
const capturedAt = new Date("2026-08-07T03:30:00.000Z");

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "administrator@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.actorAssignment,
  isOwner: false,
  authVersion: 5,
};

function validSnapshot() {
  const scope = {
    type: "BRANCH",
    companyId: ids.company,
    companyName: "Northwind Services",
    branchId: ids.branch,
    branchName: "Cyberjaya",
  };
  return {
    capturedAt: capturedAt.toISOString(),
    canManagePermissions: true,
    canViewHistory: true,
    selectedAssignmentId: ids.targetAssignment,
    selectedScope: scope,
    identity: {
      id: ids.target,
      displayName: "Purchase requester",
      email: "requester@example.test",
      accountKind: "COMPANY",
      accountStatus: "ACTIVE",
      active: true,
      authVersion: 8,
      setupCompleted: true,
      preferredLocale: "en",
      jobTitle: "Purchasing assistant",
    },
    assignments: [{
      id: ids.targetAssignment,
      roleKey: "REQUESTER",
      roleLabel: "Requester",
      scope,
      assignedAt: "2026-08-06T03:00:00.000Z",
      selected: true,
      manageable: true,
    }],
    rolePermissions: ["request.submit"],
    scopes: [scope],
    permissionOptions: [{
      code: "request.submit",
      group: "Requests",
      label: "Submit requests",
      description: "Submit a valid request into approval workflow.",
      highRisk: true,
      actorCanGrant: true,
      targetRoleIncludes: true,
      effective: true,
    }],
    permissionOverrides: [],
    approvalLimits: [],
    delegations: [],
    history: [],
  };
}

describe("access administration read service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ snapshot: validSnapshot() }],
    });
  });

  it("loads and strictly validates the scoped database snapshot", async () => {
    const result = await loadAccessAdministration(
      actor,
      ids.target,
      ids.targetAssignment,
      capturedAt,
    );

    expect(result.identity.displayName).toBe("Purchase requester");
    expect(result.capturedAt).toEqual(capturedAt);
    expect(result.assignments[0].assignedAt).toBeInstanceOf(Date);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_access_administration_snapshot"),
      [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        capturedAt,
      ],
    );
  });

  it("rejects mismatched identities, inconsistent assignment selection, and malformed private data", async () => {
    const mismatched = validSnapshot();
    mismatched.identity.id = ids.actor;
    mocks.query.mockResolvedValueOnce({ rows: [{ snapshot: mismatched }] });
    await expect(loadAccessAdministration(actor, ids.target))
      .rejects.toBeInstanceOf(AccessAdministrationUnavailableError);

    const inconsistent = validSnapshot();
    inconsistent.assignments[0].selected = false;
    mocks.query.mockResolvedValueOnce({ rows: [{ snapshot: inconsistent }] });
    await expect(loadAccessAdministration(actor, ids.target))
      .rejects.toBeInstanceOf(AccessAdministrationUnavailableError);

    const leaked = {
      ...validSnapshot(),
      passwordHash: "must-never-parse",
    };
    mocks.query.mockResolvedValueOnce({ rows: [{ snapshot: leaked }] });
    await expect(loadAccessAdministration(actor, ids.target))
      .rejects.toBeInstanceOf(AccessAdministrationUnavailableError);
  });

  it("treats malformed route identifiers as unavailable without querying policy state", async () => {
    await expect(loadAccessAdministration(actor, "not-a-uuid"))
      .rejects.toBeInstanceOf(AccessAdministrationUnavailableError);
    await expect(loadAccessAdministration(
      actor,
      ids.target,
      "not-a-role-assignment-uuid",
    )).rejects.toBeInstanceOf(AccessAdministrationUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a normalized actor, rejects demo mode, and hides database details", async () => {
    await expect(loadAccessAdministration(
      { ...actor, roleAssignmentId: undefined },
      ids.target,
    )).rejects.toBeInstanceOf(AccessAdministrationUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.isDemoMode.mockReturnValueOnce(true);
    await expect(loadAccessAdministration(actor, ids.target))
      .rejects.toBeInstanceOf(AccessAdministrationUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.query.mockRejectedValueOnce(new Error(
      "private table user_permission_overrides denied actor 10000000",
    ));
    await expect(loadAccessAdministration(actor, ids.target))
      .rejects.toThrow("The requested access administration view is unavailable.");
  });
});