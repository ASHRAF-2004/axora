export const DASHBOARD_PERIOD_PRESETS = [
  "current-month",
  "previous-month",
  "last-3-months",
  "last-6-months",
  "year-to-date",
  "previous-year",
  "custom",
] as const;

export type DashboardPeriodPreset = typeof DASHBOARD_PERIOD_PRESETS[number];
export type DashboardPeriodIssue =
  | "invalid-preset"
  | "invalid-custom-date"
  | "start-after-end"
  | "range-too-large";

export interface DashboardPeriodInput {
  preset?: string;
  start?: string;
  end?: string;
}

export interface DashboardPeriodWindow {
  startDate: string;
  endDate: string;
  endExclusiveDate: string;
}

export interface DashboardPeriod extends DashboardPeriodWindow {
  preset: DashboardPeriodPreset;
  timeZone: string;
  generatedAt: string;
  issue?: DashboardPeriodIssue;
}

export interface DashboardComparison {
  absolute: number;
  percentage: number | null;
  direction: "up" | "down" | "same";
}

export type DashboardMetricKey =
  | "requestCount"
  | "openRequestCount"
  | "urgentRequestCount"
  | "requestedValue"
  | "approvedSpend"
  | "pendingApprovalCount"
  | "sales"
  | "buyingCost"
  | "grossProfit"
  | "grossMarginPercent"
  | "deliveryCharges"
  | "delayedDeliveryCount"
  | "outstandingInvoiceCount"
  | "monthlyBudget"
  | "remainingBudget";

export interface DashboardMetricDefinition {
  key: DashboardMetricKey;
  meaning: string;
  source: string;
  dateField: string;
  statuses: string;
  currency: string;
  scope: "company" | "platform" | "both";
  refresh: string;
}

