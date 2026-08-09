import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { isPlatformAnalyticsActor } from "./dashboard-data";
import {
  reportingDateAt,
  safeReportingTimeZone,
  type DashboardPeriod,
  type DashboardPeriodWindow,
} from "./dashboard-period";
import { calculateTotals } from "./domain";
import {
  loadOrganizationDirectory,
  type OrganizationDirectory,
} from "./organization-access";
import { listAuthorizedRequests } from "./request-reader";
import type { ProcurementRequest } from "./types";
import type { PoolClient, QueryResultRow } from "pg";

export interface DashboardBranchOption {
  id: string;
  name: string;
}

export interface DashboardReportingScope {
  timeZone: string;
  branchId?: string;
  branchName?: string;
  branchUnavailable: boolean;
  branches: DashboardBranchOption[];
  directory: OrganizationDirectory;
  platformAnalytics: boolean;
}

export interface DashboardAttentionRow {
  id: string;
  orderCode: string;
  companyName: string;
  branchName: string;
  neededByDate: string;
  urgency: string;
  status: string;
  approvalStatus: string;
  invoiceStatus?: string;
  paymentStatus?: string;
}

interface CommonSnapshot {
  requestCount: number;
  openRequestCount: number;
  urgentRequestCount: number;
  byStatus: Array<{ label: string; value: number }>;
  activity: Array<{ label: string; value: number }>;
  attention: DashboardAttentionRow[];
}

export interface CompanyDashboardSnapshot extends CommonSnapshot {
  requestedValue: number;
  approvedSpend: number;
  pendingApprovalCount: number;
}

export interface PlatformDashboardSnapshot extends CommonSnapshot {
  sales: number;
  buyingCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  deliveryCharges: number;
  delayedDeliveryCount: number;
  outstandingInvoiceCount: number;
  topProducts: Array<{ label: string; value: number }>;
}

export type DashboardPeriodReport =
  | {
    scope: "company";
    current: CompanyDashboardSnapshot;
    previous?: CompanyDashboardSnapshot;
  }
  | {
    scope: "platform";
    current: PlatformDashboardSnapshot;
    previous?: PlatformDashboardSnapshot;
  };

interface SummaryRow extends QueryResultRow {
  requestCount: number;
  openRequestCount: number;
  urgentRequestCount: number;
  requestedValue: number;
  approvedSpend: number;
  pendingApprovalCount: number;
  sales: number;
  buyingCost: number;
  deliveryCharges: number;
  delayedDeliveryCount: number;
  outstandingInvoiceCount: number;
}

interface ChartRow extends QueryResultRow {
  label: string;
  value: number;
}

interface AttentionRow extends QueryResultRow, DashboardAttentionRow {}

const EMPTY_DIRECTORY: OrganizationDirectory = {
  capturedAt: new Date(0),
  companies: [],
  branches: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DashboardDataUnavailableError extends Error {
  constructor() {
    super("Dashboard data is unavailable.");
    this.name = "DashboardDataUnavailableError";
  }
}

export async function resolveDashboardReportingScope(
  actor: AuthenticatedSessionUser,
  requestedBranchId?: string,
): Promise<DashboardReportingScope> {
  const platformAnalytics = isPlatformAnalyticsActor(actor);
  if (actor.accountKind !== "COMPANY") {
    return {
      timeZone: "UTC",
      branchUnavailable: Boolean(requestedBranchId),
      branches: [],
      directory: EMPTY_DIRECTORY,
      platformAnalytics,
    };
  }

  const directory = await loadOrganizationDirectory(actor);
  const branches = directory.branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
  }));
  const normalizedRequested = requestedBranchId?.trim();
  const requested = normalizedRequested && UUID.test(normalizedRequested)
    ? directory.branches.find((branch) => branch.id === normalizedRequested)
    : undefined;
  const narrowDefault = actor.scopeType !== "COMPANY" && directory.branches.length === 1
    ? directory.branches[0]
    : undefined;
  const selected = requested ?? narrowDefault;
  const branchUnavailable = Boolean(normalizedRequested && !requested);

  if (isDemoMode()) {
    return {
      timeZone: safeReportingTimeZone(actor.timezone),
      ...(selected ? { branchId: selected.id, branchName: selected.name } : {}),
      branchUnavailable,
      branches,
      directory,
      platformAnalytics,
    };
  }

  if (!actor.companyId) throw new DashboardDataUnavailableError();
  try {
    const result = await withAuditTransaction(
      { actor, reason: "Resolved authorized dashboard reporting timezone" },
      (client) => client.query<{ timeZone: string }>(
        `SELECT COALESCE(
           CASE WHEN $2::uuid IS NULL THEN company.timezone ELSE branch.timezone END,
           company.timezone,
           'UTC'
         ) AS "timeZone"
         FROM public.companies company
         LEFT JOIN public.branches branch
           ON branch.id=$2::uuid AND branch.company_id=company.id
         WHERE company.id=$1
           AND ($2::uuid IS NULL OR branch.id IS NOT NULL)`,
        [actor.companyId, selected?.id ?? null],
      ),
    );
    if (result.rows.length !== 1) throw new DashboardDataUnavailableError();
    return {
      timeZone: safeReportingTimeZone(result.rows[0].timeZone),
      ...(selected ? { branchId: selected.id, branchName: selected.name } : {}),
      branchUnavailable,
      branches,
      directory,
      platformAnalytics,
    };
  } catch (error) {
    if (error instanceof DashboardDataUnavailableError) throw error;
    throw new DashboardDataUnavailableError();
  }
}

