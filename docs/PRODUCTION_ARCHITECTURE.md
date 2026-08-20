# Axora production architecture

Status: proposed and repository-prepared; public cutover has not been completed.

## Request path after cutover

```text
Company browser
    |
    | HTTPS to axora.management
    v
Cloudflare edge
    |
    | Cloudflare Tunnel (outbound connection from Ubuntu)
    v
cloudflared production container: axora-production tunnel
    |
    | HTTP over the isolated Docker edge network
    v
Caddy production reverse proxy
    |
    | private Docker frontend network
    v
Axora Next.js production container
    |
    | private Docker backend network
    v
PostgreSQL: axora_hybrid
    |
    +-- Docker volume: axora_postgres_data
```

No router port forwarding is required. PostgreSQL, Docker, Next.js, SSH,
metrics, and operational dashboards are not published through the Tunnel.
Cloudflare is the public TLS endpoint. The dedicated `cloudflared` container
reaches Caddy at `http://caddy:8080` on the isolated Docker `edge` network.
Caddy also publishes the same origin on loopback only for local health checks
and diagnostics.

The apex hostname is exactly `axora.management`. Do not add
`app.axora.management`.

## Components and ownership

| Component | Runtime | Persistent state | Exposure |
| --- | --- | --- | --- |
| Cloudflare DNS and edge | Cloudflare | DNS, Tunnel hostname configuration | Public HTTPS only |
| Production `cloudflared` | Docker Compose | Root-owned token file outside Git | Outbound connections; isolated `edge` access to Caddy |
| Legacy `cloudflared` | Ubuntu systemd | Existing token/config outside Git | Existing `bekal-production` Tunnel, retained during migration |
| Caddy | Docker Compose | Configuration and optional Caddy volumes | Private frontend plus loopback diagnostics |
| Axora application | Docker Compose | Immutable image and release metadata | Private Docker network |
| PostgreSQL | Docker Compose | `axora_postgres_data` | Private Docker network |
| Legacy attachment fallback | Ubuntu bind mount | `/var/lib/axora-production/uploads` | Application only |
| Production backups | Ubuntu plus off-machine copy | `/var/lib/axora-production/backups` | Operators only |
| Deployment controller | Root-owned Ubuntu scripts triggered over restricted SSH | `/var/lib/axora-production` and `/var/log/axora-production` | Pinned-key SSH trigger plus outbound Git fetch |

Product images and current attachments are primarily stored as PostgreSQL
bytes. Existing files under `/srv/axora/data/uploads` must be copied and
verified into the canonical `/var/lib/axora-production/uploads` mount before
the mount changes. The legacy fallback must still be preserved because older
attachment records can reference it. Production secrets are resolved from
`/etc/axora-production/secrets`; neither path lives inside an immutable release
checkout.

## Deployment flow

```text
commit reaches protected main
    |
    v
GitHub-hosted CI (read-only token)
    |
    | one immutable Docker build, tagged by SHA and pushed to private GHCR
    v
GitHub Actions joins Tailscale with an ephemeral OIDC identity
    |
    | runner tag can reach only production-host tag on TCP/22
    v
GitHub Actions opens a host-key-pinned SSH session over Tailscale
    |
    | exact tested SHA; restricted non-interactive deploy command
    v
exact SHA fetch and verification; one deployment lock; exact digest pull
    |
    v
compare immutable migration ledger
    |
    | pending migrations only: verified backup, then migration
    |
    v
candidate application health/readiness checks
    |
    v
replace only the application-facing services
    |
    v
local and external health checks
```

There is no inbound deployment webhook, public SSH exposure, or GitHub Actions
self-hosted runner. The production job uses GitHub OIDC to create an ephemeral
Tailscale node tagged `tag:axora-github-deploy`; tailnet policy grants that tag
only TCP/22 access to `tag:axora-production-host`. It then uses a dedicated SSH
identity, pinned host key, and non-interactive deployment command to trigger
only the exact tested SHA. The former polling timer is removed during cutover
so it cannot race CI. The source repository remains public, but that does not
make deployment credentials or production images public. Automatic SSH
deployment must stay disabled until the `production` GitHub Environment and
Tailscale federated identity are configured, `main` is protected, required CI
checks are enforced, and force pushes/deletions are blocked.

The installed root-owned deployment controller does not update itself from
Git. Changes under `scripts/production` or `deploy/systemd` require separate
CODEOWNER review and a supervised rerun of the privileged installer. Ordinary
application releases never replace privileged orchestration code.

## Render and Tailscale during migration

Render remains available as the pre-cutover application and emergency reference
until an authorized Axora platform owner explicitly approves decommissioning. After the apex cutover,
Render is not in the request path:

```text
axora.management -> Cloudflare Tunnel -> Ubuntu
```

The existing `tailscale-db` service is retained unchanged. It can support the
controlled rollback window, but it is not part of the final public request
path. Never remove it as part of a normal application deployment.

## Security boundaries

- Secrets are root-owned files outside Git; templates contain placeholders
  only.
- The repository `.dockerignore` excludes environment files, secrets, backups,
  uploads, logs, credentials, Git metadata, caches, and host-only assets from
  image build contexts.
- Node, PostgreSQL, Caddy, Tailscale, and `cloudflared` images are pinned by
  digest; updates require an intentional reviewed digest change.
- The GitHub CI workflow has `contents: read`, grants `packages: write` only to
  the image job, grants `id-token: write` only to the production deploy job,
  and uses commit-pinned official actions.
- The GHCR package is private and uses granular permissions without inheriting
  access from the public repository. GitHub Actions has explicit write access;
  production has a separate `read:packages` credential and pulls only by OCI
  digest.
- The Tailscale workload identity requires the exact public repository,
  `production` Environment, workflow on `refs/heads/main`, GitHub-hosted runner,
  and `repository_visibility=public` claims. Its tag can reach only the tagged
  production host on TCP/22.
- The deployment controller accepts only the exact remote `main` commit and
  serializes deployments. It authenticates with a repository-scoped,
  read-only SSH deploy key and a pinned GitHub host key.
- Cloudflare credentials are not needed by each application deployment.
- The Tunnel publishes only the application origin and has a final
  catch-all rejection rule.
- Database and file backups precede migrations, and off-machine encrypted
  copies protect against loss of the PC or NVMe.
- The working tree, environment files, deployment config, and credential files
  must not be group/world writable.

## Official references

- [Cloudflare Tunnel overview](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
- [Cloudflare's official MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
- [GitHub self-hosted runner security](https://docs.github.com/en/actions/concepts/runners/about-self-hosted-runners#self-hosted-runner-security)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/)
