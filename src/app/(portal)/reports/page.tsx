import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import {
  getAuthorizedDashboardData,
  listAuthorizedRequests,
} from "@/lib/request-reader";
import { Banknote, ClipboardCheck, Clock3, Download, Percent, ReceiptText, ShieldCheck, Truck, WalletCards } from "lucide-react";
import Link from "next/link";
import { operationalMessage, operationalNumber, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function ReportsPage() {
  const actor = await requirePagePermission("view_reports");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const [data, requests, organization] = await Promise.all([
    getAuthorizedDashboardData(actor),
    platformView ? Promise.resolve([]) : listAuthorizedRequests(actor),
    platformView
      ? Promise.resolve({ companies: [], branches: [] })
      : loadOrganizationDirectory(actor),
  ]);
  const branches = organization.branches;
  const requestedSpend = requests
    .filter((request) => request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const approvedSpend = requests
    .filter((request) => request.approvalStatus === "Approved" && request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const pendingApprovalCount = requests.filter((request) => request.approvalStatus === "Pending" && request.status !== "Cancelled").length;
  const budgetedBranches = branches.filter((branch) => branch.canViewBudget && branch.monthlyBudget != null);
  const remainingBudget = budgetedBranches.reduce((sum, branch) => sum + (branch.remainingAmount ?? 0), 0);
  return <><PageHeader
    eyebrow={m(platformView ? "reports.platformEyebrow" : "reports.companyEyebrow")}
    title={m("reports.title")}
    description={m(platformView ? "reports.platformDescription" : "reports.companyDescription")} />
    <section className="metric-grid">
      {platformView ? <>
        <MetricCard label={m("reports.sales")} value={formatCurrency(data.sales, locale)} note={m("reports.salesNote")} icon={ReceiptText} tone="blue" />
        <MetricCard label={m("reports.cost")} value={formatCurrency(data.buyingCost, locale)} note={m("reports.costNote")} icon={Banknote} tone="navy" />
        <MetricCard label={m("reports.margin")} value={`${operationalNumber(locale, data.grossMarginPercent, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} note={formatCurrency(data.grossProfit, locale)} icon={Percent} tone="teal" />
        <MetricCard label={m("reports.fees")} value={formatCurrency(data.deliveryCharges, locale)} note={m("reports.feesNote")} icon={Truck} tone="orange" />
      </> : <>
        <MetricCard label={m("reports.requested")} value={formatCurrency(requestedSpend, locale)} note={m("reports.requestedNote")} icon={ReceiptText} tone="blue" />
        <MetricCard label={m("reports.approved")} value={formatCurrency(approvedSpend, locale)} note={m("reports.approvedNote")} icon={ClipboardCheck} tone="teal" />
        <MetricCard label={m("reports.pending")} value={operationalNumber(locale, pendingApprovalCount)} note={m("reports.pendingNote")} icon={Clock3} tone="orange" />
        <MetricCard label={m("reports.remaining")} value={budgetedBranches.length ? formatCurrency(remainingBudget, locale) : m("common.notSet")} note={m("reports.budgetCount", { count: operationalNumber(locale, budgetedBranches.length) })} icon={WalletCards} tone="navy" />
      </>}
    </section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>{m("reports.exports")}</h2><p>{m("reports.exportsIntro")}</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><Download /><div><strong>{m("reports.register")}</strong><p>{m(platformView ? "reports.platformExport" : "reports.companyExport")}</p><Link className="table-link" href="/api/export/requests">{m("reports.download")}</Link></div></div>
      <div className="readiness-item"><ShieldCheck /><div><strong>{m("reports.scoped")}</strong><p>{m("reports.scopedBody")}</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h3>{m("reports.rule")}</h3><p>{m("reports.ruleIntro")}</p></div></div><div className="panel-body"><div className="callout"><strong>{m(platformView ? "reports.platformRule" : "reports.companyRule")}</strong><p>{m(platformView ? "reports.platformRuleBody" : "reports.companyRuleBody")}</p></div></div></article></section>
  </>;
}
