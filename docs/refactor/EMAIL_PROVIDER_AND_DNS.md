# Email provider, DNS, and credential gates

Status: current Axora email direction and production gate reference.

Axora intentionally uses two different email services for two different
directions. Do not treat either service as a replacement for the other.

## Directional provider decision

```text
INBOUND EMAIL
External sender
  -> Axora company email address
  -> Cloudflare Email Routing / inbound receiving
  -> configured Axora inbound mailbox/workflow destination

OUTBOUND TRANSACTIONAL EMAIL
Axora business event
  -> account-setup delivery or durable transactional/workflow outbox
  -> private central email-sender
  -> Resend
  -> customer/user inbox
```

The current architectural decision is authoritative in
[`../EMAIL_ARCHITECTURE.md`](../EMAIL_ARCHITECTURE.md).

## Cloudflare inbound email — keep

Cloudflare remains part of Axora for receiving/routing inbound email. Preserve:

- existing Email Routing/MX behavior;
- inbound receiving destinations and routing rules;
- reply/enquiry receiving paths;
- DNS records required by inbound mail;
- Cloudflare Tunnel, `cloudflared`, proxying, networking and security controls.

Outbound email changes must not replace or disable those inbound capabilities.
Before changing a Cloudflare-labelled repository artifact, inspect its actual
behavior rather than deleting it by name.

The previously implemented Cloudflare **Email Sending** REST adapter and its
outbound delivery-lifecycle endpoint were a separate outbound experiment. They
are not the same thing as Cloudflare Email Routing. Resend now owns outbound
transactional delivery.

## Resend outbound email — active

Resend is the only active production outbound transactional provider.
`server-tools/email-sender.mjs` is the single provider boundary. Application
business modules do not receive the Resend API key and do not call Resend
directly.

Current protected files are:

```text
/etc/axora-production/secrets/resend_api_key
/etc/axora-production/secrets/resend_webhook_secret
/etc/axora-production/secrets/axora_email_service_auth_key
```

Provider/API credentials remain server-side files with restrictive ownership
and permissions. They do not belong in Git, client code, `NEXT_PUBLIC_*`
variables, browser bundles, logs, screenshots, tickets, or ordinary runtime
environment values.

## Outbound DNS gate

Adding Resend's outbound sender-domain records must not overwrite unrelated
inbound Cloudflare routing records. Before any production DNS mutation:

1. record the existing MX, SPF, DKIM, DMARC and Cloudflare Email Routing state;
2. use only the exact records provided for the approved Resend sending domain;
3. reconcile SPF rather than publishing conflicting SPF policies;
4. verify DKIM and DMARC alignment for outbound mail;
5. re-check that inbound Email Routing still receives mail after the change;
6. retain a tested rollback record for the inbound DNS/routing state.

DNS mutation is a manual production operation and is outside repository-only
implementation work.

## Outbound runtime gate

Current non-secret outbound runtime state is intentionally narrow:

```text
AXORA_EMAIL_PROVIDER=resend
AXORA_EMAIL_DELIVERY_ENABLED=false
AXORA_EMAIL_EVENTS_ENABLED=false
RESEND_DOMAIN_VERIFIED=false
RESEND_WEBHOOK_VERIFIED=false
AXORA_EMAIL_FROM_ADDRESS=noreply@axora.management
AXORA_EMAIL_FROM_NAME=Axora
AXORA_EMAIL_REPLY_TO=support@axora.management
```

Delivery may be enabled only when the verified Resend sender domain, protected
API key, signed provider-event route and webhook verification have passed the
current production checks. The application keeps delivery fail-closed while
those gates are incomplete.

## Provider events

Outbound lifecycle evidence is accepted only through the current Resend route:

```text
/api/email/provider-events/resend
```

See [`EMAIL_PROVIDER_EVENTS.md`](EMAIL_PROVIDER_EVENTS.md). The retired
Cloudflare outbound lifecycle endpoint was for Email Sending status events
(delivered/deferred/bounced/failed/rejected/complained), not inbound-message
receiving. Its removal does not remove Cloudflare Email Routing.

## Historical provider note

Earlier Axora work evaluated other outbound providers. Those outbound
instructions are superseded by the current Resend architecture. Historical
migrations and immutable provider evidence may retain old provider names so the
database/audit record remains truthful; they are not current provider
configuration.

## Production safety rule

If outbound delivery is uncertain, disable outbound delivery first. Do not
modify inbound Cloudflare routing as an outbound rollback technique. Inbound
mail routing and outbound transactional sending have independent ownership,
change records and rollback procedures.
