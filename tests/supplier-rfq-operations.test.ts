import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    appendWorkflowEvent: vi.fn(),
    notifyWorkflowAudience: vi.fn(),
    notifyWorkflowUsers: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: vi.fn(),
  withAuditTransaction: vi.fn(async (_context, work) => work(mocks.client)),
}));

vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: mocks.appendWorkflowEvent,
  notifyWorkflowAudience: mocks.notifyWorkflowAudience,
  notifyWorkflowUsers: mocks.notifyWorkflowUsers,
}));

import { issueSupplierRfq } from "@/lib/operations";

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  company: "20000000-0000-4000-8000-000000000001",
  branch: "30000000-0000-4000-8000-000000000001",
  request: "40000000-0000-4000-8000-000000000001",
  line: "50000000-0000-4000-8000-000000000001",
  supplier: "60000000-0000-4000-8000-000000000001",
  supplierUser: "70000000-0000-4000-8000-000000000001",
  rfq: "80000000-0000-4000-8000-000000000001",
};

const actor = {
  id: ids.owner,
  name: "Platform owner",
  role: "PLATFORM_OWNER" as const,
  accountKind: "PLATFORM" as const,
  scopeType: "PLATFORM" as const,
  isOwner: true,
};

describe("supplier RFQ operations workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWorkflowEvent.mockResolvedValue({
      id: "90000000-0000-4000-8000-000000000001",
      companyId: ids.company,
      requestId: ids.request,
      aggregateType: "supplier-rfq",
      aggregateId: ids.rfq,
      eventKey: "quotation.requested",
      eventVersion: 1,
      correlationId: ids.request,
      occurredAt: "2026-08-02T08:00:00.000Z",
      created: true,
    });
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM request_lines line") && sql.includes("request_status.label='Waiting for Quotation'")) return { rows: [{
        requestId: ids.request,
        companyId: ids.company,
        branchId: ids.branch,
        requestLineId: ids.line,
        supplierId: ids.supplier,
      }] };
      if (sql.includes("max(round_number)")) return { rows: [{ value: 1 }] };
      if (sql.includes("INSERT INTO supplier_rfqs")) return { rows: [{ id: ids.rfq }], rowCount: 1 };
      if (sql.includes("FROM supplier_memberships membership")) return { rows: [{ id: ids.supplierUser }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it("issues one tenant-bound RFQ and notifies the requester and scoped supplier users", async () => {
    await expect(issueSupplierRfq({
      requestLineId: ids.line,
      supplierId: ids.supplier,
      reference: "RFQ-2026-100",
      respondBy: "2099-08-10T10:00:00.000Z",
      specification: "Quote the approved specification only.",
      idempotencyKey: "90000000-0000-4000-8000-000000000002",
    }, actor)).resolves.toBe(ids.rfq);

    const eligibility = mocks.client.query.mock.calls.find(([sql]) => String(sql).includes("request_status.label='Waiting for Quotation'"));
    expect(String(eligibility?.[0])).toContain("approval.status='Approved'");
    expect(String(eligibility?.[0])).toContain("supplier.company_id IS NULL");
    expect(eligibility?.[1]).toEqual([ids.line, ids.supplier]);
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      companyId: ids.company,
      branchId: ids.branch,
      requestId: ids.request,
      aggregateType: "supplier-rfq",
      aggregateId: ids.rfq,
      eventKey: "quotation.requested",
      metadata: { requestLineId: ids.line },
    }));
    expect(JSON.stringify(mocks.appendWorkflowEvent.mock.calls[0]?.[1])).not.toContain(ids.supplier);
    expect(mocks.notifyWorkflowAudience).toHaveBeenCalledWith(mocks.client, expect.anything(), expect.objectContaining({
      audiences: ["REQUEST_CREATOR"],
    }));
    expect(mocks.notifyWorkflowUsers).toHaveBeenCalledWith(mocks.client, expect.anything(), expect.objectContaining({
      recipientUserIds: [ids.supplierUser],
      routePath: `/supplier#rfq-${ids.rfq}`,
    }));
  });

  it("refuses an ineligible or cross-scope request line before inserting an RFQ", async () => {
    mocks.client.query.mockResolvedValueOnce({ rows: [] });
    await expect(issueSupplierRfq({
      requestLineId: ids.line,
      supplierId: ids.supplier,
      reference: "RFQ-2026-101",
      respondBy: "2099-08-10T10:00:00.000Z",
      idempotencyKey: "90000000-0000-4000-8000-000000000003",
    }, actor)).rejects.toThrow("approved request line");
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO supplier_rfqs"))).toBe(false);
  });
});
