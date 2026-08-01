# Axora Design System

## Product context

Axora is a production multi-tenant procurement platform used by platform owners, company administrators, branch administrators, approvers, requesters, finance staff, and read-only viewers. The core jobs are managing companies, branches and budgets, people and access, a global product catalog, purchase requests, approvals, sourcing, delivery, invoices, documents, reports, and audit history.

The new Interactive Experience workspace lets an authorized company owner review an AI-recommended website interaction, understand the rationale, preview the real trusted interaction, safely override bounded settings, and save an unpublished owner decision. It must never expose raw JavaScript, arbitrary code, shaders, event handlers, or unreviewed remote assets.

## Brand character

- Calm, capable, trustworthy, operational, and human.
- Professional enterprise software with a restrained touch of warmth.
- Dense enough for operational work, but never visually noisy.
- Preserve the existing Axora identity; do not resemble a consumer game or an AI toy.
- Use the real Axora brand mark from `public/brand/axora-mark.svg` and existing Lucide iconography.

## Color tokens

Use only these established tokens and their documented tints:

- Navy 950 `#081a2c`: deepest navigation and high-contrast surfaces.
- Navy 900 `#102a43`: headings and primary dark text.
- Navy 800 `#173f5f`: secondary dark brand surface.
- Blue 700 `#1d4ed8` and Blue 600 `#2563eb`: primary actions, focus, and selected state.
- Blue 100 `#dbeafe`: selected and informational backgrounds.
- Teal 600 `#0f9d8a` and Teal 100 `#ccfbf1`: success, live state, and safe recommendation accents.
- Orange 600 `#d97706` and Orange 100 `#ffedd5`: warnings and review-needed states.
- Red 600 `#dc2626` and Red 100 `#fee2e2`: destructive action and validation only.
- Slate 950 `#0f172a`, 700 `#334155`, 600 `#475569`, 500 `#64748b`, 300 `#cbd5e1`, 200 `#e2e8f0`, 100 `#f1f5f9`, 50 `#f8fafc`: text, borders, and neutral surfaces.
- White `#ffffff`: primary panel surfaces.

Do not introduce purple, pink, neon, decorative gradients, or alternate brand palettes. Existing gradients may combine blue with blue, blue with teal, or navy with navy/teal.

## Typography

- Font family: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Page title: fluid 28–40 px, weight 800–850, line-height about 1.08, tight negative tracking.
- Panel heading: 16–18 px, weight 750–800.
- Body: 12–15 px with generous 1.45–1.6 line-height.
- Labels: 10–12 px, weight 700–800.
- Eyebrows and status labels: 10–11 px, uppercase, wide tracking.
- Never introduce serif, display, handwritten, or decorative fonts.

## Shape, spacing, and elevation

- Base spacing rhythm: 4, 8, 12, 16, 20, 24, 28, 34 px.
- Page content padding: 34 px desktop; 24 px by 18 px on compact screens.
- General radius token: 18 px.
- Buttons and fields: 10–12 px radius; panels: 18 px; large dialogs: 20–24 px; pills: fully rounded.
- Primary panels: white, `1px solid #e2e8f0`, subtle `0 8px 30px rgba(15,23,42,.035)` shadow.
- Elevated overlays: restrained translucent white with blur and a navy shadow.
- Avoid excessive nested shadows, glass effects, or floating decoration.

## Application shell

- Desktop: fixed visual grid with a 248 px sticky dark-navy sidebar and a flexible content column.
- Sidebar: Axora lockup at top, compact Lucide navigation rows, teal-accent operational footer.
- Top bar: 72 px sticky translucent-white production status and signed-in user summary.
- Main content: maximum 1540 px, centered.
- At 760 px and below: sidebar collapses to 74 px icons, user summary hides, content padding reduces.
- Do not remove or restyle the shell when designing a new authenticated page.

## Core components

- `PageHeader`: eyebrow, large title, concise description, optional primary action.
- `Panel`: white bounded surface with a header and padded body.
- Primary button: blue gradient, white text, 42 px minimum height.
- Secondary button: white, navy text, slate border.
- Form controls: 41 px minimum height, white surface, slate border, strong blue focus ring.
- Status badge: compact semantic pill using teal/blue/orange/red/neutral tone.
- Callout: pale blue-to-cyan information surface with blue border.
- Readiness item: icon, strong label, secondary explanation in a bounded row.

## Interactive Experience workspace

The owner-facing editor is a new target inside the existing authenticated shell. Its desktop composition should use:

1. `PageHeader` for “Interactive experience” and a clear unpublished-state indicator.
2. A concise AI recommendation card containing the approved interaction name, evidence-based rationale, suitability facts, performance tier, licensing state, and actions: Accept recommendation, Try another concept, and Disable.
3. A two-column workbench below: a bounded settings panel on the left and a large live website preview on the right.
4. Settings grouped into understandable sections: Experience, Behaviour, Placement and boundaries, Devices and performance, Accessibility and fallback. Use safe selects, toggles, segmented controls, and bounded range inputs. Never expose code.
5. Preview toolbar with Desktop, Tablet, Mobile, Reduced motion, and Low performance modes. The preview frame must show a representative company website area, protected navigation/CTA regions, a visible pause/dismiss control, and the real interaction state.
6. A small validation/warnings area for overlap, asset size, license, fallback, contrast, and company-tone suitability.
7. Persistent but non-obstructive actions: Reset to AI recommendation, Save draft, and Publish only when validation passes. Initial implementation may keep publication unavailable while preserving the full approved layout intent.

On tablet, retain settings and preview in a readable stacked layout. On mobile, show preview first with a compact mode switcher, then accordion-like settings; actions remain reachable without a horizontal overflow.

## Trusted interaction visual language

- The initial approved mascot is an original Axora-created 2D SVG/CSS character; no third-party visual asset is required.
- Keep the character friendly and geometric, using navy, blue, teal, white, and subtle slate outlines.
- State changes should be legible but restrained: idle, walking, turning, hovered, grabbed, carried, falling, landing, recovering, paused, reduced motion, and static fallback.
- The mascot is secondary to content. It must never obscure navigation, calls to action, forms, legal/consent content, or text.
- Provide visible pause and dismiss controls for persistent motion.

## Motion rules

- Use ordinary CSS transitions for focus, hover, opacity, and small state changes.
- Movement should primarily use transforms and opacity.
- Use spring-like motion only for pickup, drop, and landing where it improves comprehension.
- No rapid flashing, autoplay audio, decorative particle storms, parallax overload, or continuous layout measurement.
- Pause when hidden or offscreen; lazy-load noncritical runtime code and assets.
- Prefer one meaningful interaction to many competing animations.

## Accessibility and safety

- Preserve strong focus-visible outlines and complete keyboard navigation.
- Respect `prefers-reduced-motion`; show a stationary semantic fallback instead of merely shortening animation duration.
- Provide static fallback and text equivalent when the illustration communicates meaning.
- Dragging is optional play, never the only way to access information.
- Maintain touch targets of about 42–44 px where practical.
- Keep important actions at WCAG AA contrast or better.
- Avoid horizontal overflow and layout shift.
- Preview and controls must remain usable if the animation asset fails.

## Design constraints

- Use only the fonts, colors, spacing, radii, shadows, and component styles in this design system.
- Do not introduce a new visual brand, raw-code editor, game dashboard, chatbot UI, or public-site builder unrelated to the interaction configuration task.
- Clearly distinguish AI recommendation, owner override, saved draft, and published state.
- The interface should feel like a natural, polished extension of Axora rather than a separate product.
