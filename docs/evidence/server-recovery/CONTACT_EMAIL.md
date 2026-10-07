# Contact/email recovery evidence

Investigation: 2026-10-08 Malaysia time. Production release inspected:
`cccd272be606cb2d05bd0f097cd725427506fb45`, migration 136. This document records
the email specialist's read-only baseline and isolated regression evidence;
deployment, real Contact smoke, mailbox verification and restart acceptance are
owned by the release lead and are not yet proven by this evidence.

## Proven failure

The sender's `/health/ready` answered HTTP 200 `{ "status": "ready" }` while
transactional queue claims failed every ten seconds. Available container logs
contained 6,306 `transactional_email_outbox_poll_failed` events in the inspected
24-hour window. PostgreSQL recorded the precise exception immediately after the
available DB startup: `permission denied for function
axora_invoice_email_recipient_suppressed`, first observed at
2026-10-07 00:16:00 UTC. The claim never reached the provider.

The source chain is `claimTransactionalEmailOutbox()` in
`src/lib/transactional-email.ts` → suppression UPDATE → private invoice helper.
Migration 076 revokes PUBLIC from the three invoice email helpers.
`database/admin/apply-app-grants.sql` also explicitly revokes them from
`axora_app`. The worker nevertheless called those helpers directly, so a grant
replay preserves the broken runtime boundary. A read-only transaction with
`SET LOCAL ROLE axora_app` reproduced the denied helper invocation. No live job
was claimed or sent during diagnosis.

The isolated regression runs the real Contact persistence, claim and completion
code against all migrations and the actual deployment grant script. Before the
repair all three lifecycle cases failed with the same denied helper exception.
After correcting that boundary, the regression exposed two further failures:

- Completion attempt metadata inferred inconsistent types for parameter `$7`
  (PostgreSQL `42P08`); explicit integer casts fix the actual completion query.
- Retry completion could not execute `axora_email_retry_delay(integer)`
  (`42501`); the live application role likewise lacks this grant. It is a pure,
  immutable interval calculation with no table access.

Native PostgreSQL read-only PREPARE reproduced the original completion error
`42P08: inconsistent types deduced for parameter $7; text versus integer`.
The corrected PREPARE parsed successfully in the same live application role
transaction, then was deallocated and rolled back without executing delivery
completion or changing data.

The available live metadata had four Contact and four invoice jobs PENDING with
zero attempts and no attempt timestamp/provider ID. Four older jobs were already
UNCERTAIN with `lease_expired`. Provider lifecycle evidence shows historic
successful delivery and no suppressions in the inspected events. Workflow
email submissions had succeeded. No mailbox access was used; Gmail Inbox
receipt remains unverified. Earlier unavailable boot logs are not reconstructed
as evidence.

## Repair

Migration 137 provides two constrained worker capabilities. Queue eligibility
exposes only ready/suppressed booleans. Invoice payload access requires the
exact outbox ID and live SENDING lease ID. Both require the non-user
`transactional-email-worker` transaction identity and reject user/role contexts.
The original unrestricted invoice helpers remain denied to `axora_app` and
PUBLIC. The grant script preserves these constraints when replayed.

The email sender now reports readiness from recent progress in both queues,
with bounded startup/stall detection. A failed claim or completion produces
HTTP 503 degraded readiness; the existing ten-second poll reconnects after the
dependency returns. Failure logs contain only queue/action/stage and SQLSTATE
or numeric HTTP status, never queue bodies, recipients, tokens or exception text.
Graceful stop prevents new claims and drains the active poll. A stop grace of
45 seconds is recommended: one active claim/provider/completion operation has
5 + 7 + 5 second request limits, and normal paired queue polling can take 34
seconds. The release lead controls the Compose configuration.

## Focused verification

Six focused files passed 39 tests, including:

- One durable enquiry/outbox; idempotent replay does not duplicate; no visitor
  acknowledgement is added; successful provider acceptance is completed once.
- Lost local acknowledgement after provider acceptance leaves a persisted lease.
  After expiry, a fresh worker records UNCERTAIN and never resends. A late old
  lease completion is rejected.
- Provider outage backoff survives the worker; retry uses the same delivery ID
  and a new lease; durable attempts record retry then sent.
