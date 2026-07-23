import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requireSession } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { listInvoices, listPayments } from "@/lib/operations";
import { listRequests, listSuppliers } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { createInvoiceAction, recordPaymentAction } from "../operations/actions";

export default async function FinancePage() {
  const actor = await requireSession();
  const canManage = hasPermission(actor.role, "manage_finance");
  const [requests, suppliers, invoices, payments] = await Promise.all([listRequests(), listSuppliers(), listInvoices(), listPayments()]);
  return <><PageHeader eyebrow="Finance control" title="Invoices and COD payments" description="Axora records cash-on-delivery evidence for reconciliation. It does not initiate or process online payments." />
    {canManage ? <section className="dashboard-grid"><article className="panel form-panel"><h2>Add invoice</h2><form action={createInvoiceAction}><div className="form-grid">
      <label>Direction<select name="direction" defaultValue="CUSTOMER"><option value="CUSTOMER">Customer invoice</option><option value="SUPPLIER">Supplier invoice</option></select></label>
      <label>Request<select name="requestId" required defaultValue=""><option value="" disabled>Select request</option>{requests.filter((item) => !["New Request", "Cancelled", "Completed"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.orderCode} · {item.companyName} · {item.status}</option>)}</select></label>
      <label>Supplier (supplier invoice only)<select name="supplierId" defaultValue=""><option value="">Not applicable</option>{suppliers.filter((item) => item.status === "Active").map((item) => <option key={item.id} value={item.id}>{actor.isOwner ? `${item.companyName || "Unassigned"} · ` : ""}{item.name}</option>)}</select></label>
      <label>Invoice number<input name="invoiceNumber" required /></label><label>Invoice date<input name="invoiceDate" type="date" required /></label><label>Due date<input name="dueDate" type="date" /></label>
      <label>Amount (RM)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Status<select name="status" defaultValue="Issued"><option>Draft</option><option>Issued</option><option>Disputed</option><option>Cancelled</option></select></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Save invoice</button></div></form></article>
      <article className="panel form-panel"><h2>Record COD payment</h2><p>Use this form only after cash on delivery has been collected. It records evidence; it is not an online checkout.</p><form action={recordPaymentAction}><div className="form-grid">
        <label className="field-full">Invoice<select name="invoiceId" required defaultValue=""><option value="" disabled>Select unpaid invoice</option>{invoices.filter((item) => item.outstandingAmount > 0 && item.status !== "Cancelled").map((item) => <option key={item.id} value={item.id}>{item.invoiceNumber} · {item.counterparty} · {formatCurrency(item.outstandingAmount)} due</option>)}</select></label>
        <label>Payment date<input name="paymentDate" type="date" required /></label><label>Amount (RM)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>Method<input name="method" required readOnly value={COD_PAYMENT_METHOD} /></label><label>Reference<input name="reference" placeholder="Receipt or collection reference" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">Save COD payment</button></div></form></article>
    </section> : null}
    <section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="panel-header"><div><h2>Invoice register</h2><p>{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Direction / request</th><th>Counterparty</th><th>Date / due</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoiceNumber}</strong></td><td>{item.direction === "CUSTOMER" ? "Customer" : "Supplier"}<br /><span className="subtle">{item.orderCode}</span></td><td>{item.counterparty}</td><td>{formatDate(item.invoiceDate)}<br /><span className="subtle">Due {formatDate(item.dueDate)}</span></td><td>{formatCurrency(item.amount)}</td><td>{formatCurrency(item.paidAmount)}</td><td><strong>{formatCurrency(item.outstandingAmount)}</strong></td><td><StatusBadge>{item.paymentStatus}</StatusBadge></td></tr>)}</tbody></table></div></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>Payment register</h2><p>Evidence references for reconciliation</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>{payments.map((item) => <tr key={item.id}><td>{item.invoiceNumber}</td><td>{formatDate(item.paymentDate)}</td><td><strong>{formatCurrency(item.amount)}</strong></td><td>{item.method}</td><td>{item.reference || "—"}</td><td>{item.recordedByName || "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
