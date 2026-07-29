import { PageHeader } from "@/components/PageHeader";
import { RequestPricingSummary } from "@/components/RequestPricingSummary";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { calculateLineAmounts, formatCurrency, formatDate } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { getRequest, listBranches } from "@/lib/repository";
import { allowedNextStatuses } from "@/lib/workflow";
import { CircleDollarSign, PackageCheck, Route, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateStatusAction } from "../actions";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePagePermission("view_requests");
  const canViewInvoices = canAccess(actor, "view_invoices");
  const request = await getRequest(id, actor);
  if (!request) notFound();

  const branchBudget = actor.isOwner
    ? undefined
    : (await listBranches(actor)).find((branch) => branch.id === request.branchId);
  const totals = request.lines.reduce((sum, line) => {
    const current = calculateLineAmounts(line);
    return {
      sales: sum.sales + current.sales,
      buyingCost: sum.buyingCost + current.buyingCost,
      grossProfit: sum.grossProfit + current.grossProfit,
      delivery: sum.delivery + current.deliveryCharges,
    };
  }, { sales: 0, buyingCost: 0, grossProfit: 0, delivery: 0 });
  const margin = totals.sales ? (totals.grossProfit / totals.sales) * 100 : 0;
  const nextStatuses = actor.isOwner ? allowedNextStatuses(request.status) : [];
  const updateAction = updateStatusAction.bind(null, id);
  const canMoveRequest = actor.isOwner
    && canAccess(actor, "manage_sourcing")
    && nextStatuses.length > 0
    && !(request.status === "New Request" && request.approvalStatus !== "Approved");

  return (
    <>
      <PageHeader
        eyebrow={actor.isOwner ? "Axora fulfilment request" : "Company purchase request"}
        title={request.orderCode}
        description={actor.isOwner
          ? `${request.companyName} · ${request.branchName} · ${request.lines.length} item${request.lines.length === 1 ? "" : "s"}`
          : `${request.branchName} · ${request.lines.length} requested item${request.lines.length === 1 ? "" : "s"}`}
      />

      <section className="request-summary">
        <div className="summary-box"><span>Company approval</span><strong><StatusBadge>{request.approvalStatus}</StatusBadge></strong></div>
        <div className="summary-box"><span>Fulfilment status</span><strong><StatusBadge>{request.status}</StatusBadge></strong></div>
        <div className="summary-box"><span>Needed by</span><strong>{formatDate(request.neededByDate)}</strong></div>
        <div className="summary-box"><span>{actor.isOwner ? "Customer total" : "Estimated total"}</span><strong>{formatCurrency(request.estimatedTotal)}</strong></div>
        {actor.isOwner ? <>
          <div className="summary-box"><span>Supplier buying cost</span><strong>{formatCurrency(totals.buyingCost)}</strong></div>
          <div className="summary-box"><span>Gross margin</span><strong>{formatCurrency(totals.grossProfit)} · {margin.toFixed(1)}%</strong></div>
        </> : null}
      </section>

      <RequestPricingSummary
        subtotal={request.subtotal ?? totals.sales}
        estimatedDeliveryFee={request.estimatedDeliveryFee ?? 0}
        taxRate={request.taxRate ?? 0}
        taxAmount={request.taxAmount ?? 0}
        estimatedTotal={request.estimatedTotal}
        totalLabel={actor.isOwner ? "Customer total" : "Estimated total"}
      />

      <section className="detail-grid">
        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Requested items</h2>
                <p>{actor.isOwner ? "Customer pricing, supplier sourcing and delivery by line" : "Catalog items and estimated customer prices submitted for approval"}</p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  {actor.isOwner
                    ? <tr><th>Line</th><th>Product</th><th>Quantity</th><th>Supplier</th><th>Buy total</th><th>Customer total</th><th>Delivery</th></tr>
                    : <tr><th>Item</th><th>Product</th><th>Quantity</th><th>Unit price</th><th>Estimated line total</th><th>Delivery</th></tr>}
                </thead>
                <tbody>
                  {request.lines.map((line) => {
                    const amount = calculateLineAmounts(line);
                    return actor.isOwner
                      ? <tr key={line.id}>
                          <td><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></td>
                          <td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td>
                          <td>{line.quantity} {line.unit}</td>
                          <td>{line.supplierName || "Not assigned"}<br /><span className="subtle">{line.supplierConfirmationStatus}</span></td>
                          <td>{formatCurrency(amount.buyingCost)}</td>
                          <td>{formatCurrency(amount.sales)}</td>
                          <td><StatusBadge>{line.deliveryStatus}</StatusBadge></td>
                        </tr>
                      : <tr key={line.id}>
                          <td><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></td>
                          <td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td>
                          <td>{line.quantity} {line.unit}</td>
                          <td>{formatCurrency(line.unitSellPrice)}</td>
                          <td>{formatCurrency(amount.sales)}</td>
                          <td><StatusBadge>{line.deliveryStatus}</StatusBadge></td>
                        </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-header"><div><h2>{actor.isOwner ? "Operational information" : "Request and budget information"}</h2><p>{actor.isOwner ? "Customer intake, finance and delivery context" : "Who requested the items, where they are needed and their approval impact"}</p></div></div>
            <div className="panel-body">
              <div className="form-grid">
                <div className="readiness-item"><UserRound size={19} /><div><strong>{request.requestedBy}</strong><p>{request.department} · {request.requesterContact}</p></div></div>
                <div className="readiness-item"><Route size={19} /><div><strong>{request.branchName}</strong><p>{request.requestType} · {request.urgency} urgency</p></div></div>
                {canViewInvoices ? <div className="readiness-item"><PackageCheck size={19} /><div><strong>{request.invoiceNumber || "No customer invoice yet"}</strong><p>{request.invoiceStatus} · {request.paymentStatus}</p></div></div> : null}
                {actor.isOwner
                  ? <div className="readiness-item"><CircleDollarSign size={19} /><div><strong>{formatCurrency(totals.delivery)} delivery fees</strong><p>Reported separately from product sales and internal margin.</p></div></div>
                  : <div className="readiness-item"><WalletCards size={19} /><div>
                      <strong>{branchBudget?.monthlyBudget != null ? `${formatCurrency(branchBudget.remainingAmount ?? 0)} remaining` : "No monthly budget configured"}</strong>
                      <p>{branchBudget?.monthlyBudget != null
                        ? `${formatCurrency(branchBudget.committedAmount)} committed from a ${formatCurrency(branchBudget.monthlyBudget)} monthly branch budget.`
                        : "A company administrator can set this branch’s budget from the Branches page."}</p>
                    </div></div>}
              </div>
            </div>
          </article>
        </div>

        <aside className="panel form-panel">
          {actor.isOwner ? <>
            <h2>Axora fulfilment</h2>
            <p>Axora can begin sourcing only after the customer company approves this request.</p>
            {request.status === "New Request" && request.approvalStatus !== "Approved"
              ? <div className="callout"><strong>{request.approvalStatus === "Rejected" ? "The company rejected this request." : "Waiting for company approval."}</strong><p>{request.approvalReason || "An authorised company approver must decide before Axora moves the request into sourcing."}</p></div>
              : canMoveRequest
                ? <form action={updateAction}>
                    <label>Allowed next status<select name="status" defaultValue={nextStatuses[0]}>{nextStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                    <label style={{ marginTop: 13 }}>Reason / note<textarea name="reason" placeholder="Required for hold, cancellation or resuming from hold" /></label>
                    <div className="form-actions"><button className="button button-primary" type="submit">Update fulfilment status</button></div>
                  </form>
                : <div className="callout"><strong>{nextStatuses.length ? "Read-only access" : "This workflow is closed."}</strong><p>{nextStatuses.length ? "Your role can view this request but cannot change its fulfilment status." : "Completed and cancelled requests are read-only."}</p></div>}
          </> : <>
            <h2>Company approval</h2>
            <p>An authorised company approver decides whether this request may use the branch budget.</p>
            <div className="callout">
              <strong>{request.approvalStatus === "Pending"
                ? "Waiting for a company decision."
                : request.approvalStatus === "Approved"
                  ? `Approved${request.approvedByName ? ` by ${request.approvedByName}` : ""}.`
                  : "Rejected by the company."}</strong>
              <p>{request.approvalReason || (request.approvalStatus === "Pending"
                ? "Axora will start fulfilment only after approval."
                : "The decision is recorded in the request history.")}</p>
            </div>
            {request.approvalStatus === "Pending" && canAccess(actor, "approve_requests")
              ? <div className="form-actions"><Link className="button button-primary" href="/approvals">Review approval</Link></div>
              : null}
          </>}

          <h3 className="section-title">Timeline</h3>
          <div className="timeline">
            <div className="timeline-item"><div className="timeline-dot" /><div><strong>Request created</strong><p>{formatDate(request.requestDate)} by {request.requestedBy}</p></div></div>
            <div className="timeline-item"><div className="timeline-dot" /><div><strong>Company approval: {request.approvalStatus}</strong><p>{request.approvedByName || (request.approvalStatus === "Pending" ? "Awaiting an authorised approver" : "Decision recorded")}</p></div></div>
            <div className="timeline-item"><div className="timeline-dot" /><div><strong>{request.status}</strong><p>Current Axora fulfilment position</p></div></div>
            {request.completedDate ? <div className="timeline-item"><div className="timeline-dot" /><div><strong>Completed</strong><p>{formatDate(request.completedDate)}</p></div></div> : null}
          </div>
        </aside>
      </section>
    </>
  );
}
