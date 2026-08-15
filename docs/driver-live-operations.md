# Driver live operations

## Assignment model

A finalized paid request creates one idempotent `AWAITING_ASSIGNMENT` delivery
job. Active Delivery Guys with `delivery.claim` see the available pool and use
an atomic database claim. A row lock, active-assignment checks, command ID and
unique assignment constraints ensure one winner. Platform Owners monitor and
may release a genuinely stuck assignment with an audited reason; normal work
does not depend on owner assignment.

## Location lifecycle

Only the active assigned driver can publish a point through the existing
`axora_record_delivery_location` capability. Browser geolocation starts after
an explicit user action during an active tracking session. It stops when the
session ends, the component unmounts, permission is withdrawn, or the user
signs out. Raw points are immutable, carry a bounded 1-90 day retention date
(30 days by default), and are removable only through
`axora_purge_expired_delivery_locations`.

Platform driver management may read retained raw points. Company tracking is
rebuilt through the company capability and then defensively transformed in the
application: internal job states become Preparing/Out for delivery/Delivered/
Completed, raw coordinates are removed, raw-retention configuration is removed
and only a privacy-safe ETA/status is returned.

## Map source

The owner-only live map is release-gated by a browser-visible provider contract
generated from root-owned `deploy.env`. Set all of the following only after a
production-capable dataset and its licence/attribution have been reviewed:

* `AXORA_DRIVER_MAP_OPERATIONAL_READY=true`
* `NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID`
* `NEXT_PUBLIC_AXORA_MAP_PROVIDER_NAME`
* `NEXT_PUBLIC_AXORA_MAP_STYLE_URL`
* `NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION`
* `NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL`

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

Until an approved provider/dataset is configured, `preflight.sh` fails with an
explicit release blocker and the UI shows a localized unavailable state. It
does not render an empty rectangle or present the Natural Earth overview as
street navigation. A configured style is accepted only when it has usable
MapLibre sources, road/local-label or raster context, declared attribution,
successful source loading, and reviewed metadata declaring
`axora:map-purpose=operational-street`. Driver markers and route overlays remain
application-owned.

## Live transport

Authenticated driver views use bounded authoritative database snapshot polling
transported over private no-store SSE. This provides near-live updates without
refresh, but it is not database-event push. Each event has a content-derived
version and monotonic connection sequence, reconnects begin with an
authoritative snapshot, stale or duplicate events are ignored, native
EventSource reconnection is retained, and browser polling is used only when
EventSource is unavailable. Streams and pollers stop while hidden and on
unmount. Session loss closes the stream on the next authorized snapshot attempt.
