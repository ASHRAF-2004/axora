# Company deletion matrix

Axora uses an ownership-aware deletion gate rather than blanket cascading foreign keys.

| Record class | Empty/test company | Company with protected evidence | Reason |
| --- | --- | --- | --- |
| Company with no dependent rows or lifecycle evidence | Hard delete | Not applicable | No tenant or evidentiary relationship remains. |
| Sessions, setup/reset/verification tokens and active grants | Revoke immediately | Revoke immediately | Deleted tenants must lose access before any later cleanup. |
| Pending invitation, workflow and transactional email work | Cancel | Cancel | Pending work is cancelled and encrypted token material is erased. In-flight work blocks the operation until its outcome is known. |
| Draft operational records | Eligible for a future reviewed cascade | Hidden by tenant archive | No approved retention period currently authorizes destructive removal. |
| Finalized invoices and paid payments | Not expected in an empty fixture | Retain and block hard delete | Accounting evidence requires a formally approved retention policy. |
| Completed deliveries and receipt proof | Not expected in an empty fixture | Retain and block hard delete | Proof and dispute evidence must remain immutable. |
| Audit and security evidence | Minimal tombstone retained | Minimal tombstone plus existing evidence retained | Accountability must survive tenant removal. |
| Files, search indexes and caches | Remove only after their owning record is approved for hard deletion | Revoke normal access; retain protected files | Files follow the same classification as their owning record. |

Until an owner approves a jurisdiction-specific retention schedule, non-empty companies are archived, tombstoned and excluded at the central scoped-authorization boundary. The deletion impact capability reports child, lifecycle and in-flight counts before mutation and requires a company-specific typed confirmation.
