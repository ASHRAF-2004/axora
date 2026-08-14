# Axora immersive world V2

Axora's localized public experience presents a customer-safe lifecycle:

`Request -> Approve -> Pay -> Invoice -> Prepare -> Deliver -> Track -> Complete`

Internal buying activity, supplier identity, supplier cost, driver operational
notes and raw customer-inappropriate tracking data remain behind server-side
authorization and sanitization boundaries.

## Route-specific scenes

- `/[locale]` transforms through the eight customer workflow objects.
- `/[locale]/how-it-works` explains the governed end-to-end journey.
- `/[locale]/procurement-process` connects catalogue, approval, invoice,
  preparation and delivery objects.
- `/[locale]/solutions-by-role` changes between licensed person, workspace and
  company objects.
- `/[locale]/security-and-privacy` changes from shield to vault to network.
- `/[locale]/about` changes from the Axora company world to network and flag.

The active and next likely GLB are the only semantic models requested. Model
changes use coordinated scale, rotation, light, camera and transition-particle
assembly rather than claiming incompatible meshes are true morph targets.

## Progressive runtime

- Semantic HTML is the source of truth and renders before WebGL.
- React Three Fiber loads client-side only after WebGL, motion, data-saver and
  device capability checks.
- Rendering pauses offscreen and while the tab is hidden.
- Context loss, import failure, reduced motion, constrained data and missing
  WebGL switch to the same meaningful static workflow.
- All keyboard, touch and pointer actions operate through accessible HTML
  controls; the canvas is decorative to assistive technology.
- Arabic direction mirrors spatial movement while all localized text remains
  shaped HTML rather than WebGL texture text.

## Atmosphere and identity precedence

Aurora, Solar, Ember and Midnight are centralized design-token themes. A
visitor preference follows public and authentication routes in local storage.
Eligible Axora staff can persist a preference against their account. Customer
users do not receive the selector; reviewed company-logo tokens remain
authoritative for their authenticated portal and override any public choice.

## Sound

Eight distinct, self-hosted stage cues communicate document submission,
approval, payment, invoice creation, packing, delivery, tracking and verified
completion. Delivery combines a short engine cue with a door cue. Sound is
muted by default, never autoplays, begins only after an explicit choice, stops
when hidden or unmounted, and is disabled by default for reduced-motion or
constrained-data users.

## Visitor choice and live information

The visitor choice is a homepage-only required dialog for eligible unclaimed
visitors. It traps focus, blocks premature dismissal, uses a bounded Turnstile
verification, and records an atomic idempotent server claim. After success,
only compact aggregate counters remain. SSE provides authoritative versioned
snapshots with safe polling fallbacks, visibility cleanup and reconnect
handling. The same snapshot pattern powers driver availability and authorized
delivery tracking.

## Dependencies and assets

- `three@0.185.1` (MIT)
- `@react-three/fiber@9.7.0` (MIT)
- `@react-three/drei@10.7.8` (MIT)
- `maplibre-gl@5.18.0` (BSD-3-Clause)

All production models, sounds and catalogue artwork are self-hosted. Exact
source, creator, licence, retrieval date, repository path and modifications are
recorded in `THIRD_PARTY_ASSETS.md`. Reference architecture notes are in
`docs/immersive-world-v2-reference-matrix.md` and third-party code notices are
in `THIRD_PARTY_NOTICES.md`.
