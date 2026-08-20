# Render-to-Ubuntu migration plan

Status: preparation in progress. Render and public traffic have not been
changed.

## Audited starting point

- The active production database is `axora_hybrid` in the local
  `axora_postgres_data` Docker volume.
- Render currently reaches that database through the retained
  `tailscale-db` service.
- The locally running application currently selects the older `axora`
  database, so it is not a valid production candidate without the production
  Compose override.
- Current application files are stored mainly in PostgreSQL. The
  `/srv/axora/data/uploads` fallback directory is still part of the persistence
  boundary and must be copied and verified into the canonical
  `/var/lib/axora-production/uploads` mount without deleting its source.
- The apex zone `axora.management` is active in Cloudflare, but no current web
  record routes the apex to Axora.
- An existing remotely managed Tunnel named `bekal-production` is healthy but
  has no application ingress. The migration uses a separate,
  purpose-specific Tunnel named `axora-production`.
- The host `cloudflared` service is already enabled for the existing
  `bekal-production` Tunnel. Its token and configuration must not be displayed
  or overwritten. The dedicated `axora-production` Tunnel runs in a separate
  production Compose container.
- The recorded Render `SESSION_SECRET` is still accepted by the current Render
  application and differs from the old local session secret. The stable local
  production secret must receive the recorded Render value without printing
  it to preserve cryptographic continuity. Preserve the old local value
  separately through the rollback window. Render cookies are host-scoped and
  cannot transfer to `axora.management`, so users should expect one sign-in on
  the apex after cutover.
- Current backups are on the same NVMe. That is useful for fast rollback but
  does not protect against server or disk loss.
- The 1 TB NVMe exposes only about 100 GB to the root logical volume. Capacity
  expansion and alerting are required before storage growth is relied upon.
- `/srv/axora` was audited as mode `0777`, and local environment files were
  group/world-readable. The privileged installation must correct these
  permissions without printing or replacing secrets.
- SSH and CUPS currently listen on host interfaces. The privileged firewall
  review must restrict SSH to approved management sources and disable or
  LAN-restrict CUPS according to the server's printing requirement.

## Critical governance boundary

`ASHRAF-2004/axora` intentionally remains public. Public source visibility does
not authorize public access to production credentials, deployment transport, or
production images. Do not install a GitHub Actions self-hosted runner. Before
SSH-triggered automation is enabled:

1. Protect `main`; require pull requests and `Build immutable production image`.
2. Block force pushes and branch deletion.
3. Scope SSH and Tailscale deployment credentials to the GitHub `production`
   Environment and never commit or log them.
4. Keep `ghcr.io/ashraf-2004/axora` private with granular permissions, disable
   repository permission inheritance, grant Actions explicit write access, and
   grant production only read access.
5. Restrict the Tailscale federated identity to this exact repository,
   `production` Environment, workflow, `main` ref, and GitHub-hosted runners.
6. Confirm that only intended administrators can change Actions workflows,
   branch rules, collaborators, Environments, or package permissions.

The selected deployment model is a host-key-pinned SSH trigger from the
successful GitHub Actions `main` workflow, not a self-hosted runner or public
webhook. A dedicated restricted identity invokes the root-owned controller for
the exact CI-approved SHA; the controller independently fetches and verifies
that SHA before touching production.

## Migration stages and gates

### 1. Prepare without changing traffic

- Keep Render running.
- Create and review the feature branch and pull request.
- Run GitHub-hosted CI and local verification.
- Correct local permissions and install production units using the reviewed
  privileged installer.
- Confirm the production Compose stack selects `axora_hybrid` and preserves
  `axora_postgres_data`, persistent uploads, external secrets, and
  `tailscale-db`.
- Create a pre-migration database/file backup, verify its checksums/archive,
  and copy it to encrypted off-machine storage.

Gate: a restore test succeeds into an isolated database; production has not
been modified.

### 2. Validate the local production candidate

- Build from the exact approved commit.
- Keep automatic polling disabled. Because the apex does not yet route to this
  PC, set the deployment controller's external-health requirement to `false`
  only for this supervised local bootstrap.
- Apply only reviewed, backwards-compatible pending migrations.
- Verify `/api/health/live` and `/api/health/ready` through the loopback origin.
- Check login, catalog, product images, attachments, requests, approvals,
  budgets, companies, branches, users, audit history, and database writes.
- Restart application-facing containers and repeat the checks.

Gate: readiness confirms database access to `axora_hybrid`, and data counts and
recent audit history remain consistent.

### 3. Prepare Cloudflare reversibly

- Complete official Cloudflare MCP OAuth and verify read-only access to the
  `axora.management` zone before any write.
- Record the current apex DNS and Tunnel configuration in a root-owned
  operational record with no tokens.
- Create the dedicated `axora-production` Tunnel.
- Configure only `axora.management` to `http://caddy:8080` on the isolated
  production `edge` network, followed by a catch-all rejection rule.
