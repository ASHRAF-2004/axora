# Axora transactional email runbook

Status: repository email implementation through migration `030`, reviewed
2026-08-02. The production provider remains disabled. No Cloudflare Email
Sending domain, API token, Queue subscription, consumer Worker, monitored
support mailbox, DNS change, or real provider-delivered test message is proved
by this document.

Axora sends reviewed HTML and plain-text messages for account setup, password
reset, email verification, validated website enquiries, and role-scoped
procurement workflow updates. No
administrator-created or reusable plaintext password is emailed, stored, or
logged. A pending user cannot sign in until its setup link is consumed.

## Delivery architecture

```text
Account-setup invitation action
  -> PostgreSQL transaction stores the pending account, invitation metadata,
     and only the SHA-256 token hash
  -> the raw token remains in process memory
  -> an atomic PENDING -> SENDING claim validates the token hash and makes the
     delivery one-shot
  -> the application synchronously HMAC-authenticates one private request to
     email-sender, which renders the reviewed HTML + plain-text template
  -> Cloudflare Email Service REST API
  -> Axora records SENT, FAILED, DISABLED, or UNCERTAIN on the invitation
  -> no account-setup outbox, ciphertext, lease poller, or automatic retry

Password reset / email verification / contact action
  -> PostgreSQL transaction stores the business record + encrypted durable
     transactional outbox row
  -> email-sender claims a short lease through an HMAC-authenticated private route
  -> email-sender decrypts only the claimed payload and sends it

All provider deliveries
  -> Cloudflare Email Sending publishes all six lifecycle events to a Queue
  -> queue-only Worker minimizes and HMAC-forwards the event to Axora
  -> Axora records append-only evidence, correlates provider status to the
     immutable send outcome, and suppresses only hard bounces/complaints
```

The application container has no Internet egress and never receives the
Cloudflare API token. `email-sender` is the only service on both the private
mail network and the outbound email network. It has no published port and logs
neither recipient data nor setup URLs.

Workflow updates use their own tenant-bound `workflow_email_outbox`. The table
stores a recipient user ID, not a copied email address. Enqueue and claim both
revalidate the source event, active tenant/supplier/delivery relationship,
verified account address, global email control, per-event preference, and
temporary mute. The application role has no direct table privilege; it can use
only the reviewed enqueue, claim, and completion functions. The fixed localized
subject contains no request number or commercial detail. The HTML and plain
text bodies link only to an Axora-relative authenticated route.

Website-contact email also uses a fixed localized subject and preheader. The
visitor's name, company and enquiry subject appear only inside the escaped
message body, reducing accidental disclosure in lock-screen subject previews.

Outbox `SENT` is immutable evidence that the synchronous Cloudflare API
accepted or queued the message; it is not a claim of recipient-server delivery.
Migration `030` records later provider lifecycle events separately and exposes
a database-owner-only `email_provider_delivery_lifecycle` view. That view hashes
the existing provider message IDs, reports matched, missing, ambiguous and
unmatched correlation explicitly, and never returns a raw message ID or
recipient address. Provider events never rewrite final send rows.

`IMMEDIATE`, `DAILY`, and `WEEKLY` are delivery schedules for individual
workflow messages. Axora does not call delayed individual emails a digest. A
known-safe provider rate limit may return a leased row to `PENDING`, up to three
attempts; an expired lease or ambiguous provider outcome becomes `UNCERTAIN`
instead of being replayed blindly.

Security links contain 256-bit random bearer tokens, and PostgreSQL keeps their
SHA-256 hashes for verification. Account-setup delivery is intentionally
different from the other security-email queues: its raw token exists only in
application/sender process memory for one HMAC-authenticated synchronous send.
PostgreSQL stores no account-setup token ciphertext, and there is no
account-setup outbox or poller. Immediately before the token crosses the private
mail boundary, an atomic update verifies the hash and changes exactly one live
invitation from `PENDING` to `SENDING`; another sender cannot claim it.

Any account-setup `FAILED`, `DISABLED`, or `UNCERTAIN` result is terminal for
that token. Axora never automatically retries it. An authorized administrator
must explicitly resend, which revokes the old invitation and generates a new
token and hash. Reconcile `UNCERTAIN` with the provider first, because the
provider may already have accepted the original message.

