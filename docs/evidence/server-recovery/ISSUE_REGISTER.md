# Server/runtime recovery issue register

This register contains no account secrets, invitation tokens, private enquiry bodies, or provider credentials.

| Priority | Issue | Evidence / current boundary | Status |
| --- | --- | --- | --- |
| A/B | DEPLOYMENT_RUNTIME | Live email polling fails while readiness remains green. Historical cleanup/integration idle pool errors (`57P01`) terminated their processes. Current Docker startup policies are enabled; no competing supervisor is justified | Root cause established; fixed locally / review in progress. No host restart allowed |
| A/B | REGISTRATION | Original live journey/error is unavailable. Isolated real invitation workflow reproduces invalid `PENDING → FAILED` transition (`P0001`) after a refused claim; terminal cancellation permits safe replacement | Fixed locally; original live case not reproduced with evidence gap |
| A/B | PRODUCT_DELETE | One live cart-only reference is omitted by the existing request-history guard. Matching isolated state raises restrictive FK `23001`/`23503`; transaction rolls back. Narrow live Owner/DENY-aware capability and typed reference feedback are under review | Root cause established in isolated matching dependency state; live irreversible trial unverified |
| C | 1 — Company setup tab contrast | Existing PR #216 fix is deployed; preserve selected/visited/hover/focus readability in both themes | Deployed previously; current acceptance pending |
| C | 2 — Branch information layout | Existing grouped layout and single delivery-address action must remain; preserve budget metrics | Deployed previously; current acceptance pending |
| C | 3 — Open wallet contrast | Existing semantic button treatment must remain readable in both themes | Deployed previously; current acceptance pending |
| C | 4 — Company overview/logo | Reuse reviewed company branding and honest absent-logo placeholder | Deployed previously; current acceptance pending |
| C | 5 — Product information layout | Preserve general/delivery/pricing groups and confidential commercial permissions | Deployed previously; current acceptance pending |
| C | 6 — Setup Wallet 404 | Existing Owner-only pending state must load the correct company without fabricating a Wallet | Deployed previously; current acceptance pending; no incomplete live fixture designated |
| A/B | 7 — Contact recorded, email missing | Live claim denial `42501` at private invoice helper blocks both queues; completion `42P08` and retry-delay denial also proven. Historical jobs require targeted hold before repaired claims activate | Fixed locally; live delivery and service-trial acceptance pending |
| D | 8 — Shared live data through SSE | Reuse existing streams; durable/reconnect/revocation requirements need separate implementation and acceptance | Deferred until core acceptance |
| E | 9 — Migration guide | Illustrated PDF and secret-free runbooks required; no migration/cutover/decommission authorized | Deferred until core acceptance; short core rollback runbook prepared locally |
| C | 10 — Password/invitation page UI | Visual work must preserve token, consent and atomic setup contract; functional defect tracked separately as REGISTRATION | Deferred until core acceptance |
| D | 11 — Integrations/Slack | Actual connection status and authorized setup checklist required; no controlled Slack workspace supplied | Deferred until core acceptance; activation lacks authorized workspace |
| C | 12 — Add Budget | Reported company “mewo 1”, branch “openai”, RM500 attempt requires diagnosis without changing ceilings or Wallet cash | Pending core acceptance; no budget mutation performed |
| C | 13 — Budgets list | Improve readable table/mobile layout without changing metrics | Deferred until core acceptance |
| C | 14 — Branch Administrator lifecycle | Remove unauthorized delete/deactivate UI and deny direct commands while preserving Company Admin/Owner safeguards | Pending core acceptance; destructive live negative tests prohibited |

## Baseline and safety proof

- Protected/deployed main: `cccd272be606cb2d05bd0f097cd725427506fb45`; OCI `sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad`.
- Live ledger is 136 migrations through `136_catalog_draft_zero_price_guard.sql`; sealed-release checksums match.
- Encrypted database/files backup `axora-reset-20261007T175617Z-cccd272be606.tar.gpg` passed AES256 decryption, integrity, isolated restore of 240 tables/136 migrations and persistent-file comparison at 2026-10-07T17:56:26Z.
- No off-device backup destination is configured; local encrypted proof does not imply off-device resilience.
- Installed deployment/backup/health controllers match the sealed release. Docker owns service restart through `unless-stopped`; no competing restart daemon is being added.
- Real headed production browser authenticated the designated Owner and showed Platform owner. Live role lookup verified two Owners, two Company Administrators, one Branch Administrator and one Delivery Agent. No supplied CAM or second Delivery Agent role is assumed.
- No host reboot/shutdown, live product/account deletion, financial mutation, migration, release, or email send has occurred in this recovery pass yet.
