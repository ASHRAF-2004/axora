# Axora runtime recovery — persistent report

Report date: 2026-10-08, Asia/Kuala_Lumpur. This report distinguishes deployed repairs from workflow acceptance. Earlier component investigation documents retain their original baseline wording; this report is the current status summary.

## Resumed execution - current candidate (2026-10-07 21:47 UTC)

Deployed baseline remains `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`,
OCI `sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration138. New candidate is in `codex/recovery-completion`; its SHA/gates,
release and production acceptance are not yet available. Earlier deployed fixes
and unrelated dirty worktrees remain intact. This section supersedes the earlier
blanket deferrals below: independent remaining work is now actively executing.

| Item | Current evidence / exact remaining boundary |
| --- | --- |
| Contact verification | User supplied error `600010`, Ray `a46fe7b8df8fd974`; real Chrome also renders verification failure before Send. User reports verification works in Brave but not Chrome. Exact Chrome/environment cause and whether Send was pressed remain unproven; no labelled durable submission found. Cloudflare widget domain/public-key fingerprint match actual runtime; managed mode, Bot Fight Mode false. No injected token or bypass. |
| Tunnel version | Actual healthy digest-pinned cloudflared2026.7.3 is older than official2026.10.0 but within the supported one-year window. No evidence attributes600010 to it; no Tunnel/configuration change made. |
| Contact recovery UI | Local manual reset/retry preserves form, distinguishes verification from server availability, displays only sanitized six-digit codes, handles expiration/timeout/script/unsupported states, EN/AR/MS/RTL.41focused unit tests passed;6local desktop/mobile recovery tests passed7.6s, then16combined Contact/setup tests passed12.4s. These use demo-only mocks and do not prove real verification or delivery. |
| Contact evidence chain | ZERO labelled A/B enquiries/outboxes in read-only metadata21:30:10Z; Gmail label-A ID search also empty. A is conservatively reserved in the private attempt journal for one manual user submission, NOT confirmed sent; no automatic A retry permitted, and only B remains available under the two-total cap. Eight historical holds and six controls unchanged. Gmail recipient access verified; Resend domain verified/sending enabled. No smoke acceptance/delivery/receipt claimed. |
| Original lifecycle acceptance | Separately fenced, restored-data, exacta40 browser environment is being prepared with ordinary authorized sign-in and RAM-only email sink. Verified dump/uploads copied privately with matching checksums. Two scaffold startup failures occurred before restore/authentication: read-only PG mount, then non-traversable mount-root permissions. Partial files and failed-attempt evidence are retained; this is not an application-test retry or acceptance pass. Browser-driver source reviewed completely. No real product/business-history deletion, copied-password modification or fabricated session. Original historical exception still cannot be inferred from a separate journey. |
| Dark hover / branch labels | Local shared Dark hover/pressed tokens meet4.5 text contrast; branch status uses location-confirmation label and one action. Actual desktop/mobile10browser checks passed24.3s: all6setup tabs and all Wallet actions normal/hover/focus/pressed in both themes; branch labels/budget table EN/AR/MS with RTL/no document overflow. Production acceptance remains pending. |
| Invitation UI / budgets table | Compact existing account treatment and localized role label; full-width aligned six-column budget table with keyboard-scrollable mobile region. No token/consent/password or metric changes. Six render tests passed EN/AR/MS; missing/invalid-link browser checks passed as part of16tests; budgets actual browser checks passed. Valid invitation journey pending isolated normal-auth harness. |
| Budget / BranchAdmin | Integrated specialist candidate068ac69 (18files) with typed legitimate ceiling refusal and UI/server/DB lifecycle boundary; additive139 justified by isolated custom-GRANT/raw lifecycle/evidence defects. Financial calculation/period selection/Wallet/recurring/RLS unchanged; initial expiry fixture claim retracted. Specialist61focused passes; integrated9files91focused passes. Four native cases added to final gate, not executed yet. |
| Shared live updates | Integrated bounded authorized durable-snapshot resync, one shared connection, fresh authorization before topic loads/emission, reconnect resync/fallback, dirty-form deferral and bounded pending reads. No durable event replay, underlying-query cancellation, new grant, ledger or proxy change claimed. Specialist62focused passes/3native skips and4actual browser passes14.4s; final integrated10files75focused passes. Independent source review approves application boundaries; required native preconnection loopback/app-role guard fixed. Three native cases await final gate. |
| Integrations / guides | Actual authenticated Owner Integrations200/readable/no overflow: API/webhooks enabled, Slack disabled, no company connections/subscriptions/Slack installations. Zapier runtime false; app/client IDs unconfigured. Local accurate adapter/provider/Zapier labels,37focused tests and6localized desktop/mobile browser checks pass; exact private setup checklist in INTEGRATION_ACCEPTANCE.md. Controlled Slack workspace/provider secret files absent, blocking activation only. SERVER_MIGRATION/REBOOT_RECOVERY and12-page illustrated PDF delivered locally; all pages visually reviewed, genuine public readiness capture21:33:44Z. PDF SHA25699e9210d98f911efc589997a4d4c66197b7ac86eb10851f6d931ed97de36e627. No destination supplied and no host boot/cutover authorized. |

Official diagnostics: [challenge solve issues](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/),
[Turnstile error codes](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/),
[cloudflared releases](https://github.com/cloudflare/cloudflared/releases),
[supported versions](https://developers.cloudflare.com/tunnel/downloads/#deprecated-releases).

No host restart/shutdown, new production release, financial mutation, historical
resend or agent smoke Send click has occurred in this resumed slice. Existing retry and
intentional skips remain unchanged; earlier exacta40 gates below certify only
that deployed baseline, not this changed candidate.

## Earlier deployed-core status (retained evidence)

**Core fixes deployed; overall recovery acceptance BLOCKED. Not demo-ready.**

The focused runtime/email/registration/product-lifecycle repair shipped in PR217. Required Nightly on that merged head subsequently exposed one pre-existing branch-URL test mismatch. A strictly scoped test-only correction shipped through PR218; its exact-main image/deployment and final Nightly passed, and installed identity/schema are verified. Final CI browser totals are322 passed/one flaky passed on the existing retry/19 intentional skips, plus18 visitor-recovery passes—not a clean323-pass result. One idle sender-only production trial passed; this is not Contact delivery or original live lifecycle acceptance.

Contact provider delivery and mailbox receipt are not verified: the normal managed verification widget leaves the real form's Send enquiry button disabled. No fake token, direct POST, verification bypass, historical replay or smoke resubmission was used. Original registration history and explicitly disposable live registration/product fixtures remain unavailable. Those original live journeys are not silently treated as passes.

The computer was not shut down, rebooted, restarted or power-cycled by this task. Observed boot ID remains `aaf793bb-7222-4663-8b5a-e84beab01c4b`, independently started 2026-10-07 13:47:55 +08. **Whole-host boot recovery is untested.** A deployment/container replacement is not a host reboot.

No financial transaction, payment, purchase, Wallet credit, budget increase, real product/account deletion, delivery claim/completion or account-role/password change was performed for acceptance. Private supplied account input remains intact outside Git; no credentials are included here. Existing dirty root checkout, prior worktrees and unrelated PR215 were preserved.

## Production identity and release

| Boundary | Verified identity/status |
| --- | --- |
| Production before | Protected main/deployed `cccd272be606cb2d05bd0f097cd725427506fb45` |
| Before OCI | `ghcr.io/ashraf-2004/axora@sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad` |
| Before migration | 136 rows; `136_catalog_draft_zero_price_guard.sql`; sealed manifest drift `none` |
| Core candidate | `2ffdd666859158d261e33b979d760bc5ee69a534`; tested application sources unchanged from `c7c48e614f46036572a33e49dda55a8360df235a` |
| Core PR | [217](https://github.com/ASHRAF-2004/axora/pull/217), squash merged 2026-10-07T18:53:58Z |
| Core merge/deployed | `9392334cf3390aef5df8d44e4b597b6a8559b13a` |
| Core OCI | `ghcr.io/ashraf-2004/axora@sha256:5b4b9fc79c054479c83ca1884cf29f72d2a39ea5002193fc176c4f731139cbc9` |
| Core schema | 138 rows; `138_owner_product_deletion_capability.sql`; sealed manifest drift `none` |
| Core protected CI | [37669513137](https://github.com/ASHRAF-2004/axora/actions/runs/37669513137), passed |
| Core image/deploy | [37670350859](https://github.com/ASHRAF-2004/axora/actions/runs/37670350859), passed |
| Core final Nightly | [37670460272](https://github.com/ASHRAF-2004/axora/actions/runs/37670460272), failed one browser URL assertion; preceding gates and Zapier passed |
| Required test-only correction | [PR218](https://github.com/ASHRAF-2004/axora/pull/218), candidate `d3ff898de9402819a55005cf3a9a1db492d6166d`; protected CI37675095144 passed |
| Corrected main | `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`, squash merged 2026-10-07T19:36:27Z |
| Corrected image/deploy | [37675766068](https://github.com/ASHRAF-2004/axora/actions/runs/37675766068), passed; deployment completed19:40:44Z |
| Current deployed SHA/OCI | `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`; `ghcr.io/ashraf-2004/axora@sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2` |
| Current sealed release/schema | `/var/lib/axora-production/releases/a40a70bef3104d7e08959dfdc6e55a36ba6beb31`;138/head138; manifest drift `none` |
| Corrected exact-main Nightly | [37675841502](https://github.com/ASHRAF-2004/axora/actions/runs/37675841502), SUCCESS; quality completed2026-10-07T20:01:20Z; Zapier also passed |
| Final production health | 2026-10-07T20:03:12Z: external HTTPS/redirect/security headers/liveness/database readiness passed; app/all five workers running/healthy/restart0/noOOM on exacta40/c944; protected main stilla40; sealed migration manifest drift `none` |

PR218 changes only three lines in one E2E file. It does not modify application behavior, migrations, routing, financial semantics, dependencies, retries, timeouts, test order or infrastructure. Existing immutable-image automation owns its normal release; no parallel manual deployment is introduced.

## Proven core failure boundaries

### Runtime and transactional email

- Live transactional claims failed with SQLSTATE `42501`: private invoice-recipient suppression helper EXECUTE was denied. Raw payload/readiness helpers were also intentionally private. Public/app/sender listener checks appeared green while useful queue polling repeatedly failed.
- Completion preparation failed with `42P08`: parameters shared across integer/text contexts required explicit casts. Retry-delay helper EXECUTE denial was another independently verified `42501` boundary.
- Migration137 adds bounded worker-lane state/payload capabilities; private raw payload remains denied. Payload access requires the exact unexpired SENDING lease. The worker-lane context is a trusted application assertion after private HMAC verification, not independent database-principal authentication.
- Completion success requires `recorded === true`. Lost/ambiguous acceptance remains UNCERTAIN; no resend or new delivery-ID fabrication is used to manufacture completion.
- Workers poll immediately, recover with bounded backoff, prevent overlap and drain active work on SIGTERM/SIGINT. Production email grace increased from20 to45 seconds to cover the measured bounded iteration. Useful-readiness freshness is distinct from liveness.
- Historical cleanup/integration idle PostgreSQL `BoundPool` error `57P01` was uncaught/process-fatal. A shared once-installed idle-error listener permits the driver to dispose the dead idle client and use a fresh connection on the next ordinary operation. Failed queries/transactions are not replayed or force-reset.
- Actual isolated process proof: queue refusal recovers in about10 seconds; graceful accepted-send drain about120ms with one acceptance/one completion; abrupt termination after acceptance preserves UNCERTAIN with one acceptance/no completion/no replay. Native isolated idle-backend termination refills the pool; transaction failure still requires explicit ROLLBACK.

### Registration

The original reported live route/time/exception is unavailable. Do not equate a separate proven lifecycle defect with proof of the original report.

Isolated migrated app-role reproduction established that pre-send refusal tried forbidden `PENDING→FAILED` and raised `P0001`, leaving an unusable invitation/replacement path. The deployed narrow fix uses the existing permitted `PENDING→CANCELLED` terminal state and idempotent acknowledgement. Cancelled tokens remain invalid; account stays INVITED/passwordless. SENDING/success/consent/password-policy/roles/single-use behavior are unchanged. No registration migration or plaintext password path was added.

Real metadata contained six SENT invitations, five consumed and one expired, not a disposable failing fixture. No invitation was consumed/replaced, password reset, account deleted or new role assigned for testing. **Original live registration acceptance remains unverified.**

### Product deletion

Old request-history guard omitted cart-only references. A matching isolated live dependency state raised FK/RESTRICT SQLSTATE `23001`/`23503`, atomically rolling back product and image deletion. Old deployed raw DELETE grants were present; an isolated migration-only `42501` was not misreported as the production cause. Original historical deletion exception remains unavailable.

Migration138 exposes one audited Owner/DENY-aware capability with current actor/assignment/authVersion validation and lock-protected authority rechecks, product locking, reference checks and atomic owned-image/supplier/product removal. Foreign tenants, protected references/history and revoked authority remain protected. Exactly three raw catalog DELETE grants were revoked; canonical grant replay cannot restore them after138.

Typed EN/AR/MS inline feedback and the existing Deactivate alternative replace generic failure. Native concurrency proof covers references arriving while deletion waits, committed references preserving assets and a DENY change during a lock wait. **No real product deletion/deactivation was executed; disposable live success acceptance remains unverified.**

## Contact routing, backlog and receipt evidence

- Existing route preserved: public support address `support@axora.management`; Contact internal recipient `thalththanwyd@gmail.com`; existing Resend outbound sender/transport retained. No visitor acknowledgement or CAM broadcast was enabled. Mail routing/provider secrets were not replaced.
- Exactly eight historical zero-attempt PENDING jobs were Infinity-held in one guarded audited transaction before repaired claims became active. Exactly eight corresponding audit UPDATE rows were verified. Original due timestamps are preserved in private operational SQL. Four historical UNCERTAIN jobs remain review-only.
- Latest20:04:18Z read-only metadata: all eight held PENDING/zero attempts/no provider IDs/no leases; no active suppression entries; no SENDING or due-pending work; six worker controls unchanged/unpaused/revision1; both new smoke labels have zero enquiries/outboxes. No agent-wide RESUME was used.
- Smoke labels `AXORA-RECOVERY-20261008-A/B`: zero actual submissions, enquiries, notification outboxes, acknowledgements or provider sends. The two-submission allowance has not been consumed.
- Provider acceptance, signed delivery event and recipient Inbox/spam receipt are separate evidence stages. **None is claimed for these new live smokes.** No recipient mailbox access was supplied.
- The queued-across-restart B scenario is not performed. Prepared private helper is not evidence of a trial. Never send a false durable-B handoff.

## Service recovery trials and observers

Production controlled trial count: **one of at most two**. Trial1 is idle sender-only, expressly not queued-mail or complete core-workflow acceptance. No second trial was performed: queued-B has no verified submission, and random repeat restarts are not justified. No host/database/network/shared-Docker/proxy or unrelated workload was stopped for this trial.

- Exact same sender container `37aeab88844035720f3aa8061e163387c79eb9ad5c568c89b6e7cb1258bd1b20`, deployeda40/c944 digest. Safety preflight: fresh encrypted restore-proven backup, prior compatible image locally present, zero non-audit recent users, idle three queues, exact eight holds, health green and capacity available. Root-protected reviewed controller/marker/events and independent180-second observer were installed before action.
- Stop requested19:51:33.827Z with45-second grace; stopped cleanly/exit0/noOOM confirmed19:51:33.969Z, about142.5ms after request. Immediate start of the same ID requested19:51:33.969Z; Docker returned19:51:34.072Z and exact new start anchor was validated.
- Useful sender readiness first observed19:51:34.158Z, about189ms after start request. Ready plus Docker healthy observed19:51:40.407Z, about6.4 seconds after start request. Final pass19:51:40.574Z; controller **exit0**, evidence sync completed. No automatic restart, OOM, changed start anchor or unplanned restoration.
- Public readiness final200; all eight historical jobs and six worker controls unchanged; all three queues idle. No queue write, provider send, Contact/B handoff, compose recreation, secret replacement or manual repair. Real authenticated Owner Wallet direct read works afterward; original live registration/product destructive journeys remain unavailable, not passed by this trial.
- Original root-only event evidence: `/var/lib/axora-production/recovery-trials/2026-10-08/idle-email-sender-trial-1-events.jsonl`; exclusive fsynced attempt marker alongside it. Reviewed helper SHA256 `2905788de0396df7e1388e56b5b94da04c6272f879cbb7d6b8b374dc59267120`. A printed pass alone was not accepted without controller exit0.

The initial 600-second read-only collector is incomplete: it exited1 after its last complete sample at596089ms. The exact evidence remains unchanged. A private observer bug passed a fractional monotonic remaining-time value into Node execFile's integer timeout, proving `ERR_OUT_OF_RANGE`. Flooring only that bounded timeout fixed the collector; a five-second proof exits0 with a clean stop. This is not an application or production-health failure.

A corrected600-second metadata-only observer completed exit0/301 samples/clean stop at600001.666ms across the normal939→a40 deployment. Rollout interruption was observed: last full healthy old sample19:39:54.520Z; first unavailable19:39:56.519Z; public unavailable then502 through19:40:34.510Z, first20019:40:36.509Z. Local app live/ready first20019:40:30.509Z; sender ready503 through19:40:38.509Z then20019:40:40.509Z. These are sampled boundaries, not exact continuous downtime.203 subsequent complete samples were all-six200/newa40/healthy/no restarts. Five final deadline-censored observations are excluded from production-health failures. Source SHA256 `5707eb2f4850ba92652b33b8f979c5597e6d6c01bd5886b4f93e902c2b31078a`; private proof `deployment-939-to-a40-readiness-proof.md`.

The independent180-second trial observer completed exit0 with90 complete samples/start/stop and no deadline-censored observations, stopped19:53:52.856Z/elapsed180000.924ms. All six endpoints returned200 in all90 samples (540 observations). App remained healthy; sender was healthy87/starting3, new process first sampled19:51:34.861Z with useful readiness200 and Docker healthy first sampled19:51:40.860Z. All sampled revisions/digests matcheda40/c944 and restart counts stayed0. The~142ms stop occurred between samples, so clean exit/noOOM/same-container proof comes from the separate controller events, not these probes. Source SHA256 `8b742c9ea2863d1e81edf76799d79765cac0de7c1504710f509d613c4845de65`; private proof `idle-trial-1-observer-proof.md`. No collector result is a guarantee of uninterrupted single-host service or email delivery.

The task did not operate unrelated stethofuse services. Their current start times19:19:09–15Z were independently observed; do not claim all unrelated container identities remained unchanged or attribute their restart to this task.

## Existing issue register:1–14

| Issue | Current status and acceptance boundary |
| --- | --- |
| 1 Setup-tab contrast | Earlier fix preserved. All six normal tabs readable live in Light/Dark. Light normal13.20 contrast; Dark normal4.83. Dark hover/hover-plus-focus3.80 is a residual defect below4.5; not fully accepted. |
| 2 Branch layout | Earlier General/Address/Contact/Delivery groups and aligned Budget preserved; live Owner desktop/390px mobile readable/no overflow. One actual address-edit link, but two misleading repeated label rows remain. BranchAdmin shares presentation. Other authorized roles/RTL not fully repeated live. |
| 3 Open wallet | Earlier semantic primary foreground fix preserved across rows. Live Light normal/hover/focus and Dark normal/focus readable. Dark hover directly confirmed3.80 residual; not fully accepted. |
| 4 Overview/logo | Earlier structured identity/business/contact/setup progress preserved. Existing reviewed logos load for mewo1 and TEST. mewo1 Light/Dark and390px mobile readable/no overflow. No-logo placeholder covered locally; no eligible absent-logo live fixture. No duplicate storage system. |
| 5 Product details | Earlier Details/Delivery/Authorized pricing groups and image gallery preserved; live Owner Light/Dark/390px mobile readable/no overflow. Owner pricing remains authorized. CompanyAdmin direct management record is denied without pricing; actual CAM unavailable, isolated permission evidence only. |
| 6 Setup Wallet404 | Earlier missing-Wallet `notFound()` replaced with Owner-only pending state; no fabricated Wallet. Live mewo1 Continue setup→correct company-specific Wallet works, refresh/direct URL/back-forward remain valid. Existing companies have Wallets; missing-Wallet pending-state live scenario remains unverified. |
| 7 Contact email | Core claim/completion/retry/readiness repairs deployed; isolated process/native regressions passed. Real verification/provider/mailbox/queued-restart acceptance blocked as above. |
| 8 Shared SSE | Deferred; no new implementation or reconnect/revocation acceptance bundled into core. Existing delivery Live indicator is not full shared-SSE acceptance. |
| 9 Migration guide | Short tracked runtime/rollback runbook delivered. Illustrated PDF and full SERVER_MIGRATION/REBOOT_RECOVERY guides not delivered. No server migration/cutover, reboot or decommission executed; schema migrations137/138 were deployed as recorded above. |
| 10 Invitation UI | Visual/password-setup work deferred. Separate registration lifecycle cancellation repair is not completion of this UI item. |
| 11 Integrations/Slack | Deferred. Existing API/webhooks/Zapier/Slack architecture not duplicated. No controlled Slack workspace supplied; adapter activation/revoke/reconnect untested. Zapier dev-lock security gate correction is not workspace activation. |
| 12 Add Budget | Diagnosed only. Proposed mewo1/openai RM500 addition exceeds contractual ceiling; error mapping hides the precise reason. Company Wallet shortage is not the established cause. Correct company assignment matters. No budget mutation or semantics change. |
| 13 Budgets table | Deferred; no layout implementation/acceptance bundled into core. |
| 14 Branch Administrator | UI exposure confirmed live: Department-management alias exposes Deactivate/Delete branch. Current default SQL authority denies lifecycle actions; no real action executed. Custom grants/legacy/raw-update boundaries need isolated follow-up. Not fixed or accepted. |

Separate register entries: **deployment/startup/runtime** deployed/isolated-verified/idle sender trial passed, full affected workflow acceptance incomplete; **REGISTRATION** deployed for proven cancellation defect, original live report not reproduced/evidence gap; **PRODUCT_DELETE** deployed/isolated-verified, original live success/destructive scenario unverified.

## Browser and role acceptance

Real production headed Chrome was used through the task-authorized normal login UI after Computer Use surfaces and Chrome DevTools MCP were unavailable. Private account input is read in memory; no auth storage state, password screenshots, traces/HAR or bearer links retained. Captures are not made on login/account routes. Actual role/scope was verified from live metadata and UI, not email labels.

- Owner `tayamhussam@gmail.com`: structured company/branch/product, logos, six setup tabs, wallet list and existing-company Wallet context checked. Normal theme states pass; Dark hover residual remains. Owner Company setup itself is read-only under the current existing role presentation; no permissions were widened.
- Company Administrator `malaysiaashrafo@gmail.com`, mewo1: shopping chooser→openai, correct delivery address and existing branch budget, empty cart and actual company Wallet read successfully. No product was added or top-up requested. Direct management product-record route renders404 without confidential commercial data.
- Branch Administrator `shehab111alslool@gmail.com`, mewo1/openai: correct scoped dashboard and shared branch layout read; lifecycle buttons incorrectly visible. No destructive action performed.
- Delivery Agent `alsaloulashraf@gmail.com`: delivery-only navigation/portal and available jobs read. No Claim/availability/status/location action; no active assignment means full delivery lifecycle untested.
- `owner@axora.management` is actually Owner, not CAM. No live CAM or second delivery-agent role is available; no fabricated sessions, promotion or role-cookie changes.
- Saved profile locales were not changed. Current live audits used English. EN/AR/MS focused/i18n and Arabic RTL fixture evidence exist locally; new production RTL/Malay structured-layout acceptance is not claimed.

Screenshots remain private under `/home/ashraf/Documents/Axora Recovery Evidence/2026-10-08/output/playwright/`. Loading-state captures are not used as layout/no-logo acceptance. The UI/UX skill's state-contrast and responsive checks exposed the residual Dark-hover defect; no global redesign/new palette was applied.

## Tests and required gates

| Gate | Exact-source evidence/result |
| --- | --- |
| Focused email/process | Six email files45 passed; actual isolated sender subprocess trials passed |
| Focused registration | Initial two files10 passed; cancelled-token workflow assertion3 passed |
| Focused product | 20 passed; current authority/reference/asset error paths covered |
| Pool/query contracts | 11 passed; actual isolated idle socket/refill proof included in native gate |
| Combined focused | Seven files36 passed |
| Lint/typecheck | Full lint atb740021; two type-only imports corrected toc7c48e6, changed-file lint and full typecheck passed. Exacta40 Nightly passed both. |
| Unit/PGlite | c7c48e6 and exacta40 Nightly:1728 passed/39 intentional skips,359 passed files/8 skipped; final CI duration515.61s |
| Native PostgreSQL | c7c48e6 and exacta40 Nightly:all138 migrations/replay/RLS/grants/lifecycle and39 tests/eight files passed, including3 product races/actual idle socket |
| Build | c7c48e6 passed, Next16.2.11 and pg-cloudflare standalone files; exacta40 Nightly production build/staging/standalone validation passed |
| Stage/standalone |30361 files/15 symlinks staged; isolated owned server validated two routes/two self-hosted resources; stopped afterward |
| Production assets |35 assets/7996414 bytes; Compose/Caddy/secret invariants passed |
| Full local combined E2E | c7c48e6:323 passed/19 intentional skips,6.1min, fresh server ownership, retries0 |
| Local visitor recovery |18 passed/15.2s |
| Original Nightly939 |322 passed/19 intentional skips/one stale exact-URL failure; existing retry failed same assertion; visitor recovery did not run |
| Corrected focused E2E | d3ff898:one representative-role desktop test passed/7.5s, retries0, fresh owned3157; scoped lint/diff check passed |
| Final Nightlya40 | SUCCESS37675841502:322 passed/one flaky/19 intentional skips,11.7min; existing retry passed mobile company-register navigation; visitor recovery18 passed/26.9s |
| Zapier | Narrow generated dev-lock brace-expansion5.0.12/source-map-js1.2.2 within existing ranges. Node22 CI-parity install/test19/schema/audit-low passed, zero audit findings; protected CI and exacta40 Nightly Zapier passed. No runtime activation. |

No retries/skips/projects/order/assertions were weakened. Fresh standalone ownership from PR216 remains enforced. The final Nightly used its already-existing retry for one mobile company-register test: the first attempt stayed on `/companies/new` beyond the5-second expected company-created redirect; retry passed, and Chromium passed. Independent read-only comparison confirms the direct creation form/action/schema/demo lifecycle/test/auth fixture/configuration are unchanged from baselinecccd272; the recovery cancellation path is not executed by this synchronous demo creation. No candidate-created regression is demonstrated. The exact initial failure cause is unproven, and this is not a clean no-retry run. An initial local E2E launch lacked the pinned Chromium shell, was stopped and retained as launch-aborted; browser installation changed no source. One prematurely started unit run was stopped after the typecheck failure and is not counted as a pass. GitHub runner media were unavailable because the workflow uploads no artifacts (final run artifacts count0); no unavailable trace inspection is claimed.

App/server/migration/test sources matched between testedc7c48e6 and core candidate except the narrow verified Zapier dev-lock patch. PR218 changes only the stale URL expectation, so unchanged application evidence is reusable. The repository's required broad final Nightly completed once on exacta40, including its browser gate; no duplicate full suite was launched locally after PR218.

## Backups, installed configuration and rollback

- Pre-change encrypted artifact: `/var/lib/axora-production/reset-backups/axora-reset-20261007T175617Z-cccd272be606.tar.gpg`. AES256/decrypt/isolated240-table/136-migration/uploads restore verified17:56:26Z. Ciphertext SHA256 `4b812fed5e4f0a414db80b4dfc5a49dfd6993ba3b948fa56d2a365350a779bb7`.
- Policy pre-migration backup: `/var/lib/axora-production/backups/axora-20261007T185834Z`.
- Post-deploy encrypted artifact: `/var/lib/axora-production/reset-backups/axora-reset-20261007T190147Z-9392334cf339.tar.gpg`, verified19:01:57Z after isolated240-table/138-migration/files restore. Ciphertext SHA256 `0ab1f47b7d8807fdf6c12687c50e1af811c2e75f53a164ec8b4ed7f03859e3f1`. Source backup `axora-20261007T190148Z`.
- Before trial1, currenta40 encrypted artifact `/var/lib/axora-production/reset-backups/axora-reset-20261007T194607Z-a40a70bef310.tar.gpg`, verified19:46:15Z,240 tables/138 migrations/files; ciphertext SHA256 `14cb647466a8b84f3e6a1d0afe8d3cb3fb6f8d69055863b8e795e494f0be1a79`. Source backup `axora-20261007T194607Z`. No off-device copy is implied.
- No production reset/restore/truncate or volume removal occurred. Disposable restore databases were guarded and removed by their verifier. No off-device backup destination is configured: single-host loss remains a material limitation.
- Current installed sealed release `/var/lib/axora-production/releases/a40a70bef3104d7e08959dfdc6e55a36ba6beb31` matches current state and migration manifest. Existing runtime/controller secrets remain external and persistent. Docker owns restart behavior; no competing daemon added. Only proven email grace20→45s changed in tracked Compose.
- App/five workers replaced during normal core deployment; Caddy container was also recreated by existing deployment procedure, with no Caddy/network/provider source or configuration change. Database/Tunnel/Tailscale DB were not restarted by this task.
- Previous core939 immutable image is locally available and compatible with schema138; its application source is identical to currenta40. Application rollback does not reverse migrations, audited holds, data or external effects. Rolling back farther to the pre-137/138 baseline image blocks its legacy permanent product deletion through revoked raw DELETE and restores its old email failure. Such baseline rollback is containment, not a weakening of grants. Inspect current `previous` before using the existing root rollback script.
- Short operations and rollback instructions: `docs/operations/RUNTIME_RECOVERY.md`; original component evidence: `CONTACT_EMAIL.md`, `REGISTRATION.md`, `PRODUCT_DELETE.md`, `ISSUE_REGISTER.md` in this directory.

## Deferred deliverables and exact blockers

1. Real Contact verification is not ready; no safe provider/recipient evidence can be inferred. Recipient Inbox/spam access unavailable. Historical UNCERTAIN/held backlog requires individual evidence reconciliation, not bulk replay.
2. Original live registration journey/exception and explicitly disposable lifecycle targets are unavailable. No questions are being repeated; no unsafe target is assumed disposable.
3. Final exact-main Nightly/image/deploy passed. Its one existing-retry mobile company-creation flake remains visible with unproven initial failure cause; prior939 Nightly failure also remains recorded.
4. Missing-Wallet/no-logo live fixtures, actual CAM/second driver and real RTL/Malay layout acceptance are absent.
5. PhaseC Add Budget precise error mapping, BranchAdmin UI/server boundary hardening, remaining visual work; PhaseD shared SSE/integrations; PhaseE migration PDF/runbooks remain deferred while core workflow acceptance is not clear.
6. `/home/ashraf/Downloads/Reports/Axora_Server_Migration_Guide.pdf`, `docs/operations/SERVER_MIGRATION.md` and `REBOOT_RECOVERY.md` are not delivered/verified. No destination host supplied or cutover/decommission executed. Whole-host boot remains prohibited/untested.

The deployed fix and green repository/infrastructure gates are useful evidence, not a guarantee of zero future failures or uninterrupted service from a single host. **Final acceptance: BLOCKED until the explicitly unverified core workflows and remaining required deliverables are proven.**
