import { describe, expect, it } from "vitest";
import { getDemoOperations } from "@/lib/demo-operations";
import { getDemoStore } from "@/lib/demo-data";
import { INTERNAL_PAYMENT_STRATEGY, STANDARD_BILLING_TERMS } from "@/lib/types";
import { companySchema, supplierSchema } from "@/lib/validation";
import {
  createInvoice,
  recordApproval,
  recordDelivery,
  recordPayment,
  saveAttachment,
} from "@/lib/operations";
import { createProduct, createRequest, getRequest, listRequests, setMasterActive } from "@/lib/repository";

const actor = { id: "demo-owner", email: "owner@axora.local", name: "Axora owner", role: "ADMIN" as const, isOwner: true };
const companyActor = {
  id: "company-admin",
  name: "Company administrator",
  role: "ADMIN" as const,
  companyId: "co-youruni",
  isOwner: false,
};
const requesterActor = {
  ...companyActor,
  email: "company-admin@youruni.example",
};

function getSupplierPaymentInvoice() {
  const operations = getDemoOperations();
  const existing = operations.invoices.find((item) => item.id === "supplier-payment-validation");
  if (existing) return existing;
  const source = operations.invoices.find((item) => item.outstandingAmount > 0);
  if (!source) throw new Error("Supplier payment validation fixture is unavailable.");
  const invoice = {
    ...source,
    id: "supplier-payment-validation",
    direction: "SUPPLIER" as const,
    invoiceNumber: "SINV-PAYMENT-VALIDATION",
  };
  operations.invoices.unshift(invoice);
  return invoice;
}

