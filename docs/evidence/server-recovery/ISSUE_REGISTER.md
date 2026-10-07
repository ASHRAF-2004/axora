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
| A/B | DEPLOYMENT_RUNTIME | Previous polling/readiness and idle-pool57P01 defects repaired in PR217/218; useful readiness and one idle sender stop/start proved | Deployed a40; real queued Contact journey remains pending. No host restart allowed |
| A/B | REGISTRATION | Original historical route/time/error unavailable; isolated PENDING-to-FAILED defect repaired through existing terminal cancellation | Deployed; fenced restored-data normal-auth lifecycle acceptance preparing, not historical exception proof |
| A/B | PRODUCT_DELETE | Cart-only restrictive-FK defect repaired by audited Owner/DENY capability138; raw catalog DELETE remains denied | Deployed; disposable success/protected-reference/denial acceptance preparing in isolated copy only |
| C | 1 — Company setup tab contrast | Existing PR #216 fix is deployed; preserve selected/visited/hover/focus readability in both themes | Deployed previously; current acceptance pending |
| C | 2 — Branch information layout | Existing grouped layout and single delivery-address action must remain; preserve budget metrics | Deployed previously; current acceptance pending |
| C | 3 — Open wallet contrast | Existing semantic button treatment must remain readable in both themes | Deployed previously; current acceptance pending |
| C | 4 — Company overview/logo | Reuse reviewed company branding and honest absent-logo placeholder | Deployed previously; current acceptance pending |
| C | 5 — Product information layout | Preserve general/delivery/pricing groups and confidential commercial permissions | Deployed previously; current acceptance pending |
| C | 6 — Setup Wallet 404 | Existing Owner-only pending state must load the correct company without fabricating a Wallet | Deployed previously; current acceptance pending; no incomplete live fixture designated |
| A/B | 7 — Contact recorded, email missing |42501/42P08/retry-delay repaired; eight audited zero-attempt holds preserved. A/B durable counts zero; manual A reserved conservatively, user reports Brave verifies/Chrome fails600010 | Deployed core; live submission/outbox/provider/delivery/receipt evidence still pending, no historical resend |
| D | 8 — Shared live data through SSE | Approved bounded durable-snapshot resync/shared connection; no new ledger, proxy or queue coupling | Implementation and focused security/recovery checks in progress |
| E | 9 — Migration guide | Illustrated PDF and secret-free runbooks required; no host migration/cutover/decommission authorized | Independent guide work active; future destination/boot remains untested |
| C | 10 — Password/invitation page UI | Compact existing account design and friendly localized roles, token/consent contract preserved | Local render/link-transport tests pass; valid invitation rendered acceptance pending |
| D | 11 — Integrations/Slack | Actual Owner workspace/API-webhook flags enabled; Slack/Zapier flags false; zero connections/subscriptions/installations. Accurate provider/Zapier UI plus setup checklist | Local37focused and6desktop/mobile localized checks pass; activation needs controlled Slack workspace and dedicated credentials only |
| C | 12 — Add Budget | Existing contractual ceiling legitimately refuses oversize allocation; typed precise refusal/authority-before-replay, no accounting or period change | Integrated candidate139; focused passes, native final gate pending; no live budget mutation |
| C | 13 — Budgets list | Full-width aligned six-column table, semantic tokens, local scroll/keyboard focus; metrics unchanged | EN/AR/MS render and actual desktop/mobile/RTL checks pass; production new-candidate check pending |
| C | 14 — Branch Administrator lifecycle | Isolated custom-GRANT/raw lifecycle gap proven; additive139 hard ceiling/current actor/evidence, metadata editing retained | Integrated candidate139; focused passes, four native cases await final gate; no real destructive mutation |

Contact600010/Ray a46fe7b8df8fd974 is client challenge failure, not a proven tunnel
version cause. Local manual verification recovery and Dark hover/address-label
fixes have focused tests; final candidate gates/rendered/production acceptance
pending. Gmail mailbox access is now available; receipt is not yet proven.
Latest labelled A/B count zero at21:30:10Z. A conservatively reserved for manual
submission (unconfirmed); no automated A retry, max two total; holds never replayed.

## Historical initial baseline and safety proof

- Protected/deployed main: `cccd272be606cb2d05bd0f097cd725427506fb45`; OCI `sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad`.
- Live ledger is 136 migrations through `136_catalog_draft_zero_price_guard.sql`; sealed-release checksums match.
- Encrypted database/files backup `axora-reset-20261007T175617Z-cccd272be606.tar.gpg` passed AES256 decryption, integrity, isolated restore of 240 tables/136 migrations and persistent-file comparison at 2026-10-07T17:56:26Z.
- No off-device backup destination is configured; local encrypted proof does not imply off-device resilience.
- Installed deployment/backup/health controllers match the sealed release. Docker owns service restart through `unless-stopped`; no competing restart daemon is being added.
- Real headed production browser authenticated the designated Owner and showed Platform owner. Live role lookup verified two Owners, two Company Administrators, one Branch Administrator and one Delivery Agent. No supplied CAM or second Delivery Agent role is assumed.
- No host reboot/shutdown, live product/account deletion, financial mutation, migration, release, or email send has occurred in this recovery pass yet.