export const DASHBOARD_METRIC_DEFINITIONS: readonly DashboardMetricDefinition[] = [
  { key: "requestCount", meaning: "Requests submitted in the selected period.", source: "requests", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "All statuses", currency: "Not applicable", scope: "both", refresh: "Live at page load" },
  { key: "openRequestCount", meaning: "Selected-period requests not currently completed or cancelled.", source: "requests and request-status lookup", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Excludes Completed and Cancelled", currency: "Not applicable", scope: "both", refresh: "Live at page load" },
  { key: "urgentRequestCount", meaning: "Selected-period requests currently marked urgent.", source: "requests and urgency lookup", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "All statuses", currency: "Not applicable", scope: "both", refresh: "Live at page load" },
  { key: "requestedValue", meaning: "Customer sell value, delivery estimate, and tax for non-cancelled requests in the cohort.", source: "requests and request_lines", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Excludes Cancelled", currency: "MYR; no currency conversion", scope: "company", refresh: "Live at page load" },
  { key: "approvedSpend", meaning: "Requested value for cohort requests whose latest company approval is approved.", source: "requests, request_lines, and approvals", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Latest company approval Approved; excludes Cancelled", currency: "MYR; no currency conversion", scope: "company", refresh: "Live at page load" },
  { key: "pendingApprovalCount", meaning: "Cohort requests whose latest company approval remains pending.", source: "requests and approvals", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Latest company approval Pending; excludes Cancelled", currency: "Not applicable", scope: "company", refresh: "Live at page load" },
  { key: "sales", meaning: "Line sell value for non-cancelled requests in the selected cohort.", source: "requests and request_lines", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Excludes Cancelled", currency: "MYR; no currency conversion", scope: "platform", refresh: "Live at page load" },
  { key: "buyingCost", meaning: "Private line buying cost for non-cancelled requests in the selected cohort.", source: "requests and request_lines", dateField: "COALESCE(approval_submitted_at, created_at)", statuses: "Excludes Cancelled", currency: "MYR; no currency conversion", scope: "platform", refresh: "Live at page load" },
  { key: "grossProfit", meaning: "Selected-cohort sales less private buying cost.", source: "request_lines", dateField: "COALESCE(requests.approval_submitted_at, requests.created_at)", statuses: "Excludes Cancelled", currency: "MYR; no currency conversion", scope: "platform", refresh: "Live at page load" },
  { key: "grossMarginPercent", meaning: "Gross profit divided by sales with a zero-sales result of zero.", source: "Derived from sales and buying cost", dateField: "Same request cohort as sales", statuses: "Excludes Cancelled", currency: "Percentage", scope: "platform", refresh: "Live at page load" },
  { key: "deliveryCharges", meaning: "Private line delivery charges for non-cancelled requests in the cohort.", source: "request_lines", dateField: "COALESCE(requests.approval_submitted_at, requests.created_at)", statuses: "Excludes Cancelled", currency: "MYR; no currency conversion", scope: "platform", refresh: "Live at page load" },
  { key: "delayedDeliveryCount", meaning: "Cohort lines past their effective delivery date and not fully received.", source: "request_lines, deliveries, and receipts", dateField: "Request cohort date; delay evaluated on generated local date", statuses: "Not fully received", currency: "Not applicable", scope: "platform", refresh: "Live at page load" },
  { key: "outstandingInvoiceCount", meaning: "Cohort requests with issued customer invoices not fully paid.", source: "invoices and payments", dateField: "Request cohort date; payment state evaluated live", statuses: "Issued and not Paid", currency: "Not applicable", scope: "platform", refresh: "Live at page load" },
  { key: "monthlyBudget", meaning: "Current configured monthly budget snapshot for visible branches.", source: "authorized organization directory", dateField: "Not period-filtered; explicitly a current snapshot", statuses: "Active authorized branch configuration", currency: "MYR; no currency conversion", scope: "company", refresh: "Live at page load" },
  { key: "remainingBudget", meaning: "Current remaining budget snapshot for visible branches.", source: "authorized budget balances", dateField: "Not period-filtered; explicitly a current snapshot", statuses: "Authorized branch balances", currency: "MYR; no currency conversion", scope: "company", refresh: "Live at page load" },
] as const;

const DAY_MS = 86_400_000;
const MAX_CUSTOM_RANGE_DAYS = 3_660;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string | undefined) {
  if (!value || !ISO_DATE.test(value)) return undefined;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value
    ? undefined
    : parsed;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function monthStart(value: Date, offset = 0) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
}

function yearStart(value: Date, offset = 0) {
  return new Date(Date.UTC(value.getUTCFullYear() + offset, 0, 1));
}

function daysBetween(start: Date, endExclusive: Date) {
  return Math.round((endExclusive.getTime() - start.getTime()) / DAY_MS);
}

export function safeReportingTimeZone(value: string | undefined) {
  const candidate = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return "UTC";
  }
}

export function reportingDateAt(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeReportingTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return value.year + "-" + value.month + "-" + value.day;
}

function windowFromDates(start: Date, endExclusive: Date): DashboardPeriodWindow {
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(addDays(endExclusive, -1)),
    endExclusiveDate: dateOnly(endExclusive),
  };
}

function defaultCurrentMonth(today: Date) {
  return windowFromDates(monthStart(today), addDays(today, 1));
}

export function normalizeDashboardPeriod(
  input: DashboardPeriodInput,
  requestedTimeZone: string,
  now = new Date(),
): DashboardPeriod {
  const timeZone = safeReportingTimeZone(requestedTimeZone);
  const today = parseDateOnly(reportingDateAt(now, timeZone))!;
  const requestedPreset = input.preset?.trim();
  let preset: DashboardPeriodPreset = DASHBOARD_PERIOD_PRESETS.includes(
    requestedPreset as DashboardPeriodPreset,
  ) ? requestedPreset as DashboardPeriodPreset : "current-month";
  let issue: DashboardPeriodIssue | undefined = requestedPreset && preset !== requestedPreset
    ? "invalid-preset"
    : undefined;
  let window = defaultCurrentMonth(today);

  if (!issue) {
    if (preset === "previous-month") {
      window = windowFromDates(monthStart(today, -1), monthStart(today));
    } else if (preset === "last-3-months") {
      window = windowFromDates(monthStart(today, -2), addDays(today, 1));
    } else if (preset === "last-6-months") {
      window = windowFromDates(monthStart(today, -5), addDays(today, 1));
    } else if (preset === "year-to-date") {
      window = windowFromDates(yearStart(today), addDays(today, 1));
    } else if (preset === "previous-year") {
      window = windowFromDates(yearStart(today, -1), yearStart(today));
    } else if (preset === "custom") {
      const start = parseDateOnly(input.start);
      const end = parseDateOnly(input.end);
      if (!start || !end) {
        issue = "invalid-custom-date";
      } else if (start.getTime() > end.getTime()) {
        issue = "start-after-end";
      } else if (daysBetween(start, addDays(end, 1)) > MAX_CUSTOM_RANGE_DAYS) {
        issue = "range-too-large";
      } else {
        window = windowFromDates(start, addDays(end, 1));
      }
    }
  }

  if (issue) {
    preset = "current-month";
    window = defaultCurrentMonth(today);
  }

  return {
    ...window,
    preset,
    timeZone,
    generatedAt: now.toISOString(),
    ...(issue ? { issue } : {}),
  };
}

export function dashboardPeriodSearchParams(
  period: DashboardPeriod,
  branchId?: string,
) {
  const params = new URLSearchParams({ preset: period.preset });
  if (period.preset === "custom") {
    params.set("start", period.startDate);
    params.set("end", period.endDate);
  }
  if (branchId) params.set("branch", branchId);
  return params;
}
