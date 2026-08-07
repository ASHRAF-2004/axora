# Delegated Access Management Runtime

Status: P0-01 audited temporary-coverage slice.

## Purpose

Delegated access gives an active user temporary, narrowly scoped coverage without changing their canonical role or permanently widening their normal assignment. Typical examples are leave coverage, a backup Client Account Manager, a temporary approver, or short operational support inside one company, branch, or department.

Delegation is not a substitute for a permanent role assignment, company reassignment, approval limit, budget, contractual ceiling, or workflow-state check.

## Database Commands

The application uses two narrow `SECURITY DEFINER` commands:

- `axora_create_delegated_access(...)`
- `axora_revoke_delegated_access(...)`

The application role cannot directly read or mutate `delegated_access`, `delegated_access_permissions`, `delegated_access_scopes`, or `permission_change_history`.

## Required Command Context

A creation command carries:

- an immutable command ID for idempotency;
- the authenticated authorizer user ID;
- the authorizer's exact active role-assignment ID;
- the grantee user ID;
- the grantee's exact active role-assignment ID;
- one to twenty immutable permission codes;
- one to ten typed company, branch, or department scopes;
- an explicit start and end time;
- a mandatory reason.

The permission/scope cross-product is capped at 100 and one delegation cannot exceed 30 days.

## Authority Model

A delegation is valid only when all of the following remain true:

1. authorizer and grantee are different active users;
2. both referenced role assignments remain active;
3. every permission is marked delegatable;
4. the authorizer possesses `user.permission.manage` directly through the referenced role in every delegated scope;
5. the authorizer possesses every delegated permission directly through that role in every delegated scope;
6. no matching explicit denial removes the authorizer's direct authority;
7. the grantee role is compatible with every delegated scope;
8. a company user remains inside their own company membership;
9. the grantee has no matching explicit denial for a delegated permission;
10. the delegation is active and inside its effective period.

Direct role authority is deliberate. Permission overrides and another delegation cannot be re-delegated, preventing privilege chains.

## Grantee Scope Compatibility

- Company Administrator, Company Approver, Finance Reviewer, Auditor, and Receiving User may receive company, branch, or department coverage within their company.
- Branch Administrator and Branch Approver may receive branch or department coverage within their company, but never company-wide coverage.
- Department Administrator may receive department coverage only.
- Requester may receive branch or department coverage only.
- A Client Account Manager may receive temporary company coverage even when that company is not their normal assignment. This supports an authorized backup-manager window without rewriting the primary assignment.
- Platform Owner authority is never delegated.
- Supplier and delivery identities do not receive company procurement delegations through this command.

## Exact Assignment Binding

The delegation is bound to the grantee role assignment selected when it is created. Signing in through another assignment does not activate that delegation. Revoking or replacing the selected assignment stops the delegation immediately for new authorization checks.

## Continuous Revalidation

The effective-access snapshot does not trust a delegation merely because its row remains active. On every sensitive authorization load, PostgreSQL rechecks the original authorizer's exact direct role authority for every delegated permission and scope.

Therefore, any of these changes withdraw delegated authority immediately for new requests:

- authorizer deactivation;
- authorizer assignment revocation;
- role permission removal;
- matching explicit denial;
- company, branch, or department deactivation;
- delegation expiry or revocation.

## Permission Precedence

Runtime evaluation remains:

```text
matching explicit denial
→ matching explicit grant
→ live database role grant
→ active, live-authority delegation
→ deny
```

A delegation may extend both permission and resource scope, but it never bypasses an explicit denial.

## Financial Separation

Delegating an approval permission does not create financial authority by itself. An amount-bearing approval still requires a matching active approval limit, currency, self-approval rule, budget state, contractual ceiling, resource ownership rule, and valid workflow state.

`request.approve.self` is not delegatable. Self-approval remains an individual explicit permission and approval-limit decision.

## Idempotency and Conflict Handling

The client generates one UUID command ID and reuses it after an uncertain network result. Repeating the same command returns the existing delegation without another audit event or authorization-version change. Reusing the ID with a different actor, grantee, assignment, schedule, permission set, scope set, or reason fails as a conflict.

## Audit and Session Invalidation

Creation and revocation append minimized before/after evidence to `permission_change_history`, including:

- machine delegation and command IDs;
- authorizer and grantee assignment IDs;
- permission codes;
- typed scope identifiers;
- effective period;
- status;
- actor, target, reason, timestamp, and correlation ID.

No password, token, cookie, email body, raw IP address, browser signal, or private identity hash is recorded.

A successful creation or revocation increments the grantee's `auth_version` and revokes active sessions in the same transaction. The user must establish a new session before the changed authority can be used.

## Compatibility and Forward Fix

Legacy unbound delegation rows are preserved for historical integrity but are excluded from authorization. A future administrative UI may list and explain them, but it must not silently convert them into active managed authority.

The migration is additive. Application rollback may ignore the new commands while the schema remains forward-compatible. Removal of the schema or audit history requires a separately reviewed forward migration, not a destructive rollback.
