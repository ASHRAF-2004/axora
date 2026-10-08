# Account registration recovery boundary

**Historical component investigation.** Current release, later overload repair,
normal-auth isolated setup and live duplicate evidence are in
[FINAL_REPORT](FINAL_REPORT.md). Pending wording below records this investigation's
original checkpoint, not current gates or overall acceptance. Original historical
exception/full-continuation/live disposable boundaries remain explicitly unverified.

## Current-source expired-token acceptance — 2026-10-08

ONE private RAM-only PGlite scenario passed: 1 test, 2.83 seconds, retry0.
All139 migrations and two canonical grant replays were used. A newly inserted,
legitimately historical invitation is eligible before its expiry and ineligible
now; no immutable dates or triggers were altered. The real application-role
inspection and consumption paths both return `expired`, before password
hashing or activation. Two inspection queries, zero hash calls, zero activation
transactions/writes and zero provider calls were observed. All public table
rows, sequences and Wallet view fingerprints (229 relations) are identical.
The RAM database was closed and token/password memory cleared.

This closes an isolated expired-token criterion; it is not native PostgreSQL,
live account setup, current-image restart or the unavailable original exception
evidence. The private probe01 import failed before any tests/database work due
to unsupported Vitest mock-API import resolution. Its failure is retained;
probe02 changes only supported import resolution and private evidence paths,
not assertions, application code, fixtures or repository release gates.

Probe02 log SHA256:
`c9cbe5791141aaf24dc87d2fb32fd64fb633e68784de5751c1583e5f5d532f49`.
Result SHA256:
`8ef71a89f4e6c888e53d36276504a50b1ec28660123e58ab3c21f6fd0e25e935`.
Application source matches tested0040/deployedd82; all private probe files stay
outside Git. The original required gates remain valid and were not rerun.

## Existing exact-head concurrency and replay evidence

These native PostgreSQL cases already passed in the recorded49-test exact0040
release gate; files are unchanged. They are not newly executed live scenarios:

| Criterion | Actual test / boundary |
| --- | --- |
| Concurrent duplicate invitation | `tests/delivery-guy-invitation-native-postgres.test.ts:508` runs two real `createInvitedUser` calls concurrently; one succeeds, the other refuses as invitation-pending; users1/invitations1. It does not fingerprint every side effect or inject browser double-click/HTTP loss. |
| Atomic single-use setup | Same file:278/:380 runs two actual setup-consumption calls concurrently; one succeeds/one refuses, membership/account activated/one consumed invitation/one assignment, password verification and authentication succeed. Synthetic delivery only; no provider/browser/restart claim. |
| Company command replay | `tests/company-creation-overload-native-postgres.test.ts:91` uses the actual native adapter: same command/payload returns the same company with created=false, changed payload conflicts; companies1/Wallet1 and guarded finance0. Sequential replay, not injected transport-response loss or a concurrent company race. |
| Diagnosed overload defect | Same file:63 reproduces node-pg unknown-parameter overload selection/P0001/no company; :91 verifies the corrected adapter and :116 the committed creation DENY. The original reported live exception remains unavailable. |

Normal-auth current immutable-image lifecycle results and live disposable
boundaries are separately reported in FINAL_REPORT. No existing live account
was reset, deleted or activated to manufacture evidence.

## Environment and evidence gap

The inspected production baseline is `cccd272be606cb2d05bd0f097cd725427506fb45`,
migration 136. Its public registration/request-access link leads to the Contact
page; authenticated provisioning uses company creation/user invitation and the
recipient's account-setup link. These are distinct workflows.

No retained original registration exception was located. Read-only production
inspection found six invitations marked SENT: five consumed and one expired.
No specifically disposable production invitation/account was designated. The
original live journey therefore remains **not reproduced with an evidence gap**;
no existing invitation was consumed or user reset for acceptance.

## Proven isolated defect and fix

The actual migrated application-role invitation flow reproduces a refused
pre-send claim (for example, a paused auth email agent). The caller then records
an unsuccessful delivery while the invitation is still PENDING. The old code
attempted the immutable state machine's forbidden `PENDING → FAILED` transition
and raised `P0001`. The raw invitation token is intentionally not persisted,
so leaving that invitation PENDING prevents a safe replacement.

`recordAccountSetupDelivery` now uses the already-permitted terminal
`PENDING → CANCELLED` transition for that unclaimed failure, and recognizes its
same-result acknowledgement on replay. It does not change claimed SENDING
delivery, provider-success handling, password policy, role/scope assignment,
token hashing/expiry, consent or single-use activation. CANCELLED tokens remain
ineligible; the account remains INVITED with passwordless credentials.

No schema migration or authentication bypass is introduced for this fix.
There is no claim that this isolated defect explains the unavailable original
live report.

## Focused evidence

`tests/account-registration-recovery.test.ts` executes the real migrated
database workflow under the application role and proves:

- A refused claim makes no provider call, records terminal cancellation and
  permits the existing replacement path; duplicate acknowledgement is safe.
- The cancelled bearer token is invalid and cannot activate the account.
- An unclaimed provider-success acknowledgement is rejected; no premature
  account activation occurs.
- A valid claimed invitation is delivered, completes consent/password setup
  once, preserves the requested role/locale and rejects duplicate identity
  creation and reused setup tokens.

The three focused tests passed against the integrated candidate on
2026-10-08. Final integrated gates and any safely authorized live workflow
acceptance are separate evidence, not inferred from these isolated tests.

## Final acceptance matrix — 2026-10-08 14:29:55 UTC checkpoint

