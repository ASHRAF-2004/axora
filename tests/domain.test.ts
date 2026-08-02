import { describe, expect, it } from "vitest";
import { calculateLineAmounts, calculateTotals, formatCurrency, formatDate, formatDateTime, REQUEST_STATUSES, roundMoney, timeOfDayGreeting } from "@/lib/domain";
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
    approvalStatus: "Approved",
    estimatedTotal: lines.reduce((total, item) => total + item.quantity * item.unitSellPrice, 0),
    invoiceStatus: "Not Issued",
    paymentStatus: "Unpaid",
    lines,
  };
}

describe("financial calculations", () => {
  it("rounds each monetary line to cents like PostgreSQL numeric", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(calculateLineAmounts(line(1, 0.5, 0.01, 0.01, 0)).sales).toBe(0.01);
  });

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

describe("localized greeting", () => {
  it("uses Malaysia time rather than the server's UTC clock", () => {
    expect(timeOfDayGreeting(new Date("2026-07-23T00:30:00Z"))).toBe("Good morning");
    expect(timeOfDayGreeting(new Date("2026-07-23T07:00:00Z"))).toBe("Good afternoon");
    expect(timeOfDayGreeting(new Date("2026-07-23T12:00:00Z"))).toBe("Good evening");
  });

  it("localizes greetings while retaining Malaysia time", () => {
    const afternoon = new Date("2026-07-23T07:00:00Z");
    expect(timeOfDayGreeting(afternoon, "Asia/Kuala_Lumpur", "ar")).toBe("مساء الخير");
    expect(timeOfDayGreeting(afternoon, "Asia/Kuala_Lumpur", "ms")).toBe("Selamat tengah hari");
  });

  it("formats dates and MYR values using the selected regional locale", () => {
    expect(formatDate("2026-08-02", "ms")).toContain("2026");
    expect(formatDate("2026-08-02", "ar")).toContain("أغسطس");
    expect(formatCurrency(1250.5, "ms")).toContain("1,250.50");
    expect(formatCurrency(1250.5, "ar")).toContain("MYR");
  });

  it("formats timestamps in the user's saved timezone", () => {
    const instant = "2026-08-02T16:30:00.000Z";
    expect(formatDateTime(instant, "en", "Asia/Kuala_Lumpur")).toContain("03 Aug 2026");
    expect(formatDateTime(instant, "en", "UTC")).toContain("02 Aug 2026");
  });
});
