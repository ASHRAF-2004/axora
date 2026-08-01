# Axora Route Map

## Routing model

- Framework: Next.js 16 App Router with React 19 server and client components.
- Router source: the filesystem under `src/app/`; there is no separate router configuration file.
- The `(portal)` directory is a route group and does not appear in URLs.
- All pages inherit `src/app/layout.tsx`. Authenticated portal pages also inherit `src/app/(portal)/layout.tsx`.
- Access is enforced inside server pages through `requireSession` or `requirePagePermission`. Unauthorized page access redirects through the application's permission layer.

## Layout and loading hierarchy

| Scope | File | Applies to | What it renders |
| --- | --- | --- | --- |
| Root layout | `src/app/layout.tsx` | Every page | HTML/body shell, global metadata and icons, `globals.css`, and the client-side `UxFeedbackProvider`. |
| Root loading UI | `src/app/loading.tsx` | Root navigation boundaries | Branded route-loading screen. |
| Portal layout | `src/app/(portal)/layout.tsx` | Every route inside `(portal)` | Authenticated shell with navigation notice, permission-aware sidebar, environment status top bar, signed-in user summary, logout control, and main content area. |
| Portal loading UI | `src/app/(portal)/loading.tsx` | Portal navigation boundaries | Branded route-loading screen while a portal route resolves. |

Layout chains used below:

- **Root only:** `src/app/layout.tsx`
- **Portal shell:** `src/app/layout.tsx` → `src/app/(portal)/layout.tsx`

## Page routes

| URL | Page component | Layout chain | Access gate | Page summary |
| --- | --- | --- | --- | --- |
| `/` | `src/app/page.tsx` | Root only | None | Entry redirect to `/dashboard`; the destination applies authentication and dashboard permission checks. |
| `/login` | `src/app/login/page.tsx` | Root only | Anonymous; an existing session redirects to `/dashboard` or `/settings` for IT support | Split-screen branded sign-in page with product benefits, secure-workspace messaging, and the credential form. |
| `/access-denied` | `src/app/(portal)/access-denied/page.tsx` | Portal shell | Signed-in session | Explains that the active role cannot access the requested workspace and links back to an allowed destination. |
| `/dashboard` | `src/app/(portal)/dashboard/page.tsx` | Portal shell | `view_dashboard` | Role-aware operations or company-purchasing overview with KPI cards, attention table, status/activity charts, top products, and financial or budget guidance. |
| `/requests` | `src/app/(portal)/requests/page.tsx` | Portal shell | `view_requests` | Searchable and status-filterable purchase-request register with approval, fulfilment, delivery, totals, optional payment status, CSV export, and create-request action. |
| `/requests/new` | `src/app/(portal)/requests/new/page.tsx` | Portal shell | `create_requests` | Builds a purchase request from the Shop cart, lets the user select an allowed company/branch context, edit quantities and request details, and submit for approval. |
| `/requests/[id]` | `src/app/(portal)/requests/[id]/page.tsx` | Portal shell | `view_requests` | Detailed request workspace showing metadata, lines, customer pricing, branch budget impact, approval trail, fulfilment status, and permitted workflow actions. |
| `/approvals` | `src/app/(portal)/approvals/page.tsx` | Portal shell | `view_approvals` | Company/branch approval queue with request pricing and budget context; authorized approvers may approve or reject eligible requests. |
| `/products` | `src/app/(portal)/products/page.tsx` | Portal shell | `view_catalog` | Customer roles see the visual Axora Shop and cart workflow; platform owners see catalog administration, product imagery, supplier cost, and product creation controls. |
| `/products/[id]/edit` | `src/app/(portal)/products/[id]/edit/page.tsx` | Portal shell | `manage_catalog` | Platform product editor for catalog fields plus customer-facing image gallery upload, primary-image selection, and deletion. |
| `/companies` | `src/app/(portal)/companies/page.tsx` | Portal shell | `manage_companies` | Platform-owner customer-company register with activation controls and a complete company onboarding form. |
| `/branches` | `src/app/(portal)/branches/page.tsx` | Portal shell | `view_branches` | Company structure view with branch register, active state, address/contact data, monthly budget controls, and owner-only branch creation. |
| `/users` | `src/app/(portal)/users/page.tsx` | Portal shell | `manage_users` | Role- and scope-aware account creation plus user register, activation/deactivation, protected-account rules, and deletion controls. |
| `/suppliers` | `src/app/(portal)/suppliers/page.tsx` | Portal shell | `manage_suppliers` | Internal Axora supplier register with commercial terms, contacts, activation controls, and supplier creation form. |
| `/sourcing` | `src/app/(portal)/sourcing/page.tsx` | Portal shell | `manage_sourcing` | Quotation comparison and supplier-selection workspace; captures written offers and promotes the selected buying price to the request line. |
| `/deliveries` | `src/app/(portal)/deliveries/page.tsx` | Portal shell | `view_deliveries` | Delivery register and, where permitted, shipment-update form with accepted quantities, dates, receiver, and issue reasons. |
| `/finance` | `src/app/(portal)/finance/page.tsx` | Portal shell | `view_invoices` | Owner invoice/COD reconciliation controls or company-facing invoice and receipt visibility, with status and financial totals. |
| `/documents` | `src/app/(portal)/documents/page.tsx` | Portal shell | `view_documents` | Company-isolated evidence library; privileged users can upload request, invoice, delivery, or supporting files and set customer visibility. |
| `/reports` | `src/app/(portal)/reports/page.tsx` | Portal shell | `view_reports` | Owner financial reconciliation or customer purchasing report with KPIs, branch summaries, status distribution, and request CSV export. |
| `/audit` | `src/app/(portal)/audit/page.tsx` | Portal shell | `view_audit` | Read-only table of up to 500 recent audited database changes with actor, entity, action, record, time, and reason. |
| `/settings` | `src/app/(portal)/settings/page.tsx` | Portal shell | `manage_settings` | Workspace/security overview, company pricing configuration, timezone/currency/payment defaults, access protections, and current persistence mode. |
| `/help` | `src/app/(portal)/help/page.tsx` | Portal shell | Signed-in session | Role-specific operating guide with illustrated English/Arabic manuals and owner or customer procurement responsibilities. |

