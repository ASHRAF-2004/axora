# Approved Axora brand assets

This folder contains optimized production derivatives of the approved Axora
raster artwork supplied by the owner. The approved artwork is preserved
without redrawing or reinterpretation.

## Assets

- `axora-mark-512.png` is the compact application mark.
- `axora-logo.png` is the transparent horizontal lockup.
- `axora-logo-light-background.png` uses the unchanged transparent lockup on
  light surfaces.
- `axora-logo-dark-background.png` places the unchanged lockup on a white
  backing surface so the navy artwork remains legible on dark pages.
- `axora-email.png` is the email-safe horizontal derivative.
- `axora-icon-32.png` is the small browser fallback icon.
- `axora-icon-192.png` is the small application icon.
- `axora-apple-180.png` is the Apple touch icon generated from the mark.

## Colour palette

- Deep navy: `#0B2D52`
- Amber accent: `#E8A33D`
- White: `#FFFFFF`

Keep the mark's proportions unchanged and leave clear space around it. Use the
white-backed dark-background asset when a dark surface would otherwise hide
the navy artwork.

## Source and licensing

The exact approved source copies are retained by the operator in the
Git-ignored `assets/brand/source/` generation workspace; they are not published
as repository source assets. `scripts/brand/generate-approved-assets.mjs`
uses that workspace by default (or `AXORA_APPROVED_BRAND_SOURCE_DIR`) and
verifies the source files' SHA-256 hashes before producing these reviewed
derivatives. The expected filenames are `axora-approved-mark.png` and
`axora-approved-horizontal.png`.
There is no faithful vector source, so no replacement SVG has been invented.
