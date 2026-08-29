# Axora integration platform architecture

Status: Phase IV native Slack integration. The public API, Axora OAuth,
webhooks, Zapier provider access, and Slack provider access remain independently
flag-controlled. Zapier and Slack stay disabled until their separately
authorized provider credentials and private acceptance environments exist.

## Boundaries

The integration platform is an additional restriction around existing Axora
authorization. It is not a replacement for user, role, tenant, branch, CAM,
delivery-assignment, or explicit-DENY policy.

```text
OAuth bearer token
  ∩ active integration application
  ∩ active company connection
  ∩ active user grant and token family
  ∩ current active Axora user and role assignment
  ∩ current auth_version
  ∩ current effective permission (explicit DENY remains final)
  ∩ connected company and resource scope
  ∩ granted OAuth scope
  = permitted external operation
```

The token lookup recomputes live authorization on every API request. Revoking
the user, role assignment, company authority, explicit permission, grant,
connection, token family, token, or application therefore blocks the next
request even when the opaque token's nominal expiry has not elapsed.

## Runtime planes

- `/api/v1` is the stable external API. It does not reuse internal App Router
  actions as a public contract.
- `/oauth/*` is the authorization-code, token, and revocation plane.
- `/api/integrations/slack/*` is the provider-owned OAuth callback and signed
  revocation-event plane. It cannot issue Axora API tokens.
- `/integrations` is the authenticated management workspace. The Platform
  Owner controls application registration and operational visibility. A
  Company Administrator controls connections only for their own company. CAM,
  other company roles, and Delivery Agents do not gain integration-management
  authority.
- `integration_*` PostgreSQL tables hold applications, company connections,
  grants, opaque-token hashes, idempotency records, safe API audit evidence,
  and review-required request drafts. Forced RLS permits access only from named
  integration transaction contexts.
- A dedicated `integration-worker` container projects already-committed
  canonical state into `integration_events`, fans out company-bound delivery
  records, and performs bounded outbound HTTPS attempts. Its PostgreSQL role
  has no table or sequence privileges and only explicitly granted worker
  functions.
- `integrations/zapier` is a separately built Node.js 22 provider package. It
  uses the external OAuth/API/webhook contracts and has no import or execution
  path into Axora's business mutations.
- `integrations/slack/manifest.yaml` defines the native provider application.
  Slack installation credentials, channel metadata, messages, attempts, and
  inbound revocation deduplication remain in Slack-specific tables and worker
  paths.

No integration table is an email table. `transactional_email_outbox`, the
existing email worker, its provider network, and Resend are unchanged. The
integration worker has a separate database principal, queue, secrets, health
endpoint, logs, and Internet-egress network. Provider calls never run inside an
Axora business transaction.

## Event projection

The worker reads durable canonical sources only after the source transaction
has committed: companies, requests, immutable request approval decisions,
customer invoice finalization, and delivery workflow events. A checkpoint per
source uses `(timestamp, UUID)` ordering and row leases. Event uniqueness is
deterministic by source, source ID, event type, and schema version. Racing
projectors therefore produce one logical event, and retries retain the same
global event ID.

Migration 129 initializes every checkpoint at the existing production head.
Deployment does not replay historical business activity or send it to a newly
created subscription. A stopped projector leaves core Axora transactions
untouched and catches up from durable state after restart.

Migration 131 adds only a disclosure-policy column to webhook subscriptions.
Existing rows default to the Phase II one-time-secret behavior; provider rows
can persist `NONE` so creation replay and later rotation never disclose their
encrypted HMAC credential. It does not alter canonical business, account,
financial, or email data.

Migration 132 adds provider-owned application mode and isolated Slack OAuth,
installation, public-channel cache, delivery, attempt, and inbound-event
tables. The projector enables webhook and Slack fanout with separate
transaction-local capabilities. One deterministic event row can feed either
provider without making either delivery path a prerequisite of the other or
of the originating business transaction.

## Safe write model

Phase I exposes one external mutation: create a request draft. It writes only
to isolated `integration_request_drafts` and item tables together with its
idempotency and audit record. The result is `PENDING_REVIEW`; it cannot approve,
submit, debit a Wallet, spend a budget, create a payment or invoice, or create a
delivery.

An authorized Axora requester imports the draft into the canonical cart and
then reviews and submits it through the existing request workflow. Company
Administrator direct-purchase behavior is deliberately not used as a draft
shortcut.

## Feature flags and release order

The flags are independent and accept only the exact value `true`:

- `AXORA_EXTERNAL_API_ENABLED`
- `AXORA_INTEGRATION_WEBHOOKS_ENABLED`
- `AXORA_ZAPIER_ENABLED`
- `AXORA_SLACK_ENABLED`

Provider application definitions use reserved slugs. The `axora-zapier` slug
is checked against `AXORA_ZAPIER_ENABLED` at OAuth consent, code exchange,
refresh, every access-token request, and isolated worker delivery. Revocation
remains available while disabled. The worker blocks only Zapier-owned
destinations, so disabling Zapier does not disable generic webhooks.

The reserved `axora-slack` application uses `PROVIDER_OAUTH`, so database
constraints prevent it from creating Axora OAuth grants or authorization
codes. `AXORA_SLACK_ENABLED` independently hides its routes, blocks OAuth and
management, disables Slack projection and delivery, and leaves webhook and
Zapier behavior untouched. Provider revocation is queued locally before any
outbound revocation attempt.

The deployment sequence is additive migration, disabled application support,
health and security verification, then enablement of one capability. The
normal rollback is to disable the affected flag, restore the prior immutable
application image, and leave additive integration tables dormant for a
forward fix. No down-migration touches procurement or financial data.

## Secrets

Integration hashing, signing, and provider encryption use dedicated material
from `AXORA_INTEGRATION_ENCRYPTION_KEY_FILE` in production. The file is mounted
read-only and is distinct from session, database, Turnstile, email-service,
Resend, deployment, and future provider credentials. Opaque access tokens,
refresh tokens, authorization codes, consent handles, client secrets,
idempotency keys, network identifiers, and cursors are stored or keyed only as
domain-separated hashes where recovery is unnecessary.

The worker additionally uses a file-mounted password for the
`axora_integration_worker` database principal. It never receives the
application, PostgreSQL administrator, cleanup-worker, session, email-service,
Resend, Turnstile, or deployment credentials.

Slack's client secret and signing secret use their own read-only files. The
application receives both because it performs OAuth exchange and verifies
signed callbacks; the worker receives only the client secret needed for token
rotation and revocation. Slack access and refresh tokens are encrypted under
per-installation, per-version keys derived from the dedicated integration root
key. Neither token is displayed or logged.

## Compatibility contract

The foundation is additive. It does not change account email, password,
authentication version, role assignment, CAM company assignment, Wallet,
budget, payment, invoice, delivery, transactional email, DNS, Turnstile,
Tunnel, or production hostname behavior.
