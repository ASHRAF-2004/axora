# Security baseline and release gates

Status: refactor-branch security review, 2026-08-02. Scope includes the
Next.js application, PostgreSQL migrations/grants, files, email boundary,
Docker topology, and deployment/reset tooling. It is not a penetration test,
Cloudflare edge-policy audit, or claim that branch-only controls are live.
Production was observed at migration `013`; migrations `014`-`032` remain
target controls until an approved release is deployed and verified.

## Implemented branch controls

### Authentication and account lifecycle

- New users receive an expiring, revocable, single-use setup link and create
  their own password. No administrator-created plaintext password exists.
- Setup/reset tokens use cryptographically random bytes; PostgreSQL stores the
  validation digest, not the bearer value. Account-setup tokens have no
  ciphertext or outbox: the raw token exists only in memory for an atomic
  one-shot `SENDING` claim and synchronous HMAC-authenticated sender request.
  Password-reset and email-verification token payloads remain purpose-keyed,
  encrypted durable transactional-outbox data and are purged at terminal state.
- New passwords use Argon2id with bounded parameters. Existing bcrypt hashes
  are accepted only for compatible login and upgraded after success.
- Password fields support paste/managers, show/hide, length/strength feedback,
  and generic errors without arbitrary character-class rules.
- Sessions use `HttpOnly`, production-`Secure`, `SameSite=Strict`, host-only
  cookies. Password/security changes rotate credential versions and can revoke
  other sessions.
- Every authenticated request revalidates the active account, normalized role
  assignment, live scope/membership, credential version, and live session.
- Activated accounts that have not completed their profile and accepted the
  current server-owned policy version cannot enter normal page, Server Action,
  permission, or API workflows. The narrow incomplete-session accessor is
  restricted to profile/onboarding, account/security, help, sign-out, the
  shared shell, and the tenant-logo/profile-avatar resources those pages need;
  a source allowlist test prevents it from spreading silently. The browser
  submits only the acceptance decision and never chooses the stored policy
  version.
- Login, setup, reset, invitation resend, and public contact actions have
  durable application throttles. Login uses privacy-preserving network/account
  keys, progressive lock state, generic failures, and bounded Argon2 work.
- Forgot-password responses do not reveal whether an account exists.

### Authorization and tenant boundaries

- Page, Server Action, Route Handler, download, export, and background-worker
  boundaries authorize server-side; UI visibility is not a security control.
- Canonical roles require a compatible account kind and platform/company/
  branch/supplier/delivery scope. Unknown or inconsistent assignments fail
  closed.
- Customer queries are tenant/branch/self scoped. Supplier and driver portals
  additionally require assignment/membership and expose the minimum record
  subset.
- Self-approval is rejected. Supplier self-selection and driver final customer
  acceptance are structurally separated. Finance overrides require an
  independent actor and reason.
- Customer actors cannot access Axora buying cost, margin, private supplier
  identity/documents, internal notes, or another tenant.
- Technical support has only diagnostics/audited support visibility; the old
  commercial `manage_settings` grant is not part of its canonical role.
- Migration `031` keeps `audit_logs` private from the application role and
  exposes only a live-actor-checked aggregate support summary plus two fixed,
  bounded support-audit event shapes. It accepts no arbitrary entity, action,
  company, actor or JSON audit payload.
- Migration `032` moves session-revocation auditing behind a database trigger.
  It records only the transition to revoked plus bounded actor, company, and
  reason evidence; session hashes and device/network summaries are excluded,
  and the application role cannot execute the trigger function directly.
- Protected-owner, self-removal, last-company-admin, inactive-account, and
  inactive-company rules are checked server-side.
- Normal People & Access administration is lifecycle-only: administrators may
  deactivate or reactivate an in-scope account, and deactivation revokes any
  pending setup invitation. The portal, server actions, and user service expose
  no hard-delete path. Destructive identity clearing is reserved for the
  separately guarded baseline-reset procedure so references and immutable
  audit history are not rewritten by ordinary application requests.

### Browser, input, files, and database

- A per-request nonce CSP is enforced for HTML. Production disallows
  `unsafe-eval`; framing, object embedding, foreign bases/forms, and broad
  third-party origins are denied. Turnstile is the narrow approved exception.
- Caddy validates Host, caps route-specific bodies, strips identifying
  headers, and adds HSTS, `nosniff`, frame, referrer, permissions, opener, and
  cross-domain protections.
- Server inputs use runtime schemas, explicit length/range bounds, parameterized
  SQL, allowlisted dynamic identifiers, database constraints, and transactions.
- JPEG, PNG, WebP, and PDF uploads are verified by bytes/parseable structure,
  not only client MIME. Names are sanitized, IDs are generated, content stays
  outside public paths, and downloads use attachment disposition plus
  `nosniff`. Image dimensions/decompression limits are bounded.
- New portal/event tables use restrictive grants and tenant-aware row policies
  where designed. Append-only workflow history does not derive critical
  evidence solely from a mutable status row.
- Audit payloads exclude hashes, secrets, credentials, file/image bytes,
  invitation URLs, provider tokens, and email bodies.

### Email boundary

