# Axora final Gorilla audit

Status: **FINAL SYSTEM GORILLA AUDIT CLEARED; authenticated production acceptance passed**.

This report records the final CAM stabilization and hostile MVP audit. It contains no passwords, tokens, private addresses, raw tracking coordinates, or supplier acquisition-cost evidence.

## 1. Verified baseline

- Starting protected-main revision: `2a58f4e04a7030b4d3a5bf3a6a091c9140e56733`.
- Authenticated-acceptance starting revision: `9051a75a2068b3872c802b1386cb415f0a419dfa`.
- Starting migration head: `118_delivery_self_claim_acceptance_window.sql`.
- Production origin: `https://axora.management`.
- Completed historical transaction: `ORD-2026-0109`, request `fb262510-0771-4f7a-8e73-b85d3c71ea00`, customer total RM4.29.
- Historical invoice: `AX-INV-2026-00000001`, finalized at RM4.29; payment RM4.29 PAID.
- Historical delivery: `84ceb6ef-8cec-41d5-b8f1-1b57d7eada35`, terminal state COMPLETED.
- Protected financial baseline: Wallet RM1,995.71; TEST1 available RM995.71, spent RM4.29, reserved RM0.00.
- Protected active Cart baseline: Coffee Beans quantity 1 at RM112.75; zero Ball Pen lines.
- No production purchase, delivery, Wallet, budget, invoice, payment, or Cart mutation was made by this audit or final authenticated acceptance.

## 2. Gate 0 — Client Account Manager

Affected account: `tayamhussam@gmail.com`.

### Production correlation

| Reference | Proven boundary | Result |
| --- | --- | --- |
| `AX-858448370` | GET/RSC `/requests`; request projection called `axora_received_quantity` | SQLSTATE `42501`; the legacy receipt-progress helper rejected a valid CAM after `axora_request_access_rows` had already authorized the rows. The browser recovery failure was secondary. |
| `AX-238304097` | Not retained in the bounded production logs available during Gate 0 | Route was deliberately not guessed. Container rotation meant its exact timestamp and route could not be recovered. The shared Dashboard failure was independently reproduced as `AX-1805529793` at the same receipt-projection boundary. |

For Requests, the Server Component path was `RequestsPage` → `searchAuthorizedRequests` → the request-row projection. PostgreSQL raised error class `insufficient_privilege`, SQLSTATE `42501`, message `Received quantity is unavailable`, from `public.axora_received_quantity(uuid)`; the reader surfaced `RequestAccessUnavailableError`. For Dashboard, `DashboardPage` → `getAuthorizedDashboardPeriodReport` → `loadDatabaseSnapshot` reached the same function and surfaced `DashboardDataUnavailableError`. In both cases the live user/role-assignment authorization snapshot and `axora_request_access_rows` had already admitted the exact resource. The first failing boundary was therefore the secondary receipt projection, not login, route authorization, reporting-scope resolution, or historical portfolio assignment. The later browser recovery message was secondary.

The exact timestamp for `AX-858448370` was also no longer present after the relevant container rotation. Bounded searches covered the supplied references, `DashboardDataUnavailableError`, `RequestAccessUnavailableError`, `axora_request_access_rows`, `axora_request_permission_is_effective`, `axora_live_authorization_snapshot`, `next_request_error`, SQLSTATE and HTTP 5xx. This is an evidence-retention gap, not an inferred timestamp.

### Live identity snapshot

- User ID recorded in redacted form: `c2f6c9ac-…-c23c39d0`.
- Account kind: PLATFORM.
- Resolved role: CLIENT_ACCOUNT_MANAGER.
- Scope: PLATFORM; no company or branch assignment.
- Role assignment recorded in redacted form: `9385793a-…-ed75`; active, not revoked.
- `auth_version`: 27.
- Effective requested permissions: `dashboard.view`, `request.view`, `company.view`, `company.view.assigned`, `delivery.view`, `finance.invoice.view`, and `analytics.company.view` are true; `company.view.all` is false.
- Explicit DENYs: `company.activate`, `company.edit`, `company.lead.assign`, `user.create`, `user.deactivate`, `user.edit`, `user.invite`, and `user.view`.
- Commercial preset includes the scoped Company, product, request, delivery, invoice and company-analytics capabilities needed by the current MVP. Explicit DENY remains final.

### Root cause and fix

The failure was class A: the current request-resource policy authorized the platform CAM, but the later legacy received-quantity helper still used a role-name allowlist. It could not evaluate current resource-aware `request.view`, so both Dashboard reporting and Requests failed at a shared projection boundary. Historical CRM portfolio assignments were not involved.

Migration 119 replaced that boundary with a fixed-search-path, least-privilege SECURITY DEFINER function bound to the live user and exact role assignment. It evaluates `request.view` through the current resource-aware snapshot. Explicit DENY, revoked assignments, tenant scope, unsupported historical company-scope CAMs and zero-row behavior remain enforced. The fix returns authorized data rather than swallowing an error or returning an empty array.

