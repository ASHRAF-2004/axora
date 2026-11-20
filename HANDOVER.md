# Axora — Developer Handover and Deployment Guide

Prepared 20 November 2026 for the new owner of **Axora** and the domain
**axora.management**. This guide explains what you received, how to run it,
how to put it online, and what you must replace because it belonged to the
previous owner.

---

## 1. What you received

| Item | Description |
|---|---|
| Repository root | Complete source code of the live version (release `7ac61cb`, 14 Oct 2026) plus handover changes, on branch `handover-20261120`. |
| `database/handover/axora-initial.dump` | Clean PostgreSQL snapshot: all 142 migrations, **one Owner account** (`owner@axora.management`), **24 catalogue products with 75 images**. No previous users, companies, orders, emails or logs. |
| `handover/OWNER-ACCOUNT.txt` | The first Owner account. No password is stored anywhere in the repository: you set it yourself (section 4, step 5). |
| `handover/1-Developer-Guide.pdf` | This guide as PDF. |
| `docs/AI-ASSISTANT-PROMPT.md` | Ready prompt if you use an AI coding assistant. |
| `handover/3-Domain-Transfer-Requirements.pdf` | Information the domain buyer must provide (English and Arabic). |
| `handover/How-To-Extract-Axora-Handover.pdf` | How to open a `.7z` copy of this package on Windows/macOS. |

What was removed for privacy: the previous owner's phone number, name and
address on the Contact page, personal emails in the database, internal
evidence reports, AI-tool folders, server notes and screenshots. GitHub
account references were replaced with `your-github-user`.

What is **not** included (by design): passwords, API keys and tokens of the
previous owner (database passwords, Cloudflare, Resend, Turnstile, Slack,
Tailscale, GitHub). You create new ones (section 6).

## 2. Architecture in one minute

Axora is a multi-company procurement platform (English, Arabic, Malay).
Everything runs with **Docker Compose** on one Linux server:

| Service | Purpose |
|---|---|
| `db` | PostgreSQL 18.4 (data volume `axora_postgres_data`). |
| `migrate` | Runs once at every start: applies new files from `database/migrations/` and re-applies permission grants. |
| `app` | Next.js 16 / React 19 / Node 24 web application (port 3000, internal). |
| `email-sender` | Sends transactional email through Resend. |
| `budget-worker`, `document-worker`, `company-deletion-cleanup-worker`, `integration-worker` | Background jobs (budgets, invoice PDFs, deletions, webhooks). |
| `caddy` | Internal web server/proxy on `127.0.0.1:8080`. |
| `cloudflared` | Cloudflare Tunnel: publishes the site on `https://axora.management` without opening ports (profile `tunnel`). |

Compose files: `compose.yaml` (base) + `compose.hybrid.yaml` +
`compose.production.yaml` (the exact files production used) +
`compose.handover.yaml` (disables the old owner's Tailscale link, makes the
tunnel optional, fixes first-start health check). The line `COMPOSE_FILE=` in
`.env` selects all four, so plain `docker compose ...` works.

Secrets are separate files in `secrets/` (never in `.env`, never in Git).
Uploaded files are in `data/uploads/`. Product images are inside the database.

## 3. Server requirements

- Ubuntu Server 24.04 LTS (recommended) or any Linux with Docker. For a test
  you can also use Docker Desktop on Windows/macOS.
- Minimum 2 vCPU, 4 GB RAM, 40 GB SSD. Recommended 4 vCPU, 8 GB RAM.
- Docker Engine 28 or newer with the Compose plugin 2.36 or newer
  (production used Compose 2.40.3).
- No inbound ports are needed when you use Cloudflare Tunnel (only SSH for you).

Install Docker on Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and in again
docker compose version
```

## 4. Install (same steps for a test PC and for the server)

Clone the repository (branch `handover-20261120`) to the machine (for a
server, for example to `/srv/axora`) and run, inside that folder:

```bash
# 1. Settings
cp .env.handover.example .env
nano .env                 # AXORA_HOST=axora.management (use localhost for a local test)

# 2. New random passwords/keys for this installation (keep a backup!)
sudo bash scripts/handover/new-secrets.sh

# 3. Build the application image (5-15 minutes the first time)
docker compose build app

# 4. Create the database and load the handover snapshot, then start everything
bash scripts/handover/restore-initial-data.sh

