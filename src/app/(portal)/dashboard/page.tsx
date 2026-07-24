import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requireSession } from "@/lib/auth";
import { formatCurrency, formatDate, timeOfDayGreeting } from "@/lib/domain";
import { getDashboardData } from "@/lib/repository";
import { hasPermission } from "@/lib/permissions";
import { AlertTriangle, Banknote, CircleDollarSign, ClipboardList, Clock3, PackageCheck, Percent, TrendingUp } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const actor = await requireSession();
  const data = await getDashboardData(actor);
  const greetingName = actor.name.trim() || "there";
  const maxStatus = Math.max(...data.byStatus.map((item) => item.value), 1);
  const maxCompany = Math.max(...data.byCompany.map((item) => item.value), 1);
  return (
    <>
      <PageHeader eyebrow="Operations overview" title={`${timeOfDayGreeting()}, ${greetingName}`} description="A current view of your company requests, deliveries, and financial activity."
        actionHref={hasPermission(actor.role, "manage_requests") ? "/requests/new" : undefined}
        actionLabel={hasPermission(actor.role, "manage_requests") ? "Create request" : undefined} />
      <section className="metric-grid" aria-label="Main performance indicators">
        <MetricCard label="Total requests" value={String(data.requestCount)} note={`${data.openRequestCount} still open`} icon={ClipboardList} tone="blue" />
        <MetricCard label="Total sales" value={formatCurrency(data.sales)} note="Quantity × unit selling price" icon={TrendingUp} tone="teal" />
        <MetricCard label="Buying cost" value={formatCurrency(data.buyingCost)} note="Quantity × unit buying price" icon={Banknote} tone="navy" />
        <MetricCard label="Gross profit" value={formatCurrency(data.grossProfit)} note={`${data.grossMarginPercent.toFixed(1)}% gross margin`} icon={CircleDollarSign} tone="teal" />
        <MetricCard label="Urgent requests" value={String(data.urgentRequestCount)} note="Requires immediate follow-up" icon={AlertTriangle} tone="orange" />
        <MetricCard label="Delayed deliveries" value={String(data.delayedDeliveryCount)} note="Based on latest delivery record" icon={Clock3} tone="orange" />
        <MetricCard label="Outstanding invoices" value={String(data.outstandingInvoiceCount)} note="Issued but not fully paid" icon={PackageCheck} tone="blue" />
        <MetricCard label="Margin" value={`${data.grossMarginPercent.toFixed(1)}%`} note={`${formatCurrency(data.deliveryCharges)} delivery fees shown separately`} icon={Percent} tone="navy" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>Requests needing attention</h2><p>Urgent, delayed, partial or unpaid items</p></div><Link className="table-link" href="/requests">View all</Link></div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Request</th><th>Company</th><th>Needed by</th><th>Status</th><th>Payment</th></tr></thead>
              <tbody>{data.attention.map((request) => (
                <tr key={request.id}>
                  <td><Link className="table-link" href={`/requests/${request.id}`}>{request.orderCode}</Link><br /><span className="subtle">{request.urgency}</span></td>
                  <td><strong>{request.companyName}</strong><br /><span className="subtle">{request.branchName}</span></td>
                  <td>{formatDate(request.neededByDate)}</td>
                  <td><StatusBadge>{request.status}</StatusBadge></td>
                  <td><StatusBadge>{request.paymentStatus}</StatusBadge></td>
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
            <div className="panel-header"><div><h3>Company activity</h3><p>Request volume by company</p></div></div>
            <div className="panel-body chart-list">{data.byCompany.map((item) => (
              <div className="chart-row" key={item.label}><span>{item.label}</span><div className="chart-track"><div className="chart-fill" style={{ width: `${(item.value / maxCompany) * 100}%` }} /></div><strong>{item.value}</strong></div>
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
        <article className="panel"><div className="panel-header"><div><h3>Calculation rule</h3><p>How financial totals are calculated</p></div></div><div className="panel-body"><div className="callout"><strong>Prices are multiplied by quantity.</strong><p>Axora calculates sales and buying cost for each request line before combining them into dashboard totals.</p></div></div></article>
      </section>
    </>
  );
}
