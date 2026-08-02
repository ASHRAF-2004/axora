import { PageHeader } from "@/components/PageHeader";
import { RequestPricingSummary } from "@/components/RequestPricingSummary";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { calculateLineAmounts, formatCurrency, formatDate, formatDateTime } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { requestDetailMessages } from "@/lib/request-detail-i18n";
import { canAccess } from "@/lib/permissions";
import { getRequest, listBranches } from "@/lib/repository";
import { allowedNextStatuses } from "@/lib/workflow";
import { CircleDollarSign, PackageCheck, Route, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateStatusAction } from "../actions";
import { listRequestWorkflowEvents } from "@/lib/workflow-repository";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePagePermission("view_requests");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const requestCopy = corePortalMessages(locale).requests;
  const detail = requestDetailMessages(locale);
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const canViewInvoices = canAccess(actor, "view_invoices");
  const request = await getRequest(id, actor);
  if (!request) notFound();

  const [branchBudget, workflowTimeline] = await Promise.all([
    actor.accountKind === "PLATFORM"
      ? Promise.resolve(undefined)
      : listBranches(actor).then((branches) => branches.find((branch) => branch.id === request.branchId)),
    listRequestWorkflowEvents(actor, request.id),
  ]);
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
  const nextStatuses = canAccess(actor, "manage_sourcing") ? allowedNextStatuses(request.status) : [];
  const updateAction = updateStatusAction.bind(null, id);
  const canMoveRequest = canAccess(actor, "manage_sourcing")
    && nextStatuses.length > 0
    && !(request.status === "New Request" && request.approvalStatus !== "Approved");

  return (
    <>
      <PageHeader
        eyebrow={platformView ? detail.platformEyebrow : detail.companyEyebrow}
        title={request.orderCode}
        description={platformView
          ? `${request.companyName} · ${request.branchName} · ${detail.itemCount(request.lines.length)}`
          : `${request.branchName} · ${detail.itemCount(request.lines.length)}`}
      />

      <section className="request-summary">
        <div className="summary-box"><span>{requestCopy.approval}</span><strong><StatusBadge status={request.approvalStatus}>{localizedStatus(request.approvalStatus, locale)}</StatusBadge></strong></div>
        <div className="summary-box"><span>{requestCopy.fulfilment}</span><strong><StatusBadge status={request.status}>{localizedStatus(request.status, locale)}</StatusBadge></strong></div>
        <div className="summary-box"><span>{requestCopy.neededBy}</span><strong>{formatDate(request.neededByDate, locale, timeZone)}</strong></div>
        <div className="summary-box"><span>{platformView ? requestCopy.customerTotal : requestCopy.estimatedTotal}</span><strong>{formatCurrency(request.estimatedTotal, locale)}</strong></div>
        {platformView ? <>
          <div className="summary-box"><span>{detail.supplierCost}</span><strong>{formatCurrency(totals.buyingCost, locale)}</strong></div>
          <div className="summary-box"><span>{detail.grossMargin}</span><strong>{formatCurrency(totals.grossProfit, locale)} · {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(margin)}%</strong></div>
        </> : null}
      </section>

      <RequestPricingSummary
        subtotal={request.subtotal ?? totals.sales}
        estimatedDeliveryFee={request.estimatedDeliveryFee ?? 0}
        taxRate={request.taxRate ?? 0}
        taxAmount={request.taxAmount ?? 0}
        estimatedTotal={request.estimatedTotal}
        totalLabel={platformView ? requestCopy.customerTotal : requestCopy.estimatedTotal}
        locale={locale}
      />

      <section className="detail-grid">
        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>{detail.requestedItems}</h2>
                <p>{platformView ? detail.platformItemsBody : detail.companyItemsBody}</p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  {platformView
                    ? <tr><th>{detail.line}</th><th>{detail.product}</th><th>{detail.quantity}</th><th>{detail.supplier}</th><th>{detail.buyTotal}</th><th>{detail.customerTotal}</th><th>{detail.delivery}</th></tr>
                    : <tr><th>{detail.item}</th><th>{detail.product}</th><th>{detail.quantity}</th><th>{detail.unitPrice}</th><th>{detail.lineTotal}</th><th>{detail.delivery}</th></tr>}
                </thead>
                <tbody>
                  {request.lines.map((line) => {
                    const amount = calculateLineAmounts(line);
                    return platformView
                      ? <tr key={line.id}>
                          <td><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></td>
                          <td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td>
                          <td>{line.quantity} {line.unit}</td>
                          <td>{line.supplierName || detail.notAssigned}<br /><span className="subtle">{localizedStatus(line.supplierConfirmationStatus ?? detail.notAssigned, locale)}</span></td>
                          <td>{formatCurrency(amount.buyingCost, locale)}</td>
                          <td>{formatCurrency(amount.sales, locale)}</td>
                          <td><StatusBadge status={line.deliveryStatus}>{localizedStatus(line.deliveryStatus, locale)}</StatusBadge></td>
                        </tr>
                      : <tr key={line.id}>
                          <td><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></td>
                          <td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td>
                          <td>{line.quantity} {line.unit}</td>
                          <td>{formatCurrency(line.unitSellPrice, locale)}</td>
                          <td>{formatCurrency(amount.sales, locale)}</td>
                          <td><StatusBadge status={line.deliveryStatus}>{localizedStatus(line.deliveryStatus, locale)}</StatusBadge></td>
                        </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-header"><div><h2>{platformView ? detail.operationsInfo : detail.requestInfo}</h2><p>{platformView ? detail.operationsBody : detail.requestBody}</p></div></div>
            <div className="panel-body">
              <div className="form-grid">
                <div className="readiness-item"><UserRound size={19} /><div><strong>{request.requestedBy}</strong><p>{request.department} · {request.requesterContact}</p></div></div>
                <div className="readiness-item"><Route size={19} /><div><strong>{request.branchName}</strong><p>{request.requestType} · {localizedStatus(request.urgency, locale)}</p></div></div>
                {canViewInvoices ? <div className="readiness-item"><PackageCheck size={19} /><div><strong>{request.invoiceNumber || detail.noInvoice}</strong><p>{localizedStatus(request.invoiceStatus ?? detail.notAssigned, locale)} · {localizedStatus(request.paymentStatus ?? "Unpaid", locale)}</p></div></div> : null}
                {platformView
                  ? <div className="readiness-item"><CircleDollarSign size={19} /><div><strong>{formatCurrency(totals.delivery, locale)} {detail.deliveryFees}</strong><p>{detail.deliveryFeesBody}</p></div></div>
                  : <div className="readiness-item"><WalletCards size={19} /><div>
                      <strong>{branchBudget?.monthlyBudget != null ? `${formatCurrency(branchBudget.remainingAmount ?? 0, locale)} ${detail.remaining}` : detail.noBudget}</strong>
                      <p>{branchBudget?.monthlyBudget != null
                        ? detail.committedBudget(formatCurrency(branchBudget.committedAmount, locale), formatCurrency(branchBudget.monthlyBudget, locale))
                        : detail.budgetHelp}</p>
                    </div></div>}
              </div>
            </div>
          </article>
        </div>

        <aside className="panel form-panel">
          {platformView ? <>
            <h2>{detail.fulfilment}</h2>
            <p>{detail.fulfilmentBody}</p>
            {request.status === "New Request" && request.approvalStatus !== "Approved"
              ? <div className="callout"><strong>{request.approvalStatus === "Rejected" ? detail.rejected : detail.waitingApproval}</strong><p>{request.approvalReason || detail.approvalRequired}</p></div>
              : canMoveRequest
                ? <form action={updateAction}>
                    <label>{detail.nextStatus}<select name="status" defaultValue={nextStatuses[0]}>{nextStatuses.map((status) => <option key={status} value={status}>{localizedStatus(status, locale)}</option>)}</select></label>
                    <label style={{ marginBlockStart: 13 }}>{detail.note}<textarea name="reason" placeholder={detail.notePlaceholder} /></label>
                    <div className="form-actions"><button className="button button-primary" type="submit">{detail.updateStatus}</button></div>
                  </form>
                : <div className="callout"><strong>{nextStatuses.length ? detail.readOnly : detail.closed}</strong><p>{nextStatuses.length ? detail.readOnlyBody : detail.closedBody}</p></div>}
          </> : <>
            <h2>{detail.companyApproval}</h2>
            <p>{detail.companyApprovalBody}</p>
            <div className="callout">
              <strong>{request.approvalStatus === "Pending"
                ? detail.waitingDecision
                : request.approvalStatus === "Approved"
                  ? detail.approvedBy(request.approvedByName)
                  : detail.companyRejected}</strong>
              <p>{request.approvalReason || (request.approvalStatus === "Pending"
                ? detail.afterApproval
                : detail.decisionRecorded)}</p>
            </div>
            {request.approvalStatus === "Pending" && canAccess(actor, "approve_requests")
              ? <div className="form-actions"><Link className="button button-primary" href="/approvals">{detail.reviewApproval}</Link></div>
              : null}
          </>}

          <h3 className="section-title">{detail.timeline}</h3>
          <div className="timeline">
            {workflowTimeline.length ? workflowTimeline.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div className="timeline-dot" />
                <div>
                  <strong>{detail.workflow[event.eventKey] ?? (event.newState ? localizedStatus(event.newState, locale) : detail.workflowUpdated)}</strong>
                  <p>{formatDateTime(event.occurredAt, locale, timeZone)}{event.actorName ? detail.byActor(event.actorName) : event.source === "SUPPLIER_PORTAL" ? detail.bySupplier : detail.bySystem}{event.reason ? ` · ${event.reason}` : ""}</p>
                </div>
              </div>
            )) : <>
              <div className="timeline-item"><div className="timeline-dot" /><div><strong>{detail.requestCreated}</strong><p>{formatDateTime(request.requestDate, locale, timeZone)}{detail.byActor(request.requestedBy)}</p></div></div>
              <div className="timeline-item"><div className="timeline-dot" /><div><strong>{detail.approvalTimeline(localizedStatus(request.approvalStatus, locale))}</strong><p>{request.approvedByName || (request.approvalStatus === "Pending" ? detail.awaitingApprover : detail.decisionRecorded)}</p></div></div>
              <div className="timeline-item"><div className="timeline-dot" /><div><strong>{localizedStatus(request.status, locale)}</strong><p>{detail.currentPosition}</p></div></div>
            </>}
          </div>
        </aside>
      </section>
    </>
  );
}
