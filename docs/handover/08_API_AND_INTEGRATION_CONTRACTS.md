# API and Integration Contracts

## Application boundary

Axora uses Next.js server pages, server actions and route handlers. Dynamic record IDs never grant authority by themselves; every read/write must resolve the authenticated actor and current scope.

## Core internal contracts

- Health endpoints separate process liveness from database-backed readiness.
- Catalogue reads return customer-safe data for authorized users.
- Attachments and product images are streamed only after server-side authorization.
- Request, approval, budget, finance, delivery and user mutations are server-side actions/services backed by database transactions/capabilities.
- Generated documents are versioned business evidence rather than ad hoc browser-only output.

## External integrations in the repository

Current repository evidence includes:

- Cloudflare edge/Tunnel integration for the prepared public route.
- Tailscale for private deployment/administrative reachability.
- GHCR for immutable production images.
- Resend-based transactional email infrastructure.
- External integration/webhook foundation.
- Slack native integration.
- Zapier integration package and CI validation.

## Integration rules

- Keep provider credentials outside Git and outside browser-exposed configuration.
- Verify inbound webhook signatures/replay behavior where applicable.
- Use idempotency keys/command IDs for retryable writes.
- Do not let an integration bypass role/scope/business rules.
- Do not let a transient provider failure rewrite core business truth such as payment, invoice or receipt state.
- Document environment-specific setup, required permissions, secrets, rate limits and failure modes.
- Treat provider enablement as a separate operational gate; code presence is not proof that production integration is active.

## Compatibility and change management

When an API or webhook contract changes, keep old consumers in mind. Prefer additive/versioned change, migration windows and explicit deprecation over silent breaking changes.
