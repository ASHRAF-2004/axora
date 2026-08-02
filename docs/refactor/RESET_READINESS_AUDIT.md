# Production reset and recovery readiness audit

Audit time: 2026-08-02T12:13:03+00:00
Branch: `feature/coherent-product-refactor`

This is a read-only readiness record. No production backup, restore, migration,
deployment, reset, database rename, service stop, upload move, or Docker-volume
operation was run during this audit. It does **not** authorize
`reset-baseline.sh --apply`.

## Evidence found

| Gate | Evidence | Result |
| --- | --- | --- |
| Production database identified | The healthy `axora-db-1` container exposes `axora_hybrid`; it has 25 public base tables, 4 views, 16 public routines, 77 triggers, and 13 applied migrations ending at `013_trusted_interactions.sql`. | Confirmed read-only |
| Current aggregate impact | Read-only per-table counts total 561 rows. The only change from the 2026-08-02 08:17:03 UTC snapshot in the reset plan is `audit_logs`, now 351 rather than 350. The live phrase and impact must therefore always be recomputed. | Confirmed read-only |
| Database and persistent storage preserved | `axora_postgres_data` remains mounted read/write only at PostgreSQL's data directory. The application upload fallback remains a host bind mount at `/app/data/uploads`. `tailscale-db` remains healthy. | Confirmed read-only |
| Ordinary production backup schedule | `axora-backup.timer` is active. `axora-backup.service` last completed successfully at 2026-08-02 02:48:49 +08. | Confirmed by systemd |
| Ordinary disposable restore | The service journal records dump creation, upload archival, `Restoring the new archive into an isolated verification database`, and successful completion for `/var/lib/axora-production/backups/axora-20260801T184849Z`. The installed backup controller exits only after table-count and migration-manifest comparison and removal of the disposable database. | Confirmed by production journal |
| Repository reset-controller behavior | Shell syntax checks pass. `tests/production-reset-scripts.test.mjs` proves the allowlist, one-shot arming flag, real-TTY gate, non-mutating default plan, AES-256 fixture decryption, upload verification, fake disposable restore, and absence of Docker-volume/destructive Compose commands. | Confirmed in test only |
| Empty and forward migration paths | `tests/full-migration-chain.test.ts` applies migrations `001` through `032` to an empty PGlite database and upgrades a populated through-`022` fixture through `032`. The focused support suite separately proves populated `030` to `031` preservation and application-grant boundaries; the focused session-audit suite proves `031` to `032` preservation, minimized evidence, and trigger/grant boundaries. | Confirmed in test only |

The standard production backup evidence is meaningful: a disposable restore
actually ran against the production PostgreSQL container. It is not equivalent
to the encrypted reset recovery gate because it does not prove encryption,
off-machine survival, passphrase recovery, or application-level recovery from
the encrypted artifact.

## Blocking evidence not found

Reset approval remains blocked because this audit could not establish any of
the following:

1. The root-installed `encrypted-reset-backup.sh`,
   `verify-encrypted-backup.sh`, and `reset-baseline.sh` are byte-identical to
   the reviewed branch. Their containing directory is intentionally unreadable
   to the unprivileged account, and non-interactive sudo was unavailable.
2. `/var/lib/axora-production/last-reset-backup.path` exists and points to a
   complete `.tar.gpg`, `.manifest`, and `.verified` set. No encrypted-reset
   success event was present in the accessible system journal.
3. A production encrypted artifact has been decrypted and restored into a
   disposable database. The fixture test is not production evidence.
4. An encrypted artifact and its sidecar files exist at an approved off-machine
   destination. `/mnt` and `/media` are not mounted filesystems, and all Axora
   state observed on this host remains on the root logical volume.
5. The reset-backup passphrase has been escrowed separately from this PC and a
   second authorized operator has proved recovery without reading it into a
   terminal, log, issue, or chat.
6. An isolated recovered application has passed readiness, authentication,
   image, attachment, permissions, audit, and representative workflow smoke
   checks, with measured restore time.
7. The workbook/import report, audit-retention decision, rollback window, RPO,
   RTO, and destructive reset approval gates have been accepted.
8. The current root logical volume reports 98 GB usable and 40 GB available
   (58% used). It has not been expanded to the remaining NVMe capacity, and its
   remaining capacity and alerting have not been approved for the reset
   recovery boundary.

Migrations `029_delivery_driver_event_evidence.sql`,
`030_email_provider_lifecycle_events.sql`,
`031_support_diagnostics_security.sql`, and
`032_user_session_revocation_audit.sql` appeared in the shared branch during
this audit. Migration `030` remains the email lifecycle/correlation minimum;
`031` adds narrow support-summary and fixed-shape support-audit functions
without granting the application role direct audit-table writes. Migration
`032` adds a database-owned trigger that records only the privacy-minimized
unrevoked-to-revoked session transition and is not directly executable by the
application role. The migration-chain and first-owner bootstrap gates now
explicitly end at `032`, and the empty/populated migration tests were rerun
after that update. All four migrations remain branch-only; production still
ends at `013`.
If migration `033` or any later migration appears, this audit is stale: update
the explicit latest-migration assertions, first-owner bootstrap prerequisite
where applicable, migration tests, reset impact, sealed-release manifest, and
this readiness record before running another plan or recovery-point command.

