import { PageHeader } from "@/components/PageHeader";
import { FinanceManagementForms } from "@/components/FinanceManagementForms";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listInvoices, listPayments } from "@/lib/operations";
import { listRequests, listSuppliers } from "@/lib/repository";

export default async function FinancePage() {
  const actor = await requirePagePermission("view_invoices");
  const canManage = canAccess(actor, "manage_finance");
  const [requests, suppliers, invoices, payments] = await Promise.all([listRequests(), listSuppliers(), listInvoices(), listPayments()]);
  const deliveredRequests = requests
    .filter((item) => ["Delivered", "Invoice Issued"].includes(item.status) && item.approvalStatus === "Approved")
    .map((item) => ({
      id: item.id,
      orderCode: item.orderCode,
      companyName: item.companyName,
      status: item.status,
      supplierIds: [...new Set(item.lines.flatMap((line) => line.supplierId ? [line.supplierId] : []))],
    }));
  return <><PageHeader
    eyebrow={actor.isOwner ? "Finance control" : "Company billing"}
    title={actor.isOwner ? "Invoices and COD payments" : "Your invoices and payment receipts"}
    description={actor.isOwner
      ? "Axora records cash-on-delivery evidence for reconciliation. It does not initiate or process online payments."
      : "Review customer invoices for your requests and the cash-on-delivery receipts recorded by Axora."}
  />
    {canManage ? <FinanceManagementForms
      requests={deliveredRequests}
      suppliers={suppliers.filter((item) => item.status === "Active").map((item) => ({ id: item.id, name: item.name }))}
      invoices={invoices}
    /> : null}
    <section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="panel-header"><div><h2>Invoice register</h2><p>{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</p></div></div><div className="data-table-wrap"><table className="data-table">
      {actor.isOwner
        ? <><thead><tr><th>Invoice</th><th>Direction / request</th><th>Counterparty</th><th>Date / due</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoiceNumber}</strong></td><td>{item.direction === "CUSTOMER" ? "Customer" : "Supplier"}<br /><span className="subtle">{item.orderCode}</span></td><td>{item.counterparty}</td><td>{formatDate(item.invoiceDate)}<br /><span className="subtle">Due {formatDate(item.dueDate)}</span></td><td>{formatCurrency(item.amount)}</td><td>{formatCurrency(item.paidAmount)}</td><td><strong>{formatCurrency(item.outstandingAmount)}</strong></td><td><StatusBadge>{item.paymentStatus}</StatusBadge></td></tr>)}</tbody></>
        : <><thead><tr><th>Invoice</th><th>Request</th><th>Date / due</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoiceNumber}</strong></td><td>{item.orderCode}</td><td>{formatDate(item.invoiceDate)}<br /><span className="subtle">Due {formatDate(item.dueDate)}</span></td><td>{formatCurrency(item.amount)}</td><td>{formatCurrency(item.paidAmount)}</td><td><strong>{formatCurrency(item.outstandingAmount)}</strong></td><td><StatusBadge>{item.paymentStatus}</StatusBadge></td></tr>)}</tbody></>}
    </table></div></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>Payment register</h2><p>Evidence references for reconciliation</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>{payments.map((item) => <tr key={item.id}><td>{item.invoiceNumber}</td><td>{formatDate(item.paymentDate)}</td><td><strong>{formatCurrency(item.amount)}</strong></td><td>{item.method}</td><td>{item.reference || "—"}</td><td>{item.recordedByName || "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
