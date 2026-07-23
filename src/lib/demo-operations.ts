import { randomUUID } from "node:crypto";
import { calculateLineAmounts } from "./domain";
import { getDemoStore } from "./demo-data";
import { COD_PAYMENT_METHOD } from "./types";
import type { ApprovalRecord, AttachmentRecord, AuditRecord, DeliveryRecord, InvoiceRecord, PaymentRecord, QuotationRecord } from "./types";

export interface DemoOperationsStore {
  quotations: QuotationRecord[];
  approvals: ApprovalRecord[];
  deliveries: DeliveryRecord[];
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  audit: AuditRecord[];
  attachments: AttachmentRecord[];
}

declare global {
  var __axoraDemoOperations: DemoOperationsStore | undefined;
}

function buildDemoOperations(): DemoOperationsStore {
  const store = getDemoStore();
  const deliveries: DeliveryRecord[] = [];
  const invoices: InvoiceRecord[] = [];
  const payments: PaymentRecord[] = [];
  const quotations: QuotationRecord[] = [];
  const approvals: ApprovalRecord[] = [];

  for (const request of store.requests) {
    for (const line of request.lines) {
      if (line.quotationReference) quotations.push({
        id: `quote-${line.id}`, requestLineId: line.id, requestLineCode: line.code, orderCode: request.orderCode,
        productName: line.productName, supplierId: line.supplierId ?? "pending", supplierName: line.supplierName ?? "Supplier pending",
        quotationReference: line.quotationReference, quotationDate: request.requestDate, unitPrice: line.unitBuyPrice,
        deliveryCharge: line.deliveryCharge, leadTimeDays: 3, status: line.supplierConfirmationStatus === "Quotation Received" ? "Received" : "Selected",
        selected: line.supplierConfirmationStatus === "Confirmed",
      });
      if (line.deliveryStatus !== "Not Scheduled") deliveries.push({
        id: `delivery-${line.id}`, requestLineId: line.id, requestLineCode: line.code, orderCode: request.orderCode,
        companyName: request.companyName, productName: line.productName, expectedDate: line.expectedDeliveryDate,
        actualDate: line.actualDeliveryDate, status: line.deliveryStatus, quantityReceived: line.quantityReceived,
        receivedBy: line.quantityReceived ? "Demo receiver" : undefined, issueReason: request.issueReason, createdAt: request.requestDate,
      });
    }
    if (["Waiting for Approval", "Approved", "Supplier Assigned", "Ordered", "Preparing for Delivery", "Out for Delivery", "Delivered", "Invoice Issued", "Completed"].includes(request.status)) {
      approvals.push({ id: `approval-${request.id}`, requestId: request.id, orderCode: request.orderCode, companyName: request.companyName,
        approvalType: "Procurement", status: request.status === "Waiting for Approval" ? "Pending" : "Approved", reviewerName: "Demo supervisor",
        decidedAt: request.status === "Waiting for Approval" ? undefined : request.requestDate, createdAt: request.requestDate });
    }
    if (request.invoiceNumber) {
      const amount = request.lines.reduce((sum, line) => sum + calculateLineAmounts(line).sales, 0);
      const paidAmount = request.paymentStatus === "Paid" ? amount : request.paymentStatus === "Partial" ? amount / 2 : 0;
      const invoice: InvoiceRecord = { id: `invoice-${request.id}`, direction: "CUSTOMER", requestId: request.id, orderCode: request.orderCode,
        counterparty: request.companyName, invoiceNumber: request.invoiceNumber, invoiceDate: request.requestDate, dueDate: request.neededByDate,
        amount, status: request.invoiceStatus, paidAmount, outstandingAmount: Math.max(amount - paidAmount, 0), paymentStatus: request.paymentStatus };
      invoices.push(invoice);
      if (paidAmount) payments.push({ id: randomUUID(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
        paymentDate: request.completedDate ?? request.requestDate, amount: paidAmount, method: COD_PAYMENT_METHOD, reference: "DEMO-PAYMENT" });
    }
  }
  return { quotations, approvals, deliveries, invoices, payments, audit: [], attachments: [] };
}

export function getDemoOperations() {
  if (!global.__axoraDemoOperations) global.__axoraDemoOperations = buildDemoOperations();
  return global.__axoraDemoOperations;
}

export function addDemoAudit(entityType: string, recordId: string | undefined, action: string, actorName: string, reason?: string) {
  getDemoOperations().audit.unshift({ id: randomUUID(), entityType, recordId, action, actorName, reason, occurredAt: new Date().toISOString() });
}