## HTTP API routes

| Method | URL | Route file | Purpose and access |
| --- | --- | --- | --- |
| `GET` | `/api/health/live` | `src/app/api/health/live/route.ts` | Process liveness response; does not query PostgreSQL. |
| `GET` | `/api/health/ready` | `src/app/api/health/ready/route.ts` | Readiness response that verifies database connectivity outside sample mode. |
| `GET` | `/api/catalog` | `src/app/api/catalog/route.ts` | Authenticated, permission-checked product search/filter/sort endpoint for catalog browsing. |
| `POST` | `/api/catalog/cart` | `src/app/api/catalog/cart/route.ts` | Authenticated, permission-checked lookup of the authoritative products represented by cart IDs. |
| `GET` | `/api/export/requests` | `src/app/api/export/requests/route.ts` | Permission-checked CSV export of requests visible to the signed-in actor. |
| `GET` | `/api/attachments/[id]` | `src/app/api/attachments/[id]/route.ts` | Streams an attachment only when the actor is signed in, has document access, and is allowed to see the linked tenant record. |
| `GET` | `/api/products/[id]/image` | `src/app/api/products/[id]/image/route.ts` | Permission-checked product image compatibility endpoint with content hash/cache handling. |
| `GET` | `/api/products/[id]/images` | `src/app/api/products/[id]/images/route.ts` | Lists image metadata for one permitted product. |
| `GET` | `/api/products/[id]/images/[imageId]` | `src/app/api/products/[id]/images/[imageId]/route.ts` | Streams one permitted product-gallery image with cache validation. |

## Server action modules

These files are not URL routes. They are server-only form/action entry points imported by pages or client components:

- `src/app/actions.ts` — logout.
- `src/app/login/actions.ts` — authentication and session creation.
- `src/app/(portal)/branches/actions.ts` — branch monthly budgets.
- `src/app/(portal)/masters/actions.ts` — companies, branches, suppliers, products, product images, and active-state management.
- `src/app/(portal)/operations/actions.ts` — quotations, approvals, deliveries, invoices, payments, and attachments.
- `src/app/(portal)/requests/actions.ts` — request creation and workflow-status updates.
- `src/app/(portal)/settings/actions.ts` — company pricing configuration.
- `src/app/(portal)/users/actions.ts` — user creation, activation, and deletion.

## Route implementation notes

- Pages are server components unless their file begins with `"use client"`; interactive forms such as `RequestForm`, `UserCreateForm`, and `ApprovalDecisionForm` isolate browser state in client components.
- Portal pages receive both the root feedback provider and the authenticated portal shell without importing either directly.
- Dynamic segments use opaque record IDs and re-check actor visibility in repository/service functions; the URL alone does not grant access.
- The future interaction editor should follow the established portal convention: place the page under `src/app/(portal)/settings/…` or another permission-gated portal route, keep executable behavior in reviewed components, and expose only validated bounded configuration to the owner.
