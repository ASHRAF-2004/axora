# Add Budget refusal and branch lifecycle authority

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
