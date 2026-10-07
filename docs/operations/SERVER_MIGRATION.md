# Axora server migration guide

Version: 2026-10-08. Audience: the owner and the operator assisting them.

**DOCUMENTATION ONLY. No host migration, production restore, cutover, shutdown,
reboot, decommission or secure erasure is authorized or performed by this guide.**
Commands below are for a later separately approved task. Read every stop condition
before using them. The current machine must remain powered on in this recovery pass.

## 1. Understand the safe route

Move a verified copy privately, test it without external effects, freeze the old
writer, take one final consistent copy, and enable exactly one production writer.
Do not put two independent writable database copies behind `axora.management`.

<!-- conceptual-migration-diagram -->

The diagram is conceptual, not a screenshot or evidence of a completed migration.
The destination is not supplied. This guide assumes another Ubuntu x86_64 host;
destination IPs, disk layout, capacity, firewall and provider connections remain
untested. A small maintenance outage is expected. One host cannot serve while
that host is powered off. No business-approved RPO/RTO is established here.

### Evidence, not promises

| Item | Actual status on 2026-10-08 |
| --- | --- |
| Current recorded production | SHA `a40a70bef3104d7e08959dfdc6e55a36ba6beb31`; schema 138 |
| Encrypted database/files proof | Disposable 240-table / 138-migration restore and files comparison passed at 2026-10-07 19:46:15 UTC |
| Service recovery | One idle email-sender graceful stop/start passed; not a host-boot or Contact-delivery proof |
| Destination migration and boot | Not tested; no destination supplied |
| Independent/off-device backup | Not configured; a local encrypted copy does not protect against loss of this host |
| Full workflow acceptance | Contact mailbox, original registration/product cases and other live fixture gaps are tracked separately; health alone is insufficient |

**STOP:** no independent backup, missing secrets, ambiguous target, incompatible
image/schema, unfenced external effects, or unresolved financial/tenant evidence.

<!-- pdf-page -->

## 2. Inventory before packing

Record exact versions again immediately before the future move. Do not treat
this dated inventory as authority for a later release. Do not print `runtime.env`,
secret files, Docker environment arrays, queue bodies or bearer links.

| Item | Recorded value or safe location |
| --- | --- |
| OS / architecture | Ubuntu 26.04 LTS / x86_64 |
| CPU | AMD Ryzen 5 9600X, 6 cores / 12 logical CPUs; recheck destination RAM/disk/headroom |
| Docker / Compose | Engine 29.7.1 / Compose 5.4.0 |
| Application | `ghcr.io/ashraf-2004/axora@sha256:c9442d4aea05e00bf849062f2963f529f606f0e4164a1f05e75297b030f8b7f2` |
| PostgreSQL | 18.4-alpine3.24; digest pinned in sealed Compose |
| Caddy / cloudflared / Tailscale | 2.11.4 / 2026.7.3 / 1.98.8; exact digests in sealed Compose |
| Database / persistent volume | `axora_hybrid` / `axora_postgres_data`; inspect exact current mounts privately |
| Files | `/var/lib/axora-production/uploads`; most current images/attachments also live in PostgreSQL |
| Sealed release | `/var/lib/axora-production/releases/<exact-40-character-SHA>` |
| Non-secret runtime configuration | `/etc/axora-production/runtime.env` and `deploy.env`; review privately |
| App secrets | `/etc/axora-production/secrets`; separate encrypted custody, not ordinary dump/archive |
| Retained database secrets/source | `axora-db-1` also mounts `/srv/axora/secrets/{axora_app_password,postgres_admin_password}` and `/srv/axora/database/{migrations,admin,init}` read-only; not all secrets/source mounts are under the current sealed release |
| Controllers / state / logs | `/usr/local/libexec/axora-production`; `/var/lib/axora-production`; `/var/log/axora-production` |
| Scheduling / access | Docker restart policies; Axora health/backup/deploy units; restricted SSH controller; audit all actual timers/runners |