const COHORT_CTE = `WITH authorized_requests AS (
  SELECT request.id,request.company_id,request.branch_id,request.needed_by_date,
    request.estimated_delivery_fee,request.tax_amount,
    COALESCE(request.approval_submitted_at,request.created_at) AS cohort_at,
    status.label AS status_label,urgency.label AS urgency_label,
    company.name AS company_name,branch.name AS branch_name,
    access.can_view_finance,access.can_view_commercial
  FROM public.requests request
  JOIN public.axora_request_access_rows($1,$2,$3) access
    ON access.request_id=request.id
  JOIN public.lookup_values status ON status.id=request.status_id
  JOIN public.lookup_values urgency ON urgency.id=request.urgency_id
  JOIN public.companies company ON company.id=request.company_id
  JOIN public.branches branch
    ON branch.id=request.branch_id AND branch.company_id=request.company_id
  WHERE ($7::uuid IS NULL OR request.branch_id=$7::uuid)
), cohort AS (
  SELECT *
  FROM authorized_requests
  WHERE cohort_at>=($4::date AT TIME ZONE $6)
    AND cohort_at<($5::date AT TIME ZONE $6)
)`;

function reportParameters(
  actor: AuthenticatedSessionUser,
  assignmentId: string,
  capturedAt: Date,
  window: DashboardPeriodWindow,
  scope: DashboardReportingScope,
) {
  return [
    actor.id,
    assignmentId,
    capturedAt,
    window.startDate,
    window.endExclusiveDate,
    scope.timeZone,
    scope.branchId ?? null,
    reportingDateAt(capturedAt, scope.timeZone),
    scope.platformAnalytics,
  ];
}

