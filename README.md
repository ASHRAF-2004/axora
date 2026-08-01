# Axora operations

Axora is a self-hosted, multi-company procurement and operations application. It
replaces fragile workbook calculations with quantity-correct requests,
quotations, approvals, deliveries, invoices, payments, documents, audit
history, and role-based access.

![Axora operations logo](public/brand/axora-logo.svg)

## Production migration

The controlled migration from Render to the local Ubuntu server is documented
here:

- [Production architecture](docs/PRODUCTION_ARCHITECTURE.md)
- [Migration plan, risks, and rollback](docs/MIGRATION_PLAN.md)
- [Production runbook](docs/PRODUCTION_RUNBOOK.md)
- [Disaster recovery](docs/DISASTER_RECOVERY.md)

These documents are preparation assets, not evidence of a completed cutover.
Render must remain available until the public domain, restart recovery,
automatic deployment, backups, and rollback have all been verified and Ashraf
explicitly approves decommissioning.

## What is ready now

- Next.js application with 22 routes and responsive pages.
- Optional sanitized demonstration data for isolated local development only.
- PostgreSQL 18 schema, guarded workflow transitions, financial views, audit
  triggers, relationship constraints, and optional demonstration seed.
- Docker Compose production override with private database/application/edge
  networks, loopback diagnostics, Caddy, and a dedicated Cloudflare Tunnel.
- Exact-commit deployment, migration locking, health, verified backup,
  rollback, and systemd scheduling assets for the Ubuntu server.
- Automated lint, TypeScript, database, seed, formula, and workflow checks.
- A trusted interactive-experience foundation with validated AI
  recommendations, owner preview/override controls, an accessible mascot
  runtime, publication revisions, and browser-level safety checks. See
  [Trusted interactive experiences](docs/TRUSTED_INTERACTIONS.md).

## Try it on this Windows PC

This section is for an isolated development environment. Production always
runs with `DEMO_MODE=false` and the PostgreSQL production data.

Open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-demo.ps1
```

Then open <http://localhost:3000>. The local sign-in values are stored only in
`.env.local`. Stopping the development server resets demonstration changes.

## Ubuntu production server

The Ubuntu server, Docker services, PostgreSQL volume, and hybrid data are
already present at `/srv/axora`. Do not use the older LAN-only setup commands
for the Render migration. Follow the staged
[production runbook](docs/PRODUCTION_RUNBOOK.md); it keeps Render available
until the local application, apex Tunnel, automatic deployment, backup,
restart, and rollback gates have been proved.

## Automatic deployment flow

![Illustrated Axora automatic deployment flow](docs/assets/axora-automatic-deployment-flow-illustrated.gif)

Protected `main` changes pass GitHub verification before the Ubuntu deployment
manager backs up production, deploys the exact approved commit, runs migrations
and health checks, and keeps rollback available.

## MVP payment rule

The approved MVP has one payment method only: **cash on delivery (COD)**. This
applies to the three authorized pilot companies. Do not accept cards, FPX,
DuitNow, bank transfers, credit terms, buy-now-pay-later, or any other payment
method during the pilot. This is a safety boundary for the MVP, not Axora's
final product vision; any additional payment method must be evaluated later as
a separately approved security, compliance, and operations project.

The seller or its authorized delivery representative may collect cash only
after delivery and accepted quantity are confirmed, and must issue a numbered
receipt. Axora does not receive, hold, or settle the cash. An authorized Finance
user records the evidence using the fixed method name `Cash on delivery (COD)`.
The form, service layer, and database reject other methods, but a reviewer must
still check the delivery evidence, amount, and receipt. Follow
[MVP_COD_OPERATING_RULES.md](MVP_COD_OPERATING_RULES.md) before live use.

## Verification

```bash
npm ci
npm run verify
scripts/production/validate-assets.sh
```

Docker, Compose, Caddy, migration, and Tunnel validation is performed on the
Ubuntu server as described in the production runbook.

## Important safeguards

- Never publish PostgreSQL port `5432` or Next.js port `3000` to the LAN.
- Never configure router port forwarding for Axora.
- Never run `docker compose down -v` during normal operation; `-v` deletes data
  volumes.
- Keep delivery fees separate from sales and margin until Finance approves the
  accounting treatment.
- Use cash on delivery (COD) as the only MVP payment method. Retain the delivery
  evidence and numbered receipt for every payment, and reconcile them daily.
- A backup on the same SSD is not sufficient; copy verified backup folders to a
  separate USB drive or NAS.
- The open-source Lucide-based mark is not an exclusive registered trademark.
  See `THIRD_PARTY_NOTICES.md`.
