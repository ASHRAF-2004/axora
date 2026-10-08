# Integration inventory and private Slack setup

Observed 2026-10-07 21:31 UTC (2026-10-08 Asia/Kuala_Lumpur). Production
`a40a70bef3104d7e08959dfdc6e55a36ba6beb31`, image
`sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`.
This is a read-only inventory, not provider activation or message-delivery proof.

## What works today

| Capability | Actual production evidence | Acceptance boundary |
| --- | --- | --- |
| External API | Runtime flag true; actual Owner `/integrations` renders External API active, zero active grants/access tokens and zero API requests in 24h | Implemented/enabled, not a connected external client or live API-use proof |
| Generic webhooks | Runtime flag true; workspace renders Webhooks active, zero subscriptions/deliveries | Implemented/enabled, no receiver connected and no live delivery claimed |
| Zapier | Runtime flag false; reviewed package exists; existing exact-main Nightly Zapier 19 tests passed | Disabled in production, not published/connected; no flag or credential changed |
| Native Slack | Runtime flag false; application/client IDs unconfigured; actual workspace renders Slack disabled and zero installations/channels/deliveries | Built adapter available, independently disabled; no workspace connected |
| Company connections | Read-only aggregate zero connections; Owner workspace shows no apps connected | No company OAuth connection exists; adapter registration is not connection |

Production registry currently contains the built-in Slack provider record. Its
internal `PUBLIC`/`none` registry fields do **not** make it an Axora OAuth API
client: migration132 fixes `authorization_mode=PROVIDER_OAUTH` and excludes it
from Axora token issuance. The recovery UI labels it Provider-managed OAuth /
Adapter available, hides generic client controls and internal scope metadata,
and adds truthful Zapier disabled/available/requires-setup status. Existing
server-side provider/client boundaries remain unchanged. EN/AR/MS render tests
and current feature-gate/provider/management tests:37 passed. Final candidate
and rendered production verification remain pending.

## Exact missing input for Slack activation

An authorized Slack developer application and controlled workspace with one
explicitly designated, non-sensitive public test channel are not supplied.
Dedicated client/signing secret files and non-secret app/client IDs must be
installed through the normal protected secret-file workflow. Do not paste
secrets in chat, a command argument, Git, screenshots, logs, or this report.
This blocks Slack activation only, not Contact, registration, product deletion,
runtime recovery, UI changes, or the deployment of independent repairs.

## Private setup checklist (not executed)

1. Confirm the workspace owner authorizes the application and identifies one
   disposable public test channel; decide its exact company context in Axora.
   Use the reviewed `integrations/slack/manifest.yaml`, not a new marketplace.
2. Configure exactly the existing bot scopes `chat:write` and `channels:read`,
   token rotation, and these canonical HTTPS callbacks:
   `https://axora.management/api/integrations/slack/oauth/callback` and
   `https://axora.management/api/integrations/slack/events`.
   No private-channel/history/admin/payment/approval scope or DNS addition.
3. Privately mount `AXORA_SLACK_CLIENT_SECRET_FILE` and
   `AXORA_SLACK_SIGNING_SECRET_FILE`; configure `AXORA_SLACK_APP_ID` and
   `AXORA_SLACK_CLIENT_ID`. Preserve the existing integration encryption root
   key and Resend transport; Slack does not use transactional email queues.
4. Use the normal protected runtime configuration and immutable deployment to
   enable only `AXORA_SLACK_ENABLED`. Verify the generic API/webhook flags,
   core health, and worker queues are unchanged. Abort if secrets appear in
   rendered markup or provider OAuth becomes an Axora grant.
5. Sign in normally as the actual Company Administrator for the chosen
   company (or Owner using the supported company workspace). Use Connect Slack
   and approve only the reviewed scopes. The callback must use the same live
   session and single-use expiring state; never manufacture a session/token.
6. Invite the bot into the designated public channel, refresh channels in
   Axora, select that channel and the minimum test event. Private/shared/
   archived/non-member channels must remain unavailable.
7. Send exactly one synthetic non-sensitive notification through the supported
   isolated acceptance path, not a payment, invoice or delivery mutation.
   Verify a Slack-specific outbox/attempt/provider result and actual channel
   receipt separately. Check the Axora deep link requires current authentication
   and company/branch authorization, including a different-company refusal.
8. Disconnect and confirm local access and queued claims stop immediately;
   verify provider revocation separately. Reconnect through ordinary OAuth,
   then exercise the existing signed uninstall/token-revocation fail-closed
   path. Do not replay unrelated historical delivery rows.
9. Leave the workspace disconnected/feature disabled after the smoke unless
   the owner explicitly designates ongoing use. If any core regression occurs,
   disable the independent Slack flag and deploy the compatible immutable
   image; do not down-migrate or weaken authorization.

Detailed implementation, privacy and rollback policy:
[SLACK.md](../../integrations/SLACK.md),
[integration architecture](../../integrations/ARCHITECTURE.md).

Sources checked 2026-10-08:
[Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/),
[signed requests](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[provider revocation](https://docs.slack.dev/reference/methods/auth.revoke/).
These support the provider workflow, not a claim that this deployment has
completed it.
