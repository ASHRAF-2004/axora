# Immersive World V2 repair contracts

## Atmospheres and company branding

`data-atmosphere` is the single document-level atmosphere contract. Public and
authentication pages use the locally saved Aurora, Solar, Ember or Midnight
preference. Axora staff preferences are stored per account in PostgreSQL.
Customer-company shells do not expose the selector: reviewed logo-derived
tokens are scoped on `data-tenant-theme="company"` and override document
atmosphere tokens without changing semantic danger, warning or success colours.

## Operational map

The default map is a self-hosted MapLibre style backed by Natural Earth public
domain country and populated-place GeoJSON. It provides honest regional context
without a remote tile dependency or browser credential. The live route and
authorized driver marker are application-owned overlays. It is an operational
location display, not turn-by-turn street navigation. A deployment may set
`NEXT_PUBLIC_AXORA_MAP_STYLE_URL` to a reviewed production MapLibre style; a
missing or unusable style displays a localized unavailable state.

## Near-live transport

The public visitor counter uses bounded authoritative HTTP snapshot polling, not
database-event push and not EventSource. It polls at most once every 30 seconds
during normal visible/online use, pauses while hidden or offline, aborts stale
requests, backs off to two minutes after failures, and applies only monotonic
database counter versions. The retired visitor EventSource endpoint returns 204
so previously loaded clients stop reconnecting instead of generating a 429 loop.

## Visitor identity and privacy

The versioned, signed, HTTP-only anonymous claim cookie is the only durable
anonymous identity. Version 1 cookies rotate in place to version 2 without
changing the claim token. Network-derived values are hourly rotating HMACs in
short-lived abuse-rate buckets only and are never sent to claim/snapshot database
capabilities. Migration 092 removes the historical network mapping table and
network/device fingerprint columns while preserving claims and totals. A choice
persists for this browser while its signed credential remains available for up
to one year. Clearing site data or changing browsers/devices can produce another
anonymous choice; Axora does not use fingerprinting to pretend otherwise.

## Company deletion ownership matrix

| Classification | Examples | Result |
| --- | --- | --- |
| Cascade delete | Draft requests, budgets, branches, memberships, tokens, invitations, branding, notifications and pending tenant outbox work | Deleted in explicit dependency order for an unprotected disposable company. |
| Hard delete | The unprotected company parent and disposable tenant users after owned children are removed | Removed transactionally; all foreign keys are checked for residue. |
| Retain with access revoked | Finalized invoices, paid payment evidence, completed deliveries, proof of receipt and required audit evidence | Company is archived, assignments and credentials are revoked, and records leave normal tenant reads. |
| Anonymize and retain | Identifiers explicitly permitted by an approved retention policy | Cleanup task remains tracked until external/file anonymization completes. |
| Block | Active protected workflow that cannot be safely archived under the current policy | Command reports the objective blocker without partial deletion. |

Every deletion uses a unique command ID, typed mode-specific confirmation,
advisory lock, exact impact preview, tombstone and idempotent result. File, cache
and search cleanup is recorded as resumable external work; success is not claimed
until required cleanup is complete.

## Evidence and performance

CI uploads the browser screenshots, interaction tour, Lighthouse reports and
bundle/model/texture/audio report as a 14-day pull-request artifact. Lighthouse
12.8.2 is an Apache-2.0 development-only audit dependency compatible with the
repository's Node 20 CI runtime; it is not shipped in the production application.
