# Role and Scope Lifecycle Runtime

Status: P0-01 audited identity-authority lifecycle slice.

## Purpose

A role assignment is the authoritative link between one established account, one canonical role, and one typed platform, company, branch, department, supplier, or delivery scope. Job titles and display labels remain descriptive only.

Role and scope changes must not be implemented by editing `users.role_id`, trusting hidden form fields, or directly rewriting existing assignment rows. Axora exposes two narrow commands:

- `axora_assign_user_role_scope(...)`
- `axora_revoke_user_role_scope(...)`

## Canonical Role Contracts

The database validates account kind and scope before accepting an active assignment:

- Platform Owner, Human Resources Management, and Technical Support use platform scope on platform accounts.
- Client Account Manager uses one company scope on a platform account.
- Company Administrator and Company Approver use company scope.
- Branch Administrator and Branch Approver use branch scope.
- Department Administrator uses department scope.
- Requester uses branch or department scope.
- Finance Reviewer, Auditor, and Receiving User use company, branch, or department scope.
- Delivery Guy uses delivery scope.

Retained aliases remain valid only for existing invitation/bootstrap compatibility. New audited lifecycle commands accept canonical role keys.

## Assignment Authority

The database combines two independent checks:

1. the actor must possess live `user.permission.manage` authority in the requested scope; and
2. the actor's canonical role must be allowed to manage the requested target role and scope.

Platform Owners may manage all canonical account-role contracts. Human Resources Management assigns leads and customer companies to Client Account Managers. Company Administrators manage company identities inside their company. Branch and Department Administrators can manage only subordinate scoped identities when an explicit permission grant also gives them `user.permission.manage`.

The two-check model allows controlled customization without letting a permission override erase the hierarchy boundary.

## Target and Resource Validation

The target must be an active, fully established account for audited lifecycle commands. The database rejects:

- cross-account-kind role changes;
- cross-company role assignment;
- inactive companies, branches, or departments;
- branch and department identifiers from another company;
- Delivery Guy assignments without an active delivery profile;
- self-assignment and self-revocation;
- a non-owner role assignment while an active Platform Owner identity is still selected.

Company membership must already be active. Branch or department support assignments are created or reactivated transactionally when an authorized role assignment needs them.

## Append-Only Identity History

Role assignment identity fields are immutable after insertion:

- user;
- role;
- scope type;
- company, branch, department, or supplier identifiers;
- assigner;
- assignment time.

A role or scope change therefore creates a new assignment and revokes the old one. Revoked assignments cannot be reactivated, and assignment rows cannot be deleted.

## Idempotency

Every command carries a caller-generated UUID correlation ID. A successful assignment uses that UUID as the new assignment ID and records it in append-only permission-change history.

Repeating the same command returns the existing result without another assignment, audit event, authorization-version change, or session revocation. Reusing a command ID with different target, role, scope, or reason fails as a conflict.

## Preferred Identity and Sessions

A successful assignment becomes the target's preferred compatibility identity. The normalized role assignment remains authoritative; legacy `users.role_id`, company, branch, and owner fields are updated only to keep older read paths and login candidate ordering consistent.

Every successful assignment or revocation:

1. advances the target's `auth_version`;
2. revokes every active target session in the same transaction; and
3. requires a fresh sign-in before the changed authority is used.

After revocation, Axora selects the newest remaining active assignment as the compatibility preference. If no assignment remains, the account keeps its historical identity row but has no valid authenticated scope.

## Critical Administrator Protection

Database triggers, not UI counts, protect critical identities under concurrency.

### Platform Owner

- The last active Platform Owner assignment cannot be revoked.
- The last active Platform Owner account cannot be deactivated, suspended, stripped of owner status, or moved to another account kind.
- Platform Owner user rows are retained for audit and cannot be deleted.
- A second active Platform Owner must exist before the first can be demoted or deactivated.

### Company Administrator

- The last active Company Administrator for an active company cannot be revoked or deactivated.
- The count is tenant-specific and requires an active company membership.
- A backup Company Administrator must exist before the current final administrator can lose access.

Advisory transaction locks serialize competing critical-role removals so parallel requests cannot both pass a stale count.

## Invitation Compatibility Boundary

The existing invitation transaction still inserts one role assignment directly. Migration 042 keeps application `INSERT` access temporarily but places it behind the same database role/account/scope validation trigger.

Post-setup role changes cannot use direct `UPDATE` or `DELETE`; the application role receives only:

- validated assignment `INSERT` for the retained invitation path;
- the audited assign command;
- the audited revoke command.

A later focused slice will migrate invitation initialization to a dedicated command and remove the final raw assignment insert privilege.

## Audit and Data Minimization

Assignment and revocation events append machine-readable evidence to `permission_change_history`, including assignment ID, canonical role, typed scope identifiers, actor, target, reason, timestamp, and correlation ID.

The history never contains passwords, setup/reset tokens, session cookies, raw IP addresses, browser signals, email bodies, provider secrets, or private identity hashes.

## Forward-Fix Policy

Migration 042 is additive. Application rollback may ignore the new commands while the schema and audit history remain intact. Removing assignment history, critical-role guards, or command records requires a separately reviewed forward migration; destructive rollback is not permitted.