## Root-only evidence checks for an authorized operator

These commands do not print environment files, secret values, database rows,
or the backup passphrase. Run them from the exact reviewed checkout before any
maintenance window.

### 1. Prove installed controllers match the reviewed checkout

```bash
cd /srv/axora || exit
for name in backup.sh encrypted-reset-backup.sh verify-encrypted-backup.sh reset-baseline.sh lib.sh; do
  sudo cmp --silent \
    "scripts/production/$name" \
    "/usr/local/libexec/axora-production/$name" \
    || { echo "installed controller differs: $name" >&2; exit 1; }
done
echo "installed reset controllers match the reviewed checkout"
```

If this fails, do not copy individual scripts manually. Review the exact
checkout, rerun the repository installer through the approved controller-update
procedure, then repeat the comparison.

### 2. Verify the latest ordinary backup without exposing its contents

```bash
sudo bash -c '
set -Eeuo pipefail
marker=/var/lib/axora-production/last-backup.path
test -f "$marker" && test ! -L "$marker"
backup=$(<"$marker")
case "$backup" in
  /var/lib/axora-production/backups/axora-[0-9]*) ;;
  *) echo "unsafe last-backup path" >&2; exit 1 ;;
esac
test -d "$backup" && test ! -L "$backup"
(cd "$backup" && sha256sum --check checksums.sha256)
stat -c "%A %U:%G %s %y %n" "$backup" "$backup/manifest.txt" "$backup/database.dump" "$backup/uploads.tar.gz"
'
```

Correlate its UTC name with a successful `Restoring the new archive into an
isolated verification database` entry in `journalctl -u axora-backup.service`
or the deployment journal.

### 3. Inspect encrypted recovery-point evidence without decrypting it

```bash
sudo bash -c '
set -Eeuo pipefail
marker=/var/lib/axora-production/last-reset-backup.path
test -f "$marker" && test ! -L "$marker"
artifact=$(<"$marker")
case "$artifact" in
  /var/lib/axora-production/reset-backups/axora-reset-*.tar.gpg) ;;
  *) echo "unsafe encrypted-backup path" >&2; exit 1 ;;
esac
base=${artifact%.tar.gpg}
for file in "$artifact" "$base.manifest" "$base.verified"; do
  test -f "$file" && test ! -L "$file"
  test "$(stat -c %U:%G:%a "$file")" = root:root:600
done
grep -Fqx "format=axora-encrypted-reset-backup-v1" "$base.manifest"
grep -Fqx "format=axora-encrypted-reset-verification-v1" "$base.verified"
expected=$(sed -n "s/^ciphertext_sha256=//p" "$base.manifest")
test "${#expected}" -eq 64
test "$(sha256sum "$artifact" | awk "{print \$1}")" = "$expected"
stat -c "%A %U:%G %s %y %n" "$artifact" "$base.manifest" "$base.verified"
'
```

A marker proves only that a prior verifier reported success. In the approved
recovery environment, run the installed verifier again against the copied
artifact, then test the isolated recovered application:

```bash
sudo /usr/local/libexec/axora-production/verify-encrypted-backup.sh \
  --artifact /var/lib/axora-production/reset-backups/<approved-artifact>.tar.gpg
```

The verifier creates and drops a uniquely named disposable database; it never
targets `axora_hybrid`. This is an operational write and was intentionally not
run during this read-only audit.

### 4. Confirm the off-machine boundary

```bash
findmnt --target /approved/off-machine/mount
sudo test -d /approved/off-machine/mount/axora-reset-recovery
sudo test -f /approved/off-machine/mount/axora-reset-recovery/<approved-artifact>.tar.gpg
sudo test -f /approved/off-machine/mount/axora-reset-recovery/<approved-artifact>.manifest
sudo test -f /approved/off-machine/mount/axora-reset-recovery/<approved-artifact>.verified
```

Replace placeholders only with the approved mounted destination and artifact
name. A second directory on `/` is not off-machine storage.

## Commands that remain blocked

After the installed-controller comparison succeeds, the workbook and recovery
gates may be reassessed with the default non-destructive plan:

```bash
sudo /usr/local/libexec/axora-production/reset-baseline.sh --plan
```

Creating a fresh encrypted production recovery point is appropriate only in an
approved preparation window after passphrase escrow and off-machine transfer
ownership are defined:

```bash
sudo /usr/local/libexec/axora-production/encrypted-reset-backup.sh \
  --purpose manual-guarded-backup
```

Do not run `reset-baseline.sh --apply`. Its destructive path must remain
blocked until every item above is evidenced and the owner reviews the newly
computed impact and gives the single explicit confirmation required by the
reset plan.