async function loadSummary(
  client: PoolClient,
  parameters: unknown[],
) {
  const result = await client.query<SummaryRow>(
    COHORT_CTE + `
    SELECT
      count(*)::int AS "requestCount",
      (count(*) FILTER (WHERE request_row.status_label NOT IN ('Completed','Cancelled')))::int
        AS "openRequestCount",
      (count(*) FILTER (WHERE request_row.urgency_label='Urgent'))::int
        AS "urgentRequestCount",
      COALESCE(sum(
        CASE WHEN request_row.status_label<>'Cancelled'
          THEN line_totals.sales+request_row.estimated_delivery_fee+request_row.tax_amount
          ELSE 0 END
      ),0)::float8 AS "requestedValue",
      COALESCE(sum(
        CASE WHEN request_row.status_label<>'Cancelled' AND approval.status='Approved'
          THEN line_totals.sales+request_row.estimated_delivery_fee+request_row.tax_amount
          ELSE 0 END
      ),0)::float8 AS "approvedSpend",
      (count(*) FILTER (
        WHERE request_row.status_label<>'Cancelled'
          AND COALESCE(approval.status,'Pending')='Pending'
      ))::int AS "pendingApprovalCount",
      COALESCE(sum(
        CASE WHEN request_row.status_label<>'Cancelled' THEN line_totals.sales ELSE 0 END
      ),0)::float8 AS sales,
      COALESCE(sum(
        CASE WHEN $9::boolean AND request_row.can_view_commercial
          AND request_row.status_label<>'Cancelled' THEN line_totals.buying_cost ELSE 0 END
      ),0)::float8 AS "buyingCost",
      COALESCE(sum(
        CASE WHEN $9::boolean AND request_row.can_view_commercial
          AND request_row.status_label<>'Cancelled' THEN line_totals.delivery_charges ELSE 0 END
      ),0)::float8 AS "deliveryCharges",
      COALESCE(sum(
        CASE WHEN $9::boolean THEN line_totals.delayed_count ELSE 0 END
      ),0)::int AS "delayedDeliveryCount",
      (count(*) FILTER (
        WHERE $9::boolean AND request_row.can_view_finance
          AND invoice.invoice_status='Issued'
          AND invoice.payment_status<>'Paid'
      ))::int AS "outstandingInvoiceCount"
    FROM cohort request_row
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(sum(round(line.quantity*line.unit_sell_price,2)),0) AS sales,
        COALESCE(sum(round(line.quantity*line.unit_buy_price,2)),0) AS buying_cost,
        COALESCE(sum(line.delivery_charge),0) AS delivery_charges,
        (count(*) FILTER (
          WHERE delivery.actual_date IS NULL
            AND COALESCE(delivery.revised_date,delivery.expected_date)<$8::date
            AND public.axora_received_quantity(line.id)<line.quantity
        ))::int AS delayed_count
      FROM public.request_lines line
      LEFT JOIN LATERAL (
        SELECT delivery_row.expected_date,delivery_row.revised_date,delivery_row.actual_date
        FROM public.deliveries delivery_row
        WHERE delivery_row.request_line_id=line.id
        ORDER BY delivery_row.created_at DESC
        LIMIT 1
      ) delivery ON true
      WHERE line.request_id=request_row.id
    ) line_totals ON true
    LEFT JOIN LATERAL (
      SELECT approval_row.status
      FROM public.approvals approval_row
      WHERE approval_row.request_id=request_row.id
        AND approval_row.approval_type='Company approval'
      ORDER BY approval_row.created_at DESC
      LIMIT 1
    ) approval ON true
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(invoice_row.invoice_status ORDER BY invoice_row.invoice_date DESC))[1]
          AS invoice_status,
        CASE
          WHEN sum(invoice_row.paid_amount)>=sum(invoice_row.amount) THEN 'Paid'
          WHEN sum(invoice_row.paid_amount)>0 THEN 'Partial'
          ELSE 'Unpaid'
        END AS payment_status
      FROM (
        SELECT invoice_record.invoice_date,status.label AS invoice_status,
          invoice_record.amount,COALESCE(sum(payment.amount),0) AS paid_amount
        FROM public.invoices invoice_record
        JOIN public.lookup_values status ON status.id=invoice_record.status_id
        LEFT JOIN public.payments payment ON payment.invoice_id=invoice_record.id
        WHERE invoice_record.request_id=request_row.id
          AND invoice_record.direction='CUSTOMER'
          AND status.label<>'Cancelled'
        GROUP BY invoice_record.id,status.label
      ) invoice_row
    ) invoice ON true`,
    parameters,
  );
  return result.rows[0];
}

