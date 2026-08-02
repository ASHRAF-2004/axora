# Cloudflare Email Sending events and recipient suppression

This is a manual production infrastructure gate. Repository work prepares the
Worker, endpoint, migration, secret mounts and preflight checks; it does not
create Cloudflare resources, install a credential, deploy the Worker, enable
email, or change production DNS.

## Reviewed architecture

```text
Cloudflare Email Sending (axora.management)
  -> account event subscription: delivered + deferred + bounced + failed
       + rejected + complained
  -> Queue: axora-email-events
  -> queue-only Worker: workers/email-events
       validates source/domain/schema
       hashes the normalized recipient and opaque provider message ID
       discards recipient, subject, provider-account and SMTP details
       signs timestamp + method + path + exact body hash
  -> POST https://axora.management/api/email/provider-events/cloudflare
  -> PostgreSQL append-only email_provider_events
  -> private email_provider_delivery_lifecycle correlation read model
  -> email_recipient_suppressions (hard bounce or complaint only)
  -> account/security/workflow outbox claims recheck suppression

Failed forward (60 second per-message retry, at most five retries)
  -> axora-email-events-dlq
```

Cloudflare documents that Email Sending event subscriptions publish structured
events to Queues. Its recipient-sync guidance says to suppress every
`message.complained` event and only `message.bounced` events whose
`payload.bounce.type` is `hard`; exhausted temporary failures can be soft
bounces and must not be removed automatically:

- <https://developers.cloudflare.com/email-service/platform/event-subscriptions/>
- <https://developers.cloudflare.com/email-service/examples/email-sending/sync-recipient-records/>
- <https://developers.cloudflare.com/queues/configuration/batching-retries/>

No new DNS record is required specifically for the Queue consumer. Email
Sending domain authentication, SPF, DKIM, DMARC and sender-domain approval are
separate gates described in `docs/ACCOUNT_EMAILS.md`.

## Privacy and delivery behavior

The Cloudflare event includes more data than Axora needs. The Worker posts only:

- schema version;
- provider event ID;
- one of `MESSAGE_DELIVERED`, `MESSAGE_DEFERRED`, `MESSAGE_BOUNCED`,
  `MESSAGE_FAILED`, `MESSAGE_REJECTED`, or `MESSAGE_COMPLAINED`;
- the event's validated terminal flag;
- `HARD` or `SOFT` for a bounce;
- normalized recipient SHA-256 fingerprint;
- opaque provider-message SHA-256 fingerprint;
- provider event timestamp.

Axora does not persist the plaintext recipient, message subject, sender,
message ID, provider account metadata, SMTP status, SMTP response, delivery
duration, bounce/rejection/failure reason, account ID, zone ID, or subscription
ID. The database records only bounded lifecycle state and pseudonymous hashes.
Worker logs contain only the provider event ID and a bounded outcome code.
Axora's endpoint does not log request bodies.

The fingerprints are pseudonymous operational data, not anonymous data: a
person who already knows an address or message ID can calculate the same
digest. Direct event-table and lifecycle-view access therefore remains denied
to the application role. Suppression checks use a narrow boolean database
capability.

When Cloudflare returns a provider message ID, all three send paths retain it
only in their existing private/guarded outbox row. Migration `030` hashes those
IDs inside a private operator view and joins them to lifecycle event
fingerprints. The view reports
`MATCHED`, `AWAITING_PROVIDER_EVENT`, `NO_PROVIDER_MESSAGE_ID`, `UNMATCHED`,
`AMBIGUOUS`, or `LEGACY_UNCORRELATED`, so a missing/changed provider identifier
cannot silently become a false status. It returns no plaintext address or
provider message ID. Outbox `SENT` means that the synchronous send API accepted
the message; it is not rewritten later because those rows are terminal
evidence. The separate `provider_status` is the later Cloudflare delivery
state.

The provider event ID is the durable idempotency key. Replaying an identical,
freshly signed event returns success without incrementing suppression counts.
Conflicting reuse of an event ID is rejected. The HMAC is bound to a 90-second
timestamp window, HTTP method, exact route and exact request-body hash. This is
Axora's authentication between its Queue Worker and application; it is not a
claim that Cloudflare sends an HTTP webhook signature. Each Queue retry creates
a new timestamp and signature for the same minimized provider event.

A hard bounce or complaint cancels pending bearer-token email. Account-setup
invitations retain only a SHA-256 token hash, so there is no setup ciphertext to
erase or poll; later explicit resend rechecks suppression before its atomic
one-shot claim. Password-reset and email-verification transactional-outbox rows
erase their encrypted token payload when cancelled. In-flight email is not
rewritten because the provider outcome may already be committed. Every later
eligible send rechecks suppression. Changing and verifying an account's address
yields a different fingerprint. In-app notifications are never disabled by an
email suppression.

## One-time Cloudflare setup (manual approval required)

Prerequisites:

- `axora.management` is an enabled Cloudflare Email Sending domain;
- the operator is logged in to the correct Cloudflare account with least
  privilege;
- the application migration through `030_email_provider_lifecycle_events.sql`
  is staged through the normal deployment process;
- email remains disabled during setup.

1. In **Cloudflare > Queues**, create `axora-email-events` and
   `axora-email-events-dlq`. Do not reuse another application's queue.
2. On `axora-email-events`, open **Subscriptions > Subscribe to events**.
   Choose **Email Sending**, the verified `axora.management` sending domain,
   and all six lifecycle types: `message.delivered`, `message.deferred`,
   `message.bounced`, `message.failed`, `message.rejected`, and
   `message.complained`.
