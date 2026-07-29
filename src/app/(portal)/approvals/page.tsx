import { ApprovalDecisionForm } from "@/components/ApprovalDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listApprovals } from "@/lib/operations";
import { listBranches, listRequests } from "@/lib/repository";

export default async function ApprovalsPage() {
  const actor = await requirePagePermission("view_approvals");
  const canDecide = canAccess(actor, "approve_requests");
  const [requests, approvals, branches] = await Promise.all([listRequests(actor), listApprovals(), listBranches(actor)]);
  const awaitingDecision = requests.filter((item) => item.status === "New Request" && item.approvalStatus === "Pending");
  const pending = awaitingDecision.filter((item) => item.requesterContact.toLowerCase() !== actor.email.toLowerCase());
  const ownPendingCount = awaitingDecision.length - pending.length;

  return <><PageHeader eyebrow={actor.isOwner ? "Customer authorization" : "Branch purchasing control"} title="Purchase request approvals"
    description={actor.isOwner
      ? "Company approvers own these decisions. Axora starts verification and sourcing only after an approved company decision."
      : "Review the requester, items, estimated total and branch budget. You cannot approve your own request."} />

    {canDecide ? <section>
      {ownPendingCount ? <div className="callout" style={{ marginBottom: 17 }}><strong>Your own {ownPendingCount === 1 ? "request needs" : `${ownPendingCount} requests need`} another approver.</strong><p>Separation of duties prevents anyone from approving their own purchase request.</p></div> : null}
      {pending.length ? <div className="detail-grid">{pending.map((request) => {
        const branch = branches.find((item) => item.id === request.branchId);
        const projected = branch?.remainingAmount == null ? undefined : branch.remainingAmount - request.estimatedTotal;
        return <article className="panel" key={request.id}>
          <div className="panel-header"><div><h2>{request.orderCode}</h2><p>{request.requestedBy} · {request.branchName}</p></div><StatusBadge>Pending</StatusBadge></div>
          <div className="panel-body">
            <div className="request-summary">
              <div className="summary-box"><span>Request total</span><strong>{formatCurrency(request.estimatedTotal)}</strong></div>
              <div className="summary-box"><span>Monthly budget</span><strong>{branch?.monthlyBudget == null ? "No limit" : formatCurrency(branch.monthlyBudget)}</strong></div>
              <div className="summary-box"><span>Available now</span><strong>{branch?.remainingAmount == null ? "No limit" : formatCurrency(branch.remainingAmount)}</strong></div>
              <div className="summary-box"><span>After approval</span><strong>{projected === undefined ? "No limit" : formatCurrency(Math.max(projected, 0))}</strong></div>
            </div>
            <p><strong>Needed by:</strong> {formatDate(request.neededByDate)} · <strong>Priority:</strong> {request.urgency}</p>
            <ul>{request.lines.map((line) => <li key={line.id}>{line.productName} · {line.quantity} {line.unit}</li>)}</ul>
            {projected !== undefined && projected < 0 ? <div className="callout"><strong>Over budget</strong><p>Approval is blocked until the company administrator increases the branch budget or the request changes.</p></div> : null}

            <ApprovalDecisionForm
              requestId={request.id}
              approvalDisabled={projected !== undefined && projected < 0}
            />
          </div>
        </article>;
      })}</div> : <div className="panel empty-state"><strong>No requests are waiting for your approval.</strong><p>New requests for your access scope will appear here.</p></div>}
    </section> : null}

    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-header"><div><h2>Decision history</h2><p>One final company decision per purchase request</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Company</th><th>Decision</th><th>Reviewer</th><th>Date</th><th>Reason</th></tr></thead>
        <tbody>{approvals.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong></td><td>{item.companyName}</td>
          <td><StatusBadge>{item.status}</StatusBadge></td><td>{item.reviewerName || "—"}</td><td>{formatDate(item.decidedAt || item.createdAt)}</td><td>{item.reason || "—"}</td></tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
