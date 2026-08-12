# Ready for the server PC

> **Historical checklist — superseded.** This 22 July 2026 preparation record
> is not the current deployment, identity, email, or migration runbook. Do not
> use its test counts, migration `002` instruction, demo-era administrator
> step, or LAN deployment sequence as the current baseline. The reviewed
> refactor target now runs through migration `032`. The last read-only
> production audit observed migration `013`, so migrations `014` through `032`
> are 19 pending branch changes until an approved release is deployed. Use
> `docs/PRODUCTION_RUNBOOK.md`,
> `docs/refactor/MIGRATION_AND_RESET_PLAN.md`, and `docs/ACCOUNT_EMAILS.md`.
> The first production owner is created only through the guarded one-time
> invitation flow, never with a default or administrator-visible password.

Preparation on the Windows PC is complete as of 22 July 2026.

## Verified here

- Production build: passed (`22` application routes plus APIs).
- ESLint and TypeScript: passed.
- Automated tests: `27/27` passed.
- Database migration and sanitized seed: passed in PGlite.
- Browser QA: `9` desktop/mobile screens passed with no overflow or browser
  errors.
- Dependency audit: `0` known vulnerabilities.
- Server shell syntax: `18` scripts passed.
- PDF guide: `20` A4 pages, embedded Arabic fonts, visually inspected.

Docker is not installed on this preparation PC, so actual container startup,
LAN binding, Caddy certificate trust, reboot recovery, and physical backup
restore are deliberately left for the Ubuntu server.

## Confirm before entering live data

- Confirm the scoped Pay action, server-authoritative totals, finalized invoice, PDF attachment, and one logical invoice email in the controlled production test.
- Keep payment, email delivery, fulfilment, physical delivery, and customer receipt as independent auditable states.
- Follow `PAYMENT_AND_INVOICE_OPERATING_RULES.md` before the first live checkout.

## Do later on the server PC

1. Install the new SSD and Ubuntu.
2. Confirm the real LAN IP, subnet, interface, and internal hostname.
3. Copy this entire folder to `/srv/axora`.
4. Follow `output/pdf/Axora_Server_Deployment_and_Use_Guide_AR.pdf`.
5. Create production secrets on Ubuntu; never reuse a demonstration password.
6. Deploy, create the first named administrator, configure internal DNS/hosts,
   and trust the Caddy public root certificate on approved clients.
7. Apply the firewall with the real LAN values.
8. Test from another office PC, test a reboot, create an off-SSD backup, and run
   `restore-test.sh`.
9. Complete and approve the payment responsibilities and decisions listed in
   `PAYMENT_AND_INVOICE_OPERATING_RULES.md`.
10. Obtain supervisor approval before entering real production data.
