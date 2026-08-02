# Axora role and scope matrix

Status: refactor-branch authorization contract, audited 2026-08-02. The
executable sources are `src/lib/permissions.ts`, `src/lib/role-catalog.ts`,
`src/lib/auth.ts`, server actions/repositories, and migrations `016` and `024`.
Workbook names are input for a reviewed import, never authorization logic.

## Authorization model

Access is the intersection of all of these facts:

1. an active account whose setup is complete;
2. a current credential version and unrevoked live session;
3. one active normalized role assignment;
4. the account kind required by that role;
5. a live membership/profile for its platform, company, branch, supplier, or
   delivery scope;
6. the requested permission; and
7. entity-level tenant, branch, assignment, ownership, and workflow checks.

Every authenticated request reloads these live facts. A signed cookie cannot
keep access after deactivation, role/scope removal, company suspension, session
revocation, or credential-version rotation. Hiding a navigation link is never
treated as authorization.

| Scope | Required boundary | Visibility |
| --- | --- | --- |
| `PLATFORM` | Platform account, no company/branch/supplier | Cross-tenant data only for the explicit Axora role permissions |
| `COMPANY` | Active company membership | One company and its permitted branches |
| `BRANCH` | Active company membership and branch assignment | One assigned branch inside one company |
| `SUPPLIER` | Active supplier membership | Records assigned to that supplier organization only |
| `DELIVERY` | Active delivery-agent profile | Delivery jobs assigned to that driver only |

## Canonical roles

| Role | Scope | Principal positive capabilities | Explicit exclusions |
| --- | --- | --- | --- |
| Platform owner | Platform | Company onboarding, global catalog/suppliers, sourcing, deliveries, finance, reports, audit, users, settings | Cannot create or approve customer requests or set customer branch budgets |
| Platform operations | Platform | Global catalog/suppliers, sourcing, fulfilment, delivery coordination, operational documents/reports | No owner governance, company approval, customer request creation, or unrestricted finance administration |
| Technical support | Platform | Aggregate system health, exact-email account diagnostics, and session revocation for non-platform targets; every account lookup/session action has an operator reason | No general audit feed or tenant browsing; no self/platform-account session action; no catalog, supplier, pricing, approval, delivery, or finance authority |
| Company administrator | Company | Branches, budgets, people, company requests/approvals, permitted invoices/documents/reports | No global catalog/supplier/sourcing control; no Axora buying cost; cannot create purchase requests by default |
| Branch administrator | Branch | Branch people, catalog, requests, branch approvals, deliveries, documents/reports | No other branch; no platform operations; cannot create broader roles |
| Company approver | Company | Eligible company-wide approval queue, budget/evidence context, reports | No self-approval; no sourcing, supplier selection, or user administration |
| Branch approver | Branch | Eligible branch approval queue, budget/evidence context, reports | No self-approval; no other branch; no sourcing or supplier selection |
| Purchase requester | Branch | Shop, create and track own requests, permitted documents/delivery status | Cannot approve, source, manage users, or see other users' private work |
| Finance reviewer | Company or branch | Permitted invoices, COD evidence, customer three-way matching, exceptions/reports | No request approval, sourcing, or private Axora supplier-cost view outside granted finance records |
| Read-only auditor | Company or branch | Read-only requests, deliveries, invoices, documents, reports; company-wide audit when safe | No mutations; branch-scoped audit remains denied where history cannot be safely narrowed |
| Receiving user | Company or branch | Independently inspect and confirm assigned receipts | Cannot alter driver evidence, approve requests, or administer invoices |
| Supplier user | Supplier | Assigned RFQs, own quotation terms/documents, acknowledgement and fulfilment updates | No competitors, Axora margin, unrelated customers, private selection notes, or self-selection |
| Delivery driver | Delivery | Assigned jobs and offline-queued status, note, and line-outcome events; binary evidence uploads require connectivity and explicit retry | No budgets, invoices, users, supplier prices, unrelated jobs, or final customer receipt approval |

The permission key list is intentionally smaller than the entity-level policy.
For example, `approve_requests` opens the approval operation, but the operation
still proves company/branch scope, eligible status, an independent requester,
and a durable approval record in one transaction.

## Separation of duties and negative rules

- Nobody approves a request they created.
- A requester cannot gain approval by changing the client or calling a server
  action directly.
- A supplier cannot see or select competing offers.
- A driver records evidence; a separately authorized receiver records customer
  acceptance.
- A finance override requires an independent reviewer and a reason.
- Customer actors never receive Axora buying cost, private supplier identity/
  documents, margin, or internal selection notes.
- Supplier and delivery actors receive the minimum customer/contact data for
  assigned work only.
- Inactive accounts cannot sign in. Inactive companies cannot create new work.
- Technical support has only `view_system_diagnostics`: aggregate health and an
  exact-email diagnostic read model. It has no general audit-feed permission,
  cannot browse tenant workflows, and cannot revoke its own or any platform
  account's sessions. Diagnostic and session-control audit rows are written
  through fixed-shape database capabilities; direct application inserts into
  `audit_logs` remain denied.
- Auditors have no mutation permissions.
- Owner protection, last-admin protection, and self-deactivation rules are
  enforced server-side and audited.
- People & Access uses deactivate/reactivate rather than hard deletion.
  Deactivation revokes a pending invitation and rotates authorization state;
  identity destruction belongs only to the guarded baseline reset.

## Delegated account administration

| Inviter | Roles they may invite | Scope limits |
| --- | --- | --- |
| Platform owner | Every canonical role, including another protected platform owner | Exact account-kind and role scope must be supplied; active target records are required |
| Company administrator | Company administrator, branch administrator/approver, company approver, requester, finance reviewer, auditor, receiver | Same active company only; branch roles require a branch in that company |
| Branch administrator | Branch approver, requester, receiver | Same company and assigned branch only |
| Everyone else | None | No `manage_users` permission |

Creating an account produces an `INVITED` account, normalized assignment,
membership, and one-time invitation. It creates no usable password. The admin
cannot view, email, or recover another person's password. Resending revokes the
old link and creates a new token.

## Legacy compatibility

Legacy roles remain readable during the expand/contract window only:

| Legacy role | Canonical interpretation |
| --- | --- |
| `ADMIN` company actor | `COMPANY_ADMIN` |
| protected owner-era `ADMIN` | `PLATFORM_OWNER` only when all owner/platform invariants also hold |
| `APPROVER` | branch or company approver according to its resolved scope |
| `OPERATIONS` | `REQUESTER` |
| `FINANCE` | `FINANCE_REVIEWER` |
| `VIEWER` | `AUDITOR` |
| `IT_SUPPORT` | `TECHNICAL_SUPPORT` |

New UI and account creation emit canonical roles. Compatibility does not make
legacy columns a second authority, and no unknown role is silently mapped.

## Workbook import rule

The supplied workbook currently lacks stable tenant/product keys, account
emails, and reliable normalized role/scope data. Its named rows are therefore
quarantined by the validator. A later import may create reviewed generic role
assignments, but it must never encode Ashraf, Omar, or any other person's name
inside authorization logic. See `WORKBOOK_IMPORT_REPORT.md` for the exact
blocked-row report.
