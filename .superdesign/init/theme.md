# Axora Theme

## Part 1 — Compact Token Summary

### Theme architecture

- Framework: Next.js 16 App Router with React 19.
- Styling: one project-wide vanilla stylesheet, `src/app/globals.css`, imported by `src/app/layout.tsx`; component markup uses global class names plus occasional inline style objects.
- Tailwind: **not installed and not configured**. There is no `tailwind.config.*`, no Tailwind dependency, and no Tailwind import/directive in the application stylesheet.
- Component/theme library: none. Axora uses custom React components, Lucide icons, CSS variables, and global CSS.
- Theme modes: one light theme on `:root`. There is no `.dark`, `[data-theme]`, `color-scheme`, or theme-provider implementation.

### Color palette

| Token | Value | Primary use |
| --- | --- | --- |
| `--navy-950` | `#081a2c` | Deep shell and overlay background |
| `--navy-900` | `#102a43` | Primary headings and dark foreground |
| `--navy-800` | `#173f5f` | Reserved navy step; currently unused through `var()` |
| `--blue-700` | `#1d4ed8` | Reserved blue step; currently unused through `var()` |
| `--blue-600` | `#2563eb` | Primary action, focus, link, and active accent |
| `--blue-100` | `#dbeafe` | Blue tint and icon surface |
| `--teal-600` | `#0f9d8a` | Success/live/accent color |
| `--teal-100` | `#ccfbf1` | Teal tint |
| `--orange-600` | `#d97706` | Warning accent |
| `--orange-100` | `#ffedd5` | Warning tint |
| `--red-600` | `#dc2626` | Destructive/error accent |
| `--red-100` | `#fee2e2` | Destructive/error tint |
| `--slate-950` | `#0f172a` | Default foreground |
| `--slate-700` | `#334155` | Strong secondary text |
| `--slate-600` | `#475569` | Secondary text |
| `--slate-500` | `#64748b` | Muted text and icons |
| `--slate-300` | `#cbd5e1` | Strong divider/fallback surface |
| `--slate-200` | `#e2e8f0` | Borders and dividers |
| `--slate-100` | `#f1f5f9` | Quiet fills and hover surfaces |
| `--slate-50` | `#f8fafc` | Page background |
| `--white` | `#ffffff` | Card/action foreground and surfaces |

Additional semantic values are hardcoded where used: success `#047857` on `#d1fae5`, danger text `#b91c1c`, warning text `#b45309`, info text `#1d4ed8`, focus blue `rgba(37, 99, 235, .28)`, and the login/sidebar use navy, blue, and teal gradients. Purple (`#7c3aed`, `#6d28d9`, pale violet fills) is limited to product fallback artwork.

### Typography

- Body stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Inter is referenced by name but is **not imported, bundled, or loaded by `next/font`**; clients without a local Inter install fall through to the system stack.
- Fixed sizes present: `7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 28, 46px`.
- Responsive display sizes: page title `clamp(28px, 3vw, 40px)`, shop title `clamp(24px, 3vw, 36px)`, login hero `clamp(44px, 5.2vw, 76px)`.
- Weight values: `500, 600, 650, 700, 750, 800, 850, 900`; the system intentionally uses variable-style intermediate weights when the selected font supports them.
- Tracking: headings commonly `-.02em` to `-.06em`; labels/eyebrows commonly `.07em` to `.18em` with uppercase text.
- Typical line heights: dense lockups near `1`, headings near `1.08`, body/supporting copy around `1.4–1.65`.

### Spacing and sizing

- There is **no named spacing scale**. Actual gaps cover `2–26px`, with `8, 10, 12, 13, 16, 17, 18, 20, 24px` used most often.
- Common component padding: controls `9px 11px`; buttons `0 18px`; card/panel bodies `20–21px`; content shell `34px` desktop and `24px 18px` compact.
- Shell dimensions: sidebar `248px` desktop / `74px` compact, top bar `72px`, main content maximum `1540px`.
- Controls: base input minimum height `41px`, button minimum height `42px`, icon button `38px`, search hero `56px`.

### Radius

- Named radius: `--radius: 18px` for panels and metric cards.
- Other actual radii: `6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24px`, `50%`, and `999px` pills.
- Typical use: controls `10–11px`, icon tiles `12–17px`, cards/panels `14–24px`, badges/chips `999px`.

### Shadows and elevation

- Named shadow: `--shadow: 0 16px 40px rgba(15, 42, 67, 0.08)`; defined but not currently consumed through `var()`.
- Standard panel: `0 8px 30px rgba(15,23,42,.035–.04)`.
- Brand mark: `0 8px 22px rgba(37, 99, 235, 0.25)`.
- Primary action: `0 10px 20px rgba(37,99,235,.22)`, stronger on hover.
- Elevated login card: `0 28px 80px rgba(15,42,67,.12)`.
- Glass feedback and confirmation overlays use multi-layer shadows plus `backdrop-filter` blur/saturation.

### Breakpoints and responsive behavior

- `1250px`: shop result density adjustment.
- `1180px`: catalogue grid/layout adjustment.
- `1120px`: KPI grids become two columns; dashboard/split/detail layouts collapse; login becomes one column.
- `940px`: catalogue filters/results reflow.
- `900px`: catalogue/cart adjustments.
- `820px`: product-image management reflow.
- `760px`: primary app compact mode (74px icon sidebar, stacked content/forms, reduced content padding).
- `700px`, `680px`, `600px`, `480px`: component-specific mobile grids, dialogs, catalog, shop, request, and image controls.
- `prefers-reduced-motion: reduce`: globally reduces animations/transitions to `.01ms`, uses one iteration, and disables smooth scrolling.

### Interaction/motion language

- Ordinary transitions are predominantly `.16–.18s ease`; larger drawers/cards use `.25–.35s ease`.
- Primary hover motion is a restrained `translateY(-1px)`; pressed controls scale to `.97`.
- Approved keyframes in the current stylesheet: spinner, fade-in, dialog entrance, and navigation progress.
- Focus-visible treatment is a 3px translucent blue outline with a 3px offset; inputs additionally use a blue border and three-pixel focus halo.

## Part 2 — Raw Theme Sources

### `src/app/globals.css` (complete)

