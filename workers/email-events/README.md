# Axora Email Sending event consumer

This queue-only Worker consumes all six Cloudflare Email Sending lifecycle
events: `message.delivered`, `message.deferred`, `message.bounced`,
`message.failed`, `message.rejected`, and `message.complained`. It validates the
sending domain, sender domain, schema version, event-specific terminal/status
shape and required nested detail; removes recipient, subject, provider-account,
reason and SMTP details; hashes the normalized recipient and opaque provider
message ID; and posts the minimized record to Axora over a timestamp/body-bound
HMAC. Only hard bounces and complaints create recipient suppression.

The repository contains no Cloudflare account ID, queue ID, API token, or
webhook secret. Follow `docs/refactor/EMAIL_PROVIDER_EVENTS.md` for the manual
resource and secret setup. Do not add a public `fetch` handler to this Worker.

Local verification does not require Cloudflare login:

```bash
npm ci
npm run types:check
npm run typecheck
npm test
npm run deploy:dry-run
```

Deployment is a separate, explicit infrastructure action and is not performed
by the Axora application deployment controller.
