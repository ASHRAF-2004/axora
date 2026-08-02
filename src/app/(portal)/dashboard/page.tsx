import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate, timeOfDayGreeting } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { canAccess } from "@/lib/permissions";
import { getDashboardData, listBranches, listRequests } from "@/lib/repository";
import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  PackageCheck,
  Percent,
  TrendingUp,
  WalletCards,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

function roleDashboard(actor: Awaited<ReturnType<typeof requirePagePermission>>, pendingApprovals: number, locale: SupportedLocale) {
  const role = corePortalMessages(locale).dashboard.role;
  const paths: Record<keyof typeof role, string[]> = {
    owner: ["/companies", "/users", "/products", "/audit"], operations: ["/sourcing", "/deliveries", "/products", "/reports"],
    companyAdmin: ["/users", "/branches", "/requests", "/reports"], branchAdmin: ["/users", "/branches", "/requests", "/deliveries"],
    approver: ["/approvals", "/requests", "/branches"], finance: ["/finance", "/reports", "/documents", "/requests"],
    auditor: ["/audit", "/documents", "/reports"], requester: ["/products", "/requests/new", "/requests", "/deliveries"],
  };
  const key: keyof typeof role = actor.isOwner ? "owner" : actor.role === "PLATFORM_OPERATIONS" ? "operations"
    : ["ADMIN", "COMPANY_ADMIN"].includes(actor.role) ? "companyAdmin" : actor.role === "BRANCH_ADMIN" ? "branchAdmin"
      : ["APPROVER", "BRANCH_APPROVER", "COMPANY_APPROVER"].includes(actor.role) ? "approver"
        : ["FINANCE", "FINANCE_REVIEWER"].includes(actor.role) ? "finance"
          : ["VIEWER", "AUDITOR"].includes(actor.role) ? "auditor" : "requester";
  const selected = role[key];
  return { ...selected, description: selected.description.replace("{count}", new Intl.NumberFormat(locale).format(pendingApprovals)), actions: selected.actions.map((label, index) => [label, paths[key][index]] as const) };
}