async function loadCharts(
  client: PoolClient,
  parameters: unknown[],
  includeActivity: boolean,
  platformAnalytics: boolean,
) {
  const byStatusResult = await client.query<ChartRow>(
    COHORT_CTE + `
    SELECT status_label AS label,count(*)::int AS value
    FROM cohort
    GROUP BY status_label
    ORDER BY count(*) DESC,status_label`,
    parameters,
  );
  const activity = includeActivity
    ? (await client.query<ChartRow>(
      COHORT_CTE + `
      SELECT CASE WHEN $9::boolean THEN company_name ELSE branch_name END AS label,
        count(*)::int AS value
      FROM cohort
      GROUP BY CASE WHEN $9::boolean THEN company_name ELSE branch_name END
      ORDER BY count(*) DESC,label
      LIMIT 20`,
      parameters,
    )).rows
    : [];
  const topProducts = platformAnalytics
    ? (await client.query<ChartRow>(
      COHORT_CTE + `
      SELECT line.product_name_snapshot AS label,
        COALESCE(sum(line.quantity),0)::float8 AS value
      FROM cohort request_row
      JOIN public.request_lines line ON line.request_id=request_row.id
      GROUP BY line.product_name_snapshot
      ORDER BY sum(line.quantity) DESC,line.product_name_snapshot
      LIMIT 5`,
      parameters,
    )).rows
    : [];
  return {
    byStatus: byStatusResult.rows.map((row) => ({
      label: row.label,
      value: Number(row.value),
    })),
    activity: activity.map((row) => ({
      label: row.label,
      value: Number(row.value),
    })),
    topProducts: topProducts.map((row) => ({
      label: row.label,
      value: Number(row.value),
    })),
  };
}

async function loadAttention(
  client: PoolClient,
  parameters: unknown[],
) {
  const result = await client.query<AttentionRow>(
    COHORT_CTE + `
    SELECT request_row.id::text,request_record.order_code AS "orderCode",
      request_row.company_name AS "companyName",
      request_row.branch_name AS "branchName",
      request_row.needed_by_date::text AS "neededByDate",
      request_row.urgency_label AS urgency,request_row.status_label AS status,
      COALESCE(approval.status,'Pending') AS "approvalStatus",
      CASE WHEN request_row.can_view_finance THEN invoice.invoice_status END
        AS "invoiceStatus",
      CASE WHEN request_row.can_view_finance THEN invoice.payment_status END
        AS "paymentStatus"
    FROM cohort request_row
    JOIN public.requests request_record ON request_record.id=request_row.id
    LEFT JOIN LATERAL (
      SELECT approval_row.status
      FROM public.approvals approval_row
      WHERE approval_row.request_id=request_row.id
        AND approval_row.approval_type='Company approval'
      ORDER BY approval_row.created_at DESC
      LIMIT 1
    ) approval ON true
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(invoice_row.invoice_status ORDER BY invoice_row.invoice_date DESC))[1]
          AS invoice_status,
        CASE
          WHEN sum(invoice_row.paid_amount)>=sum(invoice_row.amount) THEN 'Paid'
          WHEN sum(invoice_row.paid_amount)>0 THEN 'Partial'
          ELSE 'Unpaid'
        END AS payment_status
      FROM (
        SELECT invoice_record.invoice_date,status.label AS invoice_status,
          invoice_record.amount,COALESCE(sum(payment.amount),0) AS paid_amount
        FROM public.invoices invoice_record
        JOIN public.lookup_values status ON status.id=invoice_record.status_id
        LEFT JOIN public.payments payment ON payment.invoice_id=invoice_record.id
        WHERE invoice_record.request_id=request_row.id
          AND invoice_record.direction='CUSTOMER'
          AND status.label<>'Cancelled'
        GROUP BY invoice_record.id,status.label
      ) invoice_row
    ) invoice ON true
    WHERE request_row.urgency_label='Urgent'
      OR (
        request_row.needed_by_date<$8::date
        AND request_row.status_label NOT IN ('Completed','Cancelled')
      )
      OR (
        request_row.can_view_finance
        AND invoice.invoice_status IN ('Issued','Disputed')
        AND invoice.payment_status<>'Paid'
      )
      OR EXISTS (
        SELECT 1
        FROM public.request_lines attention_line
        LEFT JOIN LATERAL (
          SELECT delivery_row.expected_date,delivery_row.revised_date,delivery_row.actual_date
          FROM public.deliveries delivery_row
          WHERE delivery_row.request_line_id=attention_line.id
          ORDER BY delivery_row.created_at DESC
          LIMIT 1
        ) delivery ON true
        WHERE attention_line.request_id=request_row.id
          AND delivery.actual_date IS NULL
          AND COALESCE(delivery.revised_date,delivery.expected_date)<$8::date
          AND public.axora_received_quantity(attention_line.id)<attention_line.quantity
      )
    ORDER BY (request_row.urgency_label='Urgent') DESC,
      request_row.needed_by_date,request_record.order_code
    LIMIT 6`,
    parameters,
  );
  return result.rows;
}

