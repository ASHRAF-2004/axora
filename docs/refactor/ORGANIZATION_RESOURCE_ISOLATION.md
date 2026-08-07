# Organization Resource Isolation Runtime

## Purpose

This is the first P0-02 data-isolation slice. It replaces company and branch
directory reads that inferred scope from mutable session fields with one
assignment-aware database capability that resolves resource ownership from
trusted rows before authorizing access.

The slice covers:

- company directory reads;
- branch directory reads;
- branch-level budget-field minimization; and
- reusable single-resource authorization for companies, branches, and
  departments.

Request, document, delivery, export, search, notification, and background-job
isolation remain separate P0-02 slices. They must use the same boundary instead
of inventing new tenant predicates.

## Security model

The application supplies only the authenticated user identifier, exact live
role-assignment identifier, requested permission, resource kind, and opaque
resource identifier. The database then:

1. resolves the exact active actor assignment;
2. confirms the account is active and fully established;
3. rechecks the assignment's current role/scope contract, memberships,
   branch/department assignment, supplier membership, or delivery profile;
4. loads the minimized effective-access snapshot;
5. resolves company, branch, or department ownership from database rows;
6. applies scope containment, explicit-denial precedence, explicit grants, role
   grants, and live delegated authority; and
7. returns a minimized result or `NULL`.

Missing, malformed, inactive-assignment, revoked-assignment, and out-of-scope
requests all produce the same unavailable result. Database denial details are
not returned to the browser.

## Database capabilities

### Internal functions

`axora_live_authorization_snapshot(actor_user_id, actor_role_assignment_id, at)`
revalidates current account and assignment readiness before loading the existing
effective-access snapshot.

`axora_resolve_organization_resource_scope(resource_type, resource_id)` maps a
trusted company, branch, or department row to its canonical scope. The caller
cannot provide a company or branch identifier to alter that ownership.

Neither internal function is executable by `PUBLIC` or `axora_app`.

### Application capabilities

`axora_organization_resource_access(...)` returns a minimized trusted resource
scope only when the requested permission is currently effective. It supports
`COMPANY`, `BRANCH`, and `DEPARTMENT` resources.

`axora_organization_directory_snapshot(...)` returns only visible companies and
branches. Company visibility supports platform-wide `company.view`, assigned
company visibility for client account managers, and the parent-company context
of a branch- or department-scoped user. Branch visibility supports exact
company, branch, and parent-branch-of-department containment.

The application role can execute only these two public capabilities.

## Secondary-field isolation

A visible branch does not automatically reveal its financial authorization
state. The snapshot includes `monthlyBudget`, `committedAmount`, and
`remainingAmount` only when `budget.view` is effective at that exact branch.

Department-scoped actors may receive their parent branch as navigation context,
but they do not receive the branch-level budget merely because they can view the
branch. The TypeScript response validator rejects any snapshot that marks a
branch budget hidden while still carrying budget values.

## Application integration

The company and branch pages now use `loadOrganizationDirectory()` rather than
legacy repository filters. Responses are validated with strict schemas:

- unknown properties are rejected;
- identifiers must be UUIDs;
- duplicate company or branch rows are rejected;
- captured time must match the request;
- hidden budget fields must be absent; and
- database errors are collapsed into one non-revealing unavailable error.

The branch page removes all budget columns when none of the visible branches
carry budget visibility. In a mixed result, hidden branch values render as an
undisclosed placeholder rather than zero.

## Containment examples

- A Platform Owner with `company.view` and platform scope sees all companies.
- A Client Account Manager with a company assignment and
  `company.view.assigned` sees only that assigned company.
- A Company Administrator sees only its company and branches.
- A Branch Administrator sees its company for context and only its assigned
  branch.
- A Department Administrator sees its company and parent branch for context,
  but not sibling branches or branch-level budget values.
- An explicit company-level denial of `organization.branch.view` removes every
  branch in that company, even when the role normally grants branch visibility.

## Deployment and rollback

Migration 044 is additive. It creates four functions and does not rewrite or
delete companies, branches, departments, identities, assignments, permissions,
budgets, requests, documents, deliveries, files, sessions, or audit evidence.

Rollback is forward-fix only after migration. The company and branch pages can
be moved back to the prior repository functions while a corrective migration
replaces or revokes the new capabilities. Production data must not be reset or
rolled back to remove this slice.

## Verification requirements

Release is blocked unless all of the following pass:

- complete migration chain through 044;
- populated-schema upgrade through 044;
- Platform Owner, Client Account Manager, company, branch, and department scope
  directory tests;
- cross-company and sibling-branch denial;
- missing-resource and out-of-scope response equivalence;
- explicit-denial precedence;
- revoked-assignment denial;
- branch-budget field minimization;
- strict TypeScript snapshot validation;
- application-grant reapplication on full and partial schemas;
- full unit, integration, browser, production build, deployment-asset, and
  production-container gates.
