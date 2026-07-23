import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { calculateLineAmounts, formatCurrency, formatDate, REQUEST_STATUSES } from "@/lib/domain";
import { listRequests } from "@/lib/repository";
import { Download, Search } from "lucide-react";
import Link from "next/link";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const filters = await searchParams;
  const query = (filters.q ?? "").trim().toLowerCase();
  const status = filters.status ?? "all";
  const requests = (await listRequests()).filter((request) => {
    const matchesQuery = !query || [request.orderCode, request.companyName, request.branchName, ...request.lines.map((line) => line.productName)].some((value) => value.toLowerCase().includes(query));
    const matchesStatus = status === "all" || (status === "open" ? !["Completed", "Cancelled"].includes(request.status) : request.status === status);
    return matchesQuery && matchesStatus;
  });
  return (
    <>
      <PageHeader eyebrow="Operations tracker" title="Requests" description="Follow every order group from intake through supplier assignment, delivery, invoice and payment." actionHref="/requests/new" actionLabel="New multi-item request" />
      <form className="toolbar" method="get">
        <div className="toolbar-group"><Search size={18} className="muted" /><input className="search-input" name="q" defaultValue={filters.q} aria-label="Search requests" placeholder="Search request, company or product" /></div>
        <div className="toolbar-group"><select name="status" defaultValue={status} aria-label="Filter by status"><option value="all">All statuses</option><option value="open">Open only</option>{REQUEST_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="button button-secondary" type="submit">Apply filters</button><a className="button button-secondary" href="/api/export/requests"><Download size={16} />Export CSV</a></div>
      </form>
      <section className="panel">
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Order group</th><th>Company / branch</th><th>Items</th><th>Needed by</th><th>Status</th><th>Sales</th><th>Delivery</th><th>Payment</th></tr></thead>
          <tbody>{requests.map((request) => {
            const sales = request.lines.reduce((total, line) => total + calculateLineAmounts(line).sales, 0);
            const delivery = request.lines.find((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus))?.deliveryStatus ?? request.lines[0]?.deliveryStatus ?? "Not Scheduled";
            return <tr key={request.id}>
              <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{formatDate(request.requestDate)} · {request.urgency}</span></td>
              <td><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></td>
              <td>{request.lines.length}<br /><span className="subtle">{request.lines.map((line) => line.productName).slice(0, 2).join(", ")}</span></td>
              <td>{formatDate(request.neededByDate)}</td><td><StatusBadge>{request.status}</StatusBadge></td><td><strong>{formatCurrency(sales)}</strong></td><td><StatusBadge>{delivery}</StatusBadge></td><td><StatusBadge>{request.paymentStatus}</StatusBadge></td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
