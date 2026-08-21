# Axora simple UI design system

Status: source of truth for the forward simple-interface redesign.

## Direction

Axora uses a conventional, trustworthy B2B interface. Operational clarity takes precedence over decorative effects. The homepage, authentication pages, and authenticated shell do not load public 3D, audio, particle, or WebAssembly assets. Retired Operations Experience URLs permanently redirect to the localized How It Works page.

## Tokens

| Purpose | Value |
| --- | --- |
| Brand navy | `#0b2d52` |
| Brand blue | `#155e9d` |
| Page | `#f8fafc` |
| Surface | `#ffffff` |
| Primary text | `#0f172a` |
| Muted text | `#526274` |
| Border | `#dbe3ea` |
| Focus | `rgba(21, 94, 157, 0.28)` |
| Radius | `10px` controls, `16px` cards |
| Shadow | `0 18px 48px rgba(15, 42, 67, 0.09)` |

Use existing semantic success, warning, danger, and information colours. Company users retain their reviewed logo-derived company theme; these brand tokens do not override it.

## Components and behavior

- Typography uses the existing self-hosted/system stack; no remote font request is permitted.
- Primary controls are at least 44px, with visible `:focus-visible` treatment.
- Forms use persistent labels, browser autocomplete, plain inline validation, and safe value preservation.
- Cards, tables, and dialogs use white surfaces, restrained borders, moderate radii, and minimal shadow.
- Navigation remains top-based with the established mobile drawer. No permanent sidebar is introduced.
- Motion is limited to short state transitions and is effectively disabled by `prefers-reduced-motion`.
- Arabic mirrors direction and control placement through logical CSS properties. English and Malay remain LTR.
- Responsive layouts collapse from multi-column to single-column without horizontal scrolling.

## Design inputs

The design was established with the repository-scoped `ui-ux-pro-max` skill pinned to upstream commit `a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5`. The old Axora production revision was used only as a visual reference; no old backend or security implementation was restored.
