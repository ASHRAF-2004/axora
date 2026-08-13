import { PageHeader } from "@/components/PageHeader";
import { RequestFiltersPanel } from "@/components/RequestFilters";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { requestFilterMessages } from "@/lib/request-filter-i18n";
import {
  hasActiveRequestFilters,
  normalizeRequestFilters,
  requestFiltersToSearchParams,
  type RawRequestSearchParams,
  type RequestFilters,
} from "@/lib/request-filters";
import { searchAuthorizedRequests } from "@/lib/request-reader";
import { Download } from "lucide-react";
import Link from "next/link";

function requestPageHref(filters: RequestFilters, page: number) {
  const params=requestFiltersToSearchParams({...filters,page});
  const query=params.toString();
  return query ? `/requests?${query}` : "/requests";
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<RawRequestSearchParams extends URLSearchParams ? never : Record<string,string|string[]|undefined>>;
}) {
  const rawFilters=await searchParams;
  const actor=await requirePagePermission("view_requests");
  const locale=actor.preferredLocale ?? "en";
  const timeZone=actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy=corePortalMessages(locale).requests;
  const filterCopy=requestFilterMessages(locale);
  const platformView=actor.isOwner || actor.accountKind==="PLATFORM";
  const result=await searchAuthorizedRequests(actor,normalizeRequestFilters(rawFilters));
  const requests=result.requests;
  const canViewInvoices=requests.some((request) => (
    request.invoiceStatus!==undefined || request.paymentStatus!==undefined
    || request.invoiceNumber!==undefined
  ));
  const currentParams=requestFiltersToSearchParams(result.filters);
  const exportParams=requestFiltersToSearchParams(result.filters,{omitPagination:true});
  const from=result.total ? (result.page-1)*result.pageSize+1 : 0;
  const to=Math.min(result.page*result.pageSize,result.total);

  return (
    <>
      <PageHeader
        eyebrow={platformView ? copy.platformEyebrow : copy.companyEyebrow}
        title={copy.title}
        description={platformView ? copy.platformDescription : copy.companyDescription}
        actionHref={canAccess(actor,"create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor,"create_requests") ? copy.create : undefined}
      />
      <RequestFiltersPanel
        filters={result.filters}
        currentQuery={currentParams.toString()}
        platformView={platformView}
        locale={locale}
      />
      <div className="request-results-bar">
        <div><strong>{filterCopy.resultCount(result.total)}</strong><span>{filterCopy.resultRange(from,to,result.total)}</span></div>
        {canAccess(actor,"view_reports") ? <Link className="button button-secondary" href={`/api/export/requests?${exportParams}`}>
          <Download size={16} />{copy.exportCsv}
        </Link> : null}
      </div>
      <section className="panel" id="request-table">
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>{copy.request}</th><th>{platformView ? copy.customerBranch : copy.branch}</th><th>{copy.items}</th><th>{copy.neededBy}</th><th>{copy.approval}</th><th>{copy.fulfilment}</th><th>{platformView ? copy.customerTotal : copy.estimatedTotal}</th><th>{copy.delivery}</th>{canViewInvoices ? <th>{copy.payment}</th> : null}</tr></thead>
          <tbody>{requests.map((request) => {
            const delivery=request.lines.find((line) => ["Delayed","Partially Delivered","Failed"].includes(line.deliveryStatus))?.deliveryStatus ?? request.lines[0]?.deliveryStatus ?? "Not Scheduled";
            return <tr key={request.id}>
              <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{formatDateTime(request.requestDate,locale,timeZone)} · {localizedStatus(request.urgency,locale)}</span></td>
              <td>{platformView ? <><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></> : <strong>{request.branchName}</strong>}</td>
              <td>{request.lines.length}<br /><span className="subtle">{request.lines.map((line) => line.productName).slice(0,2).join(", ")}</span></td>
              <td>{formatDate(request.neededByDate,locale,timeZone)}</td>
              <td><StatusBadge status={request.approvalStatus}>{localizedStatus(request.approvalStatus,locale)}</StatusBadge></td>
              <td><StatusBadge status={request.status}>{localizedStatus(request.status,locale)}</StatusBadge></td>
              <td><strong>{formatCurrency(request.estimatedTotal,locale)}</strong></td>
              <td><StatusBadge status={delivery}>{localizedStatus(delivery,locale)}</StatusBadge></td>
              {canViewInvoices ? <td>{request.paymentStatus ? <StatusBadge status={request.paymentStatus}>{localizedStatus(request.paymentStatus,locale)}</StatusBadge> : <span className="subtle">—</span>}</td> : null}
            </tr>;
          })}{!requests.length ? <tr><td colSpan={canViewInvoices ? 9 : 8}>{hasActiveRequestFilters(result.filters) ? filterCopy.noMatches : filterCopy.noScopeRows}</td></tr> : null}</tbody>
        </table></div>
      </section>
      {result.totalPages>1 ? <nav className="request-pagination" aria-label={filterCopy.page(result.page,result.totalPages)}>
        {result.page>1 ? <Link className="button button-secondary" href={requestPageHref(result.filters,result.page-1)}>{filterCopy.previous}</Link> : <span />}
        <strong>{filterCopy.page(result.page,result.totalPages)}</strong>
        {result.page<result.totalPages ? <Link className="button button-secondary" href={requestPageHref(result.filters,result.page+1)}>{filterCopy.next}</Link> : <span />}
      </nav> : null}
    </>
  );
}
