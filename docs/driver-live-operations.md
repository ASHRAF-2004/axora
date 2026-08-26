# Delivery Agent live operations

## Assignment model

A finalized paid request creates one idempotent `AWAITING_ASSIGNMENT` delivery
job. Active Delivery Agents with `delivery.claim` see the available pool and use
an atomic database claim. A row lock, active-assignment checks, command ID and
unique assignment constraints ensure one winner. Platform Owners monitor and
may release a genuinely stuck assignment with an audited reason; normal work
does not depend on owner assignment.

The claim mutation and follow-up reads are separate outcomes. The browser keeps
only the pending job/command identifiers, including across reloads and tabs,
and uses the actor-bound `axora_driver_claim_result` projection to reconcile a
lost response. A shared-pool read never reclassifies an uncertain claim as a
failure. Delivery workflow, acquisition, evidence and OTP commands use the same
exact-result principle; recipient text, proof files, OTP values and notes are
never stored in the browser reconciliation queue.

## Location lifecycle

Only the active assigned Delivery Agent can publish a point through the existing
`axora_record_delivery_location` capability. Browser geolocation starts after
an explicit user action during an active tracking session. Pausing immediately
stops the browser watch without discarding buffered points; resuming is an
explicit action and restores the same canonical session. Location collection
also stops when the job becomes terminal, the component unmounts, permission is
withdrawn, or the user signs out. Raw points are immutable, carry a bounded
1-90 day retention date (30 days by default), and are removable only through
`axora_purge_expired_delivery_locations`.

The server-side pause/resume transition targets are idempotent. A non-sensitive
session marker remembers that a resume is required if a pause response is lost;
browser geolocation cannot restart until the session is authoritatively active.
The just-completed job remains visible for 24 hours through a status-only
Delivery Agent projection, with no destination, recipient, proof-file, supplier
or acquisition payload and with no terminal workflow controls.

Platform driver management may read retained raw points. Company tracking is
rebuilt through the company capability and then defensively transformed in the
application: internal job states become Preparing/Out for delivery/Arrived/
Delivered/Completed, active coordinates are always rounded to three decimal places with
at least 150-metre accuracy, raw-retention configuration and actor identifiers
are removed, and no coordinate text is rendered. Terminal tracking is
status-only and contains no last position. Before claim, authorized company
receivers see a Preparing card derived from the unassigned job with no agent
identity or live telemetry; the claimed tracking session replaces it.

## Map source

The Delivery Agent and privacy-safe company maps are release-gated by a
browser-visible provider contract
generated from root-owned `deploy.env`. Set all of the following only after a
production-capable dataset and its licence/attribution have been reviewed:

* `AXORA_DRIVER_MAP_OPERATIONAL_READY=true`
* `NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID`
* `NEXT_PUBLIC_AXORA_MAP_PROVIDER_NAME`
* `NEXT_PUBLIC_AXORA_MAP_STYLE_URL`
* `NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION`
* `NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL`
* `NEXT_PUBLIC_AXORA_MAP_COVERAGE_BOUNDS`
* `NEXT_PUBLIC_AXORA_MAP_COVERAGE_LABEL`

The style URL and all style sources must be same-origin assets under `/maps`.
They are public browser configuration and must not contain a private provider
credential. A hosted provider therefore requires an approved same-origin tile
publication/proxy design or an approved self-hosted regional vector/raster
dataset. The public OpenStreetMap community tile endpoint is not an approved
production backend.

`/maps/axora-operational-style.json` is retained only as an offline/regional
Natural Earth overview. Despite its legacy filename, metadata marks it
`regional-overview-only`; runtime and deployment readiness reject it as an
operational street map. It has country and populated-place context, but not the
roads or local labels required at operational zoom.

The controlled MVP uses the self-hosted OSM-derived Klang Valley dataset
documented in `docs/mvp-operational-map.md`. Outside the declared coverage the
UI shows a localized unavailable state rather than pretending the map is
complete. `preflight.sh` fails if this provider contract is missing, mismatched,
or replaced by an E2E fixture. A configured style is accepted only when it has usable
MapLibre sources, road/local-label or raster context, declared attribution,
successful source loading, and reviewed metadata declaring
`axora:map-purpose=operational-street`. Delivery Agent markers and route
overlays remain application-owned.

The operational map displays the saved destination and latest accepted
Delivery Agent position together. Without an approved routing engine, the
overlay is a dashed direct-distance estimate and is explicitly labelled as not
a road route. Waze and Google Maps links remain the turn-by-turn fallback for
the Delivery Agent; the company view does not receive those operational links.

## Live transport

Authenticated Delivery Agent and company views use bounded authoritative
database snapshot polling
transported over private no-store SSE. This provides near-live updates without
refresh, but it is not database-event push. Each event has a content-derived
version and monotonic connection sequence, reconnects begin with an
authoritative snapshot, stale or duplicate events are ignored, native
EventSource reconnection is retained, and browser polling is used only when
EventSource is unavailable. Streams and pollers stop while hidden and on
unmount. Session loss closes the stream on the next authorized snapshot attempt.
