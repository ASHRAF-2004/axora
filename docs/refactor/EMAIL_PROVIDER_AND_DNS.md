# Account-email provider, DNS, and credential gates

Status: decision support and enablement runbook, audited 2026-08-02. The
repository currently implements only a Cloudflare Email Service adapter.
Delivery is installed disabled. **No DNS record, provider account, API token,
mailbox, production setting, invitation delivery, or reset was changed while
producing this document.**

## Current application boundary

The working-tree design keeps invitation state in PostgreSQL and provider
access in a separate `email-sender` container:

```text
authorized user-management action
  -> transaction creates a pending account and invitation containing only the
     setup token SHA-256 hash
  -> the app atomically claims PENDING -> SENDING and synchronously sends the
     in-memory raw token to email-sender over the private `mail` network using
     a body-bound HMAC
  -> email-sender renders the reviewed local template
  -> selected provider API over the sender's dedicated egress network
  -> recipient uses a single-use, expiring setup link
  -> failure, disabled delivery, or uncertainty requires explicit replacement;
     no account-setup outbox or automatic replay exists

Cloudflare delivery lifecycle event
  -> sending-domain event subscription and dedicated Queue
  -> queue-only Axora Worker validates and minimizes the provider event
  -> Worker HMAC-signs the exact body and posts to Axora
  -> migrations 028 and 030 record all six lifecycle states, correlate a
     hashed provider message ID to immutable send evidence, and suppress only
     complaints and hard-bounced recipients before later outbox claims
```

The same private sender also polls a separate workflow queue. Workflow rows are
tenant-bound to an append-only event and recipient user ID, then resolve the
current verified address only under a short claim lease. In-app and email
preferences are independent. Daily and weekly selections delay individual
messages to a delivery window; they are not generated or described as digests.
Workflow subjects are fixed localized copy and record-specific links must be
safe paths on the canonical Axora origin.

The application container must not receive a provider credential or general
Internet route. The sender must not expose a host port. Provider responses are
reduced to delivery state and a bounded message identifier; message bodies,
recipient addresses, setup URLs, tokens, and credentials must not enter logs.
The setup token belongs in the URL fragment so it is not sent in the initial
HTTP request target. PostgreSQL keeps only its digest plus invitation delivery
metadata. The raw setup token exists only in application/sender process memory
for the one synchronous request after an atomic `SENDING` claim; it is never
stored as ciphertext and is never polled. Password-reset and email-verification
tokens are a separate design and remain temporarily encrypted in the durable
transactional outbox until their terminal lifecycle state.

The current code in [`email-sender.mjs`](../../server-tools/email-sender.mjs)
supports provider-specific adapters behind the same durable Axora queues.
Cloudflare Email Service, ZeptoMail, and Resend remain explicit implementations;
changing providers is a code, configuration, readiness, and operational change,
not an environment-value alias.

The `email-preview` Compose profile is deliberately separate from this
boundary. It runs a pinned Mailpit container on host loopback and accepts fixed
non-production samples through the local HTTP API. It neither exercises the
sender credential nor proves DNS, provider acceptance, event subscriptions,
inbox delivery, or deliverability.

## Provider decision

The conditional recommendation is **Cloudflare Email Service for the first
controlled pilot**, because Axora already has a reviewed adapter and a
Cloudflare-managed application domain. That recommendation minimizes the
current implementation delta; it is not a claim that Cloudflare is cheaper,
more reliable, or more deliverable than the alternatives.

It is also conditional on three manual facts being proved before enablement:

1. the production account is eligible for the required Email Sending service
   and arbitrary-recipient use—Cloudflare's current setup documentation says
   this path requires Workers Paid, which must be rechecked at enablement;
2. the exact sending domain can be onboarded without disrupting existing mail
   routing; and
3. the operator accepts that Cloudflare documents Email Sending as beta; and
4. provider-side Email preview can be explicitly disabled for the sending
   domain because Axora messages include live one-time security links.

If any of those gates fails, keep delivery disabled and make a reviewed
provider decision. Do not weaken sender verification or reuse an unrelated
Cloudflare credential to force enablement.

## Evidence-based comparison

