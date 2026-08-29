# Axora for Slack

Status: native integration implementation ready for private acceptance. The
Slack capability is independently dark-launched with
`AXORA_SLACK_ENABLED=false` until an authorized Slack application and
controlled workspace are configured. Public marketplace distribution is out
of scope.

## Purpose and limits

Axora for Slack sends a conservative set of procurement notifications with an
authorization-preserving deep link back to Axora:

- Request submitted
- Request approved
- Customer invoice finalized
- Delivery out for delivery
- Delivery completed

Slack cannot approve or reject a Request, top up or debit a Wallet, record a
payment, finalize an invoice, claim or complete a delivery, change a CAM, or
change a user or permission. The recipient must open Axora, authenticate, and
pass Axora's current tenant, branch, role, assignment, resource, and explicit
DENY policy.

## Provider application

The reviewed manifest is `integrations/slack/manifest.yaml`. It uses Slack
OAuth v2 with rotating bot tokens and exactly these bot scopes:

- `chat:write`
- `channels:read`

It intentionally omits `chat:write.public`; the bot can notify only a public
channel to which it has been invited. It also omits private-channel, admin,
user-write, file-write, slash-command, and interactive-message capabilities.

Callbacks use the existing production origin:

- `https://axora.management/api/integrations/slack/oauth/callback`
- `https://axora.management/api/integrations/slack/events`

No Slack DNS record or subdomain is required.

## Installation and authorization

The `axora-slack` integration application is marked `PROVIDER_OAUTH`. Database
constraints prevent it from entering Axora's public OAuth grant, code, access
token, or refresh-token model. The company connection and Slack installation
remain separate records.

Only the Platform Owner or a Company Administrator for the connected company
can inspect or manage an installation. A Company Administrator starts OAuth
for their own company. A hashed, single-use, ten-minute state is bound to the
current user, company, role assignment, and `auth_version`. The callback
requires the same live Axora session and permission and accepts only one exact
state and code. CAM portfolio assignment alone, other company roles, and
Delivery Agents have no installation authority.

After authorization, the administrator synchronizes public channels. Axora
excludes private, shared, externally shared, and organization-shared channels,
and will save a channel only when it was synced in the last 24 hours, remains
public and unarchived, and the bot is a member. The administrator selects the
enabled event types in the Integrations workspace. No credential appears in
the browser.

## Credential lifecycle

Production uses dedicated files:

- `AXORA_SLACK_CLIENT_SECRET_FILE`
- `AXORA_SLACK_SIGNING_SECRET_FILE`

Non-secret application and client IDs stay in runtime configuration. Slack
access and refresh tokens are encrypted with AES-256-GCM under
installation- and token-version-specific keys derived from Axora's dedicated
integration root key. Token plaintext is transient and is never stored in Git,
the database, logs, metrics, screenshots, artifacts, or HTML.

The application performs the initial OAuth exchange and management-time public
channel refresh. The isolated integration worker rotates expiring credentials
before delivery. Both paths require the exact reviewed scopes after rotation;
a revoked token or missing scope revokes the local connection and stops future
work.

Disconnect is local-first: Axora immediately revokes the company connection,
clears the selected channel, terminalizes queued deliveries, and prevents new
claims. The worker then attempts bounded asynchronous revocation of both
provider credentials. Signed `app_uninstalled` and `tokens_revoked` events
produce the same fail-closed local result without deleting Axora business
history.

## Message privacy

The worker builds messages from an explicit allowlist only:

- notification title
- customer-facing order, invoice, or delivery code when present
- branch name when present
- customer-facing currency and total when present
- canonical Axora HTTPS deep link

Supplier acquisition cost, buying cost, margin, coordinates, proof paths or
images, OTPs, receiver details, email, phone, audit data, and credentials are
excluded. Message text disables Markdown and link/media unfurling. Block fields
use Slack `plain_text`. The stable integration `event_id` is also the Slack
`client_msg_id`, so a worker retry reuses the same logical identity.

## Delivery and failure isolation

Slack never runs in an Axora business transaction. The sequence is:

```text
committed Axora state
  -> canonical integration event
  -> Slack-specific delivery row
  -> isolated integration worker
  -> Slack Web API
```

Only selected events create delivery rows, with one row per event and
installation. Claims use leases and `SKIP LOCKED`; a single installation sends
in order. Provider 429 responses honor bounded `Retry-After`; timeouts, network
errors, and 5xx responses use bounded exponential retry. Eight attempts end in
`DEAD`, where an authorized manager can start a bounded manual retry cycle
using the same event ID. Response bodies and message bodies are not persisted
in attempt history.

A Slack timeout, outage, revoked workspace, corrupt provider response, stopped
integration worker, or stuck Slack row cannot roll back or block login,
Requests, approvals, Wallets, budgets, payments, invoices, deliveries, Proof of
Delivery, Contact, or transactional email. Generic webhooks and Zapier have
separate feature checks and delivery records.

## Signed inbound events

Axora verifies `X-Slack-Request-Timestamp` and `X-Slack-Signature` against the
exact raw request body using Slack's `v0` HMAC-SHA256 scheme. Requests outside
a five-minute window, oversized bodies, bad signatures, wrong app IDs, unknown
schemas, and duplicate parameters fail closed. Event IDs are retained for 90
days to deduplicate uninstall and token-revocation callbacks. Raw callback
bodies are not stored.

## Retention and rollback

Expired OAuth state is removed after one day. Terminal delivery and attempt
metadata and inbound event IDs are removed after 90 days; revoked installations
are removed after 180 days. Durable Axora audit and procurement records are not
part of Slack cleanup.

Rollback requires no down-migration:

1. Set `AXORA_SLACK_ENABLED=false` through the normal production configuration.
2. Recreate the application and integration worker with the immutable image.
3. Verify Slack routes return disabled behavior and Slack claims stop.
4. Verify core Axora and the generic webhook worker remain healthy.
5. If required, restore the previous immutable Axora image and leave migration
   132 dormant for a forward fix.

Private acceptance requires authorized Slack developer and controlled workspace
credentials supplied through the production secret-file workflow, never chat.
Test one synthetic non-sensitive message, its deep-link authorization, channel
selection, disconnect/reconnect, and revoke. Do not publish the app or send a
production business event during acceptance.

Official references: [OAuth v2](https://docs.slack.dev/authentication/installing-with-oauth/),
[request signing](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[token rotation](https://docs.slack.dev/authentication/using-token-rotation),
[`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/),
and [Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).