# 5. Set the Owner password (asks twice, 15-128 characters)
bash scripts/handover/reset-owner-password.sh owner@axora.management
```

Step 4 prints `owner account: owner@axora.management` and `products: 24`.
Check that all services are healthy:

```bash
docker compose ps
curl -H "Host: axora.management" http://127.0.0.1:8080/api/health/ready   # {"status":"ready"...}
```

For a local test with `AXORA_HOST=localhost`, open <http://localhost:8080>.

> Windows test PC: install Docker Desktop and Git for Windows, then run the
> commands in **Git Bash**. Do not open/save the `.sh` files with Windows line
> endings (the project forces LF through `.gitattributes`).

`restore-initial-data.sh` refuses to run when the database already contains
users, so it can never overwrite real data by accident. Run it **once**, on the
first installation only.

## 5. First sign-in

1. Open the site and select **Login**.
2. Use `owner@axora.management` and the password you set in section 4, step 5.
3. Axora first asks the Owner to complete the profile (name, phone, team).
4. Later password changes: open `/account` (**Account security**).
5. The sign-in email `owner@axora.management` cannot be changed inside the
   app. After the domain is yours, create that address as a mailbox or forward
   it to your real inbox (Cloudflare dashboard, **Email**, **Email Routing**,
   free). Do the same for `support@axora.management` and
   `noreply@axora.management` replies.
6. Create the team: HR Management, Client Account Managers, Delivery Agents.
   Invitations are sent by email, so configure Resend first (section 6.2).

Lost Owner password and no email configured? Run the same command again:

```bash
bash scripts/handover/reset-owner-password.sh owner@axora.management
```

It asks for a new password (15-128 characters), stores it with the same
Argon2id hashing as the application and signs out all sessions of that owner.

## 6. Put it online and replace the previous owner's services

### 6.1 Domain and Cloudflare Tunnel (website address)

`axora.management` is registered at **Cloudflare Registrar** (expires
30 Jul 2027) and its DNS is at Cloudflare. After the domain is in your
Cloudflare account (see `3-Domain-Transfer-Requirements.pdf`):

1. Cloudflare dashboard, **Zero Trust**, **Networks**, **Tunnels**,
   **Create a tunnel**, type **Cloudflared**, name `axora`.
2. Choose **Docker** and copy only the token (the long text after `--token`).
3. Save it on the server: `printf '%s' 'PASTE_TOKEN' > secrets/cloudflare_tunnel_token`
4. In the tunnel, **Public hostname**: subdomain empty, domain
   `axora.management`, type **HTTP**, URL `caddy:8080`.
5. Add `COMPOSE_PROFILES=tunnel` to `.env`, then run `docker compose up -d`.
6. Open <https://axora.management>. Optional: add `www` as a second hostname.

Alternative without Cloudflare: install a reverse proxy with HTTPS on the
server (nginx/Caddy/Traefik) that forwards to `http://127.0.0.1:8080` and keeps
the `Host` header. The app expects HTTPS in front of it (secure cookies).

### 6.2 Email (Resend)

Invitations, password resets, invoices and notifications need email.

1. Create an account at <https://resend.com>, **Domains**, add
   `axora.management` and create the DNS records it shows (SPF/DKIM in
   Cloudflare DNS). Add a DMARC record, for example
   `_dmarc TXT "v=DMARC1; p=none; rua=mailto:postmaster@axora.management"`.
2. **API Keys**, create a key with sending access:
   `printf '%s' 're_...' > secrets/resend_api_key`
3. **Webhooks**, add `https://axora.management/api/email/provider-events/resend`
   (all email events) and save its signing secret:
   `printf '%s' 'whsec_...' > secrets/resend_webhook_secret`
4. In `.env` set `AXORA_EMAIL_DELIVERY_ENABLED=true`,
   `RESEND_DOMAIN_VERIFIED=true`, and after the webhook works
   `AXORA_EMAIL_EVENTS_ENABLED=true`, `RESEND_WEBHOOK_VERIFIED=true`.
   Set `AXORA_CONTACT_NOTIFICATION_TO` to the inbox for Contact Us messages.
5. `docker compose up -d`. Test by inviting a user to your own email.

Details: `docs/RESEND_TRANSACTIONAL_EMAIL.md`, `docs/ACCOUNT_EMAILS.md`.

### 6.3 Contact form spam protection (Cloudflare Turnstile)

The public Contact form stays disabled until Turnstile is configured.
Cloudflare dashboard, **Turnstile**, **Add widget** for `axora.management`.
Put the **site key** in `.env` (`TURNSTILE_SITE_KEY=`) and the **secret key** in
`secrets/turnstile_secret`, then `docker compose up -d`.

### 6.4 Contact page details

Set your public details in `.env` (empty values are hidden):

```
AXORA_SUPPORT_EMAIL=support@axora.management
AXORA_SUPPORT_PHONE=+60 12 345 6789
AXORA_SUPPORT_CONTACT_NAME=Customer Support
AXORA_SUPPORT_ADDRESS=Street 1|Postcode City|Country
```

Also review the legal texts (privacy policy, terms) in `src/lib/legal-pages.ts`
and add the new owner's legal company name and address where your law
requires it (they currently name only `axora.management`).

### 6.5 Code repository

The previous owner's GitHub repository is public and belongs to them. Create
your own private repository and push the handover branch without the old history:

```bash
git clone --branch handover-20261120 --depth 1 <previous-owner-repo-url> axora
cd axora && rm -rf .git && git init -b main && git add -A && git commit -m "Axora handover baseline"
git remote add origin git@github.com:YOUR-ACCOUNT/axora.git && git push -u origin main
```

