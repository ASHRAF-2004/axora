import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  ApprovalLimitManagementUnavailableError,
  removeApprovalLimit,
  setApprovalLimit,
} from "@/lib/approval-limit-management";

const ids = {
  actor: "10000000-0000-4000-8000-000000000040",
  actorAssignment: "20000000-0000-4000-8000-000000000040",
  target: "30000000-0000-4000-8000-000000000040",
  targetAssignment: "40000000-0000-4000-8000-000000000040",
  targetRole: "50000000-0000-4000-8000-000000000040",
  company: "60000000-0000-4000-8000-000000000040",
  branch: "70000000-0000-4000-8000-000000000040",
  department: "80000000-0000-4000-8000-000000000040",
  limit: "90000000-0000-4000-8000-000000000040",
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

const startsAt = new Date("2026-08-06T12:00:00.000Z");

describe("approval-limit management service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        approvalLimitId: ids.limit,
        affectedUsers: 1,
        revokedSessions: 2,
        changed: true,
      }],
    });
  });

  it("submits a normalized user approval limit to the database command", async () => {
    await expect(setApprovalLimit(actor, {
      subject: {
        type: "USER",
        userId: ids.target,
        roleAssignmentId: ids.targetAssignment,
      },
      permission: "request.approve.other",
      scope: { type: "BRANCH", companyId: ids.company, branchId: ids.branch },
      currency: "myr",
      maximumAmount: "12500.50",
      allowSelfApproval: false,
      startsAt,
      reason: "Temporary branch approval coverage",
    })).resolves.toEqual({
      approvalLimitId: ids.limit,
      affectedUsers: 1,
      revokedSessions: 2,
      changed: true,
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_set_approval_limit"),
      [
        ids.actor,
        ids.actorAssignment,
        ids.target,
        ids.targetAssignment,
        null,
        "request.approve.other",
        "BRANCH",
        ids.company,
        ids.branch,
        null,
        "MYR",
        "12500.50",
        false,
        startsAt,
        null,
        "Temporary branch approval coverage",
      ],
    );
  });

  it("supports role-level limits without inventing a target user", async () => {
    await setApprovalLimit(actor, {
      subject: { type: "ROLE", roleId: ids.targetRole },
      permission: "request.approve.other",
      scope: { type: "COMPANY", companyId: ids.company },
      currency: "MYR",
      maximumAmount: "5000",
      allowSelfApproval: false,
      startsAt,
      reason: "Standard company approver ceiling",
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_set_approval_limit"),
      [
        ids.actor,
        ids.actorAssignment,
        null,
        null,
        ids.targetRole,
        "request.approve.other",
        "COMPANY",
        ids.company,
        null,
        null,
        "MYR",
        "5000",
        false,
        startsAt,
        null,
        "Standard company approver ceiling",
      ],
    );
  });

  it("rejects unsafe subjects, amounts, scopes, currencies, self flags, and periods before SQL", async () => {
    const invalidInputs = [
      {
        subject: {
          type: "USER",
          userId: ids.actor,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1",
        allowSelfApproval: false,
        startsAt,
        reason: "Self change is prohibited",
      },
      {
        subject: { type: "ROLE", roleId: ids.targetRole },
        permission: "request.approve.self",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1",
        allowSelfApproval: true,
        startsAt,
        reason: "Role self approval is prohibited",
      },
      {
        subject: {
          type: "USER",
          userId: ids.target,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "BRANCH", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1",
        allowSelfApproval: false,
        startsAt,
        reason: "Missing branch identifier",
      },
      {
        subject: {
          type: "USER",
          userId: ids.target,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "RINGGIT",
        maximumAmount: "1",
        allowSelfApproval: false,
        startsAt,
        reason: "Invalid currency",
      },
      {
        subject: {
          type: "USER",
          userId: ids.target,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1.234",
        allowSelfApproval: false,
        startsAt,
        reason: "Too many decimals",
      },
      {
        subject: {
          type: "USER",
          userId: ids.target,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1",
        allowSelfApproval: true,
        startsAt,
        reason: "Mismatched self flag",
      },
      {
        subject: {
          type: "USER",
          userId: ids.target,
          roleAssignmentId: ids.targetAssignment,
        },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "1",
        allowSelfApproval: false,
        startsAt: new Date("2026-08-07T00:00:00.000Z"),
        endsAt: new Date("2026-08-06T00:00:00.000Z"),
        reason: "Invalid effective period",
      },
    ];

    for (const input of invalidInputs) {
      await expect(setApprovalLimit(
        actor,
        input as Parameters<typeof setApprovalLimit>[1],
      )).rejects.toThrow();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a normalized actor and hides database policy details", async () => {
    await expect(setApprovalLimit(
      { ...actor, roleAssignmentId: undefined },
      {
        subject: { type: "ROLE", roleId: ids.targetRole },
        permission: "request.approve.other",
        scope: { type: "COMPANY", companyId: ids.company },
        currency: "MYR",
        maximumAmount: "5000",
        allowSelfApproval: false,
        startsAt,
        reason: "Missing actor assignment",
      },
    )).rejects.toBeInstanceOf(ApprovalLimitManagementUnavailableError);

    mocks.query.mockRejectedValueOnce(new Error(
      "actor cannot set private company approval ceiling",
    ));
    await expect(setApprovalLimit(actor, {
      subject: { type: "ROLE", roleId: ids.targetRole },
      permission: "request.approve.other",
      scope: { type: "COMPANY", companyId: ids.company },
      currency: "MYR",
      maximumAmount: "5000",
      allowSelfApproval: false,
      startsAt,
      reason: "Database denial remains private",
    })).rejects.toThrow(
      "The requested approval-limit change could not be completed.",
    );
  });

  it("removes a limit through the audited command and validates its result", async () => {
    await expect(removeApprovalLimit(actor, {
      approvalLimitId: ids.limit,
      reason: "Approval responsibility ended",
    })).resolves.toMatchObject({ approvalLimitId: ids.limit, changed: true });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_remove_approval_limit"),
      [ids.actor, ids.actorAssignment, ids.limit, "Approval responsibility ended"],
    );

    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        approvalLimitId: "bad",
        affectedUsers: -1,
        revokedSessions: -1,
        changed: true,
      }],
    });
    await expect(removeApprovalLimit(actor, {
      approvalLimitId: ids.limit,
      reason: "Invalid command result",
    })).rejects.toBeInstanceOf(ApprovalLimitManagementUnavailableError);
  });
});
