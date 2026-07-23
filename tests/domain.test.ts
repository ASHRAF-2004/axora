import { describe, expect, it } from "vitest";
import { calculateLineAmounts, calculateTotals, REQUEST_STATUSES } from "@/lib/domain";
import type { ProcurementRequest, RequestLine, RequestStatus } from "@/lib/types";

function line(index: number, quantity: number, unitBuyPrice: number, unitSellPrice: number, deliveryCharge: number): RequestLine {
  return {
    id: `line-${index}`,
    code: `REQ-TEST-${index}`,
    productName: `Product ${index}`,
    category: "Test category",
    quantity,
    unit: "Piece",
    unitBuyPrice,
    unitSellPrice,
    deliveryCharge,
    deliveryStatus: "Not Scheduled",
    quantityReceived: 0,
  };
}

function request(id: string, lines: RequestLine[], status: RequestStatus = "Completed"): ProcurementRequest {
  return {
    id,
    orderCode: `ORD-TEST-${id}`,
    requestDate: "2026-07-22",
    requestType: "Standard",
    companyId: "company-test",
    companyName: "Test company",
    branchId: "branch-test",
    branchName: "Test branch",
    department: "Operations",
    requestedBy: "Test user",
    requesterContact: "000-000-0000",
    neededByDate: "2026-07-23",
    urgency: "Normal",
    status,
    invoiceStatus: "Not Issued",
    paymentStatus: "Unpaid",
    lines,
  };
}

describe("financial calculations", () => {
  it("calculates one line using quantity rather than unit price alone", () => {
    const amount = calculateLineAmounts(line(1, 10, 10, 14, 5));

    expect(amount.buyingCost).toBe(100);
    expect(amount.sales).toBe(140);
    expect(amount.grossProfit).toBe(40);
    expect(amount.grossMarginPercent).toBeCloseTo(28.571428, 5);
    expect(amount.deliveryCharges).toBe(5);
  });

  it("reconciles the six supplied workbook lines", () => {
    const suppliedLines = [
      line(1, 10, 10, 14, 5),
      line(2, 5, 12, 18, 5),
      line(3, 5, 5, 8, 5),
      line(4, 5, 50, 60, 10),
      line(5, 2, 10, 15, 10),
      line(6, 1, 25, 40, 15),
    ];

    const totals = calculateTotals([request("baseline", suppliedLines)]);

    expect(totals.sales).toBe(640);
    expect(totals.buyingCost).toBe(480);
    expect(totals.grossProfit).toBe(160);
    expect(totals.grossMarginPercent).toBe(25);
    expect(totals.deliveryCharges).toBe(50);
  });

  it("excludes cancelled requests from management totals", () => {
    const active = request("active", [line(1, 2, 10, 15, 5)]);
    const cancelled = request("cancelled", [line(2, 100, 10, 15, 500)], "Cancelled");

    const totals = calculateTotals([active, cancelled]);
    expect(totals).toMatchObject({
      sales: 30,
      buyingCost: 20,
      grossProfit: 10,
      deliveryCharges: 5,
    });
    expect(totals.grossMarginPercent).toBeCloseTo(100 / 3, 10);
  });

  it("returns a zero margin when sales are zero", () => {
    const amount = calculateLineAmounts(line(1, 3, 0, 0, 0));
    expect(amount).toMatchObject({ sales: 0, buyingCost: 0, grossProfit: 0, grossMarginPercent: 0 });
  });
});

describe("request workflow vocabulary", () => {
  it("contains the complete canonical lifecycle once and in order", () => {
    expect(REQUEST_STATUSES).toEqual([
      "New Request",
      "Under Verification",
      "Waiting for Quotation",
      "Waiting for Approval",
      "Approved",
      "Supplier Assigned",
      "Ordered",
      "Preparing for Delivery",
      "Out for Delivery",
      "Delivered",
      "Invoice Issued",
      "Completed",
      "On Hold",
      "Cancelled",
    ]);
    expect(new Set(REQUEST_STATUSES).size).toBe(REQUEST_STATUSES.length);
  });
});
