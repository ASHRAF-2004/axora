# ADR-002: Preserve a Provider-Neutral Payment Completion Boundary

- **Status:** Accepted for handover
- **Date:** 2026-09-11

## Context

The current pilot records trusted checkout completion without a production online gateway. Downstream invoice, document, email, fulfilment and delivery behavior should not depend on one payment vendor.

## Decision

Preserve a provider-neutral trusted payment-completion contract. A future verified provider or reviewed manual-confirmation adapter may produce the same trusted paid event.

## Consequences

- Provider replacement does not require rewriting invoice/delivery semantics.
- Provider-specific credentials/errors remain at the adapter boundary.
- Business/Finance still must approve settlement, refunds, reconciliation and exception policy before production rollout.
