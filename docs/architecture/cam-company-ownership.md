# CAM company ownership

Status: architecture ready; creator ownership implemented (2026-08-28).

## Canonical relationship

`company_assignments` is the only CAM/company authorization relationship.
`companies.created_by` remains immutable creation provenance and is not used as
permanent access by itself. An active CAM must also hold an active canonical
role assignment, the relevant effective permission, no applicable `DENY`, and
an active `company_assignments` row for the resource's company.

The Platform Owner is a deliberate global bypass and never needs a company
assignment. Company users and Delivery Agents retain their existing tenant,
branch, department, and job-assignment boundaries.

Assignment provenance is recorded as:

- `CREATED_BY_CAM`: inserted atomically when a CAM creates a company.
- `OWNER_ASSIGNED`: reserved by the existing accountable Owner assignment
  command for future manual assignment/reassignment.
- `LEGACY`: retained relationship whose more specific provenance is not proven.

## Creation and backfill

Owner creation inserts no CAM assignment. CAM creation inserts one active
primary `CREATED_BY_CAM` relationship in the same transaction; command replay
returns the original company and cannot duplicate ownership.

Historical backfill uses only reliable creation-time CAM role evidence. An
Owner-created company is not assigned. Ambiguous provenance fails closed to
Owner-only; it is never inferred from viewing, editing, unrelated lead data, or
broad role permissions.

## Authorization and notification flow

Company-bound reads and mutations converge on the shared database permission
snapshot and `axora_company_actor_can_view`. Requests, customer invoice data,
deliveries, documents, dashboards, searches, exports, APIs, company users, and
notification recipient validation therefore share the same active ownership
decision. UI filtering is presentation only.

Company-bound CAM in-app and email recipients are revalidated against active
ownership when delivered. Ending ownership, revoking the CAM role, deactivating
the account, or adding an explicit `DENY` immediately fails closed.

## Future Owner assignment

The existing Owner-only assignment command already serializes one active
primary relationship, ends the former assignment, links predecessor history,
records accountable continuity evidence, and labels the new relationship
`OWNER_ASSIGNED`.

Future workflow:

1. Owner opens a Company and chooses Assign CAM.
2. Owner selects an eligible CAM.
3. The command ends any old active relationship and creates a new active
   `OWNER_ASSIGNED` relationship in one transaction.
4. Only the newly assigned CAM may receive one useful assignment notification.

MANUAL ASSIGNMENT UI: **NOT IMPLEMENTED IN THIS TASK**

ARCHITECTURE: **READY**
