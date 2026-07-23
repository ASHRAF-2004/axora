# Ready for the server PC

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

- Obtain written supervisor and Finance confirmation that cash on delivery
  (COD) is the only payment method for the three-company MVP.
- Treat COD as a temporary safety boundary for the MVP, not as Axora's final
  product scope. Any later payment method needs a separate security,
  compliance, Finance, and operations approval.
- Do not configure payment-gateway credentials: the MVP does not accept cards,
  FPX, DuitNow, bank transfers, credit terms, or buy-now-pay-later.
- Each participating seller must name its authorized collector and issue a
  numbered receipt. Axora must not receive, hold, or deposit the cash.
- Require confirmed delivery evidence before collection. The application and
  database accept only `Cash on delivery (COD)`; Finance still reconciles the
  amount, receipt number, invoice, and delivery evidence daily.
- Apply migration `002_cod_only_payments.sql`. It normalizes known demo aliases
  and stops if an unknown historical non-COD record needs Finance review. See
  `MVP_COD_OPERATING_RULES.md`.
- If the old Excel workbook is kept as a fallback, replace the old payment-term
  examples in `Company Master!K2:K4` and `Supplier Master!I2:I11` with the exact
  text `Cash on delivery (COD)` before anyone uses that workbook for the pilot.

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
9. Complete and approve the COD responsibilities and decisions listed in
   `MVP_COD_OPERATING_RULES.md`.
10. Obtain supervisor approval before entering real production data.
