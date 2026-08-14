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

`NEXT_PUBLIC_AXORA_MAP_STYLE_URL` may select a reviewed MapLibre style used by
the owner-only live map. The configured style must be production-supported or
self-hosted and its sources must declare all legally required attribution; the
public OpenStreetMap community tile endpoint is not an approved production
dependency. Without an external provider, Axora uses the genuine self-hosted
`/maps/axora-operational-style.json` regional basemap. Its country and
populated-place sources are Natural Earth public-domain GeoJSON, while the
authorized driver marker and route remain application-owned overlays. This is
honest regional operational context, not street-level navigation. An unusable
style produces a localized unavailable state rather than a blank rectangle.

## Live transport

Authenticated driver views use bounded authoritative database snapshot polling
transported over private no-store SSE. This provides near-live updates without
refresh, but it is not database-event push. Each event has a content-derived
version and monotonic connection sequence, reconnects begin with an
authoritative snapshot, stale or duplicate events are ignored, native
EventSource reconnection is retained, and browser polling is used only when
EventSource is unavailable. Streams and pollers stop while hidden and on
unmount. Session loss closes the stream on the next authorized snapshot attempt.