function mapCompanySnapshot(
  summary: SummaryRow,
  charts: Awaited<ReturnType<typeof loadCharts>>,
  attention: DashboardAttentionRow[],
): CompanyDashboardSnapshot {
  return {
    requestCount: Number(summary.requestCount),
    openRequestCount: Number(summary.openRequestCount),
    urgentRequestCount: Number(summary.urgentRequestCount),
    requestedValue: Number(summary.requestedValue),
    approvedSpend: Number(summary.approvedSpend),
    pendingApprovalCount: Number(summary.pendingApprovalCount),
    byStatus: charts.byStatus,
    activity: charts.activity,
    attention,
  };
}

function mapPlatformSnapshot(
  summary: SummaryRow,
  charts: Awaited<ReturnType<typeof loadCharts>>,
  attention: DashboardAttentionRow[],
): PlatformDashboardSnapshot {
  const sales = Number(summary.sales);
  const buyingCost = Number(summary.buyingCost);
  const grossProfit = sales - buyingCost;
  return {
    requestCount: Number(summary.requestCount),
    openRequestCount: Number(summary.openRequestCount),
    urgentRequestCount: Number(summary.urgentRequestCount),
    sales,
    buyingCost,
    grossProfit,
    grossMarginPercent: sales === 0 ? 0 : grossProfit / sales * 100,
    deliveryCharges: Number(summary.deliveryCharges),
    delayedDeliveryCount: Number(summary.delayedDeliveryCount),
    outstandingInvoiceCount: Number(summary.outstandingInvoiceCount),
    byStatus: charts.byStatus,
    activity: charts.activity,
    topProducts: charts.topProducts,
    attention,
  };
}

async function loadDatabaseSnapshot(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  assignmentId: string,
  capturedAt: Date,
  window: DashboardPeriodWindow,
  scope: DashboardReportingScope,
  includeBreakdowns: boolean,
) {
  const parameters = reportParameters(actor, assignmentId, capturedAt, window, scope);
  const summary = await loadSummary(client, parameters);
  const charts = includeBreakdowns
    ? await loadCharts(
      client,
      parameters,
      scope.platformAnalytics || actor.accountKind === "COMPANY",
      scope.platformAnalytics,
    )
    : { byStatus: [], activity: [], topProducts: [] };
  const attention = includeBreakdowns
    ? await loadAttention(client, parameters)
    : [];
  return scope.platformAnalytics
    ? mapPlatformSnapshot(summary, charts, attention)
    : mapCompanySnapshot(summary, charts, attention);
}

function inWindow(request: ProcurementRequest, window: DashboardPeriodWindow) {
  return request.requestDate >= window.startDate
    && request.requestDate < window.endExclusiveDate;
}