Dated read-only observations at 2026-10-07 21:37 UTC: PostgreSQL 18.4 has
`plpgsql` 1.0 and default/global tablespaces; health timer is enabled every three
minutes and backup daily. The retained DB volume mounts at `/var/lib/postgresql`.
The app runs as `axora`, reads its `/etc` secret mounts and writes the persistent
uploads mount. Inventory exact ownership/modes privately and reprovision the
controlled database roles on the destination; do not blindly copy host paths or
assume the existing database mounts came from the current sealed release.

Use the read-only checks in `REBOOT_RECOVERY.md`, Section 2. Record RAM/free disk,
encryption/unlock requirements, mounts/permissions, SSH host fingerprints and
local immutable images. Recheck extensions with a read-only administrator query:
`SELECT extname, extversion FROM pg_extension ORDER BY extname;` Do not assume
hardware or extension compatibility from the OS name alone.

**Expected:** one unambiguous release/digest/schema record and a complete private
dependency inventory. **STOP:** unknown persistent mounts or unrecorded supervisors.

<!-- pdf-page -->

## 3. Protect the recovery point and secrets

Use Axora's verified PostgreSQL custom-format logical dump plus matching uploads
and migration/file manifests. It is the simplest existing path for this move.
Logical dumps recreate database objects; cluster roles and their credentials
need separate controlled provisioning. Keep PostgreSQL 18.4 and the pinned
images initially: a host move is not also a database upgrade.

A version-compatible physical backup with all required WAL may suit a later
large-database plan, but needs a tested base-backup/snapshot procedure and matching
server/storage assumptions. **Never ordinary-copy a running PostgreSQL data
directory, selected tables or Docker volume.** This guide does not establish PITR.

### Current verified source (historical, not the future final transfer)

- Source: `/var/lib/axora-production/backups/axora-20261007T194607Z`.
- Encrypted artifact: `/var/lib/axora-production/reset-backups/axora-reset-20261007T194607Z-a40a70bef310.tar.gpg`.
- Ciphertext SHA256: `14cb647466a8b84f3e6a1d0afe8d3cb3fb6f8d69055863b8e795e494f0be1a79`.
- Verified 2026-10-07 19:46:15 UTC: AES256 integrity/decryption, 240 tables,
  138 migrations and persistent files. It is not an off-device copy or proof of
  a runnable restored application.

During an approved window, the existing root controller can create a fresh
guarded encrypted recovery point. This is a write operation, not a diagnostic:

```bash
sudo /usr/local/libexec/axora-production/encrypted-reset-backup.sh
```

Copy the encrypted artifact, manifests and verification record to independently
controlled encrypted storage; verify destination checksums and restore access.
Escrow the decryption passphrase separately, not beside its archive. Record who
can recover it without this machine or the agent session.

Back up secrets separately and offline with access auditing: session signing,
database/worker credentials, integration encryption key, email-service HMAC,
Resend API/webhook material, Turnstile secret, approved Tunnel credentials and
deployment access. Preserve encryption keys needed to decrypt existing records.
Do not rotate or replace working values merely to move hosts. Inventory public
configuration separately. Never put actual values into these documents or shell
arguments/history. Use root-only files and the existing approved secret handoff.

**Expected:** two independently recoverable encrypted packages (data/files and
secrets), verified on the destination. **STOP:** local-only backup, absent key
custody, unresolved recent writes, or insufficient destination disk space.

<!-- pdf-page -->

## 4. Prepare a private destination, not duplicate production

1. Verify that the operator is on the new host. Match the recorded architecture,
   supported Ubuntu, disk capacity, clock and encryption/unlock policy. Retain
   ordinary authentication and firewall protections.
2. Install the supported Docker/Compose packages from Docker's official Ubuntu
   repository, selecting reviewed versions. Commands from older setup guides
   are not a license to uninstall packages on the working production host.