- Deployment grants can be replayed twice without losing worker capabilities.
- Actual paid-invoice/document fixtures yield metadata only to the worker's
  live exact lease. Pending, wrong/expired lease and ordinary user contexts are
  rejected, and the original raw payload remains private.
- Readiness becomes degraded on claim failure/stalled progress and recovers
  after the next successful poll. Polls do not overlap; stop drains active work.
- A provider send accepted before the completion response is interrupted occurs
  only once; a fresh poll does not replay the SENDING job.

The six-file focused pass was repeated against the lead's canonical dependency
installation after confirming identical package/lock hashes. Changed-file ESLint,
native verification shell syntax and `git diff --check` passed. The native release
script now verifies capability grants, private raw helper denial, worker/user
context rejection, unknown-lease isolation and actual completion SQL parsing.
The full native gate, final release gates and live acceptance must be appended
by the lead using the integrated candidate.

Independent review also found that an HTTP 200 completion response was accepted
without checking `recorded: true`. Both queues now reject false, missing or
malformed acknowledgement. Six isolated regressions verify degraded health,
no duplicate provider send and no private material in logs; the two sender
focused files passed 26 tests after that correction.

## Actual process recovery through isolated transports

`tests/email-sender-process-recovery.test.mjs` starts the real sender in separate
Node processes, with its pinned app/Resend URLs mapped exclusively to loopback
fixture servers. All secrets and recipient/message inputs are synthetic. The
fixture queue persists between child processes; the real PostgreSQL state
transitions are verified separately by the lifecycle test above. No production
service, queue or provider is used by these subprocess trials.

All three process scenarios passed in 10.63 seconds in the evidence run:

| Scenario | Measured recovery | Result |
| --- | --- | --- |
| App queue unavailable at worker startup, then restored | 9,972 ms until readiness; 55 ms after graceful restart | Health degraded while claims failed; existing ten-second poll recovered without queue repair; no sends |
| SIGTERM after provider acceptance, while completion response was held | 123 ms graceful drain, including a controlled 100 ms hold | Process waited for recorded completion; one provider acceptance and one local completion; restart sent no duplicate |
| SIGKILL at the same accepted-before-acknowledgement boundary | 56 ms restart readiness after simulated lease expiry | Queue moved from SENDING to UNCERTAIN; one provider acceptance, zero local completions; no replay |

These are local fixture timings and service/process trials, not production
recovery times or host reboot evidence. The actual database regression proves
expired leases and late acknowledgement semantics; production acceptance and
mailbox receipt remain pending for the lead.

Read-only sibling-worker inspection found budget, document, cleanup and
integration readiness HTTP 200 with no active work at the inspected instant.
Cleanup/integration retained logs contain database administrator termination
`57P01`, followed by `Unhandled 'error' event` on `BoundPool`, both at
2026-10-07T05:46:11.363Z. Their next startup log is
2026-10-07T05:50:03.259Z, about 232 seconds later. The shared app pool and four
worker pool constructors have no idle error listener in the inspected release.
`pg-pool` purges an errored idle client before emitting the pool error. A bounded
isolated actual `pg.Pool` test with synthetic clients exited 1 without a listener;
with a listener it exited 0, captured `57P01`, created a fresh client and completed
the next query. This corroborates the retained idle error failure, without
terminating a live PostgreSQL connection. The lead owns any common pool repair.
Budget/document lack an observed retained fatal event, so their exposure is an
inference from their constructors. No broad worker refactor is included here.

## Backlog/restart safety

Repairing claim authorization can automatically activate historical jobs.
Before applying the migration/release, the lead must preserve metadata evidence
and place the explicit eight historical PENDING IDs on an audited infinity hold.
Do not bulk retry or resend them. Check durable attempts, provider fingerprints,
and provider delivery ID evidence before releasing a particular job. Existing
UNCERTAIN rows require the established owner-only reconciliation path; never
generate a replacement send ID to remove uncertainty.

The existing agent-wide RESUME operation releases infinity-held jobs and must
not be invoked blindly for this backlog. Two uniquely labelled real Contact
smokes are the entire authorized send budget for this pass. Provider accepted,
provider delivered, and recipient mailbox verified are distinct evidence states.
No live sends, queue changes, provider configuration changes, migrations or
service restarts were performed by this specialist.
