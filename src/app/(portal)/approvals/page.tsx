import { ApprovalDecisionForm } from "@/components/ApprovalDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { RequestPricingSummary } from "@/components/RequestPricingSummary";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import {
  calculateLineAmounts,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listAuthorizedApprovals } from "@/lib/operational-isolation";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { listAuthorizedRequests } from "@/lib/request-reader";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";

export default async function ApprovalsPage() {
  const actor = await requirePagePermission("view_approvals");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = corePortalMessages(locale).approvals;
  const canDecide = canAccess(actor, "approve_requests");
  const [requests, approvals, organization] = await Promise.all([
    listAuthorizedRequests(actor),
    listAuthorizedApprovals(actor),
    loadOrganizationDirectory(actor),
  ]);
  const branches = organization.branches;
  const awaitingDecision = requests.filter((item) => item.status === "New Request" && item.approvalStatus === "Pending");
  const pending = awaitingDecision.filter((item) => item.createdById
    ? item.createdById !== actor.id
    : item.requesterContact.toLowerCase() !== actor.email.toLowerCase());
  const ownPendingCount = awaitingDecision.length - pending.length;

  return <><PageHeader eyebrow={actor.isOwner ? copy.platformEyebrow : copy.companyEyebrow} title={copy.title}
    description={actor.isOwner ? copy.platformDescription : copy.companyDescription} />

    {canDecide ? <section>
      {ownPendingCount ? <div className="callout" style={{ marginBlockEnd: 17 }}><strong>{ownPendingCount === 1 ? copy.ownSingle : copy.ownMany(ownPendingCount)}</strong><p>{copy.separation}</p></div> : null}
      {pending.length ? <div className="detail-grid">{pending.map((request) => {
        const branch = branches.find((item) => item.id === request.branchId);
        const projected = branch?.canViewBudget && branch.remainingAmount != null
          ? branch.remainingAmount - request.estimatedTotal
          : undefined;
        const requestSubtotal = request.subtotal ?? request.lines.reduce(
          (total, line) =>
            total + calculateLineAmounts(line).sales,
          0,
        );

        return <article className="panel" key={request.id}>
          <div className="panel-header"><div><h2>{request.orderCode}</h2><p>{request.requestedBy} · {request.branchName}</p></div><StatusBadge status="Pending">{localizedStatus("Pending", locale)}</StatusBadge></div>
          <div className="panel-body">
            <div className="request-summary">
              <div className="summary-box"><span>{copy.requestTotal}</span><strong>{formatCurrency(request.estimatedTotal, locale)}</strong></div>
              <div className="summary-box"><span>{copy.monthlyBudget}</span><strong>{branch?.canViewBudget && branch.monthlyBudget != null ? formatCurrency(branch.monthlyBudget, locale) : corePortalMessages(locale).common.noLimit}</strong></div>
              <div className="summary-box"><span>{copy.availableNow}</span><strong>{branch?.canViewBudget && branch.remainingAmount != null ? formatCurrency(branch.remainingAmount, locale) : corePortalMessages(locale).common.noLimit}</strong></div>
              <div className="summary-box"><span>{copy.afterApproval}</span><strong>{projected === undefined ? corePortalMessages(locale).common.noLimit : formatCurrency(Math.max(projected, 0), locale)}</strong></div>
            </div>

            <RequestPricingSummary
              subtotal={requestSubtotal}
              estimatedDeliveryFee={request.estimatedDeliveryFee ?? 0}
              taxRate={request.taxRate ?? 0}
              taxAmount={request.taxAmount ?? 0}
              estimatedTotal={request.estimatedTotal}
              totalLabel={copy.committedTotal}
              locale={locale}
            />

            <p><strong>{copy.neededBy}:</strong> {formatDate(request.neededByDate, locale, timeZone)} · <strong>{copy.priority}:</strong> {localizedStatus(request.urgency, locale)}</p>
            <ul>{request.lines.map((line) => <li key={line.id}>{line.productName} · {line.quantity} {line.unit}</li>)}</ul>
            {projected !== undefined && projected < 0 ? <div className="callout"><strong>{copy.overBudget}</strong><p>{copy.overBudgetBody}</p></div> : null}

            <ApprovalDecisionForm
              requestId={request.id}
              approvalDisabled={projected !== undefined && projected < 0}
              locale={locale}
            />
          </div>
        </article>;
      })}</div> : <div className="panel empty-state"><strong>{copy.empty}</strong><p>{copy.emptyBody}</p></div>}
    </section> : null}

    <section className="panel" style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.history}</h2><p>{copy.historyBody}</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.request}</th><th>{corePortalMessages(locale).common.company}</th><th>{copy.decision}</th><th>{copy.reviewer}</th><th>{corePortalMessages(locale).common.date}</th><th>{corePortalMessages(locale).common.reason}</th></tr></thead>
        <tbody>{approvals.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong></td><td>{item.companyName}</td>
          <td><StatusBadge status={item.status}>{localizedStatus(item.status, locale)}</StatusBadge></td><td>{item.reviewerName || "—"}</td><td>{formatDateTime(item.decidedAt || item.createdAt, locale, timeZone)}</td><td>{item.reason || "—"}</td></tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
