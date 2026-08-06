# Approval-Limit Management Runtime

Status: P0-01 audited financial-authorization slice.

## Purpose

An approval permission answers **whether** an identity may approve. An approval
limit answers **how much**, in which currency, during which effective period,
and whether explicitly granted self-approval is permitted. These facts are
security-sensitive and financially material, so Axora does not allow application
code to write `approval_limits` directly.

The production application may execute only two narrow commands:

- `axora_set_approval_limit(...)`
- `axora_remove_approval_limit(...)`

The raw table and append-only permission history remain private.

## Supported Subjects

A limit belongs to exactly one subject:

- an exact active user and role assignment; or
- one canonical role within a company, branch, or department scope.

A user cannot change their own limit. A user also cannot change a role-level
limit for their own selected role, because that would indirectly change their
own financial authority.

## Supported Approval Permissions

Limits are accepted only for:

- `request.approve.other`
- `request.approve.self`
- `request.approve.over_budget`
- `request.approve.additional_actual`

A user-level limit is rejected unless the target currently possesses the exact
approval permission in the requested scope. A role-level limit is rejected
unless the canonical role owns that permission through `role_permissions`.
This prevents dormant limits from becoming unexpectedly active after a later
permission change.

## Self-Approval

Self-approval remains exceptional and individual:

1. the target must be a user, not a role;
2. the user must explicitly possess `request.approve.self`;
3. the limit permission must be `request.approve.self`;
4. `allow_self_approval` must be true;
5. amount, currency, budget, company ceiling, ownership, and workflow checks
   still apply at decision time.

Setting `allow_self_approval` on any other permission is rejected.

## Scope and Tenant Isolation

Limits support `COMPANY`, `BRANCH`, and `DEPARTMENT` scopes only. Every command
reloads the actor's exact live authorization snapshot and requires
`user.permission.manage` in the requested scope.

The command also verifies that the company, branch, and department are active
and correctly related. Department limits store the canonical parent branch when
a parent branch exists. A company administrator therefore cannot create or
remove a limit in another tenant, even if a client submits foreign identifiers.

## Amount and Currency

- currency is normalized to a three-letter uppercase code;
- amount is non-negative `numeric(18,2)`;
- more than two decimal places, non-finite numeric values, and overflow are
  rejected rather than silently rounded;
- each active user/role, permission, exact scope, and currency combination has
  at most one active limit.

The effective authorization evaluator still checks available virtual budget and
the contractual company ceiling separately. A large approval limit does not
bypass either control.

## Idempotency and Replacement

The initiating service persists `starts_at` before submitting the command. An
identical retry returns the active row without another history entry, auth
version increment, or session revocation.

Changing amount, effective period, self-approval policy, or reason closes the
previous active row and inserts a new immutable policy fact. Historical rows are
not overwritten or deleted.

## Audit and Session Invalidation

Every real set, replacement, or removal appends minimized before/after evidence
to `permission_change_history` with:

- actor;
- user or role subject;
- permission ID;
- typed scope IDs;
- currency and maximum amount;
- self-approval flag;
- effective period;
- mandatory reason and correlation ID.

No password, token, email body, raw network identifier, profile record, or
session cookie is stored.

A user-level change increments that user's `auth_version` and revokes active
sessions in the same transaction. A role-level change invalidates only active
users of that role whose live scopes intersect the changed company, branch, or
department. Users of the same role in another tenant are not disturbed.

## Precedence at Decision Time

Approval remains deny-by-default. The runtime requires all of the following:

```text
active account and exact live assignment
+ resource scope
+ approval permission
+ matching active limit
+ exact currency
+ self-approval permission and flag when applicable
+ available budget or explicit exception permission
+ company ceiling or explicit Axora override
+ valid request state and version
= allow
```

Removing a limit takes effect immediately; a permission without a matching limit
cannot authorize an amount-bearing approval.