export default async function DashboardPage() {
  const actor = await requirePagePermission("view_dashboard");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = corePortalMessages(locale).dashboard;
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const canViewInvoices = canAccess(actor, "view_invoices");
  const [data, companyRequests, branches] = await Promise.all([
    getDashboardData(actor),
    platformView ? Promise.resolve([]) : listRequests(actor),
    platformView ? Promise.resolve([]) : listBranches(actor),
  ]);
  const greetingName = actor.name.trim() || "there";
  const requestedSpend = companyRequests
    .filter((request) => request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const approvedSpend = companyRequests
    .filter((request) => request.approvalStatus === "Approved" && request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const pendingApprovalCount = companyRequests.filter((request) => request.approvalStatus === "Pending" && request.status !== "Cancelled").length;
  const budgetedBranches = branches.filter((branch) => branch.monthlyBudget != null);
  const monthlyBudget = budgetedBranches.reduce((sum, branch) => sum + (branch.monthlyBudget ?? 0), 0);
  const remainingBudget = budgetedBranches.reduce((sum, branch) => sum + (branch.remainingAmount ?? 0), 0);
  const byBranch = Object.entries(companyRequests.reduce<Record<string, number>>(
    (summary, request) => ({ ...summary, [request.branchName]: (summary[request.branchName] ?? 0) + 1 }),
    {},
  )).map(([label, value]) => ({ label, value }));
  const maxStatus = Math.max(...data.byStatus.map((item) => item.value), 1);
  const activity = platformView ? data.byCompany : byBranch;
  const maxActivity = Math.max(...activity.map((item) => item.value), 1);
  const experience = roleDashboard(actor, pendingApprovalCount, locale);
  return (
    <>
      <PageHeader
        eyebrow={experience.eyebrow}
        title={`${timeOfDayGreeting(new Date(), timeZone, locale)}, ${greetingName}`}
        description={experience.description}
        actionHref={canAccess(actor, "create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor, "create_requests") ? copy.createRequest : undefined} />
      <nav className="dashboard-role-actions" aria-label={copy.recommendedActions}>
        {experience.actions.filter(([, href]) => href !== "/requests/new" || canAccess(actor, "create_requests")).map(([label, href]) => (
          <Link href={href} key={href}><span>{label}</span><ArrowRight size={17} aria-hidden="true" /></Link>
        ))}
      </nav>
      <section className="metric-grid" aria-label={copy.indicators}>
        {platformView ? <>
          <MetricCard label={copy.metrics.totalRequests} value={String(data.requestCount)} note={`${data.openRequestCount} ${copy.notes.open}`} icon={ClipboardList} tone="blue" />
          <MetricCard label={copy.metrics.customerSales} value={formatCurrency(data.sales, locale)} note={copy.notes.customerPrice} icon={TrendingUp} tone="teal" />
          <MetricCard label={copy.metrics.buyingCost} value={formatCurrency(data.buyingCost, locale)} note={copy.notes.supplierCost} icon={Banknote} tone="navy" />
          <MetricCard label={copy.metrics.grossProfit} value={formatCurrency(data.grossProfit, locale)} note={`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(data.grossMarginPercent)}% ${copy.notes.grossMargin}`} icon={CircleDollarSign} tone="teal" />
          <MetricCard label={copy.metrics.urgent} value={String(data.urgentRequestCount)} note={copy.notes.urgentPlatform} icon={AlertTriangle} tone="orange" />
          <MetricCard label={copy.metrics.delayed} value={String(data.delayedDeliveryCount)} note={copy.notes.delayedPlatform} icon={Clock3} tone="orange" />
          <MetricCard label={copy.metrics.outstanding} value={String(data.outstandingInvoiceCount)} note={copy.notes.outstanding} icon={PackageCheck} tone="blue" />
          <MetricCard label={copy.metrics.margin} value={`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(data.grossMarginPercent)}%`} note={`${formatCurrency(data.deliveryCharges, locale)} ${copy.notes.deliverySeparate}`} icon={Percent} tone="navy" />
        </> : <>
          <MetricCard label={copy.metrics.purchaseRequests} value={String(data.requestCount)} note={`${data.openRequestCount} ${copy.notes.inProgress}`} icon={ClipboardList} tone="blue" />
          <MetricCard label={copy.metrics.requestedValue} value={formatCurrency(requestedSpend, locale)} note={copy.notes.requestedValue} icon={TrendingUp} tone="teal" />
          <MetricCard label={copy.metrics.approvedSpend} value={formatCurrency(approvedSpend, locale)} note={copy.notes.approvedSpend} icon={ClipboardCheck} tone="navy" />
          <MetricCard label={copy.metrics.pendingApproval} value={String(pendingApprovalCount)} note={copy.notes.pendingApproval} icon={Clock3} tone="orange" />
          <MetricCard label={copy.metrics.monthlyBudget} value={budgetedBranches.length ? formatCurrency(monthlyBudget, locale) : corePortalMessages(locale).common.notSet} note={`${budgetedBranches.length} / ${branches.length} ${copy.notes.configured}`} icon={WalletCards} tone="blue" />
          <MetricCard label={copy.metrics.remainingBudget} value={budgetedBranches.length ? formatCurrency(remainingBudget, locale) : corePortalMessages(locale).common.notSet} note={copy.notes.remaining} icon={CircleDollarSign} tone="teal" />
          <MetricCard label={copy.metrics.urgent} value={String(data.urgentRequestCount)} note={copy.notes.urgentCompany} icon={AlertTriangle} tone="orange" />
          <MetricCard label={copy.metrics.delayed} value={String(data.delayedDeliveryCount)} note={copy.notes.delayedCompany} icon={PackageCheck} tone="navy" />
        </>}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>{copy.attentionTitle}</h2><p>{platformView ? copy.attentionPlatform : copy.attentionCompany}</p></div><Link className="table-link" href="/requests">{copy.viewAll}</Link></div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>{copy.request}</th><th>{platformView ? copy.companyBranch : corePortalMessages(locale).common.branch}</th><th>{copy.neededBy}</th>{platformView ? null : <th>{copy.approval}</th>}<th>{copy.fulfilment}</th>{canViewInvoices ? <th>{copy.payment}</th> : null}</tr></thead>
              <tbody>{data.attention.map((request) => (
                <tr key={request.id}>
                  <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{localizedStatus(request.urgency, locale)}</span></td>
                  <td>{platformView ? <><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></> : <strong>{request.branchName}</strong>}</td>
                  <td>{formatDate(request.neededByDate, locale, timeZone)}</td>
                  {platformView ? null : <td><StatusBadge status={request.approvalStatus}>{localizedStatus(request.approvalStatus, locale)}</StatusBadge></td>}
                  <td><StatusBadge status={request.status}>{localizedStatus(request.status, locale)}</StatusBadge></td>
                  {canViewInvoices ? <td><StatusBadge status={request.paymentStatus ?? "Unpaid"}>{localizedStatus(request.paymentStatus ?? "Unpaid", locale)}</StatusBadge></td> : null}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </article>

        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header"><div><h3>{copy.byStatus}</h3><p>{copy.workflowDistribution}</p></div></div>
            <div className="panel-body chart-list">{data.byStatus.slice(0, 7).map((item) => (
              <div className="chart-row" key={item.label}><span>{localizedStatus(item.label, locale)}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${(item.value / maxStatus) * 100}%` }} /></div><strong>{item.value}</strong></div>
            ))}</div>
          </article>
          <article className="panel">
            <div className="panel-header"><div><h3>{platformView ? copy.companyActivity : copy.branchActivity}</h3><p>{platformView ? copy.volumeByCompany : copy.volumeByBranch}</p></div></div>
            <div className="panel-body chart-list">{activity.map((item) => (
              <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${(item.value / maxActivity) * 100}%` }} /></div><strong>{item.value}</strong></div>
            ))}</div>
          </article>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>{copy.topProducts}</h2><p>{copy.rankedProducts}</p></div></div>
          <div className="panel-body chart-list">{data.topProducts.map((item) => (
            <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${Math.min(100, item.value * 8)}%` }} /></div><strong>{item.value}</strong></div>
          ))}</div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h3>{platformView ? copy.calculationRule : copy.budgetRule}</h3><p>{platformView ? copy.calculationHelp : copy.budgetHelp}</p></div></div>
          <div className="panel-body"><div className="callout">
            <strong>{platformView ? copy.calculationLead : copy.budgetLead}</strong>
            <p>{platformView ? copy.calculationBody : copy.budgetBody}</p>
          </div></div>
        </article>
      </section>
    </>
  );
}
