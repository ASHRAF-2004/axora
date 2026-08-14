# Company deletion matrix

Axora uses an ownership-aware deletion gate rather than blanket cascading foreign keys.

| Record class | Empty/test company | Company with protected evidence | Reason |
| --- | --- | --- | --- |
| Company parent without protected evidence | Hard delete after owned children | Not applicable | Disposable tenant state is removed transactionally. |
| Sessions, setup/reset/verification tokens and active grants | Revoke immediately | Revoke immediately | Deleted tenants must lose access before any later cleanup. |
| Pending invitation, workflow and transactional email work | Cancel | Cancel | Pending work is cancelled and encrypted token material is erased. In-flight work blocks the operation until its outcome is known. |
| Draft requests, carts, budgets, approval rules, branches, departments, memberships, role assignments, branding and notifications | Explicit dependency-ordered cascade | Hidden and access-revoked before protected retention | These are tenant-owned disposable records when no protected evidence depends on them. |
| Finalized invoices and paid payments | Not expected in an empty fixture | Retain and block hard delete | Accounting evidence requires a formally approved retention policy. |
| Completed deliveries and receipt proof | Not expected in an empty fixture | Retain and block hard delete | Proof and dispute evidence must remain immutable. |
| Audit and security evidence | Minimal tombstone retained | Minimal tombstone plus existing evidence retained | Accountability must survive tenant removal. |
| Files, search indexes and caches | Remove only after their owning record is approved for hard deletion | Revoke normal access; retain protected files | Files follow the same classification as their owning record. |

An unprotected disposable company is not archived merely because it has normal
children: the ownership graph removes those children and the parent, verifies
all foreign keys and records external file/cache/search cleanup. A company with
finalized financial, completed delivery or proof evidence is archived,
tombstoned and excluded at the central scoped-authorization boundary while the
minimum protected evidence remains. The impact capability reports exact child,
protected and in-flight counts before mutation and requires a mode-specific,
company-specific typed confirmation plus a unique idempotency command.