function demoSnapshot(
  actor: AuthenticatedSessionUser,
  requests: ProcurementRequest[],
  window: DashboardPeriodWindow,
  scope: DashboardReportingScope,
  capturedAt: Date,
) {
  const cohort = requests.filter((request) => (
    inWindow(request, window)
    && (!scope.branchId || request.branchId === scope.branchId)
  ));
  const byStatus = Object.entries(cohort.reduce<Record<string, number>>(
    (values, request) => ({
      ...values,
      [request.status]: (values[request.status] ?? 0) + 1,
    }),
    {},
  )).map(([label, value]) => ({ label, value }));
  const activity = actor.accountKind === "COMPANY" || scope.platformAnalytics
    ? Object.entries(cohort.reduce<Record<string, number>>(
      (values, request) => {
        const label = scope.platformAnalytics ? request.companyName : request.branchName;
        return { ...values, [label]: (values[label] ?? 0) + 1 };
      },
      {},
    )).map(([label, value]) => ({ label, value }))
    : [];
  const localToday = reportingDateAt(capturedAt, scope.timeZone);
  const attention = cohort.filter((request) => (
    request.urgency === "Urgent"
    || (
      request.neededByDate < localToday
      && !["Completed", "Cancelled"].includes(request.status)
    )
    || request.lines.some((line) => (
      ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus)
    ))
    || (
      request.invoiceStatus !== undefined
      && ["Issued", "Disputed"].includes(request.invoiceStatus)
      && request.paymentStatus !== "Paid"
    )
  )).slice(0, 6).map((request) => ({
    id: request.id,
    orderCode: request.orderCode,
    companyName: request.companyName,
    branchName: request.branchName,
    neededByDate: request.neededByDate,
    urgency: request.urgency,
    status: request.status,
    approvalStatus: request.approvalStatus,
    invoiceStatus: request.invoiceStatus,
    paymentStatus: request.paymentStatus,
  }));
  const requestedValue = cohort
    .filter((request) => request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const approvedSpend = cohort
    .filter((request) => (
      request.status !== "Cancelled" && request.approvalStatus === "Approved"
    ))
    .reduce((sum, request) => sum + request.estimatedTotal, 0);
  const common = {
    requestCount: cohort.length,
    openRequestCount: cohort.filter((request) => (
      !["Completed", "Cancelled"].includes(request.status)
    )).length,
    urgentRequestCount: cohort.filter((request) => request.urgency === "Urgent").length,
    byStatus,
    activity,
    attention,
  };
  if (!scope.platformAnalytics) {
    return {
      ...common,
      requestedValue,
      approvedSpend,
      pendingApprovalCount: cohort.filter((request) => (
        request.status !== "Cancelled" && request.approvalStatus === "Pending"
      )).length,
    } satisfies CompanyDashboardSnapshot;
  }
  const totals = calculateTotals(cohort);
  const products = Object.entries(cohort.flatMap((request) => request.lines)
    .reduce<Record<string, number>>((values, line) => ({
      ...values,
      [line.productName]: (values[line.productName] ?? 0) + line.quantity,
    }), {}))
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  return {
    ...common,
    ...totals,
    delayedDeliveryCount: cohort.flatMap((request) => request.lines)
      .filter((line) => line.deliveryStatus === "Delayed").length,
    outstandingInvoiceCount: cohort.filter((request) => (
      request.invoiceStatus === "Issued" && request.paymentStatus !== "Paid"
    )).length,
    topProducts: products,
  } satisfies PlatformDashboardSnapshot;
}

export async function getAuthorizedDashboardPeriodReport(
  actor: AuthenticatedSessionUser,
  period: DashboardPeriod,
  scope: DashboardReportingScope,
  reason = "Viewed authorized dashboard period",
): Promise<DashboardPeriodReport> {
  const capturedAt = new Date(period.generatedAt);
  if (isDemoMode()) {
    const requests = await listAuthorizedRequests(actor);
    const current = demoSnapshot(actor, requests, period, scope, capturedAt);
    const previous = period.comparison
      ? demoSnapshot(actor, requests, period.comparison, scope, capturedAt)
      : undefined;
    return scope.platformAnalytics
      ? {
        scope: "platform",
        current: current as PlatformDashboardSnapshot,
        ...(previous ? { previous: previous as PlatformDashboardSnapshot } : {}),
      }
      : {
        scope: "company",
        current: current as CompanyDashboardSnapshot,
        ...(previous ? { previous: previous as CompanyDashboardSnapshot } : {}),
      };
  }

  if (!actor.roleAssignmentId) throw new DashboardDataUnavailableError();
  try {
    return await withAuditTransaction(
      { actor, reason },
      async (client) => {
        const current = await loadDatabaseSnapshot(
          client,
          actor,
          actor.roleAssignmentId!,
          capturedAt,
          period,
          scope,
          true,
        );
        const previous = period.comparison
          ? await loadDatabaseSnapshot(
            client,
            actor,
            actor.roleAssignmentId!,
            capturedAt,
            period.comparison,
            scope,
            false,
          )
          : undefined;
        return scope.platformAnalytics
          ? {
            scope: "platform" as const,
            current: current as PlatformDashboardSnapshot,
            ...(previous ? {
              previous: previous as PlatformDashboardSnapshot,
            } : {}),
          }
          : {
            scope: "company" as const,
            current: current as CompanyDashboardSnapshot,
            ...(previous ? {
              previous: previous as CompanyDashboardSnapshot,
            } : {}),
          };
      },
    );
  } catch (error) {
    if (error instanceof DashboardDataUnavailableError) throw error;
    throw new DashboardDataUnavailableError();
  }
}
