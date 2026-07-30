# Axora production runbook

This runbook operates the local Axora production stack after its migration from
Render. It does not authorize Render decommissioning, DNS changes, database
restores, or secret replacement.

## Non-negotiable safeguards

- Never run `docker compose down -v`.
- Never remove production Docker volumes or use `--remove-orphans`.
- Never remove the existing `tailscale-db` service.
- Never overwrite a working secret or restore over production without a
  verified backup and explicit approval.
- Keep Render active until public verification is complete and Ashraf confirms
  decommissioning.
- Do not expose PostgreSQL, Docker, Caddy's origin, Next.js, SSH, metrics, or
  admin tools through public inbound ports or the Tunnel.

## Manual prerequisites

These checks require an administrator or interactive approval and must be
recorded before automatic deployment is enabled:

- [ ] GitHub repository is private.
- [ ] `main` is protected; pull requests and both `CI` jobs are required.
- [ ] Force pushes and deletion of `main` are blocked.
- [ ] Repository administrators and CODEOWNERS are reviewed.
- [ ] The generated Axora production SSH public key is registered in GitHub as
      a read-only deploy key; its private key remains root-only on this PC.
- [ ] Official Cloudflare MCP OAuth is complete and can read the
      `axora.management` zone.
- [ ] A dedicated `axora-production` Tunnel exists; its credential is stored in
      the ignored, access-restricted production secret file outside tracked
      content.
- [ ] Current DNS and Tunnel configuration is recorded for rollback.
- [ ] An encrypted off-machine backup destination is mounted and writable only
      by the backup operator.
- [ ] Ubuntu LVM capacity, free space, time synchronization, and reboot window
      are approved.
- [ ] `sudo` is available for the one-time installer, systemd, firewall,
      permissions, and `cloudflared` changes.
- [ ] Firewall review confirms no public database, Docker, Caddy, Next.js, or
      metrics port. SSH is limited to the approved management network.
- [ ] The existing CUPS listener on TCP 631 is disabled if printing is not
      required, or restricted to the approved LAN if it is required.
- [ ] `/srv/axora`, environment files, deployment configuration, and
      credentials are not group/world writable.
- [ ] `.dockerignore` excludes Git metadata, environment files, secrets,
      backups, persistent uploads, logs, and deployment state from every image
      build context.
- [ ] The recorded active Render session secret has been copied into the stable
      production `session_secret` file without displaying it; the old local
      secret remains preserved separately for rollback.

## Paths and commands

| Purpose | Path or command |
| --- | --- |
| Source checkout | `/srv/axora` |
| Deployment-controller config | `/etc/axora-production/deploy.env` |
| Compose runtime environment | `/etc/axora-production/runtime.env` |
| Production secrets | `/etc/axora-production/secrets` |
| Installed scripts | `/usr/local/libexec/axora-production` |
| Releases, state, and backups | `/var/lib/axora-production` |
| Persistent upload fallback | `/var/lib/axora-production/uploads` |
| Deployment logs | `/var/log/axora-production` |
| Start a deployment | `sudo systemctl start axora-deploy.service` |
| Follow a deployment | `sudo journalctl -u axora-deploy.service -f` |
| External health check | `sudo /usr/local/libexec/axora-production/health-check.sh --external` |
| Roll back application | `sudo /usr/local/libexec/axora-production/rollback.sh previous` |

The production Compose invocation is:

```bash
docker compose \
  --env-file /etc/axora-production/runtime.env \
  -f compose.yaml \
  -f compose.hybrid.yaml \
  -f compose.production.yaml
```

It must preserve `axora_postgres_data`, the host-owned upload and secret
directories, and `tailscale-db`.

### Sudo sessions on this Ubuntu host

This host uses `sudo-rs`, which keeps a separate authentication timestamp for
each terminal. `timestamp_timeout` extends the ticket only inside the terminal
that authenticated; opening a new terminal still requires a password. Keep a
multi-step maintenance operation in one terminal instead of weakening sudo
authentication globally. `env_reset` controls inherited environment variables
and does not change timestamp behavior.

## One-time installation

Perform this from the reviewed migration branch before public traffic changes:

```bash
cd /srv/axora
npm ci
npm run verify
scripts/production/validate-assets.sh
docker build --file Dockerfile --tag "axora-preflight:$(git rev-parse HEAD)" .
sudo bash scripts/production/install.sh
```

