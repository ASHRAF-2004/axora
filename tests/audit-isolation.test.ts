import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  isDemoMode: vi.fn(() => false),
  canAccess: vi.fn(() => true),
  listAuthorizedRequests: vi.fn(),
  listAuthorizedAttachments: vi.fn(),
  getDemoOperations: vi.fn(() => ({ audit: [] as unknown[] })),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  isDemoMode: mocks.isDemoMode,
}));
vi.mock("@/lib/permissions", () => ({ canAccess: mocks.canAccess }));
vi.mock("@/lib/request-reader", () => ({
  listAuthorizedRequests: mocks.listAuthorizedRequests,
}));
vi.mock("@/lib/document-isolation", () => ({
  listAuthorizedAttachments: mocks.listAuthorizedAttachments,
}));
vi.mock("@/lib/demo-operations", () => ({
  getDemoOperations: mocks.getDemoOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  AuditAccessUnavailableError,
  auditIsolationInternals,
  listAuthorizedAuditRecords,
} from "@/lib/audit-isolation";

const ids = {
  actor: "10000000-0000-4000-8000-000000000046",
  assignment: "20000000-0000-4000-8000-000000000046",
  company: "30000000-0000-4000-8000-000000000046",
  branch: "40000000-0000-4000-8000-000000000046",
  request: "50000000-0000-4000-8000-000000000046",
  line: "60000000-0000-4000-8000-000000000046",
  attachment: "70000000-0000-4000-8000-000000000046",
  audit: "80000000-0000-4000-8000-000000000046",
} as const;

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "auditor@example.test",
  name: "Scoped auditor",
  role: "AUDITOR",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: ids.company,
  branchId: ids.branch,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 2,
};

const visibleRequest = {
  id: ids.request,
  orderCode: "ORD-046",
  requestDate: "2026-08-07",
  requestType: "Standard" as const,
  companyId: ids.company,
  companyName: "Northwind Services",
  branchId: ids.branch,
  branchName: "Cyberjaya",
  department: "Operations",
  requestedBy: "Requester",
  requesterContact: "requester@example.test",
  neededByDate: "2026-08-12",
  urgency: "Normal" as const,
  status: "New Request" as const,
  approvalStatus: "Pending" as const,
  estimatedTotal: 10,
  lines: [{
    id: ids.line,
    code: "REQ-046",
    productName: "Paper",
    category: "Office",
    quantity: 1,
    unit: "Pack",
    unitBuyPrice: 0,
    unitSellPrice: 10,
    deliveryCharge: 0,
    deliveryStatus: "Not Scheduled" as const,
    quantityReceived: 0,
  }],
};

const visibleAttachment = {
  id: ids.attachment,
  entityType: "request",
  recordId: ids.request,
  fileName: "policy.pdf",
  contentType: "application/pdf",
  visibility: "CUSTOMER" as const,
  createdAt: "2026-08-07T12:00:00.000Z",
};

describe("audit isolation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.canAccess.mockReturnValue(true);
    mocks.listAuthorizedRequests.mockResolvedValue([visibleRequest]);
    mocks.listAuthorizedAttachments.mockResolvedValue([visibleAttachment]);
    mocks.query.mockResolvedValue({
      rows: [{
        id: ids.audit,
        entityType: "attachments",
        recordId: ids.attachment,
        action: "INSERT",
        actorName: actor.name,
        reason: "Uploaded document policy.pdf",
        occurredAt: "2026-08-07T12:00:00.000Z",
      }],
    });
  });

  it("builds company audit scope from trusted request, line, and attachment IDs", async () => {
    const records = await listAuthorizedAuditRecords(actor, {
      entityType: "attachments",
    });
    expect(records).toHaveLength(1);
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain("a.record_id=ANY");
    expect(sql).not.toMatch(/FROM\s+attachments\b/i);
    expect(values).toContain(ids.company);
    expect(values).toContainEqual([ids.request]);
    expect(values).toContainEqual([ids.line]);
    expect(values).toContainEqual([ids.attachment]);
  });

  it("does not trust posted branch or attachment ownership", async () => {
    await listAuthorizedAuditRecords(actor);
    expect(mocks.listAuthorizedRequests).toHaveBeenCalledWith(actor);
    expect(mocks.listAuthorizedAttachments).toHaveBeenCalledWith(actor);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("scoped_branch.id="),
      expect.arrayContaining([ids.branch]),
    );
  });

  it("keeps demo attachment audit rows aligned with the visible attachment set", async () => {
    mocks.isDemoMode.mockReturnValue(true);
    mocks.getDemoOperations.mockReturnValueOnce({
      audit: [
        {
          id: ids.audit,
          entityType: "attachments",
          recordId: ids.attachment,
          action: "INSERT",
          occurredAt: "2026-08-07T12:00:00.000Z",
        },
        {
          id: "90000000-0000-4000-8000-000000000046",
          entityType: "attachments",
          recordId: "a0000000-0000-4000-8000-000000000046",
          action: "INSERT",
          occurredAt: "2026-08-07T12:01:00.000Z",
        },
      ],
    });
    const records = await listAuthorizedAuditRecords(actor);
    expect(records.map((record) => record.recordId)).toEqual([ids.attachment]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("fails closed without audit permission or company scope", async () => {
    mocks.canAccess.mockReturnValueOnce(false);
    await expect(listAuthorizedAuditRecords(actor))
      .rejects.toBeInstanceOf(AuditAccessUnavailableError);

    mocks.canAccess.mockReturnValue(true);
    await expect(listAuthorizedAuditRecords({
      ...actor,
      companyId: undefined,
    })).rejects.toBeInstanceOf(AuditAccessUnavailableError);
  });

  it("recognizes only true platform-wide audit assignments", () => {
    expect(auditIsolationInternals.isPlatformAuditActor(actor)).toBe(false);
    expect(auditIsolationInternals.isPlatformAuditActor({
      ...actor,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      companyId: undefined,
      branchId: undefined,
      isOwner: true,
    })).toBe(true);
    expect(auditIsolationInternals.isPlatformAuditActor({
      ...actor,
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      scopeType: "COMPANY",
      branchId: undefined,
    })).toBe(false);
  });
});