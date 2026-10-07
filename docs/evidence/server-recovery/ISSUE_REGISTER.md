# Server/runtime recovery issue register

This register contains no account secrets, invitation tokens, private enquiry bodies, or provider credentials.

## Current checkpoint — 2026-10-07 22:26 UTC

**BLOCKED: changed candidate not fully gated, released or accepted.**
Protected main/deployed baseline remains `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`,
OCI `sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration138. Clean candidate HEAD recorded at 22:25 UTC was
`fdb29666c8e2aa6956f9a69104809df7783fac7c` on
`codex/recovery-completion`; it is NOT deployed/certified. PR217/218 exact-a40
Nightly evidence remains historical, including its one successful existing retry
and 39 unit/19 browser intentional skips; it does not certify new source. This
section supersedes earlier status/deferrals; the initial baseline below is
retained as historical provenance, not current identity.

| Priority | Issue | Evidence / current boundary | Status |
| --- | --- | --- | --- |
| A/B | DEPLOYMENT_RUNTIME | Previous polling/readiness and idle-pool57P01 defects repaired in PR217/218; useful readiness and one idle sender stop/start proved | Deployed a40; real queued Contact journey remains pending. No host restart allowed |
| A/B | REGISTRATION | Existing cancellation repair deployed. Actual isolated exact-a40 ordinary-auth POST 500 created no fixtures; actual-image pg 8.22/Zod 4.4.3 uncast 12-parameter call raises P0001; explicit `$12::timestamptz` succeeds/contracts valid under ROLLBACK. Text PREPARE selects defaulted-logo overload; STABLE/null hypothesis contradicted | Narrow source fix being implemented independently, not yet accepted/gated/deployed; no UI retry. Original historical exception still unknown |
| A/B | PRODUCT_DELETE | Cart-only restrictive-FK defect repaired by audited Owner/DENY capability138; raw catalog DELETE remains denied | One isolated exact-a40 ordinary-auth flow EXIT0: owned eligible product/images/supplier removal/audit1/refresh absence; copied protected-reference, actual CA and owned DENY refusals passed. Histories/files/financial fingerprints unchanged outside owned fixture removal; not live/final139 acceptance |
| C | 1 — Company setup tab contrast | Existing PR #216 fix is deployed; preserve selected/visited/hover/focus readability in both themes | Deployed previously; current acceptance pending |
| C | 2 — Branch information layout | Existing grouped layout and single delivery-address action must remain; preserve budget metrics | Deployed previously; current acceptance pending |
| C | 3 — Open wallet contrast | Existing semantic button treatment must remain readable in both themes | Deployed previously; current acceptance pending |
| C | 4 — Company overview/logo | Reuse reviewed company branding and honest absent-logo placeholder | Deployed previously; current acceptance pending |
| C | 5 — Product information layout | Preserve general/delivery/pricing groups and confidential commercial permissions | Deployed previously; current acceptance pending |
| C | 6 — Setup Wallet 404 | Existing Owner-only pending state must load the correct company without fabricating a Wallet | Deployed previously; current acceptance pending; no incomplete live fixture designated |
| A/B | 7 — Contact recorded, email missing |42501/42P08/retry-delay repaired; fresh 22:24:53Z A/B enquiries/outboxes 0, eight historical holds unchanged/queues idle; Gmail exact A IDs EMPTY. A reserved/counts toward cap conservatively, Send unconfirmed; Brave/Chrome difference proves neither Send nor version cause | Core deployed; recovery UI 41 focused and latest six localized desktop/mobile tests PASS 4.8s/no POST/no CSS defect. Real verification/acceptance/delivery/receipt pending; no resend/new Submit |
| D | 8 — Shared live data through SSE | Bounded authorized durable-snapshot resync/shared connection; no new ledger/proxy/queue coupling. 320e combined E2E exposed missing initial `/api/driver/jobs` GET; efcc restores immediate authorized detail bootstrap | Three native cases passed within139/46-test gate; four dedicated/26 focused bootstrap tests PASS and independent review approved. New whole-candidate gates and production acceptance pending |
| E | 9 — Migration guide |12-page illustrated PDF, full SERVER_MIGRATION/REBOOT_RECOVERY runbooks and reviewed reproducible generator delivered; genuine readiness capture, all pages visually checked | Guide delivered locally; future destination/boot/cutover untested and not executed |
| C | 10 — Password/invitation page UI | Compact existing account design and friendly localized roles, token/consent contract preserved | Local render/link-transport tests pass; valid invitation rendered acceptance pending |
| D | 11 — Integrations/Slack | Actual Owner workspace/API-webhook flags enabled; Slack/Zapier flags false; zero connections/subscriptions/installations. Accurate provider/Zapier UI plus setup checklist | Local37focused and6desktop/mobile localized checks pass; activation needs controlled Slack workspace and dedicated credentials only |
| C | 12 — Add Budget | Existing contractual ceiling legitimately refuses oversize allocation; typed precise refusal/authority-before-replay, no accounting or period change | Integrated candidate139; focused/native gates passed at320e, new exact-head gates pending; no live budget mutation |
| C | 13 — Budgets list | Full-width aligned six-column table, semantic tokens, local scroll/keyboard focus; metrics unchanged | EN/AR/MS render and actual desktop/mobile/RTL checks pass; production new-candidate check pending |
| C | 14 — Branch Administrator lifecycle | Isolated custom-GRANT/raw lifecycle gap proven; additive139 hard ceiling/current actor/evidence, metadata editing retained | Four native cases passed within139/46test gate; production remains138, new candidate not accepted; no real destructive mutation |

Contact600010/Ray a46fe7b8df8fd974 is client challenge failure, not a proven tunnel
version cause. Latest strengthened Contact six-test run checks600010 help/retry
bounds and document/feedback overflow before retry in EN/AR/MS desktop/mobile:
6 PASS/4.8s, zero POST, no observed CSS defect. Gmail mailbox access is available;
receipt remains unproven. A is conservatively reserved for an unconfirmed manual
submission/counts toward the two-total cap; no resend/new Submit; holds never replayed.

Aggregate-only production metadata at 22:26:17Z found TOTAL Contact submissions 0
and corresponding notification outboxes 0 since A was reserved at 21:23:08Z, not
only zero labelled rows. Runtime booleans secretFileConfigured/secretAvailable/
canonicalHostnameAllowed/hostnamesSyntacticallyValid/siteKeyConfigured all TRUE;
no secret values. Bounded sanitized app-log collection for that window succeeded
with zero `public_contact_submission_failed` events, not proof of older history.
No successful Send/provider ID exists in the observed window.

Required gates at320e: lint/typecheck PASS, unit 1,845 PASS/46 intentional skips,
native 139 migrations/46 tests PASS, build PASS. First stage ENOTDIR was the preserved
existing `/home/ashraf/.npm` dangling symlink; own private cache stage then passed
30,377 files/15 symlinks, standalone two routes/two assets and assets 35 PASS. Combined E2E
stopped EXIT130: 35 PASS/four delivery FAIL/one interrupted/332 not run; visitor NOT RUN;
artifacts `output/playwright-320e-interrupted`. No initial driver-jobs GET was
observed; exact absent-hint cause remains unproven. efcc bootstrap fix is reviewed
and focused-green; fdb strengthens Contact regression. Latest lint/typecheck PASS
with these sources, but the refreshed whole-candidate gate is pending. Existing
retries/skips/assertions/projects/order were not weakened.

Private root-reviewed acceptance helpers are frozen but NOT RUN. Actual CAM,
second Driver, controlled Slack workspace/dedicated credentials, off-device
backup, destination server and whole-host boot proof remain absent. Locally
completed UI/SSE enhancements and delivered guide are not core blockers. No new
candidate deployment, lifecycle acceptance or provider-delivery proof is claimed.

## Historical initial baseline and safety proof (superseded status)

The following retains the initial checkpoint verbatim. Its statements about no
release/migration are historical only; deployed137/138 and PR217/218 are recorded
in FINAL_REPORT. It does not describe the current candidate or its final gates.

- Protected/deployed main: `cccd272be606cb2d05bd0f097cd725427506fb45`; OCI `sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad`.
- Live ledger is 136 migrations through `136_catalog_draft_zero_price_guard.sql`; sealed-release checksums match.
- Encrypted database/files backup `axora-reset-20261007T175617Z-cccd272be606.tar.gpg` passed AES256 decryption, integrity, isolated restore of 240 tables/136 migrations and persistent-file comparison at 2026-10-07T17:56:26Z.
- No off-device backup destination is configured; local encrypted proof does not imply off-device resilience.
- Installed deployment/backup/health controllers match the sealed release. Docker owns service restart through `unless-stopped`; no competing restart daemon is being added.
- Real headed production browser authenticated the designated Owner and showed Platform owner. Live role lookup verified two Owners, two Company Administrators, one Branch Administrator and one Delivery Agent. No supplied CAM or second Delivery Agent role is assumed.
- No host reboot/shutdown, live product/account deletion, financial mutation, migration, release, or email send has occurred in this recovery pass yet.
