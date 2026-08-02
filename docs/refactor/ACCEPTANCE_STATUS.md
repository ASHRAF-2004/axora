# Refactor acceptance status

Status date: 2026-08-02

Branch: `feature/coherent-product-refactor`

Target migration baseline: `032`

This is a repository review checklist, not a production-completion statement.
The last read-only production audit observed migration `013`; target migrations
`014` through `032` represent 19 branch-only changes until an approved release
is deployed.

Status meanings:

- **IMPLEMENTED/VERIFIED** — implemented on the branch with focused automated
  or repository evidence. This does not mean it is deployed in production.
- **IMPLEMENTED-MANUAL-GATE** — implementation exists, but credentials,
  external infrastructure, production execution, or human approval is still
  required.
- **BLOCKED** — required input, proof, approval, or release state is absent.

## Product and experience

| Acceptance area | Status | Evidence and remaining boundary |
| --- | --- | --- |
| Top navigation, hamburger, active logo, profile and adjacent language control; no permanent sidebar | **IMPLEMENTED/VERIFIED** | `src/components/app-shell/AppShell.tsx`, `tests/legacy-ui-removal.test.ts`, `tests/portal-navigation-security.test.ts`, `e2e/role-portals.spec.ts`. |
| Responsive public Axora site, localized pages, top-right Login and Contact Us | **IMPLEMENTED/VERIFIED** | `src/app/[locale]/`, `tests/public-seo.test.ts`, `tests/public-contact.test.ts`, `e2e/public-accessibility.spec.ts`, `e2e/public-i18n.spec.ts`. Production Turnstile and contact-email delivery remain external gates below. |
| Browser-language detection, explicit saved choice, EN/AR/MS catalogs, profile locale/timezone and RTL | **IMPLEMENTED/VERIFIED** | `tests/i18n.test.ts`, `tests/core-portal-i18n.test.ts`, `tests/account-lifecycle-i18n.test.ts`, `tests/account-security-ui.test.ts`, `e2e/public-i18n.spec.ts`. |
| Axora branding for platform actors and deterministic logo-derived tenant branding without company color editors | **IMPLEMENTED/VERIFIED** | Migration `017`, `src/lib/brand-colors.ts`, `src/lib/tenant-branding.ts`, `tests/tenant-branding.test.ts`, `tests/portal-navigation-security.test.ts`. Only platform-owner regeneration is exposed and audited. |
| Original Axora login guide, password-focus feedback, mobile layout, static/reduced-motion behavior | **IMPLEMENTED/VERIFIED** | `src/components/LoginForm.tsx`, `e2e/public-i18n.spec.ts`, `e2e/public-accessibility.spec.ts`. |
| Personal profile, account, security, language, notification and session controls for authenticated actors | **IMPLEMENTED/VERIFIED** | `src/app/(portal)/profile/`, `src/app/(portal)/account/`, `tests/account-security-ui.test.ts`, `tests/account-security.test.ts`, `tests/portal-navigation-security.test.ts`. |
| Mandatory first profile stage and role tutorials with individual skip/resume and no global skip-all | **IMPLEMENTED/VERIFIED** | Normal page, Server Action, permission and API session access now fails closed until the live profile has accepted the server-owned required policy version. Only the tested profile/onboarding, account/security, help, sign-out, shell and required brand/avatar resource boundary can use the incomplete-session accessor. Evidence: `src/lib/auth.ts`, `src/lib/onboarding-policy.ts`, `tests/auth-live-session.test.ts`, `tests/onboarding-policy.test.ts`, `tests/onboarding-gate-allowlist.test.ts`, `tests/onboarding.test.ts`, and `tests/role-portals-i18n.test.ts`. |
| Role-focused company, branch, requester, approver, finance, auditor, support, supplier, driver and receiver workspaces | **IMPLEMENTED/VERIFIED** | `src/components/role-portals/`, `tests/role-portals-repository.test.ts`, `tests/role-portals-ui.test.ts`, `e2e/role-portals.spec.ts`. |
| Supplier RFQs, scoped quotations, availability, documents, selected-order acknowledgement and private-supplier isolation | **IMPLEMENTED/VERIFIED** | `tests/supplier-portal.test.ts`, `tests/supplier-rfq-operations.test.ts`, `tests/workflow-event-rls-security.test.ts`. Unsupported invoice-upload/scheduling claims are not presented as implemented. |
| Mobile driver assignments, recoverable offline event queue, partial handover, issue reporting and evidence | **IMPLEMENTED/VERIFIED** | Corrupt, partially invalid, future-schema and cross-driver queues are quarantined without overwriting their original browser storage; the driver can retry validation, export a private recovery file, or explicitly confirm discard. `tests/role-portals-ui.test.ts` and `e2e/driver-offline-recovery.spec.ts` cover recovery and normal queue survival. Migration `019` assigns authoritative server receipt time with `clock_timestamp()`, rejects client timestamps more than five minutes ahead, and state queries order by `(received_at,id)` rather than trusting device clocks; `tests/delivery-driver-event-migration.test.ts` and `tests/role-portals-repository.test.ts` verify those chronology boundaries. Status, note and line-outcome events work offline; binary photo/PDF evidence uploads require connectivity and explicit retry. |
| Independent customer receipt, discrepancy handling and three-way matching; driver proof is not receipt approval | **IMPLEMENTED/VERIFIED** | Migrations `019`, `025`, `027`, `tests/receiving.test.ts`, `tests/customer-matching-migration.test.ts`, `tests/customer-matching-security-migration.test.ts`, `tests/customer-matching-service.test.ts`, and `tests/receipt-accounting-unification.test.ts`. Exact retries return the persisted match without a second event or notification, conflicting idempotency-key reuse is rejected, and concurrent replay remains safe. |
| Append-only procurement tracking, role-scoped timelines and in-app/email notification state | **IMPLEMENTED/VERIFIED** | Migrations `018`, `023`, `026`, `tests/workflow-events.test.ts`, `tests/workflow-event-rls-security.test.ts`, `tests/notifications.test.ts`, `tests/request-approval-event.test.ts`. |
| Rejected company-configurable interactive-experience feature removed | **IMPLEMENTED/VERIFIED** | Migration `015`, `tests/removed-interactions-migration.test.ts`, `tests/legacy-ui-removal.test.ts`; routes, permissions, assets and runtime components are removed. |
| Updated company/admin PDF manuals and operational documentation | **IMPLEMENTED/VERIFIED** | `public/manuals/`, `scripts/manuals/`, `tests/manual-pipeline.test.ts`. Deterministic regeneration produced exactly four English/Arabic company/admin manuals of 13/13/14/14 pages; every page rendered successfully, and representative covers and instructional pages passed visual inspection. Exact-commit packaging remains part of the repository/PR gate below. |

