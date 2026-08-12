"use client";

import { createInvoiceAction, recordPaymentAction } from "@/app/(portal)/operations/actions";
import { formatCurrency } from "@/lib/domain";
import type { InvoiceRecord, RequestStatus } from "@/lib/types";
import type { SupportedLocale } from "@/lib/i18n";
import { operationalMessage, operationalStatus, type OperationalMessageKey } from "@/lib/operational-i18n";
import { useMemo, useState } from "react";

interface DeliveredRequestOption {
  id: string;
  orderCode: string;
  companyName: string;
  status: RequestStatus;
  supplierIds: string[];
}

interface SupplierOption { id: string; name: string }

export function FinanceManagementForms({
  requests,
  suppliers,
  invoices,
  allowSupplierInvoices,
  locale,
}: {
  requests: DeliveredRequestOption[];
  suppliers: SupplierOption[];
  invoices: InvoiceRecord[];
  allowSupplierInvoices: boolean;
  locale: SupportedLocale;
}) {
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const [requestId, setRequestId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const selectedRequest = requests.find((request) => request.id === requestId);
  const requestSuppliers = useMemo(() => {
    const supplierIds = new Set(selectedRequest?.supplierIds ?? []);
    return suppliers.filter((supplier) => supplierIds.has(supplier.id));
  }, [selectedRequest, suppliers]);
  const payableSupplierInvoices = invoices.filter((item) => (
    item.direction === "SUPPLIER" && item.outstandingAmount > 0
      && item.status === "Issued"
  ));

  if (!allowSupplierInvoices) return null;
  return <section className="dashboard-grid">
    <article className="panel form-panel">
      <h2>{m("financeForms.add")}</h2>
      <p>{m("financeForms.addIntro")}</p>
      <form action={createInvoiceAction}>
        <input type="hidden" name="direction" value="SUPPLIER" />
        <div className="form-grid">
          <label>{m("financeForms.delivered")}<select name="requestId" required value={requestId} onChange={(event) => {
            setRequestId(event.target.value);
            setSupplierId("");
          }}><option value="" disabled>{m("financeForms.selectDelivered")}</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.orderCode} · {request.companyName} · {operationalStatus(locale, request.status)}</option>)}</select></label>
          <label>{m("financeForms.supplierOnly")}<select name="supplierId" required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">{m(requestId ? "financeForms.selectSourced" : "financeForms.selectRequestFirst")}</option>{requestSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>{m("financeForms.number")}<input name="invoiceNumber" required /></label>
          <label>{m("financeForms.date")}<input name="invoiceDate" type="date" required /></label>
          <label>{m("financeForms.due")}<input name="dueDate" type="date" /></label>
          <label>{m("financeForms.amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>{m("financeForms.status")}<input readOnly value={m("financeForms.issued")} /><input name="status" type="hidden" value="Issued" /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">{m("financeForms.save")}</button></div>
      </form>
    </article>
    <article className="panel form-panel">
      <h2>{m("financeForms.recordPayment")}</h2>
      <p>{m("financeForms.paymentIntro")}</p>
      <form action={recordPaymentAction}>
        <div className="form-grid">
          <label className="field-full">{m("financeForms.invoice")}<select name="invoiceId" required defaultValue=""><option value="" disabled>{m("financeForms.selectInvoice")}</option>{payableSupplierInvoices.map((item) => <option key={item.id} value={item.id}>{item.invoiceNumber} · {item.counterparty} · {m("financeForms.amountDue", { amount: formatCurrency(item.outstandingAmount, locale) })}</option>)}</select></label>
          <label>{m("financeForms.paymentDate")}<input name="paymentDate" type="date" required /></label>
          <label>{m("financeForms.amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label className="field-full">{m("financeForms.reference")}<input name="reference" required placeholder={m("financeForms.referencePlaceholder")} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">{m("financeForms.savePayment")}</button></div>
      </form>
    </article>
  </section>;
}
