# Product and Business Requirements

## Product purpose

Axora is a multi-company procurement and fulfilment platform. Its purpose is to connect company setup, people and access, catalogue use, purchase requests, approvals, budget controls, payment/invoice evidence, delivery, tracking, receiving and audit evidence in one scoped workflow.

The current MVP is a reference implementation used to validate these workflows. The requirements below are intended to survive future refactoring even when implementation choices change.

## Core business requirements

### Company onboarding and structure

- Authorized Axora personnel can create and manage customer companies.
- Each company has isolated users, branches/departments, delivery locations and company-owned financial settings.
- Company activation must be explicit and auditable.
- Customer users must not see data belonging to another company or unauthorized branch/department.

### People, roles and permissions

- Access is role- and scope-aware, with explicit permissions and server-side enforcement.
- Delegated administrators can grant only authority they themselves are allowed to delegate.
- Platform, company, branch/department, delivery and receiving responsibilities must remain separable.
- Self-approval is prohibited.
- Customer actors must not receive Axora-confidential buying cost, profit or private commercial data unless an explicit trusted business role requires it.

### Catalogue and procurement

- Authorized users can browse a customer-facing catalogue and create a purchase request.
- Pricing shown to customers must be server-authoritative and must not expose restricted cost fields.
- The request workspace is the canonical customer order record.
- Direct purchase, where allowed, must not silently bypass budget, approval or audit rules.

### Budget and approval

- Company/branch budget authority belongs to the customer organization rather than the Platform Owner.
- Budget effects must be transactional, auditable and scoped to the correct organization unit.
- Approval eligibility must consider role, scope, request state and separation of duties.

### Payment, invoices and documents

- Payment, invoice generation, email delivery, fulfilment, physical delivery and receipt confirmation are independent auditable states.
- Checkout must recalculate trusted values on the server.
- A finalized invoice is permanent evidence for the approved transaction and must not recalculate from later catalogue prices.
- The payment-completion boundary should remain provider-neutral so a future verified payment method can replace the current pilot strategy without rewriting downstream invoice/delivery semantics.

### Delivery, tracking and receiving

- Paid work can enter a delivery execution flow.
- Delivery assignment/claim must be concurrency-safe and idempotent.
- Driver/delivery evidence does not replace customer receipt confirmation.
- Live location, where used, requires explicit permission, bounded retention and privacy-safe customer presentation.
- Completion requires the required payment/invoice and receiving evidence, not merely a driver status.

### Audit and accountability

- Security-sensitive and business-critical mutations should leave durable, privacy-minimized evidence.
- Audit history must not store secrets, bearer tokens, raw credentials or unnecessary personal data.
- Operations should be recoverable from lost responses or retries without creating duplicate business effects.

## Business constraints that remain decisions

The repository demonstrates a tested MVP operating model, but the following should remain explicit business decisions rather than developer assumptions:

- final online payment provider and settlement workflow;
- final accounting treatment for delivery fees, margin and profit;
- general-availability map coverage and routing provider;
- retention periods for operational and tracking evidence outside the controlled pilot;
- final approval hierarchy for each customer segment;
- which internal processes should remain manual during the next pilot;
- when broader automation is justified by stable business rules.

## Sources of truth

Use `docs/MVP_OPERATING_MODEL.md`, `PAYMENT_AND_INVOICE_OPERATING_RULES.md`, `src/lib/permissions.ts`, `src/lib/workflow.ts`, current migrations and tests as the primary implementation evidence. Older design documents are useful history but may not represent the latest simplified MVP contract.