PR: #176, `fix(auth): restore Client Account Manager dashboard and requests`.

The production-realistic fixture proves ordinary requests, Company Administrator direct orders, a paid invoice, completed delivery, two companies, explicit DENY, revoked CAM, zero rows and rejected historical company-scope CAM behavior. Dashboard and Requests pass without the retired portfolio workflow.

## 3. Historical audit recheck

Every item in `Axora_E2E_Audit_Completed.md` was retested against the current contract.

| Historical item | Final classification | Evidence or disposition |
| --- | --- | --- |
| AX-UAT-001 self-approval/direct checkout | RESOLVED | Direct Company Administrator checkout and subordinate approval remain separate; self-approval is denied. |
| AX-UAT-002 branch company selector | RESOLVED | Company-bound branch creation derives company from the server session. |
| AX-UAT-003 first branch setup | RESOLVED | First-attempt users, location and budget journey passes desktop and Pixel 7. |
| AX-UAT-004 map confirmation | RESOLVED | Search, pin correction, reverse geocode and confirmation journeys pass. |
| AX-UAT-005 zero-product catalogue | RESOLVED | Controlled empty catalogue and complete-view behavior pass. |
| AX-UAT-006 invisible Company Administrator | RESOLVED | Scoped directory and invitation coverage pass. |
| AX-UAT-007 user-directory policy confusion | RESOLVED | Current role/scope policy UI and direct authorization pass. |
| AX-UAT-008 shell branding | RESOLVED | Tenant-reviewed branding is applied in the authenticated shell. |
| AX-UAT-009 company branding completion path | SUPERSEDED | Current contract permits reviewed logo processing only; no company raw theme editor. |
| AX-UAT-010 brand token coverage | RESOLVED | Light/Dark tenant token and fallback coverage pass. |
| AX-UAT-011 wrong/dead role routes | RESOLVED | Retired hierarchy redirects and stale actions fail closed in #181. |
| AX-UAT-012 shared phone absent | RESOLVED | Shared international phone input released in #178. |
| AX-UAT-013 non-E.164 phone | RESOLVED | Client/server E.164 normalization and migration enforcement released in #178. |
| AX-UAT-014 raw coordinate contract | RESOLVED | User-facing location uses search/map/pin, not latitude/longitude fields. |
| AX-UAT-015 destination map | RESOLVED | Customer-safe destination and driver navigation maps pass. |
| AX-UAT-016 delivery lifecycle | RESOLVED | Native and browser lifecycle/concurrency coverage pass. |
| AX-UAT-017 shopping branch UX | RESOLVED | Mandatory Company Admin chooser and derived branch scope pass. |
| AX-UAT-018 insufficient funds UX | RESOLVED | Budget and Wallet shortage states are controlled and localized. |
| AX-UAT-019 nested `main` landmark | RESOLVED | AX-FINAL-010 removes nested landmarks and scans every portal page/error entry. |
| AX-UAT-020 delivery terminology | RESOLVED | Delivery state/proof presentation localized in #184. |
| AX-UAT-021 preload warnings | RESOLVED | No explicit problematic preload declarations; standalone console gate is clean. |
| AX-UAT-022 activation constraint | RESOLVED | Verification prerequisites and first-click activation are covered. |
| AX-UAT-023 delivery financial dashboard leak | RESOLVED | Delivery-only redirect and financial-route denial pass. |
| AX-UAT-024 procurement settings recovery | RESOLVED | Permission and controlled-denial route tests pass without generic recovery. |
| AX-UAT-025 lifecycle filter labels | RESOLVED | Simplified localized lifecycle groups released in #183. |

## 4. New findings

