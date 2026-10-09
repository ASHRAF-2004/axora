# Target Axora Requirements

## Target-system principle

The current MVP should be treated as validated workflow evidence, not as a requirement to preserve every implementation choice. Future work should preserve proven business contracts while allowing architecture evolution, refactoring and migration toward a maintainable production system.

## Functional target requirements

### Organization and onboarding

- Clean company onboarding with explicit activation state.
- Branch and department structure that supports company-specific purchasing and receiving responsibilities.
- Delivery locations separate from organizational units where that avoids duplicated addresses/workflows.
- Clear company-administrator setup checklist and visible readiness state.

### Access control

- Permission-first authorization with scoped role templates.
- Explicit grant/deny behavior that cannot widen access through the UI alone.
- Clear separation between platform employees, customer administrators/requesters/approvers, finance, receiving and delivery actors.
- Auditable lifecycle operations for invitations, activation, deactivation and access changes.

### Procurement

- One canonical request/order workspace.
- Catalogue-based request composition with server-authoritative pricing.
- Budget visibility that is clearly distinguished from wallet/payment concepts.
- Approval rules that are easy to explain and verify.
- Direct purchase only when explicit business rules permit it.

### Finance and evidence

- Provider-neutral payment boundary.
- Permanent invoice snapshots and generated documents.
- Reconciliation evidence without coupling payment state to delivery state.
- Permission-separated revenue, profit, cost, budget and customer financial visibility.

### Delivery and receipt

- Concurrency-safe delivery assignment/claim.
- Simple delivery status progression with explicit exception handling.
- Customer-facing tracking that minimizes location exposure.
- Independent receipt confirmation with accepted/damaged/missing quantities.

## Non-functional target requirements

- Maintainability: clear module/domain boundaries and reduced duplicate policy logic.
- Reliability: idempotent commands, deterministic retry behavior and recovery from uncertain responses.
- Security: fail-closed authorization, least privilege, protected secrets, privacy-minimized audit evidence and reviewed external integrations.
- Testability: unit/service, migration/database, browser/E2E and deployment validation.
- Operability: documented startup, backup, restore, rollback, monitoring and incident procedures.
- Portability: avoid accidental dependence on one developer workstation or undocumented personal credential.
- Accessibility/localization: maintain Arabic/English and accessible UI behavior as first-class quality attributes.

## Architecture evolution

A future implementation may rebuild frontend composition, service boundaries, database access patterns, deployment topology or integration adapters. Changes should preserve validated business semantics through explicit acceptance criteria and current-to-target traceability.
