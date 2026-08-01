# Extractable Superdesign Components

This catalog lists the existing Axora patterns that are suitable for reusable Superdesign `DraftComponent` extraction. Props below are deliberately limited to state, navigation, visibility, and counts. Content-only values from the React APIs are kept as hardcoded draft content unless a later extraction brief explicitly needs variants.

## Layout Components

### PortalShell
- Source: `src/app/(portal)/layout.tsx`
- Category: layout
- Description: Authenticated application shell combining the sticky sidebar, production-status top bar, user summary, sign-out action, and centered page content.
- Extractable props: `environment` (`"production" | "demo"`, default: `"production"`), `showUserSummary` (boolean, default: `true`)
- Hardcoded: 248px desktop sidebar, 72px top bar, Axora production/sample-data labels, role labels, sign-out icon and action placement, `portal-shell`, `portal-main`, `topbar`, and `content-shell` CSS.

### Sidebar
- Source: `src/components/Sidebar.tsx`
- Category: layout
- Description: Permission-aware navy navigation rail used throughout the authenticated portal.
- Extractable props: `activeItem` (string, default: `"dashboard"`; proposed design state because the current implementation does not yet render an active-route treatment), `ownerMode` (boolean, default: `false`), `visibleItems` (string array, default: all permitted items)
- Hardcoded: Axora brand lockup, navigation labels, Lucide icon choices, navigation URLs, secure-workspace footer copy, permission filtering behavior, navy-to-teal gradient, and all sidebar CSS.

### PortalTopBar
- Source: `src/app/(portal)/layout.tsx`
- Category: layout
- Description: Sticky environment and account bar embedded in the portal shell.
- Extractable props: `environment` (`"production" | "demo"`, default: `"production"`), `showUserSummary` (boolean, default: `true`), `showSignOut` (boolean, default: `true`)
- Hardcoded: Environment dot treatment, “Axora production” / “Safe sample data” labels, role-label vocabulary, LogOut icon, 72px height, translucent white surface, blur, and border styling.

### PageHeader
- Source: `src/components/PageHeader.tsx`
- Category: layout
- Description: Repeated page introduction with eyebrow, responsive title, description, and an optional primary action.
- Extractable props: `actionHref` (string, default: `"#"`), `showEyebrow` (boolean, default: `true`), `showAction` (boolean, default: `false`)
- Hardcoded: Selected draft’s eyebrow/title/description/action label, `Link` behavior, primary-button treatment, responsive stack at 760px, and all `page-heading` typography and spacing.

### UxFeedbackOverlay
- Source: `src/components/UxFeedbackProvider.tsx`
- Category: layout
- Description: Global glass feedback toast, navigation-progress indicator, and accessible confirmation overlay mounted by the root layout.
- Extractable props: `visible` (boolean, default: `true`), `tone` (`"loading" | "success" | "error" | "info"`, default: `"success"`), `confirmationOpen` (boolean, default: `false`), `destructive` (boolean, default: `false`)
- Hardcoded: Check/AlertTriangle/Info/LoaderCircle/X icon mapping, placement, auto-dismiss timing, focus and Escape behavior, backdrop, glass blur, animation curves, and all feedback CSS.

## Basic Components

### Brand
- Source: `src/components/Brand.tsx`
- Category: basic
- Description: Axora mark or full Axora Operations lockup used by login, loading, and sidebar surfaces.
- Extractable props: `compact` (boolean, default: `false`)
- Hardcoded: `/brand/axora-mark.svg`, “Axora” and “Operations” text, image sizes, priority loading, typography, teal label, radius, and logo shadow.

### ActionButton
- Source: `src/app/globals.css` (shared `.button` variants; representative markup in `src/components/PageHeader.tsx`)
- Category: basic
- Description: Shared primary, secondary, and danger action treatment used across portal pages and forms.
- Extractable props: `href` (string, default: `"#"`, for navigation form), `disabled` (boolean, default: `false`), `pending` (boolean, default: `false`)
- Hardcoded: Selected draft’s label and icon, 42px minimum height, 11px radius, 13px/750 typography, primary gradient and shadow, secondary border, danger red, hover lift, active scale, focus ring, and spinner treatment.

### MetricCard
- Source: `src/components/MetricCard.tsx`
- Category: basic
- Description: Dashboard KPI card with an icon tile, uppercase label, large value, supporting note, and blue/teal/orange/navy tone.
- Extractable props: none (the current `label`, `value`, `note`, `icon`, and `tone` inputs are content or visual choices rather than state/navigation props)
- Hardcoded: Selected draft’s metric copy, value, Lucide icon and tone; 166px minimum height, 18px radius, white surface, decorative corner circle, and metric typography.

