# Axora integration platform architecture

Status: Phase I foundation. The public API and OAuth capability are dark by
default. Webhook, Zapier, and Slack runtime behavior is introduced in later
phases behind independent flags.

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
- `/integrations` is the authenticated management workspace. The Platform
  Owner controls application registration and operational visibility. A
  Company Administrator controls connections only for their own company. CAM,
  other company roles, and Delivery Agents do not gain integration-management
  authority.
- `integration_*` PostgreSQL tables hold applications, company connections,
  grants, opaque-token hashes, idempotency records, safe API audit evidence,
  and review-required request drafts. Forced RLS permits access only from named
  integration transaction contexts.

No integration table is an email table. `transactional_email_outbox`, the
existing email worker, and Resend are unchanged. Phase II adds a separate
event and delivery worker; provider calls never run inside an Axora business
transaction.

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

## Compatibility contract

The foundation is additive. It does not change account email, password,
authentication version, role assignment, CAM company assignment, Wallet,
budget, payment, invoice, delivery, transactional email, DNS, Turnstile,
Tunnel, or production hostname behavior.
