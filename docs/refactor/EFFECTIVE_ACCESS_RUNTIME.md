# Live effective-access runtime

Status: P0-01 runtime slice.

This layer connects the additive authorization-policy foundation to an
authenticated server request without placing mutable permissions in a browser
cookie, URL, local storage, or long-lived session token.

## Request flow

```text
Signed session cookie
→ live session/account validation
→ exact selected role-assignment ID
→ axora_effective_access_snapshot(...)
→ strict schema validation
→ session/snapshot consistency checks
→ stable permission evaluation against one resource
→ allow or fail closed
```

The snapshot contains only authorization facts:

- active account kind, owner flag, and authentication version;
- selected role assignment and role key;
- current role/direct/backup scopes;
- current database role permissions;
- active scoped permission grants and denials;
- active delegated permissions and scopes;
- active approval limits and currencies.

It never returns an email address, phone number, password hash, session token,
invitation token, reset token, provider credential, raw IP address, or document
content.

## Why the snapshot is loaded live

Permission, scope, approval-limit, or delegation changes must apply to the next
sensitive request. Persisting the full policy inside a long-lived cookie would
permit stale authority after an administrator removes access. The signed
session carries only the selected role-assignment identity and authentication
version; the mutable authorization facts are loaded from PostgreSQL.

## Least-privilege database boundary

Migration 037 installs one `SECURITY DEFINER` function:

```text
axora_effective_access_snapshot(user_id, role_assignment_id, captured_at)
```

The production application role may execute this function but receives no raw
`SELECT` privilege on user scopes, permission overrides, delegations, or
approval limits. The function accepts only an active assignment belonging to
an active account and returns `null` for a revoked or mismatched identity.

A trigger keeps the role-assignment-backed `user_scopes` row synchronized for
new assignments and revocations. Existing migration-036 records are repaired
idempotently during migration 037.

## Runtime APIs

`src/lib/effective-access.ts` loads and validates the minimized snapshot.

`src/lib/effective-auth.ts` exposes:

- `evaluateStablePermission` for an already validated session;
- `getCurrentStableAuthorization` for the current request;
- `requireStablePermission` for API/domain commands;
- `requireStablePagePermission` for server-rendered pages.

The result includes the authenticated user, the live policy snapshot, and the
allow/deny decision. Denied commands receive a generic server-side error; page
checks redirect to the existing access-denied route. No private policy detail
is returned to the browser automatically.

## Precedence and scope

For one permission and resource:

1. a matching active scoped denial wins;
2. a matching active scoped grant may allow;
3. the selected role's database permission set may allow;
4. an active delegation may extend both permission and scope;
5. approval actions additionally require a matching active limit, currency,
   self-approval rule, sufficient budget or over-budget authority, sufficient
   company ceiling or Axora exception authority, and a valid resource state.

A grant for Company A does not grant the same permission in Company B. A
revoked or expired delegation is excluded by the database function and checked
again by the pure authorization policy.

## Compatibility boundary

Retained pre-normalization sessions and deterministic demo mode use the static
canonical role defaults temporarily. New role types that require department or
multi-company session selection remain hidden from account creation until the
next P0-01 slice extends role-assignment identity selection and the admin UI.

Existing routes continue using their established compatibility permission
checks until they are migrated by domain. New money-, security-, and
cross-tenant-sensitive commands should use the stable permission APIs.

## Rollout and rollback

Migration 037 is additive and forward-compatible with the application release
from migration 036. Rolling application code back leaves the new function and
trigger unused; it does not require a down-migration. The current production
role assignment, session, company, request, budget, visitor, and audit rows are
not rewritten.
