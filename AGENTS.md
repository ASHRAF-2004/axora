# Axora repository guidance

Axora is a production multi-tenant procurement platform. Treat changes as
security- and data-sensitive, not as a demo application.

## Product invariants

- Keep the authenticated shell top-navigation based. Do not restore a
  permanent application sidebar.
- Preserve server-side role, tenant, branch, supplier and delivery-assignment
  authorization. A hidden link is never an authorization control.
- Customer users manage their people, branches, budgets, requests, approvals
  and receiving. Axora manages the global catalog, private suppliers, sourcing,
  fulfilment and operational finance. Do not expose Axora buying cost or private
  supplier data to customer tenants.
- Preserve separation of duties: no self-approval, driver evidence is not
  customer receipt approval, and suppliers cannot select their own quotation.
- Do not restore the removed company-configurable interactive-experience
  feature or its routes, permissions, assets or settings.
- Company themes come only from reviewed logo processing. Company users never
  receive raw color or theme editors.

## Identity and messaging

- Never create, display, log, persist or email a plaintext temporary password.
  New accounts use expiring, hashed, single-use invitation tokens and users set
  their own password.
- Passwords use the central password-policy module and are hashed with
  Argon2id. Do not add direct password writes or weaker compatibility paths.
- User-visible content must use the supported English, Arabic and Malay locale
  catalogs. Preserve RTL behavior, the saved profile locale and the saved
  profile timezone.
- Transactional email secrets stay outside Git. Account links must use the
  canonical HTTPS Axora origin, and provider events require signature
  verification.

## Database and production safety

- Migrations are forward-only and immutable after deployment. Apply schema
  changes through numbered migrations and rerun empty/current migration tests.
- Never run `docker compose down -v`, remove a production volume, use
  `--remove-orphans`, or remove `tailscale-db`.
- Do not reset, truncate, replace or restore the production database without
  the guarded reset workflow and the owner's explicit typed confirmation.
- Before any destructive data action, require a verified encrypted database
  and persistent-file backup, a disposable restore proof and a documented
  rollback path.
- Keep secrets out of source, command output, test fixtures, screenshots and
  documentation. Environment examples contain placeholders only.

## Verification

Run focused tests while editing, then before review run lint, type checking,
the complete test suite, migration/security tests, production build, browser
journeys at desktop/tablet/mobile, reduced-motion checks, secret scanning and
`git diff --check`. Do not claim real email delivery until a provider-domain
test succeeds. Do not deploy or merge a refactor branch without explicit user
approval.
