# Axora refactor architecture

Status: repository-grounded design baseline, audited 2026-08-02. This document
separates observed production state from changes present only in the working
tree. It is not evidence that a public DNS cutover, pending migration, email
enablement, import, or reset has happened.

## System context

Axora is a multi-company procurement application. The audited Ubuntu runtime
is the prepared self-hosted production target; the existing Render service is
retained through the separately approved cutover and rollback window. The
intended local public edge is Cloudflare, while the application, database,
deployment controller, files, and credentials remain on the Ubuntu host.

The prepared local request path is:

```text
browser
  -> Cloudflare edge
  -> dedicated outbound Cloudflare Tunnel
  -> cloudflared container
  -> private edge network
  -> Caddy :8080
  -> private frontend network
  -> Next.js app :3000
  -> private backend network
  -> PostgreSQL / axora_hybrid
```

Caddy also exposes the origin on host loopback for diagnostics. Neither the
Next.js port nor PostgreSQL is published to the LAN or Internet. The retained
`tailscale-db` service supports the existing controlled database path during
the migration window; it is not part of the browser request path.

The observed runtime had PostgreSQL, `tailscale-db`, the app, Caddy, and the
dedicated `cloudflared` container running. The current branch adds a separate
`email-sender` service, but that service was not running in the production
snapshot. Container health did not prove which origin the public apex served;
public DNS/routing was neither changed nor inferred during this audit.
Provider selection, DNS, mailbox, credential, and enablement gates are in
[EMAIL_PROVIDER_AND_DNS.md](EMAIL_PROVIDER_AND_DNS.md).
The branch also prepares a dedicated Cloudflare Queue consumer for minimized
six-event delivery lifecycle evidence, migration `028` suppression, and
migration `030` privacy-minimized provider-message correlation. It was not
deployed or subscribed in the observed Cloudflare account; its separate manual gate is
documented in [EMAIL_PROVIDER_EVENTS.md](EMAIL_PROVIDER_EVENTS.md). The
developer-only Mailpit profile is a loopback template catcher and is not part
of the production topology.

Repository sources:

- [`compose.yaml`](../../compose.yaml) defines the base services and private
  application networks.
- [`compose.hybrid.yaml`](../../compose.hybrid.yaml) retains the Tailscale
  database path.
- [`compose.production.yaml`](../../compose.production.yaml) selects
  `axora_hybrid`, loopback-only origin access, the dedicated Tunnel, immutable
  app images, resource limits, and container hardening.
- [`Caddyfile.production`](../../caddy/Caddyfile.production) validates the Host
  header, caps request size, sets response headers, and proxies only to the app.

## Trust boundaries and ownership

| Boundary | Allowed path | Persistent state | Operator rule |
| --- | --- | --- | --- |
| Internet to edge | HTTPS to the approved Axora hostname | Cloudflare DNS and Tunnel routing | No router port-forwarding |
| Edge to origin | Dedicated Tunnel to Caddy on the private `edge` network | Root-owned Tunnel token outside Git | Publish only the application origin |
| Origin to app | Caddy to Next.js on `frontend` | Immutable image and release metadata | Gate on `/api/health/ready` |
| App to database | `axora_app` to PostgreSQL on `backend` | `axora_postgres_data` | No public or LAN database port |
| App to email | App to `email-sender` on private `mail` network | Hash-only account-setup invitation state; separate encrypted durable security/workflow queues | Account setup is one synchronous HMAC-authenticated send; app holds no provider token or Internet egress |
| Email to provider | `email-sender` only, over `email-egress` | Root-owned provider token file | Delivery remains disabled until manual gates pass |
| Provider event to app | Sending-domain subscription to dedicated Queue and queue-only Worker to one HMAC-authenticated endpoint | Append-only event fingerprint and derived suppression | Reject/minimize at edge; never persist provider payload or plaintext recipient |
| Operations | Root-owned systemd controller | Releases, backups, state and logs under `/var/lib` and `/var/log` | Exact commit, one lock, backup before migration |

## Persistence boundary

The production recovery unit is all of the following, from one consistent
recovery point:

- the PostgreSQL custom-format dump of `axora_hybrid`;
- the named PostgreSQL volume while it is live;
- `/var/lib/axora-production/uploads`, including legacy file fallbacks;
- the exact application commit and migration manifest;
- checksums and the backup manifest; and
- credentials from the separate approved encrypted credential process.

Product image bytes and current attachment bytes are primarily stored in
PostgreSQL. The upload mount still belongs in every backup because older
attachment rows can reference it. Secrets live under
`/etc/axora-production/secrets`; they do not belong in releases, images,
ordinary backup logs, or this documentation.

## Application and data domains

The audited live database snapshot used migration `013` and contained 25
public base tables. That snapshot is preserved as historical reset-impact
evidence; it is not the target schema. Its domains were:

- identity and authorization: `users`, `roles`;
- tenant master data: `companies`, `branches`;
- catalog and sourcing: `products`, `product_images`, `suppliers`,
  `product_suppliers`, `quotations`;
- procurement: `requests`, `request_lines`, `approvals`,
  `request_status_transitions`;
- fulfilment and finance: `deliveries`, `invoices`, `invoice_allocations`,
  `payments`;
- controlled files and evidence: `attachments`, `audit_logs`;
- configurable dictionaries: `lookup_types`, `lookup_values`;
- rejected trusted-interaction history introduced by migration `013`:
  `company_interaction_profiles`, `interaction_revisions`,
  `interaction_assets`; and
- deployment history: `schema_migrations`.

The refactor branch contains forward migrations `014` through `032`. None was
applied to the observed production database during this work:

- `014` expands users and adds the account-setup invitation lifecycle.
  PostgreSQL retains only a SHA-256 token hash plus delivery metadata. The raw
  setup token exists only in memory for one atomic `SENDING` claim and one
  HMAC-authenticated synchronous sender request; there is no account-setup
  ciphertext, outbox, or poller. A failed, disabled, or uncertain attempt is
  replaced only by explicit resend, which revokes the old invitation and issues
  a new token;
- `015` removes the rejected trusted-interaction runtime, permissions, assets,
  and company configuration while preserving migration and audit history;
- `016` adds identity profiles, credential/session records, explicit
  memberships, multi-scope role assignments, onboarding, and notification
  preferences while retaining legacy identity columns for rollback;
- `017` adds tenant information, versioned logos, and immutable derived brand
  themes; and
- `018` adds append-only workflow events and tenant-bound in-app
  notifications. Confirmed sends and activations for company/branch account
  invitations use `invitation.sent` and `invitation.accepted` events; the
  accepting account is the actor and the original issuer receives the
  activation notice. These tables require a non-null `company_id`, so
  platform, supplier, and delivery invitations remain in the canonical
  account-setup/audit history instead of being assigned a fabricated tenant;
- `019` adds supplier RFQs/responses, delivery jobs/evidence, customer
  receiving, three-way matching, and fail-closed row-level policies for those
  new portal tables. Device timestamps remain append-only evidence, but clocks
  more than five minutes ahead are rejected and current delivery state is
  ordered by authoritative server receipt time rather than the device clock;
- `020` adds contact submissions, password-reset and email-verification token
  records with purpose-specific expiry and revocation state;
- `021` adds the guarded one-time platform-owner invitation bootstrap. The
  controller refuses before database mutation unless email delivery is enabled
  and the private sender is ready; the explicit
  `--replace-pending-first-owner-invitation` recovery flag can only revoke and
  replace the one live invitation for the same pending first owner;
- `022` adds durable authentication rate-limit and account-lock state;
- `023` backfills workflow history and applies tenant-safe workflow-event row
  policies;
- `024` makes normalized role assignments and memberships authoritative for
  newly invited accounts while retaining read-compatible legacy identities;
- `025` adds customer-side receipt/invoice matching and finance separation;
- `026` adds tenant-bound workflow-email outbox rows, independent in-app/email
  preferences, claim leases, retry state, and localized safe message payloads;
- `027` makes independently confirmed customer receipts the accounting source
  of truth and prevents new driver evidence from becoming final acceptance;
  and
