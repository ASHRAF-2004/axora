# Axora runtime recovery — persistent report

Report date: 2026-10-09, Asia/Kuala_Lumpur. This report distinguishes deployed repairs from workflow acceptance. Earlier component investigation documents retain their original baseline wording; this report is the current status summary.

## Public team intro removal — current candidate, 2026-10-08

Latest request is removal of the public Early Birds/Night Owls chooser, whose
Arabic title is “أيُّ فريق تختار؟”. The scoped candidate unmounts the intro and
its saved-choice counters from EN/AR/MS homepages and removes the homepage-only
visitor snapshot/session dependencies. Existing public content, localization,
profile assigned-team confirmation, authentication/authorization and Contact
verification remain unchanged. Stored visitor history/API/security tests are
retained; no business or visitor records are deleted.

Before change, a separate real headed Chrome guest session rendered the live
saved-choice counters10 (Early6/Night4), in EN and AR. No choice or Contact Send
was pressed. Focused render regression first failed3 localized cases against the
old page, then passed after removal; focused render/visitor-security/SEO/release
isolation checks29PASS. Browser replacement coverage, actual standalone views
and local gates are now complete as detailed below. The protected image build
passed, but the required quality browser gate FAILED as detailed below;
explicit release approval is also absent. This app/test change means earlier exact0040/d82 gates remain
historical evidence, NOT certification of the new candidate. Production remains
d82/bc8/schema139. Merge/deploy requires explicit approval under the latest
repository instruction. Recovery barriers and the closed Contact cap below
remain unchanged.

Verification continuation: application/browser-test commit
`fd934d38358a31e0812fd1863d4999ea5fdc636a` and test-contract correction
`4fb94af443533de9741b3d433309a0382c5d7d09` are local candidates, NOT deployed.
Both Playwright configurations, backend visitor security/cookie/migration tests,
Contact/profile code and existing Cart/gallery assertions remain unchanged.
The retired feature's main coverage changes22→20 executions and recovery18→7;
replacement cases require actual localized content/navigation, zero retired
requests, no counters/scroll lock, keyboard access and recovery/history behavior.
They are feature-contract replacement, not new skips or relaxed unrelated tests.
Independent complete source/E2E review approved the feature removal.

The first full unit gate against fd934d3 FAILED:1,920 passed/49 existing
intentional skips/2 failures/510.67seconds. Failed log SHA256
`1176694c6d3561ecfd12c56f06355840648ba488487efc8acdf5695b2fdebb4c`
is retained. One failure was the obsolete homepage entry in the strict
incomplete-session accessor allowlist; removing only that entry narrows the
test's permitted routes. The other, previously unchanged purge fixture, failed
SQLSTATE23514 `user_permission_overrides_check`; migration036 requires
`ends_at > starts_at`, while096 closes active overrides at the removal time.
The actual failing call's timestamps were not captured. A fresh RAM-only all139
diagnostic reproduced exact-equal start/end rejection and complete transaction
rollback, then verified a positive-interval normal removal. Diagnostic02 log SHA
`f90d76f157a9a6a776d7e89bc445b3b9d11b1e411e555e94db70f0000d303e8e`.
Its first diagnostic stopped before this boundary because the chosen time
preceded actor scopes; it is not a passed reproduction. No live DB/provider call.

The purge test now explicitly represents a pre-existing override with
`starts_at=now()-interval '1 minute'`. Removal time, all erasure/count/audit/
email-reuse/reactivation/Owner-refusal assertions, timeouts, constraints and
production authorization code are unchanged. Actual equal-time or future-start
override deletion is NOT proven fixed by this fixture correction; no production
deletion claim is made. Focused final correction13PASS/4.50seconds/retry0;
earlier unchanged-area focused39PASS and intermediate45PASS are separate runs.
Final lint/type/unit and subsequent ordered gates run on4fb94af; the failed
earlier whole suite is retained, not cleared by focused passes alone.

Local verified gates so far: lint/typecheck PASS; full unit1,922PASS/49 existing
native-only skips/500.54seconds, native49PASS/all139 migrations/forced RLS/
authorization/grants, production build including both pg-cloudflare artifacts,
standalone staging30,373files/15symlinks, standalone runtime2routes/2resources,
and deployment assets35self-hosted files/PASS. Final unit/native/build log SHA256:
`6f9e687436a74e9d979f0b9ab823aa74573fcfc6dfe113d6cebc41d4add1b8c7` /
`dbf7a5c113a1deec2c039a042215f90e22847a6294737329b4f61fcc3d18e838` /
`f81aa9497bbb8e865c8870ec7cbc2c9a093eeb209584ae6803e014c2cf2695ad`.
Focused browser20PASS/24.2seconds + recovery7PASS/8.9seconds, retry0. Their
log SHAs `b7753b96851ee544b33343a5db8accecbc19bbcfd3b54894747fedbfc913a72d` /
`167d77841ad9e20dbfb991a7c773465d58abb6f3a042a656d0b9c690c29eed61`.

Actual new headed Chrome at the production-mode standalone artifact3150 passed
EN/AR/MS,1440px desktop and390px mobile, both real UI theme choices and Arabic
RTL. Root visually reviewed twelve ready homepage captures plus one EN footer
capture; the initial mobile EN footer is not represented as a hero capture
(the separately named `standalone-en-mobile-hero-light.png` is the actual hero).
The chooser/counters are absent; observed retired requests0, overflow0 and body
scroll unlocked. Real keyboard Tab→skip link/Enter→main focus and refresh passed.
Final console read0 errors/warnings. No Contact navigation/field entry/Send here.
CLI-owned browser and3150 test process closed; production/recovery containers
untouched. These are actual staging renders, not post-deploy production proof.

The first required combined suite on4fb94af completed EXIT1:349PASS/19 existing
skips/one FAILED public-i18n keyboard case/one FLAKY mobile gallery case/9.5min.
It used `CI=true`, fresh owned standalone and the existing one-retry CI policy
(no retry/config changes). The keyboard case failed its obsolete positive
retired-counter expectation on both initial and existing retry. Gallery failed
the unchanged15second article-count assertion with0 rather than2; its existing
retry passed. Recovery did NOT run because the main-command failure stops `&&`.
This is not a green combined result. Complete log SHA256
`9706de7d82fca67b6049487e2948e4ba52988395e37b40c42ac7a6d3dc501b9c`.

All reports/results and the raw log were archived before subsequent browser
work at private evidence `public-team-removal-failed-9tYNaj`. The actual initial
gallery trace is now available (SHA256
`95f3d9632422d4f8f5ceabb869fce99446a647ff3febaebcd328d75864a65706`),
along with its rendered screenshot (SHA256
`420b7d12852c20e7d7ff8910c77d48f806624e55cea96d1a260853c2410be529`).
Root viewed that first-failure page: selected files2, uploaded0/8, empty Manage
gallery. This closes the missing-first-failure-artifact gap, NOT gallery
instability. Actual trace/network/render causality is being investigated; no
speculative application repair or production mutation has been made.

Recursive review found just one remaining positive counter assertion. Its file
now removes only the retired visitor stub and requires visible actual EN H1 +
chooser/counter absence; every following Tab/focus/language/login/menu assertion
and both existing mobile-duplicate skips remain. Independent final diff review
approved this contract correction. Focused public-i18n26PASS/2 existing skips/
14.5seconds; log SHA256
`096881d5002d5a428122c54ade5b0d41063b5f7a24c21f87c0235e647f3e8251`.
No Contact Send or assertion/config weakening. The later combined result is
recorded below; earlier4fb source gates do not by themselves certify later test bytes.

Test-only observability/remaining homepage keyboard correction is committed as
`9a8cc53de8bfbd30243eda9f10f2a774b3c87631`. Application, database, unit tests,
both Playwright configs, package/lock and Next config bytes are identical to4fb;
its successful unit/native/build/stage/assets results remain unchanged-source
evidence, not a fabricated rerun. Current browser-test lint/typecheck PASS;
independent review required and verified noninterference corrections: optional
startup/reporting failure cannot replace an original assertion, callback data
is runtime-whitelisted, cleanup is guaranteed and observer bridge rejections
are consumed. Original product journey operations,60s overall/15s operation
timeouts, all assertions and existing retries are exact (`git diff -w`).

The observer retains at most64 same-origin recognized product requests and64
gallery-count states, without headers, query strings, multipart, raw Flight,
cookies/storage or credentials. `revalidated` is only header PRESENCE, not a
claim of completed invalidation; `receivedBytes` is CDP dataLength, not encoded
wire size. Failure-only safe attachment/log preserves facts even if an existing
retry makes the overall run green. It intercepts or mutates no network/DOM state.

Earlier focused diagnostic2PASS/6.3s is separate. The final focused case then
completed EXIT0 with desktopPASS and mobileINITIALFAIL/existing-retryPASS,
1.3min: creation response200/revalidated-header present/17,832received bytes/
Network.loadingFinished, but route remained `/products/new` for15seconds and
actual Create button remained disabled. No upload/edit request was reached.
Root reviewed its actual screenshot; this is a distinct creation-transition
failure, not proof that gallery repaired. Log SHA256
`485b75febb5b2c62c922129046e4535583d25b9fdfe74621a2d24bfc5d2cf27d`;
actual first-failure trace SHA256
`72f29195050c96e9ecb59be126dafd20ae4e0ac9a7c8aaf52c7265f14b81c63e`,
recoverably archived at private `public-team-action-failed-CVWhJg` before any
new run.

The required original `CI=true npm run test:e2e` completed on9a8cc53 with
fresh owned standalone servers and unchanged configurations: main349PASS/
19existing intentional skips/TWO FLAKY/9.7minutes; recovery7PASS/9.3seconds;
combined EXIT0. The two initial failures were desktop gallery0/2 after upload
and mobile creation remaining on `/products/new`; each existing one-retry CI
attempt passed. This is NOT351 clean passes and neither failure is repaired
by that exit code. No application/test source changed during this run.
Complete log SHA256
`031a2d7b5f630979812f1960dac989d42baa74dc9565a43dbe164e54033f4184`.
All main/recovery results, reports and raw log are recoverably archived at
private `public-team-required-9a8-RXEBYD` before further browser work. Actual
desktop/mobile first-failure traces respectively have SHA256
`7813292a3424ba323ec313dda5c8b8c8795d60f8c4efe54db3a828301cd4e49d` /
`f909a0c35c7140cdbe472aef3c76a63081dab262c8d0394ad355c7fb171de7fd`.

The desktop upload completed its HTTP response, with26,673 CDP dataLength
bytes and Network.loadingFinished; both new image resources returned200, yet
the observed gallery never committed two articles. The separate focused
creation failure also had a complete valid success response/destination but
the form stayed pending without editor navigation. These establish client
action/route-completion failures in these demo-mode occurrences, not an
unfinished HTTP response; they are not production durable-write evidence.
The precise internal React/Next queue/cache
race is still unproven. A supported native server-redirect alternative is
being implemented in a separate candidate/worktree, with submitted-draft
cleanup and error/draft preservation; it has NOT repaired or deployed anything
yet. The public-removal candidate remains unchanged and independently releasable
only after its protected CI and explicit merge/deploy approval.

### PR221 exact-candidate CI — 2026-10-08 17:10 UTC

