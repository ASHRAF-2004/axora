# Scoped Access Administration Runtime

## Purpose

This P0-01 slice makes the normalized authorization model operable from the Axora user administration interface without granting the application role direct read access to private policy tables.

The surface is intentionally assignment-centric. One user can have more than one active role assignment, and every displayed permission, limit, delegation, and history entry is evaluated against one selected assignment and its exact scope.

## Runtime entry points

### Read capability

`public.axora_access_administration_snapshot(actor_user_id, actor_role_assignment_id, target_user_id, target_role_assignment_id, captured_at)` returns one minimized JSON document.

The function is `SECURITY DEFINER`, uses a fixed `pg_catalog,public,pg_temp` search path, is not executable by `PUBLIC`, and is the only new database capability granted to `axora_app`.

Before returning data it:

1. resolves the actor's exact active role assignment through `axora_effective_access_snapshot`;
2. verifies that the target account is active, fully established, and has an active assignment;
3. requires `user.view` or `user.permission.manage` for the selected assignment scope;
4. chooses only among assignments the actor can actually see when no assignment identifier is supplied;
5. computes permission-management and audit-history access independently;
6. filters every returned assignment and history item through live scope containment.

A newer assignment in another tenant is ignored rather than leaked or allowed to hide a valid in-scope assignment.

### Mutation capabilities

The page does not update policy tables directly. It uses the already-audited commands:

- `axora_set_user_permission_override`;
- `axora_remove_user_permission_override`.

Both commands revalidate the actor's exact role assignment and target assignment, enforce scope boundaries, append minimized history, advance the affected user's authorization version, and revoke active sessions atomically.

The server actions require:

- an authenticated account with the compatibility `manage_users` route capability;
- a recent password step-up bound to the same session, assignment, scope, and authorization version;
- server-bound target and scope identifiers from the loaded snapshot;
- a known permission code;
- a reason between 3 and 500 characters;
- a valid optional effective period.

Database denial details are not returned to the browser. A rejected or stale command produces one non-revealing recovery notice.

## Snapshot contents

The snapshot includes only facts needed by the administration page:

- target display name, work email, account kind, active status, authorization version, locale, and optional job title;
- visible active role assignments and their named scopes;
- the selected assignment and selected scope;
- role permission codes and effective scopes;
- relevant permission options with role-source, current-effective, high-risk, and actor-can-grant flags;
- active explicit grants and denials that contain the selected resource scope;
- active user- or role-based approval limits that contain the selected resource scope;
- live delegated access bound to the selected target assignment;
- at most fifty visible, scope-intersecting access-history entries.

The snapshot does not contain:

- passwords or password hashes;
- account-setup, reset, verification, or session tokens;
- session cookies or token hashes;
- raw IP addresses, network hashes, browser signals, or user-agent details;
- provider credentials or email bodies;
- private visitor identity hashes;
- unrestricted raw policy rows.

## Scope semantics

The selected assignment represents a resource scope. A broader active rule can affect a narrower selected resource:

- a company denial can affect a branch or department in that company;
- a company approval limit can apply to a branch assignment;
- a branch rule can affect a department attached to that branch.

The page therefore displays broader overrides and limits when they contain the selected resource. Removal remains stricter: the actor must possess `user.permission.manage` in the override's exact stored scope.

Assignments in another company, branch, department, supplier, or delivery context are excluded unless the actor's live snapshot contains that scope.

## Permission interpretation

For each visible permission the page distinguishes:

- **Included by role**: the selected role has the permission in `role_permissions`;
- **Actor can grant**: the actor currently possesses the permission in the selected resource scope;
- **Effective**: the target can currently use the permission after role grants, explicit grants, explicit-denial precedence, and valid delegated authority are evaluated.

An explicit denial always wins. Approval permissions still require a separate active approval limit when an amount-bearing decision is attempted.

## Assignment selection

When the URL contains `?assignment=<uuid>`, the function returns that assignment only if it is active and visible to the actor.

Without an assignment parameter, the function selects the newest visible active assignment. It does not first select the user's globally newest assignment and then test it, because that would let an unrelated tenant assignment cause false not-found behavior.

## Audit history

History is returned only when the actor has `audit.view` in the selected scope.

Direct permission, role, and approval-limit events are matched by their normalized top-level scope. Delegation events are matched through their stored scope arrays. An event is visible only when its scope and the selected assignment scope intersect through containment.

The history payload is the already-minimized evidence stored in `permission_change_history`; no credential or network evidence is added by this slice.

## UI behavior

The user list links fully established active accounts to `/users/[id]/access`.

The access page provides:

- an identity summary;
- a visible-assignment selector;
- grouped permission outcomes;
- separate grant and deny forms;
- exact-scope override removal;
- approval-limit and delegated-access visibility;
- localized history for English, Arabic, and Malay.

Read-only actors can inspect assignments where `user.view` is allowed, but mutation forms are suppressed unless `user.permission.manage` is effective for the selected assignment.

## Database grants

`database/admin/apply-app-grants.sql` re-applies the same boundary used by the forward migration:

- raw authorization tables remain revoked from `axora_app`;
- internal containment, trigger, and helper functions remain private;
- only the minimized snapshot and audited mutation commands are executable.

This protects hybrid imports and baseline resets from accidentally restoring broad grants.

## Deployment and rollback

Migration 043 is additive. It creates or replaces one read function and changes no existing identity, assignment, permission, approval limit, delegation, session, request, company, document, budget, visitor, or audit row.

Rollback is forward-fix only after production migration. Removing application links and function execution grants can disable the feature without deleting evidence or rewriting policy state. A corrective migration should replace or revoke the function rather than resetting the database.

## Verification requirements

Release is blocked unless all of the following pass:

- complete migration chain through 043;
- populated-schema forward upgrade;
- cross-tenant and inactive-assignment denial;
- broader-scope override and approval-limit visibility;
- exact-scope removal authority;
- delegated-access and history filtering;
- strict TypeScript snapshot validation;
- server-action step-up and non-revealing failure behavior;
- English, Arabic, and Malay copy checks;
- application grant reapplication checks;
- full unit, integration, browser, visitor-recovery, production build, deployment-asset, and container gates.