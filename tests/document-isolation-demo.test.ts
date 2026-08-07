import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const operations = {
    quotations: [] as unknown[],
    approvals: [] as unknown[],
    deliveries: [] as Array<{ id: string; requestLineId: string }>,
    invoices: [] as Array<{
      id: string;
      requestId: string;
      direction: "CUSTOMER" | "SUPPLIER";
    }>,
    payments: [] as unknown[],
    audit: [] as unknown[],
    attachments: [] as Array<Record<string, unknown>>,
  };
  return {
    operations,
    query: vi.fn(),
    isDemoMode: vi.fn(() => true),
    withAuditTransaction: vi.fn(),
    canAccess: vi.fn(() => true),
    listAuthorizedRequests: vi.fn(),
    listDeliveries: vi.fn(),
    listInvoices: vi.fn(),
    addDemoAudit: vi.fn(),
    getDemoOperations: vi.fn(() => operations),
  };
});

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  isDemoMode: mocks.isDemoMode,
  withAuditTransaction: mocks.withAuditTransaction,
}));
vi.mock("@/lib/permissions", () => ({ canAccess: mocks.canAccess }));
vi.mock("@/lib/request-reader", () => ({
  listAuthorizedRequests: mocks.listAuthorizedRequests,
}));
vi.mock("@/lib/operations", () => ({
  listDeliveries: mocks.listDeliveries,
  listInvoices: mocks.listInvoices,
}));
vi.mock("@/lib/demo-operations", () => ({
  addDemoAudit: mocks.addDemoAudit,
  getDemoOperations: mocks.getDemoOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  createAuthorizedAttachment,
  DocumentAccessUnavailableError,
} from "@/lib/document-isolation";

const ids = {
  actor: "10000000-0000-4000-8000-000000000046",
  assignment: "20000000-0000-4000-8000-000000000046",
  company: "30000000-0000-4000-8000-000000000046",
  request: "40000000-0000-4000-8000-000000000046",
  line: "50000000-0000-4000-8000-000000000046",
} as const;

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "demo-documents@example.test",
  name: "Demo document manager",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 1,
};

const visibleRequest = {
  id: ids.request,
  lines: [{ id: ids.line }],
};

const textFile = () => new File(
  ["demo document"],
  "demo.txt",
  { type: "text/plain" },
);

describe("demo document target compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(true);
    mocks.canAccess.mockReturnValue(true);
    mocks.listAuthorizedRequests.mockResolvedValue([visibleRequest]);
    mocks.operations.invoices.splice(0);
    mocks.operations.deliveries.splice(0);
    mocks.operations.attachments.splice(0);
  });

  it("accepts the existing opaque demo invoice identifier", async () => {
    const invoiceId = `invoice-${ids.request}`;
    mocks.operations.invoices.push({
      id: invoiceId,
      requestId: ids.request,
      direction: "CUSTOMER",
    });

    const created = await createAuthorizedAttachment(actor, {
      entityType: "invoice",
      recordId: invoiceId,
      file: textFile(),
      visibility: "INTERNAL",
    }, new Date("2026-08-07T12:00:00.000Z"));

    expect(created.visibility).toBe("CUSTOMER");
    expect(mocks.operations.attachments[0]).toMatchObject({
      entityType: "invoice",
      recordId: invoiceId,
      visibility: "CUSTOMER",
    });
    expect(mocks.addDemoAudit).toHaveBeenCalledOnce();
  });

  it("accepts the existing opaque demo delivery identifier", async () => {
    const deliveryId = `delivery-${ids.line}`;
    mocks.operations.deliveries.push({
      id: deliveryId,
      requestLineId: ids.line,
    });

    const created = await createAuthorizedAttachment(actor, {
      entityType: "delivery",
      recordId: deliveryId,
      file: textFile(),
    });

    expect(created.visibility).toBe("CUSTOMER");
    expect(mocks.operations.attachments[0]).toMatchObject({
      entityType: "delivery",
      recordId: deliveryId,
    });
  });

  it("rejects unsafe opaque identifiers before resolving a demo parent", async () => {
    await expect(createAuthorizedAttachment(actor, {
      entityType: "invoice",
      recordId: "invoice/../../other tenant",
      file: textFile(),
    })).rejects.toBeInstanceOf(DocumentAccessUnavailableError);
    expect(mocks.listAuthorizedRequests).not.toHaveBeenCalled();
  });

  it("still requires a UUID before every production database call", async () => {
    mocks.isDemoMode.mockReturnValue(false);
    await expect(createAuthorizedAttachment(actor, {
      entityType: "invoice",
      recordId: `invoice-${ids.request}`,
      file: textFile(),
    })).rejects.toBeInstanceOf(DocumentAccessUnavailableError);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });
});
