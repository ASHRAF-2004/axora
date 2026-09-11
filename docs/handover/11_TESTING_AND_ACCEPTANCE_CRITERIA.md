# Testing and Acceptance Criteria

## Existing verification layers

The repository currently exposes these main quality layers:

- ESLint.
- TypeScript typecheck.
- Vitest unit/service/integration tests.
- PostgreSQL-native and PGlite migration/database checks.
- Next.js production build.
- Playwright E2E/browser journeys.
- Deployment preflight/health assets.

`npm run verify` runs lint, typecheck, tests and production build. Additional database/E2E commands are defined in `package.json` and CI/production scripts.

## Core acceptance criteria

### Identity and access

- Wrong-tenant and wrong-scope access fails.
- A user cannot gain authority by directly calling a server action/route.
- Self-approval fails.
- Deactivated/suspended users cannot continue normal access.
- Permission changes take effect without relying on stale client state.

### Company and organization

- New company activation/setup has a deterministic state.
- Company admin cannot see/manage another company.
- Branch/department boundaries are respected.

### Procurement

- Catalogue/cart/request uses authoritative product data.
- Request creation is idempotent against duplicate submission where supported.
- Approval and direct-purchase paths obey their distinct rules.
- Request state cannot jump through an invalid transition.

### Finance

- Budget effects are scoped and transactional.
- Pay is idempotent and server-authoritative.
- One finalized transaction produces the expected permanent invoice/document evidence.
- Email failure does not roll back payment/invoice truth.

### Delivery and receiving

- Only one actor can win a delivery claim/assignment.
- Retry/lost-response reconciliation does not duplicate a delivery effect.
- Customer tracking does not expose raw location detail beyond policy.
- Driver evidence does not mark final customer acceptance by itself.
- Receiving records accepted/damaged/missing outcomes correctly.

### Deployment/recovery

- Full migration chain applies cleanly from empty/current supported states.
- Backup is created before migrations when required.
- Candidate release passes readiness and representative smoke checks.
- Rollback can restore the previous application release without pretending to reverse schema automatically.

## Release decision

Do not use a single green build as the entire acceptance signal. For major workflow or security changes, require relevant unit/database/E2E denial and happy-path evidence plus operational smoke verification.
