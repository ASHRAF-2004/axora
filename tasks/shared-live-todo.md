# Shared SSE tasks

## 1. Inventory and design checkpoint

- [x] Read applicable AGENTS and safe master Section 9.
- [x] Inspect current stream routes, clients, auth, durable readers and external events.
- [x] Research primary current browser/Next/Node/PostgreSQL/proxy docs.
- [x] Reproduce reconnect sequence rejection without DB/server mutation.
- [x] Lead approves the written architecture before application code edits.

Files: `tasks/plan.md`, `tasks/todo.md`. Verification: clean exact a40 source inventory and isolated helper output. No dependencies.

## 2. Harden existing transport

Acceptance: serialized/cancellable bounded loads; stable versions and heartbeat; explicit reconnect resync and validated cursor; no post-close enqueue or unbounded buffers.

Files: `src/lib/server-event-stream.ts`, `tests/server-event-stream.test.ts`, optionally a focused transport helper/test file. Verification: focused Vitest only. Depends on 1.

## 3. Authorized live version reader / route

Acceptance: fixed topics/context; fresh session/permission checks before load and emit; existing bounded authorized DB snapshots only; safe version hints; 204 switch and polling-compatible GET.

Files: new live contract/reader, canonical API route, focused authorization/route tests (maximum about 5 files). Verification: focused role/tenant/DENY/revoke/cursor/switch tests; no new financial table or migration. Depends on 2. Any new SQL scope receives a separate lead check first.

## Checkpoint: contract and safety

- [x] Transport and authorized reader tests pass.
- [ ] Independent source review confirms no new financial/event ledger or external-queue consumer.

## 4. Shared client and notification vertical slice

Acceptance: one tab/context connection, bounded backoff/poll fallback, visibility/offline/unmount cleanup, honest status and safe notification count fan-out.

Files: shared provider/hook/controller, AppShell, focused shared client tests (maximum about 5 files). Verification: focused fake EventSource/timer tests and two-subscriber propagation. Depends on 3. Status-copy additions sent to lead, not shared-i18n edits.

## 5. Delivery consumers, slice A

Acceptance: available jobs and driver management use provider plus existing authorized GET; reconnect does not reject first frame; no mutation replay or stale scope emission.

Files: AvailableDeliveryJobs, ManageDriversPanel, focused component tests (maximum about 4 files). Verification: focused connect/reconnect/readiness/assignment tests. Depends on 4.

## 6. Delivery consumers, slice B

Acceptance: driver detail map and receiving tracking use the same connection; private telemetry remains in their existing authorized read; disconnect/read failure keeps honest stale display and retries safely.

Files: DriverLiveMap, DeliveryTrackingPanels, focused tests (maximum about 4 files). Verification: focused role/privacy/offline/cleanup tests. Depends on 5.

## Checkpoint: working stream consumers

- [x] All updated widgets share one appropriate tab connection.
- [ ] Independent review confirms current read permissions and assignment checks remain intact.

## 7. Other required view invalidations, small domain slices

Acceptance: request/approval/dashboard and budget/Wallet/catalog updates affect only eligible active views; typed fields, quantities, branch/filter selection, focus/scroll survive; no full-page reload or global refresh storm.

Files: view coordinator plus appropriate consumer(s) and focused tests, split into at most about 5 files per slice. Verification: focused preservation/authorization/fan-out tests and lead-controlled real-browser checks. Depends on 4; coordinate catalog/UI ownership with lead.

## 8. Review and release checkpoint

- [ ] Focused tests and independent code review complete.
- [x] Local browser one-connection, fallback, auth-loss cleanup and dirty-filter preservation measured with public demo fixtures.
- [ ] Staged real-auth/native revocation and deployment recovery acceptance measured by lead.
- [ ] Lead runs required exact-head gates serially and controls deployment/production browser acceptance.
- [x] No unsupported instant/replay/zero-downtime claim, no secret-bearing evidence.

No heavy build/native/full-E2E test, production change, provider send, restart, browser or migration is authorized to this agent by these checklist items.
