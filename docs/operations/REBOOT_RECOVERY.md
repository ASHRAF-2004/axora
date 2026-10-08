# Axora service and future boot recovery

Version: 2026-10-08. **The computer must remain powered on in this pass. Do not
reboot, shut down, power-cycle or schedule a host restart.** This runbook does
not authorize one. Future whole-host boot validation requires a separately
approved window. A container restart is not a host reboot.

## Current checkpoint - 2026-10-08 14:48 UTC

Production is d82 (`d82a3bb4785e6ba7b7e4e7ec125636a6368f699f`), OCI
`sha256:bc8c29336bdf44ef9c01096bf957c67ec5e58986548074ba5204d7b688d07bf8`,
schema139. Contact B's direct persistence/provider/delivery/mailbox chain is
evidenced; the two-smoke cap is closed. No further Send or historical replay.
The original live queued-across-restart Contact case remains unperformed;
isolated interrupted-send/lease tests and the historical idle trial are distinct.

Earlier fenced a40/b7 registration/product proofs are not live acceptance.
Current03 created its company/invitation/product normally, then stopped before
setup/deletion/restart on its strict audit guard. Corrected read-only preflight
checks pass; no second controlled trial executed. One remaining trial is reserved
for complete affected-workflow acceptance. Original exceptions, live disposable
limits and the final CI's unexplained gallery retry remain disclosed. This update
creates no current-image/host restart acceptance. See
SERVER_MIGRATION's current checkpoint and FINAL_REPORT before any future action.

Read-only restored-data audit checks verify complete anchored links and original
rows. The original21 timestamp-order warnings remain, but two new concurrent
read audits were appended17microseconds opposite timestamp order; current03's
canonical verifier reports23. Hash/link errors remain zero. No audit data was
rewritten and the strict guard remains failed. A restart is not a repair for this
discrepancy; separately approve a forward-only audit-ordering/verification design.
Keep its bounded, fenced resources and untaken RAM-only invitation intact until
that workflow can safely continue. Do not replay or resend its consumed stages.

## 1. What was and was not proven

One idle email-sender-only graceful stop/start passed on recorded a40/schema138:
same container identity, clean process exit, useful worker readiness in 189 ms,
Docker healthy in approximately 6.4 seconds, public readiness HTTP 200 and eight
historical queue holds unchanged. See the precise restricted events and full
limitations in `docs/evidence/server-recovery/FINAL_REPORT.md`.

That trial does not prove an active send survived, queued-mail or all-worker
restart, host boot, disk unlock, off-device restore or loss of power. Contact B's
later mailbox evidence is independent of the trial. No host shutdown/reboot
occurred as part of it. Other unverified scenarios must stay pending; a health
response is insufficient.

### Recovery order (conceptual, not a new supervisor)

<!-- conceptual-recovery-diagram -->

Host storage/network and Docker must be available; PostgreSQL becomes ready;
the compatible app and workers progress; Caddy and the production connector
serve the public route. Docker owns container restart. Do not install another
host loop that fights Docker or indiscriminately restarts unrelated services.
`unless-stopped` does not start a deliberately stopped container after a daemon
restart. Migrations are one-shot, not a background auto-repair for a bad schema.

## 2. Observe safely before intervening

```bash
uname -m
docker version --format '{{.Server.Version}}'
docker compose version --short
systemctl is-enabled docker
systemctl is-active docker
systemctl list-timers --all --no-pager
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
curl --fail --silent --show-error https://axora.management/api/health/ready
sudo /usr/local/libexec/axora-production/health-check.sh --external
```

Record exact deployed SHA/digest, schema/checksum drift and local cached images.
Read only bounded known event names/SQLSTATE and queue stages; never dump Docker
environment/configuration, secret files, invitation links, message bodies or
provider headers. Public app health must be checked separately from sender,
budget/document, cleanup and integration readiness/useful progress.

## 3. Bounded service recovery, not a computer restart

1. Name the exact affected service/boundary. Preserve financial/tenant integrity;
   distinguish maintenance disconnects from errors. Never reset queues/databases.
2. Verify encrypted database/files proof, cached compatible previous image,
   headroom and no conflicting business work. Save a secret-free checkpoint and
   exact resume instruction. Agent/browser host dependencies mean resumption
   is not guaranteed; maintain independent recovery access/observer.