Password-reset and email-verification messages remain durable. Their raw token
payload is stored temporarily as purpose-bound AES-256-GCM ciphertext in the
transactional outbox, protected by the external email-service key, and is
purged when delivery becomes final or the token is used, revoked, replaced, or
expires. Contact messages contain no bearer token.

Public password-reset requests return the same accepted result for known,
unknown, inactive, and rate-limited accounts. A new request revokes older live
reset tokens. Reset links expire after 30 minutes and successful completion
updates both credential stores, increments the user's authentication version,
and revokes every normalized user session. Verification links expire after 24
hours, work once, and are bound to the account's current email address.

Website contact persistence accepts only a result already verified server-side
through Turnstile Siteverify. The response token is never stored. Axora records
the verified action, hostname, challenge time, verification time, and privacy
acceptance alongside the enquiry. Rate limiting stores only keyed HMAC
fingerprints of network and identifier inputs, never raw network addresses in
the rate tables or audit log.

The two account-setup PNGs are optimized, local Content-ID (`cid:`)
attachments. They are right-sized at twice their rendered dimensions for sharp
high-density displays;
the HTML template and both images total less than 32 KiB before transport
encoding. No recipient opens a third-party image URL.

Setup, reset, and verification URLs use `#token=...`, not a query parameter.
Browsers do not include a URL fragment in the HTTP request target, referrer, or
normal access log. Each page removes the complete fragment before its first
network action, then sends the token in a server-action request body. Never
enable request-body logging: the token still is a bearer credential while that
request is processed.

Signed-in users manage these controls at `/account`. A password change requires
the current password, rejects reuse, stores Argon2id output, increments
`auth_version`, ends all prior durable sessions, and creates one fresh session
for the current browser. The same page can revoke one other session or all
other sessions without selecting or displaying token hashes or network
fingerprints. Email verification can be resent only for the signed-in account
address.

## One-time production configuration

Cloudflare onboarding is deliberately manual; the Axora installer never creates
a sending domain or credential. In the Cloudflare dashboard:

1. Go to **Compute > Email Service > Email Sending**, choose **Onboard Domain**,
   and select `axora.management`.
2. Review and install the Cloudflare bounce MX, SPF and DKIM records, retain the
   approved DMARC policy, and wait until the sending domain is enabled.
3. In the sending-domain settings, explicitly turn **Email preview off**.
   Cloudflare enables message-body preview automatically for some newly
   onboarded domains and retains previews for about seven days. Axora security
   messages contain live one-time bearer links, so body preview is not an
   acceptable production setting.
4. Copy the 32-character **Account ID** and the 32-character
   `axora.management` **Zone ID**. These identifiers are not secrets, but both
   must refer to this deployment's Cloudflare account and zone.
5. Under **Manage Account > Account API Tokens**, manually create a dedicated
   account-owned token restricted to that account with only **Email Sending:
   Edit**. Do not reuse a user token, Global API Key, Tunnel token, or another
   application's credential.

Store the token as:

```text
/etc/axora-production/secrets/cloudflare_email_api_token
```

Required ownership and permissions are `root:GID 1000` and `0640`. Never put
the token in Git, a tracked environment file, terminal output, screenshots, or
documentation.

Set these non-secret values in `/etc/axora-production/runtime.env` only after
the sending domain and support mailbox are verified:

```dotenv
AXORA_EMAIL_DELIVERY_ENABLED=true
AXORA_EMAIL_EVENTS_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=<Cloudflare account ID>
CLOUDFLARE_ZONE_ID=<axora.management zone ID>
AXORA_EMAIL_FROM_ADDRESS=noreply@axora.management
AXORA_EMAIL_FROM_NAME=Axora
AXORA_EMAIL_REPLY_TO=support@axora.management
AXORA_CONTACT_NOTIFICATION_TO=<private monitored support inbox>
ACCOUNT_SETUP_TTL_HOURS=24
```

Email delivery may not be enabled until the dedicated event Queue, subscription,
consumer Worker, DLQ and app-side webhook secret are configured. Follow
[`docs/refactor/EMAIL_PROVIDER_EVENTS.md`](refactor/EMAIL_PROVIDER_EVENTS.md).
The provider event pipeline stores only a normalized recipient SHA-256
fingerprint, provider-message SHA-256 fingerprint, event ID/type/time, terminal
flag, schema version and hard/soft classification. It never stores the event's
plaintext recipient, raw provider message ID, subject or SMTP response.

