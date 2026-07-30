# Axora disaster recovery

This procedure is intentionally conservative. A database restore can discard
valid production writes and therefore always requires an approved incident
window and a verified backup.

## Recovery objectives

Axora does not yet have business-approved RPO or RTO values. Before Render is
decommissioned, Ashraf must approve:

- the maximum acceptable data loss (RPO);
- the maximum acceptable outage (RTO);
- backup frequency and retention;
- the encrypted off-machine destination;
- who can declare an incident and authorize a production restore.

Until those values exist, create a verified backup before every migration and
at least daily during active use, and copy each required recovery point
off-machine.

## What every recovery point must contain

- a PostgreSQL custom-format dump of `axora_hybrid`;
- the persistent `/var/lib/axora-production/uploads` tree, including
  empty-directory metadata;
- a manifest identifying UTC time, exact Git release SHA, database name, and
  migration set;
- checksums for every archive/file;
- no plaintext passwords, tokens, database URLs, or session secrets.

Secrets are backed up separately using the approved encrypted credential
process. Never place them in the repository or ordinary backup logs.

## Backup verification

For every required recovery point:

1. Confirm the backup command completed without a partial/temporary directory.
2. Verify manifest and file checksums.
3. Run `pg_restore --list` against the database dump.
4. Copy it to encrypted off-machine storage.
5. Re-verify checksums on the destination.
6. Regularly restore into an isolated, non-production database and run schema,
   row-count, permissions, image, attachment, and readiness checks.

A checksum proves that a copy is unchanged; only an isolated restore test
proves that it is operationally useful.

## Incident priorities

1. Protect people and the physical server.
2. Stop additional damage and freeze application writes if data integrity is
   uncertain.
3. Preserve logs, the current database volume, current release metadata, and
   the suspected bad state.
4. Keep or restore a read-only status page if practical; do not weaken
   authentication.
5. Select the newest recovery point from before the incident and verify it
   again.
6. Restore into isolation, validate, then obtain explicit approval to switch.

## Restore procedure

Do not restore directly into `axora_hybrid`.

1. Record the incident start time, current release SHA, migration set, active
   connections, and latest audit timestamp.
2. Disable the deployment timer and freeze writes through the approved
   maintenance procedure.
3. Create a fresh isolated database with a unique incident name.
4. Restore the chosen custom-format dump into that database.
5. Apply least-privilege application grants without changing the live database.
6. Validate migrations, constraints, users, companies, branches, requests,
   product images, attachments, audit history, and representative totals.
7. Start an isolated candidate application against the restored database and
   test live/readiness plus critical workflows.
8. Compare the isolated database with the preserved live state and identify
   any writes after the recovery point.
9. Obtain explicit approval for the data-loss boundary and production switch.
10. Switch using a reviewed, documented procedure that preserves the former
    database; do not drop or overwrite it.
11. Verify public workflows, audit events, backup the recovered state, and
    retain incident evidence.

The current repository does not provide an unattended in-place restore for
`axora_hybrid`. This is deliberate. Write and test a database-switch procedure
for the exact incident before using it.

## Scenario guidance

| Scenario | First action | Recovery approach |
| --- | --- | --- |
| Bad application release, database healthy | Keep writes controlled; inspect readiness | Application rollback only |
| Failed backwards-compatible migration | Keep compatible current app running | Repair forward after backup; no automatic down-migration |
| Data corruption or destructive migration | Freeze writes and preserve volume | Isolated restore and approved database switch |
| Lost persistent uploads only | Preserve database and mount evidence | Restore files from matching recovery point; verify attachment references |
| Lost Docker metadata, NVMe healthy | Do not recreate volumes blindly | Reattach verified named volumes and Compose config |
| NVMe or PC loss | Replace host and secure it first | Restore repository release, secrets, database, and uploads from off-machine backup |
| Cloudflare outage/misconfiguration | Preserve local service | Restore recorded DNS/Tunnel state; keep Render fallback if still approved |
| Credential compromise | Freeze affected access, preserve logs | Rotate only the affected credential, restart dependants, verify sessions/access |

## New-host recovery order

1. Install supported Ubuntu and security updates.
2. Configure restricted administration access and firewall.
3. Install Docker from its official repository and verify daemon permissions.
4. Restore the reviewed Axora release, not an arbitrary working tree.
5. Restore secrets with root-only permissions without printing them.
6. Restore PostgreSQL into a new volume and validate it.
7. Restore `/var/lib/axora-production/uploads`.
8. Start Axora on loopback and complete local workflows.
9. Restore the dedicated production `cloudflared` container token, enroll the
   Tunnel, and verify public health without altering the legacy host Tunnel.
10. Install health/deployment timers only after repository governance is
    restored.
11. Create a fresh verified off-machine recovery point.

## Recovery drills

Before Render decommissioning and at least quarterly thereafter:

- restore the latest off-machine backup to isolation;
- measure restore and validation time;
- verify a sample product image and attachment byte-for-byte;
- test application rollback;
- verify service recovery after reboot;
- verify the Cloudflare configuration rollback record;
- record gaps and update this runbook.

Never report a drill as successful until the restored application passes
readiness and representative authenticated workflows.
