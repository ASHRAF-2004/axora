# Prompt for an AI coding assistant (Claude Code, Codex, Cursor, Copilot)

How to use:

1. Open a terminal in the project folder (the folder that contains
   `HANDOVER.md`).
2. Start your assistant there (for example: `claude`).
3. Copy everything inside the box below, replace the **TASK** line with what you
   want, and send it.
4. Approve commands one by one. Never paste passwords or API keys into the
   chat: write them into the files in `secrets/` yourself.

```text
You are working on Axora, a production multi-company procurement platform
(Next.js 16, React 19, Node 24, PostgreSQL 18, Docker Compose, Caddy,
Cloudflare Tunnel). I am the new owner; the project was handed over to me.

Before doing anything:
1. Read HANDOVER.md completely, then AGENTS.md, README.md and the files you
   need under docs/. Follow AGENTS.md rules.
2. Inspect the current state read-only first: `docker compose ps`,
   `docker compose logs --tail 50 <service>`, `cat .env` (never print files in
   secrets/), and `git status` if this is a git repository.
3. Tell me your plan in short numbered steps and wait for my "go" before any
   change that touches the server, the database, secrets or DNS.

Hard rules:
- Never run `docker compose down -v`, `docker volume rm`, `DROP DATABASE`,
  `TRUNCATE`, `rm -rf` on data/, secrets/ or backups/, or
  restore-initial-data.sh with --replace-existing-data, unless I type the exact
  words "I confirm data deletion".
- Make a database backup (HANDOVER.md section 8) before any migration,
  upgrade or data change.
- Never edit or rename an existing file in database/migrations/; add a new
  numbered migration instead.
- Never print, log, commit or paste secret values. Secrets live only in
  secrets/ (file per secret). .env holds only non-secret settings.
- Keep English, Arabic (RTL) and Malay texts in sync for any user-visible
  change.
- Keep server-side authorization, tenant scope and audit behaviour intact;
  hiding a button is never a security control.
- After code changes run: npm run lint, npm run typecheck, npm test and
  npm run build (inside Node 24), then `docker compose build app &&
  docker compose up -d` and check `docker compose ps` and
  /api/health/ready. Report exactly what passed and what failed.
- Do not claim something works (email delivery, payments, sign-in) until you
  have tested it, and say what you could not test.

TASK: <write here, for example:
  "Install Axora on this Ubuntu server for the domain axora.management using
   HANDOVER.md sections 3-6.1 (Cloudflare Tunnel). I will paste the tunnel
   token into secrets/cloudflare_tunnel_token myself when you ask.">
```

## Ready-made TASK lines

- **First installation (test PC):** "Install Axora locally with
  AXORA_HOST=localhost following HANDOVER.md section 4, then confirm I can open
  http://localhost:8080 and sign in as owner@axora.management with the
  password I set using scripts/handover/reset-owner-password.sh."
- **Production server:** "Install Axora on this Ubuntu 24.04 server for
  axora.management with Cloudflare Tunnel (HANDOVER.md 3, 4, 6.1). Set up the
  firewall and daily backups (sections 8 and 10)."
- **Email:** "Enable Resend email following HANDOVER.md 6.2. Tell me which DNS
  records to add, wait until I confirm they are added, then enable delivery and
  send a test invitation to my email."
- **Spam protection:** "Enable Cloudflare Turnstile for the Contact form
  following HANDOVER.md 6.3."
- **Backups:** "Create a daily 02:00 cron backup of the database and uploads
  as in HANDOVER.md section 8, keep 14 days, and show me how to restore."
- **Update after code change:** "I changed the code. Run the checks, rebuild
  and redeploy safely, and show me the health check."
- **Fix the first-owner bootstrap (developer task):** "HANDOVER.md section 11
  says scripts/bootstrap/create_first_platform_owner.mjs creates an invitation
  that public.axora_account_setup_invitation_is_eligible rejects (no active
  inviter). Propose a new migration that accepts only a PLATFORM_OWNER
  invitation recorded in platform_owner_bootstrap_audits when no active owner
  exists, with tests. Do not change existing migrations."
- **Real payments:** "Explain how the payment-completion boundary works
  (PAYMENT_AND_INVOICE_OPERATING_RULES.md) and propose how to add <provider>
  without changing invoice and delivery semantics."
