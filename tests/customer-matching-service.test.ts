import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    appendWorkflowEvent: vi.fn(),
    notifyWorkflowAudience: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) => work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: mocks.appendWorkflowEvent,
  notifyWorkflowAudience: mocks.notifyWorkflowAudience,
}));

import type { SessionUser } from "@/lib/auth";
import { evaluateCustomerMatch } from "@/lib/customer-matching";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  company: "20000000-0000-4000-8000-000000000001",
  branch: "30000000-0000-4000-8000-000000000001",
  request: "40000000-0000-4000-8000-000000000001",
  requestLine: "50000000-0000-4000-8000-000000000001",
  receiptLine: "60000000-0000-4000-8000-000000000001",
  invoice: "70000000-0000-4000-8000-000000000001",
  idempotency: "80000000-0000-4000-8000-000000000001",
  match: "90000000-0000-4000-8000-000000000001",
  event: "a0000000-0000-4000-8000-000000000001",
};

const actor: SessionUser = {
  id: ids.actor,
  email: "finance@example.test",
  name: "Finance Reviewer",
  role: "FINANCE_REVIEWER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: ids.company,
  branchId: ids.branch,
  isOwner: false,
};

const input = {
  requestLineId: ids.requestLine,
  customerInvoiceId: ids.invoice,
  invoicedQuantity: 4,
  invoicedUnitPrice: 25,
  idempotencyKey: ids.idempotency,
};

const evidence = {
  requestId: ids.request,
  companyId: ids.company,
  branchId: ids.branch,
  orderedQuantity: 4,
  orderedUnitPrice: 25,
  receiptLineId: ids.receiptLine,
  receivedQuantity: 4,
  invoiceAmount: 100,
};

const existingReplay = {
  id: ids.match,
  requestLineId: ids.requestLine,
  customerInvoiceId: ids.invoice,
  invoicedQuantity: 4,
  invoicedUnitPrice: 25,
  evaluatedByUserId: ids.actor,
  status: "MATCHED" as const,
  exceptionCodes: [] as string[],
};

function isEvidenceQuery(sql: unknown) {
  return String(sql).includes("FROM request_lines line")
    && String(sql).includes("JOIN invoices invoice ON invoice.id=$2");
}

function isReplayQuery(sql: unknown) {
  return String(sql).includes("FROM customer_three_way_matches")
    && String(sql).includes("WHERE company_id=$1 AND idempotency_key=$2");
}

describe("customer three-way match service idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWorkflowEvent.mockResolvedValue({
      id: ids.event,
      companyId: ids.company,
      branchId: ids.branch,
      requestId: ids.request,
      aggregateType: "request",
      aggregateId: ids.request,
      eventKey: "three_way_match.completed",
      eventVersion: 1,
      correlationId: ids.request,
      occurredAt: "2026-08-02T08:00:00.000Z",
      created: true,
    });
    mocks.notifyWorkflowAudience.mockResolvedValue(1);
  });

  it("returns the persisted match for an exact replay without a second event or notification", async () => {
    mocks.client.query.mockImplementation(async (sql: unknown) => {
      if (isEvidenceQuery(sql)) return { rows: [evidence] };
      if (isReplayQuery(sql)) return { rows: [existingReplay] };
      throw new Error(`Unexpected query: ${String(sql)}`);
    });

    await expect(evaluateCustomerMatch(actor, input)).resolves.toEqual({
      id: ids.match,
      status: "MATCHED",
      exceptionCodes: [],
      created: false,
    });
    expect(mocks.appendWorkflowEvent).not.toHaveBeenCalled();
    expect(mocks.notifyWorkflowAudience).not.toHaveBeenCalled();
    expect(mocks.client.query.mock.calls.some(([sql]) => (
      String(sql).includes("SELECT 1 FROM customer_three_way_matches")
    ))).toBe(false);
  });

  it("rejects an idempotency key reused with different match evidence", async () => {
    mocks.client.query.mockImplementation(async (sql: unknown) => {
      if (isEvidenceQuery(sql)) return { rows: [evidence] };
      if (isReplayQuery(sql)) return {
        rows: [{ ...existingReplay, invoicedUnitPrice: 24 }],
      };
      throw new Error(`Unexpected query: ${String(sql)}`);
    });

    await expect(evaluateCustomerMatch(actor, input)).rejects.toThrow(
      "submission identifier was already used for different data",
    );
    expect(mocks.appendWorkflowEvent).not.toHaveBeenCalled();
    expect(mocks.notifyWorkflowAudience).not.toHaveBeenCalled();
  });

  it("creates and notifies once when the idempotency key is new", async () => {
    mocks.client.query.mockImplementation(async (sql: unknown) => {
      if (isEvidenceQuery(sql)) return { rows: [evidence] };
      if (isReplayQuery(sql)) return { rows: [] };
      if (String(sql).includes("SELECT 1 FROM customer_three_way_matches")) return { rows: [], rowCount: 0 };
      if (String(sql).includes("INSERT INTO customer_three_way_matches")) return {
        rows: [{ id: ids.match, status: "MATCHED", exceptionCodes: [] }],
      };
      throw new Error(`Unexpected query: ${String(sql)}`);
    });

    await expect(evaluateCustomerMatch(actor, input)).resolves.toEqual({
      id: ids.match,
      status: "MATCHED",
      exceptionCodes: [],
      created: true,
    });
    const duplicateQuery = mocks.client.query.mock.calls.find(([sql]) => (
      String(sql).includes("SELECT 1 FROM customer_three_way_matches")
    ));
    expect(String(duplicateQuery?.[0])).toContain("idempotency_key<>$4");
    expect(duplicateQuery?.[1]).toEqual([
      ids.invoice,
      ids.requestLine,
      ids.company,
      ids.idempotency,
    ]);
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(mocks.notifyWorkflowAudience).toHaveBeenCalledTimes(1);
  });

  it("treats a matching concurrent unique-key conflict as a no-op replay", async () => {
    let replayQueries = 0;
    mocks.client.query.mockImplementation(async (sql: unknown) => {
      if (isEvidenceQuery(sql)) return { rows: [evidence] };
      if (isReplayQuery(sql)) {
        replayQueries += 1;
        return { rows: replayQueries === 1 ? [] : [existingReplay] };
      }
      if (String(sql).includes("SELECT 1 FROM customer_three_way_matches")) return { rows: [], rowCount: 0 };
      if (String(sql).includes("INSERT INTO customer_three_way_matches")) return { rows: [] };
      throw new Error(`Unexpected query: ${String(sql)}`);
    });

    await expect(evaluateCustomerMatch(actor, input)).resolves.toEqual({
      id: ids.match,
      status: "MATCHED",
      exceptionCodes: [],
      created: false,
    });
    expect(replayQueries).toBe(2);
    expect(mocks.appendWorkflowEvent).not.toHaveBeenCalled();
    expect(mocks.notifyWorkflowAudience).not.toHaveBeenCalled();
  });
});
