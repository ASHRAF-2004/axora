# Outbound provider events and recipient suppression

Status: current Axora outbound-email operations contract.

This document covers **outbound transactional-email lifecycle events only**.
It does not replace or modify Axora's inbound Cloudflare Email Routing/receiving
architecture. See [`../EMAIL_ARCHITECTURE.md`](../EMAIL_ARCHITECTURE.md) for the
directional provider split.

## Current outbound architecture

```text
Axora business event
  -> account-setup delivery or transactional/workflow outbox
  -> central email-sender
  -> Resend
  -> customer/user inbox

Resend signed webhook
  -> POST /api/email/provider-events/resend
  -> raw-body Svix signature verification
  -> bounded Resend event normalization
  -> append-only provider lifecycle evidence
  -> recipient suppression for hard bounce / complaint / provider suppression
```

The active outbound provider-event route is:

```text
/api/email/provider-events/resend
```

The retired outbound Cloudflare Email Sending lifecycle route and the retired
ZeptoMail route are not current endpoints. Cloudflare remains in Axora for
**inbound** email routing/receiving and for Tunnel, DNS, networking and security
infrastructure.

## Authentication and request handling

The Resend adapter verifies the exact raw request body with the provider's Svix
headers and a server-only secret loaded from:

```text
/run/secrets/resend_webhook_secret
```

Production configuration must never expose that value to the browser or store
it in tracked environment examples. Requests fail closed when events are
disabled, the secret is unavailable, required signature headers are absent or
invalid, the timestamp is stale, the body is oversized, or the payload cannot
be normalized to a supported lifecycle event.

Supported normalized outbound lifecycle states include:

- submitted/sent;
- delivered;
- delayed/deferred;
- failed;
- bounced, with hard/soft classification where supplied;
- complained;
- provider-suppressed.

Open and click telemetry is not part of the current Axora security/delivery
contract.

## Idempotency and duplicate handling

Provider event identity is treated as an idempotency boundary. Replaying the
same valid event does not duplicate recipient-suppression state. Conflicting
reuse of an event identity is rejected by the database lifecycle boundary.

Axora retains privacy-minimized provider evidence. Recipient addresses and
provider message identifiers are fingerprinted for lifecycle correlation;
message bodies, subjects, reset/setup links and provider credentials are not
stored in provider-event evidence.

## Bounce, complaint and suppression behavior

A hard bounce, complaint, or provider-suppression event can derive the current
recipient suppression state. Pending eligible email for that fingerprint is
cancelled/blocked through the existing suppression checks. Soft/transient
failure evidence does not automatically become a permanent address
suppression.

Suppression applies to outbound email only. It does not alter in-app
notification availability and does not change the separate Cloudflare inbound
mail-routing decision.

## Production enablement

Outbound delivery remains fail-closed until all of these current Resend gates
are satisfied:

```text
AXORA_EMAIL_PROVIDER=resend
AXORA_EMAIL_EVENTS_ENABLED=true
RESEND_DOMAIN_VERIFIED=true
RESEND_WEBHOOK_VERIFIED=true
```

`AXORA_EMAIL_DELIVERY_ENABLED=true` is permitted only after those event/domain
gates are satisfied and the protected Resend API key is present. The production
preflight and sender readiness checks enforce this separation.

## Validation expectations

Before production enablement, verify at minimum:

1. valid signed Resend events are accepted;
2. missing/invalid/stale signatures are rejected;
3. malformed payloads are rejected without logging the body;
4. duplicate valid events remain idempotent;
5. a hard bounce creates suppression exactly once;
6. a soft bounce does not create permanent suppression;
7. complaint/provider-suppressed events derive suppression;
8. provider failures do not rewrite completed business transactions;
9. the durable outbox owns retry scheduling;
10. no recipient plaintext, bearer link or provider secret appears in logs.

## Inbound Cloudflare preservation

Cloudflare Email Routing and inbound receiving are intentionally retained. Any
change to inbound routing, inbound destinations, MX records or inbound-mail
processing is a separate task and must not be inferred from this outbound
provider-events document.
