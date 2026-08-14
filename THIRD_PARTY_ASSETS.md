# Third-party asset manifest

All runtime assets listed here are self-hosted. Axora makes no runtime request to an asset host.

## Semantic 3D models

Downloaded on 2026-08-14 from the canonical Kenney asset pages. Kenney confirms that assets on these pages are released under **CC0 1.0 Universal**. Source meshes were converted to self-contained binary glTF, external palettes were embedded as WebP, geometry was quantized with Meshopt compression, unused scene data was removed, and files were renamed for their Axora semantic use. Named van nodes were retained for wheel and door animation.

| Axora asset | Creator | Canonical source | Licence | Repository path | Modifications |
| --- | --- | --- | --- | --- | --- |
| Request clipboard, invoice document | Kenney | https://kenney.nl/assets/furniture-kit | CC0 1.0 | `public/immersive/models/request.glb`, `invoice.glb` | Converted to GLB, scene data trimmed |
| Approval control, payment terminal, shield and route flag | Kenney | https://kenney.nl/assets/prototype-kit | CC0 1.0 | `public/immersive/models/approve.glb`, `pay.glb`, `shield.glb`, `flag.glb` | Converted to GLB, palettes embedded, geometry compressed |
| Prepared and completed parcels | Kenney | https://kenney.nl/assets/furniture-kit | CC0 1.0 | `public/immersive/models/prepare.glb`, `complete.glb` | Converted to GLB, scene data trimmed |
| Delivery van | Kenney | https://kenney.nl/assets/car-kit | CC0 1.0 | `public/immersive/models/deliver.glb` | Converted to GLB, palette embedded, geometry compressed; wheel and door nodes retained |
| Tracking route and road | Kenney | https://kenney.nl/assets/city-kit-roads | CC0 1.0 | `public/immersive/models/track.glb`, `road.glb` | Converted to GLB, scene data trimmed |
| Secure vault and network dish | Kenney | https://kenney.nl/assets/space-kit | CC0 1.0 | `public/immersive/models/vault.glb`, `network.glb`, `track.glb` | Converted to GLB, scene data trimmed, geometry compressed |
| Role character | Kenney | https://kenney.nl/assets/blocky-characters | CC0 1.0 | `public/immersive/models/person.glb` | Converted to GLB, scene data trimmed |
| Workspace and company objects | Kenney | https://kenney.nl/assets/city-kit-commercial | CC0 1.0 | `public/immersive/models/workspace.glb`, `company.glb` | Converted to GLB, palette embedded where present, geometry compressed |

Licence: https://creativecommons.org/publicdomain/zero/1.0/

Exact self-hosted model inventory:

`public/immersive/models/request.glb`
`public/immersive/models/approve.glb`
`public/immersive/models/pay.glb`
`public/immersive/models/invoice.glb`
`public/immersive/models/prepare.glb`
`public/immersive/models/deliver.glb`
`public/immersive/models/track.glb`
`public/immersive/models/complete.glb`
`public/immersive/models/person.glb`
`public/immersive/models/workspace.glb`
`public/immersive/models/company.glb`
`public/immersive/models/shield.glb`
`public/immersive/models/vault.glb`
`public/immersive/models/network.glb`
`public/immersive/models/flag.glb`
`public/immersive/models/road.glb`

## Interface sounds

| Axora asset | Creator | Canonical source | Licence | Repository path | Modifications |
| --- | --- | --- | --- | --- | --- |
| Request, approval, payment, invoice, preparation, tracking, completion and theme cues | Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 | `public/immersive/sounds/*.ogg` except delivery files | Selected, renamed, normalized by the source pack |
| Short delivery engine cue | GGBotNet | https://opengameart.org/content/car-sound-effects-pack-low-quality | CC0 1.0 | `public/immersive/sounds/delivery-engine.ogg` | Trimmed selection, no looping |
| Delivery door cue | looneybits | https://opengameart.org/content/cardoorsfx | CC0 1.0 | `public/immersive/sounds/delivery-door.wav` | Selected closing cue and renamed |

Exact self-hosted sound inventory:

`public/immersive/sounds/request.ogg`
`public/immersive/sounds/approve.ogg`
`public/immersive/sounds/pay.ogg`
`public/immersive/sounds/invoice.ogg`
`public/immersive/sounds/prepare.ogg`
`public/immersive/sounds/delivery-engine.ogg`
`public/immersive/sounds/delivery-door.wav`
`public/immersive/sounds/track.ogg`
`public/immersive/sounds/complete.ogg`
`public/immersive/sounds/theme.ogg`

## Catalogue category artwork

All 28 category files are optimized AVIF/WebP derivatives of the **3dicons v1** CC0 collection by Vijay Verma, downloaded on 2026-08-14 from https://3dicons.co/collection/b68cf8-v1. They are stored under `public/catalog/categories/`, resized for responsive category cards, and stripped of nonessential metadata. No recognizable brand marks or people are present.

Licence: https://creativecommons.org/publicdomain/zero/1.0/