| ID | Severity | Role | Area | Root cause | Fix PR | Final retest |
| --- | --- | --- | --- | --- | --- | --- |
| AX-FINAL-001 | P1 | CAM | Dashboard / Requests | Legacy received-quantity role allowlist rejected a valid resource-authorized CAM. | #176 | Unit/PGlite, native PostgreSQL, standalone desktop/Pixel 7, CI, deploy and Nightly passed. |
| AX-FINAL-002 | P1 | CAM | Invoices | Customer invoice projection omitted the current CAM visibility contract. | #177 | CAM invoice isolation, no supplier/internal-cost projection, CI, deploy and Nightly passed. |
| AX-FINAL-003 | P2 | Company users | Phone fields | Active forms lacked one professional country-aware E.164 control. | #178 | Search/paste/mobile/tel/RTL/EN-AR-MS and database enforcement passed. |
| AX-FINAL-004 | P2 | Customer roles | Retired organization UI | Historical hierarchy and department scope remained reachable on normal MVP write surfaces. | #181 | Redirect, forged action, role visibility, draft and navigation coverage passed. |
| AX-FINAL-005 | P2 | All profile users | Profile photo | A fast file selection before hydration could lose validation feedback. | #179 | Deterministic hydration boundary and first-attempt browser coverage passed. |
| AX-FINAL-006 | P1 | Delivery Agent | Tracking privacy | An older RESUME callback could overwrite a concurrent terminal event and restart collection. | #180 | Deterministic race, offline, multi-tab and terminal tracking tests passed. |
| AX-FINAL-007 | P1 | CAM demo fixture | Company detail | Production UUID response schema was incorrectly reused for bounded demo identifiers. | #182 | Valid fixture and malformed-ID controlled 404 pass without 5xx. |
| AX-FINAL-008 | P2 | Platform | Companies | CRM-era lifecycle codes, English plural/action copy and duplicate filter semantics leaked into the MVP register. | #183 | Every compatibility state maps once; EN/AR/MS, desktop/Pixel 7 and legacy query tests passed. |
| AX-FINAL-009 | P2 | Multiple roles | Localization | Raw budget/delivery codes and English create-route controls appeared in AR/MS. | #184 | Unknown states fail closed to localized labels; proof enum values remain canonical; complete standalone gate and Nightly `33000972840` passed. |
| AX-FINAL-010 | P3 | Company roles | Accessibility landmarks | Wallet, Approvals and portal error content nested `main` inside the authenticated shell `main`. | #185 | Repository scan plus desktop/Pixel 7 WCAG journeys passed. |
| AX-FINAL-011 | P0 | CAM | Commercial confidentiality | Historical explicit grants exceeded the role ceiling and exposed internal acquisition-cost and gross-margin data on request detail. | #187 | Database and application role ceilings, request/product projection tests, exact-head CI, deploy and authenticated production leakage scan passed. |
| AX-FINAL-012 | P1 | CAM / platform | Request detail recovery | A malformed production route identifier reached a PostgreSQL UUID comparison and was misclassified as an authorization-system outage. | #188 | The production reader rejects malformed IDs before SQL; unit, browser, CI, deploy and authenticated production 404 retest passed. |
| AX-FINAL-013 | P2 | CAM / platform | Deliveries hydration | The client formatted a driver's last-location timestamp in browser local time while SSR used the server timezone, causing React hydration error 418. | #189 | The server passes the actor timezone and the formatter pins it; three hard navigations, refresh/history, browser error capture, CI and deploy passed. |

### Finding reproduction contracts and evidence

- **AX-FINAL-001:** Sign in as an active PLATFORM CAM with `dashboard.view` and `request.view`, with ordinary and direct-order rows present, then open `/dashboard` and `/requests`. Expected: the authorized report and request register. Actual before #176: both paths failed while projecting received quantities; production exposed `AX-858448370` / SQLSTATE `42501`, and the production-realistic fixture reproduced the same boundary. Evidence: migration 119 tests cover grant, explicit DENY, revocation, zero rows and unsupported historical company scope; standalone CAM navigation and the post-deploy Nightly pass.
- **AX-FINAL-002:** Give a PLATFORM CAM `finance.invoice.view` and an authorized customer invoice, then open `/finance` and its customer projection. Expected: the customer-safe invoice row without supplier payment, buying cost or margin. Actual before #177: the projection omitted the current CAM visibility contract. Evidence: focused invoice-isolation tests, malformed/foreign denial, standalone role coverage and the exact-main Nightly pass.
- **AX-FINAL-003:** Open the active Branch contact and Profile phone forms in EN, AR and MS; paste numbers with and without dial codes and try letters. Expected: searchable country/flag/dial-code selection and canonical E.164. Actual before #178: the active forms had no shared country-aware control and accepted an unprofessional free-text workflow. Evidence: component, action and migration-121 tests plus desktop/Pixel 7 paste, search, `tel`, RTL and validation journeys.
- **AX-FINAL-004:** As each customer role, navigate directly to `/branches/organization` and inspect normal user/access write surfaces. Expected: retired Departments, Business Units and Cost Centres are unavailable while historical storage remains compatible. Actual before #181: historical hierarchy navigation and department scope remained reachable. Evidence: redirect matrix, forged stale-action tests, role visibility tests, all-migration replay and standalone navigation.
- **AX-FINAL-005:** On `/profile`, select an invalid or oversized image immediately when the control becomes interactable, before the prior client boundary settled. Expected: the first selection is validated and feedback persists. Actual before #179: the first validation result could be lost during hydration. Evidence: deterministic hydration-boundary regression coverage, image lifecycle/browser tests and Nightly `32983627730`.
- **AX-FINAL-006:** Start delivery tracking, issue RESUME from a stale tab, and complete the same job in the authoritative tab before the RESUME response returns. Expected: terminal completion preempts the stale callback and no position collection restarts. Actual before #180: the older callback could overwrite terminal state and resume collection. Evidence: deterministic two-tab race, offline queue, stale-point and post-completion rejection coverage plus Nightly `32990864797`.
- **AX-FINAL-007:** As CAM in the bounded demo fixture, open the fixture company detail and then a malformed identifier. Expected: the valid fixture renders and malformed input reaches controlled not-found behavior. Actual before #182: a production UUID response schema was applied to the bounded demo identifier and raised the generic boundary. Evidence: focused company-detail browser test, route matrix and Nightly `32993015096`.
- **AX-FINAL-008:** Open `/companies` with each compatibility lifecycle filter in EN, AR and MS on desktop and Pixel 7. Expected: each current MVP lifecycle group appears once with localized labels and actions. Actual before #183: CRM-era codes, English plural/action copy and duplicate filter semantics were visible. Evidence: exhaustive compatibility-state mapping, query canonicalization and Nightly `32995359109`.
- **AX-FINAL-009:** Open active create, budget, delivery, driver and proof surfaces in Arabic and Malay. Expected: user-facing domain state and recovery copy are localized while submitted enum values remain canonical. Actual before #184: raw database codes and English controls leaked through presentation boundaries. Evidence: localization unit/browser tests, 298-test integrated standalone suite and exact-main release gates.
- **AX-FINAL-010:** Open Wallet, Approvals and a controlled portal error inside the authenticated shell and count `main` landmarks. Expected: exactly one named main content landmark. Actual before the landmark fix: each page nested its own `main` beneath `#portal-main`. Evidence: repository-wide portal page/error scan and desktop/Pixel 7 accessibility journeys.
- **AX-FINAL-011:** Use the affected live CAM with historical/custom grants and inspect catalogue/request projections and edit surfaces. Expected: the CAM can perform customer-facing lifecycle work but cannot view acquisition cost, supplier cost, margin or confidential pricing controls. Actual before #187: historical explicit grants bypassed the simplified preset and exposed internal acquisition-cost and gross-margin data on request detail. Evidence: migration 122 enforces the ceiling in snapshot evaluation and future permission writes while preserving historical audit rows; TypeScript policy/UI/readers enforce the same ceiling; live post-deploy content scans found no confidential commercial projection.
- **AX-FINAL-012:** Open `/requests/not-a-valid-id` in production as an authorized platform actor. Expected: controlled not-found. Actual before #188: PostgreSQL raised SQLSTATE `22P02`, which the wrapper surfaced as generic request-access recovery; retry could then produce the browser-level page-load failure. Evidence: the reader now validates production UUID syntax before its SQL boundary while preserving bounded demo identifiers; live retest returned the role-safe 404 and Return to Dashboard succeeded with no 5xx or browser error.
- **AX-FINAL-013:** Open `/deliveries` as the affected CAM from a Kuala Lumpur browser against the UTC production server. Expected: identical server/client markup. Actual before #189: the last-location time rendered `08:15` on the server and `16:15` in the browser, causing React hydration error 418 and client reconstruction. Evidence: document-start mutation capture proved the differing text node; the explicit actor-timezone formatter passes UTC/Asia-Kuala-Lumpur tests and the deployed page passed three hard navigations plus refresh and history with zero page errors.

