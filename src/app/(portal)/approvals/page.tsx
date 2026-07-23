import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/domain";
import { listApprovals } from "@/lib/operations";
import { listRequests } from "@/lib/repository";
import { recordApprovalAction } from "../operations/actions";

export default async function ApprovalsPage() {
  const [requests, approvals] = await Promise.all([listRequests(), listApprovals()]);
  return <><PageHeader eyebrow="Supervisor evidence" title="Approvals" description="Record who reviewed a request, the decision, and the reason. A rejected decision always needs an explanation." />
    <section className="detail-grid"><article className="panel form-panel"><h2>Record a decision</h2><form action={recordApprovalAction}><div className="form-grid">
      <label className="field-full">Request<select name="requestId" required defaultValue=""><option value="" disabled>Select request</option>{requests.filter((item) => !["Completed", "Cancelled"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.orderCode} · {item.companyName} · {item.status}</option>)}</select></label>
      <label>Approval type<input name="approvalType" defaultValue="Procurement" required /></label><label>Decision<select name="status" defaultValue="Pending"><option>Pending</option><option>Approved</option><option>Rejected</option></select></label>
      <label className="field-full">Reason / note<textarea name="reason" placeholder="Required for rejection; useful for every decision" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Save decision</button></div></form></article>
      <aside className="panel"><div className="panel-header"><div><h2>Simple rule</h2><p>Approval record and workflow status are separate</p></div></div><div className="panel-body"><div className="callout"><strong>Record evidence first.</strong><p>After an approved decision is saved here, Operations may move the request from “Waiting for Approval” to “Approved”.</p></div></div></aside>
    </section><section className="panel" style={{ marginTop: 17 }}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Company</th><th>Type</th><th>Decision</th><th>Reviewer</th><th>Date</th><th>Reason</th></tr></thead><tbody>{approvals.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong></td><td>{item.companyName}</td><td>{item.approvalType}</td><td><StatusBadge>{item.status}</StatusBadge></td><td>{item.reviewerName || "Pending"}</td><td>{formatDate(item.decidedAt || item.createdAt)}</td><td>{item.reason || "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
