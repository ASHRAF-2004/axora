# Forward migration and guarded reset plan

Status: guarded preparation tooling is implemented, but production execution
remains blocked. **No reset, truncate, delete, database switch, production
restore, or production migration was run during this audit or while testing
the tooling.** Tests used generated encrypted fixtures and a fake disposable
database controller. The workbook is still insufficient to rebuild production
and therefore does not authorize `--apply`.

The latest read-only operational evidence and root-only verification commands
are recorded in
[Production reset and recovery readiness audit](RESET_READINESS_AUDIT.md).
That audit confirms ordinary production backups have performed disposable
restores, but finds no evidence yet of a production encrypted recovery point,
off-machine copy, or isolated application recovery drill.

## Migration policy: expand, migrate, contract

All schema change is forward-only. Never edit an applied migration, run an
automatic down-migration, or rely on an older application to understand a
destructive schema change.

1. **Expand:** add tables, nullable columns, compatible defaults, new indexes,
   and new APIs. Keep existing reads and writes valid.
2. **Migrate:** backfill in bounded, observable batches; dual-write only where
   idempotency and reconciliation are proved. Record accepted/rejected counts.
3. **Switch:** deploy a release that reads the new representation behind a
   controlled flag. Validate both data paths before ending the compatibility
   window.
4. **Contract:** only after the rollback window, recovery drill, and explicit
   approval, stop old writes and remove obsolete structures in a later forward
   migration.

Add constraints using a non-blocking pattern where PostgreSQL supports it
(`NOT VALID`, backfill, then `VALIDATE CONSTRAINT`). Create large indexes
concurrently outside a transaction when necessary. Every migration needs an
old-app compatibility statement, lock/runtime estimate, backup gate, and
post-migration reconciliation query.

Migration `014_account_setup_invitations.sql` follows the expand side of this
model: it adds credential-generation fields and a hash-only invitation
lifecycle table while retaining a valid bcrypt sentinel so an older release
fails pending-account authentication safely. Account setup has no encrypted
token outbox or poller: the raw token exists only in memory for one atomic
`SENDING` claim and one HMAC-authenticated synchronous send. A failed, disabled,
or uncertain attempt requires explicit resend, which revokes the old
invitation and issues a new token. Password-reset and email-verification
messages retain their separate encrypted durable transactional outbox.
Migrations `016` through `032` further
expand normalized identity/scope, branding, workflow/audit events,
notifications, supplier collaboration, delivery evidence, independent
receiving, customer matching, contact/security tokens, owner bootstrap,
authentication throttling, canonical invitations, durable localized workflow
email, receipt-based accounting, signed provider-event suppression, bounded
driver delivery-attempt/partial/issue evidence, and privacy-minimized all-six
provider lifecycle correlation. Migration `030` remains the minimum email
lifecycle/correlation schema. Migration `031` adds live-actor-checked aggregate
support diagnostics and fixed-shape support audit insertion without granting
the application role direct `audit_logs` writes. Migration `032` adds a
database-owned, privacy-minimized session-revocation audit trigger without
serializing credential-adjacent session fields or granting direct execution to
the application role. All remain branch-only target changes until an approved
release is deployed.

Migration `015_remove_trusted_interactions.sql` is a forward contract migration
for the feature introduced by immutable migration `013`. Because production
already contains `013`, `015` may run only after the feature is frozen, its four
live rows are exported in the verified recovery point, audit-retention approval
is recorded, and rollback compatibility is proved. It intentionally avoids
`CASCADE` and retains historical audit rows. Never delete or rewrite migration
`013` itself.

## Exact live snapshot and proposed reset impact

The following read-only snapshot was taken from `axora_hybrid` at
2026-08-02 08:17:03 UTC. It had 13 applied migrations, 25 public base tables,
560 rows in those tables, no legacy upload files, and no applied invitation
table.

The proposed reset is a **new-database replacement**, not an in-place wipe.
Rows marked “omit” remain intact in the source database and encrypted recovery
point while the rollback window is open.

| Live table / subset | Exact rows | Candidate treatment |
| --- | ---: | --- |
| `approvals` | 5 | Omit; import no transaction history |
| `attachments` | 0 | Omit; database attachment bytes were exactly 0; preserve matching file backup |
| `audit_logs` | 350 | Omit from candidate only after retention approval; preserve in encrypted archive |
| `branches` | 4 | Omit; rebuild only from approved Branch Master |
| `companies` | 3 | Omit; rebuild only from approved Company Master |
| `company_interaction_profiles` | 2 | Omit from candidate only after the migration `015` retention/contract gate |
| `deliveries` | 0 | Omit |
| `interaction_assets` | 0 | Omit |
| `interaction_revisions` | 2 | Omit from candidate only after the migration `015` retention/contract gate |
| `invoice_allocations` | 0 | Omit |
| `invoices` | 0 | Omit |
| `payments` | 0 | Omit |
| `product_images` | 37 | Omit; 516,900 database bytes remain in backup |
| `product_suppliers` | 1 | Omit |
| `products` | 35 | Omit; rebuild only from approved catalog rows |
| `quotations` | 0 | Omit |
| `request_lines` | 10 | Omit |
| `requests` | 9 | Omit |
| `suppliers` | 1 | Omit; rebuild only from approved supplier data |
| non-owner `users` | 4 | Omit; workbook cannot recreate accounts without work emails |
| **Business/non-owner rows omitted** | **463** | **Exact non-owner impact at snapshot** |
| platform-owner `users` | 3 | Omit; the migration-only controller never copies or seeds an account |
| **Business/account rows omitted** | **466** | **All live account and business rows at the snapshot** |
| `roles` | 8 | Reconstruct from the exact reviewed migration set; pending `016` adds target role rows |
| `lookup_types` | 7 | Reconstruct from migrations |
| `lookup_values` | 45 | Reconstruct from migrations |
| `request_status_transitions` | 21 | Reconstruct from migrations |
| `schema_migrations` | 13 | Reconstruct by applying the exact sealed migration manifest; the current branch target is `032` only if migrations `014`-`032` pass review unchanged |
| **Structural rows reconstructed** | **94** | **No source row is copied; migrations recreate reviewed baseline data** |

