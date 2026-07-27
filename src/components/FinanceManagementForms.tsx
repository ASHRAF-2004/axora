"use client";

import { createInvoiceAction, recordPaymentAction } from "@/app/(portal)/operations/actions";
import { formatCurrency } from "@/lib/domain";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import type { InvoiceRecord, RequestStatus } from "@/lib/types";
import { useMemo, useState } from "react";

interface DeliveredRequestOption {
  id: string;
  orderCode: string;
  companyName: string;
  status: RequestStatus;
  supplierIds: string[];
}

interface SupplierOption {
  id: string;
  name: string;
}

export function FinanceManagementForms({
  requests,
  suppliers,
  invoices,
}: {
  requests: DeliveredRequestOption[];
  suppliers: SupplierOption[];
  invoices: InvoiceRecord[];
}) {
  const [direction, setDirection] = useState<"CUSTOMER" | "SUPPLIER">("CUSTOMER");
  const [requestId, setRequestId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const selectedRequest = requests.find((request) => request.id === requestId);
  const requestSuppliers = useMemo(() => {
    const supplierIds = new Set(selectedRequest?.supplierIds ?? []);
    return suppliers.filter((supplier) => supplierIds.has(supplier.id));
  }, [selectedRequest, suppliers]);

  return <section className="dashboard-grid">
    <article className="panel form-panel"><h2>Add invoice</h2><p>Invoices are issued only after the approved request is fully delivered. A supplier invoice must match a supplier selected during sourcing.</p>
      <form action={createInvoiceAction}><div className="form-grid">
        <label>Direction<select name="direction" value={direction} onChange={(event) => {
          setDirection(event.target.value as "CUSTOMER" | "SUPPLIER");
          setSupplierId("");
        }}><option value="CUSTOMER">Customer invoice</option><option value="SUPPLIER">Supplier invoice</option></select></label>
        <label>Delivered request<select name="requestId" required value={requestId} onChange={(event) => {
          setRequestId(event.target.value);
          setSupplierId("");
        }}><option value="" disabled>Select delivered request</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.orderCode} · {request.companyName} · {request.status}</option>)}</select></label>
        <label>Supplier (supplier invoice only)<select name="supplierId" required={direction === "SUPPLIER"} disabled={direction !== "SUPPLIER"} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">{requestId ? "Select sourced supplier" : "Select a request first"}</option>{requestSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Invoice number<input name="invoiceNumber" required /></label><label>Invoice date<input name="invoiceDate" type="date" required /></label><label>Due date<input name="dueDate" type="date" /></label>
        <label>Amount (RM)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Status<input name="status" readOnly value="Issued" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">Save invoice</button></div></form>
    </article>
    <article className="panel form-panel"><h2>Record COD payment</h2><p>Use this form only after the full order has been delivered and cash has been collected. It records evidence; it is not an online checkout.</p><form action={recordPaymentAction}><div className="form-grid">
      <label className="field-full">Invoice<select name="invoiceId" required defaultValue=""><option value="" disabled>Select delivered, issued invoice</option>{invoices.filter((item) => item.outstandingAmount > 0 && item.status === "Issued" && ["Delivered", "Invoice Issued", "Completed"].includes(item.requestStatus ?? "")).map((item) => <option key={item.id} value={item.id}>{item.invoiceNumber} · {item.counterparty} · {formatCurrency(item.outstandingAmount)} due</option>)}</select></label>
      <label>Payment date<input name="paymentDate" type="date" required /></label><label>Amount (RM)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Method<input name="method" required readOnly value={COD_PAYMENT_METHOD} /></label><label>Numbered receipt reference<input name="reference" required placeholder="Receipt or collection reference" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Save COD payment</button></div></form></article>
  </section>;
}