Candidate `1990ad6b71fe6d2bdc78b2685be731214e49e555` is pushed in
[PR221](https://github.com/ASHRAF-2004/axora/pull/221), NOT merged/deployed.
Its reviewed tree equals the preceding e70ebb1 tree; main-history alignment
introduces no new application or test bytes. Independent review confirms the
only application delta from protected main is the38-line localized-homepage
chooser/snapshot removal. Authenticated team/profile gates, permissions,
financial/domain code, migrations and infrastructure are unchanged.

[Image CI37810901425](https://github.com/ASHRAF-2004/axora/actions/runs/37810901425)
passed; deployment was correctly skipped for the PR. Required exact-candidate
[quality37810933862](https://github.com/ASHRAF-2004/axora/actions/runs/37810933862)
passed lint/typecheck, unit1,922/49 existing native-only skips, native49/all139,
build/pg-cloudflare and standalone staging/runtime. Its original browser suite
FAILED:350PASS/19 existing skips/ONE desktop Company Administrator foundation
failure/14.8min. The file's existing retries0 prevents replay of these financial
and tenant mutations; it was not changed. Visitor recovery did NOT run after
main failure. There is no green-CI or release-ready claim.

After Save branch, the original5second URL assertion remained on the branch
edit page, with actual rendered disabled “Saving branch…” and phone controls.
Trace diagnosis is in progress; no increased timeout, retry, skipped test,
speculative application patch or production mutation. Complete log SHA256
`04a04964e04ee36563a91dfac9ca7bee07e1aaee8544b0577f6277f2d88dc730`.
The96-file failed browser artifact was downloaded before expiry into private
`public-chooser-ci-1990-failed-EsWQjO`; GitHub artifact11566896325 zip digest
`6c911a816048e5c1cddc4313eddd3d08d5abf2e055ffd459576e2e13476f94a1`.
Production remains d82/bc8/schema139. Latest repository guidance additionally
requires explicit approval before merge/deploy; the older autonomous-release
instruction does not override it. Contact remains closed at two smoke slots.

## Final closure audit — 2026-10-08 14:48 UTC

**STATUS: DEPLOYED REPAIRS / BLOCKED OVERALL ACCEPTANCE. Not demo-ready.**

Guide publication follow-up: the refreshed dated guide is now published at
`/home/ashraf/Downloads/Reports/Axora_Server_Migration_Guide.pdf`:13pages/
48,566bytes/SHA256
`30cbd5a5c61ab7819f7c06a59d82dcd5b88c8b329bc61e31343690a9f0e7e24e`.
Root inspected every final rendered page; condensed recovery prose/table keeps
the rollback command and its limits together (the rejected14page preview had an
orphan command page). Commands/boundaries unchanged; generator unchanged.
The original12page PDF is recoverably retained in private evidence with its
original SHA99e9210d… . Final PDF text was scanned in RAM for known private
passwords, private keys and unresolved placeholders:0hits; genuine screenshot
provenance remains dated public readiness only. No migration/restore/cutover/
service trial or host action is implied. Current source SHA256:
SERVER_MIGRATION `f975ed0170b02990fc137c5275b78a131c29aee4f9c95e52af8325ee0ea8bcd7`;
REBOOT_RECOVERY `8ccf6b4ad7db51d8e08cafe934b59fbc95fa05ccc2ec9a82899b9fe0127baaca`.

The user's final review requires every original acceptance criterion to be
classified, not an unconditional completion claim from the earlier checkpoint.
Contact B's delivery and actual Inbox receipt remain confirmed; both Contact
slots are consumed. No additional submission, historical-email release or
provider/mailbox retry is permitted or needed.

Fresh protected-main/runtime inspection confirms d82/bc8/schema139; public
readiness/liveness and all sealed migration checksums passed at14:48:39UTC;
the app and all five exact-image workers were independently healthy/restart0/
noOOM at14:48:55UTC. Production checkpoint SHA256
`2bc663f41b63d03f0137a8794142e58ecb48bca71b6ee188e787d8fa13340e88`.
Host boot ID remains
`aaf793bb-7222-4663-8b5a-e84beab01c4b`; no host restart occurred. At that
checkpoint no app/test/migration/configuration change invalidated0040/d82 gates;
the later public-intro removal above requires its own changed-candidate gates.

The prior registration whole-continuation guard was not reached. The prior
isolated product test reloaded BEFORE checking list absence, so it does not
prove immediate removal without a manual refresh. New normal-auth scenarios
using the exact deployed immutable image in a separate fenced database have
started, not rewritten historical results. Current03 normal logins, ONE ordinary
company creation/four-group no-logo overview/Owner pending-setup projection,
ONE normal invitation sent to a RAM-only sink and whole-original-row guards
passed. Its automatically provisioned zero-balance Wallet was not removed to
manufacture a missing-Wallet fixture. Earlier catalog-observer stops performed
no product command. With the corrected private proxy, both catalog observers
passed; continuation03 then stopped on an unclassified edit-page audit read.
The read-only projection confirms ONE already-created owned product
`a23bed0b-656c-4d50-a9e7-f39bd63f300a`, one image/price-history row and no supplier
link or deletion audit. It was not recreated. No fragment take/password setup
or controlled restart has executed in that interrupted workflow.
The SAME company/invitation is retained; no replay/resend/reset.

Original03 stopped on a private checker's unclassified canonical catalog VIEW
audit. A separately reviewed guard now classifies only the exact known-Owner
canonical read; all original rows/hashes still apply. Continuation01 stopped
pre-auth because JavaScript rounded a nanosecond file timestamp; continuation02
pins exact original nanoseconds and stopped before product commands because
the catalog observers had no initial snapshot. A bounded read-only diagnostic
recorded visible/online pages, fallback200 and stream429, but also rejected its
own dashboard-topic instrumentation. These are retained failed evidence runs,
not passed application, lifecycle or restart tests. The new private proxy
correctly forwards downstream cancellation; a bounded read-only diagnostic
then passed with one HTTP200 catalog stream and no429. This is a test-ingress
correction, not a production proxy/connection-limit fix.

### Current-image integrity barrier — actual read-only result14:29:55UTC

The new strict guard reached the complete original-row classification and
anchored hash/link checks, then failed `canonical_temporal_discrepancy_changed`.
The archived baseline has2,326 events/21 canonical verifier invalid entries;
current03 has2,383 events/23. All original21 invalid entries remain; **zero
original events became newly invalid**. The two new invalid entries are the
owned-product commercial-history VIEW and concurrent catalog VIEW, timestamped
`14:12:21.624590Z` and `14:12:21.624573Z`, appended in opposite timestamp order.
The difference is17microseconds. Every hash, predecessor, fork, cycle, root and
head check is valid; all2,383 events are reachable exactly once. No audit or
financial data was rewritten.

The existing migration059 verifier orders by `occurred_at,id`, while the
prepare-event trigger serializes append links under the partition-head lock.
The timestamp is captured before that lock. The observed ordering disagreement
is established; it does not demonstrate hash-chain corruption or identify an
original reported registration/product exception. The canonical verifier is
**not passing**, and the private guard remains unchanged. Parent04 was NOT RUN;
new deletion/setup and whole-flow acceptance stay paused at this actual barrier.
A separately approved audit-ordering/verification repair would need a forward-only
design, native concurrent regression, release gates and migration approval; it
must not rewrite existing history or silently accept the changed count. No such
out-of-scope database repair is deployed or represented as complete here.

Private preflight/result projections SHA256:
`be999e827f9eab5adca7127d3bb176e31ce115cf00fc5f4fbf5728b3510195db` /
`09a2d6235c2bb5decd5e1216d7e8dbafa0239d54086c760869e8e4eaa75e5eb9`.
These are secret-free derived projections of actual tool results, not invented
raw logs. The one remaining idle service trial is assessed independently; a
health/restart result will not clear this whole-workflow guard.

The idle probe02 stopped during read-only preflight, before its start/restart
markers or container action. Diagnostic01 found sequence whole-row conversion
SQLSTATE42809 and malformed private Docker JSON templates (missing the outer
closing brace). Rows227/6,938, all three financial views, files, boot and sink
delivery1/untaken-fragment1 reads passed. Mechanical helper-only corrections
retain every state field, limit and assertion; this is not an application fix,
retry allowance or passed restart. Failed result SHA256
`ab75bc541b1418d156af4d9d1ee1d1e7c9e1f0db6e74acfcd26c8511c826dcff`;
diagnostic SHA256
`65f3d454426972d25ea0c53eac0191bbc67532abec0f2f6fc527cd39a84b9868`.

The mechanically corrected read-only diagnostic02 subsequently passed all
eight components (EXIT0):227 current tables/6,938 rows, nine sequence definitions
and all three sequence state fields, three financial views, copied files, host
boot, exact DB/sink state and sinkdelivery1/untaken-fragment1. Result SHA256
`2b31f492031f66b5223dda8a9a81f3c8cba9a94710af7a13c04c2d62b2fa6969`.
No before-after restart comparison is implied. No container action ever occurred
in these attempts; **one of two controlled restart trials remains unused** and
is reserved for complete affected-workflow acceptance after the audit barrier
is resolved. Corrected trial03/restart02 source is prepared, NOT RUN. Parent04
also remains NOT RUN; no new setup/deletion/propagation result is claimed.

Current03's four exact owned containers remain fenced and bounded, ingress
ports3178–3180 closed, no outbox poller or external provider access. They are
intentionally retained running to preserve the untaken RAM-only disposable
invitation, not forgotten cleanup or production services. Earlier02 resources
are stopped/data retained; unrelated a40 isolation and production are untouched.
No token/session/credential data is exported. Do not stop its sink merely to
clear this warning or recreate/resend fixtures to conceal failed acceptance.

ONE expired-token probe now passes against current application source in fresh
RAM-only PGlite/all139/two grant replays:1PASS/2.83s/retry0. A legitimately
historical newly inserted invitation is rejected as expired by actual app-role
inspection and consumption before hashing/activation;229 complete relation,
sequence and Wallet-view fingerprints are unchanged/provider0/RAMclosed.
The first probe failed before import/tests due Vitest mock-import resolution;
the supported import-only correction preserves that failure and all assertions.
This is isolated expiry evidence, not native/live setup or restart acceptance.
Result SHA256 `8ef71a89f4e6c888e53d36276504a50b1ec28660123e58ab3c21f6fd0e25e935`.

ONE fresh-owned mobile gallery diagnostic retained the original assertions and
timeouts and passed2.3s/retry0; no failure metadata was generated. This does NOT
resolve the CI gallery instability. Original first-failure cause/artifacts remain
open. Exact diagnostic log SHA256
`b037677afb4e7cf17ddf1d00de967075cfc5f35b2992190f8622775e6330afad`.

The missing budget-period distinction now has ONE isolated RAM-only PGlite
characterization:2PASS/2.57s/retry0, canonical139/grants replayed twice. CLOSED
with no ACTIVE successor returns AX003/BUDGET_UNAVAILABLE; complete guarded
Wallet/ledger/period/recurring/command/audit state is unchanged. Elapsed dates
while status remains ACTIVE retain the inherited status-based allocation
contract:one synthetic allocation/command, no Wallet/recurring/period/schedule
or refresh change. This is not date-expiry rejection, native/live proof or a new
financial-policy decision. The old wrong-account expiry claim remains retracted.
Log SHA256 `bb91da1919ec343f40332aa00b027d0d133ebfb89af6e9ddf1c789b9c76c17ee`.

Current guide/role/integration evidence and the per-criterion verdict below
supersede the10:09 "core acceptance passed" wording, qualified
by the isolated/live and restart boundaries, not unconditional demo readiness.

### Original issue register: implementation versus acceptance

| Original item | Passed evidence | Still open / exact boundary |
| --- | --- | --- |
| Deployment/startup/runtime |Deployed polling/grants/cast/readiness/idle57P01 recovery fixes, exact image/schema checks, native/process failure tests; historical a40 idle sender trial; corrected current-image read-only capture8/8. |Current-image trial NOT RUN; one allowance remains reserved for complete affected-workflow acceptance. A clean complete workflow after restart, active-send drain, whole-host boot and off-device recovery are not inferred from health. Host boot is prohibited here. |
| REGISTRATION6A |Cancellation and `$12::timestamptz` defects fixed; native invitation/setup concurrency and company-command replay; RAM expiry1PASS/unchanged229 fingerprints; earlier isolated normal setup/login/used-link; live designated cross-scope duplicate notice/no extra account. |Original reported route/error/request unavailable. Current03 final guard FAIL before setup/restart workflow. No same-tenant duplicate/full HTTP response-loss journey certified. Live valid-input setup needs a named disposable company/new recipient/intended role and permitted setup-delivery action. See REGISTRATION.md's per-criterion matrix. |
| PRODUCT_DELETE6B |Owner-only capability/raw-DENY/history/cart-FK protection; native reference/DENY races, PGlite replay/cleanup rollback; earlier isolated normal owned deletion and protected/CA/DENY refusals. |Original reported exception unavailable. Earlier UI absence was checked after reload. Current03 new product is retained; strict guard stopped before immediate deletion/list/detail and before-after restart workflow. Live destructive acceptance needs an exact eligible disposable UUID, per-action authority and verified recovery plan. See PRODUCT_DELETE.md. |
| 1 Active setup tabs |All six actual Owner routes, Light/Dark/hover/keyboard focus/390px; shared semantic tokens. |No outstanding observed contrast defect. |
| 2 Branch information |Actual Owner/BA grouped rows, aligned metrics, ONE address action, distinct labels; EN/AR RTL/MS desktop/mobile. |No outstanding observed layout/duplicate-label defect. |
| 3 Open wallet |Both actual rows, both themes/hover/focus/mobile. |No outstanding observed contrast defect. |
| 4 Overview/logo |Structured actual reviewed-brand logo plus isolated no-logo placeholder/four sections. |No actual live no-logo fixture exists; do not manufacture one in production. |
| 5 Product details |Actual structured Details/Delivery/authorized Pricing/gallery; Company Admin management-route refusal; automated confidential-data guards. |Live CAM account absent. Gallery upload instability remains OPEN despite retry-pass and bounded diagnostic PASS. |
| 6 Setup Wallet404 |Owner-only pending-state component/authorization tests, actual correct live company Wallet navigation/direct/refresh/history and isolated setup projection. |All live companies already have Wallets; no live absent-persisted-Wallet fixture tested. No Wallet was fabricated/removed or balances changed. |
| 7 Contact/email |ONE B visible success, durable enquiry/outbox, one accepted attempt/provider ID, delivery event/provider GET and actual Inbox receipt confirmed; A reconciliation/cap2. |Original live queued-across-restart scenario not performed. Both slots are consumed; no more Contact sends, historical releases or provider/mailbox retries. A's original submission path/outcome remains unknown. |
| 8 Shared live updates |Bounded authorized transport/reconnect/fallback/dirty-state/native authorization coverage; corrected private proxy's read-only catalog snapshot. |Observer initialization does not prove create/delete propagation. Production business-change fanout and open-stream role/DENY revocation not exercised; requires a controlled owned mutation/revocation fixture, not real business data. |
| 9 Migration guide |Technical runbooks/reproducible illustrated PDF and genuine dated readiness screenshot; verified encrypted local backup/disposable restore. |Guide refresh/render proof below. Future host/off-device destination/key custody/cutover absent; documentation is not a performed move. No host action. |
| 10 Invitation UI |Localized compact UI/token/consent contract; earlier isolated valid setup and native/expiry protections. |Current03 valid-token rendered setup/whole continuation did not execute. No real recipient invitation consumed. |
| 11 Integrations/Slack |Truthful native/disabled-provider UI, enabled API/webhook inventory, disabled Slack/Zapier and exact activation checklist. |Conditional activation only: authorized app/workspace/public channel and protected client/signing secret mounts + app/client IDs absent. Not a core-repair blocker. |
| 12 Add Budget |Typed legitimate ceiling/refusal/current-actor checks; native success/denial; CLOSED/no-ACTIVE period refusal and elapsed-ACTIVE characterization2PASS. |No live allocation authorized/performed; elapsed ACTIVE is not date-expiry rejection or a new financial policy. Controlled live test would need a named company/branch/period and authorized amount. |
| 13 Budgets list |Actual CA six-column responsive keyboard-scroll/BDI/RTL metrics/layout, no document overflow. |No outstanding observed layout defect; no metrics changed. |
| 14 BranchAdmin lifecycle |Migration139 hard ceiling/UI/direct/native custom-GRANT/raw denial; actual BA operational metadata retained/no lifecycle controls. |No destructive live branch action; native isolated authority proof is not live deletion/deactivation. |

**Original-problem verdict:** ordinary Contact delivery and the observed UI/Cart
defects are resolved with deployed evidence. Identified registration/product
defects are repaired and have focused/native/earlier isolated coverage, but the
original reported workflows cannot be declared fully resolved without the
missing original-case and complete current/live lifecycle acceptance. All
required gates are not closed; **overall demo-ready is NOT certified**. Optional
Slack activation and future migration inputs are not presented as blockers to
the independently deployed core fixes.

## Historical Contact closure checkpoint — 2026-10-08 10:09 UTC

**STATUS: DEPLOYED / CONTACT B LIVE-VERIFIED, including actual mailbox receipt.**
This checkpoint does not certify the unobserved registration/deletion live
scenarios or queued-across-restart Contact case. The previous Contact pause below is superseded by the new
explicit authorization for one controlled B and the evidence here; A's earlier
manual Send/result remains unproven, not retrospectively rewritten.

Production remains `d82a3bb4785e6ba7b7e4e7ec125636a6368f699f`, immutable
OCI `bc8c29336bdf44ef9c01096bf957c67ec5e58986548074ba5204d7b688d07bf8`,
migration139. The exact0040 tested/deployed-tree equivalence, required green
gates, actual six-UI/role checks, stale-Cart repair, bounded live duplicate
refusal and distinctly isolated registration/product-deletion evidence below
remain valid. Repository source changes in this continuation are report-only;
the authorized B created the documented Contact/email records and private
evidence. No application/test/config/migration code changed; no costly full suite was invalidated
or rerun. The gallery retry remains disclosed/unproven, not relabelled fixed.

### Contact A reconciliation and one controlled B

Fresh09:42 and09:56 READ ONLY checks found no A/B or other recent persisted
Contact submission, notification/outbox/provider ID, due send or active lease.
Current-container redacted failure logs had0 matching events, but cannot
reconstruct logs before the03:31 container replacement. A conservatively
continued to count1; its absence did not restore the two-smoke allowance.
All eight historical jobs remained PENDING/Infinity/attempt0/no lease/provider.
The configured notification destination matched the requested recipient.

The computer-use inventory exposed no surfaces, and the pre-existing Brave
windows had no accessible debugging connection. A separate Brave launch failed
sandbox configuration before opening Contact; the supported Snap test window
opened but Cloudflare600010 disabled Send. It generated0 Contact POSTs/no send
reservation and was later closed with its exact owned child exit confirmed;
private0700 profiles were retained, not exported. No sandbox/fingerprint/UA
control, test verification key, callback, CAPTCHA click or security bypass was
used. Neither failed preparatory approach was a Contact submission.

At the user's explicit request to control the existing open Brave with the
cursor, the supported desktop fallback focused only window31457284/PID967564
and opened a new public Contact tab without changing existing tabs. Normal
verification visibly succeeded without any CAPTCHA interaction. The actual
desktop cursor/keyboard filled fixed B name/message, the requested email,
published Axora phone and privacy consent. A private form-only screenshot
verified those fields, consent and verification success before Send.

The fresh10:02:10Z pre-click snapshot again verified exact A/B0, idle queues and
unchanged historical holds. The two-slot ledger and shared exclusive/fsynced
latch were written before ONE physical Send-button click at10:03:39.089Z
(18:03:39.089 Asia/Kuala_Lumpur, UTC+08:00). No retries, A replay, B replay,
historical release or additional message send. Total counted slots are now2.
The preparatory03 attach-only helper was never run.

### Separately proven delivery stages

| Stage | Actual B evidence |
| --- | --- |
| Visible submission result | Existing Brave showed “Thank you! Your enquiry has been recorded and Axora will follow up.” Fields reset; success banner captured. |
| Persisted request/enquiry | `7378a4d9-7444-44e5-8ba4-84899a6f4f75`, created `2026-10-08T10:03:39.224Z`; exactlyONE B, notification state NOTIFIED. |
| Notification outbox | `81857ccc-87fd-45b0-9f9d-8392f54175e3`; SENT `10:03:49.607496Z`; one attempt row/accepted attempt/distinct accepted provider ID, no lease. No acknowledgement outbox; CANCELLED acknowledgement preserves existing behavior. |
| Provider acceptance | Recorded provider ID `01a11af8-1832-70f3-901a-e80fee949b45` and one accepted attempt/MESSAGE_SUBMITTED event. Raw POST response was not recorded; no invented original HTTP code/body. |
| Provider read-only response | ONE bound [Resend GET](https://resend.com/docs/api-reference/emails/retrieve-email) at `10:05:34.973Z`: HTTP200, matching ID/subject/recipient, `last_event: delivered`. No send/list/replay or provider retry. |
| Delivery event | ONE stored MESSAGE_DELIVERED event at `10:03:51.633Z`; the ingestion route verifies the Svix raw-body signature before normalization/persistence. Signature-verifying source path and actual event are evidence, not a newly fabricated payload or reverified saved raw signature. |
| Actual mailbox receipt | User explicitly confirmed receipt. With the user's further permission, Gmail's matching-recipient profile and exact B+subject search returned ONE message `1a11af8219b1b180`; metadata places it in INBOX, not Spam/Trash, received `10:03:50Z` /18:03:50 Malaysia. Subject/To/Delivered-To match; B reference is in the snippet. No full MIME body/attachment/unrelated mail was fetched, and no mailbox mutation. |

Subject: **New Axora website enquiry**. Body/name reference:
**AXORA-RECOVERY-20261008-B**. Enquiry UUID above is the persisted request-record
ID, not an invented browser transport/Cloudflare request ID. Browser POST
headers/body/transport ID were not captured in the ordinary native window;
the visible result and exact durable/provider/mailbox correlation are captured.

Post-send READ ONLY comparison found all eight historical job guard records
identical to preflight, excluding observation time; A0 and exactlyONE new B/
notification1. Queue/agent-control/suppression state remained unchanged. These
are point-in-time acceptance proofs, not a guarantee of future exactly-once
delivery. No real product/history deletion, financial transaction, role change,
service/container restart or host shutdown/reboot/restart occurred in this pass.
The private credential input and unrelated working trees remain intact.

Private evidence SHA256: pre-click `702667f66f30c0d00bedb25ff6d48c519bd9991e91bff77720d7c639aeeeda57`;
shared/native latch `fac7f4efe7789a4243bfc65217b35c60e7acc56a761ed7d98a15d64b25f19436`;
prepared/result images `02501b64ed1d8729581b51d78d86f0351829f9cebbe7c6820404e7ea6f24c358` /
`1b82c06a900546bc77784ff60c3c13ee4e8916111a7f9dac1c6d5e30fb9d77b5`;
post-send metadata `8b8a9d3a7de6a86360e324515c1ceaf3d43202a49bb63e8f4c3a733d4a29bd48`;
provider response `b0b9f1779364fca34cec88b1216e88aa4f628172d635e560adf8c33cb8179731`;
Gmail projection `f6f071a202ece114c62fcdc56184b1bed680cf6cb96c009e7ab844ec77d187dc`.
Files remain private/outside Git; authorized authentication/provider secrets were
handled in memory, never printed or included in exported evidence logs/reports/images. Private browser
profiles are retained browser data, not exported evidence. The existing user's
Brave/new success tab remains
available; only root-owned separate test processes were closed.

No remaining input is needed for ordinary Contact delivery. The original live
queued-across-restart Contact scenario was not performed and cannot be retried
within the closed cap. The original isolated whole-flow integrity/current-image
restart gaps are required acceptance gaps, being investigated independently;
they are not optional enhancements. Actual CAM/second Driver/live negative-state
fixtures and missing first-failure gallery evidence remain separate limitations.
Controlled Slack activation inputs and off-device/future-host access block only
those conditional provider or future operations, not deployment of independent
core repairs. Nothing in this checkpoint certifies unobserved acceptance.

## Historical execution checkpoint — 2026-10-08 03:50 UTC (superseded)

**STATUS: DEPLOYED REPAIRS / BLOCKED CONTACT ACCEPTANCE. Not demo-ready.**

PR [220](https://github.com/ASHRAF-2004/axora/pull/220) was squash merged at
03:26:29Z under the standing release authorization. Protected main and deployed
SHA are `d82a3bb4785e6ba7b7e4e7ec125636a6368f699f`. OCI is
`ghcr.io/ashraf-2004/axora@sha256:bc8c29336bdf44ef9c01096bf957c67ec5e58986548074ba5204d7b688d07bf8`.
Migration remains `139_branch_lifecycle_authority_and_budget_refusals.sql`;
all139 sealed-release/ledger checksums match and migration-status returns `none`.
Follow-up before-state was c3/OCI24f/schema139, recorded below. Previous c3
release is retained for rollback. This checkpoint is report-only work after
deployment, not a claim that these later report edits are in the deployed image.

### Exact candidate, gates and release

The tested final candidate is `0040bebcdf1f9e1246942d7623824c5fa3894228`.
Its committed tree equals the d82 squash-merge tree. Application source remains
f09: six Contact-feedback CSS lines and stronger assertions in the same six
existing localized browser cases. Subsequent0040 changes are failure-only
public-demo artifact retention, its invariant and evidence documents. No
financial model, Wallet/budget accounting, pricing permissions, authentication,
tenant/RLS controls, production infrastructure configuration, test order/projects,
assertion weakening, new retries or new skips were introduced in this follow-up.
Independent code review and the115-file supplied-password scan passed.

| Gate | Final evidence |
| --- | --- |
| Focused | Cart100/seven files and Contact28/two files plus original localized Contact6 pass; old Cart authority-mismatch and old Contact20px overflow RED proofs retained. Retention/isolation3 pass. |
| Lint / typecheck | Local final source and exact0040 [Nightly37720771405](https://github.com/ASHRAF-2004/axora/actions/runs/37720771405) both pass. |
| Unit / PGlite | Exact0040:1,915 passed/49 existing native-only skips;376 passed files/11 skipped. The added retention invariant explains1914→1915. |
| Native PostgreSQL |49 tests/11 files pass; all139 migrations, deployment replay, forced RLS, authorization lifecycle and grants verified. |
| Build / staging / runtime | Exact0040 build passes;98 static pages,30,401 staged files/15 symlinks;two routes/two resources validate. Required pg-cloudflare standalone files present. |
| Deployment assets | Final application f09 local gate:35 assets/7,996,414 bytes and Compose/Caddy/secrets invariants pass. No application/build/production deployment config change afterward. |
| Original full E2E | Final local f09:353 passed/19 existing skips, retry0; visitor18 passed. Exact0040 Nightly:352 passed/19 skips/ONE flaky retry-pass in10.0min; visitor18 passed23.2s. Full original mobile stale-Cart/direct-purchase and all six Contact cases pass, not merely an isolated diagnostic. |
| Protected image CI | Exact0040 [37720646333](https://github.com/ASHRAF-2004/axora/actions/runs/37720646333) success. |
| Merged-main image / deployment | Exactd82 [37722734699](https://github.com/ASHRAF-2004/axora/actions/runs/37722734699) success; controller deployment success03:31:13Z. App and all five workers use the exact above OCI/revision; healthy, restart0, no OOM. |
| Health / migration | Independent local/public HTTPS, redirect, security headers, liveness and DB readiness pass; final health03:47Z and migration-status `none`. DB/Tunnel/Tailscale-DB containers unchanged. |
| Backup policy | Controller confirmed matching139 ledger and skipped deployment backup/migration runner. Existing verified pre139 encrypted backup/disposable-restore proof and automatic01:38 backup remain; no new backup/restore is claimed. |

Final exact0040 complete private CI log SHA256
`34bcb64a3c39a9edf044d0988aa3cd6a1ee421779fb32e41d701e72a01999e61`;
d82 main image/deployment log
`fdf1bf9e69322485291933c605ad5f039d7a1ed7250cd74da73d4a5abe2cd4da`;
final independent health log
`0190271c0fc6619fc7e49b7e9702f3301f7d66840e23ee0a340b538e2b191eea`.
The controller's ordinary retention policy pruned obsolete generated release
`cccd272be606cb2d05bd0f097cd725427506fb45`; its source remains recoverable in
Git. No business data/uploads/backup was removed; previous c3 remains retained.
No computer shutdown, reboot or host restart occurred.

### Retries, skips and the still-unproven gallery instability

The49 skipped unit cases execute/pass in native PostgreSQL. The19 browser skips
are existing viewport/matrix/disabled opt-in cases. Existing CI global retry1
and financially sensitive journeys' retry0 are unchanged; no failing assertion
was removed, softened or skipped. Repository policy does not configure a
zero-flaky rule, and the final quality command exited0. It is NOT a clean
353-first-attempt CI pass.

Final0040 mobile product-gallery creation again initially observed an upload
next-action response HTTP<400, then expected2 gallery articles but received0 at
150. Its existing retry passed. Earlierd8 both-attempt gallery failure and
branch-create failure remain FAILED evidence, not relabelled fixed. Current0040
mobile foundation passes with retries0, but that does not prove the prior cause.
Separate fresh-owned/process-only2CPU focused product and foundation journeys
passed58.3s/10.0s without retry; these are supported diagnostics, not identical
GitHub runner reproduction or a substitute for a combined gate.

Source tracing excludes the proposed shared-live refresh on those routes and
file-input restoration by the draft manager. HTTP<400 alone is not upload
success evidence. Exact failing multipart/matched response/Flight/server-image
count/DOM evidence is still missing; no speculative application patch or
invented root cause is claimed. Failure-artifact upload was SKIPPED because the
final job succeeded; runner artifacts remain0, and the first-attempt trace was
not inspected. This remains an open diagnostic limitation, not a hidden failure
or an optional feature represented as a core blocker.

### Actual post-deploy production acceptance

Normal headed Chrome used current authorized accounts and real authentication.
The computer-use inventory exposed no enabled browser, so the explicitly
authorized terminal/real-browser fallback was used. No fabricated session,
saved auth, authentication screenshot, HAR, trace or CAPTCHA bypass. Ordinary
auth/profile timestamps and explicitly tested appearance/locale writes are
excluded from no-business-mutation claims. Owner English/Light was restored;
all owned contexts/browser closed. Initial image-loading/session-skeleton and
pre-commit empty-heading reads are retained but excluded from acceptance; final
loaded/visible states were inspected separately.

| Item | Actual d82 result / boundary |
| --- | --- |
| 1 Active setup tabs |All six company routes clicked in both themes. White text; Light normal13.2/hover15.17 and Dark4.83/5.81 contrast. Keyboard focus3px; mobile44px tabs fit/navigate. Disabled link state not applicable. |
| 2 Branch information |Existing openai branch:four General/address/contact/delivery groups, distinct Location confirmation label, exactlyONE Edit delivery address, three aligned Budget values. Owner13/BranchAdmin12 label-value rows; desktop/390px readable and no document overflow. Actual EN/AR RTL/MS labels and wrapping visually checked. |
| 3 Open wallet |Both actual company rows readable in both themes with the same above contrast, hover and3px keyboard focus. Mobile281×44px actions contained. No financial action ran. |
| 4 Company overview |mewo1/C-107 has identity/business/contact/setup panels and its actual reviewed-brand logo loaded. Light desktop, Dark390px and Arabic RTL390px inspected. No live no-logo fixture exists; no-logo placeholder remains isolated/automated evidence. |
| 5 Product information |Actual A3Paper:Product details/Delivery/Authorized pricing, eight rows, stronger labels/values and loaded gallery; Light desktop/Dark390px/Arabic structure fit. Owner cost is authorized. Actual Company Admin direct management route renders404/no pricing rows (Next streamed HTTP200); CAM pricing guards pass automated checks, but no actual CAM account was supplied. |
| 6 Setup Wallet |Continue setup→Wallet and budgets reaches `/companies/4b5f72eb-303a-4df0-a8fa-f078a97ce0bd/wallet`, correct mewo1 company200/no404. Direct URL, refresh, Back to Wallet and Forward to Documents checked after visible navigation waits. All live companies already have Wallets; absent-Wallet owner-only pending state remains non-live coverage. No Wallet fabricated or balance command used. |
| Company Administrator |Current malaysiaashrafo account is verified active/company-scoped with one canonical COMPANY_ADMIN assignment. Unselected Shopping chooser, selected CYBERJAYA-01 Shopping, existing Cart, company Wallet and Budgets200. Before/after bounded READ ONLY checks confirm exact owned active null-department Cart/authority and all its company carts/items/events unchanged; fingerprints kept only in RAM. Mobile budget region356px/table720px is keyboard-scrollable; document overflow0. No Add/Place/allocation/top-up. |
| Branch Administrator / Delivery |Current shehab Branch Administrator sees retained Edit branch/four groups/single address action and no lifecycle/delete controls. Current alsaloulashraf Delivery Agent portal200/assigned-deliveries and available-jobs navigation fits390px. No claim, location, availability or delivery workflow action. |
| Other original authorized items |Delivered code/documents for8/9/10/11/12/13/14 remain unchanged. Transport/reconnect is not business-change propagation or open-stream revocation proof; native budget/branch denial is not a live allocation/deactivation trial; a delivered guide/disabled Slack checklist is not cutover/provider activation. Compact invitation UI and actual budget table checks are separately evidenced. See the final per-item matrix rather than infer completion from implementation or health. |

Private browser05 log SHA256
`50867a8b6024737716015a6be4cf657bba114eb2ee93d811a7e4d5bc4eaf5601`;
reviewed private helper05 SHA256
`3711c64da76f936fecaf348d83b159027ee8ac4725e65e61d7a4b04b17e03577`.
Actual rendered evidence is private, outside Git; ready BranchAdmin and budget
images SHA256 `810d6dcf4fd6e909e7c71e07305026c1f5e61a48513d77b9036f163c52b8b958`
and `5832276f2403bcd5f280be2f63db31b315361c48c760500b8152bf56f82669e3`.
The UI/UX approach preserved the existing visual language and used only scoped
reflow; no global redesign was introduced.

### Historical core acceptance / Contact pause — superseded at 10:09 UTC

Do not follow the earlier Contact action instructions in this subsection.
Contact B is now delivered and received; A1+B1 consumes the cap of two. No
further Send, A/B replay, provider retry or historical-email release is allowed.
The historical failure and missing-A evidence below remain preserved.

**Contact A:** fresh03:35:40Z READ ONLY metadata finds A/B enquiries,
notification/acknowledgement outboxes and ALL submissions/notifications since
reservation0. Eight historical Infinity-held jobs remain unchanged, attempt0/no
lease/no provider ID; queues idle and six controls unpaused/revision1. Logs:
`7202a12213e738c4ad4f8923b0b589e4ca88db40238bf96c24fb407da7205b44` /
`ef4c5cf6db508347d0e6be5e8d868d617774673feccb63c91df494a70f583dc3`.
The current configured notification destination matches the connected recipient
mailbox (closed booleans only). Its03:36:04Z exact-A search including Spam/Trash
returns0 IDs/no next page. There is no A provider ID to look up; provider
acceptance, signed delivery and actual mailbox receipt are each **UNPROVEN**.

Trace: native validity/client verification → server privacy/honeypot/Siteverify
and schema/rate checks → atomic enquiry+notification outbox → leased worker/
attempt → stable provider idempotency/accepted ID → verified signed delivery
event → actual mailbox receipt. No durable enquiry means no A job for a worker
to send. It does NOT prove no Brave POST: pre-submit validity/verification or
pre-commit validation/refusal/honeypot paths could leave no rows. Which path A
took remains unknown without the prior user's Send/result/time evidence.
Cloudflare identifies600-series errors as generic challenge failures, with
browser/network/configuration possibilities; this does not prove an obsolete
Tunnel-version cause. See the official [error reference](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/)
and [challenge troubleshooting](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/).
No Cloudflare controls/configuration were changed or bypassed.

Passive actual d82 Malay Contact at390px:200, no document overflow, all six
new CSS rules loaded, Send disabled, no natural feedback error appeared. No
field/challenge token read, callback/reset/fill/Send used. This verifies deployed
styles, not actual production error-panel or submission acceptance. All six
localized error-panel render cases pass the original required combined suite.

**Exact user action needed:** say whether the earlier Brave attempt only
completed verification or also pressed Send; if Send, provide its visible
result and approximate time. **Do not submit again yet.** A conservatively
counts1 of the two labelled live-smoke limit; B is unused. There was no new Send,
provider send/lookup or historical replay. Only after that reconciliation may a
bounded ordinary manual submission, if appropriate within the original limit,
complete the missing chain. The prepared passive observer remains NOT RUN.

**Designated duplicate:** ONE prior actual Owner form submission using
adoashraf103 reached `/users?notice=user-account-exists`; all four identity/
authority/account/invitation/selected-finance/files after-guards passed, no
duplicate created. Original notice checker EXIT1 remains preserved; later
GET-only capture shows the actual canonical visible refusal. No second POST
was made. Live cross-scope refusal is evidenced; original same-tenant/whole-
continuation certification is not invented.

**Registration and product deletion:** valid invitation/password setup/login/
used-link refusal and eligible owned product deletion/audit/refresh plus
protected-history/Company Admin/DENY refusals remain actual authenticated
isolated-environment proofs, not live production account creation/deletion.
No real product or business history was deleted. Existing isolated guards and
the original whole-flow limitations remain documented below.

Other precise dependencies are not blockers to the deployed core repairs:
actual CAM/second Driver accounts for those live role checks; an existing
no-logo/absent-Wallet company for live negative-state checks; controlled Slack
app/workspace/channel/dedicated private inputs for activation; off-device backup
destination/future-host access for resilience/cutover proof. The12-page migration
guide and runbooks are delivered; no host restart test is permitted. Private
credential input remains available and unchanged, passwords absent from source/
logs/artifacts/commits, and unrelated working trees remain intact.

## Historical execution checkpoint — 2026-10-08 02:57 UTC (superseded)

**STATUS: BLOCKED FOLLOW-UP RELEASE / CONTACT ACCEPTANCE. Not demo-ready.**

Production remains c3/OCI24f/schema139. PR220 exact head
`d8e7e080e7865f18efb395d0a965707384860dbe` protected image CI
[37718133500](https://github.com/ASHRAF-2004/axora/actions/runs/37718133500)
passed, but its exact-head Nightly
[37718133148](https://github.com/ASHRAF-2004/axora/actions/runs/37718133148)
**FAILED**. No merge or follow-up deployment occurred. Lint/typecheck,
unit1,914+49 native-only skips, native49/all139 migrations, build/staging/runtime
and Zapier package/schema/audit passed. Browser result350 passed/19 existing skips/
one existing-retry flaky Owner-company creation/2 failed in12.9min; visitor
configuration NOT RUN after the first configuration failed. All six Contact
recovery cases and both-project direct-purchase/Cart cases passed in this CI run.
This does not make the overall required browser gate green.

The mobile foundation failure is branch creation, BEFORE any budget command:
after confirmed location and Create branch it remained `/branches/new`; the
original15s redirect assertion failed at123. Mobile product creation reached
its edit route, then observed an upload next-action response HTTP<400 but gallery
article count remained0 instead of2 at150, on both initial attempt and existing
retry. Owner company creation's first30s navigation wait timed out and its
existing retry passed. Root causes of these failures are not yet proven or
labelled baseline flakiness. Full private CI log SHA256
`2764ae55f8ad98e622ce70a151a91deff0f0bb208b193236d86effa8bf940b71`.
Artifact API reports0; unavailable runner images/traces were not inspected.

Independent focused diagnosis is proceeding against fresh standalone/demo state,
without production writes, added retries, assertion weakening or blind full-run
repetition. A31-line test/release-only pending change retains failed public-demo
browser outputs for7 days with an official SHA-pinned
[upload action](https://github.com/actions/upload-artifact/blob/v4.6.2/README.md).
The original full command/exit behavior is unchanged, hidden files excluded and
no host/production/private evidence uploaded. Focused isolation/retention tests:
3 passed; lint/diff check pass;115-file supplied-password scan0 matches. This
observability fix is NOT represented as a repair of either application failure.

An ordinary headed Owner session passively viewed the c3 Malay Contact page at
390px:200, widget container present, Send disabled, document overflow0, no
natural feedback error rendered. No field values, challenge token, callback,
reset or Submit used. Owner saved locale English/Light remained intact and
owned context/browser closed. This is not actual recovery-panel acceptance or
Contact submission proof. The earlier linked live duplicate and shared-live
evidence below remains valid. Contact A still requires prior-Brave Send/result/
time reconciliation; cap A1/Bunused, no new Send or historical replay.

### Continuation — 2026-10-08 03:10 UTC

Follow-up head `0040bebcdf1f9e1246942d7623824c5fa3894228` commits the
failure-evidence retention/invariant and preserves the failed d8 report. No app
change from f09. Protected image CI37720646333 passed. Evidence-enabled exact-head
Nightly37720771405 is RUNNING: lint/typecheck/unit/native passed, build/browser
completion still required. No merge/deploy or passing-suite claim yet.

Supported focused alternatives: ONE original mobile product journey, CI=true,
fresh-owned standalone and process-only CPUs0,1, passed in58.3s without retry;
ONE original mobile foundation journey passed in10.0s, retries0/trace retained,
including its later budget steps. These are resource-constrained diagnostics,
not identical GitHub runners or substitutes for the failed combined gate.
An initial foundation CLI selection matched no tests and performed no journey;
its log is retained separately. Product successful-run raw log was not saved;
tool completion and private output artifacts exist, no invented log hash.
Both diagnostic servers closed. Source tracing rules out the proposed shared-live
refresh path: neither failing edit/create route mounts that sync. No speculative
application fix is justified before actual failing action/DOM/Flight evidence.

Fresh read-only Contact03:06:04Z still finds A/B and all submissions/notification
outboxes since reservation0; eight historical holds/attempts/queues/controls
unchanged. Metadata/recent log SHA256
`69a8b425dd610f79f0f8b716e331e698f75e5e357ffecee6646e9dc1d98f137c` /
`ee41b505257f96e4f675de6304be740661f51b084ce46d1aba2f84313fbb7529`.
Fresh connected-recipient Gmail03:06:37Z exact-A anywhere search again returned
0 IDs/no next page. No provider lookup without an A provider ID; acceptance,
signed delivery and mailbox receipt remain unproven. A1/Bunused/no Submit,
verification reset or historical replay; prior-Brave reconciliation still needed.

## Historical execution checkpoint — 2026-10-08 02:25 UTC (superseded)

**STATUS: DEPLOYED REPAIRS / BLOCKED CONTACT ACCEPTANCE. Not demo-ready.**

Protected main/production remain `c3cd1b248709c8f74b3260b6d0b0c742d8ac0eec`,
OCI `sha256:24f893b439b1ef00835cc8a5a7bdeefe69c6668b24274b3f121cdc12d2d4705c`,
migration139. The scoped follow-up application/test candidate is
`f09ecd3f90213a7bc0ec03e37717f65ebd357329`. Its final local required gate is
green; protected image CI and exact-branch Nightly must pass before follow-up
merge/deployment. The failed merged-main Nightly remains failed evidence, not
overwritten by this local result. Existing deployed six UI fixes, Cart repair,
roles, accounting, authentication, infrastructure and schema are unchanged.

### Required responsive failure: RED, fix and full-suite GREEN

The original c3 Nightly mobile Malay Contact failure was reproduced in the
actual old rendered component at Pixel7 width with a supported wider fallback
font:20px feedback overflow, while document overflow stayed0. Actual CI font
was not recorded. The feedback inherited a non-wrapping flex row, three
min-content children and the shared action block's top padding/border.
Natural host font alone passed and was not accepted as failure resolution.

The only application change is six scoped CSS lines: verification feedback
becomes a shrinkable one-column grid, its paragraphs/actions wrap, the shared
action decoration is removed locally and buttons may wrap. No clipping,
verification changes, new colors, translation changes or broad button changes.
The same six existing EN/AR/MS desktop/mobile cases now run all their original
overflow/control-containment assertions with both natural and wider font
metrics, restoring the font afterward. Retry, expiry, field preservation,
configuration denial, zero POST and Arabic RTL assertions are retained.

Old artifact with strengthened assertions:5 passed/1 failed at the original
mobile Malay20px assertion, retry0; actual RED screenshot/trace/video preserved
at `output/playwright-contact-overflow-red-01`. New exact f09 artifact:
all six focused cases passed in5.0s, retry0, at
`output/playwright-contact-overflow-green-f09-01`; private focused log SHA256
`c73a29144f63dc5ced98da82f28b1b95cc6eaf4a074489503a485674726d47a0`.
Root and independent review approve the strictly visual delta and stronger tests.

| Final local gate | Exact f09 result |
| --- | --- |
| Focused |28 Vitest cases/two files and six localized rendered Contact cases pass. |
| Lint / typecheck |Both EXIT0. |
| Unit / PGlite |1,914 passed/49 existing native-only skips;376 passed files/11 skipped. |
| Native PostgreSQL |All49 tests/11 files pass; all139 migrations/replay/RLS/grants/lifecycle verified. |
| Build |EXIT0, both required pg-cloudflare standalone files present; deployment ID=f09. |
| Standalone / runtime / assets |30,377 files/15 symlinks;two routes/two resources;35 assets/7,996,414 bytes and deployment invariants pass. |
| Required original combined E2E |353 passed/19 existing skips in6.6min; visitor recovery18 passed in15.3s; EXIT0/local retry0/fresh-owned servers/original projects and order. |
| Scope / secrets |Diff check passes;113 changed-candidate files scan0 supplied-password matches. Private input unchanged. |

Final full log SHA256
`797d5a508b28ee102ee658a3218431c26e1d109994ffd8c0821f2a625b1cfd8e`;
all four default browser artifact directories preserved at
`output/playwright-f09ecd3-final-green-01`. This includes the original mobile
stale-Cart journey, not an isolated diagnostic substitute. Cart application/test
source is unchanged from the earlier eb65 full-green repair. The49 skipped unit
cases execute/pass in native PostgreSQL;19 browser skips are existing viewport/
matrix/disabled opt-in cases. No retries/skips/projects/assertions were weakened.
The earlier CI CAM-create retry remains a retry-pass with unproven initial
timeout cause; no clean-first-attempt claim is made for that historical run.

### Live duplicate: one submission and a bounded later notice capture

Pre-auth/pre-submit failures01 (chunked UTF-8 hash) and02 (private READ ONLY
query's nonexistent assignment date columns) remain preserved. Helper03 uses
canonical active/nonrevoked assignment fields, without changing authorization.
Its ONE normal Owner form submission used designated `adoashraf103@gmail.com`
in the existing cross-scope global employee journey and reached the exact
`/users?notice=user-account-exists` refusal route. Submitted cap is consumed;
there was no second submission. All four after-guards and cleanup passed:
target/Owner identity, credential and authority graph unchanged; global account/
assignment/invitation/attempt counts unchanged; selected finance and uploads
unchanged. Ordinary authentication timestamps/session writes are excluded,
not disguised as zero total database writes.

The original combined notice checker then failed `notice_invalid` and exited1.
Its exact failed boolean was not retained; cause is not invented. Original
response rendering is NOT claimed. Live proof SHA256
`4cbd0bb0569fd5b0bf090bcac1062058cffd5582b8a13d3de98a066fd9fd3e97`.
A separately reviewed GET-only revisit of the already observed refusal URL
captured the actual visible canonical English alert in normal production Chrome:
“This invitation cannot be created with the submitted account details. No
account was created. Review the workspace or use a different authorized address.”
This is a later GET capture, not another POST or a repaired original checker.
Private capture log SHA256
`11cf388cc48b989f1bafea1003b0e48dd2a414aa9e4a3a96284f2b2980a5e2ba`.
Thus live cross-scope refusal/no duplicate plus later visible notice have evidence;
original same-tenant/full-continuation guard is still not certified. Valid account
setup/login/used-link and product deletion remain actual isolated evidence only.
No real product or business history was deleted.

### Shared live: transport versus application writes

A fresh65s production observer used a closed metadata-only path classifier.
Three bounded authorized opaque snapshots, peakONE connection, no legacy streams,
GET stream/poll200, offline pause/reconnect/resync and expiry polling passed.
Two automatic POSTs were actually classified as Cloudflare RUM:one cancelled,
one204; application-or-unknown POSTs0, tracking cap not exceeded. The original
broad observer's `observationFailure:true` remains preserved: this is not a
zero-HTTP-POST claim or a retroactive waiver. Network application-command absence
and SSE transport acceptance are separate evidence. Closed log SHA256
`b5250a95622bbd9d8c701ae33455a23e2b11568e60790e07fec441420225d59c`.
Actual unsaved Requests field/focus/route persisted through a later natural live
cycle and was restored before leaving; changed-business-hint dirty deferral is
automated coverage, not falsely attributed to this passive live observation.

### Contact remains the exact affected human dependency

The02:04:01Z read-only production checkpoint found A/B and ALL recent enquiries/
notification outboxes0, no A provider ID; eight historical held jobs unchanged.
Connected recipient Gmail exact-A search including Spam/Trash returned no IDs.
Healthy workers cannot establish submission, acceptance, delivery or receipt.
Source tracing remains: native form/client verification → server Siteverify and
schema/rate gates → atomic enquiry/notification outbox → leased worker and stable
provider idempotency → accepted provider ID → signed delivery event → mailbox.
With no enquiry there is no A outbox job to process; whether the prior Brave POST
reached the server is unknown. Known Chrome600010 occurs before durable submission;
no Tunnel-version root cause is proven and no Cloudflare controls were bypassed.

A conservatively counts1 of the two labelled live-smoke limit; B is unused.
No new Contact Send/reset/retry, provider send or historical replay occurred.
Exact required user action remains: confirm whether prior Brave only completed
verification or also pressed Send; if Send, provide result and approximate time.
**Do not submit again yet.** Once reconciled, only a bounded ordinary manual
submission, if still appropriate within the original limit, can fill the missing
live chain; acceptance, signed delivery and actual mailbox receipt must each be
checked separately. All independent release work continues.

## Historical execution checkpoint — 2026-10-08 02:04 UTC (superseded)

**STATUS: DEPLOYED REPAIRS / BLOCKED FINAL ACCEPTANCE. Not demo-ready.**

PR [219](https://github.com/ASHRAF-2004/axora/pull/219) was squash merged after
protected immutable-image CI passed. Current protected main and deployed SHA:
`c3cd1b248709c8f74b3260b6d0b0c742d8ac0eec`; OCI:
`ghcr.io/ashraf-2004/axora@sha256:24f893b439b1ef00835cc8a5a7bdeefe69c6668b24274b3f121cdc12d2d4705c`.
Production now has all139 migrations through
`139_branch_lifecycle_authority_and_budget_refusals.sql`; sealed-release ledger
checksums match and migration-status returned `none`. Local/public HTTPS,
headers, liveness and database readiness passed01:39:20Z; app and five workers
use the exact image, are healthy, restart0/noOOM. No host action occurred.

The final app/test source passed the original local combined gate at exact
`eb65ef3b7592f948f8835246dc572561366e5606`:353 passes/19 existing skips,
visitor18 passes, local retry0. Its application tree is unchanged in the merge;
only the three release-report/task documents differ. Original stale-Cart failure
and deterministic old-render RED evidence remain preserved below. Cart recovery
does not change accounting, pricing authority, checkout commands or permissions.

The additional exact merged-main Nightly
[37713703674](https://github.com/ASHRAF-2004/axora/actions/runs/37713703674)
**FAILED**:351 passed/19 existing skips/one existing-retry flaky CAM-create pass/
one mobile Malay Contact failure in13.2min. Both attempts show feedback
horizontal overflow20px at the unchanged1px assertion. Visitor config was NOT
RUN because the first config failed. Lint/typecheck/unit/native/build/staging and
Zapier preceding steps passed; no CI failure is hidden by the earlier local pass.
Runner artifact count0; no unavailable screenshot/trace inspection is claimed.
Full private log SHA256
`881f724110544514c76bd3b061cd09ba26b0016339d4dfc013fdf2d8ae10d685`.
This is a recoverable required gate: real local Pixel7 geometry reproduces20px
with a wider supported fallback font. The feedback inherited a non-wrapping flex
row and min-content sizing. The actual CI font was not captured. A scoped
wrapping fix/stronger regression is being prepared, without clipping, changing
verification, or weakening tests. No second full run is launched blindly.

### Actual production acceptance at c3cd1b2 / image24f893b4 / schema139

Normal headed Chrome authentication used authorized accounts and the unchanged
private input; no fabricated sessions, saved auth, recordings or CAPTCHA bypass.
The computer-use inventory exposed no enabled browser surface; the explicitly
authorized real Playwright/terminal fallback was used. Auth necessarily writes
ordinary session/last-login/throttle timestamps; these are not zero-DB-write
claims. Saved locales remain English; Owner Light preference restored.

| Item | Actual observation / evidence boundary |
| --- | --- |
| 1 Setup tabs | All six routes clicked and rendered in both themes. Light normal13.2/hover15.17 and Dark normal4.83/hover5.81 contrast; keyboard focus3px. All six mobile tabs contained/tappable and navigable. |
| 2 Branch | Existing openai branch has General/Delivery address/Contact/Delivery, aligned three Budget metrics, distinct Location confirmation label and exactlyONE authorized Edit delivery address action. Actual Owner and BranchAdmin desktop/390px views readable/no document overflow. |
| 3 Open wallet | Both existing rows readable: Light13.2/15.17 and Dark4.83/5.81 normal/hover, focus3px,44px high. Both-theme390px layouts contained; no disabled link state applies. |
| 4 Overview / logo | Existing mewo1/C-107 renders four structured identity/business/contact/setup groups and its actual reviewed logo loaded. Both themes/390px fit. No live no-logo record exists; actual isolated new-company placeholder evidence remains separate. |
| 5 Product | Actual A3Paper UUID4247874e-457e-4de1-8c19-0d1b05068931 renders Product details/Delivery/Authorized pricing, eight rows and loaded gallery. Both themes/390px readable. Owner internal cost allowed; actual Company Admin direct management route renders404 without commercial data. No actual CAM supplied. |
| 6 Wallet setup | Actual Continue setup→Wallet and budgets loads mewo1 UUID4b5f72eb-303a-4df0-a8fa-f078a97ce0bd at its `/companies/UUID/wallet`, correct company200/no404; refresh/direct/back↔Documents/forward pass, desktop/mobile. All three live companies already have Wallets; missing-Wallet pending state remains automated/isolated proof, not fabricated production evidence. No balances/Wallets changed. |
| 8 Shared live |65s observation: three bounded authorized opaque snapshots, peakONE connection, no legacy streams; GET stream/poll200, offline pause/reconnect/resync and expiry polling observed. Two initial POST transports remain unclassified, so zero-write/full read-only acceptance is WITHHELD pending safe path-class diagnosis. No raw requests/tokens collected. |
| 9 Guide |12-page PDF/runbooks delivered and visually verified; future destination/off-device/cutover/host boot untested. Host restart explicitly prohibited. |
| 10 Invitation UI | Actual blank private-link route200 renders compact Open your invitation email guidance, no password inputs/no overflow. Valid invitation/setup/login/used-link is actual isolated evidence, not a live token acceptance claim. |
| 11 Integrations | Actual Owner200: native External API/Webhooks active, Slack/Zapier disabled and truthful setup checklist. No activation command. Controlled Slack app/workspace/channel/dedicated private inputs missing for activation only. |
| 12 Budget refusal | Typed contractual-ceiling refusal and current-authority guards passed focused/native/full E2E; no real allocation or financial command used. |
| 13 Budget list | Actual Company Admin six aligned headers, desktop1370px region; mobile356px scroll region contains720px table with keyboard tabindex0 and document overflow0. Screenshot visually inspected; no budget mutation. |
| 14 BranchAdmin | Actual current BranchAdmin scoped branch renders retained metadata Edit branch, structured information and single address action, with no lifecycle/delete button. Additive139 authority tests passed; no real destructive attempt. |

Actual role checks: `malaysiaashrafo@gmail.com` is Company Admin of mewo1;
unselected Shopping chooser and exact selected branch Shopping/empty Cart,
Budgets/company Wallet read normally. READ could create an absent cart, so an
exact own ACTIVE cart was verified before selected Shopping/Cart; selected cart
rows and events were fingerprinted unchanged afterward. No Add/Place/top-up.
`shehab111alslool@gmail.com` is BranchAdmin of openai, and
`alsaloulashraf@gmail.com` is Delivery Agent; fresh clean delivery-only portal
and phone navigation fit, no Claim/location/availability/workflow action, no
active assignment. No supplied Owner email is relabelled as CAM.

### Contact and registration boundaries

Read-only Contact checkpoint02:04:01Z: A/B enquiries and notification/ack outboxes
are0; ALL submissions/notification outboxes since A21:23:08Z are0. Eight
historical Infinity-held jobs remain PENDING/attempt0/no provider ID/no lease;
queues idle/six controls unchanged. Metadata/recent log SHA256 respectively
`2d69ee775d5257f1068fe21df55730b44346eb780a03603ddd20ece8c21accdd` /
`06c655a58d34137cdce5d54aa16ac85b37d215d5dc4ab5c87f168ce7ad78e47b`.
Connected recipient Gmail profile matches; fresh exact-A `in:anywhere` search
including Spam/Trash returned no IDs. No A provider ID exists to query.
Provider acceptance, signed delivery and actual mailbox receipt are NOT proven.
A conservatively counts1/B unused, unchanged cap; no Contact submission/retry/
historical replay. Exact human dependency is reconciliation of prior Brave:
verification only, or Send pressed; if Send, result and approximate time.
Please do not submit again yet. Known Chrome600010/disabled Send precedes durable
submission and is not proof of a Tunnel-version or worker/provider defect.

Live designated duplicate check has not submitted. Helper01 stopped pre-auth
because per-chunk UTF-8 decoding broke an Arabic source hash. Preserved corrected
02 then stopped pre-auth at its READ ONLY SQL preflight (42703): its private
assignment query referenced nonexistent starts_at/ends_at. Graph/finance/hash-
policy EXPLAINs passed; canonical current schema has active/nonrevoked assignment
authority, not those fields. A source-derived correction is being prepared;
all failed proof/markers are retained. No duplicate/role/invitation/provider
mutation occurred. Actual isolated normal setup/login/used-link, cross-scope
duplicate notice and eligible product deletion/refusals remain separate evidence
below; no real product/business history deleted to force live acceptance.

### Release / recovery point

Protected PR CI37713329740 and main image/deploy CI37713669762 passed;
merge2026-10-08T01:35:13Z. Pre139 encrypted backup/disposable restore proof
verified01:23:31Z,240 tables/138 migrations/files, archive
`/var/lib/axora-production/reset-backups/axora-reset-20261008T012322Z-a40a70bef310.tar.gpg`,
cipher SHA256d55606fd7ccf1d92bfff79e66f00c4562240bef96729f1fe68ac5c56f1c7476e.
Automatic deployment also verified policy backup
`/var/lib/axora-production/backups/axora-20261008T013831Z`.
Local only; no off-device resilience or production restore claimed. App/workers
and existing controller-selected Caddy replacement are service operations, not a
host reboot; Tunnel/Tailscale configuration unchanged. Private sign-in input,
unrelated working trees and original artifacts remain intact. Independent work
continues; required CI/Contact/live-duplicate evidence is not declared complete.

## Historical execution checkpoint — 2026-10-08 01:24 UTC (superseded)

**STATUS: IN PROGRESS — acceptance gaps remain; no new deployment.**

Production remains protected main/deployed
`a40a70bef3104d7e08959dfdc6e55a36ba6beb31`, OCI
`sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration138. The application candidate now contains a five-file guarded Cart
recovery patch, independently reviewed twice. The temporary failure diagnostic
has been removed (recoverable in its2ae commit); the original direct-purchase
E2E differs from6f only in its explanatory comment. Assertions, timeouts, retry0,
project order and fresh standalone-server ownership are unchanged. No Cart SQL,
domain result, accounting, price authority, authentication or role change.
All required local gates now pass on exact application/test candidate
`eb65ef3b7592f948f8835246dc572561366e5606`. Protected release is in progress;
production acceptance remains pending. This report update changes documentation
only, not the gated application/test source. Earlier b7/2ae results are history.

| Final candidate gate | Exact eb65 result |
| --- | --- |
| Focused Cart/shopping |100 passed/seven files; old actual-component held-props regression fails at missing authority, then new source passes. |
| Lint / typecheck |Both EXIT0. |
| Unit / PGlite |1,914 passed/49 existing native-only skips;376 passed files/11 skipped. |
| Native PostgreSQL |All49 native tests/11 files executed and passed;139 migrations/replay/forced RLS/grants/lifecycle verified. Production still138. |
| Production build |EXIT0; both pg-cloudflare standalone files present. |
| Standalone/runtime/assets |30,377 files/15 symlinks staged;two routes/two resources;35 assets/7,996,414 bytes and deployment invariants passed. Task-owned npm cache; unrelated default-cache failure not altered. |
| Required original combined E2E |EXIT0,353 passed/19 existing intentional skips in7.0min; visitor recovery18 passed in16.8s. Fresh-owned standalone, original project/order/one-worker and local retry0. |
| Diff / review / private input |Diff check passed, three source-scope reviews approved,112-file private-password scan0matches; credential input unchanged. |

Full-browser log SHA256
`d1a95b34e371d9b84459c82f42d761772cdd6861c4381c336a7e021e4457c538`;
all four artifact directories preserved at
`output/playwright-eb65ef3-final-green-01`. This is the required full changed-app
run, not an isolated diagnostic pass. The49 skipped unit cases all passed in
native PostgreSQL; the19 browser skips remain the original viewport/matrix or
disabled opt-in cases, with no new skip/retry/assertion weakening. The old-source
RED command selected one test with `-t`; its32 unselected cases are filter
exclusions, not added intentional skips. Historical a40 CI retry remains below
and does not certify this candidate.

- Deterministic old-component render: exact6f CartReview loaded read-only from
  Git into the new held-props test reproduced STALE/quantity2/missing financial
  authority/disabled Place order. EXIT1 at the financial-authority assertion,
  not a compilation or setup failure; log SHA256
  `546b44e80592ae470d70ca5f05ce8554a0e2b3ecede441387120a381785d2979`.
- Final focused new-component/action/selection plus existing purchase, pricing,
  migration, shopping and scope tests: **100 passed / seven files, EXIT0**.
  Log SHA256 `f8a3cf3fd7dcdcc5392879b7fba458296e92e0bcb47a38723514db20a945a1b2`.
  Recovery requires exact authorized scope/version/customer projection; raw
  SQL null and parsed undefined represent only the same absent department.
  Fresh/newer/different route authority permanently retires recovery, including
  a fresh3→regressed2 render negative. Existing keyboard drafts and every
  purchase/unknown/recovery/error/busy lock remain. Failed reads retain known
  STALE and never repeat a purchase. A112-file candidate/password scan found0
  private-password matches; the original private input remains intact.

- Exact original `npm run test:e2e` completed EXIT0: **353 passed / 19 existing
  intentional skips in6.7min; visitor recovery18 passed in14.9s**. The previously
  failing mobile stale-cart journey passed. Artifacts are preserved at
  `output/playwright-2ae608c-combined-green-01`; log SHA256
  `e2f32aeb86b85aa2c1e68dcf8bd713321c85a77b06d390b30a5ed5a4c1786226`.
  This is a full combined result, not the earlier isolated probe. It does not
  explain or retroactively repair the6f4 failure. The controlled old-component
  regression now proves the render defect; the precise internal scheduling
  trigger remains unproven. The failure-only attachment was not invoked on
  this passing test.
- Second bounded exact original combined reproduction also completed EXIT0:
  **353 passed / 19 existing intentional skips in6.8min; visitor18 passed in14.9s**.
  Artifacts `output/playwright-2ae608c-combined-green-02`; log SHA256
  `ee9c740a8da0a7ef9e375d1c6814f2078dce506338c62f99f0a04935ff6b8617`.
  Both new full runs passed without retry; neither reproduced the old stall.
  No earlier failed run was hidden or changed into a pass.
- Inspection of the preserved6f4 actual failure image/source confirms the
  recovery boundary: typed STALE and updated quantity/total rendered; quantity
  and removal controls remained enabled, but the financial workspace was absent
  and Place order disabled. Existing component conditions require a matching
  authoritative Cart/workspace pair. Correct v3 data arrived in the trace, but
  that does not establish a committed matching RSC prop. The precise internal
  React/Next scheduling cause is still unknown. A narrow independently reviewed
  known-stale recovery design is now implemented: obtain the existing
  authorized workspace through its canonical reader, preserve a known refusal
  if the read fails, and accept only an exact guarded identity/version/projection
  pair. No forced enablement, financial calculation, second purchase, framework
  upgrade or permission change. The application recovery defect is demonstrated:
  old typed STALE updated local Cart while review depended solely on a separately
  committed RSC workspace. The new optional authorized pair bridges that exact
  boundary. The internal scheduling trigger is not claimed as proven. Focused
  regression and required final local gates passed; actual production acceptance
  and the internal scheduling trigger remain distinct evidence boundaries.
- Changed-file lint/full typecheck at2ae and b7 unit/native/build/assets are
  historical evidence, superseded by the fresh ordered eb65 gates above.
  Existing failures/retries/skips remain retained.
- Contact read-only checkpoint00:30:05Z: exact A/B and ALL submissions/outboxes
  since A reservation remain0; bounded fixed-category failure logs0; connected
  recipient Gmail exact-A search including Spam/Trash returned no IDs. No
  provider ID exists to look up. Eight held historical jobs/queues/controls
  remain unchanged. A conservatively counts1, B unused; no new Send or replay.
  The retained Chrome page is closed and no computer-use browser surface is
  enabled. A precise reconciliation question is pending: did Brave only finish
  verification, or was Send pressed; if pressed, what result/time? Do not submit
  again until this is reconciled.
- The Contact chain is source-traced separately: native required-field/phone
  validation and client verification → server privacy/honeypot/Siteverify →
  strict schema and durable rate limits → enquiry plus notification outbox in
  one transaction → leased worker/attempt → provider acceptance → signed
  delivery event → mailbox receipt. The earliest observed failure is Chrome
  verification600010 with disabled Send, not a demonstrated worker/provider
  failure. Zero durable enquiries means there is no A job for the worker.
  Whether the later Brave interaction reached a POST remains unknown. Private
  source/evidence note SHA256
  `e3249d117b1f3fa9dc482cf6617fab33cc40f51335e72cb1d8c9aaa5928c8a70`.
- The capped normal-auth duplicate check now passed EXIT0 on the exact retained
  isolated b7/fdbd/139 fixture. ONE global Platform-CAM form submission targeting
  its existing Company account returned POST303 and
  `/users?notice=user-account-exists`. The actual visible English refusal
  matched the canonical catalog: “This invitation cannot be created with the
  submitted account details. No account was created. Review the workspace or
  use a different authorized address.” All seven preservation guards passed:
  target/global counts, account/credentials/auth-version/roles/assignments/
  invitation/company, Owner authority/password, sink counts, selected finance,
  new-company zero-money state and copied files. Browser/proxy/relay cleanup
  passed. Proof SHA256
  `7198ff685b08890534132edfbbd5815abe101d54e881e98cb072b4d2f1d297cd`.
  No production account was created, deleted or reassigned, and no real provider
  send occurred. This separately closes the isolated cross-scope duplicate
  refusal, not live or same-tenant acceptance or the earlier unfinished guard.
- The preceding duplicate helper01 stopped before any submit because its
  private precondition incorrectly expected an inactive-company account in the
  Company Users directory. Existing migration125 denies that scoped `user.view`
  before the Owner exemption; the actual corrected02 read confirmed200/correct
  company/recognized empty view. Global Users correctly shows PLATFORM accounts
  only. Source and actual UI evidence justified the check correction; no company
  activation or authorization widening. Original01 failure evidence SHA256
  `a67e477d2c42a8537a8e5ecf5487a9b6714185532d99acdeb6ab87273cd8af34`
  and its no-submit marker are preserved. Exactly one negative submission total.

Fresh pre-139 encrypted backup completed and its disposable restore proof
passed at2026-10-08T01:23:31Z:240 tables/138 migrations/persistent files.
Archive `/var/lib/axora-production/reset-backups/axora-reset-20261008T012322Z-a40a70bef310.tar.gpg`,
ciphertext SHA256 `d55606fd7ccf1d92bfff79e66f00c4562240bef96729f1fe68ac5c56f1c7476e`.
Installed/source backup controllers matched; no production restore/reset or
host action. This is a verified local recovery point, not an off-device backup.

Protected image/merge/deployment and final ordinary-auth production rendering
remain pending. Contact submission/provider/delivery/receipt remain unproven;
the pending Brave Send reconciliation cannot be replaced by green tests or
healthy workers. No demo-ready or precise internal scheduling claim.
Private sign-in input and unrelated worktrees remain intact; no host action.

## Historical checkpoint — 2026-10-07 23:55 UTC (superseded)

**STATUS: BLOCKED — required combined E2E failed; no new release/deployment.**

Protected main and production remain `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`,
OCI `sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration `138_owner_product_deletion_capability.sql`. The application candidate
is `b7c1c8a00184d4fa047fc7d3322f7299ab378eae`; the current tested browser head is
`6f4f0a1719991599b6ff2984e5dd643f6f68d039`. Only five E2E files differ between
those heads. Application, migrations, unit/native tests, dependencies, build and
release configuration are identical. Earlier deployed repairs, unrelated dirty
worktrees and the owner's private sign-in input are preserved. No new merge,
immutable candidate image or production deployment is claimed.

This checkpoint supersedes the older status and deferral statements below.
Earlier failures are retained as history, not quietly converted into passes.

### Final candidate checks

| Check | Result / exact evidence boundary |
| --- | --- |
| Lint / typecheck | Full b7 and a741 lint/typecheck passed; changed-file lint and full 6f4 typecheck passed. |
| Unit / PGlite | Exact b7: 1,853 passed, 49 intentional native-only skips; 374 passed files/11 skipped. |
| Native PostgreSQL | Exact b7: all 139 migrations/replay/RLS/grants/lifecycle and all 49 native tests in 11 files passed. Production remains138. |
| Build | Exact b7 production build and both pg-cloudflare standalone files passed. |
| Standalone / assets | Task-owned private npm cache: 30,377 files/15 symlinks staged; two routes/two resources validated; 35 assets and Compose/Caddy/secrets invariants passed. Existing dangling default-cache ENOTDIR failure preserved; no unrelated cache repair. |
| Delivery reads | Native fetch receiver defect fixed by a bare-call wrapper; dedicated regression failed before/passed after. Eight actual delivery browser checks passed. Immediate authorized detail bootstrap, permissions, no-store/abort, denial handling and bounded retries preserved. |
| E2E contract correction | a741 updates three legacy stream fixtures to shared hints plus authorized GETs. Six focused and 30 neighborhood checks passed without retry. No application or release-config change. |
| First completed combined browser gate | Exact a741: 352 passed, 19 intentional skips, one mobile shared-live navigation failure; EXIT1, visitor recovery not run. Trace proves the menu click succeeded but Requests does not exist in the unchanged mobile drawer. All artifacts retained in `output/playwright-a741d801-failed`. |
| Final navigation correction | 6f4 selects the existing dashboard View all link, additionally asserts `/requests`, and preserves all URL/live-status/one-connection/no-legacy/privacy assertions. Independent review approved; eight focused checks passed in15.7s. No retry, timeout, assertion, skip, project or order weakened. |
| Final combined gate | Exact6f4, fresh-owned/retries0:352 passed/19 intentional skips/one mobile direct-purchase refresh failure, EXIT1 in6.9min. After typed STALE_CART, the server returns matching cart/workspace version3 but rendered Place order stays disabled. Trace/source diagnosis has not proved candidate causation; Cart/page/action/accounting source is unchanged from a40. No financial guard relaxed or speculative checkout change made. Artifacts retained in `output/playwright-6f4f0a1-failed`; log SHA256 `60520f36c02983897fcea0dd697a9b262f96320c5af4fa8e5e4c6aad9a5edbbc`. Earlier interrupted320e/b7 failures remain separately retained. |
| Visitor recovery | Run separately once after the failed combined gate:18 passed/15.5s, EXIT0 at the same6f4 source; no repeat of an already-green gate. Log SHA256 `b271761187d09969f0fb40b9e9c63bd561a619524a09f69e9d7426d25da1c547`. This does not convert the combined failure into a pass. |
| Bounded stale-only diagnostic | One fresh public-demo mobile probe passed in2.4s. Committed-tree membership was verified, reviewed confirmation stayed at2 while the concurrent cart advanced to3, typed STALE_CART was observed, then initial-cart/workspace/local versions all reached3 with matching identity, no draft/error lock and Place order enabled. It stopped before any successful-purchase attempt. Log SHA256 `c343d4d21c354d5353d2262fc22641f2f89ad7da141f3a0c9607b77fdf894e31`. This isolated instrumented result did not reproduce or resolve the failed combined gate and is not full release acceptance. |

The diagnostic's first attempt stopped at its read-only preflight before opening
a dialog or submitting a purchase command. A separate initial-only observation
then proved the React root is at depth89, beyond that private diagnostic's80
limit; all three captures resolved exactly one current owner through child/
sibling membership. Only the private diagnostic's bounded root lookup was
corrected. The original failed preflight, markers and logs remain intact. No
application or repository test source, financial guard, timeout, assertion or retry changed.
Instrumentation can affect scheduling; the passing isolated probe is not proof
of a baseline flake, a fixed combined-run defect or safe deployment. No further
full E2E run was made merely to obtain a green result.

The 49 unit skips are native-only tests, all actually executed and passed in the
native gate. The 19 browser skips are existing duplicate viewport/matrix flows
or disabled opt-in integration/email scenarios; no new skip was introduced.
Local retries remain0. The older exact-a40 CI run used its existing retry for
one mobile company-create flake; its initial cause remains unproven. That result
is not represented as a clean no-retry run or evidence for this new candidate.

### Per-item acceptance and remaining work

| Item | Current evidence and exact remaining boundary |
| --- | --- |
| 1 Setup tabs / 3 Open wallet | Shared Dark hover/pressed tokens corrected, preserving the existing palette and normal treatment; rendered normal/hover/focus/pressed desktop/mobile checks passed in both themes. Final production acceptance pending. |
| 2 Branch information | Existing structured General/Address/Contact/Delivery and aligned Budget preserved. Confirmation labels replace repeated action labels; one authorized Edit delivery address action remains. EN/AR/MS/RTL rendered checks pass. Final production acceptance pending. |
| 4 Company overview / logo | Existing reviewed-logo storage/rendering reused. Actual isolated b7 normal company creation succeeded; overview refreshed with four groups, one no-logo placeholder/no logo image. Existing real logos were previously observed on production. Final production acceptance pending. |
| 5 Product information | Existing Details/Delivery/permission-aware Pricing and gallery preserved. Isolated actual Company Administrator management route denied; no confidential price exposure. Live CAM is unavailable, not impersonated. |
| 6 Company-specific setup Wallet | Retained isolated company0c41: correct Wallet URL/context, no404, pending owner setup state, refresh/direct/back-forward passed. Its existing provisioning trigger created one zero-balance Wallet/account; no Wallet was fabricated or deleted to manufacture a missing-Wallet fixture. Final production acceptance pending. |
| 7 Contact | 23:48:42Z read-only check: A/B enquiries, notification and acknowledgement outboxes0; TOTAL submissions/notification outboxes since A reservation21:23:08Z also0. Eight historical Infinity-held zero-attempt jobs, queues and six controls unchanged. Connected recipient Gmail exact-A search including Spam/Trash returned no IDs. No new provider ID exists for lookup, so no provider lookup was performed. A conservatively counts1 of the two-total cap; B unused. No resend, historical replay, verification bypass or additional Submit. Private checkpoint SHA256 `0ef70c1e5d877419095d29bec2a232d74a603f6ac8ebfb138e430ac9525040be`. |
| Registration | b7 ordinary Owner/CA sign-in, normal unbranded company creation, overview/context and invitation send succeeded in fenced restored-data isolation. Existing invitation is SENT/hashed; normal recipient password setup, sign-in and used-link refusal passed. Synthetic email reached only a RAM sink, never the real provider. Duplicate-account final check failed its expected-notice assertion; actual notice was not captured. Read-only diagnostic02 EXIT0 verifies the unchanged deployed110+125 first-admin helper excludes ACTIVATED before duplicate classification, predicting a scope refusal; this is not an observed UI notice. Exactly one active setup-completed Company Administrator/assignment, one SENT/consumed hashed invitation/one attempt and one sink delivery/zero fragments remain. New company has one Wallet/account and no money/ledger/top-ups/requests/invoices/budget entries. Fresh diagnosis-only finance/files equality and independent original-backup preservation comparison passed (scope below). No duplicate/invitation/company submission repeated. Whole-continuation final financial/files guard was not reached and is not claimed. |
| Product deletion | One actual isolated exact-a40 ordinary-auth journey passed: owned disposable product/images/supplier removal, audit1 and refresh absence; protected-reference, actual CA and owned explicit DENY refusals passed. Original business history, finance and files preserved outside the owned fixture. Capability source is unchanged in b7. No production product or historical record deleted or live destructive target assumed disposable. |
| 8 Shared SSE | Bounded fresh-authorized durable-snapshot resync/shared tab connection, reconnect/fallback/dirty-form preservation implemented and native authorization cases pass. No durable event replay, underlying-query cancellation or financial ledger added. Final full gate and ordinary-auth production observation pending. |
| 9 Guide | 12-page illustrated PDF delivered at `/home/ashraf/Downloads/Reports/Axora_Server_Migration_Guide.pdf`; all pages visually checked. SHA256 `99e9210d98f911efc589997a4d4c66197b7ac86eb10851f6d931ed97de36e627`. Full migration/recovery runbooks and reproducible generator delivered. No destination cutover or host restart performed. |
| 10 Invitation UI | Compact existing account design, localized role and assurance treatment implemented; normal valid invitation/password-setup/sign-in/used-link journey now passed in isolation. Token, consent and password policy unchanged. Final production rendering pending. |
| 11 Integrations | Truthful native/API/webhooks, disabled Slack/Zapier states and setup checklist implemented; 37 focused and six localized browser checks passed. Actual Owner workspace200/flags/zero installations observed. Slack activation requires controlled developer app/workspace/channel and dedicated private credentials, not a core UI blocker. |
| 12 Add Budget | Typed actionable legitimate ceiling refusal and current-authority-before-replay implemented; financial math, Wallet and periods unchanged. Focused and native checks passed. No real allocation/financial transaction made. |
| 13 Budgets list | Aligned six-column full-width semantic table, tabular/BDI values and keyboard-scrollable narrow layout implemented; EN/AR/MS/RTL component and rendered checks pass. Final production acceptance pending. |
| 14 BranchAdmin | Additive139 hard lifecycle ceiling/current actor/assignment/authorization and evidence guard implemented after isolated custom-GRANT/raw-update gap proof. Metadata editing retained; no RLS weakening. Four native cases pass. Migration not yet deployed; final production readonly role check pending. |

Contact verification error600010/Ray `a46fe7b8df8fd974` and Brave/Chrome difference
do not establish a Tunnel-version cause or a successful Send. The healthy pinned
2026.7.3 Tunnel is older than2026.10.0 but supported; no Tunnel/provider/DNS or
authentication configuration was changed. Candidate Contact recovery UI handles
manual retry/sanitized failures without submitting or clearing fields; six
EN/AR/MS desktop/mobile checks passed with zero POSTs. Real submission, outbox
processing, provider acceptance, signed delivery and mailbox receipt remain
separate and unproven stages. Missing step is a successful persisted normal
submission, not mailbox access. No further question or resend is being repeated.

### Recovery and release boundary

Independent original-backup comparison completed EXIT0 without further UI/auth
or command replay. All2,735 original rows across29 selected finance/catalog/
history tables remain present and SHA256-identical by primary key. Original
financial fingerprint matches the retained copy, excluding only the exact
bound new-company UUID; that company has one zero-money Wallet/period/account
and no ledger/top-ups/requests/invoices/budget entries. Additional catalog rows
belong only to the exact owned fixture. Added history is disclosed separately:
two owned product-price rows, two bound-company workflow rows and60 audit rows
(28 bound fixtures/32 unclassified); no blanket attribution of those32 is claimed.
This proves selected original-row preservation, not all-history-addition
acceptance, original-upload equality or recovery of the unfinished original
whole-continuation guard. Fresh selected rows/copied files were stable during
the comparison. Only one new capped network-none utility was created, restored
with the real validator and canonical138 grants, then stopped and retained.
Private evidence SHA256 `47051746e0a2165f91d4d8dc0089e787df8e99a49b0f1776130420284993e652`.

Registration's newly reproduced unbranded creation defect is narrowly repaired
by `$12::timestamptz`: the uncast parameter had selected the defaulted-logo
overload. Dedicated old-failure/new-success/schema and authorization tests are
included in the b7 unit/native results; no new storage, password or auth path.

Fresh encrypted backup verified23:04:48Z:240 tables/138 migrations/uploads,
`/var/lib/axora-production/reset-backups/axora-reset-20261007T230439Z-a40a70bef310.tar.gpg`,
cipher SHA256 `a9cbf844040a896539df39498a775468d9320aabffa3b02d31d55ed3f92dfa15`.
Installed/source backup controllers match. Production health passed23:49:58Z;
fresh protected-main/deployed SHA and OCI match the baseline above. The sealed
a40 migration-status check again returned `none`, with production head138.
Application rollback preserves forward migrations; it does not replay broad
old grants or restore business data. No off-device backup is implied.

Remaining boundaries are separated explicitly:

- Release blocker: required6f4 combined mobile test
  `company-admin-direct-purchase.spec.ts:136` remains failed. A focused reproducer
  of the combined-run stall and an evidence-backed safe resolution are missing;
  isolated success alone cannot authorize merge/deployment. Keep financial guards
  intact. Protected release and actual rendered production acceptance depend on
  clearing this gate.
- Core Contact acceptance: a successful persisted normal capped submission is
  missing. Consequently no bound outbox, provider acceptance/message ID, signed
  delivery event or mailbox receipt can be verified. Mailbox access is available;
  it is not the blocker. A remains counted1/B unused; no repeat submission asked.
- Registration evidence limitation: the final duplicate-UI notice was never
  recorded and its closed browser context has no retained trace/HAR/state. A
  read-only source/data check cannot retroactively recover that notice or the
  unfinished original whole-continuation guard. Successful setup/login/used-link
  journeys and independently proved selected-original-row preservation remain
  valid separate evidence, not an overall failed-continuation PASS.
- Role-evidence gaps: an authorized current-role CAM and second Delivery Agent
  account/session are unavailable. No supplied email is treated as proof of role,
  no session is fabricated and no role is reassigned for testing.
- Future activation/resilience dependencies, not core-fix blockers: controlled
  Slack developer app/workspace/designated channel plus dedicated private
  credentials; off-device backup destination; future migration-host access.
  Delivered guide and locally completed enhancements are not silently deferred.
  Whole-host boot/restart testing is prohibited by the owner.

Healthy workers and passing automated checks alone do not complete workflow
acceptance. No new PR, immutable candidate image, merge or deployment occurred.
Final documentation diff check passed. The supplied-password scan of all106
changed files, complete candidate diff and commit messages found zero matches;
the original private sign-in input remains available and unchanged. No private
diagnostic helper, screenshot, credential or log was added to Git.

## Historical resumed checkpoint — 2026-10-07 22:26 UTC (superseded)

**STATUS: BLOCKED — changed candidate not fully gated, released or accepted.**

Protected main/deployed baseline remains
`a40a70bef3104d7e08959dfdc6e55a36ba6beb31`, OCI
`sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2`,
migration138. The clean candidate HEAD recorded at 22:25 UTC was
`fdb29666c8e2aa6956f9a69104809df7783fac7c` on
`codex/recovery-completion`. No new candidate image, merge, deployment or
production lifecycle acceptance is claimed. Earlier deployed fixes, private
supplied input and unrelated dirty worktrees remain intact.

This section supersedes all earlier status/deferral wording below. Historical
exact-a40 results remain valid only for that deployed baseline. They do not
certify this changed candidate, and earlier statements that guides or local
enhancements were deferred no longer describe the current work.

### Current gates and regression evidence

| Gate / source | Evidence and remaining boundary |
| --- | --- |
| `320e032` lint/typecheck | Passed. Latest full lint/typecheck also passed with the `efcc08c` bootstrap fix and exact `fdb2966` test source. |
| `320e032` unit/PGlite | 1,845 passed; 46 intentional skips. Not rerun or represented as an exact final-head result after later application changes. |
| `320e032` native PostgreSQL | All 139 migrations/replay/RLS/grants and 46 native tests passed, including BranchAdmin and shared-live authorization cases. Candidate migration139 is not deployed; production remains138. |
| `320e032` build | Production build and required standalone files passed. This artifact predates the bootstrap fix and pending company-creation fix. |
| Stage / standalone / assets | First stage failed `ENOTDIR` because the existing `/home/ashraf/.npm` cache is a dangling symlink; it was preserved. A task-owned private cache then staged 30,377 files/15 symlinks; owned runtime validation passed two routes/two assets; production asset validation passed 35 assets. No unrelated cache repair or runtime configuration change was made. |
| `320e032` combined E2E | Interrupted with EXIT130: 35 passed, four delivery failures, one interrupted, 332 not run. Visitor recovery NOT RUN. Original failure artifacts are retained at `output/playwright-320e-interrupted`. This is not a green full-suite result. |
| Delivery regression | Failure trace showed no initial `/api/driver/jobs` GET. Shared-live detail reads had lost the immediate authorized bootstrap and could depend on an initial hint. Exact reason that hint was absent is unproven; the bootstrap contract defect is proven. `efcc08c` restores the immediate existing authorized detail GET without widening routes or permissions. Independent source review approved; four dedicated cases and the 26-test focused set passed. New whole-candidate gates remain pending. |
| Contact responsive regression | `fdb2966` strengthens the existing six EN/AR/MS desktop/mobile recovery tests at error `600010`: document/feedback overflow and help/retry bounds are checked before retry. Six passed in 4.8s on a fresh-owned standalone artifact with unchanged Contact source; zero POSTs. No Contact CSS/layout defect was observed, so no speculative CSS fix was added. |

Existing retries, intentional skips, projects, assertions and test order were not
weakened. The earlier exact-a40 Nightly retry explanation remains in the retained
record; it cannot be used to dismiss the newly proven delivery regression.

### Current workflows and acceptance boundaries

| Item | Current evidence / exact remaining boundary |
| --- | --- |
| Contact verification | User supplied error `600010`, Ray `a46fe7b8df8fd974`; real Chrome renders verification failure before Send. User reports Brave works while Chrome fails. This does not prove a Send occurred, identify the Chrome/environment cause or implicate the Tunnel version. Runtime domain/public-key fingerprint matches; managed mode and Bot Fight Mode false. No injected token, direct POST or bypass. |
| Tunnel version | Healthy digest-pinned cloudflared2026.7.3 is older than official2026.10.0 but within the supported one-year window. No evidence attributes600010 to it; no Tunnel/configuration change made. |
| Contact recovery UI | Manual reset/retry preserves form, separates verification from server availability, displays only sanitized six-digit codes and handles expiration/timeout/script/unsupported states in EN/AR/MS/RTL. Earlier 41 focused unit passes and local combined checks are retained; latest strengthened six recovery checks pass as above. Demo-only widget mocks prove UI behavior, not real verification or delivery. |
| Contact evidence chain | Fresh read-only metadata at 22:24:53Z found ZERO labelled A/B enquiries/outboxes; eight historical Infinity holds unchanged and queues idle. Aggregate-only production query at 22:26:17Z also found zero TOTAL Contact submissions and corresponding notification outboxes since A was reserved at 21:23:08Z, not merely zero matching labels. Gmail exact label-A IDs search EMPTY. Runtime checks `secretFileConfigured`, `secretAvailable`, `canonicalHostnameAllowed`, `hostnamesSyntacticallyValid` and `siteKeyConfigured` are all true, with no secret values collected. Bounded sanitized app-log collection since 21:23:08Z succeeded with zero `public_contact_submission_failed` events; it does not prove older history. No successful Send/provider ID exists in this observed window. A remains conservatively reserved/counts toward the two-total cap for an unconfirmed manual Send; no resend, automatic retry or new Submit. Gmail access exists and Resend domain is verified/sending enabled, but acceptance, signed delivery and Inbox/spam receipt remain unproven. |
| Isolated registration | One actual ordinary-auth POST against the fenced restored-data exact-a40 image returned 500 and created no fixtures. Literal/typed SQL with exact schemas passed, contradicting the earlier STABLE/null hypothesis. Actual image dependencies (`pg` 8.22, Zod 4.4.3) reproduce `P0001` for the uncast 12-parameter call; only `$12::timestamptz` succeeds with `created=true` and valid contracts. Both probes rolled back; counts and finance unchanged. PREPARE with last parameter typed text selects the defaulted-logo overload. A narrow source fix is being implemented independently, not yet accepted/gated/deployed. No registration UI retry. This separate defect does not reconstruct the original historical exception. |
| Isolated product lifecycle | The one approved product-only ordinary-auth flow completed cleanly, EXIT0, on the fenced restored-data exact-a40 image: owned eligible product/images/supplier deletion, one audit row and refresh absence passed; copied protected-reference refusal, actual Company Administrator denial and explicit owned DENY refusal passed. Histories, persistent files and financial fingerprints remained unchanged except the explicitly owned fixture removal. This is ISOLATED exact-a40 evidence, not production or final139 candidate acceptance, and does not reconstruct the original historical exception. No production deletion/deactivation, copied-password modification or fabricated session. Earlier scaffold failures remain retained, not counted as application-test retries. |
| Dark hover / branch labels | Local shared Dark hover/pressed tokens meet 4.5 text contrast; branch status uses location-confirmation label and one action. Ten actual desktop/mobile checks passed in 24.3s: all six setup tabs and Wallet actions normal/hover/focus/pressed in both themes; branch labels/budget table EN/AR/MS with RTL/no document overflow. New production acceptance pending. |
| Invitation UI / budgets table | Compact existing account treatment/localized role label and aligned six-column budget table with keyboard-scrollable mobile region; token, consent, password and metrics unchanged. EN/AR/MS render and missing/invalid-link checks pass. Valid invitation acceptance remains pending the registration fix and isolated normal-auth journey. |
| Budget / BranchAdmin | Integrated specialist candidate `068ac69` with typed legitimate ceiling refusal and additive139 UI/server/DB lifecycle ceiling justified by isolated custom-GRANT/raw lifecycle/evidence defects. Financial calculations, period selection, Wallet, recurring behavior and RLS unchanged; initial expiry fixture claim remains retracted. Specialist 61/integrated 91 focused passes; four native cases passed in the139/46-test gate. No live budget or destructive mutation. |
| Shared live updates | Bounded authorized durable-snapshot resync, one shared connection, fresh authorization before loads/emission, reconnect/fallback, dirty-form deferral and bounded reads integrated. No durable event replay, underlying-query cancellation, new grant, ledger or proxy change. Earlier 62 focused/4 browser and integrated 75 focused passes retained; three native authorization cases passed in the139 gate. New delivery bootstrap fix passes focused review/tests; refreshed whole-candidate and ordinary-auth production acceptance still pending. |
| Integrations / guides | Authenticated Owner Integrations returned 200/readable/no overflow; API/webhooks enabled, Slack disabled, zero connections/subscriptions/installations; Zapier runtime false/app-client IDs unconfigured. Accurate adapter/provider/Zapier labels pass 37 focused and six localized desktop/mobile checks. Controlled Slack workspace/dedicated credentials absent, blocking activation only. SERVER_MIGRATION/REBOOT_RECOVERY and 12-page illustrated PDF delivered locally; all pages reviewed, public readiness capture 21:33:44Z, PDF SHA256 `99e9210d98f911efc589997a4d4c66197b7ac86eb10851f6d931ed97de36e627`. No destination or host boot/cutover proof. These completed enhancements/guides are not core-workflow blockers. |
| Acceptance helpers / role gaps | Private read-only release/live helpers are frozen and root-reviewed, NOT RUN. Actual CAM, second Driver, off-device backup, destination server and whole-host boot evidence remain absent. Existing role metadata is not replaced by assumed email labels, fabricated sessions or role changes. |

Official diagnostics: [challenge solve issues](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/),
[Turnstile error codes](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/),
[cloudflared releases](https://github.com/cloudflare/cloudflared/releases),
[supported versions](https://developers.cloudflare.com/tunnel/downloads/#deprecated-releases).

No host restart/shutdown, new production release, financial mutation, historical
resend or agent smoke Send click has occurred in this resumed slice. An
unconfirmed user submission still consumes the conservative A reservation; zero
durable rows must not be rewritten as unused submission authority. Current
acceptance remains BLOCKED until the actual candidate regression/fix is reviewed
and required exact-head gates and core workflow evidence are complete.

## Historical deployed-core record (superseded status; evidence retained)

The remainder, including every following sibling heading, preserves the earlier
deployed-core checkpoint and its original evidence. Its current/remaining/
deferred wording is historical, not the final closure status at the top.
Mailbox receipt, shared-live/UI work, native139 coverage and delivered guides
have advanced. Historical failure, retry and skip explanations remain visible;
do not treat older pending wording as the present release identity or verdict.

**Core fixes deployed; overall recovery acceptance BLOCKED. Not demo-ready.**

The focused runtime/email/registration/product-lifecycle repair shipped in PR217. Required Nightly on that merged head subsequently exposed one pre-existing branch-URL test mismatch. A strictly scoped test-only correction shipped through PR218; its exact-main image/deployment and final Nightly passed, and installed identity/schema are verified. Final CI browser totals are322 passed/one flaky passed on the existing retry/19 intentional skips, plus18 visitor-recovery passes—not a clean323-pass result. One idle sender-only production trial passed; this is not Contact delivery or original live lifecycle acceptance.

Contact provider delivery and mailbox receipt are not verified: the normal managed verification widget leaves the real form's Send enquiry button disabled. No fake token, direct POST, verification bypass, historical replay or smoke resubmission was used. Original registration history and explicitly disposable live registration/product fixtures remain unavailable. Those original live journeys are not silently treated as passes.

The computer was not shut down, rebooted, restarted or power-cycled by this task. Observed boot ID remains `aaf793bb-7222-4663-8b5a-e84beab01c4b`, independently started 2026-10-07 13:47:55 +08. **Whole-host boot recovery is untested.** A deployment/container replacement is not a host reboot.

No financial transaction, payment, purchase, Wallet credit, budget increase, real product/account deletion, delivery claim/completion or account-role/password change was performed for acceptance. Private supplied account input remains intact outside Git; no credentials are included here. Existing dirty root checkout, prior worktrees and unrelated PR215 were preserved.

## Historical core record — Production identity and release

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

## Historical core record — Proven failure boundaries

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

## Historical core record — Contact routing, backlog and receipt evidence

- Existing route preserved: public support address `support@axora.management`; Contact internal recipient `thalththanwyd@gmail.com`; existing Resend outbound sender/transport retained. No visitor acknowledgement or CAM broadcast was enabled. Mail routing/provider secrets were not replaced.
- Exactly eight historical zero-attempt PENDING jobs were Infinity-held in one guarded audited transaction before repaired claims became active. Exactly eight corresponding audit UPDATE rows were verified. Original due timestamps are preserved in private operational SQL. Four historical UNCERTAIN jobs remain review-only.
- Latest20:04:18Z read-only metadata: all eight held PENDING/zero attempts/no provider IDs/no leases; no active suppression entries; no SENDING or due-pending work; six worker controls unchanged/unpaused/revision1; both new smoke labels have zero enquiries/outboxes. No agent-wide RESUME was used.
- Smoke labels `AXORA-RECOVERY-20261008-A/B`: zero actual submissions, enquiries, notification outboxes, acknowledgements or provider sends. The two-submission allowance has not been consumed.
- Provider acceptance, signed delivery event and recipient Inbox/spam receipt are separate evidence stages. **None is claimed for these new live smokes.** No recipient mailbox access was supplied.
- The queued-across-restart B scenario is not performed. Prepared private helper is not evidence of a trial. Never send a false durable-B handoff.

## Historical core record — Service recovery trials and observers

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

## Historical core record — Existing issue register:1–14

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

## Historical core record — Browser and role acceptance

Real production headed Chrome was used through the task-authorized normal login UI after Computer Use surfaces and Chrome DevTools MCP were unavailable. Private account input is read in memory; no auth storage state, password screenshots, traces/HAR or bearer links retained. Captures are not made on login/account routes. Actual role/scope was verified from live metadata and UI, not email labels.

- Owner `tayamhussam@gmail.com`: structured company/branch/product, logos, six setup tabs, wallet list and existing-company Wallet context checked. Normal theme states pass; Dark hover residual remains. Owner Company setup itself is read-only under the current existing role presentation; no permissions were widened.
- Company Administrator `malaysiaashrafo@gmail.com`, mewo1: shopping chooser→openai, correct delivery address and existing branch budget, empty cart and actual company Wallet read successfully. No product was added or top-up requested. Direct management product-record route renders404 without confidential commercial data.
- Branch Administrator `shehab111alslool@gmail.com`, mewo1/openai: correct scoped dashboard and shared branch layout read; lifecycle buttons incorrectly visible. No destructive action performed.
- Delivery Agent `alsaloulashraf@gmail.com`: delivery-only navigation/portal and available jobs read. No Claim/availability/status/location action; no active assignment means full delivery lifecycle untested.
- `owner@axora.management` is actually Owner, not CAM. No live CAM or second delivery-agent role is available; no fabricated sessions, promotion or role-cookie changes.
- Saved profile locales were not changed. Current live audits used English. EN/AR/MS focused/i18n and Arabic RTL fixture evidence exist locally; new production RTL/Malay structured-layout acceptance is not claimed.

Screenshots remain private under `/home/ashraf/Documents/Axora Recovery Evidence/2026-10-08/output/playwright/`. Loading-state captures are not used as layout/no-logo acceptance. The UI/UX skill's state-contrast and responsive checks exposed the residual Dark-hover defect; no global redesign/new palette was applied.

## Historical core record — Tests and required gates

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

## Historical core record — Backups, installed configuration and rollback

- Pre-change encrypted artifact: `/var/lib/axora-production/reset-backups/axora-reset-20261007T175617Z-cccd272be606.tar.gpg`. AES256/decrypt/isolated240-table/136-migration/uploads restore verified17:56:26Z. Ciphertext SHA256 `4b812fed5e4f0a414db80b4dfc5a49dfd6993ba3b948fa56d2a365350a779bb7`.
- Policy pre-migration backup: `/var/lib/axora-production/backups/axora-20261007T185834Z`.
- Post-deploy encrypted artifact: `/var/lib/axora-production/reset-backups/axora-reset-20261007T190147Z-9392334cf339.tar.gpg`, verified19:01:57Z after isolated240-table/138-migration/files restore. Ciphertext SHA256 `0ab1f47b7d8807fdf6c12687c50e1af811c2e75f53a164ec8b4ed7f03859e3f1`. Source backup `axora-20261007T190148Z`.
- Before trial1, currenta40 encrypted artifact `/var/lib/axora-production/reset-backups/axora-reset-20261007T194607Z-a40a70bef310.tar.gpg`, verified19:46:15Z,240 tables/138 migrations/files; ciphertext SHA256 `14cb647466a8b84f3e6a1d0afe8d3cb3fb6f8d69055863b8e795e494f0be1a79`. Source backup `axora-20261007T194607Z`. No off-device copy is implied.
- No production reset/restore/truncate or volume removal occurred. Disposable restore databases were guarded and removed by their verifier. No off-device backup destination is configured: single-host loss remains a material limitation.
- Current installed sealed release `/var/lib/axora-production/releases/a40a70bef3104d7e08959dfdc6e55a36ba6beb31` matches current state and migration manifest. Existing runtime/controller secrets remain external and persistent. Docker owns restart behavior; no competing daemon added. Only proven email grace20→45s changed in tracked Compose.
- App/five workers replaced during normal core deployment; Caddy container was also recreated by existing deployment procedure, with no Caddy/network/provider source or configuration change. Database/Tunnel/Tailscale DB were not restarted by this task.
- Previous core939 immutable image is locally available and compatible with schema138; its application source is identical to currenta40. Application rollback does not reverse migrations, audited holds, data or external effects. Rolling back farther to the pre-137/138 baseline image blocks its legacy permanent product deletion through revoked raw DELETE and restores its old email failure. Such baseline rollback is containment, not a weakening of grants. Inspect current `previous` before using the existing root rollback script.
- Short operations and rollback instructions: `docs/operations/RUNTIME_RECOVERY.md`; original component evidence: `CONTACT_EMAIL.md`, `REGISTRATION.md`, `PRODUCT_DELETE.md`, `ISSUE_REGISTER.md` in this directory.

## Historical core record — Deferred deliverables and exact blockers

1. Real Contact verification is not ready; no safe provider/recipient evidence can be inferred. Recipient Inbox/spam access unavailable. Historical UNCERTAIN/held backlog requires individual evidence reconciliation, not bulk replay.
2. Original live registration journey/exception and explicitly disposable lifecycle targets are unavailable. No questions are being repeated; no unsafe target is assumed disposable.
3. Final exact-main Nightly/image/deploy passed. Its one existing-retry mobile company-creation flake remains visible with unproven initial failure cause; prior939 Nightly failure also remains recorded.
4. Missing-Wallet/no-logo live fixtures, actual CAM/second driver and real RTL/Malay layout acceptance are absent.
5. PhaseC Add Budget precise error mapping, BranchAdmin UI/server boundary hardening, remaining visual work; PhaseD shared SSE/integrations; PhaseE migration PDF/runbooks remain deferred while core workflow acceptance is not clear.
6. `/home/ashraf/Downloads/Reports/Axora_Server_Migration_Guide.pdf`, `docs/operations/SERVER_MIGRATION.md` and `REBOOT_RECOVERY.md` are not delivered/verified. No destination host supplied or cutover/decommission executed. Whole-host boot remains prohibited/untested.

The deployed fix and green repository/infrastructure gates are useful evidence, not a guarantee of zero future failures or uninterrupted service from a single host. **Final acceptance: BLOCKED until the explicitly unverified core workflows and remaining required deliverables are proven.**