- `028` records signed provider delivery events and applies recipient
  suppression for complaints and hard bounces before any outbox send; and
- `029` adds bounded delivery-attempt, partial-handover and issue events with
  driver-reported line outcomes. Those events remain logistics evidence and
  never replace the independently authenticated customer receipt; and
- `030` expands the signed provider ledger to delivered, deferred, bounced,
  failed, rejected, and complained events. It stores hashes rather than raw
  message IDs/addresses, preserves hard-bounce/complaint-only suppression, and
  adds a private read model that correlates later provider status with immutable
  account, security/contact, and workflow send outcomes; and
- `031` hardens technical-support diagnostics. It fixes the request-status
  schema reference, exposes private email-queue state only as aggregate counts,
  validates a live canonical platform owner/support assignment inside the
  database, and records only two fixed support audit shapes without granting
  the application direct `audit_logs` insert authority; and
- `032` moves session-revocation evidence to a hardened database trigger. The
  trigger records only the transition to revoked plus actor, tenant, and a
  bounded reason; it never copies token hashes, network hashes, user-agent
  summaries, expiry data, or complete session rows into audit history.

These are target structures, not production facts. The refactored application
resolves active normalized role assignments, membership, company/branch/
supplier/delivery scope, profile state, credential version, and a live session
on every authenticated request. JWT claims are a signed cache, not the source
of authorization truth. Legacy identity columns remain readable only for the
expand/contract compatibility window. New account creation emits canonical
roles and normalized scope records.

The same live identity read enforces the mandatory profile boundary. Normal
page, Server Action, permission, and API access requires both profile
completion and acceptance of the application-owned required policy version.
An explicitly named incomplete-session accessor is limited to the shell,
profile/onboarding, account/security, help, login-loop handling, and the private
brand/avatar resources those pages require. Policy versions are written from a
server constant; no hidden input or browser field selects the accepted version.

Tenant filtering is enforced in service/repository queries and database row
policies where the portal tables support them; navigation is only a user-
experience projection of those server decisions. Platform actors have no
company scope, company actors require a live company membership, branch actors
require a live branch assignment, supplier actors require membership in the
assigned supplier, and drivers require a live delivery-agent profile. The exact
authorization baseline is in [ROLE_MATRIX.md](ROLE_MATRIX.md).

### Technical-support trust boundary

Technical support is platform-scoped for diagnostics, but it is not a
cross-tenant business principal. Its sole product permission is
`view_system_diagnostics`; it cannot open the general audit feed or list tenant
requests, supplier records, finance records, documents, or user directories.
The account diagnostic requires one exact normalized email and a bounded
operator reason, returns a masked/minimized read model, and creates no browsing
endpoint.

The service layer checks the permission even when called outside its route or
server action. Migration `031` repeats the critical boundary in PostgreSQL:
the transaction actor must resolve to a live canonical `PLATFORM_OWNER` or
`TECHNICAL_SUPPORT` platform assignment. `axora_support_system_summary()`
returns aggregates only, including an aggregate over the otherwise private
workflow-email queue. `axora_record_support_audit(...)` constructs either an
account-diagnostic `READ` row or a session-control `UPDATE` row from fixed,
bounded inputs. `PUBLIC` cannot execute these capabilities, the internal actor
resolver is not executable by `axora_app`, and `axora_app` still cannot insert
`audit_logs` directly.

Session control locks the target account, refuses the current actor and every
platform account, rotates `users.auth_version`, revokes active
`user_sessions`, and writes the fixed aggregate support audit event in one
transaction. Migration `032` additionally appends one privacy-minimized audit
row for each session whose `revoked_at` changes from null to a timestamp; the
application still has no direct audit-log insert privilege.
The credential-version check on every authenticated request makes existing
signed cookies unusable immediately. Operator-entered investigation detail is
kept in the platform support audit; tenant-visible user-change audit receives
only the generic session-revocation reason.

## Canonical procurement workflow

The workbook contains multiple generic procurement diagrams that disagree
with one another. They are reference material, not executable workflow. The
canonical refactor workflow is the one enforced by
[`workflow.ts`](../../src/lib/workflow.ts), the application service layer, and
the database transition table:

```text
New Request
  -> company decision recorded by an assigned approver
  -> Under Verification
  -> Waiting for Quotation
  -> Supplier Assigned
  -> Ordered
  -> Preparing for Delivery
  -> Out for Delivery
  -> Delivered
  -> Invoice Issued
  -> Completed
```

Operational meaning and evidence:

1. An authorized company user creates `New Request`; prices, fees and tax are
   snapshotted and a company decision is pending.
2. An assigned company/branch administrator or approver approves within tenant
   and branch scope. Self-approval is rejected. Rejection cancels the request.
3. An Axora owner verifies the approved request and moves it to quotation.
4. Axora records supplier offers. Selection requires a reason, an active
   supplier, valid MOQ/date, approval evidence, and one selected offer per
   line. Selecting all lines moves the request to `Supplier Assigned`.
5. Axora records ordering and append-only driver delivery evidence, including
   attempts, partial handovers, issue reasons, reported quantities and the name
   supplied at handover. The server retains the device capture time for
   evidence while using server receipt order for current state, so an incorrect
   future device clock cannot pin or reorder the workflow. An independently
   assigned customer receiver then records accepted, damaged, and missing
   quantities. Driver evidence never becomes customer acceptance by itself.
6. Only approved quantities from confirmed customer receipts feed customer
   three-way matching and final delivery readiness. Customer invoices cannot
   exceed the approved total and mismatches remain explicit exceptions.
7. The MVP records only numbered cash-on-delivery evidence. Completion requires
   active customer invoices to equal the approved total and be fully paid.

`On Hold` is permitted only from `Under Verification`, requires a reason, and
resumes to `Under Verification`. Cancellation requires a reason and is allowed
only in the configured early stages. `Waiting for Approval` and `Approved`
remain solely so historical records can finish; new work must not enter that
retired second-approval route.

Any future workflow change must update the TypeScript transition map, database
transition records, service-layer evidence checks, tests, and this document in
one reviewed forward migration.

## Deployment and rollback model

The deployment controller fetches the exact approved `main` SHA, builds an
immutable image, creates and verifies a pre-migration backup, applies
transactional forward migrations, starts the candidate, and checks local and
external readiness before recording it as current. A root-owned lock prevents
deployment, backup, and rollback from overlapping.

Normal rollback changes the application image only. Database migrations are
not reversed. Data corruption or a destructive reset requires an isolated
restore and approved database switch, not an in-place overwrite. The reset
controller is now prepared with an allowlisted plan mode, GPG AES-256 recovery
point verification, sealed-release-only migrations, recoverable database and
upload quarantine, and automatic pre-completion rollback. It was not run
against production, and the incomplete workbook plus unproved off-machine
recovery still block authorization. Its design and exact audited impact are in
[MIGRATION_AND_RESET_PLAN.md](MIGRATION_AND_RESET_PLAN.md).

## Refactor invariants

- `axora_hybrid` is the production data source; the older `axora` database is
  not a production substitute.
- The platform-owner boundary uses the canonical `PLATFORM_OWNER` assignment
  and a protected owner flag; a legacy `ADMIN` label alone cannot grant it.
- Every business query is scoped server-side; hiding navigation is not access
  control.
- Approval, selected quotation, accepted delivery, issued invoice, and COD
  evidence are explicit records, not inferred from a spreadsheet cell.
- Money is stored as fixed-precision numeric values and quantity is applied
  before cent rounding.
- Audit history omits password hashes, file bytes, image bytes, invitation
  token hashes, email addresses, message bodies, setup/reset URLs, and provider
  credentials. Provider identifiers stay in the restricted delivery boundary.
- Existing migrations are immutable. Retirement uses a later forward
  migration after an expand/contract window.
- DNS, provider credentials, reset authorization, and production restore are
  manual gates.

No import, reset, production database write, DNS change, credential
installation, provider email send, or Cloudflare event-resource change was
performed while producing this baseline. Local Mailpit template capture, when
run, is development evidence only.