One P0 confidentiality defect was reproduced during live acceptance and closed by #187. No P0, P1 or explicit-contract P2 remains open.

## 5. Role contract

| Role | Scope and allowed MVP work | Explicit containment verified |
| --- | --- | --- |
| Platform Owner | Platform dashboard, companies, users, branches, catalogue, operational finance, deliveries, receiving, procurement settings and Email Status | Customer approval actions remain unavailable; company/delivery-only routes deny cleanly. |
| Client Account Manager | Permission-based company, branch, catalogue, request, delivery, customer-invoice and company-analytics views | No retired portfolio dependency, no supplier invoice/payment projection, no buying cost/margin, explicit DENY final. |
| Company Administrator | Company people, branches, location, budgets, Wallet, shopping/Cart, direct paid order, requests, approvals, invoices, receiving and profile | No Platform Owner chrome, no company selector in known scope, no raw theme editor, no self-approval path. |
| Branch Administrator | Assigned branch people/budget/shopping/requests/approvals/invoices/deliveries/receiving | No Wallet, platform company management or foreign branch access. |
| Requester | Assigned branch catalogue/Cart, subordinate request submission, own request and delivery visibility | No approval, Wallet, company management, procurement settings or driver workspace. |
| Delivery Agent | Driver workspace, claim/acquisition/tracking/proof/completion and profile | Dashboard redirects to Driver; procurement, tenant finance and customer internal data deny. |

## 6. Route matrix

Legend: A = ALLOW, R = controlled REDIRECT, D = ACCESS_DENIED, N = NOT_FOUND. The executable matrix runs every row for all six roles on desktop Chromium and Pixel 7 and rejects HTTP 5xx, page errors and generic recovery.

