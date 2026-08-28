import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withAuditTransaction: vi.fn(async (_context: unknown, work: (client: { query: typeof mocks.query }) => unknown) => work({ query: mocks.query })),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import { getRequestOrderWorkspace } from "@/lib/request-order-workspace";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { ProcurementRequest } from "@/lib/types";

const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  roleAssignmentId: "10000000-0000-4000-8000-000000000002",
  role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY",
  companyId: "20000000-0000-4000-8000-000000000001",
  email: "admin@example.test", name: "Admin", isOwner: false,
} as AuthenticatedSessionUser;

const request = {
  id: "30000000-0000-4000-8000-000000000001",
  orderCode: "ORD-2026-0109",
  requestDate: "2026-08-25T00:00:00.000Z",
  companyId: actor.companyId,
  lines: [],
} as unknown as ProcurementRequest;

describe("canonical Request order workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "request-workspace-test-secret-that-is-at-least-32-bytes";
  });

  it("projects completed modern delivery, invoice and customer-safe proof", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      deliveryId: "40000000-0000-4000-8000-000000000001",
      deliveryCode: "DEL-20260825-40000000", deliveryStatus: "COMPLETED",
      statusChangedAt: "2026-08-25T10:00:00.000Z", deliveredAt: "2026-08-25T09:55:00.000Z",
      driverUserId: "50000000-0000-4000-8000-000000000001", driverName: "Delivery Agent",
      receiverName: "Front desk", proofPolicy: ["PHOTO"], canConfirmReceipt: true,
      deliveryLines: [{ id: "45000000-0000-4000-8000-000000000001",
        productName: "Ball pen", unit: "piece", plannedQuantity: 1,
        deliveredQuantity: 1 }],
      evidence: [{ id: "60000000-0000-4000-8000-000000000001", type: "PHOTO",
        fileName: "proof.jpg", contentType: "image/jpeg",
        capturedAt: "2026-08-25T09:54:00.000Z" }],
      invoiceId: "70000000-0000-4000-8000-000000000001", invoiceNumber: "AX-INV-2026-00000001",
      invoiceStatus: "FINALIZED", invoiceAmount: 4.29, invoicePaidAmount: 4.29,
      invoiceDate: "2026-08-25", invoiceFinalizedAt: "2026-08-25T08:00:00.000Z",
    }] });
    const workspace = await getRequestOrderWorkspace(actor, request);
    expect(workspace.delivery).toMatchObject({ status: "COMPLETED", receiverName: "Front desk", canConfirmReceipt: true });
    expect(workspace.delivery?.lines).toEqual([expect.objectContaining({
      productName: "Ball pen", deliveredQuantity: 1,
    })]);
    expect(workspace.delivery?.evidence[0]?.accessUrl).toMatch(/^\/api\/delivery-evidence\//);
    expect(workspace.invoice).toMatchObject({ paymentStatus: "PAID", outstandingAmount: 0 });
    expect(workspace).not.toHaveProperty("latitude");
    expect(JSON.stringify(workspace)).not.toMatch(/storagePath|deviceId|sequence|otp|supplier|margin|buying/i);
  });

  it("authorizes request, delivery, invoice and receipt independently", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await getRequestOrderWorkspace(actor, request);
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("'request.view'");
    expect(sql).toContain("'delivery.view'");
    expect(sql).toContain("'finance.invoice.view'");
    expect(sql).toContain("'receiving.confirm'");
    expect(sql).not.toMatch(/latitude|longitude|storage_path|device_id|device_sequence|code_hash/);
  });

  it("makes modern delivery-job state override the legacy request-line fallback", async () => {
    const source = await readFile(new URL("../src/lib/request-reader.ts", import.meta.url), "utf8");
    expect(source.indexOf("WHEN modern_delivery.status IS NOT NULL"))
      .toBeLessThan(source.indexOf("WHEN received.quantity>=line.quantity"));
    expect(source).toContain("WHEN 'COMPLETED' THEN 'Completed'");
    expect(source).toContain("JOIN public.delivery_jobs job");
  });
});