`AXORA_CONTACT_NOTIFICATION_TO` is server-only operational configuration. Do
not prefix it with `NEXT_PUBLIC_`, expose it through a client bundle, hard-code
it into a public page, or persist it in a contact submission. If it is empty,
validated contact enquiries remain durable with status `RECEIVED` and are not
claimed until a monitored inbox is configured. This prevents accidental mail
delivery to an invented or unmonitored address.

There is no optional production profile for `email-sender`: it is part of the
normal application topology and always runs on its isolated networks.
`AXORA_EMAIL_DELIVERY_ENABLED=false` is the installed default, and sender
readiness reports `disabled` successfully without reading or using the empty
token placeholder. The separate `email-preview` profile starts only the
developer Mailpit catcher and must never be included in a production Compose
invocation. Until all provider values and secrets are installed, keep delivery
disabled. An ordinary authorized user-creation action can still create the
pending account and records its one attempted invitation as `DISABLED`
(distinct from a provider `FAILED` result); after configuration, an authorized
administrator must explicitly resend so the old invitation is revoked and a
fresh token is issued. The first-platform-owner bootstrap is stricter: it
checks that delivery is enabled and `/health/ready` reports `ready` before
changing the database, and otherwise refuses to create or replace the owner
invitation.

## Local template capture

The Mailpit profile is an isolated rendering aid, not a provider emulator or a
deliverability test. It accepts only the repository preview utility's fixed
`.test` identities over its loopback HTTP API, keeps messages in ephemeral
storage, publishes no SMTP port, and exposes its UI only at
`http://127.0.0.1:8025`. Follow
[`email-templates/README.md`](../email-templates/README.md) for the exact
commands. A successful Mailpit capture proves reviewed HTML/plain-text output
can be inspected locally; it does not prove Cloudflare authentication, DNS,
Queue delivery, inbox placement, Reply-To monitoring, or production email.

## Health and provider preflight

- Application `/api/health/live` proves that the web process responds;
  `/api/health/ready` additionally proves PostgreSQL readiness. Deployment and
  external traffic gates use readiness.
- Private `email-sender` `/health/live` proves that its process responds.
  `/health/ready` returns HTTP 200 with `ready` when enabled and locally
  configured, HTTP 200 with `disabled` when delivery is intentionally off, and
  HTTP 503 with `not_ready` for an invalid enabled configuration. These health
  checks do not send email or call Cloudflare.

After installing the token and values, run:

```bash
sudo /usr/local/libexec/axora-production/preflight.sh
```

When delivery is enabled, full and automation preflight use the installed
`check-email-service.mjs` to verify that the account-owned token is active for
`CLOUDFLARE_ACCOUNT_ID`, and that `CLOUDFLARE_ZONE_ID` reports the exact sender
domain as enabled with provider-side Email preview explicitly disabled. The
check is read-only and sends no message. `--local-only`
intentionally skips this network provider check; it is not sufficient approval
for enabling production delivery.

## Verification

Before enabling real delivery:

1. Verify Cloudflare's domain onboarding, SPF, DKIM and DMARC results, and
   confirm Email preview is off for the exact sending domain.
2. Pass the provider preflight above.
3. Run `npm run verify` and `bash scripts/production/validate-assets.sh`.
4. Validate the Queue consumer locally using the commands in
   [`EMAIL_PROVIDER_EVENTS.md`](refactor/EMAIL_PROVIDER_EVENTS.md), then obtain
   explicit approval for its external deployment and event subscription.
5. Deploy the application through the normal protected-main controller.
6. Create a test account at an address controlled by Axora.
7. Confirm the email has HTML and plain-text alternatives, no remote assets,
   and a single-use link that expires after the configured period.
8. Confirm reuse, expiry and replaced invitations are rejected.
9. Request a password reset for both a known and unknown address and confirm the
   public response is indistinguishable. Use the known account's link once,
   then confirm reuse fails and all older sessions require a new login.
10. Submit a validated contact enquiry and confirm it reaches only the private
   monitored inbox with HTML and plain-text alternatives and a safe reply-to.
11. Trigger a workflow event for a controlled verified account. Confirm its
    in-app and email controls work independently, the subject remains generic,
    the action stays on `https://axora.management`, and delayed options create
    separate messages rather than claiming to be summaries.
