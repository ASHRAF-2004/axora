# Document Resource Isolation Runtime

## Purpose

This P0-02 slice moves uploaded attachment metadata, direct downloads, uploads,
document target selection, and attachment audit visibility onto trusted database
ownership and exact live role assignments.

The boundary covers attachments linked to:

- purchase requests;
- customer invoices;
- supplier invoices; and
- delivery records.

The browser supplies only an opaque record or attachment identifier. It cannot
supply trusted company, branch, department, request, creator, invoice direction,
or visibility facts.

## Canonical parent ownership

Migration 046 adds nullable `attachments.request_id`. The column is backfilled
only when the existing `entity_type` and `record_id` resolve to a real request,
invoice, or delivery parent.

For every resolvable attachment, the migration derives and repairs:

- canonical request ID;
- company ID;
- branch and optional department through the request;
- request creator;
- invoice direction; and
- active resource state.

Unsupported entity types and missing historical parents are preserved with a
`NULL` canonical request. They are not exposed through application capabilities.
No ownership is invented.

A trigger re-resolves the parent on every attachment insert or ownership-related
update. Posted `request_id` and `company_id` values are overwritten with trusted
values. A missing or unsupported parent is rejected.

Supplier-invoice attachments are always forced to `INTERNAL` visibility.

## Authorization flow

Each metadata, download, or upload decision verifies:

1. the authenticated user;
2. the exact selected active role assignment;
3. current account, membership, branch, department, delegation, and explicit
   permission state;
4. the trusted request parent and creator;
5. request visibility, including creator-only `request.view.own`;
6. entity-specific authority for invoices or deliveries;
7. `document.view`, `document.download`, or `document.manage`; and
8. customer-visible versus platform-internal document visibility.

Missing IDs, malformed IDs, unresolved legacy parents, other companies, sibling
branches, sibling departments, revoked assignments, explicit denials, inactive
resources, and unauthorized internal evidence all produce the same unavailable
result.

## Database capabilities

### Metadata register

`axora_attachment_access_rows(actor, assignment, at)` returns only authorized
attachment metadata. It does not return file bytes, storage paths, tenant secrets,
or internal authorization facts.

### Download

`axora_attachment_download(actor, assignment, attachment, at)` rechecks current
authorization and returns bytes only for the exact authorized attachment. The
direct `/api/attachments/[id]` route uses this capability with the authenticated
actor and emits private, no-store, no-sniff download headers.

Legacy filesystem-backed attachments remain readable only after the capability
allows the row. The application then resolves the configured upload root with
`realpath`, rejects traversal and symbolic-link escapes, enforces the size limit,
and validates the stored bytes against the declared content type.

### Upload

`axora_create_attachment(...)` locks the actor and role assignment, resolves the
trusted parent, recalculates visibility, verifies entity-specific authority, and
inserts the attachment inside the same audited transaction.

A company-side request for `INTERNAL` visibility is downgraded to `CUSTOMER`.
Supplier-invoice evidence is forced to `INTERNAL`. Only platform-authorized
actors can create or view internal evidence.

The application validates:

- supported entity type;
- opaque record identifier shape;
- filename normalization and maximum length;
- two-megabyte maximum size;
- content-type allowlist; and
- file signature or safe UTF-8 content.

## Least privilege

The production application role has no direct `SELECT`, `INSERT`, `UPDATE`, or
`DELETE` access to `attachments` after migration 046 or after deployment grant
reapplication.

Only these functions are executable by `axora_app`:

- `axora_attachment_access_rows`;
- `axora_attachment_download`; and
- `axora_create_attachment`.

The parent resolver, validation trigger, permission helper, raw table, file
bytes, and internal policy state are private.

## Integrated surfaces

The boundary is used by:

- `/documents` target selection and attachment register;
- the dedicated document upload server action;
- `/api/attachments/[id]` direct downloads; and
- company and branch audit views for attachment events.

Audit attachment IDs are intersected with the trusted attachment register.
Company audit queries no longer read the raw attachment table.

Legacy attachment helpers remain protected by the database denial boundary and
are no longer imported by the active documents page or direct download route.

## Audit and privacy

Attachment audit rows contain the attachment ID, action, actor, tenant, reason,
and minimized transition metadata. `file_content` is removed by the existing
audit trigger and is never copied into audit JSON.

The application never logs or returns:

- raw file bytes in audit history;
- passwords or tokens;
- private authorization snapshots;
- hidden supplier-invoice evidence to company users; or
- distinguishable errors for missing versus unauthorized attachment IDs.

## Migration and rollback

Migration 046 is additive. It does not delete or renumber attachments, requests,
invoices, deliveries, users, assignments, sessions, or audit evidence.

Resolvable historical attachments receive canonical parent ownership. Unresolved
history remains stored and unavailable rather than being deleted or guessed.

Rollback is forward-fix only after migration. Do not restore broad application
access to `attachments`. A corrective migration must replace the capability or
parent-resolution logic while preserving stored documents and audit evidence.

## Required verification

Release is blocked unless all of the following pass:

- complete forward migration chain through 046;
- populated-schema forward upgrade through 046;
- trusted request, invoice, and delivery parent backfill;
- company-ID repair and supplier-invoice visibility enforcement;
- company, branch, platform, other-tenant, missing-ID, unresolved-parent, and
  revoked-assignment tests;
- metadata minimization and strict application response validation;
- direct-download IDOR and file-byte validation tests;
- upload MIME spoofing, size, filename, visibility, and cross-tenant denial;
- legacy filesystem traversal and symbolic-link escape denial;
- audit records without file bytes;
- raw attachment table denial and deployment grant reapplication;
- active route and server-action integration guards;
- full lint, typecheck, unit, integration, security, production build,
  desktop/mobile browser, deployment-asset, and production-container gates.
