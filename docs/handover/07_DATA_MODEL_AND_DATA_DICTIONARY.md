# Data Model and Data Dictionary

## Source of truth

Axora uses forward SQL migrations under `database/migrations/`. At the inspected handover commit, `tests/full-migration-chain.test.ts` verifies migrations through `136_catalog_draft_zero_price_guard.sql`, at least 68 public tables and at least 35 PostgreSQL policies in the generated schema.

This document is a domain dictionary, not a replacement for the executable migrations.

## Core domains

| Domain / entity | Purpose | Key relationships / notes |
|---|---|---|
| Users / credentials / sessions | Identity, login and account lifecycle | Connected to role assignments, memberships and invitation/setup state |
| Role assignments / permissions | Canonical access authority | Scope-aware; effective permission does not remove entity-level checks |
| Companies | Customer tenant | Owns organizational structure, users, requests, budgets and customer evidence |
| Branches / departments | Organization scope | Used for access, budget, request, delivery and receiving boundaries |
| Delivery locations | Physical fulfilment destination | Separate from organization structure where the workflow requires it |
| Products / catalogue | Purchasable item metadata and customer pricing | Restricted buying-cost / commercial fields must remain protected |
| Requests | Canonical customer order/workspace | Owns request lines, approval/evidence, finance and delivery linkage |
| Request lines | Requested products/quantities/snapshots | Pricing/evidence must not silently recalculate from later catalogue edits |
| Approvals | Approval decisions/evidence | Separation of duties and scope required |
| Budget / wallet ledger | Company/branch financial authority and effects | Transactional; do not conflate budget with payment state |
| Payments | Trusted payment completion evidence | Independent from invoice email and delivery |
| Invoices / generated documents | Permanent financial/business evidence | Finalized snapshots; generated/versioned PDF handling |
| Delivery jobs / events | Assignment and physical fulfilment progression | Concurrency-safe claim/assignment and append-only evidence |
| Delivery locations/tracking | Live/retained operational location evidence | Explicit consent, bounded retention and privacy-safe company projection |
| Receiving / three-way match | Independent customer acceptance | Driver evidence is not final receipt confirmation |
| Attachments / document evidence | Controlled file storage | Authorization and visibility scoped to business record |
| Notifications / email outbox | In-app and transactional communication | Retry/idempotency and provider status handled independently from business state |
| Integrations / webhooks | External system connection state | Credentials/secrets must use dedicated protected boundaries |
| Audit / workflow events | Accountability and immutable history | Privacy-minimized and secret-free |
| Schema migrations | Forward schema history | Existing migrations are immutable; fix with a later migration |

## Data-handling rules

- Money uses fixed-precision database values; avoid floating-point business calculations.
- Final invoice/request snapshots must remain stable even if catalogue pricing changes later.
- Historical compatibility columns/data may remain during expand/contract migration windows.
- Do not hard-delete business evidence solely to simplify code.
- Protect commercial confidentiality at the database/service boundary, not merely in the UI.
- Prefer opaque IDs and parameterized SQL.
- Do not store secrets, bearer URLs, password hashes, raw provider payloads or unnecessary personal data inside audit events.

## When changing the schema

1. Add a new numbered forward migration.
2. Update migration-chain tests and any relevant database capability/policy tests.
3. Preserve rollback/recovery strategy; do not edit an already-applied migration.
4. Update this dictionary when a new domain is introduced or a core ownership boundary changes.
