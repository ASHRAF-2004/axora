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

## Webhook boundary

Webhook configuration accepts exact HTTPS destinations on port 443 only.
Credentials, fragments, local or single-label names, reserved suffixes,
loopback, RFC 1918, carrier-grade NAT, link-local, metadata, documentation,
multicast, reserved, IPv4-mapped, and non-global IPv6 ranges are rejected.
Every address in a bounded DNS answer must be public. Delivery resolves again,
pins one checked address into the TLS connection, checks the connected peer,
and never follows redirects. DNS, connection, and response time are bounded;
response bodies are discarded and capped at 64 KiB.

Each subscription has an independently generated credential encrypted with a
per-subscription derived key. The credential is shown only for the idempotent
create or rotation result. A provider subscription may suppress even that
one-time response when its platform cannot safely redact the secret; Axora
still generates, encrypts, and uses the credential. Deliveries use HMAC-SHA256 over
`timestamp + "." + exact raw JSON`; receivers compare in constant time and
reject timestamps more than five minutes from their clock.

The projector and delivery worker re-evaluate the authorizing user's active
account, exact role assignment, `auth_version`, live company permission, and
explicit DENY. Lost authorization pauses the subscription and terminalizes
queued work before an HTTP attempt. Application, connection, and subscription
revocation likewise stop future claims.

The worker has no direct table or sequence privilege and receives only named,
bounded security-definer capabilities. It has dedicated outbound networking
and only the integration encryption key, its own database password, and the
provider client secret required when Slack is enabled. It cannot read or mutate
email, session, Wallet, budget, payment, invoice, delivery, proof, or account
data directly.

## Slack provider boundary

Slack is a provider-owned OAuth installation, not an Axora API principal. Its
reserved application row cannot create Axora OAuth grants, codes, access
tokens, or refresh tokens. A hashed, single-use, ten-minute state binds the
Slack callback to the initiating user, company, role assignment, and
`auth_version`. The callback redirects only to the configured canonical Axora
origin and never reflects its authorization code or state.

The manifest requests exactly `chat:write` and `channels:read`. It does not
request private-channel, user-write, file-write, admin, command, or interactive
approval capabilities. Company Administrators can select only a recently
synced, non-shared public channel in which the bot is already a member. CAM
assignment does not confer installation authority.

Access and rotating refresh tokens are AES-256-GCM ciphertext under
installation- and version-specific derived keys. Slack API hosts and paths are
fixed, redirects are disabled, requests and responses are time/size bounded,
and response bodies are not persisted. Every claimed message rechecks current
Axora authorization before decrypting a token and again immediately before the
provider call. A stable `client_msg_id` equals the integration event ID.

Inbound uninstall and token-revocation events require Slack HMAC-SHA256 over
the exact raw body, a timestamp within five minutes, the configured Slack app
ID, a known workspace, and event-ID deduplication. Disconnect and provider
revocation stop local access first, fail queued work closed, then attempt
bounded asynchronous provider token revocation. No provider callback deletes
procurement history.

Messages contain only an allowlisted title, order/invoice/delivery code,
branch, customer-facing currency/total, and an Axora HTTPS link. They disable
top-level Markdown and link/media unfurling. There are no Slack approval,
rejection, payment, Wallet, delivery-completion, or other financial controls;
opening the link still requires normal Axora authentication and authorization.

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

Reserved provider application slugs bind provider-specific flags to consent,
token exchange, token refresh, every bearer-token lookup, and outbound worker
delivery. Revocation remains usable while a provider is disabled. Disabling
`axora-zapier` does not disable generic customer webhooks.

Slack rollback is: set `AXORA_SLACK_ENABLED=false`, recreate only the
application and integration worker, confirm all Slack routes and delivery
claims are dormant, and if needed restore the prior immutable OCI. Migration
132 is additive and remains dormant. Slack and generic webhook queues, secrets,
and workers do not use either email outbox or the Resend worker.

Webhook rollback is: set `AXORA_INTEGRATION_WEBHOOKS_ENABLED=false`, recreate
only the application and integration worker, confirm readiness in dormant
mode, and if needed restore the prior immutable OCI. Migration 129 is additive
and remains dormant; no down-migration touches canonical records.
