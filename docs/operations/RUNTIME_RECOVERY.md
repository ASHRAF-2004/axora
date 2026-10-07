# Focused Axora runtime recovery

This procedure operates Axora services on the existing host. It does not
authorize a computer reboot/shutdown, database reset/restore, DNS change,
historical email replay, or unrelated workload restart.

## Known baseline and failure boundaries

The inspected protected/deployed revision was
`cccd272be606cb2d05bd0f097cd725427506fb45`, migration 136. Application/public
readiness was green while the transactional email worker failed its claims.
The original errors were private invoice-helper EXECUTE denial (`42501`),
completion parameter inference (`42P08`), and retry-delay EXECUTE denial.
An HTTP listener answering is not proof that a queue progresses.

Retained cleanup/integration worker logs also show idle PostgreSQL pool errors
(`57P01`) becoming uncaught process errors. The shared idle-error listener lets
node-postgres discard the failed client and reconnect on the next ordinary
query. Worker progress readiness becomes degraded until a successful poll.
This does not replay a failed transaction or force-reset a pool. See the
[node-postgres Pool error contract](https://node-postgres.com/apis/pool).

Migration 137 preserves the private raw invoice helpers and adds bounded
worker-lane capabilities. The lane is asserted by trusted server-side database
context after private HMAC authentication; it is not a separate database login.
Payloads require the exact current unexpired lease. Lost acknowledgements stay
uncertain; do not fabricate a new delivery ID to retry them.

## Observe before intervening

1. Confirm protected main, deployed revision/digest, live migration ledger and
   current sealed release. Do not assume a previous report's version.
2. Check app/database/public readiness **and each affected worker's readiness**.
   Keep essential purchasing availability separate from email/provider health.
3. Inspect fixed event names, SQLSTATE, queue/claim/completion stage and durable
   lease/attempt status. Do not print queue bodies, bearer links, credentials,
   provider keys or full exception stacks containing private data.
4. Check resource headroom, active business activity, other workloads and backup
   integrity. Docker owns container recovery; do not add a competing loop.

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
curl --fail --silent --show-error https://axora.management/api/health/ready
sudo /usr/local/libexec/axora-production/health-check.sh --external
```

Use the current sealed release's Compose files and protected runtime environment
for operations. Do not use the dirty development checkout as runtime authority.
Boot must start the local last-known-good immutable image without a source
build, GitHub login or new download.

## Backlog safety

Before enabling repaired queue claims, hold the specifically identified eight
historical zero-attempt PENDING Contact/invoice jobs for review. Record their
IDs, previous due times, owner/correlation and audited hold transaction in the
private operational evidence directory. Preserve every enquiry and invoice.
Do not mutate balances or mark unsent jobs as sent.

- Do not use agent-wide RESUME: it releases all infinity-held jobs.
- Existing UNCERTAIN jobs need owner-only evidence reconciliation, not retry.
- Compare durable provider attempts and provider delivery fingerprints before
  releasing any historical job individually.
- This pass allows two uniquely labelled new Contact smokes total, not a bulk
  catch-up. Provider acceptance, provider delivery and Gmail Inbox receipt are
  different evidence states.

## Bounded service trial

The task allows at most two controlled Axora service/container trials after a
verified encrypted database/files backup and disposable restore proof, locally
available previous image, activity checks, supported quiescence/drain, announced
blast radius and a saved secret-free checkpoint. It does not allow stopping
shared Docker, networking, unrelated services or the computer.

1. Identify exact Axora components and expected interruption. Preserve the
   control channel and start an independent bounded readiness collector.
2. Gracefully stop/start or restart only those components. Email sender drains
   active claim/provider/completion work; production Compose allows 45 seconds.
3. Verify useful queue progress, private/public readiness, real authorized
   reads and the exact affected workflows. Measure recovery rather than infer
   it from container status.
4. Restore all intentionally stopped components. Unplanned queue patches,
   secret replacement, database resets or repeated repair commands invalidate
   the acceptance trial. Do not escalate a failure to a computer reboot.

Whole-host boot recovery is **untested in this task**. Read-only historical boot
journals do not turn a service trial into a host reboot test.

## Rollback and stop conditions

The previous immutable baseline is locally present:
`ghcr.io/ashraf-2004/axora@sha256:c66d304fbfba7af37869790f3216df7867d0cd5bc9f55a626a291c23fef485ad`.

```bash
sudo /usr/local/libexec/axora-production/rollback.sh previous
```

Run rollback only after verifying what `previous` currently identifies. It
reverts application/image configuration, not applied migrations, audit records,
new data or external sends. Migration 137 is additive and keeps old function
signatures/private denials; an old image remains schema-compatible but restores
the old email failure. Its purpose is containment, not email recovery. Do not
edit an applied migration or restore a stale database over new writes.

Migration 138 revokes three raw catalog DELETE grants and exposes one audited
Owner lifecycle capability. A pre-138 image remains otherwise schema-compatible,
but its legacy permanent product deletion will be blocked after migration 138.
Rollback therefore contains application faults; it does not restore that
legacy deletion path. Keep the capability/grants intact and use a reviewed
forward fix, rather than weakening protections to make an old image delete.

Stop for financial/tenant isolation uncertainty, failed health recovery,
unresolved destructive-action authority, a failed required gate or inadequate
recovery access. Keep the affected external-send queue held while preserving
unrelated purchasing functions.

## Backup evidence

The pre-change encrypted artifact
`axora-reset-20261007T175617Z-cccd272be606.tar.gpg` passed AES256 integrity and
decryption, isolated restoration of 240 tables/136 migrations, and persistent
file comparison at 2026-10-07T17:56:26Z. It resides under the root-only
`/var/lib/axora-production/reset-backups` directory. No off-device destination
is currently configured; this is a single-host resilience limitation, not an
off-device backup claim.
