# Resend transactional email

Axora sends all current transactional email through the existing private email
sender and provider-neutral durable outboxes. The six `axora-*` delivery-stream
names are internal Axora queue partitions; they all use the same protected
Resend provider implementation.

## Protected files

- `/etc/axora-production/secrets/resend_api_key` is mounted only into
  `email-sender` as `/run/secrets/resend_api_key`.
- `/etc/axora-production/secrets/resend_webhook_secret` is mounted only into the
  application as `/run/secrets/resend_webhook_secret`.
- Both files must be regular, non-symlink files owned by `root:GID-1000` with
  mode `0640` or stricter. Neither value belongs in `runtime.env`.
- The installer preserves existing regular files byte-for-byte and creates only
  hardened empty placeholders when provider secrets are absent.

## Safe disabled state

```text
AXORA_EMAIL_PROVIDER=resend
AXORA_EMAIL_DELIVERY_ENABLED=false
AXORA_EMAIL_EVENTS_ENABLED=false
RESEND_DOMAIN_VERIFIED=true
RESEND_WEBHOOK_VERIFIED=false
```

`RESEND_DOMAIN_VERIFIED=true` requires current provider evidence for
`axora.management`. `RESEND_WEBHOOK_VERIFIED=true` requires a real signed
production callback accepted by Axora. Delivery cannot be enabled unless both
gates and signed provider events are enabled.

## Webhook registration

After the fail-closed production endpoint is deployed:

1. In Resend, open **Webhooks** and choose **Add Endpoint**.
2. Use `https://axora.management/api/email/provider-events/resend`.
3. Select only event types supported by the current Axora Resend adapter:
   `email.sent`, `email.delivered`, `email.bounced`, `email.complained`,
   `email.delivery_delayed`, `email.failed`, and `email.suppressed`.
4. Create the endpoint, reveal its signing secret once, and install it through a
   protected root terminal into `resend_webhook_secret`; never put it in shell
   arguments, output, Git, or `runtime.env`.
5. Keep delivery disabled. Enable provider events only, deploy through the
   guarded workflow, and use Resend's signed webhook test facility.
6. Confirm the signed event is accepted, duplicate delivery is idempotent, and
   no unexpected suppression occurs. Only then record
   `RESEND_WEBHOOK_VERIFIED=true` through a separate guarded change.

The callback verifies `svix-id`, `svix-timestamp`, and `svix-signature` against
the exact raw body before parsing. Disabled events, missing secrets, missing or
invalid signatures, stale signatures, and oversized requests fail closed.

## Central sending path

Current business code does not call the Resend API directly:

```text
business workflow
  -> transactional/workflow outbox (or private account-setup sender request)
  -> server-tools/email-sender.mjs
  -> Resend adapter
  -> Resend API
```

Password reset, email verification, password-change security notices, contact
mail, invoice/document mail, procurement/budget/delivery workflow mail and
account invitations therefore share one provider boundary. Durable outboxes own
retry scheduling and keep provider failure separate from completed business
transactions.

## Operations and rollback

Axora records submitted, delivered, delayed, failed, bounced, complained, and
provider-suppressed lifecycle evidence without retaining recipient plaintext,
subjects, or message bodies in provider-event logs. Hard bounces, complaints,
and provider suppression derive the existing recipient deny-list atomically.
Axora's own daily/monthly recipient-unit metrics and any configured internal
operating limit are not presented as a Resend credit balance.

Rollback means disabling delivery/events and redeploying a known-good Resend
release. Provider secrets remain protected server files and are never copied
into Git or browser-visible configuration.