The installer generates a repository-specific key. Display only its public half
and add it to GitHub as a deploy key with **Allow write access disabled**:

```bash
sudo cat /etc/axora-production/github_deploy_key.pub
```

Review `/etc/axora-production/deploy.env` and
`/etc/axora-production/runtime.env` without printing credentials. Confirm that
together they identify:

- repository `ASHRAF-2004/axora`;
- branch `refs/heads/main`;
- database `axora_hybrid`;
- public URL `https://axora.management`;
- application `DEMO_MODE=false` from the production Compose configuration;
- local loopback origin;
- `AXORA_SECRETS_DIR=/etc/axora-production/secrets`;
- `AXORA_UPLOADS_DIR=/var/lib/axora-production/uploads`;
- persistent release, backup, and log paths.

Confirm that the dedicated Tunnel token is installed with restrictive
permissions at the secret-file path consumed by `compose.production.yaml`.
Do not replace or reuse the existing host systemd `cloudflared` token; it
belongs to the separate `bekal-production` Tunnel.

Install the recorded, currently active Render `SESSION_SECRET` as the stable
production `session_secret` to preserve cryptographic continuity. Compare
secret files only by a protected hash; never display the value. Do not
overwrite the old local session secret—archive it in the approved encrypted
credential store for the rollback window. Browser cookies from the Render
hostname cannot transfer to `axora.management`, so users should expect one
sign-in on the apex after cutover.

Before the first production start, copy any existing
`/srv/axora/data/uploads` content into the canonical upload directory, compare
file counts and checksums, and keep the source unchanged through the rollback
window.

Do not enable the deployment timer until every governance prerequisite above is
complete.

The apex does not route to this PC during the local bootstrap. With both timers
disabled and an operator present, set `AXORA_REQUIRE_EXTERNAL=false` in
`deploy.env` for the first local-only deployment. This is a temporary staging
exception, not the production setting. Immediately after the apex cutover, set
it back to `true`, run the external health check successfully, and only then
enable automatic deployment.

## Routine operation

### Inspect service state

```bash
sudo systemctl status \
  axora-deploy.timer axora-health.timer axora-backup.timer cloudflared
docker compose \
  --env-file /etc/axora-production/runtime.env \
  -f compose.yaml \
  -f compose.hybrid.yaml \
  -f compose.production.yaml \
  ps
```

### Check health

```bash
curl --fail --silent --show-error \
  --header 'Host: axora.management' \
  http://127.0.0.1:8080/api/health/live
curl --fail --silent --show-error \
  --header 'Host: axora.management' \
  http://127.0.0.1:8080/api/health/ready
curl --fail --silent --show-error \
  https://axora.management/api/health/ready
sudo /usr/local/libexec/axora-production/health-check.sh --external
```

The live endpoint proves the process responds. The ready endpoint must return
success only when the application can query PostgreSQL.

### View logs

```bash
sudo journalctl -u axora-deploy.service --since today
sudo journalctl -u axora-health.service --since today
sudo journalctl -u cloudflared --since today
docker compose \
  --env-file /etc/axora-production/runtime.env \
  -f compose.yaml \
  -f compose.hybrid.yaml \
  -f compose.production.yaml \
  logs --since 30m app caddy cloudflared db
```

The systemd `cloudflared` journal is for the retained legacy Tunnel. Production
Tunnel logs are emitted by the Compose `cloudflared` container.

Do not paste unreviewed logs into issues or chat. Redact cookies, tokens,
credentials, database URLs, personal data, invoice data, and attachments.

### Create a backup

```bash
sudo /usr/local/libexec/axora-production/backup.sh
```

Confirm the script reports successful archive/checksum validation. Copy the
completed backup directory to the approved encrypted off-machine destination
and verify the copied checksums there. A backup that exists only under
`/var/lib/axora-production` is not a disaster-recovery backup.

### Start and monitor a deployment

```bash
sudo systemctl start axora-deploy.service
sudo journalctl -u axora-deploy.service -f
```

The service must fetch the exact remote `main` SHA, acquire the deployment
lock, run all quality gates, build without production secrets, back up before
migration, apply pending migrations, verify readiness, and retain the prior
release. A failed gate must leave the current release serving traffic.

After the first approved manual deployment, enable outbound polling:

