# Server/runtime recovery issue register

This register contains no account secrets, invitation tokens, private enquiry bodies, or provider credentials.

Current resumed baseline: protected main/deployed `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`,
OCI `sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration138. PR217/218 and exact-main Nightly passed; see FINAL_REPORT for the
existing one successful retry and39unit/19browser intentional skips. Candidate
`codex/recovery-completion` is NOT deployed/certified yet. Earlier baseline below
is retained as historical provenance, not current identity.

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
| D | 8 — Shared live data through SSE | Approved bounded durable-snapshot resync/shared connection; no new ledger, proxy or queue coupling | Implementation and focused security/recovery checks in progress |
| E | 9 — Migration guide | Illustrated PDF and secret-free runbooks required; no host migration/cutover/decommission authorized | Independent guide work active; future destination/boot remains untested |
| C | 10 — Password/invitation page UI | Compact existing account design and friendly localized roles, token/consent contract preserved | Local render/link-transport tests pass; valid invitation rendered acceptance pending |
| D | 11 — Integrations/Slack | Existing API/webhook/Zapier/Slack inventory/checklist; no controlled Slack workspace supplied | Independent read-only verification active; real Slack activation requires authorized workspace |
| C | 12 — Add Budget | Existing contractual ceiling legitimately refuses RM500; typed precise refusal/authority recheck, no accounting or period change | Focused specialist implementation; no live budget mutation |
| C | 13 — Budgets list | Full-width aligned six-column table, semantic theme tokens, local horizontal scroll/keyboard focus; metrics unchanged | Local EN/AR/MS render checks pass; actual rendered acceptance pending |
| C | 14 — Branch Administrator lifecycle | Isolated custom-GRANT/raw lifecycle gap proven; additive139 hard ceiling/current actor/evidence, metadata editing preserved | Implementation/review/native proof in progress; no real destructive mutation |

Contact600010/Ray a46fe7b8df8fd974 is client challenge failure, not a proven tunnel
version cause. Local manual verification recovery and Dark hover/address-label
fixes have focused tests; final candidate gates/rendered/production acceptance
pending. Gmail mailbox access is now available; receipt is not yet proven.
Latest labelled A/B count zero, max two total; historical holds never replayed.

## Historical initial baseline and safety proof

- Protected/deployed main: `cccd272be606cb2d05bd0f097cd725427506fb45`; OCI `sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad`.
- Live ledger is 136 migrations through `136_catalog_draft_zero_price_guard.sql`; sealed-release checksums match.
- Encrypted database/files backup `axora-reset-20261007T175617Z-cccd272be606.tar.gpg` passed AES256 decryption, integrity, isolated restore of 240 tables/136 migrations and persistent-file comparison at 2026-10-07T17:56:26Z.
- No off-device backup destination is configured; local encrypted proof does not imply off-device resilience.
- Installed deployment/backup/health controllers match the sealed release. Docker owns service restart through `unless-stopped`; no competing restart daemon is being added.
- Real headed production browser authenticated the designated Owner and showed Platform owner. Live role lookup verified two Owners, two Company Administrators, one Branch Administrator and one Delivery Agent. No supplied CAM or second Delivery Agent role is assumed.
- No host reboot/shutdown, live product/account deletion, financial mutation, migration, release, or email send has occurred in this recovery pass yet.
