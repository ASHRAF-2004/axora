import { describe, expect, it } from "vitest";
import {
  assertCustomerReceivingActor,
  assertIndependentMatchOverride,
  calculateReceiptLine,
  evaluateThreeWayMatch,
  receiptStatusFromLines,
} from "@/lib/receiving";

describe("customer receiving and three-way matching", () => {
  it("calculates accepted, rejected, damaged, short, and over quantities", () => {
    const damaged = calculateReceiptLine({
      plannedQuantity: 10,
      deliveredQuantity: 8,
      acceptedQuantity: 7,
      rejectedQuantity: 1,
      damagedQuantity: 1,
    });
    expect(damaged).toMatchObject({
      acceptedQuantity: 7,
      rejectedQuantity: 1,
      damagedQuantity: 1,
      shortQuantity: 2,
      discrepancyCode: "DAMAGED",
    });
    expect(receiptStatusFromLines([damaged])).toBe("ACCEPTED_WITH_EXCEPTIONS");
    expect(calculateReceiptLine({
      plannedQuantity: 10,
      deliveredQuantity: 11,
      acceptedQuantity: 11,
    }).discrepancyCode).toBe("OVER");
  });

  it("rejects inconsistent receipt quantities", () => {
    expect(() => calculateReceiptLine({
      plannedQuantity: 10,
      deliveredQuantity: 9,
      acceptedQuantity: 8,
      rejectedQuantity: 0,
    })).toThrow("must equal delivered");
    expect(() => calculateReceiptLine({
      plannedQuantity: 10,
      deliveredQuantity: 9,
      acceptedQuantity: 8,
      rejectedQuantity: 1,
      damagedQuantity: 2,
    })).toThrow("cannot exceed rejected");
  });

  it("keeps driver proof separate from customer receiving authority", () => {
    expect(() => assertCustomerReceivingActor({
      receivingUserId: "receiver-1",
      accountKind: "DELIVERY",
      activeCompanyMembership: false,
      activeBranchAssignment: false,
      roleKeys: ["DELIVERY_DRIVER"],
      assignedDriverUserIds: ["receiver-1"],
    })).toThrow("customer receiving user");
    expect(() => assertCustomerReceivingActor({
      receivingUserId: "receiver-1",
      accountKind: "COMPANY",
      activeCompanyMembership: true,
      activeBranchAssignment: true,
      roleKeys: ["RECEIVING_USER"],
      assignedDriverUserIds: ["driver-1"],
    })).not.toThrow();
  });

  it("reports not-ready, matched, and exception match states", () => {
    expect(evaluateThreeWayMatch({
      orderedQuantity: 10,
      orderedUnitPrice: 5,
    })).toMatchObject({
      status: "NOT_READY",
      exceptions: ["MISSING_RECEIPT", "MISSING_INVOICE"],
    });
    expect(evaluateThreeWayMatch({
      orderedQuantity: 10,
      receivedQuantity: 10,
      invoicedQuantity: 10,
      orderedUnitPrice: 5,
      invoicedUnitPrice: 5,
    }).status).toBe("MATCHED");
    expect(evaluateThreeWayMatch({
      orderedQuantity: 10,
      receivedQuantity: 8,
      invoicedQuantity: 10,
      orderedUnitPrice: 5,
      invoicedUnitPrice: 5.5,
      quantityTolerance: 0,
      priceTolerance: 0.1,
    })).toMatchObject({
      status: "EXCEPTION",
      exceptions: ["QUANTITY_VARIANCE", "PRICE_VARIANCE"],
      quantityVariance: 2,
      priceVariance: 0.5,
    });
  });

  it("requires an independent finance reviewer for override", () => {
    expect(() => assertIndependentMatchOverride({
      evaluatorUserId: "finance-1",
      receivingUserId: "receiver-1",
      overridingUserId: "finance-1",
      overridingRoleKeys: ["FINANCE_REVIEWER"],
      overrideReason: "Within agreed tolerance",
    })).toThrow("independent review");
    expect(assertIndependentMatchOverride({
      evaluatorUserId: "finance-1",
      receivingUserId: "receiver-1",
      overridingUserId: "finance-2",
      overridingRoleKeys: ["FINANCE_REVIEWER"],
      overrideReason: "Within agreed tolerance",
    })).toBe("Within agreed tolerance");
  });
});
