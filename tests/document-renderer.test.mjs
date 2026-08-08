import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSafeDocumentSnapshot,
  buildDocumentSections,
  renderVersionedDocument,
} from "../server-tools/document-renderer.mjs";

function approvedSnapshot({ locale = "en", lineCount = 3 } = {}) {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    lineNumber: index + 1,
    name: locale === "ar" ? `منتج تجريبي ${index + 1}` : `Meeting room supply ${index + 1}`,
    description: "Long but customer-safe product description for deterministic wrapping and pagination.",
    quantity: "2.00",
    unitOfMeasure: "EA",
    unitSellPrice: "12.50",
    lineTotal: "25.00",
    taxAmount: "1.50",
    total: "26.50",
    substitutionAllowed: false,
  }));
  return {
    schemaVersion: 1,
    documentType: "APPROVED_REQUEST",
    locale,
    timezone: "Asia/Kuala_Lumpur",
    capturedAt: "2026-08-09T02:00:00.000Z",
    company: {
      name: locale === "ar" ? "شركة أكسورا التجريبية" : "Axora Demonstration Company",
      registrationNumber: "202601234567",
      address: "Kuala Lumpur, Malaysia",
    },
    request: {
      reference: "REQ-MEETING-001",
      version: 2,
      title: "Meeting readiness supplies",
      state: "APPROVED",
      revision: 2,
      branchName: "Kuala Lumpur",
      departmentName: "Operations",
      requesterName: "Demo Requester",
      deliveryAddress: "Level 12, Axora Tower, Kuala Lumpur",
      submittedAt: "2026-08-08T02:00:00.000Z",
      neededByDate: "2026-08-15",
      currency: "MYR",
      totalAmount: "79.50",
    },
    lines,
    lineItems: lines,
    items: lines,
    approval: {
      state: "APPROVED",
      approvedAt: "2026-08-09T01:00:00.000Z",
      history: [{ state: "APPROVED", actorName: "Company Approver", occurredAt: "2026-08-09T01:00:00.000Z" }],
    },
    budget: {
      currency: "MYR",
      approvedAmount: "79.50",
      reservedAmount: "79.50",
      balanceAfter: "1920.50",
    },
    timeline: [
      { event: "SUBMITTED", actorName: "Demo Requester", occurredAt: "2026-08-08T02:00:00.000Z" },
      { event: "APPROVED", actorName: "Company Approver", occurredAt: "2026-08-09T01:00:00.000Z" },
    ],
  };
}

describe("versioned PDF renderer", () => {
  it("rejects forbidden commercial internals recursively", () => {
    expect(() => assertSafeDocumentSnapshot({
      ...approvedSnapshot(),
      request: { marginAmount: "10.00" },
    })).toThrow(/forbidden/i);
    expect(() => assertSafeDocumentSnapshot({
      ...approvedSnapshot(),
      lines: [{ nested: { actual_buy_unit_price: "4.00" } }],
    })).toThrow(/forbidden/i);
  });

  it("builds localized English, Arabic and Malay sections from immutable input", () => {
    for (const locale of ["en", "ar", "ms"]) {
      const snapshot = approvedSnapshot({ locale });
      const before = JSON.stringify(snapshot);
      const model = buildDocumentSections(snapshot);
      expect(model.sections.length).toBeGreaterThan(2);
      expect(JSON.stringify(snapshot)).toBe(before);
    }
  });

  it("renders deterministic multi-page Arabic-safe PDFs with repeated page structure", async () => {
    const snapshot = approvedSnapshot({ locale: "ar", lineCount: 120 });
    const first = await renderVersionedDocument({ snapshot });
    const second = await renderVersionedDocument({ snapshot });
    expect(first.pageCount).toBeGreaterThan(1);
    expect(second.pageCount).toBe(first.pageCount);
    expect(first.bytes.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(first.pageCount);
    expect(second.bytes.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(second.pageCount);
    expect(first.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.bytes.subarray(-1024).toString()).toContain("%%EOF");
    expect(createHash("sha256").update(first.bytes).digest("hex"))
      .toBe(createHash("sha256").update(second.bytes).digest("hex"));
  }, 20_000);
});