| Topic | Cloudflare Email Service | Resend | Postmark |
| --- | --- | --- | --- |
| Current Axora support | Implemented REST adapter and read-only preflight | Not implemented | Not implemented |
| Application change | Validate and deploy existing adapter | Add provider adapter, request/response mapping, preflight, tests and runbook | Add provider adapter, request/response mapping, preflight, tests and runbook |
| Provider credential | Dedicated Cloudflare API token with only the documented Email Sending permission for the required account | Dedicated Resend API key scoped as narrowly as the service permits | Dedicated Postmark Server API Token for the intended server/message stream |
| Sender proof | Cloudflare-managed DNS and sending-domain onboarding; documented records include bounce MX, SPF and DKIM | Verify an owned domain with the provider's SPF and DKIM records; DMARC is separately available | Confirm a sender signature or authenticate a domain; Postmark recommends DKIM and a custom Return-Path |
| Documented API result to normalize | Cloudflare recipient-grouped `delivered`, `permanent_bounces`, and `queued`; the current OpenAPI model also includes `message_id`, although the REST-guide example omits it | Resend send-email response identifier | Postmark response including `MessageID` |
| Material caveat | Cloudflare documents the service as beta, requires Workers Paid for arbitrary recipients, and may default new sending domains to about seven days of message-body preview; Axora preflight requires that preview off | No repository adapter or operational proof exists | No repository adapter or operational proof exists |

Primary documentation used for this decision:

