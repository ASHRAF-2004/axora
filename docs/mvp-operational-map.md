# Controlled MVP operational map

Status: production map for the controlled three-company MVP. Effective 2026-08-16.

Axora serves a same-origin MapLibre style backed by an OSM-derived Geofabrik
extract. Runtime coverage is deliberately bounded to longitude 101.35–102.00
and latitude 2.70–3.45: Klang Valley, Putrajaya and Cyberjaya. This is not a
Malaysia-wide map. A driver outside those bounds receives a localized **Outside
MVP map coverage** state while the authoritative timestamp and accuracy remain
visible.

The primary source is the Geofabrik Malaysia, Singapore and Brunei snapshot
published 2026-08-14 under the Open Database License 1.0. Axora retains major
road classes and local place labels needed at operational zoom. A bounded
2026-08-24 OpenStreetMap API extract adds building footprints around the three
supported Cyberjaya MVP delivery-search results. Selected delivery places open
at building-level zoom, with footprints, outlines and available building names.
The UI displays
`© OpenStreetMap contributors` linked to the OSM copyright page. No public OSM
community tile server, remote asset host or browser credential is used.

The exact source and runtime hashes, conversion details, font glyph provenance,
licence records and restrictions are in `third-party-assets.json`. Reproduction
of the regional assets is performed with `scripts/maps/regenerate-map-assets.sh`
and the pinned Go module in `scripts/maps/generate-mvp-map`. The bounded building
asset is reproduced with `scripts/maps/generate-osm-building-extract.mjs` from
the source bounds recorded in the GeoJSON metadata and third-party asset record.

Before general availability, Axora must approve broader geographic coverage or
a production provider. This limitation does not affect customer privacy: only
authorized Platform Owners receive raw driver coordinates; customer tracking
continues to expose privacy-safe status and ETA only.