## Identity, authorization and security

| Acceptance area | Status | Evidence and remaining boundary |
| --- | --- | --- |
| One-time, expiring, hashed invitation; user creates their own password; no plaintext temporary password | **IMPLEMENTED/VERIFIED** | Migrations `014`, `021`, `024`; `tests/account-setup-lifecycle.test.ts`, `tests/account-setup-email.test.mjs`, `tests/platform-owner-bootstrap-command.test.mjs`. |
| Invitation delivery/acceptance workflow and issuer notification | **IMPLEMENTED-MANUAL-GATE** | For company-scoped invitations, `tests/account-email-outbox.test.ts`, `tests/account-setup-lifecycle.test.ts` and `tests/workflow-notification-i18n.test.ts` cover `invitation.sent` only after confirmed delivery, atomic acceptance, localized issuer notification and secret-free event payloads. Platform, supplier and delivery invitations have no non-null company scope, so they intentionally retain audit-only evidence rather than inventing a tenant workflow event. Real email delivery remains an external gate. |
| Argon2id password setup/change, current-password reauthentication, reset, verification and session rotation | **IMPLEMENTED/VERIFIED** | `tests/account-security.test.ts`, `tests/account-security-actions.test.ts`, `tests/auth-password-upgrade.test.ts`, `tests/forgot-password-action.test.ts`, `tests/security-link-actions.test.ts`. |
| Generic auth failures, throttling, inactive-account checks and live server-side role/scope/session validation | **IMPLEMENTED/VERIFIED** | Migrations `016`, `022`; `tests/auth-rate-limit.test.ts`, `tests/auth-live-session.test.ts`, `tests/auth-scopes.test.ts`, `tests/permissions.test.ts`. |
| Tenant/branch/supplier/delivery isolation, no self-approval, no supplier self-selection, no customer access to Axora cost/private supplier data | **IMPLEMENTED/VERIFIED** | `tests/permissions.test.ts`, `tests/user-management-security.test.ts`, `tests/workflow-event-rls-security.test.ts`, `tests/customer-matching-security-migration.test.ts`, `tests/portal-navigation-security.test.ts`. Historic core tables still rely primarily on reviewed service predicates; broader RLS remains a documented future hardening option. |
| Technical-support diagnostics with narrow, append-only audited support actions | **IMPLEMENTED/VERIFIED** | Migration `031_support_diagnostics_security.sql`; `tests/support-diagnostics.test.ts`, `tests/support-diagnostics-migration.test.ts`, `tests/application-grants-security.test.ts`, `tests/permissions.test.ts`, `tests/portal-navigation-security.test.ts`. The focused set passed 6 files/42 tests, typecheck, ESLint and the Chromium support journey. |
| Privacy-minimized, database-owned session-revocation audit | **IMPLEMENTED/VERIFIED** | Migration `032_user_session_revocation_audit.sql`; `tests/account-security-session-audit-migration.test.ts`, `tests/account-security.test.ts`, `tests/account-security-actions.test.ts`, `tests/application-grants-security.test.ts`, and `tests/full-migration-chain.test.ts`. The focused 032 verification passed 8 files/33 tests, typecheck, focused ESLint and diff check. The trigger records only the revocation transition; session hashes and device/network summaries are excluded, and the application role cannot execute the trigger function directly. |
| CSP, secure headers, upload validation, bounded inputs and narrow database grants | **IMPLEMENTED/VERIFIED** | `tests/security-headers.test.ts`, `tests/file-content.test.ts`, `tests/production-upload-limits.test.ts`, `tests/application-grants-security.test.ts`. |
| Platform-owner MFA or phishing-resistant controls | **IMPLEMENTED-MANUAL-GATE** | Sensitive administrative actions now require short-lived password reauthentication (`requireRecentStepUp`) before mutation in server actions, with explicit state checks in `tests/account-security-actions.test.ts` and `tests/auth-live-session.test.ts`. Phishing-resistant platform-owner MFA/second factor and enrollment/recovery workflows are still pending before full rollout risk closure (`SECURITY_BASELINE.md` `SEC-01`). |