| Route | Owner | CAM | Company Admin | Branch Admin | Requester | Delivery Agent |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | A | A | A | A | A | R `/driver` |
| `/companies` | A | A | D | D | D | D |
| `/companies/:authorized` | A | A | D | D | D | D |
| `/companies/:malformed` | N | N | D | D | D | D |
| `/users` | A | A | A | A | D | D |
| `/branches` | A | A | A | A | A | D |
| `/branches/:authorized` | A | A | A | A | A | D |
| `/branches/:malformed` | N | N | N | N | N | D |
| `/budgets` | D | D | A | A | D | D |
| `/wallet` | A | D | A | D | D | D |
| `/products` | A | A | A | A | A | D |
| `/cart` | D | D | A | A | A | D |
| `/requests` | A | A | A | A | A | D |
| `/requests/:platform-visible` | A | A | N | N | N | D |
| `/requests/:malformed` | N | N | N | N | N | D |
| `/requests/new` | D | D | R `/cart` | A | A | D |
| `/approvals` | A | D | A | A | D | D |
| `/finance` | A | A | A | A | D | D |
| `/deliveries` | A | A | A | A | A | D |
| `/receiving` | A | D | A | A | D | D |
| `/driver` | D | D | D | D | D | A |
| `/settings/procurement` | A | D | A | D | D | D |
| `/profile` | A | A | A | A | A | A |
| `/notifications` | A | A | A | A | A | A |
| `/settings` | R `/profile` | R | R | R | R | R |
| `/email-operations` | A | N | D | D | D | D |
| `/audit`, `/reports`, `/help` | R `/dashboard` | R | R | R | R | R `/driver` |
| `/branches/organization` | R `/branches` | R | R | R | R | D |
| `/company-wallet`, `/company/users` aliases | N | N | N | N | N | N |

## 7. API, Server Action and RLS matrix

| Boundary | Correct actor | Wrong role / tenant / UUID | Revoked, stale or malformed | Evidence |
| --- | --- | --- | --- | --- |
| Catalogue and Cart APIs | Scoped read/mutation; server-derived company and branch contract | No foreign branch or private product projection | Stale versions reconcile; invalid quantity/type fails locally | PGlite/native command tests and shopping browser journeys. |
| Request submit, approval and direct purchase | Subordinate submission and authorized approval remain distinct; direct purchase is atomic | Self-approval, forged company/branch and explicit DENY fail closed | Same-command replay returns one result; racing commands create one logical order | Native transaction/failure-injection suite and standalone lost-response journeys. |
| Budget and Wallet commands | Exact decimal ledger and scoped active period | Foreign branch and insufficient funds rejected before mutation | Stale actor, duplicate refresh and concurrent renewal are idempotent | Forced-RLS native suite and balance-equality assertions. |
| Invoice/document endpoints | Customer projection and authorized immutable document | Foreign invoice, logged-out access and supplier/internal-cost leakage denied | Malformed ID and version mismatch controlled | Document/PDF checksum and authorization tests. |
| Delivery APIs | Assigned agent claim/workflow/tracking/proof; customer privacy projection | Wrong agent, wrong role, foreign job and post-terminal point rejected | Stale version, duplicate command, lost response and invalid proof reconcile safely | Native ten-agent race, proof policy and desktop/mobile offline tests. |
| Profile/avatar APIs | Current user and authorized display projection | Foreign private avatar write/read denied | Origin, content type, size and image validation fail closed | Focused API/unit and first-attempt browser coverage. |
| Notifications and SSE | Current-session scoped stream/snapshot | No cross-account event projection | Reconnect, stale sequence and cleanup are bounded | Multi-tab/history browser coverage and effect cleanup inspection. |
| Geocoder | Authenticated, bounded self-hosted provider bridge | No direct public Nominatim autocomplete use | Stale response, provider failure, denial, timeout and manual fallback controlled | Location unit/browser coverage. |
| Email/provider events | Signed provider event and idempotent outbox lifecycle | Unsigned/foreign event rejected | Retry, resend, revoked invitation and committed-response loss remain isolated | Local/test-provider invitation and outbox tests. |

Native PostgreSQL replay verifies forced RLS, PUBLIC revokes, `axora_app` least privilege, fixed SECURITY DEFINER `search_path`, explicit DENY, live assignment/auth-version checks and tenant ownership. Application sessions use a host-only SameSite=Strict cookie; state-changing public/profile upload boundaries additionally validate the expected Origin contract. No raw application-role table access was found.

## 8. Workflow Gorilla results

### Company branding

Company Administrator, Branch Administrator and Requester sessions inherit reviewed company logo/theme tokens in navigation and content across Light, Dark, mobile and Arabic RTL. Axora is the fallback when reviewed company branding is unavailable. Company users cannot enter the Platform Owner review surface and receive no raw color/theme editor. Contrast tests pass.

### Phone input

The shared control released in #178 provides searchable country name/flag/dial code, national-number input, paste normalization, duplicate-code handling, E.164 submission, `tel` semantics, letter rejection, practical touch targets, EN/AR/MS and RTL-safe LTR phone isolation. Active Branch and Profile phone forms use it. Migration 121 validates changed phone writes without rewriting legacy rows.

### Branch and location

Branch creation binds the company from the server session. Controlled tests cover partial `verdi` search, keyboard selection, stale response suppression, no result, provider failure, map zoom/pin correction/reverse geocode, geolocation allowed/denied/timeout/unsupported, manual fallback, refresh and mobile. Normal users never type coordinates.

