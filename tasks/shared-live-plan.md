# Plan: shared live data through existing snapshot SSE

Base: `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`, branch `codex/recovery-shared-live`. Lead approved snapshot-resync design and each new bounded aggregate scope. Implementation and focused local-browser proof are complete; final integrated native/release gates and production acceptance remain pending under the lead's control. No production service/provider/queue action is delegated here.

## Current architecture and gaps

| Area | Existing path | Finding / safest reuse |
| --- | --- | --- |
| Transport | `src/lib/server-event-stream.ts` | Private no-store SSE, 5s minimum poll interval, initial authoritative snapshot, SHA256 content version, 55s lifetime. Reuse and harden; no new ledger. |
| Notification stream | `api/notifications/summary/stream`, AppShell | Actor captured once; separate EventSource. Existing authorized notification summary has a durable versionToken, but capturedAt changes the outer hash every poll. |
| Delivery streams | `api/driver/jobs/live`, `api/drivers/live`, `api/drivers/[driverId]/live`, `api/receiving/delivery-tracking/live` | Same helper, separate component connections. Existing capability loaders enforce live assignment visibility; session is not reloaded between emissions. |
| Reconnect | All stream clients compare envelope sequence | Transport sequence resets to 1 per GET. Several clients retain old sequence. ManageDriversPanel initializes from a DB timestamp sequence but receives transport sequence. Reconnect snapshots can be rejected. |
| Resource bounds | Helper timers / controller queue | setInterval permits overlapping loaders; no heartbeat, Last-Event-ID validation, desiredSize guard, payload cap or connection cap. Abort listener is not removed; late loader completion can enqueue after close. |
| Durable state | Authorized repositories and SQL capabilities | Notifications, requests/approval state, dashboard, budgets, Wallet, delivery/tracking and catalog already read committed canonical data. These can provide snapshot resynchronization after restart without persisted SSE replay. |
| External integration events | Migration 129/132 | Dedicated worker projection, ten event types, checkpoints and retention. Does not cover all browser domains; privileged external delivery queues must remain isolated. Not a browser invalidation broker. |
| UI coverage | Existing SSE widgets, NotificationInboxSync | Other required views have no shared subscription. Some views are server-rendered; need scoped/debounced refresh and unsaved-form/focus protection, not global router.refresh. |
| Fallback | Existing component pollers | Visibility-aware GET polling is available, but error/reconnect recovery differs across widgets. Some only poll when EventSource is unsupported. Unify connection status and retry/fallback policy. |
| Kill switch | No existing SSE switch found | New narrow server switch should return 204 for streams and leave authenticated reads/commands and polling available. Lead owns deployment environment forwarding if needed. |

Isolated read-only source execution proves: initial sequence 1 followed by changed-version reconnect sequence 1 fails the current retained-client `next > previous` predicate. Separately, otherwise identical notification state with only capturedAt changed produces a different outer transport version. No application source was edited for either proof.

## Proposed compact contract

1. Retain authorized canonical DB snapshot readers, not a second financial/event ledger. Snapshot-based near-live transport is explicitly described as such. No schema migration or LISTEN connection is proposed.
2. Add one canonical same-origin live route and one tab/context provider. Migrate the five widget connections onto it; old routes can remain bounded compatibility adapters, not additional connections in the updated UI. Topic registration is a fixed allowlist with a small maximum; optional company/branch/driver context must pass the existing authorized reader, never just a client claim.
3. Stream stable authorized domain-version/invalidation hints, and the already-safe notification unread count when useful. Detail values stay behind their existing authorized reads. Do not put private cost, proof paths, coordinates, unauthorized resource IDs or secrets into a broad shared envelope.
4. Explicit snapshot resynchronization on every connect/reconnect: validate Last-Event-ID syntax/length, but do not claim replay from a content hash. Missing, stale or unknown cursors all obtain a fresh authorized snapshot. A new transport epoch plus monotonic per-connection sequence prevents reset/duplicate/out-of-order rejection across reconnects. Local epoch/counters are transport-only, never canonical shared state.
5. Re-run the existing live session accessor and permissions for every load and before emission. Authentication loss closes the stream without business data; permission/assignment loss drops or rejects the affected topic. Repository authorization remains authoritative, including explicit DENY and tenant/branch/assignment scope.
6. Use a serialized loader loop with abort/closed checks after awaits. Bound lifetime, message bytes, buffered bytes, active topics, per-instance connections and same-user streams. Heartbeat about 10–15s even if data is unchanged. Slow readers close and resynchronize; no per-browser DB connection is retained and no external queue is consumed.
7. Provider owns reconnect/backoff, hidden/offline pause, cleanup, fallback GET polling and honest stale/reconnecting state. Reconnect only repeats reads, never commands. Consumers receive the same eligible change independently.
8. Reuse stable authorized versionToken or allowlisted visible business projection, excluding capture/transport timestamps. Read only active view domains. Broad list readers are currently unpaginated: do not turn an unbounded all-record payload into a periodic wire event or hash private fields. Prefer bounded existing capability snapshots or an aggregate over already-authorized visible rows. Any new SQL scope must receive specific review before implementation.
9. Requests/approvals/dashboard/budgets/Wallet/catalog need view-scoped invalidation consumers. Preserve typed quantity/form state, filter/branch context, focus and scroll. Debounce/coalesce safe RSC refresh; defer it while an active form is dirty. Existing client widgets can refetch and update their own display state instead. No full-page reload/refresh storm.
10. No proxy edit is justified by current evidence. Verify staged and lead-controlled production streaming over the existing Caddy/Tunnel path before changing configuration.

