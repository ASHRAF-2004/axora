# Roles, Permissions and Scope

## Authorization principle

Current code authorizes access using a combination of account state, canonical/legacy role, effective permissions and scope. UI visibility is not sufficient authorization. Dynamic entity access must still validate company/branch/department/delivery ownership and workflow state.

## Current canonical roles found in `src/lib/types.ts`

- Platform Owner
- Human Resources Management
- Platform Operations
- Client Account Manager
- Company Administrator
- Branch Administrator
- Department Administrator
- Branch Approver
- Company Approver
- Requester
- Finance Reviewer
- Auditor
- Technical Support
- Delivery Team Supervisor
- Delivery Agent / Delivery Driver / Delivery Guy compatibility roles
- Receiving User

Legacy role labels remain supported for compatibility. Future development should converge active accounts toward canonical assignments and retire legacy compatibility only after migration evidence proves it is safe.

## Scope model

Current scope types include platform, company, branch, department, supplier and delivery. A role label alone must not grant access; the assignment must also carry a compatible scope and live membership/profile.

## Permission model

`src/lib/permissions.ts` defines route-level capabilities such as company creation/management, catalogue management, branch budget management, requests/approvals, finance, documents, users, integrations, delivery, receiving and protected commercial visibility.

Important rules:

- Platform Owner has broad platform oversight but customer budget/approval rules still have explicit boundaries.
- Client Account Manager has a commercial confidentiality ceiling. Current code explicitly forbids direct internal-cost/profit/commercial-pricing authority from being widened accidentally.
- Customer roles are restricted to the authorized company/branch/department.
- Request creation and request approval are separable.
- Delivery actors are restricted to delivery operations rather than customer finance/user administration.
- Receiving confirmation is independent of driver evidence.
- Branch/department audit access is restricted where the history cannot be safely narrowed.

## Handover implementation rule

When adding a permission:

1. Define the permission key and intended actor/scope.
2. Update role templates/defaults only if the business rule is confirmed.
3. Enforce the permission in server-side entry points.
4. Enforce entity-level scope/ownership in service/repository/database boundaries.
5. Add denial tests for wrong tenant, wrong branch/department and invalid workflow state.
6. Update this handover and the relevant role documentation.

Do not solve authorization by hiding a menu item.