### StatusBadge
- Source: `src/components/StatusBadge.tsx`
- Category: basic
- Description: Compact semantic status pill shared by company, branch, request, delivery, finance, product, sourcing, and user views.
- Extractable props: `status` (string, default: `"Active"`)
- Hardcoded: `statusTone` domain mapping, success/danger/warning/info/neutral palette, 25px minimum height, pill radius, and 10px/800 typography.

### ProductImage
- Source: `src/components/ProductImage.tsx`
- Category: basic
- Description: Product gallery image with safe illustrated category fallback and optional carousel controls.
- Extractable props: `showControls` (boolean, default: `true`), `activeIndex` (number, default: `0`), `hasImage` (boolean, default: `true`)
- Hardcoded: Product image API route, five-second carousel interval, Chevron controls, category-to-artwork color/icon map, image counter, primary badge, placeholder composition, and inline/CSS presentation.

### RequestPricingSummary
- Source: `src/components/RequestPricingSummary.tsx`
- Category: basic
- Description: Shared financial breakdown block used on approval and purchase-request detail screens.
- Extractable props: none (amounts and labels are content data rather than state/navigation props)
- Hardcoded: Selected draft’s currency values, Subtotal/Estimated delivery fee/Tax labels, delivery-estimate notice, Malaysia currency formatting, emphasized total row, and summary CSS.

### RouteLoadingScreen
- Source: `src/components/RouteLoadingScreen.tsx`
- Category: basic
- Description: Branded full-screen loading state used at root and portal route boundaries.
- Extractable props: `visible` (boolean, default: `true`)
- Hardcoded: Axora brand, LoaderCircle icon, “Loading Axora…” default message, supporting sentence, live status semantics, centered card, and spinner animation.

### ConfirmationDialog
- Source: `src/components/UxFeedbackProvider.tsx`
- Category: basic
- Description: Promise-backed modal confirmation pattern with safe and destructive variants.
- Extractable props: `open` (boolean, default: `true`), `destructive` (boolean, default: `false`), `confirmDisabled` (boolean, default: `false`)
- Hardcoded: Selected draft’s title/message/action labels, Check or AlertTriangle icon, dismiss-on-backdrop and Escape behavior, initial confirm focus, two-button order, glass surface, responsive button grid, and animation.

### FeedbackToast
- Source: `src/components/UxFeedbackProvider.tsx`
- Category: basic
- Description: Fixed top-center notification for loading, success, error, and informational feedback.
- Extractable props: `visible` (boolean, default: `true`), `tone` (`"loading" | "success" | "error" | "info"`, default: `"success"`), `dismissible` (boolean, default: `true`)
- Hardcoded: Selected draft’s message, tone icon mapping, top-center position, glass styling, close icon, loading spinner, enter transition, and timing behavior.

### Panel
- Source: `src/app/globals.css` (shared `.panel`, `.panel-header`, and `.panel-body` pattern)
- Category: basic
- Description: Reusable bordered white surface used for dashboards, tables, forms, detail groups, and empty states.
- Extractable props: `collapsed` (boolean, default: `false`, only for drafts that include collapsible content), `showHeader` (boolean, default: `true`)
- Hardcoded: Selected draft’s title/body/actions, 18px radius, slate border, white background, low-elevation shadow, clipped overflow, 68px header treatment, and 20px body padding.

### DataTable
- Source: `src/app/globals.css` (shared `.data-table-wrap` and `.data-table` pattern; repeated in portal route pages)
- Category: basic
- Description: Horizontally safe operational table with uppercase headers, compact rows, hover feedback, and semantic badges/links.
- Extractable props: `sortColumn` (string, default: `""`), `sortDirection` (`"asc" | "desc"`, default: `"asc"`), `selectedRowCount` (number, default: `0`)
- Hardcoded: Selected draft’s columns and row data, 780px minimum width, header capitalization, row spacing, slate dividers, hover color, link style, and overflow wrapper.

### FormField
- Source: `src/app/globals.css` (shared `label`, `input`, `select`, `textarea`, `.form-hint`, and error-state patterns)
- Category: basic
- Description: Consistent labeled form control pattern shared by management and request workflows.
- Extractable props: `disabled` (boolean, default: `false`), `invalid` (boolean, default: `false`), `required` (boolean, default: `false`), `multiline` (boolean, default: `false`)
- Hardcoded: Selected draft’s label, hint, placeholder, and option text; 41px control height, 10px radius, slate border, blue focus ring, red validation treatment, textarea resize behavior, and typography.
