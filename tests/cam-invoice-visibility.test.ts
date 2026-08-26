import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const operations = {
    quotations: [] as unknown[],
    approvals: [] as unknown[],
    deliveries: [] as unknown[],
    invoices: [] as Array<Record<string, unknown>>,
    payments: [] as Array<Record<string, unknown>>,
    audit: [] as unknown[],
    attachments: [] as unknown[],
  };
  return {
    operations,
    isDemoMode: vi.fn(() => true),
    query: vi.fn(),
    listAuthorizedRequests: vi.fn(),
    getDemoOperations: vi.fn(() => operations),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: mocks.isDemoMode,
  query: mocks.query,
}));
vi.mock("@/lib/request-reader", () => ({
  listAuthorizedRequests: mocks.listAuthorizedRequests,
}));
vi.mock("@/lib/demo-operations", () => ({
  getDemoOperations: mocks.getDemoOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { defaultPermissionsForRole } from "@/lib/authorization-policy";
import {
  canViewInternalFinance,
  listAuthorizedInvoices,
  listAuthorizedPayments,
} from "@/lib/operational-isolation";

const ids = {
  request: "10000000-0000-4000-8000-000000000120",
  actor: "20000000-0000-4000-8000-000000000120",
  assignment: "30000000-0000-4000-8000-000000000120",
} as const;

const cam: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "cam-invoice-fixture@example.test",
  name: "CAM invoice fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 1,
  effectivePermissions: ["view_requests", "view_invoices"],
};

const owner: AuthenticatedSessionUser = {
  ...cam,
  role: "PLATFORM_OWNER",
  isOwner: true,
  effectivePermissions: ["view_requests", "view_invoices", "manage_finance"],
};

function invoice(
  id: string,
  direction: "CUSTOMER" | "SUPPLIER",
) {
  return {
    id,
    direction,
    requestId: ids.request,
    orderCode: "ORD-CAM-120",
    counterparty: direction === "CUSTOMER" ? "Customer A" : "Private supplier",
    invoiceNumber: `INV-${id}`,
    invoiceDate: "2026-08-26",
    dueDate: "2026-09-02",
    amount: direction === "CUSTOMER" ? 100 : 60,
    status: "Issued",
    paidAmount: 0,
    outstandingAmount: direction === "CUSTOMER" ? 100 : 60,
    paymentStatus: "Unpaid",
    requestStatus: "Completed",
  };
}

describe("CAM customer invoice visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(true);
    mocks.listAuthorizedRequests.mockResolvedValue([{
      id: ids.request,
      lines: [],
    }]);
    mocks.operations.invoices.splice(
      0,
      mocks.operations.invoices.length,
      invoice("customer", "CUSTOMER"),
      invoice("supplier", "SUPPLIER"),
    );
    mocks.operations.payments.splice(
      0,
      mocks.operations.payments.length,
      {
        id: "payment-customer",
        invoiceId: "customer",
        invoiceNumber: "INV-customer",
        paymentDate: "2026-08-26",
        amount: 100,
        method: "Company Wallet",
      },
      {
        id: "payment-supplier",
        invoiceId: "supplier",
        invoiceNumber: "INV-supplier",
        paymentDate: "2026-08-26",
        amount: 60,
        method: "Bank Transfer",
      },
    );
  });

  it("includes customer invoice access in the CAM role without internal finance", () => {
    expect(defaultPermissionsForRole(
      "CLIENT_ACCOUNT_MANAGER",
      "PLATFORM",
    )).toContain("finance.invoice.view");
    expect(defaultPermissionsForRole(
      "CLIENT_ACCOUNT_MANAGER",
      "PLATFORM",
    )).not.toContain("finance.manage");
    expect(canViewInternalFinance(cam)).toBe(false);
  });

  it("shows CAMs only customer invoices and customer payments", async () => {
    await expect(listAuthorizedInvoices(cam)).resolves.toMatchObject([
      { id: "customer", direction: "CUSTOMER", amount: 100 },
    ]);
    await expect(listAuthorizedPayments(cam)).resolves.toMatchObject([
      { id: "payment-customer", invoiceId: "customer", amount: 100 },
    ]);
  });

  it("retains supplier finance only for internal finance authority", async () => {
    expect(canViewInternalFinance(owner)).toBe(true);
    await expect(listAuthorizedInvoices(owner)).resolves.toHaveLength(2);
    await expect(listAuthorizedPayments(owner)).resolves.toHaveLength(2);
  });

  it("uses finance.manage rather than platform scope for production supplier rows", async () => {
    mocks.isDemoMode.mockReturnValue(false);
    mocks.query.mockResolvedValue({ rows: [] });

    await listAuthorizedInvoices(cam);
    await listAuthorizedPayments(cam);

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("'finance.invoice.view'");
    expect(sql).toContain("'finance.manage'");
    expect(sql).not.toContain("'platform.view'");
  });
});