describe("operational validation helpers", () => {
  it("requires a reason when an approval is rejected", async () => {
    await expect(recordApproval({
      requestId: getDemoStore().requests[0].id,
      approvalType: "Procurement",
      status: "Rejected",
    }, actor)).rejects.toThrow("A rejection reason is required.");
  });

  it("blocks self-approval in the local/demo data path as well as production", async () => {
    const request = getDemoStore().requests[0];
    const originalCreator = request.createdById;
    request.createdById = companyActor.id;
    try {
      await expect(recordApproval({
        requestId: request.id,
        approvalType: "Company approval",
        status: "Approved",
      }, companyActor)).rejects.toThrow("You cannot approve your own purchase request.");
    } finally {
      request.createdById = originalCreator;
    }
  });

  it("blocks cross-company and cross-branch approval in the local/demo data path", async () => {
    const request = getDemoStore().requests.find((item) => item.companyId !== companyActor.companyId);
    expect(request).toBeDefined();
    await expect(recordApproval({
      requestId: request!.id,
      approvalType: "Company approval",
      status: "Approved",
    }, companyActor)).rejects.toThrow("not pending approval for your branch");

    const inCompanyRequest = getDemoStore().requests.find((item) => item.companyId === companyActor.companyId);
    expect(inCompanyRequest).toBeDefined();
    await expect(recordApproval({
      requestId: inCompanyRequest!.id,
      approvalType: "Company approval",
      status: "Approved",
    }, { ...companyActor, branchId: "another-branch" }))
      .rejects.toThrow("not pending approval for your branch");
  });

  it("requires an issue reason for delayed delivery", async () => {
    const line = getDemoStore().requests[0].lines[0];
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Delayed",
      quantityReceived: 0,
    }, actor)).rejects.toThrow("An issue reason is required for this delivery status.");
  });

  it("routes every accepted quantity through independent customer receiving", async () => {
    const line = getDemoStore().requests[0].lines[0];
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Delivered",
      quantityReceived: line.quantity + 1,
      actualDate: "2026-07-22",
      receivedBy: "Demo receiver",
    }, actor)).rejects.toThrow("confirmed independently in the receiving portal");
  });

  it("keeps legacy logistics statuses separate from receipt evidence", async () => {
    const line = getDemoStore().requests[0].lines[0];
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Scheduled",
      quantityReceived: 1,
    }, actor)).rejects.toThrow("cannot record customer receipt evidence");
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Partially Delivered",
      quantityReceived: 1,
    }, actor)).rejects.toThrow("confirmed independently in the receiving portal");
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Delivered",
      quantityReceived: line.quantity - 1,
      actualDate: "2026-07-22",
      receivedBy: "Demo receiver",
    }, actor)).rejects.toThrow("confirmed independently in the receiving portal");
    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Out for Delivery",
      quantityReceived: 0,
      actualDate: "2026-07-22",
      receivedBy: "Demo receiver",
    }, actor)).rejects.toThrow("cannot record customer receipt evidence");
  });

  it("does not allow payment above the outstanding invoice amount", async () => {
    const invoice = getSupplierPaymentInvoice();

    await expect(recordPayment({
      invoiceId: invoice.id,
      paymentDate: "2026-07-22",
      amount: invoice.outstandingAmount + 1,
      method: INTERNAL_PAYMENT_STRATEGY,
      reference: "RECEIPT-OVERPAY-TEST",
    }, actor)).rejects.toThrow("Payment cannot exceed the outstanding invoice amount.");
  });

  it("rejects every non-payment payment method", async () => {
    const invoice = getSupplierPaymentInvoice();
    const paymentCount = getDemoOperations().payments.length;

    await expect(recordPayment({
      invoiceId: invoice.id,
      paymentDate: "2026-07-22",
      amount: 1,
      method: "Bank transfer",
    }, actor)).rejects.toThrow(`Only ${INTERNAL_PAYMENT_STRATEGY} is currently supported.`);
    expect(getDemoOperations().payments).toHaveLength(paymentCount);
  });

  it("requires a numbered receipt reference for payment evidence", async () => {
    const invoice = getSupplierPaymentInvoice();
    await expect(recordPayment({
      invoiceId: invoice.id,
      paymentDate: "2026-07-22",
      amount: 1,
      method: INTERNAL_PAYMENT_STRATEGY,
    }, actor)).rejects.toThrow("numbered receipt");
  });

  it("uses only the canonical payment method in demo payment records", () => {
    expect(getDemoOperations().payments.length).toBeGreaterThan(0);
    expect(getDemoOperations().payments.every((payment) => payment.method === INTERNAL_PAYMENT_STRATEGY)).toBe(true);
  });

  it("rejects non-payment company and supplier settlement terms", () => {
    expect(companySchema.shape.paymentTerms.safeParse(STANDARD_BILLING_TERMS).success).toBe(true);
    expect(supplierSchema.shape.paymentTerms.safeParse(STANDARD_BILLING_TERMS).success).toBe(true);
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

  it("reserves customer invoice finalization for checkout", async () => {
    const request = getDemoStore().requests.find((item) => !item.invoiceNumber && item.lines.every((line) => line.quantityReceived === 0));
    expect(request).toBeDefined();
    await expect(createInvoice({
      direction: "CUSTOMER",
      requestId: request!.id,
      invoiceNumber: "CINV-TOO-EARLY",
      invoiceDate: "2026-07-22",
      amount: 1,
      status: "Issued",
    }, actor)).rejects.toThrow("Customer invoices are finalized by checkout.");
  });

  it("rejects new duplicate products and lets owners retire a legacy review row", async () => {
    const store = getDemoStore();
    const existing = store.products[0];
    const count = store.products.length;
    await expect(createProduct({
      name: existing.name,
      category: existing.category,
      subcategory: existing.subcategory,
      brand: existing.brand,
      size: existing.size,
      unit: existing.unit,
      packaging: existing.packaging,
      description: existing.description,
      defaultBuyPrice: existing.defaultBuyPrice,
      defaultSellPrice: existing.defaultSellPrice,
      deliverySlaDays: existing.deliverySlaDays,
    }, actor)).rejects.toThrow("already exists");
    expect(store.products).toHaveLength(count);

    const review = store.products.find((product) => product.status === "Needs Review");
    expect(review).toBeDefined();
    await setMasterActive("products", review!.id, false, actor);
    expect(review).toMatchObject({ status: "Inactive", duplicateWarning: false });
    review!.status = "Needs Review";
    review!.duplicateWarning = true;
  });

  it("keeps delivery, invoice, and payment mutations out of company roles", async () => {
    const request = getDemoStore().requests[0];
    const line = request.lines[0];
    const invoice = getDemoOperations().invoices[0];

    await expect(recordDelivery({
      requestLineId: line.id,
      status: "Scheduled",
      quantityReceived: 0,
    }, companyActor)).rejects.toThrow("Only authorized Axora operations users can record delivery updates.");
    await expect(createInvoice({
      direction: "CUSTOMER",
      requestId: request.id,
      invoiceNumber: "CINV-BLOCKED",
      invoiceDate: "2026-07-22",
      amount: 10,
      status: "Issued",
    }, companyActor)).rejects.toThrow("Only authorized Axora finance users can create invoices.");
    await expect(recordPayment({
      invoiceId: invoice.id,
      paymentDate: "2026-07-22",
      amount: 1,
      method: INTERNAL_PAYMENT_STRATEGY,
    }, companyActor)).rejects.toThrow("Only authorized Axora finance users can record payments.");
  });

  it("accepts single-unit quantities and enforces one line per product on the server", async () => {
    const store = getDemoStore();
    const product = store.products.find((item) => item.status === "Active");
    const branch = store.branches.find((item) => item.companyId === requesterActor.companyId);
    expect(product).toBeDefined();
    expect(branch).toBeDefined();

    const baseRequest = {
      companyId: requesterActor.companyId,
      branchId: branch!.id,
      requestType: "Standard" as const,
      department: "Administration",
      neededByDate: "2026-08-15",
      urgency: "Normal" as const,
    };
    await expect(createRequest({
      ...baseRequest,
      lines: [
        { productId: product!.id, quantity: 1 },
        { productId: product!.id, quantity: 1 },
      ],
    }, requesterActor)).rejects.toThrow("Add each catalog product only once");
  });

  it("keeps requester records self-scoped and redacts billing from non-finance roles", async () => {
    const store = getDemoStore();
    const ops = getDemoOperations();
    const branch = store.branches.find((item) => item.companyId === "co-youruni")!;
    const product = store.products.find((item) => item.status === "Active")!;
    const requester = {
      id: "requester-self-scope",
      email: "self@youruni.example",
      name: "Self-scoped requester",
      role: "REQUESTER" as const,
      companyId: branch.companyId,
      branchId: branch.id,
      isOwner: false,
    };
    const colleague = {
      ...requester,
      id: "requester-colleague",
      email: "colleague@youruni.example",
      name: "Requester colleague",
    };
    const requestId = await createRequest({
      companyId: branch.companyId,
      branchId: branch.id,
      requestType: "Standard",
      department: "Administration",
      neededByDate: "2026-08-15",
      urgency: "Normal",
      lines: [{ productId: product.id, quantity: 1 }],
    }, requester);
    try {
      expect((await listRequests(requester)).some((request) => request.id === requestId)).toBe(true);
      expect((await listRequests(colleague)).some((request) => request.id === requestId)).toBe(false);
      await expect(getRequest(requestId, colleague)).resolves.toBeUndefined();

      const attachmentCount = ops.attachments.length;
      await expect(saveAttachment({
        entityType: "request",
        recordId: requestId,
        file: new File(["private"], "request.txt", { type: "text/plain" }),
      }, colleague)).rejects.toThrow("Linked record not found");
      expect(ops.attachments).toHaveLength(attachmentCount);

      const approver = { ...requester, id: "approver-view", role: "APPROVER" as const };
      const billedRequest = store.requests.find((request) => request.invoiceNumber);
      expect(billedRequest).toBeDefined();
      const approverView = await getRequest(billedRequest!.id, { ...approver, companyId: billedRequest!.companyId, branchId: billedRequest!.branchId });
      expect(approverView).toMatchObject({ invoiceNumber: undefined, invoiceStatus: undefined, paymentStatus: undefined });
      const adminView = await getRequest(billedRequest!.id, {
        ...approver,
        id: "company-admin-view",
        role: "ADMIN",
        companyId: billedRequest!.companyId,
        branchId: undefined,
      });
      expect(adminView?.invoiceNumber).toBe(billedRequest!.invoiceNumber);
    } finally {
      const index = store.requests.findIndex((request) => request.id === requestId);
      if (index >= 0) store.requests.splice(index, 1);
    }
  });
});
