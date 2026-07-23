# Axora operations

Axora is a free, self-hosted internal procurement and operations pilot. It
replaces fragile workbook calculations with quantity-correct requests,
quotations, approvals, deliveries, invoices, payments, documents, audit
history, and role-based access.

![Axora operations logo](public/brand/axora-logo.svg)

## What is ready now

- Next.js application with 22 routes and responsive pages.
- Sanitized local demonstration mode with 15 order scenarios.
- PostgreSQL 18 schema, guarded workflow transitions, financial views, audit
  triggers, relationship constraints, and optional demonstration seed.
- Docker Compose package with private application/database networks and Caddy
  local HTTPS on the approved office LAN.
- Secret generation, migration, health, backup, verification, restore-test,
  guarded production restore, certificate export, firewall, and daily backup
  scripts.
- Automated lint, TypeScript, database, seed, formula, and workflow checks.

## Try it on this Windows PC

Open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-demo.ps1
```

Then open <http://localhost:3000>. The local sign-in values are stored only in
`.env.local`. Stopping the development server resets demonstration changes.

## Later on the approved Ubuntu server

Do not perform these steps until the SSD, fixed office LAN address, and
supervisor-approved server location are ready.

```bash
cd /srv/axora
bash scripts/server/preflight.sh
bash scripts/server/install-docker-ubuntu.sh
# sign out and in once
cp .env.server.example .env
nano .env
bash scripts/server/prepare-secrets.sh
bash scripts/server/deploy.sh
bash scripts/server/create-admin.sh admin@company.com "Administrator name"
bash scripts/server/export-caddy-root.sh
bash scripts/server/status.sh
```

The illustrated PDF beside this package explains each command, client DNS and
certificate setup, backups, recovery, and the manual checks that cannot be done
on this Windows PC.

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
```

Docker/Caddy runtime verification must be completed on the Ubuntu server because
Docker is not installed on this preparation PC.

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
- The open-source Lucide-based mark is suitable for this internal pilot but is
  not an exclusive registered trademark. See `THIRD_PARTY_NOTICES.md`.
