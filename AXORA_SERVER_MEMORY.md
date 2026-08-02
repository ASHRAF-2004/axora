# Axora Ubuntu production handoff

This short file is a pointer, not a credential store or a substitute for the
versioned production runbooks.

## Current architecture

- Axora runs from sealed, immutable Docker releases on this Ubuntu host.
- PostgreSQL and persistent uploads remain on this host.
- Cloudflare Tunnel publishes `https://axora.management`; PostgreSQL, Docker,
  SSH, and internal service ports are not public application ingress.
- Root-owned configuration, deployment credentials, database passwords,
  session secrets, email credentials, and tunnel credentials live outside
  Git under `/etc/axora-production`.
- The `tailscale-db` service is retained. Never remove it as an orphan.

See:

- `docs/PRODUCTION_ARCHITECTURE.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/DISASTER_RECOVERY.md`
- `docs/refactor/ARCHITECTURE.md`
- `docs/refactor/MIGRATION_AND_RESET_PLAN.md`
- `docs/ACCOUNT_EMAILS.md`

## Permanent safety rules

- Never use `docker compose down -v`.
- Never use `--remove-orphans` for this project.
- Never remove production volumes or overwrite working secrets.
- Never put passwords, invitation tokens, API keys, private keys, database
  dumps, authenticated browser state, or production environment files in Git.
- Do not create a user with a temporary password. New users, including the
  first platform owner on a clean baseline, use a single-use invitation and
  create their own password.
- Do not run demo seeds against production.
- Do not run the guarded database reset without the exact one-shot flag, the
  exact typed confirmation phrase, a verified encrypted recovery point, and
  the user's explicit approval.
- Do not decommission Render until the local public path, automated deployment,
  reboot recovery, backup, restore, and rollback checks have passed and the
  user separately confirms decommissioning.

## Operator entry points

- Installed production controller: `/usr/local/libexec/axora-production/`
- Root-owned configuration: `/etc/axora-production/`
- Deployment logs: `/var/log/axora-production/`
- Current runbook: `docs/PRODUCTION_RUNBOOK.md`
- First-owner invitation: `npm run bootstrap:first-platform-owner -- --help`

Do not paste output from secret files into chat, screenshots, tickets, or
documentation.