- Cloudflare: [Email Service overview](https://developers.cloudflare.com/email-service/),
  [sending-domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/),
  [REST sending](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/),
  [pricing](https://developers.cloudflare.com/email-service/platform/pricing/),
  and [Email preview changelog](https://developers.cloudflare.com/changelog/product/email-service/).
- Resend: [domain verification](https://resend.com/docs/dashboard/domains/introduction)
  and [send-email API](https://resend.com/docs/api-reference/emails/send-email).
- Postmark: [send with the API](https://postmarkapp.com/developer/user-guide/send-email-with-api)
  and [sender signatures/domain authentication](https://postmarkapp.com/developer/user-guide/managing-your-account/managing-sender-signatures).

The following cannot be selected responsibly from documentation alone:
production deliverability, inbox placement, effective rate limits, current
price, support response, privacy/data-residency fit, bounce/suppression
behavior, webhook operations, and latency from this host. Record the current
contract terms and run an approved pilot with representative non-personal test
mailboxes before making comparative claims.

## DNS is a manual change gate

DNS onboarding must not be performed by the installer, migration, deployment,
or reset utility. A named operator must use an approved change record and:

1. Export or otherwise record the current authoritative DNS zone, existing MX,
   SPF, DKIM, DMARC, Cloudflare Email Routing rules, TTLs, and a tested rollback
   procedure. Redact private routing destinations from the change record.
2. Select the exact sending domain. Prefer an intentionally scoped subdomain if
   that simplifies isolation, but do not assume a subdomain is harmless: its
   alignment, return path, reply behavior, and reputation still require review.
3. Add only the records shown for that exact domain by the selected provider.
   Reconcile them with existing mail service rather than replacing unrelated
   MX or routing records.
4. Maintain one SPF policy TXT record per hostname. If a policy already exists,
   merge the approved provider mechanism into it and check the resulting DNS
   lookup budget; do not publish two competing `v=spf1` records.
5. Verify DKIM, the provider's bounce/Return-Path design, SPF/DKIM alignment,
   and the organization's DMARC policy. A provider dashboard's “verified” badge
   is one gate, not the entire alignment test.
6. Turn provider-side Email preview off for the exact sending domain. A body
   preview can retain one-time setup, reset, or verification bearer links even
   when application logging is correctly disabled.
7. Prove that `Reply-To` is a real, monitored support mailbox with an approved
   owner and retention process. DNS records do not create a mailbox.
8. Confirm the application hostname, Tunnel records, apex mail receiving, and
   any existing Email Routing still behave as before. Wait for provider
   verification and independent DNS resolution from more than one resolver.
9. Attach the before/after record set, provider verification result, test
   evidence, approver, UTC time, and rollback outcome to the change record.

Do not copy DNS values from examples in this repository or from another
account. Provider-generated DKIM selectors, return paths, and ownership values
must come from the approved production account.

## Credentials are a separate manual gate

Create two independent secret classes for the current boundary:

- a dedicated provider API token readable only by `email-sender`; and
- a randomly generated app-to-sender/transactional-outbox key readable only by
  the app and sender. The account-setup path derives only its HMAC
  authentication key; separate fixed domain labels derive authentication and
  encryption keys for the password-reset/email-verification transactional
  outbox.

Neither secret may be the Global API Key, Tunnel token, session secret,
database password, deployment key, personal user token, or a credential reused
by another system. Apply the provider's least privilege to the required account
and sending service only. Store each value in its own root-owned file under the
production secrets directory with the deployment runtime group and mode
`0640`; mount only the file needed by each container.

Do not place credentials in Git, Compose environment values, tracked examples,
shell history, command arguments, tickets, screenshots, chat, process listings,
or logs. Record only a provider-side credential identifier, owner, purpose,
creation time, expiry/rotation date, and revocation procedure. Test rotation by
installing a new secret file through the normal controlled deployment and then
revoking the old credential. If exposure is suspected, disable delivery first,
revoke and replace the credential, and inspect provider and Axora audit events.

## Safe enablement sequence

1. Deploy the schema and sender with `AXORA_EMAIL_DELIVERY_ENABLED=false`.
   Disabled readiness must succeed without reading or calling a provider.
2. Verify pending accounts cannot sign in; the account-setup database row has
   only the SHA-256 hash; the atomic `SENDING` claim is one-shot; explicit
   resend revokes the old invitation; and no raw token or personal contact data
   appears in application, proxy, container, systemd, or provider-visible
   request logs.
3. Complete the DNS and credential gates above. Keep the token value out of
   the change evidence.
4. Create and validate the dedicated Queue, DLQ, all-six sending-domain event
   subscription, queue-only Worker, and shared HMAC secret by following
   [EMAIL_PROVIDER_EVENTS.md](EMAIL_PROVIDER_EVENTS.md). This is a separate
   explicitly approved Cloudflare infrastructure change.
5. Run the repository's read-only provider preflight. It verifies account,
   zone, token, sending-domain readiness, and that Email preview is explicitly
   off; it must not send mail or modify provider state.
6. Enable delivery and provider events together in the root-owned runtime
   configuration and deploy through
   the normal controller. Require app readiness and private sender readiness.
7. Send one explicitly authorized invitation to a controlled test account.
   Verify display name, From, Reply-To, setup origin, expiry, single use,
   rendering without remote images, and provider/Axora state reconciliation.
   Confirm the REST `result.message_id`, when returned, exactly matches the
   event subscription's `payload.messageId`; otherwise record
   `NO_PROVIDER_MESSAGE_ID` and keep end-to-end correlation unverified.
8. Test disabled, rejected, rate-limited, uncertain, expired, replaced, and
   wrong-recipient paths before allowing normal account invitations.
9. Complete the delivered, deferred, hard/soft bounce, failed, rejected,
   complaint, correlation, duplicate, retry and DLQ checks in the event
   runbook. Cloudflare's account suppression list and Axora's local fingerprint
   suppression are complementary; do not bypass either one.
10. Start with a bounded pilot. Review bounces, complaints, suppressions and
   support handling without logging message contents or contact lists.

Do not bulk-resend pending invitations when enabling a provider. An authorized
administrator must deliberately replace/resend each invitation so an obsolete
or misaddressed token is revoked.

## Failure, rollback, and provider switch

- First response to provider or DNS uncertainty is to set delivery disabled.
  Pending accounts and hash-only invitation records remain in PostgreSQL, as do
  the separate encrypted transactional outbox records. Account-setup resend is
  deliberate replacement: it revokes the old invitation and creates a new
  token; no plaintext password fallback is permitted.
- A provider rejection may be marked failed and reviewed. A connection failure
  or 5xx after request transmission has an uncertain delivery outcome and must
  not be blindly replayed, because the provider may already have accepted it.
  Account setup is never automatically replayed. Only an explicitly recognized
  rate-limit response for the separate durable transactional/workflow queues
  may return a pending row to delayed retry within its bounded attempt limit.
- Roll back application code with forward-compatible schema in place. Do not
  reverse invitation/outbox migrations and do not remove persistent volumes.
- Roll back DNS using the recorded prior values only when the effect on inbound
  mail, DMARC, and already accepted provider messages is understood.
- A provider switch requires one active adapter at a time, a new dedicated
  credential, fresh DNS verification, provider-specific preflight, and an
  explicit cutover point. Never dual-send the same durable outbox row or the
  same account-setup delivery ID/token to compare providers; that creates
  duplicate links and ambiguous state.
- Revoke the former provider credential only after delivery is disabled there,
  Axora has no in-flight uncertain attempts, and the rollback decision is
  recorded.

## Decision record required before production enablement

The approver must record the chosen provider and sending domain, current
service status/terms, account eligibility, DNS diff, mailbox owner, credential
identifier and scope, data-handling assessment, test evidence, rollback owner,
and review date. Until that record and all gates above pass,
`AXORA_EMAIL_DELIVERY_ENABLED` remains `false`.

## Current verification status

Repository assets exist for the REST adapter, isolated sender, local Mailpit
capture, read-only provider preflight, migrations `028` and `030`, signed Axora
endpoint, private lifecycle correlation view, and Queue consumer Worker. Those
assets are reviewable and locally testable.
They are not evidence that the Cloudflare Email Sending domain, paid-plan
eligibility, DNS records, account-owned token, monitored support mailbox,
Queue/DLQ, event subscription, Worker secret/deployment, public webhook route,
provider sandbox/pilot message, all-six event subscription and correlation, or
inbox rendering
has been configured or verified. Production delivery must remain disabled
until that evidence is recorded.
