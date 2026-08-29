# Axora integration security contract

## Authorization

External authorization is fail-closed and conjunctive: active application,
company connection, OAuth grant, token, user, current role assignment,
`auth_version`, live effective permission, company/branch scope, OAuth scope,
explicit DENY, and resource policy must all allow an operation. OAuth scopes
can only reduce access. They never grant a capability absent from Axora.

The Platform Owner alone registers and activates applications or views global
integration operations. A Company Administrator may authorize and disconnect
connections only for their own company. CAM portfolio assignment does not
grant integration management. Delivery Agent and all other company roles have
no management access by default.

## OAuth controls

- Authorization Code with PKCE S256; no password, implicit, or client
  credentials grant.
- Exact pre-registered HTTPS redirect matching and same-origin consent POST.
- Short-lived, single-use hashed authorization codes and consent handles.
- Opaque 15-minute access tokens stored only as hashes.
- Rotating refresh tokens stored only as hashes. Replay revokes the entire
  family, its access tokens, and the associated grant.
- Explicit client binding for code exchange, refresh, and revocation.
- Connection, grant, client-secret rotation, application deactivation, account
  deactivation, assignment revocation, permission DENY, and `auth_version`
  changes invalidate future access.
- OAuth responses and token-bearing responses are non-cacheable. Tokens,
  codes, handles, secrets, and authorization headers are prohibited from logs
  and audit details.

## Tenant and data controls

All API lookups bind to the principal's connected company and reuse canonical
request-access policy for branch, ownership, CAM, and explicit-DENY behavior.
Foreign and nonexistent identifiers are indistinguishable. Invoice reads are
customer-direction only. API DTOs intentionally omit supplier acquisition
cost, buying cost, gross margin, raw coordinates, private proof storage paths,
internal telemetry, password data, and authentication material.

Forced RLS protects each `integration_*` table. Repository code must enter a
named integration audit transaction; ordinary application contexts have no
policy path. Cross-table composite foreign keys bind application, connection,
company, grant, user, assignment, and token-family relationships so mixed
tenant rows cannot be assembled.

## Secret separation

Production derives domain-separated HMAC and encryption keys from a dedicated,
file-mounted integration root key. It is never shared with Resend, the email
service, user sessions, Turnstile, PostgreSQL, deployment SSH, or provider
credentials. Operational templates contain paths and disabled flags only, not
secret values. Client secrets are displayed once after creation or rotation;
only their hashes are stored.

## Input and abuse controls

- Strict UUID, JSON, URL-encoded form, content type, body size, field count,
  and pagination validation.
- Signed route/company-bound cursors.
- Independent keyed rate-limit buckets by client, connection, token, route
  class, and where appropriate network.
- Stable safe errors and correlation IDs; database errors and stack traces are
  never returned.
- External mutations require a hashed idempotency key and canonical payload
  comparison in the same transaction as the staged effect and success audit.
- Management mutations require live permission checks and tenant-bound SQL.

Phase II extends this document with webhook destination validation, DNS
revalidation, redirect refusal, bounded HTTP behavior, signing, retry, and
dead-letter controls.

## Audit and privacy

The append-only external API audit records application, connection, company,
grant, delegating user, scopes, route/action, resource, safe result, HTTP
status, time, and correlation/network hashes. It never stores a bearer token,
refresh token, authorization code, client or provider secret, idempotency key,
Authorization header, or raw request body.

## Failure and rollback

Integration capability flags default off. Disabling them removes the external
surface without changing core Axora. Additive tables may remain dormant while
the application image is restored to the previous immutable OCI. Integration
failures must not block login, request workflow, Wallet, budget, payment,
invoice, delivery, proof of delivery, Contact, or transactional email.
