# Temporary MVP data-retention policy

**Status:** Temporary MVP operating policy
**Scope:** The controlled Axora pilot, limited to three customer companies
**Effective date:** 2026-08-16
**Configuration:** `AXORA_RETENTION_MODE=mvp-conservative`

## Conservative pilot rule

Finalized invoices, paid-payment evidence, completed deliveries, proof of
receipt, security records and audit evidence are protected records. During the
pilot they are retained, tombstoned where appropriate and removed from normal
operational visibility. Company deletion immediately revokes sessions,
permissions, assignments, setup/reset tokens, invitations and normal access.

Disposable records without protected dependencies continue through Axora's
tested, constraint-safe ownership DAG. No automatic purge or destructive
anonymization of protected evidence is enabled in this mode.

At the end of the three-company pilot, the owner must review the retained
evidence, export it if required, and explicitly approve any later deletion or
anonymization. This document is an interim operating rule for the controlled
MVP. It is not a representation of complete statutory or regulatory
compliance, and it must be replaced or formally reviewed before general
availability.