3. Transfer the exact sealed release and digest-pinned images privately. Verify
   SHA/digest; cache the last-known-good images locally. Boot recovery must not
   require a source build, GitHub login or new image download.
4. Transfer root-only configuration/secrets through the approved encrypted
   process. Preserve required file owner/group permissions; container secret
   access uses the reviewed group mapping. No private values in Git or logs.
5. Use a new isolated Compose project, new PostgreSQL volume and new upload
   directory. Do not reuse `axora_postgres_data` from the old host or copy its
   live volume. Name every target explicitly in the private move record.
6. Start only the destination database first. Provision the existing restricted
   database roles from root-only files; restore into a **new absent database**.
   Use the exact sealed production three-file Compose configuration, not the
   generic `scripts/server` `.env`/`secrets` defaults.

### Restore/rehearsal fence: defense in depth

No production Tunnel connector or deployment runner/timer on the destination;
no public listening ports; Caddy diagnostics on loopback only. Do not copy
`tailscale_state`, the host Tailscale identity, `/var/lib/tailscale` or SSH host
private keys. Enroll a fresh authorized device and verify its new fingerprints.
Do not expose PostgreSQL through a cloned `tailscale-db` identity.

Stop/omit email, integration, budget, document and cleanup workers during initial
validation. Budget/document/cleanup workers may mutate data even without external
network access. Explicitly disable email delivery/events and external
API/webhooks/Zapier/Slack. Make application egress networks internal in the
reviewed **destination-only** override and enforce an independent host/network
egress fence. A false email flag alone is not a network fence. Never grant the
restored app superuser access to make a test pass.

For isolated account/setup tests, use a deliberately wired non-delivering test
transport; block all real Resend/Slack/webhook destinations. Never enable the
production provider to see whether a copied outbox sends. Do not consume existing
real invitations or replay historical jobs. Preserve canonical account URL and
token handling; do not manufacture sessions or change copied passwords.

**Expected:** the new copy cannot receive production traffic, send externally,
run scheduled writes or impersonate the old device. **STOP:** any fence uncertain.

<!-- pdf-page -->

## 5. Restore a real protected database before starting an app

This step needs a reviewed destination-specific command sheet and an approved
restore rehearsal. Examples are **untested destination templates**, not commands
to run on the current host. Values in angle brackets must be resolved first.

The existing backup verifier temporarily installs
`workflow_metadata_is_safe(...) AS SELECT true` and excludes its dump entry for
an integrity/count-only disposable restore. That database is **not safe to run**.
Do not treat a `.verified` marker, table count or checksum as grant/RLS/validator
acceptance. `scripts/server/import-hybrid-candidate.sh` also uses generic server
configuration and is not a drop-in installed production cutover controller.

Use the canonical validator from the **exact sealed**
`018_workflow_events_and_notifications.sql`: its function-only definition is
independent of table creation. Review its extraction before execution, retain
its immutable recursion/size/credential-key checks, and qualify the trusted
`public` search path. Do not rerun the entire historical migration on restored
data, edit it, or replace the validator with a permissive stub.

### Ordered destination restore

1. Validate archive members and encrypted/inner manifests with the current
   guarded verifier. Reject links, traversal, unexpected files or checksum
   mismatch. Decrypt/extract only in a new root-owned 0700 directory.
2. Assert destination container, **absent** database and exact project/volume.
   Create it from `template0`; revoke PUBLIC/application CONNECT while preparing.
3. Install the reviewed canonical function-only definition first. Generate the
   dump TOC; exclude only that function's own definition/ACL entries. Keep every
   business table, FK, trigger, RLS policy and history object. Review the TOC diff.
4. Restore with `--no-owner --no-privileges --exit-on-error`. Stop on any error;
   do not start an app against partial data.
5. Compare the restored migration filename/checksum ledger with the sealed
   source manifest. No mismatch accepted. Apply only a separately reviewed
   forward migration through the canonical runner if the chosen image requires it.
