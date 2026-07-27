import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { getDashboardData, listBranches, listRequests } from "@/lib/repository";
import { Banknote, ClipboardCheck, Clock3, Download, Percent, ReceiptText, ShieldCheck, Truck, WalletCards } from "lucide-react";

export default async function ReportsPage() {
  const actor = await requirePagePermission("view_reports");
  const [data, requests, branches] = await Promise.all([
    getDashboardData(actor),
    actor.isOwner ? Promise.resolve([]) : listRequests(actor),
    actor.isOwner ? Promise.resolve([]) : listBranches(actor),
  ]);
  const requestedSpend = requests
    .filter((request) => request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const approvedSpend = requests
    .filter((request) => request.approvalStatus === "Approved" && request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const pendingApprovalCount = requests.filter((request) => request.approvalStatus === "Pending" && request.status !== "Cancelled").length;
  const budgetedBranches = branches.filter((branch) => branch.monthlyBudget != null);
  const remainingBudget = budgetedBranches.reduce((sum, branch) => sum + (branch.remainingAmount ?? 0), 0);
  return <><PageHeader
    eyebrow={actor.isOwner ? "Axora management reporting" : "Company purchasing report"}
    title="Reports and reconciliation"
    description={actor.isOwner
      ? "Export request records and reconcile Axora sales, supplier costs and margins with source lines."
      : "Review your company’s requested and approved spend, branch budgets and purchase request records."} />
    <section className="metric-grid">
      {actor.isOwner ? <>
        <MetricCard label="Customer sales" value={formatCurrency(data.sales)} note="Non-cancelled request lines" icon={ReceiptText} tone="blue" />
        <MetricCard label="Supplier buying cost" value={formatCurrency(data.buyingCost)} note="Quantity-adjusted internal cost" icon={Banknote} tone="navy" />
        <MetricCard label="Gross margin" value={`${data.grossMarginPercent.toFixed(1)}%`} note={formatCurrency(data.grossProfit)} icon={Percent} tone="teal" />
        <MetricCard label="Delivery fees" value={formatCurrency(data.deliveryCharges)} note="Reported separately" icon={Truck} tone="orange" />
      </> : <>
        <MetricCard label="Requested value" value={formatCurrency(requestedSpend)} note="Estimated total, excluding cancelled requests" icon={ReceiptText} tone="blue" />
        <MetricCard label="Approved spend" value={formatCurrency(approvedSpend)} note="Accepted by company approvers" icon={ClipboardCheck} tone="teal" />
        <MetricCard label="Pending approval" value={String(pendingApprovalCount)} note="Awaiting an authorised decision" icon={Clock3} tone="orange" />
        <MetricCard label="Budget remaining" value={budgetedBranches.length ? formatCurrency(remainingBudget) : "Not set"} note={`${budgetedBranches.length} visible branch budget${budgetedBranches.length === 1 ? "" : "s"} configured`} icon={WalletCards} tone="navy" />
      </>}
    </section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>Available exports</h2><p>UTF-8 CSV files open in Excel or LibreOffice</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><Download /><div><strong>Purchase request register</strong><p>{actor.isOwner
        ? "Customer companies, branches, workflow status, quantities, customer totals, supplier costs and internal margin."
        : "Your accessible branches, requested items, company approval status, fulfilment status and estimated customer totals."}</p><a className="table-link" href="/api/export/requests">Download requests.csv</a></div></div>
      <div className="readiness-item"><ShieldCheck /><div><strong>Company-scoped export</strong><p>The downloaded register contains only records available to your signed-in account.</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h3>Reconciliation rule</h3><p>Check figures before sharing them</p></div></div><div className="panel-body"><div className="callout"><strong>{actor.isOwner ? "Reconcile totals with request lines." : "Approval controls committed spend."}</strong><p>{actor.isOwner
      ? "Customer sales and supplier buying costs include quantity and exclude cancelled requests. Delivery fees are reported separately."
      : "Requested value includes non-cancelled requests. Approved spend includes only requests accepted by a company approver; branch remaining budget is calculated from approved requests in the current month."}</p></div></div></article></section>
  </>;
}
