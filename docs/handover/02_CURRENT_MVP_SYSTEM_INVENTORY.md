# Current MVP System Inventory

**Repository evidence:** `main` at `49ccf0e3413504e1f5a753b491dc1770533a6e80`.

## Technology baseline

- Next.js 16 App Router with React 19.
- TypeScript 6.
- PostgreSQL with forward-only SQL migrations and row/policy controls.
- Docker / Docker Compose packaging.
- Caddy application gateway and Cloudflare Tunnel preparation for public access.
- GHCR immutable image builds.
- GitHub Actions CI/deployment workflow.
- Tailscale-protected production deployment path.
- Vitest plus PostgreSQL-native/PGlite migration checks and Playwright E2E coverage.
- PDF generation and transactional-email infrastructure.

## Current functional inventory

### Identity and access

Implemented concepts include canonical role assignments, effective permissions, company/branch/department/delivery scope, invitations, sessions, deactivation/reactivation, protected-owner rules and server-side authorization. `src/lib/permissions.ts` is a central executable reference, but entity-level checks also live in service/repository/database boundaries.

### Company setup

The MVP includes company creation, activation/setup, company users, branches/departments, delivery locations and company-owned budget/wallet behavior. Recent migrations 102-115 harden activation, setup, budget and shopping/direct-purchase contracts.

### Catalogue

The catalogue supports managed products, customer-visible prices and protected commercial fields. Recent changes through the evidence commit specifically reinforce Client Account Manager catalogue routing/grants, inactive price-pending drafts and markup updates without exposing base cost.

### Requests and approvals

Requests are the canonical order workspace. The application has request creation, scope checks, approval state/evidence, direct purchase where authorized, status transitions, cancellation/hold reasons and current/historical compatibility paths.

### Finance

The current workflow includes branch/company budget effects, paid checkout, finalized invoices, generated PDFs, customer invoice access and payment/invoice separation. The current testing-stage payment strategy is intentionally provider-neutral.

### Delivery and receiving

The repository includes paid-job creation, self-claim/assignment controls, acquisition/delivery progress, live tracking, delivery evidence, privacy-safe company tracking, receiving confirmation and independent customer receipt semantics.

### Notifications, email and integrations

The repository contains provider-neutral transactional email infrastructure, Resend integration, owner reconciliation/usage tracking, notifications, an external integration foundation, webhook platform support and a Slack native integration. External provider readiness still depends on environment-specific configuration and verification.

## Database and migration state

`tests/full-migration-chain.test.ts` verifies every numbered migration through **136** at this commit. The test also verifies at least 68 public tables and at least 35 row policies in the generated current schema. Treat `database/migrations/` plus the migration tests as authoritative over prose documents that mention an earlier migration ceiling.

## Delivery/operations inventory

The CI workflow builds one immutable image and, for main-branch pushes, is designed to deploy the exact tested image through a Tailscale-protected, host-key-pinned SSH path. Production-architecture documentation describes Cloudflare edge -> Tunnel -> Caddy -> Next.js -> PostgreSQL as the intended public request path.

## Important limitation of this inventory

Repository readiness does not automatically prove external production state. DNS cutover, Cloudflare configuration, provider credentials, off-machine restore evidence and other manual gates must be verified operationally. Do not write "deployed" or "live" in handover notes unless runtime evidence supports it.
