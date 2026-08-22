# Pull Request #30 Review Package: Axora coherent product refactor

Date: 2026-08-03

## Repository branch

- Branch: `feature/coherent-product-refactor`
- PR: #30 (ready for review)
- State: open

## Scope covered

- Top-shell navigation redesign (no permanent sidebar)
- Public marketing website and role-aware login entrypoint
- Tenant-branding from uploaded logo + no company color editor
- Role-specific role portals (company admin/branch approver/requester/finance/auditor/support/supplier/driver/receiver)
- Account lifecycle with one-time invitation setup, password setup/rotation/reset, and onboarding policy
- Append-only workflow/event model and role-aware timelines
- Supplier RFQ/quotation and customer delivery/receiving split
- Notification + email rendering + provider event integration
- Guarded migration and reset tooling; bootstrap/import and recovery scaffolding
- Removed company-editable interactive-experience feature
- Admin and operator runbooks plus security docs

## Verification evidence

- `npm run verify`:
  - `eslint` pass
  - `tsc --noEmit` pass
- `vitest run` -> **111** files, **586** tests passed
  - `next build` pass (78 route compile and static checks)
- `npm run test:e2e`
  - **66** passed, **2** skipped
- Latest completed CI run: `30770354193` (all checks successful)
- PR #30 status: open/review-ready.
- PR checks previously include browser journey verification, dependency audit, and build checks for worker/runtime artifacts.
- Security and migration coverage: unit/integration tests for invitation lifecycle, invitation email rendering, onboarding, onboarding-gate allowlist, portal authorization, permissions, event timeline, supplier/driver workflows, notifications, reset scripts, and migration chains.
- Screenshots are available under `docs/refactor/screenshots/`.

## Review artifacts to open

- Product architecture: `docs/refactor/ARCHITECTURE.md`
- Security baseline and remaining risk: `docs/refactor/SECURITY_BASELINE.md`
- Deployment architecture: `docs/PRODUCTION_ARCHITECTURE.md`
- Email design/provider setup:
  - `docs/refactor/EMAIL_PROVIDER_AND_DNS.md`
  - `docs/refactor/EMAIL_PROVIDER_EVENTS.md`
  - `email-templates/README.md`
- Migrations and reset:
  - `docs/refactor/MIGRATION_AND_RESET_PLAN.md`
  - `docs/refactor/RESET_READINESS_AUDIT.md`
  - `docs/refactor/WORKBOOK_IMPORT_REPORT.md`
- User manuals were retired by the internal-MVP simplification; business PDFs remain.

## Current known production gates (not in this branch execution)

- Real Cloudflare DNS/proxy/provider email prove-out
- Cloudflare tunnel + secret installation and domain acceptance checks
- Render decommissioning and live traffic cutover
- Destructive database reset and first-owner bootstrap with typed approval
- Off-machine recovery point/restore drill

## Commit and review hygiene

- Branch is clean (`git status --short`).
- PR is unmerged and currently review-ready.
- The branch intentionally remains production-safe: destructive actions are documented and guarded, but not executed from CI/PR workflow.
