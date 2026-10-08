# Add Budget refusal and branch lifecycle authority

**Historical component investigation.** Current schema139 deployment, executed
native gates and actual read-only role/UI evidence are in
[FINAL_REPORT](FINAL_REPORT.md). Pending release/native wording below is superseded
there. The retracted expired-period probe and absence of real financial/destructive
acceptance remain limitations, not retrospectively converted into passes.

## Current focused period characterization — 2026-10-08

One separately reviewed, private in-memory PGlite run applied the immutable
139-migration chain and canonical application grants. It passed both focused
cases in 2.57 seconds with zero retries; no production financial mutation,
application change, migration change or new financial policy was made.

- A correctly selected `CLOSED` period with no `ACTIVE` successor returned
  SQLSTATE `AX003`, mapped to `BUDGET_UNAVAILABLE`. Selected complete budget,
  Wallet, recurring-allocation, schedule/refresh, ledger, command and audit
  fingerprints were unchanged.
- A correctly selected elapsed period still marked `ACTIVE` permitted the
  existing status-based Add Budget allocation: one allocation entry and one
  command in that same period. It did not automatically refresh or expire the
  period, change Wallet or recurring allocation, or alter the other selected
  financial/schedule rows. This characterizes the inherited contract; it is
  **not** proof of date-expiry refusal or a decision to change renewal semantics.

Private evidence: `budget-period-probe-01/run-01.log`, SHA-256
`bb91da1919ec343f40332aa00b027d0d133ebfb89af6e9ddf1c789b9c76c17ee`;
reviewed test SHA-256
`e7f0845ba99d2ba542bfbe432076a3c279d8d8688186b034186c82a106288f29`.
Fixture seeding respected the existing immutable-active-period trigger; no
trigger was disabled. This focused PGlite evidence is distinct from native
permission-GRANT expiry during a lock wait and from live acceptance. The earlier
wrong-account expired-period probe below remains retracted.

## Historical investigation

Baseline: `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`. This specialist work used
an isolated worktree and migrated PGlite fixtures. It performed no live budget,
Wallet, branch lifecycle, account or permission mutation. Production control and
the integrated release gates remain with the lead.

## Diagnosis and scope

The lead's separate read-only production diagnosis found that the proposed
addition exceeded the company's existing contractual authorization ceiling.
That is a legitimate refusal, not proof of a Company Wallet cash shortage. The
old Add Budget action collapsed the SQL reason into an inaccurate funds/retry
message, and its invalid-amount message did not match the component's code
comparison.

Isolated application-role fixtures reproduced ceiling refusal with no ledger,
Wallet or recurring change, successful replay after a newly active explicit
budget DENY, raw branch lifecycle UPDATE with supplied deactivation evidence,
and a custom-granted Branch Administrator passing the canonical lifecycle
permission boundary. Default Branch Administrator control exposure originates
from the route alias that also permits operational/department management.

The canonical deactivation routine also omitted the already-required
deactivation evidence; a fresh authorized deactivation would violate the existing
check constraint. Retained legacy organization-node branch lifecycle lacked the
current active-cart, delivery and request blockers.

The initial expired-period probe was **retracted**: automatic branch-budget
bootstrap meant it changed a secondary manual account, not the account selected
by Add Budget. Source selection still uses status `ACTIVE`, but no correct
expired-period runtime proof or authoritative replacement policy is claimed.
This candidate does not change period-selection, rollover or refresh semantics.

## Minimal repair

Migration 139 binds branch command parameters to the existing transaction audit
identity, locks the active actor and exact selected assignment before target
locks, and captures the live permission time after lock waits. Permission
management's existing user-first locking convention is retained. Branch
Administrator lifecycle is denied regardless of custom GRANT/delegation, while
the previous DENY-aware scope checks remain necessary for every other role.

Canonical deactivation keeps its operational blockers and idempotent repeat,
records deactivation evidence and retains audit/history. Empty deletion retains
the complete catalog-driven foreign-key scan and history refusal. Legacy branch
lifecycle retains its existing child/assignment guards and gains the same hard
role ceiling and operational blockers. Non-branch organization behavior is
unchanged.

The application role retains ordinary branch metadata UPDATE columns but cannot
raw-update active/deactivation-evidence columns or call private actor helpers.
Existing raw branch DELETE denial remains; canonical grants are replayed twice
in focused tests without restoring either bypass. No RLS, role default, tenant
scope or global authentication model is changed.

Add Budget revalidates live authority before replay and reports only typed safe
amount, authorization, missing-budget, command-mismatch and ceiling reasons.
Authorized ceiling refusal includes decimal-text limit, allocated authorization
and headroom. The allocation routine, aggregate, company lock, current-period
selection, append-only ledger/command storage and `apply_to_recurring=false`
remain unchanged. No Wallet balance is read as funding or modified.

EN/AR/MS refusal strings use a dedicated module; existing budget catalogs remain
unchanged. The form retains input and command identity on refusal, announces and
focuses errors, and disables an already completed command. Closing/reopening
intentionally starts a fresh command. Branch Administrator destructive controls
are absent; permitted operational Edit remains.

## Evidence and remaining acceptance

- Focused migrated, action, reason, render and adjacent regression files: 61
  passed across eight files. Four native cases are intentionally skipped without
  the explicit isolated runner; they are not counted as native success.
- App-role tests cover custom-granted Branch Administrator canonical/legacy/raw
  refusal, explicit DENY, foreign scope, inactive/revoked authority, audit-context
  mismatch, metadata preservation, Company Administrator/Owner evidence and
  repeat, retained history/FKs and active-cart protection.
- Eligible physical-deletion fixtures explicitly suppress only automatic budget
  bootstrap during isolated fixture creation. Normal bootstrapped branches remain
  referenced and protected. This is not a production deletion procedure.
- Four bounded loopback `axora_native_ci` tests are pending the lead's native
  gate: same-command concurrency, contractual-ceiling serialization, current
  DENY after an actor lock wait and GRANT expiry during an actor lock wait.
- No real mutation acceptance, native success, full release success or deployment
  is claimed by this document.

## Forward-only compatibility

No deployed migration was edited. A prior image may still show Branch
Administrator controls, but migration 139 rejects its prohibited lifecycle call.
Ordinary old capability calls already use the transaction audit identity and
remain signature-compatible; old Add Budget UI safely maps new typed refusals to
its generic failure. Do not restore raw lifecycle grants or undo schema/data
protections for an image rollback. Use a reviewed forward fix.