This maps the six original Section6A acceptance bullets. The exact0040 native
release results remain valid for unchanged application source deployed as
d82/bc8/schema139; no test rerun or new live setup is implied.

| Original Section6A criterion | Proven evidence / environment | Not proved / remaining boundary |
| --- | --- | --- |
| Original valid-input workflow completes with correct account/company/membership and role; required approval remains | Earlier fenced b7 normal invitation/setup/sign-in/used-link journey; native `tests/delivery-guy-invitation-native-postgres.test.ts:278` checks the complete initial provisioning graph and activated account/membership/assignment, then authenticates. Current03 created ONE company and ONE invitation through normal forms; the invitation is SENT to a RAM-only sink and remains untaken. | The original reported route/exception is unavailable. Current03 password setup, final whole-continuation integrity and post-restart completion have not run. No specifically designated disposable live recipient/company or permitted delivery/setup action is supplied; existing live invitations must not be consumed. |
| Validation, duplicates, expired/used invitations and unauthorized scope return safe responses | Mocked server-action validation/error mapping in `tests/account-setup-completion-action.test.ts:116`, :131 and :142; actual migrated recovery/used-link checks in `tests/account-registration-recovery.test.ts:132`; native duplicate protection and creation DENY above. Expired02 exercises real app-role inspection/consumption on fresh PGlite/all139/two grants, returns expired before hashing/activation and preserves229 relation fingerprints. One designated live cross-scope duplicate refusal and its no-effects guards are separately recorded in FINAL_REPORT. | Mocked action mappings are not actual database expiry tests; expired02 is the isolated actual-path proof, not native/live expiry or restart proof. Live duplicate refusal does not certify the unavailable original valid-input journey or every tenant/role combination. |
| Duplicate clicks, response-loss retries and concurrency cannot duplicate or partially provision state | Native `tests/delivery-guy-invitation-native-postgres.test.ts:508` races two real invitation calls: one success/one pending refusal, users1/invitations1; :278/:380 races setup consumption: one success/one refusal. Native `tests/company-creation-overload-native-postgres.test.ts:91` replays one command/payload to the same company, rejects changed payload and verifies companies1/Wallet1/guarded finance0. | Command replay is sequential, not injected HTTP-response loss or a company-creation race. The invitation race counts users/invitations, not every side effect. No new browser double-click/transport-loss scenario or current03 whole-flow completion is claimed. |
| Temporary database/mail/dependency failure and app/worker restart recover with truthful durable pending state | Actual migrated PGlite pre-send refusal/cancellation and acknowledgement replay in `tests/account-registration-recovery.test.ts:76`/:116; native injected delivery-profile failure/rollback in `tests/delivery-guy-invitation-native-postgres.test.ts:612`. Current03 preserves the existing pending-setup SENT invitation without resend/reset. | No current-image registration workflow has crossed the bounded service restart or completed afterward. The historical idle sender-only a40 trial is not pending-registration recovery. Remaining trial2 preparation is separate and creates no acceptance result until actually performed and reported. |
| Direct API/server-action and native tests exercise permission and exception boundaries, with old/fixed regression where practical | The native49 gate includes actual application/native database paths. `tests/company-creation-overload-native-postgres.test.ts:63` reproduces node-pg overload selection/P0001/no company; :91 checks the corrected adapter and :116 committed creation DENY. The migrated cancellation regression exercises the diagnosed pre-send state-machine boundary; server-action tests separately cover safe presentation. | These establish specific isolated defects, not the missing original historical exception. Mocked action cases alone do not establish native permissions; no new production raw-action trial is claimed. |
| Same valid journey is re-tested after deployment and bounded restart, with isolated/live and email effects distinguished | Exact deployed image d82 is used in fenced current03; ONE normal company/invitation creation reached the RAM-only transport, with no real-provider send. Earlier isolated and live duplicate evidence remain separately labelled. | Current03 stopped at the integrity barrier below before setup/restart. No same-journey before/after restart proof or disposable live valid-input acceptance exists. No additional real email is authorized by this matrix; Contact's cap2 is closed. |

### Current03 integrity barrier, not a whole-flow pass

At14:29:55Z, the strict private guard preflight reached original-row and
audit-graph checks, then stopped with `canonical_temporal_discrepancy_changed`.
Audit events/temporal-invalid results changed from baseline2326/21 to2383/23.
All21 original invalid results are unchanged; newly invalid original events0.
The two additional invalid results concern new canonical read VIEW audit events
with17 microseconds of inverted timestamp ordering. Graph/hash errors remain0.
No historical audit data was rewritten and the guard was not weakened.

The new preflight made no authentication, deletion, restart or setup attempt.
Earlier continuation03 had already created the exact owned product
`a23bed0b-656c-4d50-a9e7-f39bd63f300a` ONCE; its DELETE count remains0.
The same pending-setup SENT invitation is untaken. New parent04 source has not
executed. This barrier is not a completed integrity/registration workflow,
current-image restart proof, or reconstructed original application exception.

Private strict-preflight and temporal-diagnostic evidence SHA256:
`be999e827f9eab5adca7127d3bb176e31ce115cf00fc5f4fbf5728b3510195db`;
`09a2d6235c2bb5decd5e1216d7e8dbafa0239d54086c760869e8e4eaa75e5eb9`.
FINAL_REPORT owns the overall verdict and any later actual trial result.
Conditional Slack/migration inputs do not block these independent core checks;
the exact missing live fixture/action authority remains a separate live boundary.
