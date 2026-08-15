# Third-party asset manifest

Axora self-hosts every runtime model, sound, category image, map dataset and map glyph. The authoritative one-entry-per-file inventory is [`third-party-assets.json`](third-party-assets.json); `npm run assets:validate` verifies paths, source and runtime checksums, licence records, unique provenance, licence-file coverage and the absence of runtime asset hotlinks.

## Provenance decisions

- Semantic models are licensed Kenney CC0 assets. Each GLB records its original pack filename and both original and repository checksums.
- `public/immersive/models/track.glb` and `network.glb` both derive from `satelliteDish.glb` in Kenney Space Kit. City Kit Roads is the sole source for `road.glb`; the former contradictory attribution is removed.
- Stage and theme cues use individual Kenney Interface Sounds entries. Delivery engine and door cues have separate OpenGameArt CC0 provenance.
- Every AVIF and WebP category derivative maps to one exact 3dicons v1 item and dynamic colour render, not merely to the collection as a group.
- The operational MVP street map is a self-hosted derivative of the pinned 2026-08-14 Geofabrik Malaysia, Singapore and Brunei OpenStreetMap extract under ODbL 1.0. Coverage is explicitly limited to Klang Valley, Putrajaya and Cyberjaya; OSM attribution is always visible.
- Map labels use two unchanged Noto Sans Regular MapLibre glyph ranges from Protomaps basemaps-assets under SIL OFL 1.1.
- The Natural Earth regional fallback was regenerated from canonical 5.1.1 Admin 0 Countries and 5.1.2 Populated Places archives. Source-archive and deterministic derivative checksums are now pinned; no unavailable checksum remains.

## Licence records

- [`third_party/licenses/CC0-1.0.txt`](third_party/licenses/CC0-1.0.txt)
- [`third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md`](third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md)
- [`third_party/licenses/ODbL-1.0.txt`](third_party/licenses/ODbL-1.0.txt)
- [`third_party/licenses/OFL-1.1.txt`](third_party/licenses/OFL-1.1.txt)

No asset requires attribution, but Axora retains visible map provenance and this manifest for reviewability. No asset has a Non-Commercial, No-Derivatives, Editorial or unclear licence.
