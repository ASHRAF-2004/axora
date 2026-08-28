# Requests canonical order workspace

Status: implemented in Phase B (2026-08-28).

## Canonical projection

`Requests` is the customer-facing order record. Request detail combines the
customer total, approval/payment, customer invoice, canonical `delivery_jobs`
state, live customer-safe tracking, Proof of Delivery, customer receipt, and
workflow history. When a modern delivery job exists its state is authoritative;
the legacy `deliveries`/received-quantity projection is only a historical
fallback.

Proof metadata is deliberately limited to the evidence type, capture time,
permitted receiver identity, and a short-lived actor-bound evidence URL. The
evidence download capability rechecks the current role assignment and exact
company/request/job on every access. Request detail never projects raw GPS or
tracking points, storage paths, device/sequence identifiers, OTP secrets,
supplier cost, or platform margin to customer/CAM views.

## Invoice and finance boundary

Customer and CAM invoice data is request-bound and requires both current
request access and `finance.invoice.view`. Their primary navigation does not
offer a separate invoice register; `/finance` redirects them to `/requests`.
The Platform Owner retains the cross-company Finance and payment registers.

## Receiving retirement

`/receiving` is a compatibility redirect to `/requests` and Receiving is absent
from normal navigation. Historical `receipts`, `receipt_lines`, received
quantities, discrepancy evidence, supplier-invoice eligibility, and three-way
matching remain unchanged.

Customer confirmation is still independent from Delivery Agent proof. When it
is required, the small line-level confirmation form appears in the owning
Request only for an active company actor with the live `receiving.confirm`
capability. Explicit DENY and company/branch/department scope remain final.
OTP delivery confirmation remains in the canonical proof flow and is never
shown in Request evidence metadata.

## Retired-page defect

No retained production log contained `AX-1468959879`. Safe code-level
reproduction found two conflicting authorization boundaries: the old page
offered “Confirm customer receipt” to the Platform Owner although the server
action rejects every platform account, and its database trigger still required
a legacy explicit branch assignment even for a canonically company-scoped
Company Administrator. Migration 124 aligns receipt RLS and the trigger with
the live request-bound `receiving.confirm` capability while keeping the action
company-only.
