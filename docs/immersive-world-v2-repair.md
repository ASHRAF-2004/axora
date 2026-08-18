# Immersive World V2 repair contracts

## Appearance and company branding

The current application supports exactly `light` and `dark` through the
appearance contract. Public first paint uses the SSR-readable
`axora_appearance` cookie, while authenticated shells resolve the user's
Light/Dark database preference before rendering. The historical Aurora, Solar,
Ember and Midnight values survive only in forward-migration compatibility logic.

Company shells remain scoped with `data-tenant-theme="company"`. Their reviewed
logo-derived brand identity is authoritative in both modes: Light selects the
approved light surface/text tokens and Dark selects the approved dark
surface/text tokens. Appearance never replaces semantic danger, warning,
success or tenant-identity colors.

## Operational map

The controlled MVP map is a self-hosted MapLibre style backed by a pinned,
ODbL-licensed OpenStreetMap Geofabrik derivative with roads and local labels for
Klang Valley, Putrajaya and Cyberjaya. The live route and authorized driver
marker are application-owned overlays. Missing configuration, source failure or
locations outside declared coverage display an honest localized unavailable
state. Natural Earth is retained only as a regional fallback and is never
presented as operational street navigation.

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
