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

## Appearance and identity precedence

Axora supports exactly two application appearance modes: **Light** and **Dark**.
The public first render is driven by the SSR-readable `axora_appearance` cookie;
`axora-appearance:v1` local storage is a synchronized browser cache and cross-tab
signal. The retired Aurora, Solar, Ember and Midnight values are accepted only
for one-time migration to Light/Dark and are not product choices.

Authenticated users have a database-backed Light/Dark preference that is
resolved on the server before the application shell renders. For company users,
the reviewed company appearance is the default when no individual preference
exists. Selecting Light or Dark changes only which approved company
surface/text set is used; the company's reviewed logo and brand colors remain
authoritative and tenant-scoped.

The 3D experience follows the same Light/Dark appearance using two restrained
scene palettes. Geometry, semantic models, camera behavior, interactions,
reduced-motion fallback and WebGL failure behavior are independent of the
appearance mode.

## Sound

Eight distinct, self-hosted stage cues communicate document submission,
approval, payment, invoice creation, packing, delivery, tracking and verified
completion. Delivery combines a short engine cue with a door cue. Sound is
muted by default, never autoplays, begins only after an explicit choice, stops
when hidden or unmounted, and is disabled by default for reduced-motion or
constrained-data users.

## Visitor choice and live information

The visitor choice is a homepage-only required dialog for eligible anonymous,
unclaimed visitors. It traps focus, blocks premature dismissal, uses a bounded
Turnstile verification, and records an atomic idempotent server claim. Signed-in
and privacy-ineligible visitors are rejected before identity work. The versioned,
HTTP-only first-party cookie is the only durable anonymous identity; clearing it
or changing browser/device can permit another anonymous choice. Hourly rotating
network HMACs exist only in short-lived abuse-rate buckets.

After success, only compact aggregate counters remain. The browser performs one
bounded authoritative snapshot poll every 30 seconds, pauses while hidden or
offline, applies only monotonic database versions, and backs off after failures.
The retired EventSource endpoint returns 204 so old clients stop reconnecting.
This is honest near-live polling, not database-event push.

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