```bash
sudo systemctl enable --now \
  axora-deploy.timer axora-health.timer axora-backup.timer
```

Automatic application deployment does not self-update the root-owned
controller or systemd units. After a separately reviewed change to
`scripts/production` or `deploy/systemd`, rerun
`sudo bash scripts/production/install.sh` from that exact approved checkout,
review the installed diff, run preflight, and then re-enable the timers.

## Cloudflare apex cutover

Use the official Cloudflare integration only after OAuth and read-only inventory
have succeeded.

1. Record the current apex DNS records and both old/new Tunnel configurations.
2. Configure the dedicated `axora-production` Tunnel to reach only
   `http://caddy:8080` on the isolated Docker `edge` network. The loopback
   Caddy binding is for local diagnostics, not the container's Tunnel route.
3. Add a final catch-all `http_status:404` ingress rule.
4. Route exactly `axora.management` to that Tunnel.
5. Keep the Render service and `bekal-production` Tunnel unchanged.
6. Verify:

```bash
curl --fail --silent --show-error \
  https://axora.management/api/health/live
curl --fail --silent --show-error \
  https://axora.management/api/health/ready
curl --head --fail --silent --show-error https://axora.management
```

7. On phone and desktop, test login/logout, catalog search, product images,
   attachments, request creation, approval/rejection, budgets, users, branches,
   audit history, and a harmless database write followed by its audit event.
8. Confirm Tunnel and local access logs show the test requests and Render does
   not.

If any critical check fails, restore the recorded apex/Tunnel configuration and
continue using Render while the local issue is diagnosed.

## Application rollback

Show retained releases:

```bash
sudo ls -la /var/lib/axora-production/releases
```

Roll back to the recorded previous release:

```bash
sudo /usr/local/libexec/axora-production/rollback.sh previous
sudo /usr/local/libexec/axora-production/health-check.sh --external
```

Or use an exact reviewed 40-character commit:

```bash
sudo /usr/local/libexec/axora-production/rollback.sh <40-character-commit>
```

This rolls back application code, not database data. It is safe only when the
previous application remains compatible with the current schema. Never run an
automatic down-migration. For suspected data corruption or an incompatible
schema, freeze writes and follow
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## Reboot test

During an approved window:

1. Create and copy a verified backup off-machine.
2. Record current release SHA and health output.
3. Reboot the PC.
4. Confirm Docker, PostgreSQL, Axora, Caddy, the production `cloudflared`
   container, the retained legacy `cloudflared` systemd service, and both
   deployment, health, and backup timers are active.
5. Confirm local and public readiness and repeat a read/write workflow.
6. Record the evidence; do not disable Render yet.

## Troubleshooting

| Symptom | Safe checks | Likely boundary |
| --- | --- | --- |
| Public 502/503, local ready works | Production `cloudflared` container logs, Tunnel ingress, `caddy:8080` | Tunnel-to-Caddy routing |
| Public DNS error | Cloudflare apex record and Tunnel status | DNS/Tunnel |
| Local live works, ready fails | App/db logs, `pg_isready`, selected database name | PostgreSQL or credentials |
| Images/attachments missing | Confirm `axora_hybrid`, byte records, and persistent uploads mount | Wrong database or persistence |
| Deployment timer runs but no release | Deployment journal, exact remote SHA, lock/state file | Git/governance/quality gate |
| Deployment fails before migration | Fix candidate; current release remains active | Source/build/test |
| Deployment fails after migration | Keep current compatible app, inspect migration/ready logs, do not restore blindly | Schema/app compatibility |
| Disk pressure | `df -h`, Docker/backup/release inventory | LVM capacity or retention |
| Login loops on phone | Public HTTPS, cookie attributes, `APP_BASE_URL`, proxy headers, server time | Edge/proxy/session config |

Do not prune Docker, delete releases/backups, alter DNS, restart PostgreSQL, or
restore data merely to clear an alert. Identify the failing boundary first.

## Render decommissioning

Only after all migration gates, reboot recovery, automatic deployment, failure
containment, backup restore, rollback, and request-path evidence are complete:

1. Present the evidence and remaining rollback window to Ashraf.
2. Stop and ask for explicit confirmation.
3. If approved, disable Render in a separate change.
4. Do not delete Render until its retained logs/configuration and rollback value
   have been reviewed.
