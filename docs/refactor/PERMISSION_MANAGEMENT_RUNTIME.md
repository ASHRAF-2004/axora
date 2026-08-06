# Scoped Permission Management Runtime

Status: P0-01 audited management slice.

## Purpose

Explicit user grants and denials are security-sensitive authorization changes. They must not be implemented as direct application writes to policy tables. Axora therefore exposes two narrow database commands:

- `axora_set_user_permission_override(...)`
- `axora_remove_user_permission_override(...)`

The production application role can execute those commands but cannot directly read or mutate `user_permission_overrides`, `user_scopes`, delegations, approval limits, or permission-change history.

## Required Context

Every command carries:

- the authenticated actor user ID;
- the actor's exact selected role-assignment ID;
- the target user ID and exact selected role-assignment ID when setting access;
- the immutable permission code;
- one typed platform, company, branch, department, supplier, or delivery scope;
- the grant or deny effect;
- an explicit effective-start timestamp and optional end timestamp;
- a mandatory reason.

The caller creates and retains the effective-start timestamp before submission. Any retry after a timeout or uncertain response must reuse that same timestamp and payload. The database therefore recognizes the repeated operation as the same logical override rather than creating another authorization change.

Display names, email addresses, job titles, hidden form fields, and client-provided company IDs never establish authority.

## Enforcement Order

The database command locks the participating identities, reloads live effective-access snapshots, and then enforces:

1. actor and target are different users;
2. both exact role assignments remain active;
3. the actor possesses `user.permission.manage` in the requested resource scope;
4. the target's current effective scope contains the requested scope;
5. a grant is limited to a permission the actor currently possesses in that scope;
6. a denial cannot remove essential Platform Owner permissions;
7. one active override exists per user, permission, and exact scope;
8. every change appends minimized before/after evidence to `permission_change_history`;
9. the target's `auth_version` advances;
10. every active target session is revoked in the same transaction.

A repeated identical set or remove command returns the existing result without creating another history event or incrementing the authorization version again.

## Precedence

The live policy evaluator applies:

```text
matching explicit denial
→ matching explicit grant
→ live database role grant
→ active scoped delegation
→ deny
```

Resource scope is evaluated independently. A permission never broadens a user's tenant or resource scope by itself.

## Protected Ownership

The command rejects explicit denial of these essential Platform Owner capabilities:

- `platform.view`
- `user.permission.manage`
- `settings.manage`
- `audit.view`

The existing transactional last-active-Platform-Owner protections remain authoritative for account deactivation and role lifecycle changes.

## Data Minimization

Permission history contains machine permission ID, typed scope identifiers, effect, effective period, actor, target, reason, and correlation ID. It does not contain passwords, tokens, email bodies, raw IP addresses, profile data, or session cookie values.

## Compatibility Boundary

Existing routes continue to use their established permission checks until they are migrated domain by domain. The new commands write policy facts consumed immediately by the live effective-access snapshot introduced in migration 037.

Approval-limit and delegated-access management use the same command pattern but are delivered in subsequent focused slices so each financial/security rule is independently testable.
