# Trusted interactive experiences

Axora's interaction layer lets the website generator recommend an approved
illustration, ambient effect, or mascot without executing code written by an AI
model. The model produces data that conforms to Axora's versioned schema. The
application validates that data and maps it to reviewed React components.

The first approved asset is **Axora Buddy**, an original local SVG mascot. Its
runtime uses Motion for constrained pointer dragging and transform-based
animation. Rive and PixiJS are evaluated options for future catalog entries,
but neither is shipped until an approved asset genuinely needs it.

## Trust boundary

```text
verified company profile
        |
        v
deterministic recommender / AI structured output
        |
        v
strict Zod schema + catalog + publication checks
        |
        +---- reject unknown type, asset, state, trigger, or unsafe value
        |
        v
owner recommendation -------- owner override (saved separately)
        |                              |
        +--------------+---------------+
                       v
              unpublished preview
                       |
                 owner publishes
                       v
             immutable revision snapshot
                       |
                       v
            trusted Axora renderer only
```

Configuration never contains JavaScript, JSX, handlers, shaders, URLs, HTML,
or other executable fields. Unknown object keys and unsupported enum values are
rejected. Public rendering uses only catalog asset identifiers and bounded
settings.

## Recommendation and owner control

The recommender considers verified industry, brand tone, audience, purpose,
palette, accessibility needs, and known device constraints. It can recommend
no interaction. Each recommendation includes a short owner-facing rationale.

The owner can accept the recommendation, try an approved alternative, reduce
motion, change bounded behavior settings, disable the experience, or restore
the current AI recommendation. The saved owner choice is not overwritten when
Axora regenerates a recommendation. Preview changes are not public until an
authorized owner publishes them.

Only the Axora platform owner and a company's `ADMIN` users have
`manage_interactions`. Branch administrators, IT support, and other roles do
not. Database reads and writes are company-scoped; publication and rollback are
audited.

## Runtime state model

Mascot behavior is driven by an explicit reducer/state machine rather than a
collection of unrelated timers. Supported states include loading, idle,
walking left/right, turning, hovered, pressed, grabbed, carried, released,
falling, landing, recovering, reacting, sleeping, paused, hidden, reduced
motion, and error fallback.

For pickup and drop:

1. The mascot walks within the configured safe region.
2. The active primary pointer moves it to `grabbed`; automatic walking pauses.
3. Pointer movement updates a clamped position without changing page layout.
4. Release or pointer cancellation settles it at a valid position.
5. The state machine performs landing/recovery and resumes from the new point.

The reducer also handles extra pointers, release outside the surface, resize,
orientation change, hidden tabs, route unmounting, and rapid repeated input.
Stale events cannot revive an unmounted interaction.

## Page safety and accessibility

- Movement is restricted to an approved preview or public-site region.
- Navigation, calls to action, forms, legal notices, and consent controls are
  exclusion zones. The overlay is non-blocking outside the mascot's hit area.
- The mascot cannot submit a form, create horizontal overflow, or require drag
  to reach information.
- Persistent movement has an accessible pause/dismiss control.
- `prefers-reduced-motion` produces a stationary representation with minimal
  expression feedback. The owner can preview this mode explicitly.
- Decorative assets are hidden from assistive technology. Meaningful assets
  require a text alternative; all meaning remains available without animation.
- There is no autoplay audio, rapid flashing, camera, microphone, cross-site
  tracking, pointer recording, or default AI telemetry.
- Failure to load or initialize an asset renders the catalog's static fallback
  and never blocks page content.

These controls follow WCAG's requirement to let visitors pause, stop, or hide
non-essential movement that starts automatically and lasts more than five
seconds.

## Performance budget

The default implementation uses an inline/local SVG and transform/opacity
animation. Noncritical assets are lazy loaded. Runtime work pauses when the
document is hidden or the interaction is offscreen. The low-performance and
mobile profiles reduce automatic motion and effects.

Publication validation rejects assets without an approved license record,
fallback, checksum, and acceptable size. An interaction must not block first
render, cause layout shift, introduce horizontal overflow, or make the page
unusable if its runtime fails.

Use the lightest renderer that meets the design:

1. CSS transitions for simple entrances, opacity, and small decorative motion.
2. Motion for DOM/SVG drag constraints, springs, state transitions, and scroll
   reactions.
3. Rive for a reviewed `.riv` asset whose authored state machine or data
   binding materially improves the result.
4. PixiJS only for a richer multi-object 2D scene that cannot reasonably be
   delivered with SVG, CSS, Motion, or Rive.

## Technology evaluation (verified 2026-08-01)

| Technology | Suitable use | Decision | Runtime license |
| --- | --- | --- | --- |
| CSS | Simple transitions and static fallbacks | Preferred first | Web platform |
| Motion 12.43.0 | Constrained drag, springs, DOM/SVG motion, reduced-motion-aware transitions | Installed for Axora Buddy | MIT |
| Rive React runtime 4.30.0 | Authored interactive vector state machines and data binding | Approved candidate; not installed without a licensed `.riv` asset | MIT runtime; each asset needs its own license |
| PixiJS 8.19.0 / `@pixi/react` 8.0.5 | Complex, high-object-count 2D scenes | Deferred; too heavy for the initial mascot | MIT runtime; each asset needs its own license |

Official references:

- [Motion drag and constraints](https://motion.dev/docs/react-drag) and
  [LazyMotion bundle reduction](https://motion.dev/docs/react-lazy-motion)
- [Motion source and MIT license](https://github.com/motiondivision/motion)
- [Rive React runtime](https://rive.app/docs/runtimes/react/react),
  [state-machine playback](https://rive.app/docs/runtimes/state-machines), and
  [data binding](https://rive.app/docs/runtimes/web/data-binding)
- [Rive web runtime and MIT license](https://github.com/rive-app/rive-wasm)
- [PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro),
  [performance guidance](https://pixijs.com/8.x/guides/concepts/performance-tips),
  and [MIT license](https://github.com/pixijs/pixijs/blob/dev/LICENSE)
- [WCAG 2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

Package versions must be re-verified before a future runtime is installed.
An open-source runtime never grants rights to a community animation or design
asset.

## Asset approval and licensing

Every catalog asset needs a local file (when its license permits), stable asset
ID, source, author, exact license, attribution text, cryptographic checksum,
maximum size, static fallback, and reviewer approval. Tenant uploads are stored
and queried by company ID and cannot become approved catalog assets merely by
being uploaded.

See [INTERACTION_ASSET_LICENSES.md](INTERACTION_ASSET_LICENSES.md) for the
inventory. Assets with incomplete or incompatible licensing are rejected at
publication time. Hotlinks, copied brand characters, and recognizable
copyrighted characters are prohibited.

## Verification

Run the focused and browser suites:

```bash
npm run test
npx playwright install chromium
npm run test:e2e
```

Browser coverage exercises desktop and mobile pickup/drop/resume, edge turns,
pointer cancellation, resize, hidden-tab pause, route unmount, reduced motion,
static fallback, editor overrides, owner disable, non-obstruction, and overflow
protection. CI retains Playwright evidence only when a browser check fails.

## Current product boundary

This repository currently contains Axora's authenticated procurement portal,
not a complete multi-site hosting and domain-publishing product. This feature
delivers the trusted schema, catalog, persistence, owner editor, preview,
runtime, and publication snapshots that such generated sites will consume.
Actual customer-domain publication must use the saved published configuration
through the same trusted renderer; it must not bypass validation or execute
generated code.
