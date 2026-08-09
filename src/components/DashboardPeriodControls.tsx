import {
  DASHBOARD_PERIOD_PRESETS,
  dashboardPeriodSearchParams,
  type DashboardPeriod,
  type DashboardPeriodInput,
} from "@/lib/dashboard-period";
import { dashboardPeriodMessages } from "@/lib/dashboard-period-i18n";
import type { DashboardReportingScope } from "@/lib/dashboard-reader";
import type { SupportedLocale } from "@/lib/i18n";
import { CalendarRange, Download } from "lucide-react";
import Link from "next/link";

function displayDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00.000Z"));
}

export function DashboardPeriodControls({
  period,
  input,
  scope,
  locale,
}: {
  period: DashboardPeriod;
  input: DashboardPeriodInput;
  scope: DashboardReportingScope;
  locale: SupportedLocale;
}) {
  const copy = dashboardPeriodMessages(locale);
  const exportQuery = dashboardPeriodSearchParams(period, scope.branchId);
  const generated = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: period.timeZone,
  }).format(new Date(period.generatedAt));
  const start = displayDate(period.startDate, locale);
  const end = displayDate(period.endDate, locale);

  return (
    <section className="panel dashboard-period-panel" aria-labelledby="dashboard-period-title">
      <header className="dashboard-period-heading">
        <div className="dashboard-period-heading-icon"><CalendarRange size={21} aria-hidden="true" /></div>
        <div>
          <h2 id="dashboard-period-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="dashboard-period-summary" aria-live="polite">
          <strong>{copy.summary(start, end, period.timeZone)}</strong>
          <span>{copy.generated(generated)}</span>
          {period.comparison ? (
            <span>{copy.comparisonPeriod(
              displayDate(period.comparison.startDate, locale),
              displayDate(period.comparison.endDate, locale),
            )}</span>
          ) : null}
        </div>
      </header>
      {period.issue ? (
        <p className="dashboard-period-alert" role="alert">{copy.issues[period.issue]}</p>
      ) : null}
      {scope.branchUnavailable ? (
        <p className="dashboard-period-alert" role="alert">{copy.invalidBranch}</p>
      ) : null}
      <form method="get" action="/dashboard" className="dashboard-period-form">
        <label>
          {copy.preset}
          <select name="preset" defaultValue={period.preset} aria-label={copy.preset}>
            {DASHBOARD_PERIOD_PRESETS.map((preset) => (
              <option value={preset} key={preset}>{copy.presets[preset]}</option>
            ))}
          </select>
        </label>
        <label>
          {copy.start}
          <input
            type="date"
            name="start"
            aria-label={copy.start}
            defaultValue={input.start ?? period.startDate}
            aria-describedby="dashboard-period-rule"
          />
        </label>
        <label>
          {copy.end}
          <input
            type="date"
            name="end"
            aria-label={copy.end}
            defaultValue={input.end ?? period.endDate}
            aria-describedby="dashboard-period-rule"
          />
        </label>
        {scope.branches.length ? (
          <label>
            {copy.branch}
            <select name="branch" defaultValue={scope.branchId ?? ""} aria-label={copy.branch}>
              <option value="">{copy.allBranches}</option>
              {scope.branches.map((branch) => (
                <option value={branch.id} key={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="dashboard-period-checkbox">
          <input
            type="checkbox"
            name="compare"
            value="1"
            defaultChecked={period.compare}
            aria-label={copy.compare}
          />
          <span>{copy.compare}</span>
        </label>
        <div className="dashboard-period-actions">
          <button type="submit" className="button button-primary">{copy.apply}</button>
          <Link className="button button-secondary" href="/dashboard">{copy.reset}</Link>
          <Link
            className="button button-secondary"
            href={"/api/export/dashboard?" + exportQuery.toString()}
          ><Download size={16} aria-hidden="true" />{copy.export}</Link>
        </div>
      </form>
      <p id="dashboard-period-rule" className="dashboard-period-rule">{copy.inclusiveRule}</p>
    </section>
  );
}