- Validate the Tunnel and origin before adding or changing the apex route.

Gate: the rollback record identifies the exact DNS and Tunnel state to restore.

### 4. Cut over the apex

- Create the apex Tunnel route for `axora.management`.
- Verify valid edge HTTPS, redirects, security headers, public readiness, and
  critical browser workflows on phone and desktop.
- Confirm Cloudflare Tunnel and local access logs show the requests.
- Confirm Render logs no longer receive apex production traffic.
- Restore the deployment controller's external-health requirement to `true`,
  run the external health gate, and keep it required thereafter.

Gate: multiple independent checks prove the apex reaches this Ubuntu PC.
Render remains running.

### 5. Prove operations

- Reboot the application containers and then the PC during an approved window.
- Confirm Docker, PostgreSQL, Axora, `cloudflared`, health monitoring, and the
  deployment poller recover automatically.
- Merge a harmless reviewed change to protected `main`; confirm one serialized
  deployment of that exact SHA. The fresh-SHA export, build, and swap must be
  initiated by the installed `axora-deploy.service` under its production
  sandbox on this Ubuntu release; an interactive script run is not sufficient.
- Trigger or simulate a failing candidate; confirm it does not replace the
  working release.
- Roll back to the previous application release and then redeploy the approved
  release.

Gate: deployment, failure containment, backup, health monitoring, restart, and
rollback evidence is attached to the pull request or change record.

### 6. Render decision

Stop and ask an authorized Axora platform owner for explicit confirmation. Do not disable or delete the
Render service automatically.

## Main risks and controls

| Risk | Consequence | Required control |
| --- | --- | --- |
| Public repository workflow tampering | Unreviewed code or credential access can reach production | Protected `main`, exact required image check, environment-scoped secrets, exact OIDC claims, private granular GHCR package |
| Wrong database selected | Old or incomplete data appears | Production override must name `axora_hybrid`; readiness and workflow checks |
| Migration incompatible with old app | Rollback application cannot read schema | Backwards-compatible migrations, verified backup, explicit compatibility review |
| Same-disk backups only | PC/NVMe loss destroys app and backup | Encrypted off-machine copy plus restore drill |
| Tunnel/DNS mistake | Apex outage or unintended service exposure | Snapshot current state, dedicated Tunnel, private origin, catch-all reject, reversible DNS change |
| Secret disclosure | Account or database compromise | Root-owned files, no command-line tokens, redacted logs, no tracked secrets |
| Wrong session secret | Cryptographic continuity is lost | Copy the recorded active Render secret into stable production storage without printing it; preserve the prior local secret; expect one apex sign-in because cookies are host-scoped |
| Sensitive Docker build context | Secrets can enter builder cache/layers | Strict `.dockerignore`; immutable clean release context; no secret build arguments |
| Unreviewed base-image change | Rebuilding or upgrading can alter runtime behavior | Runtime/base images are digest-pinned; review digest updates and retain verified prior images |
| Overlapping deployments | Partial migration or inconsistent release | systemd/flock serialization and exact-SHA state |
| Disk exhaustion | Database or deployment failure | Expand LVM, monitor capacity, retain releases/backups by reviewed policy |
| Power or network loss | Public outage | Restart policies, health monitor, tested reboot, UPS recommended |
| Render disabled too soon | Loss of fallback | Keep Render until explicit approval after all gates |

## Rollback strategy

- Before apex cutover: leave DNS unchanged and stop the candidate services.
- After apex cutover but before incompatible schema change: restore the recorded
  apex/Tunnel configuration and run the previous application release.
- After a backwards-compatible migration: use the application rollback command;
  do not roll the database schema backward automatically.
- After an incompatible migration or suspected data damage: freeze writes,
  preserve forensic copies, restore the verified pre-migration backup into an
  isolated database, validate it, and obtain explicit approval before switching
  production.
- Never run `docker compose down -v`, remove production volumes, use
  `--remove-orphans`, remove `tailscale-db`, or delete Render during rollback.

## Cloudflare Codex integration status

At the infrastructure audit:

- The official Cloudflare plugin bundle and relevant Cloudflare skills were
  available in the current Codex environment.
- The official Cloudflare API MCP endpoint
  `https://mcp.cloudflare.com/mcp` was registered directly.
- Interactive OAuth completed successfully. `codex mcp list` reported the
  official `cloudflare-api` connection enabled with OAuth.
- The local Codex CLI could not manually add the reserved
  `openai-curated` marketplace source. This is a client/control-plane
  limitation, not justification for an unofficial plugin or invented MCP
  endpoint.
- Existing Cloudflare access was used only for read-only inventory; no DNS or
  Tunnel write had been made.

Re-check this status immediately before Cloudflare changes. Use OAuth for the
interactive setup or a least-privilege API token only if unattended Cloudflare
automation is later approved. Application deployment does not require a
Cloudflare API credential.
