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
| Audit and security evidence | Immutable audit snapshots plus a deletion tombstone retained; historical UUIDs are no longer ownership foreign keys | Tombstone plus existing evidence retained | Accountability and the audit integrity chain survive tenant removal without keeping an operational tenant. |
| Files | Leased cleanup task removes the file after the database transaction | Revoke normal access; retain protected files | A hard-deletion command remains `CLEANUP_PENDING` until every required file task completes. |
| External cache/search index | No task is created because Axora currently has no persistent tenant cache or external search index | Not applicable | Legacy task kinds fail closed unless an explicit local adapter root is configured; they are never silently acknowledged. |

An unprotected disposable company is not archived merely because it has normal
children: migration 091 removes indirect children and then follows a reviewed,
dependency-ordered ownership DAG while constraints and triggers remain active.
It never changes `session_replication_role`. A company with
finalized financial, completed delivery or proof evidence is archived,
tombstoned and excluded at the central scoped-authorization boundary while the
minimum protected evidence remains. The impact capability reports exact child,
protected and in-flight counts before mutation and requires a mode-specific,
company-specific typed confirmation plus a unique idempotency command.
Append-only trigger exceptions require a private authorization row bound to the
same PostgreSQL backend, transaction, company and running command. Custom GUCs
are audit context only and cannot authorize deletion.

The cleanup worker leases one task at a time, retries transient failures with
bounded exponential backoff, recovers expired leases after a crash and records
terminal failures. `COMPLETE` is impossible while a required task is pending.
The production worker deletes files only below the mounted Axora uploads root;
path traversal and directory deletion through a file locator are rejected.
It connects as the dedicated `axora_cleanup_worker` login using its protected
secret. The web application role cannot execute cleanup leasing or completion
capabilities.
`CACHE` and `SEARCH_INDEX` adapters require `AXORA_COMPANY_CACHE_ROOT` and
`AXORA_COMPANY_SEARCH_INDEX_ROOT` respectively. Those variables remain unset
because the current application has no such persistent stores. If either store
is introduced, configuring and mounting its reviewed root is a release gate.

During the controlled three-company pilot, `AXORA_RETENTION_MODE=mvp-conservative`
activates the temporary policy in `docs/mvp-data-retention-policy.md`. Protected
evidence remains tombstoned and access-revoked with no automatic purge. This is
an MVP operating rule, not a claim of complete statutory or regulatory compliance.
