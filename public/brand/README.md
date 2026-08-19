# Approved Axora brand assets

This folder contains the approved application vector logo and retained raster
production assets. The product owner explicitly approved the vector network
geometry used by the current Light/Dark application identity.

## Canonical application assets

- `axora-logo-source.svg` is the approved canonical vector source geometry.
- `axora-logo-light.svg` is the application lockup for light surfaces, with the
  Axora Navy wordmark.
- `axora-logo-dark.svg` is the application lockup for dark surfaces, with the
  white wordmark. It is an explicit asset, not a CSS-filtered derivative.

The canonical application logo component is `src/components/Brand.tsx`. It
selects the explicit Light/Dark SVG variant while preserving predictable
intrinsic dimensions.

## Retained raster assets

- `axora-mark-512.png` is the historical compact application mark.
- `axora-logo.png` is the historical transparent horizontal lockup.
- `axora-logo-light-background.png` is the historical light-surface raster.
- `axora-logo-dark-background.png` is the historical white-backed raster.
- `axora-email.png` remains the email-safe horizontal derivative.
- `axora-icon-32.png` is the small browser fallback icon.
- `axora-icon-192.png` is the small application icon.
- `axora-apple-180.png` is the Apple touch icon generated from the mark.

Email and generated-document surfaces remain fixed communication/print outputs
and are not automatically switched with browser appearance.

## Current Axora application palette

- Axora Navy: `#0B3157`
- Axora Gold: `#EAA63A`
- White: `#FFFFFF`

Keep the supplied network geometry and proportions unchanged and leave clear
space around the logo. Use `axora-logo-light.svg` on light surfaces and
`axora-logo-dark.svg` on dark surfaces. Do not use CSS inversion, brightness,
or hue-rotation filters to manufacture an Axora logo variant.

## Source and licensing

The raster source copies used by the older derivative-generation workflow are
retained by the operator in the Git-ignored `assets/brand/source/` workspace.
The owner-approved application vector is now source-controlled directly as
`axora-logo-source.svg`; this intentionally supersedes the earlier repository
note that no faithful vector source was available.
