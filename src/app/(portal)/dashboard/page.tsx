import { DashboardPeriodControls } from "@/components/DashboardPeriodControls";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import {
  calculateDashboardComparison,
  normalizeDashboardPeriod,
  type DashboardPeriodInput,
} from "@/lib/dashboard-period";
import { dashboardPeriodMessages } from "@/lib/dashboard-period-i18n";
import {
  getAuthorizedDashboardPeriodReport,
  resolveDashboardReportingScope,
} from "@/lib/dashboard-reader";
import { formatCurrency, formatDate, timeOfDayGreeting } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { canAccess } from "@/lib/permissions";
import {
  AlertTriangle,
  ArrowRight,
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

type DashboardSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function roleDashboard(
  actor: Awaited<ReturnType<typeof requirePagePermission>>,
  pendingApprovals: number,
  locale: SupportedLocale,
) {
  const role = corePortalMessages(locale).dashboard.role;
  const paths: Record<keyof typeof role, string[]> = {
    owner: ["/companies", "/users", "/products", "/audit"],
    operations: ["/sourcing", "/deliveries", "/products", "/reports"],
    companyAdmin: ["/users", "/branches", "/requests", "/reports"],
    branchAdmin: ["/users", "/branches", "/requests", "/deliveries"],
    approver: ["/approvals", "/requests", "/branches"],
    finance: ["/finance", "/reports", "/documents", "/requests"],
    auditor: ["/audit", "/documents", "/reports"],
    requester: ["/products", "/requests/new", "/requests", "/deliveries"],
  };
  const key: keyof typeof role = actor.isOwner
    ? "owner"
    : actor.role === "PLATFORM_OPERATIONS"
      ? "operations"
      : ["ADMIN", "COMPANY_ADMIN"].includes(actor.role)
        ? "companyAdmin"
        : actor.role === "BRANCH_ADMIN"
          ? "branchAdmin"
          : ["APPROVER", "BRANCH_APPROVER", "COMPANY_APPROVER"].includes(actor.role)
            ? "approver"
            : ["FINANCE", "FINANCE_REVIEWER"].includes(actor.role)
              ? "finance"
              : ["VIEWER", "AUDITOR"].includes(actor.role)
                ? "auditor"
                : "requester";
  const selected = role[key];
  return {
    ...selected,
    description: selected.description.replace(
      "{count}",
      new Intl.NumberFormat(locale).format(pendingApprovals),
    ),
    actions: selected.actions.map((label, index) => (
      [label, paths[key][index]] as const
    )),
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const actor = await requirePagePermission("view_dashboard");
  const raw = await searchParams;
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).dashboard;
  const periodCopy = dashboardPeriodMessages(locale);
  const input: DashboardPeriodInput = {
    preset: first(raw.preset),
    start: first(raw.start),
    end: first(raw.end),
    compare: first(raw.compare),
  };
  const scope = await resolveDashboardReportingScope(actor, first(raw.branch));
  const period = normalizeDashboardPeriod(input, scope.timeZone);
  const report = await getAuthorizedDashboardPeriodReport(actor, period, scope);
  const data = report.current;
  const previous = report.previous;
  const platformData = report.scope === "platform" ? report.current : undefined;
  const previousPlatform = report.scope === "platform" ? report.previous : undefined;
  const companyData = report.scope === "company" ? report.current : undefined;
  const previousCompany = report.scope === "company" ? report.previous : undefined;
  const platformView = report.scope === "platform";
  const companyView = actor.accountKind === "COMPANY";
  const branches = companyView
    ? scope.directory.branches.filter((branch) => (
      !scope.branchId || branch.id === scope.branchId
    ))
    : [];
  const budgetedBranches = branches.filter((branch) => (
    branch.canViewBudget && branch.monthlyBudget != null
  ));
  const monthlyBudget = budgetedBranches.reduce(
    (sum, branch) => sum + (branch.monthlyBudget ?? 0),
    0,
  );
  const remainingBudget = budgetedBranches.reduce(
    (sum, branch) => sum + (branch.remainingAmount ?? 0),
    0,
  );
  const canViewInvoices = data.attention.some((request) => (
    request.invoiceStatus !== undefined || request.paymentStatus !== undefined
  ));
  const greetingName = actor.name.trim() || "there";
  const greetingZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const experience = roleDashboard(
    actor,
    companyData?.pendingApprovalCount ?? 0,
    locale,
  );
  const maxStatus = Math.max(...data.byStatus.map((item) => item.value), 1);
  const maxActivity = Math.max(...data.activity.map((item) => item.value), 1);
  const number = (value: number) => new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value);
  const percent = (value: number) => number(value) + "%";
  const comparisonNote = (
    base: string,
    currentValue: number,
    previousValue: number | undefined,
    formatter: (value: number) => string,
  ) => {
    if (previousValue === undefined) return base;
    const delta = calculateDashboardComparison(currentValue, previousValue);
    const comparison = periodCopy.comparison(
      delta,
      formatter(Math.abs(delta.absolute)),
      delta.percentage === null ? "" : percent(Math.abs(delta.percentage)),
    );
    return base + " · " + comparison;
  };

  return (
    <>
      <PageHeader
        eyebrow={experience.eyebrow}
        title={timeOfDayGreeting(new Date(), greetingZone, locale) + ", " + greetingName}
        description={experience.description}
        actionHref={canAccess(actor, "create_requests") ? "/requests/new" : undefined}
        actionLabel={canAccess(actor, "create_requests") ? copy.createRequest : undefined}
      />
      <nav className="dashboard-role-actions" aria-label={copy.recommendedActions}>
        {experience.actions
          .filter(([, href]) => (
            href !== "/requests/new" || canAccess(actor, "create_requests")
          ))
          .map(([label, href]) => (
            <Link href={href} key={href}>
              <span>{label}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ))}
      </nav>

      <DashboardPeriodControls
        period={period}
        input={input}
        scope={scope}
        locale={locale}
      />

      <section className="metric-grid dashboard-period-metrics" aria-label={copy.indicators}>
        {report.scope === "platform" ? (
          <>
            <MetricCard
              label={copy.metrics.totalRequests}
              value={String(data.requestCount)}
              note={comparisonNote(
                String(data.openRequestCount) + " " + copy.notes.open,
                data.requestCount,
                previous?.requestCount,
                number,
              )}
              icon={ClipboardList}
              tone="blue"
            />
            <MetricCard
              label={copy.metrics.customerSales}
              value={formatCurrency(platformData!.sales, locale)}
              note={comparisonNote(
                copy.notes.customerPrice,
                platformData!.sales,
                previousPlatform?.sales,
                (value) => formatCurrency(value, locale),
              )}
              icon={TrendingUp}
              tone="teal"
            />
            <MetricCard
              label={copy.metrics.buyingCost}
              value={formatCurrency(platformData!.buyingCost, locale)}
              note={comparisonNote(
                copy.notes.supplierCost,
                platformData!.buyingCost,
                previousPlatform?.buyingCost,
                (value) => formatCurrency(value, locale),
              )}
              icon={Banknote}
              tone="navy"
            />
            <MetricCard
              label={copy.metrics.grossProfit}
              value={formatCurrency(platformData!.grossProfit, locale)}
              note={comparisonNote(
                percent(platformData!.grossMarginPercent) + " " + copy.notes.grossMargin,
                platformData!.grossProfit,
                previousPlatform?.grossProfit,
                (value) => formatCurrency(value, locale),
              )}
              icon={CircleDollarSign}
              tone="teal"
            />
            <MetricCard
              label={copy.metrics.urgent}
              value={String(data.urgentRequestCount)}
              note={comparisonNote(
                copy.notes.urgentPlatform,
                data.urgentRequestCount,
                previous?.urgentRequestCount,
                number,
              )}
              icon={AlertTriangle}
              tone="orange"
            />
            <MetricCard
              label={copy.metrics.delayed}
              value={String(platformData!.delayedDeliveryCount)}
              note={comparisonNote(
                copy.notes.delayedPlatform,
                platformData!.delayedDeliveryCount,
                previousPlatform?.delayedDeliveryCount,
                number,
              )}
              icon={Clock3}
              tone="orange"
            />
            <MetricCard
              label={copy.metrics.outstanding}
              value={String(platformData!.outstandingInvoiceCount)}
              note={comparisonNote(
                copy.notes.outstanding,
                platformData!.outstandingInvoiceCount,
                previousPlatform?.outstandingInvoiceCount,
                number,
              )}
              icon={PackageCheck}
              tone="blue"
            />
            <MetricCard
              label={copy.metrics.margin}
              value={percent(platformData!.grossMarginPercent)}
              note={comparisonNote(
                formatCurrency(platformData!.deliveryCharges, locale) + " " + copy.notes.deliverySeparate,
                platformData!.grossMarginPercent,
                previousPlatform?.grossMarginPercent,
                (value) => number(value) + " pp",
              )}
              icon={Percent}
              tone="navy"
            />
          </>
        ) : (
          <>
            <MetricCard
              label={copy.metrics.purchaseRequests}
              value={String(data.requestCount)}
              note={comparisonNote(
                String(data.openRequestCount) + " " + copy.notes.inProgress,
                data.requestCount,
                previous?.requestCount,
                number,
              )}
              icon={ClipboardList}
              tone="blue"
            />
            <MetricCard
              label={copy.metrics.requestedValue}
              value={formatCurrency(companyData!.requestedValue, locale)}
              note={comparisonNote(
                copy.notes.requestedValue,
                companyData!.requestedValue,
                previousCompany?.requestedValue,
                (value) => formatCurrency(value, locale),
              )}
              icon={TrendingUp}
              tone="teal"
            />
            <MetricCard
              label={copy.metrics.approvedSpend}
              value={formatCurrency(companyData!.approvedSpend, locale)}
              note={comparisonNote(
                copy.notes.approvedSpend,
                companyData!.approvedSpend,
                previousCompany?.approvedSpend,
                (value) => formatCurrency(value, locale),
              )}
              icon={ClipboardCheck}
              tone="navy"
            />
            <MetricCard
              label={copy.metrics.pendingApproval}
              value={String(companyData!.pendingApprovalCount)}
              note={comparisonNote(
                copy.notes.pendingApproval,
                companyData!.pendingApprovalCount,
                previousCompany?.pendingApprovalCount,
                number,
              )}
              icon={Clock3}
              tone="orange"
            />
            <MetricCard
              label={copy.metrics.monthlyBudget}
              value={budgetedBranches.length
                ? formatCurrency(monthlyBudget, locale)
                : corePortalMessages(locale).common.notSet}
              note={periodCopy.currentSnapshot}
              icon={WalletCards}
              tone="blue"
            />
            <MetricCard
              label={copy.metrics.remainingBudget}
              value={budgetedBranches.length
                ? formatCurrency(remainingBudget, locale)
                : corePortalMessages(locale).common.notSet}
              note={periodCopy.currentSnapshot}
              icon={CircleDollarSign}
              tone="teal"
            />
            <MetricCard
              label={copy.metrics.urgent}
              value={String(data.urgentRequestCount)}
              note={comparisonNote(
                copy.notes.urgentCompany,
                data.urgentRequestCount,
                previous?.urgentRequestCount,
                number,
              )}
              icon={AlertTriangle}
              tone="orange"
            />
          </>
        )}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>{copy.attentionTitle}</h2>
              <p>{platformView ? copy.attentionPlatform : copy.attentionCompany}</p>
            </div>
            <Link className="table-link" href="/requests">{copy.viewAll}</Link>
          </div>
          <div
            className="data-table-wrap"
            role="region"
            aria-label={copy.attentionTitle}
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.request}</th>
                  <th>{platformView
                    ? copy.companyBranch
                    : corePortalMessages(locale).common.branch}</th>
                  <th>{copy.neededBy}</th>
                  {platformView ? null : <th>{copy.approval}</th>}
                  <th>{copy.fulfilment}</th>
                  {canViewInvoices ? <th>{copy.payment}</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.attention.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link className="table-link" href={"/requests/" + request.id}>
                        <bdi className="bidi-ltr" dir="ltr">{request.orderCode}</bdi>
                      </Link>
                      <br />
                      <span className="subtle">{localizedStatus(request.urgency, locale)}</span>
                    </td>
                    <td>
                      {platformView ? (
                        <>
                          <strong>{request.companyName}</strong>
                          <br />
                          <span className="subtle">{request.branchName}</span>
                        </>
                      ) : <strong>{request.branchName}</strong>}
                    </td>
                    <td>{formatDate(request.neededByDate, locale, period.timeZone)}</td>
                    {platformView ? null : (
                      <td>
                        <StatusBadge status={request.approvalStatus}>
                          {localizedStatus(request.approvalStatus, locale)}
                        </StatusBadge>
                      </td>
                    )}
                    <td>
                      <StatusBadge status={request.status}>
                        {localizedStatus(request.status, locale)}
                      </StatusBadge>
                    </td>
                    {canViewInvoices ? (
                      <td>
                        {request.paymentStatus ? (
                          <StatusBadge status={request.paymentStatus}>
                            {localizedStatus(request.paymentStatus, locale)}
                          </StatusBadge>
                        ) : <span className="subtle">—</span>}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <div className="panel-stack">
          <article className="panel">
            <div className="panel-header">
              <div><h3>{copy.byStatus}</h3><p>{copy.workflowDistribution}</p></div>
            </div>
            <div className="panel-body chart-list">
              {data.byStatus.slice(0, 7).map((item) => (
                <div className="chart-row" key={item.label}>
                  <span>{localizedStatus(item.label, locale)}</span>
                  <div className="chart-track">
                    <div
                      className="chart-fill"
                      style={{ width: String(item.value / maxStatus * 100) + "%" }}
                    />
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <div className="panel-header">
              <div>
                <h3>{platformView ? copy.companyActivity : copy.branchActivity}</h3>
                <p>{platformView ? copy.volumeByCompany : copy.volumeByBranch}</p>
              </div>
            </div>
            <div className="panel-body chart-list">
              {data.activity.map((item) => (
                <div className="chart-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="chart-track">
                    <div
                      className="chart-fill"
                      style={{ width: String(item.value / maxActivity * 100) + "%" }}
                    />
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="dashboard-grid">
        {report.scope === "platform" ? (
          <article className="panel">
            <div className="panel-header">
              <div><h2>{copy.topProducts}</h2><p>{copy.rankedProducts}</p></div>
            </div>
            <div className="panel-body chart-list">
              {platformData!.topProducts.map((item) => (
                <div className="chart-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="chart-track">
                    <div
                      className="chart-fill"
                      style={{ width: String(Math.min(100, item.value * 8)) + "%" }}
                    />
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </article>
        ) : null}
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3>{platformView ? copy.calculationRule : copy.budgetRule}</h3>
              <p>{platformView ? copy.calculationHelp : copy.budgetHelp}</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="callout">
              <strong>{platformView ? copy.calculationLead : copy.budgetLead}</strong>
              <p>{platformView ? copy.calculationBody : copy.budgetBody}</p>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
