import { describe, expect, it } from "vitest";
import { getDemoOperations } from "@/lib/demo-operations";
import { getDemoStore } from "@/lib/demo-data";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { companySchema, supplierSchema } from "@/lib/validation";
import {
  createInvoice,
  recordApproval,
  recordDelivery,
  recordPayment,
  selectQuotation,
} from "@/lib/operations";

const actor = { id: "demo-admin", name: "Demo administrator" };

describe("operational validation helpers", () => {
  it("requires a reason before a quotation can be selected", async () => {
    await expect(selectQuotation("missing-quotation", "", actor)).rejects.toThrow(
      "Explain why this quotation was selected.",
    );
  });

  it("requires a reason when an approval is rejected", async () => {
    await expect(recordApproval({
      requestId: getDemoStore().requests[0].id,
      approvalType: "Procurement",
      status: "Rejected",
    }, actor)).rejects.toThrow("A rejection reason is required.");
  });

  it("requires an issue reason for delayed delivery", async () => {
    const line = getDemoStore().requests[0].lines[0];
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Delayed",
      quantityReceived: 0,
    }, actor)).rejects.toThrow("An issue reason is required for this delivery status.");
  });

  it("does not allow cumulative delivery above ordered quantity", async () => {
    const line = getDemoStore().requests[0].lines[0];
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Delivered",
      quantityReceived: line.quantity + 1,
      actualDate: "2026-07-22",
      receivedBy: "Demo receiver",
    }, actor)).rejects.toThrow("Received quantity cannot exceed the ordered quantity.");
  });

  it("does not allow payment above the outstanding invoice amount", async () => {
    const invoice = getDemoOperations().invoices.find((item) => item.outstandingAmount > 0);
    expect(invoice).toBeDefined();

    await expect(recordPayment({
      invoiceId: invoice!.id,
      paymentDate: "2026-07-22",
      amount: invoice!.outstandingAmount + 1,
      method: COD_PAYMENT_METHOD,
    }, actor)).rejects.toThrow("Payment cannot exceed the outstanding invoice amount.");
  });

  it("rejects every non-COD payment method", async () => {
    const invoice = getDemoOperations().invoices.find((item) => item.outstandingAmount > 0);
    const paymentCount = getDemoOperations().payments.length;
    expect(invoice).toBeDefined();

    await expect(recordPayment({
      invoiceId: invoice!.id,
      paymentDate: "2026-07-22",
      amount: 1,
      method: "Bank transfer",
    }, actor)).rejects.toThrow(`Only ${COD_PAYMENT_METHOD} is currently supported.`);
    expect(getDemoOperations().payments).toHaveLength(paymentCount);
  });

  it("uses only the canonical COD method in demo payment records", () => {
    expect(getDemoOperations().payments.length).toBeGreaterThan(0);
    expect(getDemoOperations().payments.every((payment) => payment.method === COD_PAYMENT_METHOD)).toBe(true);
  });

  it("rejects non-COD company and supplier settlement terms", () => {
    expect(companySchema.shape.paymentTerms.safeParse(COD_PAYMENT_METHOD).success).toBe(true);
    expect(supplierSchema.shape.paymentTerms.safeParse(COD_PAYMENT_METHOD).success).toBe(true);
    expect(companySchema.shape.paymentTerms.safeParse("30 days").success).toBe(false);
    expect(supplierSchema.shape.paymentTerms.safeParse("Bank transfer").success).toBe(false);
  });

  it("requires a supplier for supplier invoices", async () => {
    await expect(createInvoice({
      direction: "SUPPLIER",
      requestId: getDemoStore().requests[0].id,
      invoiceNumber: "SINV-TEST",
      invoiceDate: "2026-07-22",
      amount: 10,
      status: "Issued",
    }, actor)).rejects.toThrow("Select the supplier for a supplier invoice.");
  });
});