## Email, data, reset and infrastructure

| Acceptance area | Status | Evidence and remaining boundary |
| --- | --- | --- |
| Localized HTML/plain-text account, security, contact and workflow email rendering; isolated sender and local preview | **IMPLEMENTED/VERIFIED** | `email-templates/`, `server-tools/email-sender.mjs`, `tests/account-setup-email.test.mjs`, `tests/transactional-email-renderer.test.mjs`, `tests/workflow-email-renderer.test.mjs`, `tests/email-preview.test.mjs`. |
| Six Cloudflare lifecycle events, signed minimized endpoint, idempotency, private correlation and hard-bounce/complaint-only suppression | **IMPLEMENTED/VERIFIED** | Migrations `028` and `030`; `workers/email-events/`; `tests/email-provider-lifecycle-migration.test.ts`, `tests/email-provider-events-*.test.*`, `tests/email-provider-suppression-migration.test.ts`. |
| Real `noreply@axora.management` sending, DNS authentication, monitored Reply-To, provider token, Queue/DLQ, Worker secret/deployment and real inbox/event proof | **IMPLEMENTED-MANUAL-GATE** | Repository adapter, preflight and runbooks exist. No domain/DNS/provider mutation or real provider send was performed. Follow `ACCOUNT_EMAILS.md`, `EMAIL_PROVIDER_AND_DNS.md` and `EMAIL_PROVIDER_EVENTS.md`; do not claim production email until the controlled message and lifecycle correlation pass. |
| Forward migration from empty and populated schemas through target `032` | **IMPLEMENTED/VERIFIED** | `tests/full-migration-chain.test.ts`, `tests/support-diagnostics-migration.test.ts`, `tests/account-security-session-audit-migration.test.ts`, `tests/application-grants-security.test.ts` and `tests/platform-owner-bootstrap-command.test.mjs` passed fresh, populated `030`→`031` and `031`→`032` preservation, grant and bootstrap-baseline checks. Production remains at its separately observed baseline until deployment. |
| Guarded reset controller, exact impact plan, typed confirmation, immediate encrypted backup and disposable-restore logic | **IMPLEMENTED/VERIFIED** | `scripts/production/reset-baseline.sh`, `scripts/production/encrypted-reset-backup.sh`, `scripts/production/verify-encrypted-backup.sh`, `tests/production-reset-scripts.test.mjs`, `MIGRATION_AND_RESET_PLAN.md`. Verification is fixture/read-only only. |
| Destructive production database reset and fresh owner baseline | **BLOCKED** | Not performed. Explicit owner confirmation has not been requested because encrypted off-machine recovery, workbook/import, retention and isolated-restore gates remain incomplete. Production data was not dropped, truncated, replaced or restored. |
| Workbook import/bootstrap of approved companies, branches, products and users | **BLOCKED** | `WORKBOOK_IMPORT_REPORT.md` and `tests/workbook-bootstrap-validator.test.mjs` show missing authoritative masters, unknown roles and invalid/incomplete rows. No workbook row was imported. |
| Ordinary production backup and disposable database restore | **IMPLEMENTED/VERIFIED** | Read-only journal evidence is recorded in `RESET_READINESS_AUDIT.md`. This is not proof of encrypted off-machine recovery. |
| Encrypted off-machine recovery point, separate passphrase escrow and isolated recovered-application drill | **BLOCKED** | No approved off-machine artifact or independent recovery drill was proved; therefore reset and Render decommissioning remain blocked. |
| Production Docker topology, private networks, restart policies, health checks and exact-commit deployment controller | **IMPLEMENTED-MANUAL-GATE** | Compose/systemd/deployment assets and tests exist, but this refactor commit was not deployed or reboot-verified in production. |
| Cloudflare Tunnel/DNS/rate-rule/Turnstile/provider configuration for the refactored release | **IMPLEMENTED-MANUAL-GATE** | Repository configuration and runbooks exist. No Cloudflare mutation, DNS change, secret installation or external cutover was performed for this refactor. |

