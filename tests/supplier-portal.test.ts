import { describe, expect, it } from "vitest";
import {
  buildSupplierAcknowledgement,
  buildSupplierPortalSnapshot,
  buildSupplierQuotation,
  decodeSupplierQuotationNote,
  encodeSupplierQuotationNote,
  resolveSupplierPortalScope,
  supplierDocumentHistory,
  type SupplierMembershipRecord,
} from "@/lib/supplier-portal";

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  supplier: "20000000-0000-4000-8000-000000000001",
  competitor: "20000000-0000-4000-8000-000000000002",
  membership: "30000000-0000-4000-8000-000000000001",
  rfq: "40000000-0000-4000-8000-000000000001",
  competitorRfq: "40000000-0000-4000-8000-000000000002",
  clientEvent: "50000000-0000-4000-8000-000000000001",
};

const memberships: SupplierMembershipRecord[] = [{
  id: ids.membership,
  userId: ids.user,
  supplierId: ids.supplier,
  status: "ACTIVE",
}];

describe("supplier portal scope", () => {
  it("requires an active membership and removes all competitor rows", () => {
    const scope = resolveSupplierPortalScope(ids.user, ids.supplier, memberships);
    expect(() => resolveSupplierPortalScope(ids.user, ids.competitor, memberships))
      .toThrow("active supplier membership");
    const rfq = {
      id: ids.rfq,
      companyId: "60000000-0000-4000-8000-000000000001",
      supplierId: ids.supplier,
      requestLineId: "70000000-0000-4000-8000-000000000001",
      rfqReference: "RFQ-1",
      roundNumber: 1,
      status: "ISSUED",
      productName: "Paper",
      quantity: 10,
      unitOfMeasure: "ream",
    };
    const snapshot = buildSupplierPortalSnapshot(scope, {
      rfqs: [rfq, { ...rfq, id: ids.competitorRfq, supplierId: ids.competitor }],
      quotations: [{
        id: "80000000-0000-4000-8000-000000000001",
        rfqId: ids.competitorRfq,
        supplierId: ids.competitor,
        responseVersion: 1,
        responseStatus: "SUBMITTED",
        quotationReference: "COMPETITOR-PRICE",
        unitPrice: 1,
        deliveryCharge: 0,
        submittedAt: "2026-08-02T08:00:00.000Z",
      }],
      documents: [{
        id: "90000000-0000-4000-8000-000000000001",
        rfqId: ids.competitorRfq,
        supplierId: ids.competitor,
        documentVersion: 1,
        documentKind: "QUOTATION",
        fileName: "competitor.pdf",
        contentType: "application/pdf",
        sha256: "a".repeat(64),
        createdAt: "2026-08-02T08:00:00.000Z",
      }],
    });
    expect(snapshot.rfqs.map((row) => row.id)).toEqual([ids.rfq]);
    expect(snapshot.quotations).toEqual([]);
    expect(snapshot.documents).toEqual([]);
  });

  it("binds acknowledgement and quotation authorship to the membership", () => {
    const scope = resolveSupplierPortalScope(ids.user, ids.supplier, memberships);
    const acknowledgement = buildSupplierAcknowledgement(scope, {
      rfqId: ids.rfq,
      acknowledgement: "ACKNOWLEDGED",
      clientEventId: ids.clientEvent,
      acknowledgedAt: "2026-08-02T08:00:00.000Z",
    });
    expect(acknowledgement).toMatchObject({
      supplierId: ids.supplier,
      supplierMembershipId: ids.membership,
      acknowledgedBy: ids.user,
    });
    const quotation = buildSupplierQuotation(scope, {
      rfqId: ids.rfq,
      responseVersion: 1,
      responseStatus: "SUBMITTED",
      quotationReference: "Q-100",
      unitPrice: 12.5,
      deliveryCharge: 3,
      availability: "AVAILABLE",
      clientEventId: ids.clientEvent,
      submittedAt: "2026-08-02T08:05:00.000Z",
    });
    expect(quotation.submittedBy).toBe(ids.user);
    expect(quotation.supplierId).toBe(ids.supplier);
  });

  it("returns append-only document versions only for the scoped supplier", () => {
    const scope = resolveSupplierPortalScope(ids.user, ids.supplier, memberships);
    const common = {
      rfqId: ids.rfq,
      supplierId: ids.supplier,
      documentKind: "QUOTATION" as const,
      fileName: "quote.pdf",
      contentType: "application/pdf",
      sha256: "b".repeat(64),
      createdAt: "2026-08-02T08:00:00.000Z",
    };
    const history = supplierDocumentHistory(scope, ids.rfq, [
      { ...common, id: "a0000000-0000-4000-8000-000000000002", documentVersion: 2 },
      { ...common, id: "a0000000-0000-4000-8000-000000000001", documentVersion: 1 },
      { ...common, id: "a0000000-0000-4000-8000-000000000003", documentVersion: 3, supplierId: ids.competitor },
    ]);
    expect(history.map((document) => document.documentVersion)).toEqual([1, 2]);
  });

  it("stores availability in a bounded backward-compatible quotation note envelope", () => {
    const encoded = encodeSupplierQuotationNote("PARTIAL", "Five units are ready now.");
    expect(decodeSupplierQuotationNote(encoded)).toEqual({
      availability: "PARTIAL",
      note: "Five units are ready now.",
    });
    expect(decodeSupplierQuotationNote("Legacy supplier note")).toEqual({ note: "Legacy supplier note" });
  });
});