## Primary-source research

- Native EventSource supports URL and withCredentials, not arbitrary authorization headers. Same-origin session cookies remain the mechanism; UTF-8 framing, Last-Event-ID, retry, HTTP 204 shutdown and periodic comments are specified by the [WHATWG SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html). Use a shared per-tab source and explicit resync, never URL tokens.
- [Next.js Route Handler documentation](https://nextjs.org/docs/app/api-reference/file-conventions/route#streaming) supports Web Request/Response and direct ReadableStream responses. Use the existing Node runtime and request abort rather than another server stack.
- [Node 24 Web Streams documentation](https://github.com/nodejs/node/blob/v24.x/doc/api/webstreams.md) describes cancel, queue strategy/highWaterMark, and desiredSize. Check pressure and cleanup; do not enqueue without limits after asynchronous work.
- [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html) is session registration, cleared at disconnect; listener setup has a documented snapshot race. [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) reaches all current listeners after commit and is not durable replay. Snapshot-only design avoids a new listener lifecycle; a future optimization must retain authoritative resync and subscribe-before-snapshot ordering.
- [Caddy reverse_proxy streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming) automatically flushes text/event-stream; adding flush_interval -1 blindly is unnecessary and changes disconnect cancellation behavior. Repository production Caddyfile uses encode and reverse_proxy without response_buffers/stream_timeout overrides; image pin is 2.11.4. Verify actual bytes before narrowing any proxy edit.
- [Cloudflare connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) explicitly direct Tunnel users to [Tunnel origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/). General proxy timeout numbers are not proof of actual Tunnel configuration. Repository cloudflared pin is 2026.7.3. Do not change Cloudflare/Tunnel settings from this task.

## Ordered slices

- [x] Inventory, source regression proof and primary documentation.
- [x] Lead review of snapshot-resync architecture, reader bounds and view ownership.
- [x] Harden shared transport and cover reconnect/cancellation/backpressure.
- [x] Implement authorized version snapshot contract, cursor validation and switch/read fallback.
- [x] Implement shared client connection/provider and migrate notification slice.
- [x] Migrate delivery widgets in two small slices without changing commands or assignment rules.
- [x] Add scoped protected invalidation for remaining required views; coordinate catalog/UI owner and localization.
- [x] Bounded focused local-browser recovery proof (public demo fixtures only).
- [ ] Final independent review of exact candidate.
- [ ] Lead serial exact-head release gates and production acceptance.

## Risks and explicit boundaries

- Polling rate/query cost: only registered domains, serialized loads, bounded reader output/query, no per-widget duplication. Request/display readers do not all share one database transaction, so a topic refresh should only claim its own authoritative state, not global cross-domain atomicity.
- Revocation: never trust the actor captured at open or a client topic/context. Fresh session/permissions plus existing live capability checks precede all data delivery.
- Cursor/restart: only explicit current-state resync is claimed. Historical event replay and intermediate transient states are not invented; canonical history remains in existing authorized workspaces.
- Unsaved input: refresh only scoped safe displays, with dirty-form/focus guards and tests for quantity, approval reason, filters, branch and scroll. Do not clear customer cart storage or replay mutations.
- New i18n: the lead supplied English/Arabic/Malay status strings; implemented in the approved dedicated live-updates-i18n module, not shared catalogs.

Existing delivery/budget/approval/Wallet capabilities may internally form large authorized snapshots. The new stream checks its internal serialized snapshot cap and emits only fixed-size hints, but does not claim to have made those existing database capabilities constant-cost. New request and catalog queries return fixed-size aggregates under the exact current authorized read scope. Operational connection/in-flight limits are process-local quotas, not distributed canonical state.

## Native integration placement

`tests/shared-live-native-postgres.test.ts` must run through the existing isolated native runner before `existing-user-management-native-postgres.test.ts`, which retires seeded owner accounts. It requires `AXORA_NATIVE_POSTGRES_INTEGRATION=true`, all existing native DB variables, and the exact `axora_native_ci` guard. Execution is pending the lead's final integrated native gate (including migration 139); skipped default execution is not native proof.
- Financial/RLS uncertainty, unexpected permissions or need for a migration: stop implementation and report to lead. No migration number is reserved.

## Verification scope

Focused transport/route/client/component tests during development only. Required coverage includes reconnect after process restart, same-version heartbeat, changed-version fan-out to two subscribers, snapshot race, malformed/unknown cursor, duplicate/out-of-order frames, aborted/slow requests, logout/expiry/suspension/assignment loss/DENY, customer/CAM commercial privacy, unauthorized context, kill switch and fallback, bounded reconnect/visibility cleanup, and unsaved form/quantity/filter/focus preservation. Lead owns all production browser actions and final heavy gates.

Focused candidate evidence: 62 Vitest tests passed across 11 focused files, with the 3 native tests intentionally skipped absent the isolated gate environment. Changed-file ESLint and non-incremental TypeScript checking passed. A fresh owned local dev server (no reuse, no retries) passed all 4 real Chromium browser checks: one shared EventSource/no legacy duplicate route, read-only polling fallback, authorization-loss cleanup, and dirty-filter/focus preservation before safe resync. The owned server stopped and its port was absent afterwards. This is local demo-browser proof, not production real-auth, native DB execution, immutable-image staging or deployed proxy proof.