- The app has no provider credential or Internet egress. A private sender
  authenticates both the synchronous account-setup request and durable-queue
  requests with domain-separated, body-bound HMAC and clock/replay limits.
  Durable transactional/workflow queues add leases, idempotency, and bounded
  retries; account setup deliberately does not.
- Account-setup invitations are hash-only PostgreSQL records with one send
  attempt. `FAILED`, `DISABLED`, or `UNCERTAIN` requires explicit resend, which
  revokes the old invitation and issues a new token. Password reset, email
  verification, workflow, and contact messages retain their appropriate
  durable records and localized HTML/plain-text renderers.
- Recipient addresses and bearer URLs are resolved only inside the restricted
  sender boundary and are not logged.
- All six provider lifecycle events require signature verification, strict
  terminal/status validation, and replay protection. Raw recipients, message
  IDs, subjects and SMTP diagnostics are discarded; a private hashed
  correlation view relates events to immutable send outcomes. Complaints and
  hard bounces suppress later sends; other states, including soft bounces, do
  not create permanent suppression.
- Real provider delivery stays disabled until credentials, sending-domain DNS,
  monitored Reply-To, webhook secret, and a real sandbox/pilot message are
  independently approved and verified.

### Runtime, deployment, and recovery

- Caddy, app, PostgreSQL, Tunnel, and email services use isolated Docker
  networks; only loopback diagnostics are host-published. No database/app/admin
  port is part of the public path.
- Production containers are non-root where supported, read-only, capability-
  dropped, `no-new-privileges`, health-checked, resource-limited, and backed by
  file secrets outside Git.
- Exact-commit deployment is serialized, verifies the remote main SHA, runs
  quality/build gates, creates a pre-migration backup, applies forward
  migrations, and health-gates the candidate. App rollback does not reverse
  schema.
- Reset is a new-database replacement guarded by an allowlist, one-shot
  authorization flag, live typed phrase, sealed migration manifest, immediate
  encrypted backup, disposable restore, preserved source database, and upload
  quarantine. It never removes a Docker volume.

## Open security risks

### SEC-01 — High — phishing-resistant step-up is partially implemented

Password-only authentication can still create a platform-owner session, and
phishing-resistant second-factor controls are still not implemented. Sensitive
administrative operations now require explicit short-lived current-password step-up
before execution. Before a broad production rollout, add a reviewed phishing-resistant
second factor, owner enrollment audit, and recovery flow (or approve an equivalent
risk treatment) before reducing controls further.
Until then, keep the owner roster minimal, use password-manager-generated unique
credentials, review sessions/audit, and apply approved edge restrictions without
weakening normal authentication.

### SEC-02 — High — off-machine recovery is not proved

The repository can create, decrypt, checksum, and restore-test an encrypted
database/upload artifact locally. It cannot prove transfer to an independent
off-machine destination or separate passphrase escrow. The database reset and
Render decommissioning remain blocked until an operator copies the artifact,
verifies it there, escrows the key separately, and completes an isolated
restore/application smoke drill.

### SEC-03 — Medium — older procurement tables rely primarily on service scope

New portal tables have targeted row policies, but the historic core tables
still rely primarily on centralized server predicates and a shared application
database role. Exhaustive wrong-tenant/wrong-branch tests are required for
every endpoint. Evaluate broader RLS or tenant-scoped security-definer APIs as
a separate expand/contract change; do not enable ad hoc policies that break
owner, migration, audit, or worker paths.

### SEC-04 — Medium — branch controls are not deployed evidence

Production was observed at migration `013`. No document may imply invitations,
canonical roles, Argon2id, receipt unification, email suppression, or the new
portals are live until the exact reviewed commit is merged through protected
CI, migrations and grants are reconciled, and browser/runtime verification
passes.

### SEC-05 — Medium — real edge/provider controls need external verification

The repository cannot prove current Cloudflare rate rules, Tunnel/DNS routing,
Turnstile secrets, email domain authentication, monitored support mailbox,
webhook routing, or inbox delivery. These remain manual least-privilege gates;
do not reuse unrelated Cloudflare credentials or print them for convenience.

### SEC-06 — Low/operational — malware scanning is not yet a managed service

Upload signatures, parseability, isolation, size limits, disposition, and
authorization mitigate disguised browser content, but they are not endpoint
malware scanning. Add quarantine/scanning only with a documented engine,
signature-update, timeout, privacy, false-positive, and recovery model.

## Security release gates

Before public production or any destructive baseline reset:

1. complete full lint, typecheck, unit/integration, migration, browser,
   accessibility, production-build, and dependency checks;
2. run cross-tenant, cross-branch, self-approval, supplier, driver, receiver,
   internal-document, finance, export, and support denial tests;
3. verify public CSP/security headers, Host rejection, cookies, no-store,
   readiness behavior, Tunnel route, and Cloudflare controls at runtime;
4. approve and prove email DNS/provider/webhook/sandbox delivery without
   placing a secret or personal address in logs;
5. prove encrypted off-machine restore and retain the old database/application
   rollback boundary;
6. review the owner-MFA risk and approve a rollout/mitigation decision;
7. scan Git, image context, release artifacts, logs, and PR evidence for
   secrets and bearer links; and
8. require the explicit reset confirmation only after the exact live impact
   report and rollback artifacts are reviewed.

No production role, credential, edge rule, DNS record, database row, email, or
service was changed while preparing this baseline.