6. Replay exact current `database/admin/apply-app-grants.sql` **after restore and
   migrations**, before allowing app access. Review worker role grants too. Do
   not preserve arbitrary dump ACLs or issue blanket corrective grants.
7. Verify strict validator, RLS/role capabilities and financial/file evidence in
   Section 6. Only then permit the restricted app role and isolated app.

Copyable invocation shape, on the fenced destination only:

```bash
docker exec <destination-db-container> createdb --username postgres \
  --template template0 <new-absent-database>
docker exec -i <destination-db-container> pg_restore --username postgres \
  --dbname <new-absent-database> --no-owner --no-privileges \
  --exit-on-error --use-list=<reviewed-container-toc-path> < <verified-dump>
docker exec <destination-db-container> psql -X --username postgres \
  --dbname <new-absent-database> --set=ON_ERROR_STOP=1 \
  --file /database/admin/apply-app-grants.sql
```

This is not a complete one-click script: canonical validator/TOC installation,
CONNECT fence and role provisioning must be reviewed before these commands.
**Expected:** no restore errors; exact schema/checksums; canonical protections.

<!-- pdf-page -->

## 6. Validate privately and record a go/no-go decision

**Do not open ingress or provider egress yet.** An operator must compare source
and restored evidence without exposing rows or sensitive totals publicly.

Use the canonical migration-status checker with exact destination arguments:

```bash
sudo /usr/local/libexec/axora-production/migration-status.sh \
  <exact-sealed-release-directory> <destination-db-container> <restored-database>
```

**Expected:** `none`. `required`, failure or an unexpected checksum is a stop,
not permission to start the app. Replaying grants twice must retain all denials.
The generic hybrid validator is useful but insufficient alone; validate actual
capability execution and strict function behavior too.

| Check | Required evidence before enabling app/traffic |
| --- | --- |
| Validator | Safe small metadata returns true; a credential-key fixture returns false; canonical function definition matches reviewed release; no SELECT-true stub |
| Roles / RLS | Restricted app and worker identities; Owner/CompanyAdmin/BranchAdmin scopes; explicit DENY; foreign-tenant direct reads/actions fail; no superuser/bypassrls app |
| Lifecycle | Schema 138: raw DELETE on products/images/suppliers remains denied. If approved schema 139 applied: raw branch lifecycle/evidence UPDATE and raw DELETE remain denied; metadata editing retained |
| Financial reconciliation | Matching Wallet balances, ledgers, branch periods/allocations/reservations, payments, invoices, audit/history and command IDs; no test transaction to manufacture parity |
| Files / documents | Match upload directory/file/byte checksums; existing logo/gallery and attachment/PDF opens under authorized role; database content intact |
| Accounts / sessions | Protected Owner/account assignment/status; password hashes unchanged; session/encryption material available; isolated disposable setup/registration only |
| Queues | Outbox/attempt/lease/hold state retained; no bulk replay; UNCERTAIN sends reconciled with provider evidence/idempotency window |
| App / recovery | Exact compatible immutable image, local/readiness and authorized reads; bounded service stop/start in isolation; useful worker progress with isolated transport |

For schema 138, the recorded a40/c944 image is the known application pair.
Migration 139 is a local reviewed candidate until its protected release/deployment
is recorded; do not label it live or invent an image digest. If adopted later,
use its verified exact compatible image and grants. A prior image may show old
controls but must not regain raw delete/lifecycle authority.

Retain restoration logs, exact commands, elapsed time, manifests and checklist in
restricted evidence. Delete no real account/product/history as cleanup. Measure
RPO/RTO in rehearsal; do not promise values from table counts or HTTP success.

**STOP:** mismatched totals/files, confidential pricing leak, scope failure,
unprogressing queue, stale leases, missing key, changed grants or unexpected writes.

<!-- pdf-page -->

