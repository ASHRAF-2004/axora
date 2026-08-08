# P0-02 Data and Resource Isolation Closure

## Status

This document is the release boundary for completing P0-02 against every
production resource and route that exists in the current Axora application.

P0-02 is an authorization and isolation epic, not one database-table task. Its
acceptance condition is that an actor can read, count, search, export, download,
or mutate only resources authorized by the actor's exact current role
assignment, effective permission set, and trusted database ownership.

## Core invariants

1. The browser never supplies trusted company, branch, department, creator,
   supplier, invoice-direction, delivery-assignment, or visibility facts.
2. The exact selected role assignment is resolved from the signed session and
   revalidated against live database state.
3. List predicates are applied in PostgreSQL before protected source rows leave
   the database.
4. Single-resource access resolves ownership from the target row and returns one
   generic unavailable result for missing and unauthorized identifiers.
5. Every state-changing operation authorizes the trusted parent before taking a
   child lock, then locks and rechecks the exact target inside the same
   transaction as the mutation.
6. Explicit denials override role grants and delegations.
7. Assignment revocation, membership loss, suspension, inactive organization
   resources, and authorization-version changes take effect without waiting for
   a new browser session.
8. Counts, filters, search results, exports, files, audit events, dashboards, and
   background-recipient selection use the same resource boundary as detail
   pages.
9. Confidential supplier, quotation, buying-cost, invoice, payment, internal
   document, and identity fields are minimized independently from row
   visibility.
10. Logs and audit history never contain passwords, bearer tokens, raw file
    bytes, private authorization snapshots, raw IP addresses, browser signals,
    provider secrets, or private identity hashes.

## Shipped isolation layers

### P0-01 authorization foundation

Migrations 036 through 043 established:

- stable permission codes;
- canonical role and scope identities;
- explicit grants and denials;
- approval limits;
- delegated access;
- audited role and scope lifecycle;
- exact live effective-access snapshots; and
- scoped access administration.

### Organization resources

Migration 044 and `organization-access.ts` protect:

- company directories;
- branch directories;
- company, branch, and department resource identifiers;
- branch budget field visibility; and
- parent-company and parent-branch navigation context.

### Request resources

Migration 045, `request-isolation.ts`, and `request-reader.ts` protect:

- request lists and details;
- request lines;
- creator-only request visibility;
- approval queues;
- workflow timelines;
- dashboards and reports;
- CSV exports;
- request creation; and
- request status mutations.

### Documents and audit evidence

Migration 046 protects:

- attachment metadata;
- direct file downloads;
- document uploads;
- request, invoice, and delivery parent ownership;
- internal versus customer visibility;
- supplier-invoice evidence;
- legacy filesystem containment; and
- attachment audit visibility.

### Closure capabilities

Migrations 047 through 049 and the closure runtime protect the remaining active
operational and administration surfaces:

- quotation registers and supplier RFQ registers;
- approval history;
- delivery history;
- customer and supplier invoice registers;
- payment registers;
- customer three-way matching;
- quotation, approval, delivery, invoice, payment, and match mutations;
- user directories, user-target changes, account creation, and invitation
  replacement;
- request creation selectors;
- company pricing configuration; and
- document upload target selectors.

Migration 048 changes child-resource write locking from lock-then-authorize to
authorize-parent-then-lock-and-recheck. It also locks the exact selected target
role assignment and introduces the audited account-creation scope capability.
Migration 049 rejects all operational writes when the trusted company, branch,
or department resource has become inactive.

Invitation actor and company quota dimensions are serialized with transaction-
scoped advisory locks. This preserves atomic quota enforcement without upgrading
`KEY SHARE` resource locks to row-update locks, avoiding the parallel invitation
deadlock pattern.

## Active surface matrix