All seven users were active at the snapshot: three platform owners and four
non-owners. All 35 products and the one supplier were global records; there
were no company-specific products or suppliers. These are descriptive live
facts, not authority to map workbook names automatically.

The pending migrations add nineteen migration-history rows plus target roles,
identity, membership, branding, workflow, notification, invitation, supplier,
delivery, receiving, matching, authentication-throttle, email-outbox, and
provider-event/suppression/lifecycle structures, narrow support-security
functions, and a privacy-minimized session-revocation audit trigger. An
empty-database migration run creates reference data but no owner account. The
guarded controller copies no live account or business row afterward. For that
reason, no derived candidate-baseline total is asserted
here. The controller must report exact per-table candidate counts from its live
migration-only run. It recounts every source table before approval and before
candidate construction; the historical numbers above must never be hard-coded
as permission to discard changed data.

The persistent upload snapshot contained exactly 0 files and 0 bytes. This
does not remove the upload tree from the recovery boundary.

## Why reset is blocked today

The assessed workbook lacks authoritative company and branch masters, account
emails, structured request sources, recurring-item sizes, and recurring-item
prices. Its catalog status/confirmation columns are corrupted and its progress
formulas are wrong. It therefore cannot recreate the 466 account/business rows
omitted from the migration-only candidate, nor can it prove a valid replacement
for the seven accounts, four branches, 35 products, or retained audit evidence.

Reset cannot proceed until the acceptance criteria in
[WORKBOOK_IMPORT_REPORT.md](WORKBOOK_IMPORT_REPORT.md) pass and the business
owner separately approves the audit-retention consequence.

## Recovery point required before any reset

[`scripts/production/backup.sh`](../../scripts/production/backup.sh) already
creates a transaction-consistent custom PostgreSQL dump, upload archive and
manifests, verifies checksums, restores the dump into a disposable database,
compares table and migration counts, and verifies an extracted upload tree.
It produces a root-readable local backup; it does **not itself assert that the
off-machine artifact is encrypted**.

Two installed root-only controllers now add the local encrypted layer:

- [`encrypted-reset-backup.sh`](../../scripts/production/encrypted-reset-backup.sh)
  acquires the deployment lock, requires the configured database to be in the
  explicit allowlist, binds the backup to the current sealed release, invokes
  the verified database/upload backup, and encrypts the complete folder with
  GPG symmetric AES-256. Its generated passphrase file is root-owned, mode
  `0600`, under `/etc/axora-production/secrets`, and never enters Git, an
  environment file, a container, or command output.
- [`verify-encrypted-backup.sh`](../../scripts/production/verify-encrypted-backup.sh)
  checks the ciphertext and inner manifests, decrypts into a root-only
  temporary directory, rejects links and unsafe archive paths, reconstructs
  and hashes the upload tree, runs `pg_restore --list`, restores into a uniquely
  named disposable database, compares table and migration manifests, drops the
  disposable database, and writes a mode-`0600` verification marker.

[`reset-baseline.sh`](../../scripts/production/reset-baseline.sh) runs that
encrypted backup again **after writers are frozen and immediately before any
candidate database is created or upload tree is moved**. Its audit directory
copies only aggregate source manifests plus the encrypted artifact identity and
verification result; it never records row values or secret material.

This closes the local encryption/decrypt-and-restore gap, but not the
off-machine disaster-recovery gap. Before reset approval, an operator must:

1. Transfer the encrypted `.tar.gpg`, its outer manifest, and its verification
   marker to the approved off-machine destination and verify the ciphertext
   checksum at that destination.
2. Escrow the passphrase through a separately approved, access-controlled
   recovery channel. A passphrase stored only on the production host does not
   survive host loss; it must never be placed beside the ciphertext or in Git.
3. Repeat decrypt-and-restore verification in the supported isolated recovery
   environment, record the result and elapsed restore time, and run the agreed
   application-level recovery smoke tests.
4. Retain the encrypted recovery point, preserved source database, sealed
   application release, and quarantined upload tree for the approved rollback
   and audit windows.