## 7. Future cutover: enable only one writer

This is a separately authorized maintenance operation, **not performed now**.
An explicit command plan must name both hosts, every service/timer/runner,
the public Tunnel/origin route and the final recovery point.

1. Announce the window, save access/resume instructions and engage an independent
   observer. Reconfirm capacity, exact identity and recovery keys.
2. Freeze old ingress/writes using a reviewed maintenance boundary; drain active
   requests and external sends. Stop old app and every write/external-effect
   worker. Stop/fence deployment runners/timers, old production connector and
   any other route to the old origin. Check active DB clients/transactions.
3. Leave the old database intact and powered on but unavailable to business
   writers. Prevent stopped services from auto-rejoining after daemon/host
   restart. `unless-stopped` is not the sole fence: pin a persistent network,
   ingress and deployment hold with an audited restoration plan.
4. Take the final consistent dump **and files after quiescence**. An online
   database snapshot alone does not synchronize later file writes. Verify,
   encrypt, transfer and restore it into a fresh destination candidate. Preserve
   old/prior candidates; no overwrite. Repeat Section 6 comparisons.
5. Obtain the recorded go decision. Start one destination app/worker set with
   approved runtime configuration. Reconcile queues before enabling external
   effects; keep historical holds and uncertain sends protected.
6. Connect only the intended destination Tunnel/origin. Same Tunnel credentials
   on two independent hosts can make them replicas, routing users to either
   copy; do not use that as database migration/failover. Confirm the old
   connector has no live session and no alternate origin path.
7. Verify local/public readiness and real authorized read-only routes first;
   then only separately approved controlled workflow writes. Record first new
   production write time and identifiers. Verify email/provider and worker
   progress distinctly; preserve Resend and Cloudflare Email Routing settings.
8. Resume users only after explicit acceptance. Keep old host stopped/fenced,
   data preserved and key custody available for the rollback retention period.

**Expected:** exactly one public origin, one authoritative writable database and
one active external-effect worker set. If this cannot be proved, remain in
maintenance and stop. A second independent writer is never a fallback.

### No stale-data rollback

Before **any new writes**, fence destination ingress/workers/connectors and
verify no write/external effect occurred; return traffic to the preserved old
host under the reverse single-writer procedure.

After **new writes**, the old database is stale. Freeze the destination, preserve
and reconcile its newest database/files/audit/provider evidence, then transfer
the authoritative state or repair forward. Never restore the old dump over the
new data or send users to both copies. Application rollback changes code, not
schema, transactions, schedules, configuration or provider sends.

<!-- pdf-page -->

## 8. Rollback checkpoints and later decommission

| Checkpoint | Recovery choice / stop condition |
| --- | --- |
| Destination setup, no traffic | Keep production untouched; retain failed candidate privately for diagnosis; scoped approved disposable cleanup only |
| Final transfer, no destination writes | Reverse the writer/ingress fence; old preserved copy may resume after explicit zero-new-write proof |
| Destination has accepted writes | Do not resume stale old data. Freeze, preserve latest state, reconcile/transfer or repair forward |
| New schema applied | No down-migration or grant weakening. Verify previous image compatibility; prefer forward fix |
| Provider acceptance uncertain | Keep durable UNCERTAIN/hold state; reconcile attempts/idempotency before any resend |

Pre-137/138 image rollback restores the old email defect and blocks its legacy
permanent catalog DELETE after schema 138. The previous core939 image is
application-compatible with recorded a40/schema138. Inspect what `previous`
means at the actual rollback time; do not assume it identifies that old image.
Schema 139 retains function signatures but rejects prohibited BranchAdmin
lifecycle and emits typed budget refusal. An old UI may display a generic error;
do not undo protections to make it mutate. No schema/data rollback is supplied.

### Explicit disposable cleanup, not broad deletion

