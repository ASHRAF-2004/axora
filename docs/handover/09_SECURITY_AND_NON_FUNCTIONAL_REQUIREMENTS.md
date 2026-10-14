# Security and Non-Functional Requirements

## Security requirements

- Server-side authentication and authorization on every protected entry point.
- Live account/role/scope/session state must be authoritative over stale browser state.
- Fail closed on unknown roles, incompatible scopes and wrong-tenant access.
- Protect secrets in root-owned/environment-managed storage outside Git.
- Do not expose PostgreSQL or application admin ports publicly.
- Enforce upload validation, safe filenames, bounded sizes and authorized download paths.
- Keep audit evidence privacy-minimized and exclude credentials/tokens/secrets.
- Keep customer commercial data separated from Axora internal cost/profit information.
- Use CSRF/session protections and secure cookie settings appropriate to production.
- Require reviewed external-provider signature/authentication boundaries.

## Reliability requirements

- Important commands must be idempotent or reconciliable after uncertain responses.
- Database migrations are forward-only, serialized and tested as a full chain.
- Deployment should use exact tested artifacts rather than rebuilding a different image on the server.
- Create a verified backup before migrations that can affect production state.
- Maintain application rollback while recognizing that schema rollback is not the same as image rollback.
- Prove recovery on an independent/off-machine destination before treating backups as complete disaster recovery.

## Performance and operability

- Keep critical pages and APIs within practical operational latency for the pilot.
- Avoid unbounded table reads; use pagination/limits where data can grow.
- Separate liveness/readiness checks.
- Maintain actionable logs without leaking secrets or personal data.
- Keep operational runbooks short enough to follow under pressure.

## Maintainability

- Prefer canonical service/policy helpers instead of duplicated role or state logic.
- Keep business rules named and testable.
- Update documentation in the same change when the contract changes.
- Retire compatibility code deliberately after evidence shows it is no longer needed.

## Accessibility and localization

Arabic/English behavior, responsive layouts, keyboard-accessible controls and accessible contrast/form feedback should remain release criteria rather than cosmetic follow-up work.

## Known security items requiring further decision/evidence

The repository security baseline identifies broader-rollout items such as phishing-resistant owner authentication, proved off-machine recovery, wider tenant-policy hardening on historic tables, and external edge/provider verification. Revalidate these against the current branch before public rollout because the older security document was written against an earlier migration state.
