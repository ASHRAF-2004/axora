# Axora for Zapier — private beta

This isolated Zapier CLI package uses Axora's OAuth Authorization Code flow
with mandatory PKCE S256, current-scope external API, and REST-hook webhook
subscriptions. It never accepts an Axora password.

The package is deliberately private and contains no application credentials.
Deployment requires an Owner-registered confidential Axora OAuth application
and a privately authorized Zapier developer account. See
`docs/integrations/ZAPIER.md` in the Axora repository for the controlled
registration, validation, rollout, and revocation procedure.

Local validation:

```bash
npm ci
npm test
npm run validate
```

The committed dependency graph excludes the provider-management CLI. The
schema check uses the exact `zapier-platform-schema` bundled by the pinned core
runtime. Registration and push commands are run only in a disposable,
credentialed release environment after an audit review.

Zapier runs integrations on Node.js 22. The package also remains buildable on
Axora's Node.js 24 engineering host; release validation runs it under Node 22.