Prefer retaining a failed isolated candidate until evidence is reviewed. If
cleanup is approved, record a typed confirmation such as
`REMOVE DISPOSABLE axora_migration_20261008_trial1 ON <verified-destination-host>`.
Before the single named `dropdb`, assert hostname, loopback/private destination
endpoint, isolated database prefix, exact owner, no app connections, preserved
evidence and a verified retained source. No wildcard, current production name,
workspace root, recursive home deletion or broad Docker pruning. Remove a named
disposable project/volume only after inspecting exact labels and mount paths;
do not use `down -v`, `--remove-orphans` or volume prune. Preserve `tailscale-db`.

### Decommission is a later separate decision

- First disable/fence old app, workers, connectors, deployment triggers and
  schedules so the old machine cannot silently rejoin. Keep it isolated for the
  agreed rollback retention period. No erasure during this pass.
- Require explicit owner approval, independent encrypted recovery proof, new
  host acceptance and a final asset/identity list before irreversible erasure.
- Revoke retired machine/provider/deployment credentials only after tracing
  shared use; do not revoke a shared Tunnel/session/encryption key blindly.
- SSD/NVMe needs the drive/vendor-supported sanitize or reviewed encryption-key
  disposal process; HDD may use a reviewed overwrite/sanitize procedure. Match
  the exact drive and policy. Ordinary file deletion is not secure erasure.
  Do not claim key destruction sanitizes unencrypted replicas or backups.

Final go checklist: independent data/secret backups; strict restore validated;
exact image/schema/grants; no confidentiality leak; one writer/connector;
queues reconciled; rollback-after-writes plan; authorized workflow evidence;
future whole-host boot check still explicitly pending.

<!-- pdf-page -->

## 9. Genuine public health example and limitations

<!-- genuine-public-health-screenshot -->

**Callout 1:** the actual JSON is `{"status":"ready"}`. This is one production
public readiness result, not proof that Contact email arrived, an invitation
completed, a protected deletion succeeded, financial restoration reconciled,
or the host booted correctly.

Capture provenance: real headed Chrome 151 production GET of
`https://axora.management/api/health/ready`, HTTP 200, approximately
2026-10-07 21:34 UTC (2026-10-08 local time). A new compact 1000x220 browser viewport was captured,
not cropped or synthesized. No signed-in shell or secret appears in the image.
The generator takes the genuine screenshot explicitly; the screenshot is kept
in restricted task evidence, not an application fixture or source credential.

### Research and applicability

Reviewed 2026-10-08. Sources describe platform behavior; they do not certify
this untested destination. Recheck current vendor support before the later move.

- [PostgreSQL 18 logical dump/restore](https://www.postgresql.org/docs/18/backup-dump.html): snapshot consistency, custom archive and role-provisioning considerations.
- [PostgreSQL 18 physical backup](https://www.postgresql.org/docs/18/backup-file.html): whole-cluster consistency and why live ordinary file copy is unsafe.
- [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/): supported OS/architecture, official repository and exposed-port firewall implications.
- [Docker restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/): manually stopped `unless-stopped` containers remain stopped; do not add a competing supervisor.
- [Tailscale duplicate device identity](https://tailscale.com/docs/reference/troubleshooting/network-configuration/multiple-devices-same-100-x-ip-address): copied state can duplicate node identity.
- [Cloudflare Tunnel replicas](https://developers.cloudflare.com/tunnel/configuration/): another connector on the same tunnel may route traffic to another origin; it is not safe synchronization of independent databases.

Read alongside `REBOOT_RECOVERY.md`, `RUNTIME_RECOVERY.md`, the current sealed
Compose/controllers/migrations and `docs/evidence/server-recovery/FINAL_REPORT.md`.
Older `PRODUCTION_RUNBOOK.md`, `DISASTER_RECOVERY.md` and architecture documents
retain historical Render/cold-boot assumptions. Their generic reboot/install
examples do not override this pass's host-restart prohibition or these exact
schema/strict-restore safeguards.
