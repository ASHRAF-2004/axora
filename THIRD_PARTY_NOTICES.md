# Third-party notices

## Self-hosted public and map assets

Category artwork, map datasets and map fonts are recorded per file in
`third-party-assets.json` and summarized in `THIRD_PARTY_ASSETS.md`. Their
licence records are retained at `third_party/licenses/CC0-1.0.txt`,
`third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md`,
`third_party/licenses/ODbL-1.0.txt` and `third_party/licenses/OFL-1.1.txt`.

## MapLibre GL JS

Authorized operational map views use the self-hosted MapLibre GL JS runtime.
Map data provenance is separate and is recorded in `third-party-assets.json`.
The controlled MVP operational layer is derived from OpenStreetMap data
distributed by Geofabrik under ODbL 1.0 and always displays
`© OpenStreetMap contributors`. MapLibre labels use Noto Sans Regular glyphs
under SIL OFL 1.1. Natural Earth remains only a public-domain regional fallback.

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