### Budget and Wallet

First/current/future periods, immutable active configuration, renewal, timezone boundaries, exact/insufficient/one-cent-short balances, duplicate refresh, concurrent renewal, funding notifications, stale actor and foreign branch all pass. Decimal ledger entries are append-only and Wallet balance never goes negative.

### Shopping and Cart

Company Administrator branch selection and branch-scoped derivation pass for none/one/multiple/foreign/inactive/missing-location contexts. Search, categories, add/duplicate/rapid add, invalid quantity, remove, refresh, sign-out/in, Back/Forward, two-tab reconciliation and lost-response recovery pass. Request Type is absent and Cart branch is read-only.

### Direct purchase

Native PostgreSQL tests cover normal checkout, same-command replay, ten distinct command IDs racing one Cart, price change, stale Cart, exact/insufficient budget and Wallet, missing location, unavailable product, revoked Admin, explicit DENY, lost response and injected rollback at major boundaries. Exactly one order, payment, invoice and delivery job results, and order total equals budget spend equals absolute Wallet debit equals payment equals invoice.

### Subordinate request and approval

Requester/branch-scoped submission remains distinct from Company Administrator direct purchase. Same-user self-approval is denied. Over-budget, returned, rejected, duplicate/concurrent approval, stale revision, cancellation and explicit DENY paths pass. Direct Company Administrator orders do not enter pending approval.

### Invoice and documents

Visibility, refresh, generated PDF/download authorization, foreign and logged-out denial, malformed identifiers, version/checksum behavior and Arabic-safe rendering pass. Customer projections exclude supplier acquisition cost and margin. Production invoice `AX-INV-2026-00000001` was read only and not regenerated.

### Delivery, tracking and proof

Available/unavailable agent, one-claim and ten-agent races, replay/lost response, accept/reject/window, acquisition, stale versions, invalid cost, tracking start/pause/resume/offline/stale/duplicate points, map/ETA/arrival, proof policy/invalid proof, delivered/completion replay, post-completion point rejection, terminal refresh and customer privacy all pass. AX-FINAL-006 closes the stale RESUME privacy race. The production historical job remained COMPLETED and was not mutated.

### Session, cache and recovery

Refresh, Dashboard-return, Back/Forward, expired session return, sign-out then browser Back, sign-in, multi-tab mutation, RSC reconstruction, slow/offline network and committed-response loss pass. Controlled authorization, not-found, validation, geocoder, insufficient funds and invalid-proof conditions render specific recovery rather than the generic boundary.

### Concurrency and idempotency

Native coverage exercises company/user/branch/location/budget/Cart/request/approval/direct-purchase/Wallet/invoice/delivery/tracking/evidence/completion commands with replay and competing command IDs as appropriate. No duplicate logical business effect was reproduced.

### Email and invitations

Local/test-provider fixtures cover first attempt, post-commit navigation loss, retry isolation, resend, revoke, existing user, duplicate outbound prevention, setup-token lifecycle and quota tracking. No production email quota was consumed for the Gorilla audit and no claim about new live delivery is made.

## 9. Localization, theme and accessibility

- EN, Arabic RTL and Malay pass representative public and every active role workspace.
- Light and Dark pass tenant-token and AA contrast assertions.
- Required widths 320, 360, 390, 768, 1024 and 1440 plus Pixel 7 are covered across the browser suite.
- No representative horizontal overflow; practical actions meet the 44px target.
- Focus visibility, skip links, drawer/dialog keyboard behavior, semantic alerts/status, labels, mixed-direction phone/financial values and reduced-motion behavior pass.
- AX-FINAL-009 maps budget, driver, delivery and proof database codes at the presentation boundary and uses a localized unavailable label for unknown future states.
- AX-FINAL-010 leaves exactly one authenticated `main` landmark.

## 10. Performance and reliability smoke

Controlled standalone testing repeatedly navigated reports, requests, Cart, maps, tracking and all material role routes. Browser coverage exercises SSE reconnect, offline recovery, two tabs, geolocation allow/deny/timeout, map mount/unmount and repeated route reconstruction. Effect inspection confirms EventSource, timer, geolocation-watch and AbortController cleanup. No repeated 5xx, runaway polling, duplicate geolocation watch, Strict Mode mutation, cross-account cache or unbounded recipient-bearing browser storage was reproduced. No destructive production load test was run.

## 11. Security review

- Production and full dependency audits reported zero known vulnerabilities.
- Tracked-source secret-pattern scan found no credential material.
- Forced RLS, PUBLIC grant revocation, least-privilege application grants and SECURITY DEFINER `search_path` checks pass natively.
- Explicit DENY wins over role presets, delegations and resource scope.
- Foreign UUIDs, malformed identifiers, stale/revoked sessions and role escalation attempts fail without tenant enumeration.
- Invoice, proof, attachment, tracking and avatar projections remain scoped.
- Customer roles receive no supplier acquisition cost, margin, raw tracking coordinates or provider secrets.