## Release and review gates

| Acceptance area | Status | Evidence and remaining boundary |
| --- | --- | --- |
| Combined lint, typecheck, full unit/integration suite, migration/security tests, production build, desktop/tablet/mobile/reduced-motion/slow-network journeys and secret scan | **IMPLEMENTED/VERIFIED** | `npm run verify` passed lint, type checking, 111 test files/578 tests, the 78-route production build and standalone `pg-cloudflare` CJS/ESM artifact checks. Browser verification passed 66/68 Chromium and mobile-Chrome tests with two intentional duplicate-project skips, including six driver-recovery journeys. Full and production dependency audits reported zero vulnerabilities; the final secret scan found only the documented placeholder in `.env.example`, and `git diff --check` passed. Production deployment and external acceptance remain separate blocked gates below. |
| Repository clean with reviewed logical commits and no committed secrets | **IMPLEMENTED/VERIFIED** | `git status` is clean. Branch follows logical commit structure from major refactor increments (`7`+ commits on topic), and no credentials are committed in source files (secrets remain externalized to deployment secret files). |
| Push, pull request and review package with screenshots, migration/reset/email/DNS/rollback evidence | **IMPLEMENTED/VERIFIED** | PR #30 is open and marked ready for review. Evidence package is `docs/refactor/PR_REVIEW_PACKAGE.md`, and screenshots live in `docs/refactor/screenshots/`. |
| Production deployment and external acceptance at `https://axora.management` | **BLOCKED** | This refactor was not deployed. Public domain behavior, production migrations, login, roles, email, restart recovery and rollback were not accepted against the branch. |
| Merge to `main` | **BLOCKED** | Not performed and must not occur automatically. Merge requires owner review after every release gate above is resolved. |

## Explicitly not performed

The following actions did **not** occur during this refactor review:

- no destructive production database reset, truncate, restore or database switch;
- no production workbook import or first-owner bootstrap;
- no real provider email, DNS authentication change or inbox-delivery proof;
- no Cloudflare Queue, Worker, Tunnel, DNS, Turnstile or secret mutation;
- no deployment of this refactor branch;
- no Render decommissioning;
- no main-branch merge from this review yet.

The branch must therefore be described as a substantial repository
implementation with unresolved production, recovery, external-provider and
release gates—not as a completed production refactor.
