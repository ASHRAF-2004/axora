# Third-party notices

## Txema Albero 3D portfolio reference

The Axora public experience was architecturally inspired by the interaction
quality of Txema Albero's open-source 3D portfolio. Axora uses original
procurement content and independently implemented scenes, controls, themes and
motion; no personal content, images, models, audio or identity assets are
distributed here.

- Project: https://github.com/Txemalon/3d-portfolio
- Reference commit: `52cfcb8f8e1c192d9dc44edb3cb70feae79d49d7`
- License: MIT
- Copyright: Copyright (c) 2026 Txema Albero
- Full license text: `licenses/TXEMA-3D-PORTFOLIO-MIT.txt`

## Three.js and React Three Fiber ecosystem

The public semantic scenes use Three.js through React Three Fiber and Drei.
Models and sounds loaded by those scenes are self-hosted and documented per
file in `third-party-assets.json`.

- Three.js: https://github.com/mrdoob/three.js, version 0.185.1, MIT
- React Three Fiber: https://github.com/pmndrs/react-three-fiber, version 9.7.0, MIT
- Drei: https://github.com/pmndrs/drei, version 10.7.8, MIT

## Meshoptimizer WebAssembly decoder

Three.js ships a Meshopt decoder module used by Drei's `useGLTF` path to decode
compressed, self-hosted glTF assets. The installed dependency metadata records
meshoptimizer 1.1.1; the bundled decoder identifies meshoptimizer 1.1 and its
MIT terms in its source header.

- Project: https://github.com/zeux/meshoptimizer
- License: MIT
- Copyright: Copyright (c) 2016-2026 Arseny Kapoulkine
- Full license text: `licenses/MESHOPTIMIZER-MIT.txt`

## Immersive World V2 self-hosted assets

Runtime model, sound, category-artwork and Natural Earth dataset provenance is
recorded per file in `third-party-assets.json` and summarized in
`THIRD_PARTY_ASSETS.md`. The referenced CC0 and Natural Earth licence records
are retained at `third_party/licenses/CC0-1.0.txt` and
`third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md`.

## MapLibre GL JS

Authorized operational map views use the self-hosted MapLibre GL JS runtime.
Map data provenance is separate and is recorded in `third-party-assets.json`.

- Project: https://github.com/maplibre/maplibre-gl-js
- Version: 5.18.0
- License: BSD 3-Clause, with bundled third-party notices
- Full license text: `licenses/MAPLIBRE-GL-JS-BSD-3-CLAUSE.txt`

## Owner-supplied Axora artwork and email illustration

The Axora logo and the account-envelope illustration were supplied locally by
the Axora owner for this product. Production files are optimized local copies;
the application does not hotlink them. They are treated as owner-approved
project assets, not as public-domain or third-party community artwork. Their
use outside Axora requires a separate rights decision.

- Approved logo sources: retained as operator-controlled, Git-ignored generation
  inputs under `assets/brand/source/`; only reviewed production derivatives are distributed
- Email illustration: `public/email/account-setup/account-envelope.png`
- Production derivatives: `public/brand/` and `public/email/account-setup/account-envelope.png`
- Modification: format, size and transparency optimization only

## Lucide icon assets and React library

The application interface uses icons from the `lucide-react` package. The
approved Axora logo is owner-supplied artwork and is not derived from Lucide.

- Project: https://lucide.dev/
- Version: 1.25.0
- Licenses: ISC, with MIT terms for Feather-derived icons
- Full license text: `licenses/LUCIDE-ISC.txt`

## Noto fonts embedded in the user manuals

The generated English and Arabic PDF manuals embed subsets of Noto Sans and
Noto Sans Arabic from the Ubuntu `fonts-noto-core` package. The font software
is used without renaming or modification and is not sold separately.

- Project: https://github.com/notofonts
- License: SIL Open Font License 1.1
- License text: https://openfontlicense.org/open-font-license-official-text/

## axe-core Playwright accessibility checks

Browser-level accessibility regression tests use the development-only
`@axe-core/playwright` 4.12.1 integration from Deque. It is not shipped in the
production application image.

- Project: https://github.com/dequelabs/axe-core-npm
- License: Mozilla Public License 2.0
- License text: https://www.mozilla.org/MPL/2.0/

## Lighthouse development audit tooling

Lighthouse 12.8.2 is used only in continuous integration to generate mobile
and desktop performance, accessibility, best-practice and SEO evidence.

- Project: https://github.com/GoogleChrome/lighthouse
- License: Apache License 2.0
- Full license text: `licenses/LIGHTHOUSE-APACHE-2.0.txt`

## Tailscale client

The hybrid deployment image includes the Tailscale client and daemon to create
an authenticated private connection between the Render web service and the
Ubuntu PostgreSQL server.

- Project: https://github.com/tailscale/tailscale
- Version: 1.98.8
- License: BSD 3-Clause
- Full license text: `licenses/TAILSCALE-BSD-3-CLAUSE.txt`

## PDFKit document generator

The private document worker uses PDFKit 0.19.1 to generate versioned
procurement PDFs.

- Project: https://pdfkit.org/
- License: MIT
- Full license text: `licenses/PDFKIT-MIT.txt`

## DejaVu fonts embedded in generated documents

Generated English, Arabic and Malay procurement PDFs embed DejaVu Sans and
DejaVu Sans Bold without renaming or modification.

- Project: https://dejavu-fonts.github.io/
- License: Bitstream Vera license with DejaVu public-domain additions
- Full license text: `licenses/DEJAVU-FONTS.txt`
