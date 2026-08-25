import { PageHeader } from "@/components/PageHeader";
import { RequestPricingSummary } from "@/components/RequestPricingSummary";
import { RequestDraftCleanup } from "@/components/RequestDraftBoundary";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { calculateLineAmounts, formatCurrency, formatDate, formatDateTime } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { approvalActionLabel, approvalStateLabel } from "@/lib/budget-approval-i18n";
import { requestDetailMessages } from "@/lib/request-detail-i18n";
import { canAccess } from "@/lib/permissions";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import {
  getAuthorizedRequest,
  listAuthorizedRequestWorkflowEvents,
} from "@/lib/request-reader";
import { getRequestApprovalTimeline } from "@/lib/request-approval";
import { allowedNextStatuses } from "@/lib/workflow";
import { CircleDollarSign, PackageCheck, Route, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveAndPayRequestAction, cancelPurchaseRequestAction, updateStatusAction } from "../actions";
import { getFinalInvoiceSummary } from "@/lib/payment-checkout";
import { formatMoneyDecimal } from "@/lib/money-decimal";
import { randomUUID } from "node:crypto";
import {
  isApproveAndPayLocalNotReadyState,
  isApproveAndPayResultStatus,
} from "@/lib/finance-business-results";
import { approveAndPayResultCopy, walletMessages } from "@/lib/wallet-i18n";
import { cartMessages } from "@/lib/cart-i18n";

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    financeResult?: string;
    financeState?: string;
    financeError?: string;
    cancelNotice?: string;
    notice?: string;
    placed?: string;
  }>;
}) {
  const { id } = await params;
  const actor = await requirePagePermission("view_requests");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const requestCopy = corePortalMessages(locale).requests;
  const detail = requestDetailMessages(locale);
  const receiptCopy = cartMessages(locale);
  const walletCopy = walletMessages(locale);
  const feedback = await searchParams;
  const financeResult = isApproveAndPayResultStatus(feedback.financeResult)
    ? feedback.financeResult
    : undefined;
  const financeState = isApproveAndPayLocalNotReadyState(feedback.financeState)
    ? feedback.financeState
    : undefined;
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const canViewRevenue = !platformView || canAccess(actor, "view_platform_revenue");
  const canViewCost = platformView && canAccess(actor, "view_internal_cost");
  const canViewProfit = platformView && canAccess(actor, "view_platform_profit");
  const request = await getAuthorizedRequest(actor, id);
  if (!request) notFound();
  const isDirectOrder = request.purchaseMode === "COMPANY_ADMIN_DIRECT";
  const showPlacedReceipt = feedback.placed === "1"
    && isDirectOrder
    && request.paymentStatus === "Paid";
  const canViewInvoices = request.invoiceStatus !== undefined
    || request.paymentStatus !== undefined
    || request.invoiceNumber !== undefined;

  const [branchBudget, workflowTimeline, approvalTimeline, finalInvoice] = await Promise.all([
    actor.accountKind === "PLATFORM"
      ? Promise.resolve(undefined)
      : loadOrganizationDirectory(actor).then(({ branches }) => (
          branches.find((branch) => branch.id === request.branchId)
        )),
    listAuthorizedRequestWorkflowEvents(actor, request.id),
    getRequestApprovalTimeline(actor, request.id),
    platformView ? Promise.resolve(null) : getFinalInvoiceSummary(actor, request.id),
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
  const nextStatuses = canAccess(actor, "manage_deliveries") ? allowedNextStatuses(request.status) : [];
  const updateAction = updateStatusAction.bind(null, id);
  const canMoveRequest = canAccess(actor, "manage_deliveries")
    && nextStatuses.length > 0
    && !(request.status === "New Request" && request.approvalStatus !== "Approved");
  const canFinalizeApprovedRequest = !platformView
    && !isDirectOrder
    && canAccess(actor, "approve_requests")
    && request.createdById !== actor.id
    && request.approvalStatus === "Approved"
    && !finalInvoice
    && Boolean(request.approvalRevision);
  const canCancelRequest = !platformView
    && !isDirectOrder
    && request.createdById === actor.id
    && (request.approvalStatus === "Pending" || request.approvalStatus === "Approved")
    && request.paymentStatus !== "Paid"
    && Boolean(request.approvalRevision);

  return (
    <>
      {feedback.notice === "request-submitted" && request.createdById === actor.id
        ? <RequestDraftCleanup scope={{ userId: actor.id, companyId: request.companyId }} />
        : null}
      <PageHeader
        eyebrow={platformView ? detail.platformEyebrow : isDirectOrder ? detail.companyOrderEyebrow : detail.companyEyebrow}
        title={request.orderCode}
        description={platformView
          ? `${request.companyName} · ${request.branchName} · ${isDirectOrder ? detail.orderedItemCount(request.lines.length) : detail.itemCount(request.lines.length)}`
          : `${request.branchName} · ${isDirectOrder ? detail.orderedItemCount(request.lines.length) : detail.itemCount(request.lines.length)}`}
      />

      {showPlacedReceipt ? <section className="cart-purchase-success" aria-labelledby="order-placed-title" role="status">
        <h2 id="order-placed-title">{receiptCopy.orderPlaced}</h2>
        <dl>
          <div><dt>{receiptCopy.order}</dt><dd translate="no">{request.orderCode}</dd></div>
          <div><dt>{receiptCopy.paidFromWallet}</dt><dd className="financial-value">{finalInvoice
            ? formatMoneyDecimal(finalInvoice.amount, finalInvoice.currency, locale)
            : formatCurrency(request.estimatedTotal, locale)}</dd></div>
          <div><dt>{receiptCopy.deliveringTo}</dt><dd>{request.branchName}</dd></div>
        </dl>
        <div className="form-actions">
          <Link className="button button-primary" href={`/requests/${encodeURIComponent(request.id)}`}>{receiptCopy.viewOrder}</Link>
          <Link className="button button-secondary" href={`/requests/${encodeURIComponent(request.id)}#invoice`}>{receiptCopy.viewInvoice}</Link>
          <Link className="button button-secondary" href="/deliveries">{receiptCopy.viewDelivery}</Link>
        </div>
      </section> : null}

      <section className="request-summary">
        <div className="summary-box"><span>{isDirectOrder ? detail.payment : requestCopy.approval}</span><strong><StatusBadge status={isDirectOrder ? "Paid" : request.approvalStatus}>{localizedStatus(isDirectOrder ? "Paid" : request.approvalStatus, locale)}</StatusBadge></strong></div>
        <div className="summary-box"><span>{requestCopy.fulfilment}</span><strong><StatusBadge status={request.status}>{localizedStatus(request.status, locale)}</StatusBadge></strong></div>
        <div className="summary-box"><span>{requestCopy.neededBy}</span><strong>{formatDate(request.neededByDate, locale, timeZone)}</strong></div>
        {!platformView || canViewRevenue ? <div className="summary-box"><span>{platformView ? requestCopy.customerTotal : isDirectOrder ? detail.orderTotal : requestCopy.estimatedTotal}</span><strong>{formatCurrency(request.estimatedTotal, locale)}</strong></div> : null}
        {platformView ? <>
          {canViewCost ? <div className="summary-box"><span>{detail.buyTotal}</span><strong>{formatCurrency(totals.buyingCost, locale)}</strong></div> : null}
          {canViewProfit ?
          <div className="summary-box"><span>{detail.grossMargin}</span><strong>{formatCurrency(totals.grossProfit, locale)} · {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(margin)}%</strong></div>
          : null}
        </> : null}
      </section>

      {!platformView || canViewRevenue ? <RequestPricingSummary
        subtotal={request.subtotal ?? totals.sales}
        estimatedDeliveryFee={request.estimatedDeliveryFee ?? 0}
        taxRate={request.taxRate ?? 0}
        taxAmount={request.taxAmount ?? 0}
        estimatedTotal={request.estimatedTotal}
        totalLabel={platformView ? requestCopy.customerTotal : isDirectOrder ? detail.orderTotal : requestCopy.estimatedTotal}
        locale={locale}
      /> : null}

      <section className="detail-grid">
        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>{isDirectOrder ? detail.orderedItems : detail.requestedItems}</h2>
                <p>{platformView ? detail.platformItemsBody : isDirectOrder ? detail.companyOrderItemsBody : detail.companyItemsBody}</p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{platformView ? detail.line : detail.item}</th><th>{detail.product}</th><th>{detail.quantity}</th>
                    {canViewCost ? <th>{detail.buyTotal}</th> : null}
                    {!platformView || canViewRevenue ? <th>{platformView ? detail.customerTotal : detail.unitPrice}</th> : null}
                    {!platformView ? <th>{detail.lineTotal}</th> : null}
                    <th>{detail.delivery}</th>
                  </tr>
                </thead>
                <tbody>
                  {request.lines.map((line, index) => {
                    const amount = calculateLineAmounts(line);
                    return <tr key={line.id}>
                      <td>{platformView ? <><strong>{line.code}</strong><br /><span className="subtle">{line.productCode}</span></> : <strong>{index + 1}</strong>}</td>
                      <td><strong>{line.productName}</strong><br /><span className="subtle">{line.specification || line.category}</span></td>
                      <td>{line.quantity} {line.unit}</td>
                      {canViewCost ? <td>{formatCurrency(amount.buyingCost, locale)}</td> : null}
                      {!platformView || canViewRevenue ? <td>{formatCurrency(platformView ? amount.sales : line.unitSellPrice, locale)}</td> : null}
                      {!platformView ? <td>{formatCurrency(amount.sales, locale)}</td> : null}
                      <td><StatusBadge status={line.deliveryStatus}>{localizedStatus(line.deliveryStatus, locale)}</StatusBadge></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-header"><div><h2>{platformView ? detail.operationsInfo : isDirectOrder ? detail.orderInfo : detail.requestInfo}</h2><p>{platformView ? detail.operationsBody : isDirectOrder ? detail.orderInfoBody : detail.requestBody}</p></div></div>
            <div className="panel-body">
              <div className="form-grid">
                <div className="readiness-item"><UserRound size={19} /><div><strong>{request.requestedBy}</strong><p>{request.department} · {request.requesterContact}</p></div></div>
                <div className="readiness-item"><Route size={19} /><div><strong>{request.branchName}</strong><p>{isDirectOrder ? detail.directOrder : `${request.requestType} · ${localizedStatus(request.urgency, locale)}`}</p></div></div>
                {canViewInvoices ? <div id={finalInvoice ? undefined : "invoice"} className="readiness-item"><PackageCheck size={19} /><div><strong>{request.invoiceNumber || detail.noInvoice}</strong><p>{localizedStatus(request.invoiceStatus ?? detail.notAssigned, locale)} · {localizedStatus(request.paymentStatus ?? "Unpaid", locale)}</p></div></div> : null}
                {platformView
                  ? canViewRevenue ? <div className="readiness-item"><CircleDollarSign size={19} /><div><strong>{formatCurrency(totals.delivery, locale)} {detail.deliveryFees}</strong><p>{detail.deliveryFeesBody}</p></div></div> : null
                  : <div className="readiness-item"><WalletCards size={19} /><div>
                      <strong>{branchBudget?.canViewBudget && branchBudget.monthlyBudget != null ? `${formatCurrency(branchBudget.remainingAmount ?? 0, locale)} ${detail.remaining}` : detail.noBudget}</strong>
                      <p>{branchBudget?.canViewBudget && branchBudget.monthlyBudget != null
                        ? detail.committedBudget(formatCurrency(branchBudget.committedAmount ?? 0, locale), formatCurrency(branchBudget.monthlyBudget, locale))
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
                    <div className="form-actions"><button className="button button-primary" type="submit">{detail.updateStatus}</button></div>
                  </form>
                : <div className="callout"><strong>{nextStatuses.length ? detail.readOnly : detail.closed}</strong><p>{nextStatuses.length ? detail.readOnlyBody : detail.closedBody}</p></div>}
          </> : <>
            {isDirectOrder ? <>
              <h2>{detail.directOrder}</h2>
              <p>{detail.directOrderCustomerBody}</p>
              <div className="callout" role="status">
                <strong>{detail.orderPaid}</strong>
                <p>{detail.directOrderEvidence}</p>
              </div>
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
              {feedback.cancelNotice ? <div className="callout" role={feedback.cancelNotice === "complete" ? "status" : "alert"} style={{ marginBlockStart: 20 }}>
                <strong>{feedback.cancelNotice === "complete" ? detail.cancellationComplete : detail.cancellationFailed}</strong>
              </div> : null}
              {canCancelRequest ? <form action={cancelPurchaseRequestAction.bind(null, id)} style={{ marginBlockStart: 20 }}>
                <input type="hidden" name="approvalRevision" value={request.approvalRevision} />
                <input type="hidden" name="commandId" value={randomUUID()} />
                <div className="callout"><strong>{detail.cancellationTitle}</strong><p>{detail.cancellationBody}</p></div>
                <div className="form-actions"><button className="button button-danger" type="submit">{detail.cancelRequest}</button></div>
              </form> : null}
              {financeResult ? <div className="callout" role={financeResult === "SUCCESS" || financeResult === "ALREADY_PROCESSED" ? "status" : "alert"} style={{ marginBlockStart: 20 }}>
                <strong>{approveAndPayResultCopy(locale, financeResult, financeState).title}</strong>
                <p>{approveAndPayResultCopy(locale, financeResult, financeState).body}</p>
              </div> : null}
              {feedback.financeError ? <div className="callout" role="alert" style={{ marginBlockStart: 20 }}><strong>{walletCopy.unavailable}</strong><p>{walletCopy.invalidSubmission}</p></div> : null}
              {canFinalizeApprovedRequest ? <form action={approveAndPayRequestAction.bind(null, id)} style={{ marginBlockStart: 20 }}>
                <input type="hidden" name="approvalRevision" value={request.approvalRevision} />
                <input type="hidden" name="commandId" value={randomUUID()} />
                <div className="callout"><strong>{walletCopy.approveAndPay}</strong><p>{walletCopy.approveAndPayIntro}</p></div>
                <div className="form-actions"><button className="button button-primary" type="submit">{walletCopy.approveAndPay}</button></div>
              </form> : null}
            </>}
            {finalInvoice ? <div id="invoice" className="callout" style={{ marginBlockStart: 20 }}>
              <strong>{detail.paid}</strong>
              <p>{finalInvoice.invoiceNumber} · {formatMoneyDecimal(finalInvoice.amount, finalInvoice.currency, locale)} · {formatDateTime(finalInvoice.paidAt, locale, timeZone)}</p>
              <p>{detail.invoiceEmailStatus(finalInvoice.emailStatus ?? "PENDING")}</p>
              {finalInvoice.downloadUrl ? <div className="form-actions"><Link className="button button-secondary" href={finalInvoice.downloadUrl}>{detail.downloadInvoice}</Link></div> : <p>{detail.invoicePreparing}</p>}
            </div> : null}
          </>}

          <h3 className="section-title">{detail.timeline}</h3>
          <div className="timeline">
            {approvalTimeline?.events.map((event) => (
              <div className="timeline-item" key={`approval-${event.id}`}>
                <div className="timeline-dot" />
                <div>
                  <strong>{isDirectOrder && event.action === "DIRECT_PURCHASE"
                    ? detail.orderPlaced
                    : `${approvalActionLabel(locale, event.action)} · ${approvalStateLabel(locale, event.stateAfter)}`}</strong>
                  <p>{formatDateTime(event.decidedAt, locale, timeZone)}{isDirectOrder && event.action === "DIRECT_PURCHASE" ? ` · ${detail.directOrderEvidence}` : ` · ${event.reason}`}</p>
                </div>
              </div>
            ))}
            {workflowTimeline.length ? workflowTimeline.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div className="timeline-dot" />
                <div>
                  <strong>{detail.workflow[event.eventKey] ?? (event.newState ? localizedStatus(event.newState, locale) : detail.workflowUpdated)}</strong>
                  <p>{formatDateTime(event.occurredAt, locale, timeZone)}{event.actorName ? detail.byActor(event.actorName) : detail.bySystem}{event.reason ? ` · ${event.reason}` : ""}</p>
                </div>
              </div>
            )) : <>
              <div className="timeline-item"><div className="timeline-dot" /><div><strong>{isDirectOrder ? detail.orderPlaced : detail.requestCreated}</strong><p>{formatDateTime(request.requestDate, locale, timeZone)}{detail.byActor(request.requestedBy)}</p></div></div>
              {!isDirectOrder ? <div className="timeline-item"><div className="timeline-dot" /><div><strong>{detail.approvalTimeline(localizedStatus(request.approvalStatus, locale))}</strong><p>{request.approvedByName || (request.approvalStatus === "Pending" ? detail.awaitingApprover : detail.decisionRecorded)}</p></div></div> : null}
              <div className="timeline-item"><div className="timeline-dot" /><div><strong>{localizedStatus(request.status, locale)}</strong><p>{detail.currentPosition}</p></div></div>
            </>}
          </div>
        </aside>
      </section>
    </>
  );
}
