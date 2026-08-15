# Third-party asset manifest

Axora self-hosts every runtime model, sound, category image and Natural Earth map dataset. The authoritative one-entry-per-file inventory is [`third-party-assets.json`](third-party-assets.json); `npm run assets:validate` verifies paths, runtime checksums, licence records, unique provenance, licence-file coverage and the absence of runtime asset hotlinks.

## Provenance decisions

- Semantic models are licensed Kenney CC0 assets. Each GLB records its original pack filename and both original and repository checksums.
- `public/immersive/models/track.glb` and `network.glb` both derive from `satelliteDish.glb` in Kenney Space Kit. City Kit Roads is the sole source for `road.glb`; the former contradictory attribution is removed.
- Stage and theme cues use individual Kenney Interface Sounds entries. Delivery engine and door cues have separate OpenGameArt CC0 provenance.
- Every AVIF and WebP category derivative maps to one exact 3dicons v1 item and dynamic colour render, not merely to the collection as a group.
- Operational map boundaries and places are a self-hosted Southeast Asia subset of Natural Earth 1:10m Cultural Vectors. Natural Earth attribution remains visible in the interface even though the data is public domain.
- The two Natural Earth source archives were not retained in this branch. Their derivative files have verified repository checksums, while the unavailable original-archive checksums are explicitly recorded rather than fabricated. Obtaining and pinning the exact source-archive hashes remains a provenance blocker.

## Licence records

- [`third_party/licenses/CC0-1.0.txt`](third_party/licenses/CC0-1.0.txt)
- [`third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md`](third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md)

No asset requires attribution, but Axora retains visible map provenance and this manifest for reviewability. No asset has a Non-Commercial, No-Derivatives, Editorial or unclear licence.