```css
:root {
  --navy-950: #081a2c;
  --navy-900: #102a43;
  --navy-800: #173f5f;
  --blue-700: #1d4ed8;
  --blue-600: #2563eb;
  --blue-100: #dbeafe;
  --teal-600: #0f9d8a;
  --teal-100: #ccfbf1;
  --orange-600: #d97706;
  --orange-100: #ffedd5;
  --red-600: #dc2626;
  --red-100: #fee2e2;
  --slate-950: #0f172a;
  --slate-700: #334155;
  --slate-600: #475569;
  --slate-500: #64748b;
  --slate-300: #cbd5e1;
  --slate-200: #e2e8f0;
  --slate-100: #f1f5f9;
  --slate-50: #f8fafc;
  --white: #ffffff;
  --radius: 18px;
  --shadow: 0 16px 40px rgba(15, 42, 67, 0.08);
}

* { box-sizing: border-box; }
html { background: var(--slate-50); color: var(--slate-950); }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--slate-50); }
a { color: inherit; text-decoration: none; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }

.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-lockup img { border-radius: 12px; box-shadow: 0 8px 22px rgba(37, 99, 235, 0.25); }
.brand-lockup div { display: grid; line-height: 1; }
.brand-lockup strong { font-size: 24px; letter-spacing: -0.04em; }
.brand-lockup span { margin-top: 7px; color: var(--teal-600); font-size: 10px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }

.portal-shell { min-height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; color: #dbeafe; background: linear-gradient(180deg, var(--navy-950), #0d2740 64%, #103b50); border-right: 1px solid rgba(255,255,255,.06); }
.sidebar-brand { height: 88px; display: flex; align-items: center; padding: 0 24px; color: white; border-bottom: 1px solid rgba(255,255,255,.08); }
.sidebar .brand-lockup span { color: #5eead4; }
.sidebar nav { padding: 22px 14px; display: grid; gap: 5px; }
.sidebar nav a { display: flex; align-items: center; gap: 13px; min-height: 44px; padding: 0 13px; border-radius: 12px; color: #b9cbe0; font-size: 14px; font-weight: 650; transition: .18s ease; }
.sidebar nav a:hover { color: white; background: rgba(255,255,255,.09); transform: translateX(2px); }
.sidebar-foot { margin: auto 15px 18px; padding: 15px; display: flex; gap: 11px; align-items: center; border: 1px solid rgba(94,234,212,.18); border-radius: 14px; background: rgba(15,157,138,.12); color: #e6fffb; font-size: 12px; line-height: 1.3; }
.sidebar-foot small { color: #99f6e4; }
.portal-main { min-width: 0; }
.topbar { height: 72px; padding: 0 32px; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--slate-200); position: sticky; top: 0; z-index: 20; }
.topbar > div:first-child { display: flex; align-items: center; gap: 9px; color: var(--slate-600); font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
.environment-dot { width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 0 4px rgba(37,99,235,.1); }
.environment-demo { background: var(--blue-600); }
.environment-live { background: var(--teal-600); }
.topbar-actions { display: flex; align-items: center; gap: 11px; }
.icon-button { border: 0; background: transparent; color: var(--slate-600); display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; }
.icon-button:hover { background: var(--slate-100); color: var(--navy-900); }
.user-summary { padding: 0 9px; display: grid; text-align: right; line-height: 1.2; }
.user-summary span { font-size: 13px; font-weight: 750; color: var(--navy-900); }
.user-summary small { color: var(--slate-500); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.content-shell { padding: 34px; max-width: 1540px; margin: 0 auto; }

.page-heading { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 28px; }
.page-heading h1 { margin: 3px 0 7px; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.045em; color: var(--navy-900); line-height: 1.08; }
.page-heading > div > p:last-child { margin: 0; max-width: 730px; color: var(--slate-600); font-size: 15px; line-height: 1.55; }
.eyebrow { margin: 0; color: var(--blue-600); font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .15em; }
.button { min-height: 42px; border: 0; border-radius: 11px; padding: 0 18px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 750; font-size: 13px; transition: .18s ease; }
.button-primary { color: white; background: linear-gradient(135deg, var(--blue-600), #3b82f6); box-shadow: 0 10px 20px rgba(37,99,235,.22); }
.button-primary:hover { transform: translateY(-1px); box-shadow: 0 13px 25px rgba(37,99,235,.3); }
.button-secondary { color: var(--navy-900); background: var(--white); border: 1px solid var(--slate-200); }
.button-danger { color: white; background: var(--red-600); }
.button-full { width: 100%; }

.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.metric-card { padding: 20px; min-height: 166px; border: 1px solid var(--slate-200); border-radius: var(--radius); background: white; box-shadow: 0 8px 30px rgba(15,23,42,.04); position: relative; overflow: hidden; }
.metric-card::after { content: ""; position: absolute; right: -34px; bottom: -40px; width: 108px; height: 108px; border-radius: 50%; opacity: .08; background: currentColor; }
.metric-icon { width: 39px; height: 39px; border-radius: 12px; display: grid; place-items: center; margin-bottom: 17px; }
.metric-blue .metric-icon { color: var(--blue-600); background: var(--blue-100); }
.metric-teal .metric-icon { color: var(--teal-600); background: var(--teal-100); }
.metric-orange .metric-icon { color: var(--orange-600); background: var(--orange-100); }
.metric-navy .metric-icon { color: var(--navy-900); background: var(--slate-200); }
.metric-label { font-size: 12px; color: var(--slate-500); font-weight: 750; text-transform: uppercase; letter-spacing: .07em; }
.metric-value { margin: 5px 0 5px; color: var(--navy-900); font-size: 28px; font-weight: 850; letter-spacing: -.04em; }
.metric-note { color: var(--slate-500); font-size: 11px; line-height: 1.4; }

.dashboard-grid { margin-top: 17px; display: grid; grid-template-columns: 1.25fr .9fr; gap: 17px; }
.panel { border: 1px solid var(--slate-200); border-radius: var(--radius); background: white; box-shadow: 0 8px 30px rgba(15,23,42,.035); overflow: hidden; }
.panel + .panel-stack, .panel-stack { display: grid; gap: 17px; }
.panel-header { min-height: 68px; padding: 17px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--slate-100); }
.panel-header h2, .panel-header h3 { margin: 0; color: var(--navy-900); font-size: 16px; letter-spacing: -.02em; }
.panel-header p { margin: 5px 0 0; color: var(--slate-500); font-size: 11px; }
.panel-body { padding: 20px; }
.chart-list { display: grid; gap: 15px; }
.chart-row { display: grid; grid-template-columns: 150px 1fr 35px; gap: 12px; align-items: center; }
.chart-row span { color: var(--slate-600); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chart-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--slate-100); }
.chart-fill { height: 100%; min-width: 7px; border-radius: inherit; background: linear-gradient(90deg, var(--blue-600), var(--teal-600)); }
.chart-row strong { color: var(--navy-900); font-size: 12px; text-align: right; }
.callout { padding: 17px 18px; border-radius: 14px; background: linear-gradient(135deg, #eff6ff, #ecfeff); border: 1px solid #bfdbfe; }
.callout strong { display: block; color: var(--navy-900); margin-bottom: 5px; }
.callout p { margin: 0; color: var(--slate-600); font-size: 12px; line-height: 1.55; }

.data-table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; min-width: 780px; }
.data-table th { padding: 12px 15px; color: var(--slate-500); background: var(--slate-50); border-bottom: 1px solid var(--slate-200); text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .09em; white-space: nowrap; }
.data-table td { padding: 14px 15px; color: var(--slate-700); border-bottom: 1px solid var(--slate-100); font-size: 12px; vertical-align: middle; }
.data-table tbody tr:hover { background: #fbfdff; }
.data-table tbody tr:last-child td { border-bottom: 0; }
.data-table td strong { color: var(--navy-900); }
.table-link { color: var(--blue-600); font-weight: 750; }
.subtle { color: var(--slate-500); font-size: 11px; }
.status-badge { display: inline-flex; align-items: center; min-height: 25px; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 800; white-space: nowrap; }
.status-success { color: #047857; background: #d1fae5; }
.status-danger { color: #b91c1c; background: var(--red-100); }
.status-warning { color: #b45309; background: var(--orange-100); }
.status-info { color: #1d4ed8; background: var(--blue-100); }
.status-neutral { color: var(--slate-600); background: var(--slate-100); }

.toolbar { margin-bottom: 16px; padding: 13px; display: flex; gap: 10px; justify-content: space-between; align-items: center; border: 1px solid var(--slate-200); border-radius: 14px; background: white; }
.toolbar-group { display: flex; gap: 9px; align-items: center; }
.search-input, .toolbar select { min-height: 39px; border: 1px solid var(--slate-200); border-radius: 10px; background: var(--slate-50); color: var(--slate-700); padding: 0 12px; outline: none; }
.search-input { min-width: 270px; }
.search-input:focus, .toolbar select:focus, input:focus, select:focus, textarea:focus { border-color: var(--blue-600); box-shadow: 0 0 0 3px rgba(37,99,235,.1); }

.split-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
.form-panel { padding: 21px; position: sticky; top: 94px; }
.form-panel h2 { margin: 0 0 4px; color: var(--navy-900); font-size: 17px; }
.form-panel > p { margin: 0 0 18px; color: var(--slate-500); font-size: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.form-grid .field-full { grid-column: 1 / -1; }
label { display: grid; gap: 7px; color: var(--slate-700); font-size: 11px; font-weight: 750; }
input, select, textarea { width: 100%; min-height: 41px; border: 1px solid var(--slate-200); border-radius: 10px; padding: 9px 11px; background: white; color: var(--slate-950); outline: none; }
textarea { min-height: 82px; resize: vertical; }
.form-actions { margin-top: 17px; display: flex; justify-content: flex-end; }
.form-alert { margin: 13px 0; padding: 11px 13px; border-radius: 10px; background: var(--red-100); color: #b91c1c; font-size: 12px; }
.form-hint { color: var(--slate-500); font-size: 10px; font-weight: 500; }

.request-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.summary-box { padding: 15px; border: 1px solid var(--slate-200); background: var(--slate-50); border-radius: 13px; }
.summary-box span { color: var(--slate-500); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; font-weight: 750; }
.summary-box strong { display: block; margin-top: 6px; color: var(--navy-900); font-size: 14px; }
.detail-grid { margin-top: 17px; display: grid; grid-template-columns: 1fr 320px; gap: 17px; }
.timeline { display: grid; gap: 0; }
.timeline-item { display: grid; grid-template-columns: 24px 1fr; gap: 12px; min-height: 54px; }
.timeline-dot { width: 10px; height: 10px; margin-top: 5px; border-radius: 50%; background: var(--blue-600); box-shadow: 0 0 0 5px var(--blue-100); }
.timeline-item:not(:last-child) .timeline-dot::after { content: ""; display: block; width: 2px; height: 42px; margin: 10px 0 0 4px; background: var(--slate-200); }
.timeline-item strong { font-size: 12px; color: var(--navy-900); }
.timeline-item p { margin: 4px 0 0; color: var(--slate-500); font-size: 11px; }
.line-builder { display: grid; gap: 12px; }
.line-card { display: grid; grid-template-columns: 2fr .7fr 1fr 42px; gap: 10px; align-items: end; padding: 15px; border: 1px solid var(--slate-200); border-radius: 13px; background: var(--slate-50); }
.remove-line { min-height: 41px; border: 0; border-radius: 10px; color: var(--red-600); background: var(--red-100); }
.section-title { margin: 25px 0 12px; color: var(--navy-900); font-size: 15px; }

.login-shell { min-height: 100vh; display: grid; grid-template-columns: minmax(440px, 1.1fr) minmax(390px, .9fr); background: white; }
.login-story { min-height: 100vh; padding: 48px clamp(48px, 7vw, 98px); display: flex; flex-direction: column; justify-content: space-between; color: white; background:
  radial-gradient(circle at 88% 14%, rgba(45,212,191,.22), transparent 28%),
  radial-gradient(circle at 15% 82%, rgba(59,130,246,.28), transparent 32%),
  linear-gradient(145deg, var(--navy-950), #123956 62%, #0b5f68); overflow: hidden; }
.login-story .brand-lockup span { color: #5eead4; }
.login-story h1 { max-width: 650px; margin: 22px 0 17px; font-size: clamp(44px, 5.2vw, 76px); line-height: .98; letter-spacing: -.06em; }
.login-story > div:nth-child(2) > p { max-width: 610px; color: #c5d8eb; font-size: 17px; line-height: 1.65; }
.pilot-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; color: #ccfbf1; background: rgba(15,157,138,.16); border: 1px solid rgba(94,234,212,.25); border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.feature-list { margin: 27px 0 0; padding: 0; list-style: none; display: grid; gap: 13px; color: #e6f3ff; font-size: 13px; }
.feature-list li { display: flex; align-items: center; gap: 10px; }
.feature-list svg { color: #5eead4; width: 18px; }
.login-story > small { color: #9cb7cf; }
.login-panel { display: grid; place-items: center; padding: 50px; background: linear-gradient(160deg, #ffffff, #f8fbff); }
.login-card { width: min(420px, 100%); padding: 34px; border: 1px solid var(--slate-200); border-radius: 24px; background: white; box-shadow: 0 28px 80px rgba(15,42,67,.12); }
.login-icon { width: 48px; height: 48px; display: grid; place-items: center; color: var(--blue-600); background: var(--blue-100); border-radius: 14px; margin-bottom: 20px; }
.login-card h2 { margin: 5px 0 7px; color: var(--navy-900); font-size: 28px; letter-spacing: -.04em; }
.login-card > .muted { margin: 0 0 22px; }
.login-card label { margin-top: 14px; }
.login-card .button { margin-top: 20px; }
.muted { color: var(--slate-500); }
.demo-note { margin: 18px 0 0; padding: 12px; border-radius: 10px; color: var(--slate-500); background: var(--slate-50); font-size: 10px; line-height: 1.5; }

.empty-state { padding: 45px; text-align: center; color: var(--slate-500); }
.empty-state strong { display: block; margin-bottom: 5px; color: var(--navy-900); }
.readiness-list { display: grid; gap: 11px; }
.readiness-item { display: flex; gap: 11px; align-items: flex-start; padding: 13px; border: 1px solid var(--slate-200); border-radius: 12px; }
.readiness-item svg { flex: 0 0 auto; color: var(--teal-600); }
.readiness-item strong { display: block; color: var(--navy-900); font-size: 12px; }
.readiness-item p { margin: 3px 0 0; color: var(--slate-500); font-size: 11px; line-height: 1.45; }

@media (max-width: 1120px) {
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .dashboard-grid, .split-layout, .detail-grid { grid-template-columns: 1fr; }
  .form-panel { position: static; }
  .login-shell { grid-template-columns: 1fr; }
  .login-story { min-height: 520px; }
}

@media (max-width: 760px) {
  .portal-shell { grid-template-columns: 74px minmax(0, 1fr); }
  .sidebar-brand { padding: 0 15px; }
  .sidebar .brand-lockup div, .sidebar nav a span, .sidebar-foot span { display: none; }
  .sidebar nav a { justify-content: center; padding: 0; }
  .sidebar-foot { justify-content: center; }
  .content-shell { padding: 24px 18px; }
  .topbar { padding: 0 18px; }
  .user-summary { display: none; }
  .metric-grid, .request-summary, .form-grid { grid-template-columns: 1fr; }
  .page-heading { align-items: flex-start; flex-direction: column; }
  .line-card { grid-template-columns: 1fr 1fr; }
  .login-story { padding: 35px 28px; }
  .login-panel { padding: 32px 18px; }
  .login-story h1 { font-size: 46px; }
}

/* Global UX feedback */
button,
a,
.button {
  -webkit-tap-highlight-color: transparent;
}

button,
.button,
.icon-button {
  position: relative;
  overflow: hidden;
}

button:not(:disabled):active,
.button:not([aria-disabled="true"]):active,
.icon-button:not(:disabled):active {
  transform: scale(.97);
}

button:focus-visible,
a:focus-visible,
.button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 3px solid rgba(37, 99, 235, .28);
  outline-offset: 3px;
}

button:disabled,
.button[aria-disabled="true"],
form[aria-busy="true"] button[type="submit"] {
  cursor: wait;
  opacity: .68;
  pointer-events: none;
}

button[data-ux-pending="true"] {
  color: transparent !important;
}

button[data-ux-pending="true"]::after {
  content: "";
  position: absolute;
  width: 17px;
  height: 17px;
  inset: 0;
  margin: auto;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  color: white;
  animation: ux-spin .7s linear infinite;
}

.button-secondary[data-ux-pending="true"]::after {
  color: var(--blue-600);
}

.ux-feedback {
  position: fixed;
  z-index: 1000;
  top: 22px;
  left: 50%;
  width: min(460px, calc(100vw - 32px));
  min-height: 58px;
  padding: 11px 13px;
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--navy-900);
  background: rgba(255, 255, 255, .76);
  border: 1px solid rgba(203, 213, 225, .72);
  border-radius: 17px;
  box-shadow:
    0 18px 55px rgba(15, 23, 42, .18),
    inset 0 1px 0 rgba(255, 255, 255, .78);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  transform: translate(-50%, -24px) scale(.96);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity .22s ease,
    transform .28s cubic-bezier(.2, .85, .25, 1);
}

.ux-feedback-visible {
  transform: translate(-50%, 0) scale(1);
  opacity: 1;
  pointer-events: auto;
}

.ux-feedback > span:nth-child(2) {
  flex: 1;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.4;
}

.ux-feedback-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--blue-100);
  color: var(--blue-600);
}

.ux-feedback-success .ux-feedback-icon {
  color: #047857;
  background: #d1fae5;
}

.ux-feedback-error .ux-feedback-icon {
  color: #b91c1c;
  background: var(--red-100);
}

.ux-feedback-info .ux-feedback-icon {
  color: var(--blue-600);
  background: var(--blue-100);
}

.ux-feedback-loading .ux-feedback-icon {
  color: var(--teal-600);
  background: var(--teal-100);
}

.ux-feedback > button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: var(--slate-500);
  background: transparent;
}

.ux-feedback > button:hover {
  color: var(--navy-900);
  background: rgba(241, 245, 249, .9);
}

.ux-navigation-progress {
  position: fixed;
  z-index: 1100;
  top: 0;
  left: 0;
  width: 0;
  height: 3px;
  opacity: 0;
  background: linear-gradient(
    90deg,
    var(--blue-600),
    #60a5fa,
    var(--teal-600)
  );
  box-shadow: 0 0 15px rgba(37, 99, 235, .55);
  transition: opacity .15s ease;
}

html[data-ux-navigating="true"] .ux-navigation-progress {
  width: 78%;
  opacity: 1;
  animation: ux-progress 7.5s cubic-bezier(.1, .6, .2, 1) forwards;
}

.ux-confirm-backdrop {
  position: fixed;
  z-index: 1200;
  inset: 0;
  padding: 22px;
  display: grid;
  place-items: center;
  background: rgba(8, 26, 44, .27);
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
  animation: ux-fade-in .18s ease both;
}

.ux-confirm-dialog {
  width: min(440px, 100%);
  padding: 26px;
  display: grid;
  gap: 19px;
  color: var(--slate-950);
  background: rgba(255, 255, 255, .9);
  border: 1px solid rgba(255, 255, 255, .75);
  border-radius: 24px;
  box-shadow:
    0 30px 90px rgba(8, 26, 44, .28),
    inset 0 1px 0 rgba(255, 255, 255, .9);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  animation: ux-dialog-in .3s cubic-bezier(.18, .88, .28, 1.12) both;
}

.ux-confirm-symbol {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  color: #047857;
  background: #d1fae5;
  border-radius: 17px;
  box-shadow: 0 10px 25px rgba(15, 157, 138, .18);
}

.ux-confirm-symbol-danger {
  color: #b91c1c;
  background: var(--red-100);
  box-shadow: 0 10px 25px rgba(220, 38, 38, .14);
}

.ux-confirm-dialog h2 {
  margin: 0;
  color: var(--navy-900);
  font-size: 21px;
  letter-spacing: -.035em;
}

.ux-confirm-dialog p {
  margin: 7px 0 0;
  color: var(--slate-600);
  font-size: 13px;
  line-height: 1.6;
}

.ux-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.ux-spin {
  animation: ux-spin .72s linear infinite;
}

@keyframes ux-spin {
  to { transform: rotate(360deg); }
}

@keyframes ux-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ux-dialog-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(.94);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes ux-progress {
  0% { width: 4%; }
  25% { width: 38%; }
  60% { width: 68%; }
  100% { width: 88%; }
}

@media (max-width: 600px) {
  .ux-feedback {
    top: 12px;
    min-height: 54px;
  }

  .ux-confirm-dialog {
    padding: 22px;
    border-radius: 20px;
  }

  .ux-confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}


/* Purchase request validation UX */
.request-error-summary {
  margin-bottom: 18px;
  padding: 16px 18px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: #991b1b;
  background: linear-gradient(135deg, #fff1f2, #fff7f7);
  border: 1px solid #fecaca;
  border-left: 4px solid var(--red-600);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(220, 38, 38, .08);
}

.request-error-summary > svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--red-600);
}

.request-error-summary strong {
  display: block;
  color: #991b1b;
  font-size: 13px;
}

.request-error-summary p {
  margin: 4px 0 8px;
  color: #b91c1c;
  font-size: 11px;
  line-height: 1.45;
}

.request-error-summary ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
  font-size: 11px;
  line-height: 1.45;
}

.request-input-error,
.request-input-error:focus {
  border-color: var(--red-600) !important;
  background: #fff7f7 !important;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, .1) !important;
}

.request-field-error-message,
.request-section-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: #b91c1c;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.45;
}

.request-field-error-message svg,
.request-section-error svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.request-section-error {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--red-100);
  border: 1px solid #fecaca;
  border-radius: 10px;
}

.request-product-error {
  padding: 8px;
  border: 2px solid rgba(220, 38, 38, .55);
  border-radius: 16px;
  background: rgba(254, 226, 226, .22);
}

.request-date-control {
  position: relative;
}

.request-date-control > svg {
  position: absolute;
  z-index: 2;
  left: 12px;
  top: 50%;
  color: var(--blue-600);
  pointer-events: none;
  transform: translateY(-50%);
}

.request-date-control input {
  padding-left: 40px;
  padding-right: 12px;
  cursor: pointer;
  background:
    linear-gradient(135deg, rgba(239, 246, 255, .7), white);
}

.request-date-control input::-webkit-calendar-picker-indicator {
  width: 20px;
  height: 20px;
  cursor: pointer;
  opacity: .72;
}

.request-date-control input:hover {
  border-color: #93c5fd;
}

.request-date-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.request-date-shortcuts button {
  min-height: 28px;
  padding: 0 10px;
  color: var(--blue-600);
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  transition: .16s ease;
}

.request-date-shortcuts button:hover {
  color: white;
  background: var(--blue-600);
  border-color: var(--blue-600);
  transform: translateY(-1px);
}

.request-submit-actions {
  margin-top: 22px;
  padding-top: 18px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-top: 1px solid var(--slate-200);
}

.request-submit-actions > span {
  max-width: 520px;
  color: var(--slate-500);
  font-size: 10px;
  line-height: 1.45;
}

@media (max-width: 760px) {
  .request-submit-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .request-submit-actions .button {
    width: 100%;
  }
}

/* Shopping-style procurement catalog */
.catalog-shop {
  margin-top: 14px;
}

.catalog-search-shell {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 56px;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, .07);
  transition:
    border-color .18s ease,
    box-shadow .18s ease;
}

.catalog-search-shell:focus-within {
  border-color: var(--blue-600);
  box-shadow:
    0 0 0 4px rgba(37, 99, 235, .1),
    0 12px 32px rgba(15, 23, 42, .08);
}

.catalog-search-shell > svg {
  position: absolute;
  left: 18px;
  color: var(--slate-500);
  pointer-events: none;
}

.catalog-search-shell input {
  width: 100%;
  min-height: 56px;
  padding: 0 52px;
  color: var(--navy-900);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14px;
  font-weight: 600;
}

.catalog-search-shell input::placeholder {
  color: var(--slate-400);
  font-weight: 500;
}

.catalog-search-clear {
  position: absolute;
  right: 14px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--slate-500);
  background: var(--slate-100);
  border: 0;
  border-radius: 50%;
}

.catalog-search-clear:hover {
  color: var(--navy-900);
  background: var(--slate-200);
}

.catalog-category-section {
  margin-top: 22px;
}

.catalog-section-heading {
  margin-bottom: 10px;
  display: flex;
  align-items: end;
  justify-content: space-between;
}

.catalog-section-heading span {
  color: var(--blue-600);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.catalog-section-heading h3 {
  margin: 3px 0 0;
  color: var(--navy-900);
  font-size: 17px;
}

.catalog-category-strip {
  padding-bottom: 6px;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(160px, 1fr);
  gap: 10px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.catalog-category-card {
  min-height: 82px;
  padding: 14px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-direction: column;
  text-align: left;
  color: var(--navy-900);
  background:
    linear-gradient(145deg, white, #f8fafc);
  border: 1px solid var(--slate-200);
  border-radius: 14px;
  transition:
    transform .18s ease,
    border-color .18s ease,
    box-shadow .18s ease,
    background .18s ease;
}

.catalog-category-card:hover {
  transform: translateY(-2px);
  border-color: #93c5fd;
  box-shadow: 0 10px 24px rgba(15, 23, 42, .08);
}

.catalog-category-card.is-active {
  color: white;
  background:
    linear-gradient(135deg, var(--blue-600), #1d4ed8);
  border-color: var(--blue-600);
  box-shadow: 0 12px 26px rgba(37, 99, 235, .22);
}

.catalog-category-card span {
  font-size: 12px;
  font-weight: 850;
  line-height: 1.35;
}

.catalog-category-card small {
  color: var(--slate-500);
  font-size: 9px;
}

.catalog-category-card.is-active small {
  color: rgba(255, 255, 255, .78);
}

.catalog-toolbar {
  margin-top: 22px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: #f8fafc;
  border: 1px solid var(--slate-200);
  border-radius: 14px;
}

.catalog-toolbar > div:first-child {
  display: grid;
  gap: 2px;
}

.catalog-toolbar strong {
  color: var(--navy-900);
  font-size: 12px;
}

.catalog-toolbar span {
  color: var(--slate-500);
  font-size: 9px;
}

.catalog-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.catalog-filter-toggle {
  display: none;
}

.catalog-sort {
  display: flex;
  align-items: center;
  gap: 8px;
}

.catalog-sort > span {
  color: var(--slate-500);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
}

.catalog-sort select {
  min-width: 180px;
  min-height: 38px;
  padding: 0 34px 0 11px;
  color: var(--navy-900);
  background-color: white;
  border: 1px solid var(--slate-200);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 750;
}

.catalog-filter-chips {
  margin-top: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.catalog-filter-chips button {
  min-height: 30px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #1e40af;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
}

.catalog-filter-chips button:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.catalog-filter-chips .catalog-clear-filters {
  color: #b91c1c;
  background: #fff1f2;
  border-color: #fecaca;
}

.catalog-layout {
  position: relative;
  margin-top: 14px;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.catalog-filter-panel {
  position: sticky;
  top: 18px;
  max-height: calc(100vh - 36px);
  padding: 16px;
  overflow-y: auto;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .05);
}

.catalog-filter-header {
  padding-bottom: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--slate-200);
}

.catalog-filter-header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.catalog-filter-header svg {
  color: var(--blue-600);
}

.catalog-filter-header strong {
  color: var(--navy-900);
  font-size: 12px;
}

.catalog-filter-close {
  display: none;
}

.catalog-facet-group {
  margin: 0;
  padding: 15px 0;
  border: 0;
  border-bottom: 1px solid var(--slate-100);
}

.catalog-facet-group legend {
  margin-bottom: 9px;
  color: var(--navy-900);
  font-size: 10px;
  font-weight: 850;
}

.catalog-facet-options {
  max-height: 190px;
  display: grid;
  gap: 7px;
  overflow-y: auto;
}

.catalog-facet-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}

.catalog-facet-option input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--blue-600);
}

.catalog-facet-option span {
  min-width: 0;
  overflow: hidden;
  color: var(--slate-700);
  font-size: 10px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-facet-option small {
  min-width: 24px;
  padding: 2px 5px;
  color: var(--slate-500);
  background: var(--slate-100);
  border-radius: 999px;
  font-size: 8px;
  text-align: center;
}

.catalog-price-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.catalog-price-inputs label,
.catalog-facet-group > label {
  display: grid;
  gap: 5px;
  color: var(--slate-600);
  font-size: 8px;
  font-weight: 800;
}

.catalog-price-inputs input,
.catalog-facet-group > label input {
  min-width: 0;
  min-height: 36px;
  padding: 0 9px;
  font-size: 10px;
}

.catalog-filter-panel > .button {
  width: 100%;
  margin-top: 14px;
  justify-content: center;
}

.catalog-filter-backdrop {
  display: none;
}

.catalog-results {
  min-width: 0;
}

.catalog-product-grid {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 14px;
  transition: opacity .18s ease;
}

.catalog-product-grid.is-loading {
  opacity: .42;
  pointer-events: none;
}

.catalog-product-card {
  min-width: 0;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, .045);
  transition:
    transform .18s ease,
    border-color .18s ease,
    box-shadow .18s ease;
}

.catalog-product-card:hover {
  transform: translateY(-3px);
  border-color: #bfdbfe;
  box-shadow: 0 14px 30px rgba(15, 23, 42, .1);
}

.catalog-product-card.is-selected {
  border-color: var(--blue-600);
  box-shadow:
    0 0 0 2px rgba(37, 99, 235, .08),
    0 12px 28px rgba(37, 99, 235, .12);
}

.catalog-product-image {
  position: relative;
  min-height: 180px;
  overflow: hidden;
  background: #f8fafc;
}

.catalog-product-image > * {
  width: 100%;
  height: 100%;
}

.catalog-product-image img {
  width: 100%;
  height: 180px;
  display: block;
  object-fit: cover;
  transition: transform .25s ease;
}

.catalog-product-card:hover .catalog-product-image img {
  transform: scale(1.035);
}

.catalog-selected-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  min-height: 27px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: white;
  background: var(--blue-600);
  border-radius: 999px;
  box-shadow: 0 8px 18px rgba(37, 99, 235, .24);
  font-size: 8px;
  font-weight: 850;
}

.catalog-product-content {
  min-height: 270px;
  padding: 14px;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.catalog-product-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.catalog-product-meta span {
  min-width: 0;
  overflow: hidden;
  color: var(--blue-600);
  font-size: 8px;
  font-weight: 850;
  letter-spacing: .04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.catalog-product-meta small {
  flex: 0 0 auto;
  color: var(--slate-400);
  font-size: 8px;
}

.catalog-product-content h3 {
  margin: 8px 0 0;
  color: var(--navy-900);
  font-size: 13px;
  line-height: 1.38;
}

.catalog-product-variant {
  min-height: 18px;
  margin: 5px 0 0;
  color: var(--slate-500);
  font-size: 9px;
}

.catalog-product-price {
  margin-top: 13px;
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.catalog-product-price strong {
  color: var(--navy-900);
  font-size: 16px;
}

.catalog-product-price span {
  color: var(--slate-500);
  font-size: 8px;
}

.catalog-product-details {
  margin: 12px 0 14px;
  padding: 9px 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  border-top: 1px solid var(--slate-100);
  border-bottom: 1px solid var(--slate-100);
}

.catalog-product-details div {
  min-width: 0;
}

.catalog-product-details dt {
  color: var(--slate-400);
  font-size: 7px;
  font-weight: 850;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.catalog-product-details dd {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--slate-700);
  font-size: 9px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-product-content > .button {
  width: 100%;
  margin-top: auto;
  justify-content: center;
}

.catalog-empty-state {
  min-height: 280px;
  padding: 34px 20px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--slate-500);
  text-align: center;
  background: #f8fafc;
  border: 1px dashed var(--slate-300);
  border-radius: 16px;
}

.catalog-empty-state svg {
  color: var(--blue-600);
}

.catalog-empty-state strong {
  color: var(--navy-900);
  font-size: 15px;
}

.catalog-empty-state p {
  margin: 0;
  font-size: 10px;
}

.catalog-empty-state > div {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.catalog-load-more {
  margin-top: 18px;
  padding: 14px;
  display: grid;
  place-items: center;
  gap: 9px;
  background: #f8fafc;
  border: 1px solid var(--slate-200);
  border-radius: 14px;
}

.catalog-load-more span {
  color: var(--slate-500);
  font-size: 9px;
}

.catalog-spinner {
  animation: ux-spin .72s linear infinite;
}

/* Shopping request cart */
.request-cart-panel {
  margin-top: 22px;
  overflow: hidden;
}

.request-cart-heading {
  padding-bottom: 13px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--slate-200);
}

.request-cart-heading span {
  color: var(--blue-600);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.request-cart-heading h2 {
  margin: 3px 0 0;
}

.request-cart-heading > strong {
  padding: 6px 10px;
  color: #1e40af;
  background: #eff6ff;
  border-radius: 999px;
  font-size: 9px;
}

.request-cart-lines {
  display: grid;
}

.request-cart-line {
  padding: 14px 0;
  display: grid;
  grid-template-columns:
    minmax(180px, 1.5fr)
    105px
    minmax(170px, 1fr)
    120px;
  align-items: end;
  gap: 12px;
  border-bottom: 1px solid var(--slate-100);
}

.request-cart-product {
  display: grid;
  align-self: center;
  gap: 3px;
}

.request-cart-product strong {
  color: var(--navy-900);
  font-size: 11px;
}

.request-cart-product span,
.request-cart-product small {
  color: var(--slate-500);
  font-size: 8px;
}

.request-cart-quantity,
.request-cart-specification {
  display: grid;
  gap: 5px;
  color: var(--slate-600);
  font-size: 8px;
  font-weight: 800;
}

.request-cart-quantity input,
.request-cart-specification input {
  min-height: 38px;
  font-size: 10px;
}

.request-cart-quantity small {
  color: var(--slate-400);
  font-size: 7px;
}

.request-cart-line-total {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 2px 7px;
  text-align: right;
}

.request-cart-line-total > span {
  grid-column: 1;
  color: var(--slate-400);
  font-size: 7px;
  font-weight: 800;
  text-transform: uppercase;
}

.request-cart-line-total > strong {
  grid-column: 1;
  color: var(--navy-900);
  font-size: 11px;
}

.request-cart-line-total .icon-button {
  grid-column: 2;
  grid-row: 1 / span 2;
  color: #b91c1c;
  background: #fff1f2;
}

.request-cart-total {
  padding-top: 15px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
}

.request-cart-total span {
  color: var(--slate-500);
  font-size: 9px;
  font-weight: 750;
}

.request-cart-total strong {
  color: var(--navy-900);
  font-size: 18px;
}

@media (max-width: 1180px) {
  .catalog-product-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .request-cart-line {
    grid-template-columns:
      minmax(180px, 1fr)
      95px
      minmax(150px, 1fr);
  }

  .request-cart-line-total {
    grid-column: 1 / -1;
    grid-template-columns: 1fr auto;
    justify-self: stretch;
  }
}

@media (max-width: 900px) {
  .catalog-layout {
    grid-template-columns: 1fr;
  }

  .catalog-filter-toggle {
    display: inline-flex;
  }

  .catalog-filter-backdrop {
    position: fixed;
    z-index: 119;
    inset: 0;
    display: block;
    visibility: hidden;
    opacity: 0;
    background: rgba(15, 23, 42, .48);
    border: 0;
    transition:
      opacity .2s ease,
      visibility .2s ease;
  }

  .catalog-filter-backdrop.is-visible {
    visibility: visible;
    opacity: 1;
  }

  .catalog-filter-panel {
    position: fixed;
    z-index: 120;
    top: 0;
    right: 0;
    width: min(360px, 90vw);
    height: 100vh;
    max-height: none;
    padding: 20px;
    visibility: hidden;
    border-radius: 0;
    box-shadow: -18px 0 45px rgba(15, 23, 42, .2);
    transform: translateX(105%);
    transition:
      transform .22s ease,
      visibility .22s ease;
  }

  .catalog-filter-panel.is-open {
    visibility: visible;
    transform: translateX(0);
  }

  .catalog-filter-close {
    display: grid;
  }
}

@media (max-width: 700px) {
  .catalog-search-shell,
  .catalog-search-shell input {
    min-height: 52px;
  }

  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .catalog-toolbar-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .catalog-toolbar-actions .button,
  .catalog-sort,
  .catalog-sort select {
    width: 100%;
  }

  .catalog-sort {
    display: block;
  }

  .catalog-sort > span {
    display: none;
  }

  .catalog-product-grid {
    grid-template-columns: 1fr;
  }

  .catalog-product-card {
    display: grid;
    grid-template-columns: 145px minmax(0, 1fr);
  }

  .catalog-product-image {
    min-height: 100%;
  }

  .catalog-product-image img {
    height: 100%;
    min-height: 250px;
  }

  .catalog-product-content {
    min-height: 250px;
    padding: 13px;
  }

  .catalog-product-details {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .request-cart-line {
    grid-template-columns: 1fr 95px;
  }

  .request-cart-product,
  .request-cart-specification {
    grid-column: 1 / -1;
  }

  .request-cart-line-total {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .catalog-category-strip {
    grid-auto-columns: minmax(145px, 72vw);
  }

  .catalog-toolbar-actions {
    grid-template-columns: 1fr;
  }

  .catalog-product-card {
    display: flex;
  }

  .catalog-product-image,
  .catalog-product-image img {
    min-height: 190px;
    height: 190px;
  }

  .catalog-product-content {
    min-height: 270px;
  }

  .catalog-empty-state > div {
    width: 100%;
    flex-direction: column;
  }

  .request-cart-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .request-cart-line {
    grid-template-columns: 1fr;
  }

  .request-cart-product,
  .request-cart-quantity,
  .request-cart-specification,
  .request-cart-line-total {
    grid-column: 1;
  }

  .request-cart-total {
    align-items: flex-end;
    flex-direction: column;
    gap: 3px;
  }
}

/* Visual Shop department navigation */
.shop-hub {
  display: grid;
  gap: 26px;
}

.shop-search-hero {
  position: relative;
  padding: 28px;
  overflow: hidden;
  color: white;
  background:
    radial-gradient(circle at 86% 15%, rgba(96, 165, 250, .38), transparent 28%),
    radial-gradient(circle at 8% 90%, rgba(45, 212, 191, .2), transparent 32%),
    linear-gradient(135deg, #0f172a 0%, #172554 55%, #1e3a8a 100%);
  border-radius: 24px;
  box-shadow: 0 22px 55px rgba(15, 23, 42, .2);
}

.shop-search-copy {
  max-width: 650px;
}

.shop-search-copy > span {
  color: #93c5fd;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.shop-search-copy h2 {
  margin: 6px 0 8px;
  color: white;
  font-size: clamp(24px, 3vw, 36px);
  letter-spacing: -.045em;
  line-height: 1.1;
}

.shop-search-copy p {
  margin: 0;
  color: rgba(255, 255, 255, .72);
  font-size: 12px;
  line-height: 1.6;
}

.shop-search-box {
  position: relative;
  margin-top: 22px;
  max-width: 760px;
  min-height: 58px;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, .98);
  border: 1px solid rgba(255, 255, 255, .5);
  border-radius: 16px;
  box-shadow: 0 14px 35px rgba(15, 23, 42, .24);
}

.shop-search-box > svg {
  position: absolute;
  left: 18px;
  color: #2563eb;
  pointer-events: none;
}

.shop-search-box input {
  width: 100%;
  min-height: 58px;
  padding: 0 54px;
  color: var(--navy-900);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14px;
  font-weight: 650;
}

.shop-search-box input::placeholder {
  color: var(--slate-400);
  font-weight: 500;
}

.shop-search-box button {
  position: absolute;
  right: 14px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--slate-500);
  background: var(--slate-100);
  border: 0;
  border-radius: 999px;
}

.shop-search-box button:hover {
  color: var(--navy-900);
  background: var(--slate-200);
}

.shop-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  color: var(--slate-400);
  font-size: 10px;
}

.shop-breadcrumb button {
  padding: 3px 5px;
  color: var(--blue-600);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
}

.shop-breadcrumb button:hover {
  background: #eff6ff;
}

.shop-breadcrumb span {
  color: var(--slate-700);
  font-weight: 750;
}

.shop-section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.shop-section-heading > div > span {
  color: var(--blue-600);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .13em;
  text-transform: uppercase;
}

.shop-section-heading h2 {
  margin: 4px 0 0;
  color: var(--navy-900);
  font-size: 22px;
  letter-spacing: -.035em;
}

.shop-section-heading p {
  margin: 5px 0 0;
  color: var(--slate-500);
  font-size: 11px;
}

.shop-section-heading > strong {
  padding: 7px 11px;
  color: #1e40af;
  background: #eff6ff;
  border-radius: 999px;
  font-size: 9px;
}

/* Large image-led department squares */
.shop-department-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.shop-department-card {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  text-align: left;
  color: inherit;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
  transition:
    transform .22s ease,
    box-shadow .22s ease,
    border-color .22s ease;
}

.shop-department-card:hover {
  transform: translateY(-5px);
  border-color: #93c5fd;
  box-shadow: 0 20px 42px rgba(15, 23, 42, .13);
}

.shop-department-card:focus-visible {
  outline: 3px solid rgba(37, 99, 235, .28);
  outline-offset: 3px;
}

.shop-department-image {
  position: relative;
  aspect-ratio: 1 / .78;
  overflow: hidden;
  background: #f8fafc;
}

.shop-department-image > div {
  width: 100%;
  height: 100%;
  aspect-ratio: auto !important;
  border-bottom: 0 !important;
}

.shop-department-image img {
  width: 100%;
  height: 100%;
  padding: 0 !important;
  object-fit: cover !important;
  transition: transform .35s ease;
}

.shop-department-card:hover .shop-department-image img {
  transform: scale(1.045);
}

.shop-department-count {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 6px 9px;
  color: white;
  background: rgba(15, 23, 42, .76);
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 999px;
  backdrop-filter: blur(10px);
  font-size: 8px;
  font-weight: 850;
}

.shop-department-content {
  min-height: 205px;
  padding: 17px;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.shop-department-content h3 {
  margin: 0;
  color: var(--navy-900);
  font-size: 17px;
  letter-spacing: -.025em;
  line-height: 1.25;
}

.shop-subcategory-preview {
  margin-top: 13px;
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
}

.shop-subcategory-preview span {
  padding: 5px 8px;
  color: var(--slate-600);
  background: var(--slate-100);
  border-radius: 999px;
  font-size: 8px;
  font-weight: 700;
  line-height: 1.2;
}

.shop-department-action {
  margin-top: auto;
  padding-top: 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--blue-600);
  border-top: 1px solid var(--slate-100);
  font-size: 10px;
  font-weight: 850;
}

/* Category landing page */
.shop-category-banner {
  padding: 22px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  background:
    linear-gradient(135deg, #eff6ff 0%, #f8fafc 55%, #ecfeff 100%);
  border: 1px solid #bfdbfe;
  border-radius: 20px;
}

.shop-back-button {
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--slate-700);
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 10px;
  font-size: 9px;
  font-weight: 800;
}

.shop-category-banner > div > span {
  color: var(--blue-600);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.shop-category-banner h2 {
  margin: 4px 0;
  color: var(--navy-900);
  font-size: 23px;
  letter-spacing: -.035em;
}

.shop-category-banner p {
  margin: 0;
  color: var(--slate-500);
  font-size: 10px;
  line-height: 1.5;
}

/* Image-led subcategory squares */
.shop-subcategory-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.shop-subcategory-card {
  min-width: 0;
  min-height: 230px;
  padding: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: minmax(145px, 1fr) auto;
  position: relative;
  text-align: left;
  color: inherit;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 17px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, .05);
  transition:
    transform .2s ease,
    box-shadow .2s ease,
    border-color .2s ease;
}

.shop-subcategory-card:hover {
  transform: translateY(-4px);
  border-color: #93c5fd;
  box-shadow: 0 16px 34px rgba(15, 23, 42, .11);
}

.shop-subcategory-image {
  min-height: 145px;
  overflow: hidden;
  background: #f8fafc;
}

.shop-subcategory-image > div {
  width: 100%;
  height: 100%;
  aspect-ratio: auto !important;
  border-bottom: 0 !important;
}

.shop-subcategory-image img {
  width: 100%;
  height: 100%;
  padding: 0 !important;
  object-fit: cover !important;
  transition: transform .3s ease;
}

.shop-subcategory-card:hover .shop-subcategory-image img {
  transform: scale(1.05);
}

.shop-subcategory-card > div:nth-child(2) {
  padding: 14px 42px 14px 14px;
}

.shop-subcategory-card h3 {
  margin: 0;
  color: var(--navy-900);
  font-size: 13px;
  line-height: 1.3;
}

.shop-subcategory-card span {
  display: block;
  margin-top: 4px;
  color: var(--slate-500);
  font-size: 8px;
}

.shop-subcategory-card > svg {
  position: absolute;
  right: 14px;
  bottom: 20px;
  color: var(--blue-600);
}

/* Product-list view inside Shop */
.shop-product-view {
  display: grid;
  gap: 16px;
}

.shop-product-toolbar {
  padding: 14px 16px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 15px;
}

.shop-product-toolbar > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.shop-product-toolbar button {
  width: fit-content;
  padding: 3px 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--blue-600);
  background: transparent;
  border: 0;
  font-size: 9px;
  font-weight: 850;
}

.shop-product-toolbar h2 {
  margin: 0;
  color: var(--navy-900);
  font-size: 20px;
  letter-spacing: -.03em;
}

.shop-product-toolbar span {
  color: var(--slate-500);
  font-size: 9px;
}

.shop-product-toolbar > label {
  min-width: 190px;
  display: grid;
  gap: 5px;
  color: var(--slate-500);
  font-size: 8px;
  font-weight: 850;
  text-transform: uppercase;
}

.shop-product-toolbar select {
  min-height: 39px;
  padding: 0 34px 0 11px;
  color: var(--navy-900);
  background-color: #f8fafc;
  border: 1px solid var(--slate-200);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

.shop-product-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 15px;
  transition: opacity .18s ease;
}

.shop-product-grid.is-loading {
  opacity: .42;
  pointer-events: none;
}

.shop-product-card {
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 17px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, .05);
  transition:
    transform .18s ease,
    box-shadow .18s ease,
    border-color .18s ease;
}

.shop-product-card:hover {
  transform: translateY(-3px);
  border-color: #bfdbfe;
  box-shadow: 0 15px 32px rgba(15, 23, 42, .1);
}

.shop-product-image {
  min-height: 175px;
  overflow: hidden;
  background: #f8fafc;
}

.shop-product-image > div {
  width: 100%;
  height: 100%;
  aspect-ratio: 4 / 3 !important;
}

.shop-product-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.shop-product-content {
  min-height: 255px;
  padding: 14px;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.shop-product-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.shop-product-meta span {
  min-width: 0;
  overflow: hidden;
  color: var(--blue-600);
  font-size: 7px;
  font-weight: 900;
  letter-spacing: .05em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.shop-product-meta small {
  flex: 0 0 auto;
  color: var(--slate-400);
  font-size: 7px;
}

.shop-product-content h3 {
  margin: 8px 0 0;
  color: var(--navy-900);
  font-size: 13px;
  line-height: 1.35;
}

.shop-product-content > p {
  min-height: 17px;
  margin: 5px 0 0;
  color: var(--slate-500);
  font-size: 8px;
}

.shop-product-price {
  margin-top: 13px;
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.shop-product-price strong {
  color: var(--navy-900);
  font-size: 17px;
}

.shop-product-price span {
  color: var(--slate-500);
  font-size: 8px;
}

.shop-product-facts {
  margin: 11px 0 14px;
  padding: 9px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  color: var(--slate-600);
  border-top: 1px solid var(--slate-100);
  border-bottom: 1px solid var(--slate-100);
  font-size: 8px;
  font-weight: 750;
}

.shop-product-content > .button {
  width: 100%;
  margin-top: auto;
  justify-content: center;
}

.shop-empty-state {
  min-height: 300px;
  padding: 36px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--slate-500);
  text-align: center;
  background: #f8fafc;
  border: 1px dashed var(--slate-300);
  border-radius: 18px;
}

.shop-empty-state svg {
  color: var(--blue-600);
}

.shop-empty-state strong {
  color: var(--navy-900);
  font-size: 15px;
}

.shop-empty-state p {
  margin: 0;
  font-size: 10px;
}

.shop-load-more {
  padding: 14px;
  display: grid;
  place-items: center;
  gap: 8px;
  background: #f8fafc;
  border: 1px solid var(--slate-200);
  border-radius: 14px;
}

.shop-load-more span {
  color: var(--slate-500);
  font-size: 9px;
}

@media (max-width: 1250px) {
  .shop-department-grid,
  .shop-subcategory-grid,
  .shop-product-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 940px) {
  .shop-department-grid,
  .shop-subcategory-grid,
  .shop-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .shop-category-banner {
    grid-template-columns: 1fr auto;
  }

  .shop-category-banner .shop-back-button {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 680px) {
  .shop-search-hero {
    padding: 21px;
    border-radius: 19px;
  }

  .shop-search-box,
  .shop-search-box input {
    min-height: 53px;
  }

  .shop-section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .shop-department-grid {
    gap: 12px;
  }

  .shop-department-content {
    min-height: 185px;
    padding: 13px;
  }

  .shop-department-content h3 {
    font-size: 14px;
  }

  .shop-subcategory-preview {
    gap: 4px;
  }

  .shop-subcategory-preview span:nth-child(n+4) {
    display: none;
  }

  .shop-category-banner {
    grid-template-columns: 1fr;
  }

  .shop-category-banner > .button {
    width: 100%;
    justify-content: center;
  }

  .shop-product-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .shop-product-toolbar > label,
  .shop-product-toolbar select {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .shop-department-grid,
  .shop-subcategory-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }

  .shop-department-image {
    aspect-ratio: 1 / .82;
  }

  .shop-department-count {
    top: 7px;
    right: 7px;
    padding: 4px 6px;
    font-size: 7px;
  }

  .shop-department-content {
    min-height: 155px;
    padding: 10px;
  }

  .shop-department-content h3 {
    font-size: 12px;
  }

  .shop-subcategory-preview {
    margin-top: 8px;
  }

  .shop-subcategory-preview span {
    padding: 4px 6px;
    font-size: 7px;
  }

  .shop-department-action {
    padding-top: 10px;
    font-size: 8px;
  }

  .shop-subcategory-card {
    min-height: 190px;
    grid-template-rows: 118px auto;
  }

  .shop-subcategory-image {
    min-height: 118px;
  }

  .shop-subcategory-card > div:nth-child(2) {
    padding: 10px 30px 10px 10px;
  }

  .shop-subcategory-card h3 {
    font-size: 10px;
  }

  .shop-subcategory-card > svg {
    right: 8px;
    bottom: 15px;
  }

  .shop-product-grid {
    grid-template-columns: 1fr;
  }

  .shop-product-card {
    display: grid;
    grid-template-columns: 135px minmax(0, 1fr);
  }

  .shop-product-image {
    min-height: 100%;
  }

  .shop-product-image > div {
    min-height: 100%;
    aspect-ratio: auto !important;
    border-bottom: 0 !important;
    border-right: 1px solid var(--slate-200);
  }

  .shop-product-content {
    min-height: 235px;
    padding: 12px;
  }

  .shop-product-price strong {
    font-size: 14px;
  }

  .shop-product-facts {
    align-items: flex-start;
    flex-direction: column;
  }
}


.route-loading-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at 20% 20%, rgba(37, 99, 235, .10), transparent 34%),
    linear-gradient(160deg, #ffffff, #f8fbff);
}

.route-loading-card {
  width: min(420px, 100%);
  min-height: 260px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 17px;
  padding: 34px;
  text-align: center;
  color: var(--navy-900);
  background: rgba(255, 255, 255, .9);
  border: 1px solid var(--slate-200);
  border-radius: 24px;
  box-shadow: 0 28px 80px rgba(15, 42, 67, .12);
}

.route-loading-card strong {
  font-size: 18px;
}

.route-loading-card p {
  margin: 0;
  color: var(--slate-500);
  font-size: 13px;
}

.login-card button[type="submit"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

/* Persistent Shop request cart */
.shop-cart-bar {
  margin: 16px 0 20px;
  padding: 13px 15px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: 15px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
}

.shop-cart-bar.has-items {
  border-color: #bfdbfe;
  background: linear-gradient(135deg, #ffffff, #eff6ff);
}

.shop-cart-bar-icon {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: var(--blue-600);
  background: #eff6ff;
  border-radius: 12px;
}

.shop-cart-bar-icon span {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  color: white;
  background: var(--blue-600);
  border: 2px solid white;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 900;
}

.shop-cart-bar-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.shop-cart-bar-copy strong {
  color: var(--navy-900);
  font-size: 12px;
}

.shop-cart-bar-copy span {
  color: var(--slate-500);
  font-size: 9px;
}

.shop-cart-bar > .button {
  justify-content: center;
  white-space: nowrap;
}

.shop-cart-bar > .button[aria-disabled="true"] {
  opacity: .45;
  pointer-events: none;
}

.shop-product-content > button.button {
  width: 100%;
  margin-top: auto;
  justify-content: center;
}

@media (max-width: 680px) {
  .shop-cart-bar {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .shop-cart-bar > .button {
    grid-column: 1 / -1;
    width: 100%;
  }
}


/* Company request pricing settings */
.settings-pricing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.settings-pricing-card {
  padding: 16px;
  display: grid;
  gap: 14px;
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 15px;
}

.settings-pricing-card > div {
  display: grid;
  gap: 4px;
}

.settings-pricing-card > div strong {
  color: var(--navy-900);
  font-size: 13px;
}

.settings-pricing-card > div p {
  margin: 0;
  color: var(--slate-500);
  font-size: 9px;
}

.settings-pricing-card label {
  display: grid;
  gap: 6px;
}

.settings-pricing-card label > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--slate-700);
  font-size: 9px;
  font-weight: 800;
}

.settings-pricing-card label > span svg {
  color: var(--blue-600);
}

.settings-pricing-card input {
  min-height: 40px;
}

.settings-pricing-card small {
  color: var(--slate-500);
  font-size: 8px;
}

.settings-pricing-card > .button {
  justify-content: center;
}

@media (max-width: 820px) {
  .settings-pricing-grid {
    grid-template-columns: 1fr;
  }
}

/* Request cart review and estimated payment summary */
.request-cart-review-heading {
  margin-top: 24px;
  padding: 15px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: linear-gradient(135deg, #f8fafc, #eff6ff);
  border: 1px solid #bfdbfe;
  border-radius: 15px;
}

.request-cart-review-heading > div {
  display: grid;
  gap: 3px;
}

.request-cart-review-heading span {
  color: var(--blue-600);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.request-cart-review-heading h2 {
  margin: 0;
  color: var(--navy-900);
}

.request-cart-review-heading p {
  margin: 0;
  color: var(--slate-500);
  font-size: 9px;
}

.request-payment-summary {
  width: min(420px, 100%);
  margin: 18px 0 0 auto;
  padding: 15px;
  display: grid;
  gap: 10px;
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 14px;
}

.request-payment-summary > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.request-payment-summary span {
  color: var(--slate-500);
  font-size: 9px;
  font-weight: 750;
}

.request-payment-summary strong {
  color: var(--navy-900);
  font-size: 11px;
}

.request-payment-total {
  padding-top: 11px;
  border-top: 1px solid var(--slate-200);
}

.request-payment-total span {
  color: var(--navy-900);
  font-size: 10px;
}

.request-payment-total strong {
  font-size: 18px;
}

.request-payment-summary > p {
  margin: 2px 0 0;
  color: var(--slate-500);
  font-size: 8px;
  line-height: 1.5;
}

@media (max-width: 680px) {
  .request-cart-review-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .request-cart-review-heading > .button {
    justify-content: center;
  }

  .request-payment-summary {
    width: 100%;
  }
}
```

### `src/app/layout.tsx` (complete; global stylesheet import and provider mounting)

There is no visual theme provider. The root layout imports the global stylesheet and mounts only the UX feedback provider.

```tsx
import type { Metadata } from "next";
import { UxFeedbackProvider } from "@/components/UxFeedbackProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Axora operations", template: "%s | Axora operations" },
  description: "Secure multi-company procurement and operations management with Axora.",
  icons: {
    icon: [
      { url: "/brand/axora-mark.svg", type: "image/svg+xml" },
      { url: "/brand/axora-icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/brand/axora-icon-32.png",
    apple: [
      { url: "/brand/axora-apple-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <UxFeedbackProvider>{children}</UxFeedbackProvider>
      </body>
    </html>
  );
}
```
