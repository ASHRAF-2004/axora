import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate, REQUEST_STATUSES } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listRequests } from "@/lib/repository";
import { Download, Search } from "lucide-react";
import Link from "next/link";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const filters = await searchParams;
  const actor = await requirePagePermission("view_requests");
  const canViewInvoices = canAccess(actor, "view_invoices");
  const query = (filters.q ?? "").trim().toLowerCase();
  const status = filters.status ?? "all";
  const requests = (await listRequests(actor)).filter((request) => {
    const matchesQuery = !query || [request.orderCode, request.companyName, request.branchName, ...request.lines.map((line) => line.productName)].some((value) => value.toLowerCase().includes(query));
    const matchesStatus = status === "all" || (status === "open" ? !["Completed", "Cancelled"].includes(request.status) : request.status === status);
    return matchesQuery && matchesStatus;
  });
  return (
    <>
      <PageHeader
        eyebrow={actor.isOwner ? "Axora fulfilment tracker" : "Company purchasing"}
        title="Purchase requests"
        description={actor.isOwner
          ? "Track customer requests from company approval through sourcing, delivery, invoicing and payment."
          : "Follow your purchase requests from company approval through Axora fulfilment and delivery."}
        actionHref={canAccess(actor, "create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor, "create_requests") ? "Create purchase request" : undefined} />
      <form className="toolbar" method="get">
        <div className="toolbar-group"><Search size={18} className="muted" /><input className="search-input" name="q" defaultValue={filters.q} aria-label="Search requests" placeholder={actor.isOwner ? "Search request, company or product" : "Search request, branch or product"} /></div>
        <div className="toolbar-group"><select name="status" defaultValue={status} aria-label="Filter by status"><option value="all">All statuses</option><option value="open">Open only</option>{REQUEST_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="button button-secondary" type="submit">Apply filters</button><a className="button button-secondary" href="/api/export/requests"><Download size={16} />Export CSV</a></div>
      </form>
      <section className="panel">
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Request</th><th>{actor.isOwner ? "Customer / branch" : "Branch"}</th><th>Items</th><th>Needed by</th><th>Company approval</th><th>Fulfilment</th><th>{actor.isOwner ? "Customer total" : "Estimated total"}</th><th>Delivery</th>{canViewInvoices ? <th>Payment</th> : null}</tr></thead>
          <tbody>{requests.map((request) => {
            const delivery = request.lines.find((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus))?.deliveryStatus ?? request.lines[0]?.deliveryStatus ?? "Not Scheduled";
            return <tr key={request.id}>
              <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{formatDate(request.requestDate)} · {request.urgency}</span></td>
              <td>{actor.isOwner ? <><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></> : <strong>{request.branchName}</strong>}</td>
              <td>{request.lines.length}<br /><span className="subtle">{request.lines.map((line) => line.productName).slice(0, 2).join(", ")}</span></td>
              <td>{formatDate(request.neededByDate)}</td>
              <td><StatusBadge>{request.approvalStatus}</StatusBadge></td>
              <td><StatusBadge>{request.status}</StatusBadge></td>
              <td><strong>{formatCurrency(request.estimatedTotal)}</strong></td>
              <td><StatusBadge>{delivery}</StatusBadge></td>
              {canViewInvoices ? <td><StatusBadge>{request.paymentStatus ?? "Unpaid"}</StatusBadge></td> : null}
            </tr>;
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
