# Axora for Zapier private beta

Status: implementation-ready private beta. The adapter is isolated in
`integrations/zapier`, contains no credentials, and is not approved for public
Zapier marketplace publication.

## Security model

Zapier delegates to an existing Company Administrator through Axora's OAuth
Authorization Code flow with PKCE S256. It never accepts an Axora password.
Every API call re-evaluates the live Axora user, role assignment, explicit
DENY, company connection, OAuth grant, and operation scope. Revoking any part
of that intersection stops future access even if Zapier still holds a nominally
unexpired token.

Zapier Platform schema 19.1 does not expose an OAuth disconnect callback to an
integration. Removing a Zapier connection discards its provider-held
credentials, while immediate server-side revocation is Axora's Disconnect
control. The private-beta uninstall procedure therefore disables the Zaps and
disconnects the company connection in Axora; access then fails on the next
request and each REST-hook subscription is revoked independently when its Zap
is disabled.

The reserved application slug is `axora-zapier`. Axora applies
`AXORA_ZAPIER_ENABLED` to that slug during consent, code exchange, refresh,
and every bearer-token request. The revocation endpoint intentionally remains
available while the provider is disabled. The integration worker also blocks
deliveries to `hooks.zapier.com` while the flag is false without stopping
ordinary customer webhooks.

The adapter sends bearer tokens only to the exact
`https://axora.management/api/v1/` origin and path prefix. OAuth client
credentials are used only as HTTP Basic authentication at the exact Axora
token endpoint. No token or credential belongs in Git, Zapier sample data,
Axora logs, command output, screenshots, or chat.

## Private-beta surface

REST-hook triggers:

- New Request (`request.created`)
- Request Submitted (`request.submitted`)
- Request Approved (`request.approved`)
- Invoice Finalized (`invoice.finalized`)
- Delivery Out for Delivery (`delivery.out_for_delivery`)
- Delivery Completed (`delivery.completed`)

Searches:

- Find Company
- Find Request
- Find Delivery
- Find Invoice

The searches accept an Axora UUID and deliberately map both an inaccessible
record and a nonexistent record to no result. Current OAuth and Axora resource
authorization still apply.

The only action is Create Request Draft. Its required Unique Request Key is
hashed into Axora's idempotency key. The result remains `pending_review` in the
isolated integration-draft model. It cannot submit or approve a Request, spend
a budget, debit or top up a Wallet, record a payment, finalize an invoice, or
create or complete a delivery.

Webhook subscriptions accept only a Zapier-issued HTTPS target at the exact
`hooks.zapier.com` hostname. The adapter requests
`credential_delivery: "none"`, so the subscription's Axora HMAC credential is
never returned through provider-visible HTTP logs or stored in Zapier bundle
data, including after rotation or idempotent replay. Axora still generates and
encrypts an isolated credential and signs each delivery. Trigger input is
reduced to the documented event envelope and a
small allowlist; supplier cost, margin, email, tokens, and arbitrary fields are
dropped.

All samples use fictional UUIDs, names, codes, and values.

## Owner registration

Registration is controlled by the Platform Owner in Axora's Integrations
workspace:

- Name: `Axora for Zapier`
- Slug: `axora-zapier` (exact; this binds the independent kill switch)
- Client type: confidential
- Token authentication: `client_secret_basic`
- Redirect URI: the exact HTTPS OAuth callback issued for the private Zapier
  integration version
- Scopes: `companies:read`, `requests:read`, `requests:draft`,
  `deliveries:read`, `invoices:read`, and `webhooks:manage`

Capture the one-time client ID and client secret directly into the authorized
provider secret store. Do not persist them in a shell history, local env file,
artifact, ticket, documentation, or Axora repository. Rotate the Axora client
secret if that one-time handoff is interrupted or its confidentiality is in
doubt.

## Validation and controlled release

The package pins `zapier-platform-core` and runs under Zapier's Node.js 22
runtime. From `integrations/zapier`, the credential-free gate is:

```bash
npm ci
npm test
npm run validate
npm audit --audit-level=low
```

The repository intentionally does not commit the provider-management CLI or
its vulnerable transitive dependency graph. Registration and push commands
must run in a disposable, privately credentialed release environment after
auditing the exact CLI version. Follow Zapier's current private-integration
workflow and keep provider credentials out of command output.

Private acceptance requires an authorized Zapier developer account:

1. Register the exact callback and place the one-time Axora OAuth client
   credentials in Zapier's provider secret environment.
2. Push a private version; do not promote or publish it publicly.
3. Keep `AXORA_ZAPIER_ENABLED=false` until Axora API and webhook health are
   verified.
4. Enable the Zapier flag through the normal production configuration and
   immutable-image deployment path.
5. Connect one controlled company, then test one trigger, one search, and one
   review-required draft action without a production purchase or financial
   mutation.
6. Revoke the connection and confirm both API access and future delivery stop.

Official provider references: [CLI overview](https://docs.zapier.com/integrations/build-cli/overview),
[OAuth](https://docs.zapier.com/integrations/build/oauth), and
[REST hooks](https://docs.zapier.com/integrations/build/cli-hook-trigger).

## Failure isolation and rollback

Zapier is never on a procurement transaction path. Axora commits canonical
business state first; the integration projector and worker operate later from
isolated tables. Zapier downtime, a stale hook, token revocation, provider 429,
or provider timeout cannot roll back or block login, Requests, approvals,
Wallets, budgets, invoices, deliveries, Proof of Delivery, Contact, or
transactional email.

Rollback is to set `AXORA_ZAPIER_ENABLED=false` and restart through the normal
deployment controller. Existing Zapier OAuth access and refresh use then fail
closed, Zapier-bound deliveries make no network request, generic webhooks stay
available, and additive integration records remain dormant for diagnosis. If
needed, restore the previous immutable Axora OCI image; no database down
migration is required for this phase.