3. Review `workers/email-events/wrangler.jsonc`. It contains queue names and the
   public Axora endpoint, but no account ID, token or secret.
4. Generate a dedicated secret directly into the root-owned application file.
   The command writes no secret into shell history or terminal output:

   ```bash
   sudo sh -c 'umask 027; node -e '\''process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))'\'' > /etc/axora-production/secrets/axora_email_events_webhook_secret'
   sudo chown root:1000 /etc/axora-production/secrets/axora_email_events_webhook_secret
   sudo chmod 0640 /etc/axora-production/secrets/axora_email_events_webhook_secret
   ```

5. Install exactly the same value as the Worker's encrypted secret. The pipe
   does not print the value; confirm the Wrangler profile/account before this
   externally mutating command:

   ```bash
   cd /srv/axora/workers/email-events
   npx wrangler whoami
   sudo cat /etc/axora-production/secrets/axora_email_events_webhook_secret \
     | npx wrangler secret put AXORA_EMAIL_EVENTS_WEBHOOK_SECRET
   ```

6. Run local validation, which needs no Cloudflare login or mutation:

   ```bash
   cd /srv/axora/workers/email-events
   npm ci
   npm run types:check
   npm run typecheck
   npm test
   npm run deploy:dry-run
   ```

7. After explicit infrastructure approval, deploy the queue consumer from this
   directory with `npx wrangler deploy`. This is not part of the Axora app
   deployment controller.
8. Confirm the Queue shows the Worker as its consumer, five maximum retries,
   and `axora-email-events-dlq` as its dead-letter queue. Confirm the event
   subscription is scoped only to the Axora sending domain and all six event
   types.
9. In `/etc/axora-production/runtime.env`, set both:

   ```dotenv
   AXORA_EMAIL_DELIVERY_ENABLED=true
   AXORA_EMAIL_EVENTS_ENABLED=true
   ```

10. Run production preflight and deploy through the normal protected-main
    process:

    ```bash
    sudo /usr/local/libexec/axora-production/preflight.sh
    ```

Preflight refuses enabled email when the event consumer flag is disabled, when
the dedicated secret file is empty/malformed, or when its owner/mode differs
from `root:GID 1000` and `0640` (or stricter).

## Verification and operations

Before calling the feature production-ready:

1. Send a real provider test email to an Axora-controlled address.
2. Verify ordinary delivery without exposing an address in application logs.
   Confirm the lifecycle view reports `MESSAGE_DELIVERED` and `MATCHED` while
   preserving the original outbox `SENT` evidence. This controlled pilot must
   also prove that Cloudflare's REST `result.message_id`, when returned, is the
   same identifier published as event `payload.messageId`. The REST guide's
   example omits `message_id` while the current OpenAPI response model includes
   it, so repository tests cannot prove production correlation.
3. Use a provider-approved hard-bounce test recipient and confirm one append-only
   event plus one suppression; do not deliberately harm a third party's sender
   reputation.
4. Confirm another email to that address is not claimed while an in-app
   notification still appears.
5. Process a controlled soft-bounce fixture in staging/local tests and confirm
   the event is stored but no suppression is created.
6. Process controlled deferred, failed, and rejected fixtures and confirm their
   terminal flags/statuses without creating suppression.
7. Confirm a duplicate event returns success and does not increment counts.
8. Confirm an unknown provider-message fingerprint is visible as `UNMATCHED`
   rather than being attached to the wrong outbox.
9. Temporarily make the Axora endpoint unavailable in a safe test environment;
   confirm per-message retry and eventual DLQ behavior, then redrive only after
   fixing the cause.
10. Search Worker/Axora logs for the test event ID and verify no address,
   subject, SMTP response or secret appears.

Monitor Queue backlog, retry count, DLQ depth, Worker exceptions and Axora 5xx
responses. Treat a nonempty DLQ as an operational incident. Do not redrive a
poison event repeatedly; inspect its event ID and configuration first.

The Worker acknowledges malformed, wrong-domain, unsupported-schema, or
unsupported-type messages and emits only `discarded_invalid` with a bounded
provider event ID. It does not forward their provider payload or place them in
the DLQ. Alert on any `discarded_invalid` outcome because it can indicate a
subscription mistake or upstream schema change that requires a reviewed code
update. Forwarding failures emit `retry_scheduled`; successful posts emit
`forwarded`.

## Current verification status

The repository contains the queue-only Worker, pinned configuration, generated
types, local Worker tests, deploy dry-run command, signed application route,
production secret mount/preflight checks, migration `028`, append-only event
storage, migration `030` lifecycle expansion/private correlation view, and
claim-time suppression. This does not prove that either Queue,
the DLQ, event subscription, encrypted Worker secret, deployed consumer,
public route, real provider event, retry path, or DLQ redrive exists in the
Cloudflare account. Keep both `AXORA_EMAIL_DELIVERY_ENABLED` and
`AXORA_EMAIL_EVENTS_ENABLED` false until those manual gates are completed and
recorded.

## Rollback

Application rollback leaves migrations 028 and 030 and suppression/lifecycle
data intact. Do not drop either event table or remove claim-time suppression
during rollback: doing so can resume mail to recipients who complained or
hard-bounced. If the Worker must be stopped, first set
`AXORA_EMAIL_DELIVERY_ENABLED=false`; do not leave outbound email enabled
without lifecycle-event processing. Queue and Worker deletion are irreversible
external actions and require separate approval.
