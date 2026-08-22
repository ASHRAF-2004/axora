# Axora transactional email runbook

Status: current outbound transactional-email runbook.

Axora intentionally separates inbound and outbound email:

```text
INBOUND EMAIL
External sender
  -> Axora company address
  -> Cloudflare Email Routing / inbound receiving
  -> Axora inbound-mail destination/workflow

OUTBOUND TRANSACTIONAL EMAIL
Axora business event
  -> account-setup delivery or durable email outbox
  -> private central email sender
  -> Resend
  -> customer/user inbox
```

Cloudflare inbound email receiving/routing is preserved. This runbook governs
Axora-generated outbound transactional messages only. See
[`EMAIL_ARCHITECTURE.md`](EMAIL_ARCHITECTURE.md) for the directional provider
contract.

## Outbound provider contract

Resend is the only active outbound transactional provider. Business modules do
not receive the Resend API key and do not call Resend directly.

The provider boundary is:

```text
business workflow
  -> transactional/workflow outbox, or private account-setup delivery request
  -> HMAC-authenticated internal sender boundary
  -> server-tools/email-sender.mjs
  -> Resend adapter
  -> Resend API
```

The six `axora-*` names used by email queues are internal Axora delivery
streams, not external provider accounts. They partition authentication,
procurement, budget, delivery, document, and platform traffic while sharing one
central Resend implementation.

## Account invitation security

Account setup remains intentionally one-shot:

1. User creation commits the pending account, role/scope assignment, invitation
   metadata, and the SHA-256 hash of a cryptographically random 32-byte token.
2. The raw token remains in process memory only.
3. Before delivery, the application atomically claims the invitation and
   validates its current authorization/scope state.
4. The application sends one signed private request to `email-sender`.
5. The setup URL carries the token in the URL fragment, not the query string.
6. The sender renders the reviewed HTML/plain-text message and submits through
   Resend.
7. Delivery state is recorded without logging the token or message body.

A failed, disabled, or uncertain account-setup attempt is terminal for that
invitation token. Axora does not blindly retry a security-link invitation.
Authorized invitation resend revokes/replaces the prior invitation and creates
a fresh random token and hash.

No plaintext temporary password is emailed. Password creation remains part of
account setup and uses the existing Argon2id credential path.

## Durable transactional outbox

Password reset, email verification, password-change notices, validated website
contact mail, and other registered transactional messages use the durable
transactional outbox.

Security-token payloads are stored only in the existing purpose-bound encrypted
outbox representation and are cleared when the relevant delivery/token reaches
a terminal or revoked state. Contact mail contains no bearer token.

The private sender claims one short lease at a time. The outbox, not business
logic, owns retry scheduling. A provider failure therefore does not roll back an
already-completed business action.

## Workflow email outbox

Procurement, approval, budget, delivery, company/onboarding, document, finance,
and other registered workflow notifications use the tenant-bound workflow
email architecture.

The workflow outbox stores a recipient user identity rather than a copied raw
address. Enqueue/claim logic revalidates active account state, organization
scope, notification preference, event eligibility, and suppression before a
message can be sent.

Current event/template metadata and recipient content are rendered by the
central transactional email renderer. The final provider submission is always
made by the central Resend sender.

## Outbound message families

The current sender architecture covers the active registered message families,
including:

- account invitations and invitation resend;
- password reset;
- email verification;
- password/security notifications;
- validated contact acknowledgements and private contact notifications;
- company lead/onboarding/assignment workflow messages;
- request submission and request-status workflow messages;
- department/company/Axora approval-required messages;
- approval, rejection, return-for-changes, and cancellation messages;
- budget low/zero/refresh/failure messages;
- delivery assignment, acceptance, shopping/preparation, arrival, failure,
  reschedule, and completion messages;
- generated-document/PDF availability notifications;
- finance/reporting/system workflow notifications that are registered in the
  workflow email catalogue.

These business modules enqueue or request email through shared email services;
they do not call the Resend HTTP API directly.

## Provider events and suppression

Outbound Resend lifecycle evidence enters only through:

```text
POST /api/email/provider-events/resend
```

The route verifies the Resend/Svix signature against the exact raw body before
parsing. Timestamp/replay checks, bounded body handling, event identity, and
idempotent persistence remain fail-closed.

Supported current event mapping includes the Resend event types handled by
`src/lib/resend-provider-events.ts`, including submitted/sent, delivered,
delayed, bounced, failed, complained, and provider-suppressed outcomes where
supported by the adapter.

Provider event storage is privacy-minimized. It records normalized
fingerprints/correlation and lifecycle facts rather than message bodies or raw
recipient addresses. Duplicate provider event identifiers are idempotent;
conflicting reuse is rejected.

Hard bounces, complaints, and provider suppression update the existing recipient
suppression boundary. Soft/transient delivery states do not silently become
permanent suppression.

## Contact email

Validated Contact Us submissions remain durable even if outbound delivery is
unavailable. `AXORA_CONTACT_NOTIFICATION_TO` is server-only operational
configuration. Do not expose it through `NEXT_PUBLIC_*` or persist it into a
public response.