| Surface | Read boundary | Write boundary |
|---|---|---|
| Companies, branches, departments | Organization directory/resource capability | Scoped server action plus trusted resource recheck |
| Users and invitations | `axora_user_directory_rows` | `axora_lock_user_target_access` or `axora_lock_user_creation_scope` inside the invitation/user transaction |
| Catalogue search and cart | Authenticated private API, customer-safe fields, product IDs re-resolved server-side | Request creation resolves products, pricing, company, branch, and department again |
| Requests and request lines | `axora_request_access_rows` | Active request/resource or creation lock inside transaction |
| Quotations and supplier RFQs | `axora_operation_request_access_rows(..., 'sourcing.manage')` | Authorized request parent followed by line or quotation lock and relationship recheck |
| Approvals | `axora_operation_request_access_rows(..., 'request.approval_queue.view')` | Active request approval lock inside transaction |
| Deliveries | `axora_operation_request_access_rows(..., 'delivery.view')` | Authorized request parent followed by line lock and relationship recheck |
| Invoices and payments | Finance permission plus request predicate; supplier evidence requires platform permission | Authorized request parent followed by invoice lock and relationship recheck |
| Three-way matching | Finance-match permission plus request predicate | Request-line and invoice locks inside transaction |
| Documents and files | Attachment capability plus trusted parent | Attachment creation capability inside transaction |
| Notifications | Recipient user ID and active account state | Workflow audience resolver derives recipients from trusted request state |
| Audit | Trusted visible request, request-line, invoice, delivery, user, and attachment identities | Append-only audited domain transactions |
| Reports and exports | Same authorized request and finance readers used by pages | Not applicable |
| Supplier portal | Active supplier membership and assigned RFQ/order resources | Supplier membership and idempotent assigned-resource commands |
| Delivery portal | Active delivery profile and explicit job assignment | Assigned delivery job, event, and evidence commands |

## Resources scheduled in later tasks

P0-02 does not create empty tables or placeholder workflows solely to claim
coverage. Features not yet implemented—such as the full budget ledger, generated
supplier purchase orders, advanced live tracking, contractual ceiling engine,
and later notification/reporting extensions—must satisfy these same isolation
invariants as acceptance criteria in their owning backlog task.

No later feature may merge with a company ID, branch ID, department ID, user ID,
request ID, delivery ID, invoice ID, document ID, or supplier ID trusted directly
from the browser.

## Verification matrix

The release gate includes:

- Platform Owner access across permitted platform resources;
- Client Account Manager access to assigned companies only;
- Company Administrator denial for another company;
- Branch Administrator denial for sibling branches;
- Department Administrator denial for sibling departments;
- Requester creator-only visibility;
- supplier and delivery assignment boundaries;
- explicit-denial precedence;
- immediate assignment revocation;
- inactive company, branch, and department write denial;
- missing-resource and unauthorized-resource response equivalence;
- authorization-before-child-lock ordering and relationship rechecks;
- exact selected target-assignment locking;
- account-creation and invitation-replacement authorization inside their write
  transactions;
- deadlock-safe actor/company invitation quota serialization;
- list, detail, mutation, count, search, export, file, audit, and background
  recipient coverage;
- strict response validation and field minimization;
- migration-chain and populated-schema upgrade coverage;
- least-privilege database function grants on fresh migration and after the real
  deployment grant script is reapplied;
- desktop, mobile, reduced-motion, accessibility, production build, deployment
  asset, and production-container verification.

## Migration, dependency, and rollback notes

Migrations 047 through 049 are additive capability changes. They do not delete,
renumber, or rewrite companies, branches, departments, users, memberships,
assignments, requests, lines, quotations, approvals, deliveries, invoices,
payments, matches, documents, notifications, sessions, visitor claims, or audit
history.

The release also pins transitive `nanoid` to 3.3.17 because the live production
dependency audit began rejecting 3.3.16 under GHSA-2v37-7h3g-55p8. The lockfile
change was generated and verified with `npm ci` and the production audit; no
application API or runtime behavior depends directly on Nano ID.

Rollback is forward-fix only after deployment. Do not restore global readers,
pre-transaction authorization, client-trusted tenant predicates, or broad raw
attachment access. A corrective migration or runtime patch must preserve exact-
assignment authorization, trusted ownership, active-resource enforcement, and
same-transaction mutation checks.
