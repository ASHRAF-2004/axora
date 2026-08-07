# Request Resource Isolation Runtime

## Purpose

This is the second P0-02 data-isolation slice. It makes purchase-request
ownership a trusted database fact and removes request list, detail, timeline,
dashboard, report, export, sourcing, finance, approval, delivery-history, and
document-parent selection from mutable session-field filtering.

The runtime covers:

- exact live role-assignment authorization;
- company, branch, department, and creator ownership;
- creator-only `request.view.own` access;
- request creation scope locking;
- lock-before-write status transitions;
- finance, sourcing, supplier, and internal-cost field minimization;
- derived register filtering for approvals, quotations, supplier RFQs,
  deliveries, invoices, payments, and attachments; and
- non-revealing missing and out-of-scope behavior.

Dedicated delivery-job, invoice, payment, generated-document, attachment-download,
search, notification, and background-worker database capabilities remain later
P0-02 slices. Until those land, the user-facing registers are intersected with
the authorized request and request-line identity sets.

## Canonical request ownership

Migration 045 adds nullable `requests.department_id` with a tenant-safe foreign
key to `departments(id, company_id)`. A request with a canonical department is
a department resource. A request without one remains a branch resource.

The historical `requests.department` display string is retained. Migration
backfill sets `department_id` only when exactly one active schema department in
the same company and compatible branch matches the historical name or code.
Ambiguous and unmatched text remains `NULL`. This preserves legacy data while
failing closed for department-only users.

A trigger rejects a canonical department from another company or a department
bound to another branch.

## Authorization flow

The browser supplies only an opaque request identifier. The database resolves:

1. the exact active actor role assignment;
2. current account, membership, branch, department, supplier, or delivery
   readiness through the existing live authorization snapshot;
3. request company, branch, canonical department, and creator from trusted rows;
4. explicit denials, explicit grants, role grants, active delegations, and scope
   containment; and
5. the requested operation permission.

`request.view` permits broad scoped visibility. `request.view.own` permits only a
request whose trusted `created_by` equals the authenticated user. Supplying a
creator, company, branch, or department identifier from the route or form cannot
alter the decision.

Missing resources, malformed identifiers, revoked assignments, inactive actor
context, other-tenant resources, sibling branches, sibling departments, and
permission denials all collapse to one unavailable outcome.

## Database capabilities

### Read capabilities

`axora_request_access_rows(actor, assignment, at)` returns only request IDs the
actor may view, with minimized booleans indicating whether finance, sourcing,
and confidential commercial fields may be selected.

`axora_request_resource_access(actor, assignment, permission, request, at)`
returns one trusted request scope only when the requested permission is current.

### Write capabilities

`axora_lock_request_resource_access(...)` locks the request row and rechecks the
actor, assignment, permission, and trusted ownership inside the same transaction
as the state change.

`axora_lock_request_creation_scope(...)` locks and resolves the active company,
branch, and optional department before a request is inserted. It returns trusted
company pricing and canonical display names; it does not trust posted tenant or
pricing facts.

### Private helpers

The trigger, request-scope classifier, and permission helper are not executable
by `PUBLIC` or `axora_app`. Deployment grant reapplication exposes only the four
application capabilities above.

## Field minimization

A visible request does not imply access to every joined field.

- Customer invoice number, invoice state, and payment state require
  `finance.invoice.view` at the exact request scope.
- Selected supplier, supplier name, quotation reference, and supplier
  confirmation require `sourcing.manage`.
- Buying price and internal delivery charge require `commercial.cost.view` or
  sourcing authority.
- Customer sell price and approved customer estimate remain available to the
  customer-side roles that may view the request.

The demo runtime applies the same authorization kernel and minimization rules.
Strict response schemas reject unexpected properties, inconsistent scope IDs,
and malformed ownership shapes.

## Integrated surfaces

The following surfaces use the request boundary:

- `/requests` list and filters;
- `/requests/[id]` detail and workflow timeline;
- dashboard metrics and attention list;
- reports and request CSV export;
- approval queue and visible approval history;
- sourcing line choices, quotation register, and supplier RFQ register;
- finance request choices, invoice register, and payment register;
- delivery request choices and delivery history; and
- document targets and attachment register.

Derived registers are filtered by authorized request IDs, request-line IDs,
invoice IDs, or delivery IDs. Company-side document users additionally receive
only `CUSTOMER` attachment visibility.

## Write-path rules

Request creation and fulfillment status transitions no longer authorize before
opening a transaction and then mutate by raw ID. The writer:

1. starts the audited transaction;
2. locks the exact actor and assignment context;
3. resolves and authorizes the trusted target scope;
4. locks the request for a state transition, or locks company/branch/department
   rows for creation;
5. validates product, approval, delivery, invoice, and settlement evidence;
6. performs the mutation; and
7. appends workflow events and notifications before commit.

A revoked assignment, newly applied denial, changed membership, changed
resource ownership, or inactive tenant therefore fails before mutation.

## Deployment and rollback

Migration 045 is additive. It does not delete or renumber requests, lines,
approvals, workflow events, invoices, deliveries, documents, identities,
assignments, sessions, or audit evidence.

Rollback is forward-fix only after migration. The application can temporarily
return to the prior request readers while a corrective migration replaces the
new functions, but production data must not be reset and the canonical
`department_id` column must not be dropped after it has been used.

## Required verification

Release is blocked unless all of the following pass:

- complete forward migration chain through 045;
- populated-schema forward upgrade through 045;
- exact Platform, company, branch, department, and creator-only request tests;
- cross-company, sibling-scope, missing-resource, and revoked-assignment denial;
- unambiguous department backfill and wrong-branch trigger rejection;
- creation and mutation lock tests;
- finance, sourcing, supplier, and commercial field minimization;
- strict application response validation;
- deployment grant reapplication and private-helper checks;
- request page, dashboard, report, export, approval, sourcing, finance, delivery,
  and document integration guards;
- full unit, integration, security, production build, desktop/mobile browser,
  deployment-asset, and production-container gates.