## 12. Verification gates

At the release-candidate tree:

- ESLint and strict TypeScript: passed.
- Vitest/PGlite: 317 files passed, 5 skipped; 1,435 tests passed, 31 skipped after the final delivery-hydration regression test.
- Native PostgreSQL: all 122 migrations plus authorization lifecycles, forced RLS and grants passed.
- Next standalone build, `pg-cloudflare` trace assertion, standalone staging and production asset validation: passed.
- Integrated standalone Playwright: 298 passed, 14 intentional skips; visitor recovery 18 passed.
- Explicit final role-route matrix: 12 role/device journeys, covering 180 unique role-route contracts on both desktop Chromium and Pixel 7, passed.
- `git diff --check`: passed.

## 13. Production acceptance and reconciliation

Public HTTPS, liveness and readiness passed after every deployment. Final authenticated acceptance used isolated browser contexts and the task-scoped credentials supplied for this acceptance only. No password value was printed, logged, captured, persisted or committed.

### Platform Owner

Login, Dashboard, Companies, TEST company detail, company users, TEST1 branch visibility, Products, Email Status, retired-route containment, refresh and Back/Forward passed. The workspace resolved as PLATFORM OWNER; there was no generic recovery, HTTP 5xx, browser error or unexpected denial. Sign-out followed by browser Back returned to login with no protected navigation or interactive content.

### Client Account Manager

The affected account `tayamhussam@gmail.com` resolved as CLIENT_ACCOUNT_MANAGER. Login, Dashboard, Companies, Catalog, Requests, an authorized order detail, Deliveries, Invoices, Dashboard return, hard refresh and Back/Forward passed. Dashboard and Requests loaded on the first attempt. The old request/report authorization failure did not recur; malformed request input produced controlled not-found behavior and Return to Dashboard worked; three hard Deliveries navigations produced no hydration error. Content scans found no internal acquisition cost, supplier cost, buying cost or margin disclosure. Sign-out and browser Back failed closed.

### TEST Company Administrator

The account resolved to the COMPANY ADMINISTRATOR workspace. Dashboard, Company Users, Branches, TEST1, Delivery Location, Budgets, Company Wallet, Shopping with the read-only TEST1 chooser context, Cart, Requests/Orders, `ORD-2026-0109`, durable receipt refresh, invoice, completed delivery and Profile passed. No Platform Owner chrome or retired Department, Business Unit or Cost Centre UI appeared. No purchase or other business mutation was submitted. Sign-out and browser Back failed closed.

### Delivery Agent

Login and `/driver` passed. Historical job `84ceb6ef-8cec-41d5-b8f1-1b57d7eada35` remained COMPLETED across refresh with no Claim, Accept, acquisition, Out for delivery, proof or Complete action; no tracking session or geolocation request started. `/dashboard` redirected to `/driver`; budget, approval and procurement settings routes denied cleanly; legacy company aliases were role-safe not-found. No customer finance or procurement administration appeared. Sign-out and browser Back failed closed.

All four isolated contexts were signed out, cleared and closed after evidence collection. The browser controller reported no remaining contexts; the task credential file and isolated browser artifacts were securely removed and verified absent. Across the journeys there were no HTTP 5xx responses, uncaught browser errors, generic recovery screens or stale protected content after logout.

Read-only reconciliation result:

| Invariant | Result |
| --- | --- |
| Company Wallet | RM1,995.71 |
| TEST1 available / spent / reserved | RM995.71 / RM4.29 / RM0.00 |
| Order | `ORD-2026-0109`, Completed, Company Admin direct purchase |
| Invoice | `AX-INV-2026-00000001`, RM4.29, FINALIZED |
| Payment | RM4.29, PAID |
| Delivery | `84ceb6ef-8cec-41d5-b8f1-1b57d7eada35`, COMPLETED |
| Active Cart | Coffee Beans ×1 at RM112.75; Ball Pen lines 0 |

Targeted production ledgers and workflow rows record zero Wallet, budget, Cart, order, invoice or delivery mutations during the acceptance window.

The bounded post-journey review covered the app, Caddy, budget worker, document worker, email sender and company-deletion cleanup worker from the final runtime deployment. Caddy recorded 2,436 requests with zero HTTP 5xx and zero error-level entries. The app/workers contained zero unexplained AX references, SQLSTATEs, authorization-wrapper failures, dashboard/request failures, hydration errors, tracking/document errors, deadlocks, serialization failures, workflow errors or warning/error terms.

## 14. Release ledger

