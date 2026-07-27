import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate, timeOfDayGreeting } from "@/lib/domain";
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
} from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const actor = await requirePagePermission("view_dashboard");
  const canViewInvoices = canAccess(actor, "view_invoices");
  const [data, companyRequests, branches] = await Promise.all([
    getDashboardData(actor),
    actor.isOwner ? Promise.resolve([]) : listRequests(actor),
    actor.isOwner ? Promise.resolve([]) : listBranches(actor),
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
  const activity = actor.isOwner ? data.byCompany : byBranch;
  const maxActivity = Math.max(...activity.map((item) => item.value), 1);
  return (
    <>
      <PageHeader
        eyebrow={actor.isOwner ? "Axora operations overview" : "Company purchasing overview"}
        title={`${timeOfDayGreeting()}, ${greetingName}`}
        description={actor.isOwner
          ? "Monitor customer requests, fulfilment, supplier costs and Axora financial performance."
          : "Monitor your company purchase requests, approvals, branch budgets and deliveries."}
        actionHref={canAccess(actor, "create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor, "create_requests") ? "Create purchase request" : undefined} />
      <section className="metric-grid" aria-label="Main performance indicators">
        {actor.isOwner ? <>
          <MetricCard label="Total requests" value={String(data.requestCount)} note={`${data.openRequestCount} still open`} icon={ClipboardList} tone="blue" />
          <MetricCard label="Customer sales" value={formatCurrency(data.sales)} note="Quantity × customer unit price" icon={TrendingUp} tone="teal" />
          <MetricCard label="Buying cost" value={formatCurrency(data.buyingCost)} note="Quantity × supplier unit cost" icon={Banknote} tone="navy" />
          <MetricCard label="Gross profit" value={formatCurrency(data.grossProfit)} note={`${data.grossMarginPercent.toFixed(1)}% gross margin`} icon={CircleDollarSign} tone="teal" />
          <MetricCard label="Urgent requests" value={String(data.urgentRequestCount)} note="Requires immediate follow-up" icon={AlertTriangle} tone="orange" />
          <MetricCard label="Delayed deliveries" value={String(data.delayedDeliveryCount)} note="Based on latest delivery record" icon={Clock3} tone="orange" />
          <MetricCard label="Outstanding invoices" value={String(data.outstandingInvoiceCount)} note="Issued but not fully paid" icon={PackageCheck} tone="blue" />
          <MetricCard label="Margin" value={`${data.grossMarginPercent.toFixed(1)}%`} note={`${formatCurrency(data.deliveryCharges)} delivery fees shown separately`} icon={Percent} tone="navy" />
        </> : <>
          <MetricCard label="Purchase requests" value={String(data.requestCount)} note={`${data.openRequestCount} still in progress`} icon={ClipboardList} tone="blue" />
          <MetricCard label="Requested value" value={formatCurrency(requestedSpend)} note="Estimated customer total, excluding cancelled requests" icon={TrendingUp} tone="teal" />
          <MetricCard label="Approved spend" value={formatCurrency(approvedSpend)} note="Company-approved requests" icon={ClipboardCheck} tone="navy" />
          <MetricCard label="Pending approval" value={String(pendingApprovalCount)} note="Waiting for an authorised company approver" icon={Clock3} tone="orange" />
          <MetricCard label="Monthly branch budget" value={budgetedBranches.length ? formatCurrency(monthlyBudget) : "Not set"} note={`${budgetedBranches.length} of ${branches.length} visible branches configured`} icon={WalletCards} tone="blue" />
          <MetricCard label="Budget remaining" value={budgetedBranches.length ? formatCurrency(remainingBudget) : "Not set"} note="After approved requests this month" icon={CircleDollarSign} tone="teal" />
          <MetricCard label="Urgent requests" value={String(data.urgentRequestCount)} note="Marked urgent by your company" icon={AlertTriangle} tone="orange" />
          <MetricCard label="Delayed deliveries" value={String(data.delayedDeliveryCount)} note="Latest delivery updates from Axora" icon={PackageCheck} tone="navy" />
        </>}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>Requests needing attention</h2><p>{actor.isOwner ? "Urgent, delayed, partial or unpaid items" : "Urgent requests, approval decisions and delivery exceptions"}</p></div><Link className="table-link" href="/requests">View all</Link></div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Request</th><th>{actor.isOwner ? "Company / branch" : "Branch"}</th><th>Needed by</th>{actor.isOwner ? null : <th>Company approval</th>}<th>Fulfilment</th>{canViewInvoices ? <th>Payment</th> : null}</tr></thead>
              <tbody>{data.attention.map((request) => (
                <tr key={request.id}>
                  <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{request.urgency}</span></td>
                  <td>{actor.isOwner ? <><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></> : <strong>{request.branchName}</strong>}</td>
                  <td>{formatDate(request.neededByDate)}</td>
                  {actor.isOwner ? null : <td><StatusBadge>{request.approvalStatus}</StatusBadge></td>}
                  <td><StatusBadge>{request.status}</StatusBadge></td>
                  {canViewInvoices ? <td><StatusBadge>{request.paymentStatus ?? "Unpaid"}</StatusBadge></td> : null}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </article>

        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header"><div><h3>Requests by status</h3><p>Current workflow distribution</p></div></div>
            <div className="panel-body chart-list">{data.byStatus.slice(0, 7).map((item) => (
              <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${(item.value / maxStatus) * 100}%` }} /></div><strong>{item.value}</strong></div>
            ))}</div>
          </article>
          <article className="panel">
            <div className="panel-header"><div><h3>{actor.isOwner ? "Company activity" : "Branch activity"}</h3><p>Request volume by {actor.isOwner ? "customer company" : "branch"}</p></div></div>
            <div className="panel-body chart-list">{activity.map((item) => (
              <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${(item.value / maxActivity) * 100}%` }} /></div><strong>{item.value}</strong></div>
            ))}</div>
          </article>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>Top requested products</h2><p>Ranked by requested quantity</p></div></div>
          <div className="panel-body chart-list">{data.topProducts.map((item) => (
            <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${Math.min(100, item.value * 8)}%` }} /></div><strong>{item.value}</strong></div>
          ))}</div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h3>{actor.isOwner ? "Calculation rule" : "Budget rule"}</h3><p>{actor.isOwner ? "How internal financial totals are calculated" : "How approved requests use branch budgets"}</p></div></div>
          <div className="panel-body"><div className="callout">
            <strong>{actor.isOwner ? "Prices are multiplied by quantity." : "Only approved requests commit budget."}</strong>
            <p>{actor.isOwner
              ? "Axora calculates customer sales and supplier buying cost for each request line before combining them into internal totals."
              : "A submitted request stays pending until an authorised company approver accepts it. The approved estimated total is then counted against that branch’s monthly budget."}</p>
          </div></div>
        </article>
      </section>
    </>
  );
}
