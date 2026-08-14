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

`NEXT_PUBLIC_AXORA_MAP_STYLE_URL` selects the reviewed MapLibre style used by
the owner-only live map. The configured style must be a production-supported
or self-hosted style whose sources declare all legally required attribution;
the public OpenStreetMap community tile endpoint is not an approved production
dependency. When no provider style is configured, Axora uses the self-hosted
`/maps/axora-operational-style.json` route-only fallback and makes the missing
geographic basemap explicit rather than contacting a third party.

## Live transport

Authenticated driver views use private no-store SSE snapshots. Each event has
a monotonic sequence, reconnects begin with an authoritative snapshot, stale
or duplicate events are ignored, native EventSource reconnection is retained,
and safe polling is used only when EventSource is unavailable. Streams and
pollers stop while hidden and on unmount. Session loss closes the stream on the
next authorized snapshot attempt.
