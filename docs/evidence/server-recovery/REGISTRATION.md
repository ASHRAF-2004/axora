# Account registration recovery boundary

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