12. Complete the delivered, deferred, hard/soft-bounce, failed, rejected,
    complaint, correlation, idempotency, retry, and DLQ checks in the
    provider-event runbook.
13. Confirm no token, message body, password, recipient address, or API
    credential appears in Axora, Docker or systemd logs. Confirm Cloudflare
    Email preview remains off and provider logs contain no bearer link.

Until every external step above has evidence, the honest status is
**implemented and locally testable, not production email verified**.

Cloudflare Email Sending event subscriptions provide the reviewed six-event
provider schema. Delivered, deferred, bounced, failed, rejected, and complained
states are retained as privacy-minimized evidence and correlated to immutable
send outcomes when the provider message identifier matches. Complaints and
hard bounces suppress future account, security and workflow email to that
normalized address; all other lifecycle states, including soft bounces, do not
suppress. In-app notifications remain independent. A
provider timeout after request transmission is still recorded as `UNCERTAIN`
and is not automatically replayed, avoiding duplicate security mail. Reconcile
that outcome in the Cloudflare dashboard before a user explicitly requests
another message.

The REST adapter sends one recipient per provider request and accepts a success
response only when that exact normalized address appears in exactly one of
Cloudflare's `delivered`, `queued`, or `permanent_bounces` groups. A permanent
bounce is a definite failure. A malformed, contradictory, wrong-recipient, or
unparseable HTTP 2xx result is `UNCERTAIN`, because the provider may already
have accepted the message and an automatic replay could duplicate a security
link.

Cloudflare's current REST guide example shows the three recipient groups but
omits `message_id`; the current Email Sending OpenAPI response model includes
`message_id`. Axora therefore treats provider-message correlation as a manual
pilot gate, not an assumption. When a bounded message ID is returned, Axora
stores it only in the private send row and migration `030` hashes it for
correlation with event `payload.messageId`. If no ID is returned, the private
view reports `NO_PROVIDER_MESSAGE_ID`. Do not claim end-to-end `MATCHED`
correlation until a controlled real send proves that the REST response ID and
event-subscription ID are identical for this production account.

## Rollback safety

App-only rollback never reverses database migrations. While a target release
that predates `email-sender` is being gated, the existing sender remains in
place so a failed target can restore the complete previously working topology.
Only after the legacy target passes its local and required external gates does
the controller remove the Compose container labelled for that ephemeral
service, without `-v`; databases, named volumes, secrets and uploads are
untouched. A failed target restores the current release first. Automatic
post-swap revert follows the same compose-then-health-then-cleanup order, so a
successful legacy rollback cannot leave the sender running.

## Failure handling

- `DISABLED`: finish the one-time configuration, set delivery to `true`, pass
  provider preflight, deploy, and use **Resend invitation**. This revokes the
  disabled invitation and issues a new token; no old token is queued.
- `FAILED`: check only the `email-sender` failure category and Cloudflare
  dashboard; never enable request-body logging. Explicit resend revokes the
  failed invitation and issues a new token.
- `Expired`: resend creates a fresh token and atomically revokes the old link.
- `Wrong recipient`: deactivate/delete the pending account and create it again
  with the correct address.
- `Contact remains RECEIVED`: configure the private monitored inbox and confirm
  the sender is enabled; the durable row will then be eligible for claiming.
- `UNCERTAIN`: inspect the provider dashboard before explicitly resending. Do
  not replay the ambiguous token; resend always revokes it and issues a new
  one.
- Provider-event endpoint returns `401`: verify host time and that the Worker
  and root-owned application secret contain the same value; never print either
  value. The signature is valid for 90 seconds and is bound to method, exact
  route, timestamp, and body.
- Queue retries or DLQ grows: keep outbound delivery disabled if lifecycle
  events cannot be processed, inspect bounded Worker outcome logs, repair the
  endpoint or configuration, and redrive only after the cause is understood.
- `recipient_suppressed`: do not bypass the Axora or provider suppression list.
  Confirm whether a hard bounce or complaint occurred and use a separately
  reviewed address-correction process; never disclose another recipient's
  suppression state.
- Provider preflight reports that Email preview is enabled or unknown: keep
  delivery disabled, turn preview off for the exact sending domain in
  Cloudflare, and rerun the full read-only preflight. Do not send a security
  link merely to test this setting.
