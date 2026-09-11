# ADR-003: Automate According to Business-Rule Maturity

- **Status:** Accepted for handover
- **Date:** 2026-09-11

## Context

Axora supports many workflows that are technically automatable, but some still depend on business judgment, pilot learning or unresolved finance/operations policy.

## Decision

Automate deterministic, well-tested technical steps first. Keep high-risk or judgment-heavy actions manual until business rules, exception paths and authority are stable.

## Consequences

- CI, health checks, idempotent notifications and document generation are strong automation candidates.
- Company activation exceptions, finance overrides, destructive recovery and uncertain sourcing decisions remain human-controlled unless requirements change.
- Automation proposals require explicit failure/recovery behavior and acceptance criteria.