3. Use installed **sealed** three-file Compose/root runtime; approved Axora
   components only. Drain work; sender grace45seconds. Docker/PostgreSQL/network/
   shared-host stops are outside sender-only trial authority.
4. Approved graceful service stop/start/restart only; no computer reboot,
   scheduled reboot, secret replacement or mass queue release.
5. Verify useful queue progress and authorized read-only workflows, not health
   alone. Reconcile claim/lease/provider acknowledgement; preserve UNCERTAIN
   sends/exact historical holds. Idle queues do not prove full delivery.
6. Restore every stopped component; record recovery time, controller exit,
   manual intervention and pending scenarios. Unplanned manual repair means
   trial failure; never escalate to reboot.

### Fault decision table

| Observation | Safe next boundary |
| --- | --- |
| Public failure, local ready | Check existing Caddy/Tunnel route/connector, not database restore |
| Sender ready degraded, app ready | Bound poll/claim/provider/grant diagnosis; retain durable enquiries |
| Idle socket SQLSTATE 57P01 | Dead idle client discarded/next query recovers; no business-write replay |
| Image/schema mismatch | Hold deployment; exact manifest/compatible image; repair forward |
| Financial or tenant uncertainty | Freeze relevant writes/preserve evidence; no blind restore/grant widening |
| Manually stopped container | Establish cause before approved start; restart policy is not permission |

An application-only rollback is available through the installed controller:

```bash
sudo /usr/local/libexec/axora-production/rollback.sh previous
sudo /usr/local/libexec/axora-production/health-check.sh --external
```

Before using it, inspect the exact recorded `previous` identity and verify current
schema compatibility. It does not reverse migrations, holds, audit records,
new data or external sends. See `SERVER_MIGRATION.md` for schema138/139 limits.

<!-- pdf-page -->

## 4. Future whole-host boot acceptance (not tested here)

This checklist describes a **future separately authorized** task only. No reboot
command is included to prevent accidental use during this pass. Obtain owner
approval, bounded maintenance timing and a recovery operator before execution.

- Verify encrypted off-device data/files and separate secrets, independent
  restore access, local immutable images and disk/storage health. A local
  backup is insufficient if the host is lost.
- Determine firmware boot order, encrypted-disk unlock and physical/remote
  console requirements. Do not disable encryption or authentication to achieve
  unattended boot. Record whether an operator must unlock storage.
- Check read-only enablement and unit definitions for Docker, Axora timers,
  deployment/health/backup controller and the actual production connector.
  Distinguish retained legacy systemd cloudflared from the production Compose
  connector. Inventory other workloads; do not disrupt them under Axora authority.
- Capture pre-event boot ID, current release/schema, container policies/mounts,
  queue/hold state, active users and allowed catch-up work. Save resume and
  rollback instructions outside the agent-host dependency.
- After the separately authorized future boot, record new boot ID and time,
  required disk unlock, Docker/database/app/worker/Caddy/connector readiness and
  measured public recovery. Inspect native useful progress, not just ports.
- Verify exact image/schema/secrets/mounts; normal authorized login and
  read-only tenant/branch/product/Wallet pages. Controlled workflow writes and
  provider smokes need their own named fixtures/authorization. Never create
  financial transactions or delete history merely for a boot check.
- Compare expected scheduled budget renewals, lease recovery and durable queue
  progress separately from unintended changes. No random resend of historical
  mail; distinguish accepted, delivered and mailbox-verified evidence.
- If an extra `compose up`, queue patch, secret fix, restore or repeated manual
  repair is needed beyond the prescribed recovery, record failed unattended
  boot acceptance. Restore useful services with the prepared scope; do not
  conceal interventions or guarantee zero future failures.

Final record: event authorization and scope; exact identities; pre/post boot ID;
measured times; useful service/queue checks; restored stopped components;
workflow/provider result; manual interventions; preserved data; remaining gaps.

## 5. Resume instruction template

"Read the secret-free checkpoint and current FINAL_REPORT; inspect protected
main, deployed SHA/OCI and schema/checksum drift again. Keep the computer powered
on. Do not repeat completed trials, replay held mail, restore production or alter
financial records. Use the sealed controller/configuration and resume only the
named pending scenario with its existing authority and backup proof."

This is a template, not an authorization. Keep private access credentials and
fixture details in the approved protected handoff, not this document.