The visitor's address is used only as a validated Reply-To for the private
notification. Axora's configured sender address remains the From identity.

## Security links

Setup, reset, and verification links use URL fragments:

```text
https://axora.management/...#token=...
```

Browsers do not include fragments in the HTTP request target or ordinary
referrer. Client pages remove the fragment before their first network action and
submit the bearer token only through the intended server action/body path.
Request-body logging must remain disabled for these endpoints.

Password reset responses remain indistinguishable for known and unknown
accounts. Reset and verification tokens preserve their existing expiry,
single-use, replacement, and session-revocation behavior.

## Protected production files

Outbound provider/application secrets remain root-owned files outside Git:

```text
/etc/axora-production/secrets/resend_api_key
/etc/axora-production/secrets/resend_webhook_secret
/etc/axora-production/secrets/axora_email_service_auth_key
```

The API key is mounted only into `email-sender`. The Resend webhook signing
secret is mounted only where provider-event verification occurs. The internal
service-auth key protects app-to-sender and sender-to-outbox requests.

Do not place these secret values in `runtime.env`, Git, browser bundles,
`NEXT_PUBLIC_*` variables, logs, screenshots, support tickets, or documentation.

## Non-secret outbound runtime configuration

Current outbound runtime configuration is intentionally narrow:

```dotenv
AXORA_EMAIL_PROVIDER=resend
AXORA_RESEND_PLAN=FREE
AXORA_RESEND_MONTHLY_LIMIT=3000
AXORA_RESEND_DAILY_LIMIT=100
AXORA_EMAIL_DELIVERY_ENABLED=false
AXORA_EMAIL_EVENTS_ENABLED=false
AXORA_EMAIL_FROM_ADDRESS=noreply@axora.management
AXORA_EMAIL_FROM_NAME=Axora
AXORA_EMAIL_REPLY_TO=support@axora.management
RESEND_DOMAIN_VERIFIED=false
RESEND_WEBHOOK_VERIFIED=false
ACCOUNT_SETUP_TTL_HOURS=24
```

Delivery may be enabled only after the Resend API key, sender domain, signed
webhook, and current production readiness gates are verified. Events may be
enabled before delivery to validate the signed webhook path. A verified-webhook
claim is invalid if provider events are disabled.

The Resend plan values are non-secret configuration. Email Status displays
Axora-tracked recipient units derived from durable, successful Resend delivery
evidence. This is not the complete Resend account total: messages sent directly
from Resend or received outside Axora are not included. The protected opening
baseline is initialized once by an operator after migration 109; it is never a
demo seed or an application-editable setting. Periods use UTC. When upgrading,
set the plan to `PAID`, update the monthly allowance, and leave the daily limit
empty if the account has no daily quota.

## Production verification

Before enabling outbound delivery:

1. Preserve existing Cloudflare inbound Email Routing/MX behavior and record the
   current inbound DNS state for rollback.
2. Verify the approved Resend sending domain and its exact SPF/DKIM/DMARC
   records without breaking inbound routing records.
3. Install the protected Resend API key and webhook secret files.
4. Keep delivery disabled while enabling/testing signed Resend provider events.
5. Confirm a signed Resend test event is accepted and duplicate processing is
   idempotent.
6. Set `RESEND_DOMAIN_VERIFIED=true` and `RESEND_WEBHOOK_VERIFIED=true` only
   after real evidence exists.
7. Run the production preflight and repository CI gates.
8. Perform a controlled real invitation and transactional-message test using an
   Axora-controlled recipient.
9. Confirm successful provider correlation, bounce/failure behavior,
   suppression behavior, and retry handling.
10. Re-check that Cloudflare inbound email receiving/routing still works.

A local render, unit test, or disabled sender readiness result is not proof of
real inbox delivery.

## Local template capture

The developer-only Mailpit profile is a rendering/capture aid. It is not a
provider emulator or deliverability test and is not part of production ingress.

Follow [`../email-templates/README.md`](../email-templates/README.md) for the
current capture workflow. Template capture must not require provider secrets.

## Health and readiness

- `/api/health/live` proves the application process responds.
- `/api/health/ready` proves application/database readiness.
- `email-sender /health/live` proves the isolated sender process responds.
- `email-sender /health/ready` returns `disabled` while outbound delivery is
  intentionally off, `ready` only for valid enabled Resend configuration, and
  `not_ready` for an invalid enabled configuration.

Readiness checks do not send a real message.

## Failure and rollback rules

Provider HTTP/transport failure must not invalidate unrelated completed business
transactions. Durable outboxes retain retryable work according to the bounded
retry policy.

Ambiguous provider outcomes are not immediately replayed because duplicate
security links are worse than a temporary uncertain state. Operations must
reconcile an uncertain delivery before explicitly resending when required.

Outbound rollback is performed by disabling outbound delivery/events and
returning to a known-good application release. Do not alter Cloudflare inbound
Email Routing as an outbound rollback mechanism.
