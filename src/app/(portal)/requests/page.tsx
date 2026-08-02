import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate, formatDateTime, REQUEST_STATUSES } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { canAccess } from "@/lib/permissions";
import { listRequests } from "@/lib/repository";
import { Download, Search } from "lucide-react";
import Link from "next/link";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const filters = await searchParams;
  const actor = await requirePagePermission("view_requests");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = corePortalMessages(locale).requests;
  const canViewInvoices = canAccess(actor, "view_invoices");
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
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
        eyebrow={platformView ? copy.platformEyebrow : copy.companyEyebrow}
        title={copy.title}
        description={platformView ? copy.platformDescription : copy.companyDescription}
        actionHref={canAccess(actor, "create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor, "create_requests") ? copy.create : undefined} />
      <form className="toolbar" method="get">
        <div className="toolbar-group"><Search size={18} className="muted" /><input className="search-input" name="q" defaultValue={filters.q} aria-label={copy.search} placeholder={platformView ? copy.searchPlatform : copy.searchCompany} /></div>
        <div className="toolbar-group"><select name="status" defaultValue={status} aria-label={copy.filterStatus}><option value="all">{copy.allStatuses}</option><option value="open">{copy.openOnly}</option>{REQUEST_STATUSES.map((item) => <option key={item} value={item}>{localizedStatus(item, locale)}</option>)}</select><button className="button button-secondary" type="submit">{corePortalMessages(locale).common.applyFilters}</button><Link className="button button-secondary" href="/api/export/requests"><Download size={16} />{copy.exportCsv}</Link></div>
      </form>
      <section className="panel">
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>{copy.request}</th><th>{platformView ? copy.customerBranch : copy.branch}</th><th>{copy.items}</th><th>{copy.neededBy}</th><th>{copy.approval}</th><th>{copy.fulfilment}</th><th>{platformView ? copy.customerTotal : copy.estimatedTotal}</th><th>{copy.delivery}</th>{canViewInvoices ? <th>{copy.payment}</th> : null}</tr></thead>
          <tbody>{requests.map((request) => {
            const delivery = request.lines.find((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus))?.deliveryStatus ?? request.lines[0]?.deliveryStatus ?? "Not Scheduled";
            return <tr key={request.id}>
              <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{formatDateTime(request.requestDate, locale, timeZone)} · {localizedStatus(request.urgency, locale)}</span></td>
              <td>{platformView ? <><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></> : <strong>{request.branchName}</strong>}</td>
              <td>{request.lines.length}<br /><span className="subtle">{request.lines.map((line) => line.productName).slice(0, 2).join(", ")}</span></td>
              <td>{formatDate(request.neededByDate, locale, timeZone)}</td>
              <td><StatusBadge status={request.approvalStatus}>{localizedStatus(request.approvalStatus, locale)}</StatusBadge></td>
              <td><StatusBadge status={request.status}>{localizedStatus(request.status, locale)}</StatusBadge></td>
              <td><strong>{formatCurrency(request.estimatedTotal, locale)}</strong></td>
              <td><StatusBadge status={delivery}>{localizedStatus(delivery, locale)}</StatusBadge></td>
              {canViewInvoices ? <td><StatusBadge status={request.paymentStatus ?? "Unpaid"}>{localizedStatus(request.paymentStatus ?? "Unpaid", locale)}</StatusBadge></td> : null}
            </tr>;
          })}{requests.length === 0 ? <tr><td colSpan={canViewInvoices ? 9 : 8}>{copy.empty}</td></tr> : null}</tbody>
        </table></div>
      </section>
    </>
  );
}