Replace `your-github-user` in `.github/workflows/*.yml`,
`deploy/systemd/deploy.env.example` and `scripts/production/*.sh` if you want
the original automatic CI deployment (advanced, see
`docs/PRODUCTION_RUNBOOK.md`). The simple deployment in this guide does not
need GitHub at all.

### 6.6 Other previous-owner services (optional features, all disabled)

Slack app, Zapier and the external API are switched off
(`AXORA_*_ENABLED=false`). Create your own Slack app before enabling Slack.
Tailscale (private database access for the old owner) is disabled.

## 7. Updating the application

```bash
git pull                      # or copy the changed files
docker compose build app
docker compose up -d          # migrate runs automatically before the app starts
```

Database changes: add a **new** numbered file such as
`database/migrations/143_my_change.sql`. Never edit or rename a migration that
already ran: its checksum is stored and the start will stop with
"Migration checksum changed".

Development and tests (Node 24):

```bash
npm ci
npm run lint && npm run typecheck && npm test   # 2000+ unit tests
npm run build
```

`AGENTS.md` lists the product and security rules of the code base.

## 8. Backups (do this before going live)

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U postgres -Fc axora_hybrid > backups/axora-$(date +%F).dump
tar -czf backups/uploads-$(date +%F).tar.gz data/uploads
```

Run it every day (cron) and copy `backups/` **and** `secrets/` to another
place (cloud storage or another computer). Restore a dump into a new server:
install with section 4, then
`docker compose exec -T db pg_restore -U postgres --clean --if-exists -d axora_hybrid < backups/FILE.dump`.
Test a restore at least once.

## 9. Daily operations

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f app` (or `email-sender`, `db`, ...) |
| Restart | `docker compose restart app` |
| Stop / start | `docker compose stop` / `docker compose up -d` |
| Health | `curl -H "Host: $AXORA_HOST" http://127.0.0.1:8080/api/health/ready` |
| Database shell | `docker compose exec db psql -U postgres -d axora_hybrid` |

**Never** run `docker compose down -v`: `-v` deletes the database volume.

## 10. Security checklist

- [ ] Owner password changed after first sign-in.
- [ ] `secrets/` and `.env` readable only by admins; both backed up.
- [ ] Server firewall allows only SSH (`sudo ufw allow OpenSSH && sudo ufw enable`).
- [ ] PostgreSQL port 5432 and app port 3000 are never published.
- [ ] Automatic security updates on the server (`unattended-upgrades`).
- [ ] Daily backups copied off the server, restore tested.
- [ ] Old owner's DNS records, Resend domain and tunnel removed after cutover.

## 11. Known limitations (honest status)

- **Payments:** the "Pay" button records the order as paid and issues the
  invoice; there is no online payment gateway yet (see
  `PAYMENT_AND_INVOICE_OPERATING_RULES.md`). Add a real provider before
  charging customers.
- **Fresh first-owner bootstrap:** `scripts/bootstrap/create_first_platform_owner.mjs`
  creates an invitation that the current database rules cannot accept
  (it requires an active inviter). Use the provided snapshot (already has the
  Owner) and `reset-owner-password.sh`; fix the bootstrap path before relying on it.
- **Not field-tested:** real GPS tracking, delivery photos and recipient
  handover on physical devices; real email delivery from the new domain.
- **Map:** the delivery map covers the Klang Valley / Cyberjaya pilot area only
  (`public/maps/`).
- One application server (no load balancing).

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `migrate` exits with an error on the very first start | `docker compose up -d` again (first start creates the database). |
| "Migration checksum changed" | A migration file was edited. Restore the original file and add a new migration. |
| Page shows `421` | Request host differs from `AXORA_HOST`. Use the exact domain. |
| Sign-in loops back to login over plain HTTP on a server | Use HTTPS (tunnel or reverse proxy); cookies are secure-only. |
| Contact form says unavailable | Configure Turnstile (6.3). |
| No invitation emails | Configure Resend (6.2); check `docker compose logs email-sender`. |
| `permission denied` on `secrets/...` (Linux) | Run `sudo bash scripts/handover/new-secrets.sh` again (fixes owner/group). |
| `/bin/sh^M: bad interpreter` | Files were converted to Windows line endings; extract again with 7-Zip, do not edit with Notepad. |

## 13. Using an AI coding assistant

You can do every step above with an AI assistant (Claude Code, Codex,
Cursor, GitHub Copilot agent mode):

1. Open a terminal in the project folder on the server or test PC.
2. Start the assistant in that folder (for example `claude`).
3. Paste the prompt from `2-AI-Assistant-Prompt.md`, and fill in the task
   line (install, deploy with my domain, configure email, add a feature...).
4. Let it read `HANDOVER.md` and `AGENTS.md` first. Approve each command it
   proposes; refuse any command that contains `down -v`, `DROP`, `rm -rf` on
   `data/` or `secrets/`.
5. Never paste real passwords or API keys into the chat. Put them into the
   files in `secrets/` yourself.