A checksum without decryption and restore is not a reset recovery gate. A
same-disk copy is not the required off-machine recovery point.

## Guarded replacement design

The implemented controller defaults to `--plan`; it has no `--yes`, wildcard
database target, piped confirmation, or environment-supplied confirmation
phrase. `--plan` obtains the deployment lock and performs read-only release,
image, migration, per-table-count, and upload-manifest checks. It reports only
aggregate impact and makes no service, database, upload, backup, or Docker
volume change.

The mutation path is deliberately harder to enter. `--apply` requires all of
the following before it can reach Docker:

1. effective root, a root-owned controller configuration, and an exact
   database name included in `AXORA_RESET_DATABASE_ALLOWLIST`; PostgreSQL
   system databases are always rejected;
2. the exact non-secret, one-shot arming value
   `AXORA_BASELINE_RESET_AUTHORIZATION=I_ACKNOWLEDGE_AXORA_BASELINE_RESET`,
   supplied to that process only and never persisted in `deploy.env`;
3. a real readable/writable TTY, followed by an exact typed phrase derived from
   the live database name, row count, table count, and current release SHA;
4. the current root-owned sealed release, exact running image digest, healthy
   PostgreSQL service, source migration filename/hash set identical to that
   release, and an uncontended deployment lock.

For the 2026-08-02 snapshot, the phrase shape is:

```text
RESET axora_hybrid TO MIGRATION-ONLY BASELINE OMIT 560 ROWS ACROSS 25 TABLES AT <40-character-release-sha>
```

The displayed values are always recomputed; the historical example is not an
authorization token. The environment arming flag enables entry to the
interactive path but cannot substitute for the live typed phrase. After the
phrase matches, the controller records the initiating sudo UID/user, freezes
the existing app-facing writers without stopping PostgreSQL, and recaptures
the database, migration, and byte-level upload manifests. Any drift aborts and
restarts only the services that were originally running.

The current controller implements a **migration-only baseline**, not workbook
import or owner preservation. After the final encrypted recovery point passes
verification, it:

1. creates a uniquely named candidate database;
2. applies only `01-run-migration.sh`, numbered migrations, and application
   grants mounted read-only from the current sealed release;
3. proves the candidate migration manifest matches the sealed release and that
   every table except the explicitly reviewed migration/reference baseline
   tables has zero rows;
4. atomically moves the whole existing upload tree into a same-filesystem,
   root-only quarantine and creates a new empty upload directory;
5. disables new connections to the source, terminates its sessions, renames it
   to a timestamped `axora_pre_reset_*` quarantine, and only then gives the
   validated candidate the configured `axora_hybrid` name;
6. restarts only the previously running services from the same sealed release,
   runs local and required external health checks, and records the recovery
   artifact, preserved source name, upload quarantine, aggregate counts, and
   initiator in a root-only audit record.

No source row is copied and no owner, ordinary user, demo account, invitation,
session, reset token, or workbook row is seeded. Account creation/import is a
separate future approved workflow. This is why having a technically prepared
controller does not make the currently incomplete workbook safe to apply.

After an approved reset, first-owner bootstrap is also a separate gated step.
`create_first_platform_owner.mjs` refuses before database mutation unless
delivery is enabled and the private sender reports `ready`. It persists only
the invitation token's SHA-256 hash, atomically claims `SENDING`, and performs
one synchronous HMAC-authenticated send. If that send fails or is uncertain,
the operator must review the outcome and run the same audited command with
`--replace-pending-first-owner-invitation`; that recovery revokes the old
invitation and issues a new token. There is no setup-token outbox to replay.

## Cutover

1. Keep the renamed source database connection-disabled and preserved; never
   drop it as part of reset or automatic rollback.
2. Keep the configured runtime database name stable. The validated candidate
   receives that name only after the source has been quarantined under its
   unique timestamped name.
3. Restart only services that were running before the maintenance freeze, from
   the current sealed release and immutable image, then require local and any
   configured external readiness checks.
4. Record completion only after those gates pass. Retain the pre-cutover final
   encrypted recovery point, source database, upload quarantine, sealed
   release, and audit record for the approved windows.
5. Treat authenticated account, tenant, and workflow checks as a separate gate
   before making the empty baseline publicly usable; the reset tool does not
   create an account to make those checks pass artificially.

## Rollback

- Before pointer switch: stop and discard only the unapproved candidate; the
  source has never been modified.
- If a pre-completion check fails after the names were switched, stop the
  app-facing services, preserve the failed baseline under a unique name,
  restore the quarantined source database name and upload tree, and restart
  only the services that were originally running.
- After candidate writes: freeze both datasets and reconcile explicitly. Do
  not point backward and silently lose writes.
- For an application defect with a compatible schema: use the normal app-only
  rollback; do not reverse migrations.
- For corruption: preserve both states, restore the encrypted recovery point
  into another isolated database, validate it, and obtain explicit approval
  before a new pointer switch.

The controller never invokes `docker compose down`, `-v`,
`--remove-orphans`, or a Docker volume command. Never use those manually, and
never use `TRUNCATE ... CASCADE`, an in-place restore, or automatic
source-database deletion as part of reset or rollback.