| PR | Title | Protected-main revision | Migration | CI / deploy / Nightly |
| --- | --- | --- | --- | --- |
| #176 | fix(auth): restore Client Account Manager dashboard and requests | `6a7a280254f492589c8445b008b4ed21553a356d` | 119 | Passed / passed / passed (`32966401588`) |
| #177 | fix(auth): restore CAM customer invoice access | `502b8169be49378aec471bdd20fa7f1f433672db` | 120 | Passed / passed / passed (`32970581489`) |
| #178 | fix(forms): add professional international phone input | `e25e71ca4c83606217145ee2c923be5b2a1afcd8` | 121 | CI/deploy passed; Nightly `32977956237` exposed AX-FINAL-005, then #179 superseded it |
| #179 | fix(profile): preserve first-attempt image validation | `f1ceb048c46c744ef7d172efd8e6b23f0bc38ded` | — | Passed / passed / passed (`32983627730`) |
| #180 | fix(delivery): preempt stale tracking controls | `5622d7daf67b11600b8f8b9c017b579aa3499641` | — | Passed / passed / passed (`32990864797`) |
| #182 | fix(companies): keep demo company detail recoverable | `f5b398c179f3f21c4a6a3a6936076e3ad3cf6294` | — | Passed / passed / passed (`32993015096`) |
| #183 | fix(companies): clarify localized lifecycle filters | `7afb88760d6648c0cdab8ad8ff8a8bfdb7ba6bdc` | — | Passed / passed / passed (`32995359109`) |
| #181 | fix(mvp): retire historical organization UI | `704167cc2c6347116a439c2e40a720433379705d` | — | CI/deploy passed; Nightly `32997245657` passed on attempt 2 after one non-reproducible 5-second browser assertion |
| #184 | fix(i18n): localize portal domain states | `127fab0077f1184ee9d910fd9bbd2d100d855d78` | — | CI/deploy passed (`33000623984`); exact-main Nightly passed (`33000972840`) |
| #185 | fix(a11y): keep one portal main landmark | `97b5b4447126b109cda5bc1024589664f3bf5fbc` | — | Exact-head CI `33002810677`, main CI/deploy `33003047412`, and exact-main Nightly `33003361471` passed |
| #186 | docs(test): record final Gorilla evidence and route matrix | `9051a75a2068b3872c802b1386cb415f0a419dfa` | — | Exact-head CI, merge and deploy passed; authenticated acceptance then exposed AX-FINAL-011–013 |
| #187 | fix(auth): enforce CAM commercial confidentiality | `eac34c25b4adb466769aa1e6e7ab510c5f48afe8` | 122 | Exact-head CI `33036497200`, main CI/deploy `33036666674`, Nightly `33036885785` passed |
| #188 | fix(requests): keep malformed details recoverable | `b850e4379f81ec05e097f3b759d0511ebc34be24` | — | Exact-head CI `33038122188` and main CI/deploy `33038268316` passed; superseded by final exact-main Nightly |
| #189 | fix(deliveries): stabilize driver time hydration | `d4c129d33405b35805d8d0f60b9f66b88c91df07` | — | Exact-head CI `33039414413`, main CI/deploy `33039549260`, final runtime-code Nightly `33040805924` |

## 15. Final revision

- Final audited runtime-code SHA: `d4c129d33405b35805d8d0f60b9f66b88c91df07`.
- Final audited runtime OCI digest: `sha256:eb995cda1669471889d8d875dd8b64bdc477690211e69b2b13ad66c8e71be483`.
- Final migration head: `122_cam_commercial_confidentiality_ceiling.sql`.
- Final runtime-code exact-SHA Nightly Quality: `33040805924` (passed all stages).
- Post-runtime-code deployment unexplained HTTP 5xx / AX / SQLSTATE / deadlock / serialization / authorization-wrapper / workflow errors: `0` in the bounded app, Caddy and worker review.

The subsequent documentation/test-only evidence merge changes the repository and image digest without changing runtime source. Its final protected-main SHA, digest and exact-SHA Nightly are therefore recorded in the task closure after that merge; they cannot be self-referentially embedded in the commit that creates this report.

## 16. Infrastructure confirmation

- Cloudflare configuration changed: NO.
- Resend provider configuration changed: NO.
- Tailscale changed: NO.
- SSH changed: NO.
- Deployment-controller architecture changed: NO.
- GHCR architecture changed: NO.
- Systemd changed: NO.
- Backup-service changed: NO.
- DNS changed: NO.

## 17. Residual risks and release decision

No unresolved P0, P1 or explicit-contract P2 defect remains. No residual risk blocks the MVP or internship/demo acceptance.

Evidence limitations retained for accuracy:

1. The two originally supplied CAM error records were not both retained after container rotation, so `AX-238304097` and the exact `AX-858448370` timestamp cannot be reconstructed without inventing evidence. Root cause and both failing product paths were independently reproduced, fixed and authenticated in production.
2. No new provider-domain email was sent during final acceptance because the brief required avoiding unnecessary production email. Existing signed-provider/outbox evidence remains the acceptance basis; provider configuration did not change.
3. Next development mode emits CSP style warnings because its development style injection does not match the strict production nonce policy. The production-like standalone artifact, immutable image CI and deployed runtime are clean; release acceptance uses standalone mode.

Final decision: **FINAL SYSTEM GORILLA AUDIT CLEARED** and **FINAL INTERNSHIP / DEMO ACCEPTANCE READY**.
