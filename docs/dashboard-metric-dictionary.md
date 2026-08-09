# Dashboard Metric Dictionary

This dictionary is the review contract for P1-15. The implementation source is
DASHBOARD_METRIC_DEFINITIONS in src/lib/dashboard-period.ts; tests require the
documented keys and implementation keys to remain aligned.

## Period and scope contract

- The request cohort uses COALESCE(requests.approval_submitted_at,
  requests.created_at).
- The displayed start date is inclusive. The day after the displayed end date
  is the exclusive PostgreSQL boundary.
- Company-wide periods use the company timezone. An explicitly selected,
  authorized branch uses that branch's timezone. Platform reporting uses UTC.
- Every period aggregate begins with axora_request_access_rows; unknown or
  unauthorized branch identifiers fall back without disclosing existence.
- Comparison uses the immediately preceding window with the same number of
  local calendar days. A zero previous value produces "new from zero", not an
  invalid percentage.
- There is no shared dashboard cache. Data and authorization are refreshed on
  each page load or export, so access changes cannot reuse an older scope.
- Currency metrics are MYR with no conversion. Current budget cards are
  explicitly marked snapshots and are not period-filtered.

## Metrics

| Key | Business meaning | Source | Date/status rule | Scope | Freshness |
| --- | --- | --- | --- | --- | --- |
| requestCount | Requests submitted in the period | requests | Cohort date; all statuses | Both | Live |
| openRequestCount | Cohort requests still open | requests, status lookup | Excludes Completed and Cancelled | Both | Live |
| urgentRequestCount | Cohort requests currently urgent | requests, urgency lookup | All statuses | Both | Live |
| requestedValue | Customer sell value plus request delivery estimate and tax | requests, request_lines | Cohort date; excludes Cancelled | Company | Live |
| approvedSpend | Requested value currently approved by the company | requests, request_lines, approvals | Latest company approval Approved; excludes Cancelled | Company | Live |
| pendingApprovalCount | Requests awaiting company approval | requests, approvals | Latest company approval Pending; excludes Cancelled | Company | Live |
| sales | Customer line sell value | request_lines | Cohort date; excludes Cancelled | Platform owner | Live |
| buyingCost | Private Axora line buying cost | request_lines | Cohort date; excludes Cancelled | Platform owner only | Live |
| grossProfit | Sales less buying cost | request_lines | Same cohort as sales | Platform owner | Live |
| grossMarginPercent | Gross profit divided by sales | Derived | Zero sales returns zero | Platform owner | Live |
| deliveryCharges | Private line delivery charges | request_lines | Cohort date; excludes Cancelled | Platform owner | Live |
| delayedDeliveryCount | Lines past effective due date and not fully received | deliveries, receipts | Request cohort; delay evaluated on generated local date | Platform owner | Live |
| outstandingInvoiceCount | Issued customer invoices not fully paid | invoices, payments | Request cohort; payment state evaluated live | Platform owner | Live |
| monthlyBudget | Current visible branch monthly budget configuration | organization directory | Current snapshot, not period-filtered | Company | Live |
| remainingBudget | Current visible branch balance | budget balances | Current snapshot, not period-filtered | Company | Live |

## Export contract

The dashboard CSV carries scope, branch label, preset, inclusive start,
exclusive end, displayed inclusive end, generated time, timezone, locale,
comparison window, boundary convention, freshness, current values, previous
values, and the metric definition detail. It calls the same period normalizer
and authorized reader as the dashboard page.
