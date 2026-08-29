# Axora webhook v1

Webhooks are asynchronous projections of already-committed Axora state. A
receiver outage, slow DNS, HTTP error, worker restart, or dead delivery cannot
roll back login, requests, approvals, Wallets, budgets, payments, invoices,
deliveries, proof of delivery, Contact, or transactional email.

## Event catalog

All current events use `schema_version: 1`:

- `company.created`
- `request.created`
- `request.submitted`
- `request.approved`
- `request.rejected`
- `invoice.finalized`
- `delivery.out_for_delivery`
- `delivery.arrived`
- `delivery.delivered`
- `delivery.completed`

Only canonical rows committed after migration 129 are projected. Event IDs are
stable across delivery retries. One subscription receives at most one logical
delivery for an event.

Each company connection is limited to 25 non-revoked subscriptions. Creation
is serialized on that connection so concurrent requests cannot exceed the
bound.

## Envelope

```json
{
  "event_id": "00000000-0000-4000-8000-000000000001",
  "event_type": "request.approved",
  "schema_version": 1,
  "occurred_at": "2026-08-29T00:00:00.000Z",
  "company_id": "00000000-0000-4000-8000-000000000002",
  "resource_id": "00000000-0000-4000-8000-000000000003",
  "resource_type": "request",
  "resource_url": "/api/v1/requests/00000000-0000-4000-8000-000000000003",
  "data": {
    "order_code": "ORD-FICTIONAL"
  }
}
```

The summary is deliberately small. It excludes email and phone unless a future
schema explicitly justifies them, supplier or buying cost, margin, coordinates,
proof paths or images, response bodies, audit internals, tokens, and secrets.
Use the external API with current authorization for current resource detail.

## Signature verification

Axora sends:

- `Axora-Event-Id`
- `Axora-Event-Type`
- `Axora-Event-Schema-Version`
- `Axora-Timestamp`
- `Axora-Signature: v1=<lowercase hex HMAC>`

The signed bytes are the decimal timestamp, a literal period, and the exact raw
request body. Compute HMAC-SHA256 with the subscription signing secret, compare
in constant time, require the header event ID to match the JSON event ID, and
reject a timestamp outside a five-minute window. Deduplicate on `event_id`.

Do not parse and reserialize JSON before signature verification. Store the
secret in the receiver's secret manager, never in source or logs.

Provider-managed receivers that cannot safely consume or redact a credential
may create the subscription with `credential_delivery: "none"`. Axora still
generates and encrypts an isolated credential and signs every delivery, but it
never returns that subscription's secret during creation, replay, or rotation.

## Destination policy

Subscriptions require HTTPS port 443. Axora rejects credential-bearing URLs,
fragments, redirects, local and internal names, localhost, private, link-local,
metadata, reserved, multicast, and non-global addresses. DNS is freshly
resolved with a strict timeout for configuration and every attempt; all answers
must be public, and the checked address is pinned into the TLS connection.

Redirects are never followed, including a redirect from a public endpoint to a
private host. Responses above 64 KiB are terminated and their bodies are never
stored.

## Delivery states and retry

Delivery states are `PENDING`, `DELIVERING`, `SUCCEEDED`, `RETRY`, `FAILED`,
and `DEAD`. Workers claim with a lease and `SKIP LOCKED`; an expired lease
returns to retry. Network failures, timeouts, HTTP 408, 429, and 5xx use bounded
exponential backoff with jitter. A valid `Retry-After` is honored up to one
hour. Redirects and ordinary 4xx responses fail without unbounded retry.

Eight attempts end a cycle in `DEAD`. An authorized Company Administrator or
the Platform Owner may start at most three manual retry cycles. Manual retry
uses the same event and delivery IDs. Response bodies are discarded; the UI
shows only safe status, HTTP code, attempt count, and error category.

## Authorization and revocation

A Company Administrator creates, rotates, and revokes subscriptions only for
their own company's active connection with `webhooks:manage`. The Platform
Owner may inspect and revoke globally and retry dead deliveries, but does not
receive a company's signing secret. CAM portfolio assignment alone grants no
webhook management capability.

Every claim rechecks the authorizing user, exact role assignment,
`auth_version`, company permission, explicit DENY, application, and connection.
Revocation pauses or revokes the subscription and terminalizes queued work.

## Retention and operations

Attempt and terminal delivery metadata expire after 90 days. Revoked
subscriptions and unreferenced immutable events expire after 180 days. OAuth
runtime cleanup is performed through the same bounded maintenance capability;
durable external API audit evidence is not deleted by webhook cleanup.

Disable only `AXORA_INTEGRATION_WEBHOOKS_ENABLED` to stop projection and
delivery and to fail closed all webhook management mutations. The disabled
worker stays healthy without querying PostgreSQL. The email outboxes, email
worker, and Resend are not part of this path.
