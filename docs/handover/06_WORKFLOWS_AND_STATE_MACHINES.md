# Workflows and State Machines

## Procurement request lifecycle

`src/lib/workflow.ts` is the executable transition map for the request status labels. Current code retains some historical states for compatibility; new work should not automatically reuse every old state.

A simplified business flow used by the current MVP is:

```text
Request
  -> Company approval / authorized direct-purchase decision
  -> Pay
  -> Final invoice/document evidence
  -> Prepare / delivery execution
  -> Delivery evidence
  -> Independent receiving
  -> Completed
```

## Request transition rules

- Invalid state transitions must fail server-side.
- Hold, cancel and resume paths require a reason where configured.
- Historical `Waiting for Approval` / quotation-related states may remain to complete older records even when new work follows a simplified path.
- Self-approval must fail regardless of browser/UI behavior.

## Payment and invoice state

Payment is independent from physical delivery. The authorized checkout action recalculates a trusted snapshot, records the payment once and finalizes a permanent invoice/document workflow. Email delivery failure must not reverse a paid payment or finalized invoice.

## Delivery state

Paid requests can produce an idempotent awaiting-assignment delivery job. Active delivery actors claim work through concurrency-safe database logic. Delivery evidence is append-only operational evidence and does not become customer acceptance automatically.

## Receiving state

A separately authorized receiving actor confirms accepted/damaged/missing quantities. Completion rules must use the required payment/invoice/receipt evidence rather than trusting only a mutable delivery status.

## Account and invitation state

User creation starts an invitation/setup lifecycle. Administrators do not create/share another user's plaintext password. Deactivation revokes usable access and pending invitation state according to current account-lifecycle rules.

## Future workflow changes

Any future workflow change should update together:

- TypeScript transition/state definitions;
- database migration/constraints/capabilities;
- service-layer evidence checks;
- unit/database/E2E tests;
- customer/operator documentation;
- this handover package.

Do not change only the displayed status label.
