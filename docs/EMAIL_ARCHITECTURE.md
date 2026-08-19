# Axora email architecture

Status: current product decision for the active Axora email system.

Axora deliberately uses different services for inbound and outbound email.
These directions must not be collapsed into one provider as part of ordinary
transactional-email maintenance.

## Directional provider contract

```text
INBOUND EMAIL
External sender
  -> Axora company email address
  -> Cloudflare Email Routing / inbound receiving
  -> Axora inbound-mail workflow or configured receiving destination

OUTBOUND TRANSACTIONAL EMAIL
Axora business event
  -> transactional/workflow outbox or private account-setup delivery
  -> central Axora email sender
  -> Resend
  -> customer/user inbox
```

### Inbound: Cloudflare — preserved

Cloudflare remains authoritative for inbound email receiving/routing and for the
Cloudflare infrastructure around the application. Do not remove Cloudflare
Email Routing, MX/routing configuration, inbound mailbox routing, DNS, Tunnel,
`cloudflared`, proxying, or security infrastructure when changing the outbound
provider.

The repository does not treat Cloudflare inbound receiving as an alternative
outbound sender. Provider selection in the central outbound sender is fixed to
Resend.

### Outbound: Resend — active

Resend is the only active production provider for Axora-generated transactional
email. Business modules do not call the Resend API directly. All current
outbound flows terminate at `server-tools/email-sender.mjs`, which owns the
protected API key, provider request validation, stable delivery idempotency key,
provider correlation, bounded failure classification, and safe logging.

The expected path is:

```text
business action
  -> account-setup delivery or durable transactional/workflow outbox
  -> private HMAC-authenticated sender boundary
  -> central Resend adapter
  -> Resend API
```

### Retired: ZeptoMail

ZeptoMail is not an active sender, webhook target, runtime option, readiness
state, operations option, or production configuration requirement. Historical
migrations and immutable historical delivery evidence may still contain the
provider name because those records describe what existed at that point in
Axora history.

## Cloudflare classification rule

Before modifying a Cloudflare-labelled artifact, classify it by behavior:

1. **Inbound email receiving/routing** — keep.
2. **Tunnel/networking/DNS/security** — keep.
3. **Obsolete outbound Email Sending implementation** — remove only after code
   inspection proves it belongs exclusively to the retired outbound sender.
4. **Historical evidence** — keep when required for migration/audit integrity.

The former `/api/email/provider-events/cloudflare` route belonged to category 3:
it accepted outbound delivery lifecycle states such as delivered, deferred,
bounced, failed, rejected and complained and wrote provider-delivery/suppression
evidence. It was not an inbound-message receiving or Email Routing endpoint.
The active outbound lifecycle route is `/api/email/provider-events/resend`.

## Operational invariant

A change that standardizes outbound delivery on Resend must not alter the
Cloudflare inbound-mail routing decision. A change to inbound mail routing or
its DNS is a separate product/operations task with its own review and rollback.
