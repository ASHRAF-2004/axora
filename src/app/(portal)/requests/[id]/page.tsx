import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { calculateLineAmounts, formatCurrency, formatDate } from "@/lib/domain";
import { getRequest } from "@/lib/repository";
import { allowedNextStatuses } from "@/lib/workflow";
import { CircleDollarSign, PackageCheck, Route, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { updateStatusAction } from "../actions";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await getRequest(id);
  if (!request) notFound();
  const totals = request.lines.reduce((sum, line) => {
    const current = calculateLineAmounts(line);
    return { sales: sum.sales + current.sales, buyingCost: sum.buyingCost + current.buyingCost, grossProfit: sum.grossProfit + current.grossProfit, delivery: sum.delivery + current.deliveryCharges };
  }, { sales: 0, buyingCost: 0, grossProfit: 0, delivery: 0 });
  const margin = totals.sales ? (totals.grossProfit / totals.sales) * 100 : 0;
  const updateAction = updateStatusAction.bind(null, id);
  const nextStatuses = allowedNextStatuses(request.status);
  return (
    <>
      <PageHeader eyebrow="Request detail" title={request.orderCode} description={`${request.companyName} · ${request.branchName} · ${request.lines.length} item${request.lines.length === 1 ? "" : "s"}`} />
      <section className="request-summary">
        <div className="summary-box"><span>Current status</span><strong><StatusBadge>{request.status}</StatusBadge></strong></div>
        <div className="summary-box"><span>Needed by</span><strong>{formatDate(request.neededByDate)}</strong></div>
        <div className="summary-box"><span>Total sales</span><strong>{formatCurrency(totals.sales)}</strong></div>
        <div className="summary-box"><span>Gross margin</span><strong>{formatCurrency(totals.grossProfit)} · {margin.toFixed(1)}%</strong></div>
      </section>
      <section className="detail-grid">
        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header"><div><h2>Request items</h2><p>Prices and totals are stored per line</p></div></div>
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Line</th><th>Product</th><th>Quantity</th><th>Supplier</th><th>Buy total</th><th>Sell total</th><th>Delivery</th></tr></thead><tbody>
              {request.lines.map((line) => { const amount = calculateLineAmounts(line); return <tr key={line.id}><td><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></td><td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td><td>{line.quantity} {line.unit}</td><td>{line.supplierName || "Not assigned"}<br /><span className="subtle">{line.supplierConfirmationStatus}</span></td><td>{formatCurrency(amount.buyingCost)}</td><td>{formatCurrency(amount.sales)}</td><td><StatusBadge>{line.deliveryStatus}</StatusBadge></td></tr>; })}
            </tbody></table></div>
          </article>
          <article className="panel"><div className="panel-header"><div><h2>Operational information</h2><p>Intake, finance and delivery context</p></div></div><div className="panel-body">
            <div className="form-grid">
              <div className="readiness-item"><UserRound size={19} /><div><strong>{request.requestedBy}</strong><p>{request.department} · {request.requesterContact}</p></div></div>
              <div className="readiness-item"><Route size={19} /><div><strong>{request.branchName}</strong><p>{request.requestType} · {request.urgency} urgency</p></div></div>
              <div className="readiness-item"><PackageCheck size={19} /><div><strong>{request.invoiceNumber || "No customer invoice"}</strong><p>{request.invoiceStatus} · {request.paymentStatus}</p></div></div>
              <div className="readiness-item"><CircleDollarSign size={19} /><div><strong>{formatCurrency(totals.delivery)} delivery fees</strong><p>Kept separate until finance confirms treatment.</p></div></div>
            </div>
          </div></article>
        </div>
        <aside className="panel form-panel">
          <h2>Move the request</h2><p>Every important status change will be written to the audit history in PostgreSQL mode.</p>
          {nextStatuses.length ? <form action={updateAction}>
            <label>Allowed next status<select name="status" defaultValue={nextStatuses[0]}>{nextStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label style={{ marginTop: 13 }}>Reason / note<textarea name="reason" placeholder="Required for hold, cancellation or resuming from hold" /></label>
            <div className="form-actions"><button className="button button-primary" type="submit">Update status</button></div>
          </form> : <div className="callout"><strong>This workflow is closed.</strong><p>Completed and cancelled requests cannot be moved without a supervisor-approved correction process.</p></div>}
          <h3 className="section-title">Timeline</h3>
          <div className="timeline">
            <div className="timeline-item"><div className="timeline-dot" /><div><strong>Request created</strong><p>{formatDate(request.requestDate)}</p></div></div>
            <div className="timeline-item"><div className="timeline-dot" /><div><strong>{request.status}</strong><p>Current workflow position</p></div></div>
            {request.completedDate ? <div className="timeline-item"><div className="timeline-dot" /><div><strong>Completed</strong><p>{formatDate(request.completedDate)}</p></div></div> : null}
          </div>
        </aside>
      </section>
    </>
  );
}
