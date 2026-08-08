import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = { requests: [] as Array<Record<string, unknown>> };
  return {
    store,
    createRequest: vi.fn(),
    updateRequestStatus: vi.fn(),
    requireCreationScope: vi.fn().mockResolvedValue({
      type: "BRANCH",
      companyId: "10000000-0000-4000-8000-000000000050",
      branchId: "20000000-0000-4000-8000-000000000050",
    }),
    requirePermission: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => true,
  withAuditTransaction: vi.fn(),
}));
vi.mock("@/lib/demo-data", () => ({ getDemoStore: () => mocks.store }));
vi.mock("@/lib/permissions", () => ({ canAccess: () => true }));
vi.mock("@/lib/repository", () => ({
  createRequest: mocks.createRequest,
  updateRequestStatus: mocks.updateRequestStatus,
}));
vi.mock("@/lib/request-isolation", () => ({
  lockRequestCreationScope: vi.fn(),
  lockRequestResourceAccess: vi.fn(),
  requireDemoRequestCreationScope: mocks.requireCreationScope,
  requireDemoRequestPermission: mocks.requirePermission,
  RequestAccessUnavailableError: class RequestAccessUnavailableError extends Error {},
}));
vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: vi.fn(),
  notifyWorkflowAudience: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  createAuthorizedRequest,
  requestWriterInternals,
} from "@/lib/request-writer";

const submissionKey = "30000000-0000-4000-8000-000000000050";
const requestId = "40000000-0000-4000-8000-000000000050";
const productId = "50000000-0000-4000-8000-000000000050";

const actor: AuthenticatedSessionUser = {
  id: "60000000-0000-4000-8000-000000000050",
  email: "requester@example.test",
  name: "Requester",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: "10000000-0000-4000-8000-000000000050",
  branchId: "20000000-0000-4000-8000-000000000050",
  roleAssignmentId: "70000000-0000-4000-8000-000000000050",
  isOwner: false,
  authVersion: 1,
};

const input = {
  companyId: actor.companyId!,
  branchId: actor.branchId!,
  requestType: "Standard" as const,
  department: "Operations",
  neededByDate: "2026-08-12",
  urgency: "Normal" as const,
  notes: "Retry-safe request",
  lines: [{
    productId,
    quantity: 1,
    specification: "80 gsm",
  }],
};

describe("retry-safe request writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.requests.splice(0);
    mocks.createRequest.mockImplementation(async (_input, currentActor) => {
      mocks.store.requests.push({
        id: requestId,
        createdById: currentActor.id,
        orderCode: "ORD-050",
        requestDate: "2026-08-08",
        requestType: "Standard",
        companyId: actor.companyId,
        companyName: "Northwind Services",
        branchId: actor.branchId,
        branchName: "Cyberjaya",
        department: "Operations",
        requestedBy: currentActor.name,
        requesterContact: currentActor.email,
        neededByDate: "2026-08-12",
        urgency: "Normal",
        status: "New Request",
        approvalStatus: "Pending",
        estimatedTotal: 14,
        lines: [],
      });
      return requestId;
    });
  });

  it("returns the original request for a repeated creator and key", async () => {
    await expect(createAuthorizedRequest(input, actor, submissionKey))
      .resolves.toBe(requestId);
    await expect(createAuthorizedRequest(input, actor, submissionKey))
      .resolves.toBe(requestId);

    expect(mocks.createRequest).toHaveBeenCalledOnce();
    expect(mocks.store.requests[0]).toMatchObject({
      createdById: actor.id,
      clientSubmissionKey: submissionKey,
    });
  });

  it("does not treat the same key as global across users", async () => {
    await createAuthorizedRequest(input, actor, submissionKey);
    const secondActor = {
      ...actor,
      id: "80000000-0000-4000-8000-000000000050",
      email: "second@example.test",
    };
    mocks.createRequest.mockImplementationOnce(async (_input, currentActor) => {
      const id = "90000000-0000-4000-8000-000000000050";
      mocks.store.requests.push({
        ...mocks.store.requests[0],
        id,
        createdById: currentActor.id,
        clientSubmissionKey: undefined,
      });
      return id;
    });

    await expect(createAuthorizedRequest(input, secondActor, submissionKey))
      .resolves.toBe("90000000-0000-4000-8000-000000000050");
    expect(mocks.createRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed submission identities before creating anything", async () => {
    expect(requestWriterInternals.validSubmissionKey(submissionKey)).toBe(true);
    expect(requestWriterInternals.validSubmissionKey("not-a-uuid")).toBe(false);
    await expect(createAuthorizedRequest(input, actor, "not-a-uuid"))
      .rejects.toThrow();
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });
});
