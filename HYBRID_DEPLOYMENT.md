# Axora hybrid deployment

Axora's hybrid layout keeps the public website at
<https://axora-operations.onrender.com> and stores operational records and
uploaded file bytes in PostgreSQL on the Ubuntu server.

```text
Company users
    |
    v
Render HTTPS website
    |
    v
Private authenticated Tailscale connection
    |
    v
Ubuntu PostgreSQL volume
```

PostgreSQL and Next.js are never published from the office router. The database
continues to require its own strong SCRAM password even inside Tailscale.

## Current storage target

- Database: `axora_hybrid`
- PostgreSQL volume: `axora_postgres_data`
- Current free space on `/`: approximately 75 GB
- Attachments: stored in `attachments.file_content` inside PostgreSQL
- Hosted rollback database: keep the Render database unchanged until the
  rollback window ends

The server has a 1 TB NVMe, but only about 100 GB is currently allocated to the
root filesystem. Extend the Ubuntu LVM volume before relying on the remaining
space.

## One-time tunnel enrollment

For testing, create a Tailscale account. The simplest setup is:

1. Open Tailscale's **Keys** page.
2. Under **API access tokens**, generate a temporary token with a one-day
   expiry.
3. Run the command below and paste the token when prompted:

```bash
bash scripts/server/configure-hybrid-tailscale.sh
```

The token is entered invisibly and is not stored or added to shell history. The
script backs up the previous tailnet policy, validates and applies Axora's
restricted policy, creates two separately tagged auth keys, stores them with
owner-only permissions, starts the Ubuntu endpoint, and revokes the temporary
API token. If automatic revocation reports a warning, revoke the token manually
on the Keys page.

The resulting policy is:

```json
{
  "acls": [],
  "tagOwners": {
    "tag:axora-db": ["autogroup:admin"],
    "tag:axora-render": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:axora-render"],
      "dst": ["tag:axora-db"],
      "ip": ["tcp:5432"]
    }
  ],
  "tests": [
    {
      "src": "tag:axora-render",
      "proto": "tcp",
      "accept": ["tag:axora-db:5432"],
      "deny": ["tag:axora-db:22"]
    },
    {
      "src": "tag:axora-db",
      "proto": "tcp",
      "deny": ["tag:axora-render:5432"]
    }
  ]
}
```

The automated setup generates:

1. A one-time, non-ephemeral key pre-authorized for `tag:axora-db`.
2. A reusable, ephemeral key pre-authorized for `tag:axora-render`.

Do not paste either generated auth key into a shell command or commit it to
Git. The Render key expires in at most 90 days, so rotate it before expiry
during testing.

If API automation is unavailable, create the two auth keys manually and store
them without showing them on screen:

```bash
bash scripts/server/prepare-hybrid-tunnel.sh
```

Start the Ubuntu endpoint:

```bash
sg docker -c 'bash scripts/server/hybrid-up.sh'
```

The second key is stored as Render's secret `TAILSCALE_AUTH_KEY`. Render joins
as tagged ephemeral node `axora-render`, connects only to
`tag:axora-db` on TCP port 5432, and presents a local bridge at
`127.0.0.1:15432` to the application. The Ubuntu key is never sent to Render.

Tailscale Personal is free only for non-commercial use. It is suitable for this
test cutover, not for companies using Axora in production. Before production,
use a paid commercial Tailscale plan or move the private link to a commercially
permitted alternative. Render's Free service is also explicitly intended for
testing, can restart, and can sleep.

## Render hybrid settings

The hybrid service uses these protected settings:

```text
DATABASE_URL=postgresql://axora_app:<local app password>@127.0.0.1:15432/axora_hybrid
DATABASE_SSL=false
SKIP_DATABASE_MIGRATIONS=true
TAILSCALE_AUTH_KEY=<secret>
TAILSCALE_DB_HOST=axora-db
TAILSCALE_DB_PORT=5432
```

Do not grant the Render application role permission to create or alter tables.
Before a future schema release, stop public writes or use a backwards-compatible
migration. Run the migration only against the hybrid database:

```bash
sg docker -c 'bash scripts/server/hybrid-migrate.sh'
```

## Routine checks and backups

```bash
sg docker -c 'bash scripts/server/hybrid-status.sh'
sg docker -c 'bash scripts/server/hybrid-backup.sh'
bash scripts/server/install-hybrid-backup-timer.sh
```

Copy each completed backup folder to a different encrypted drive or service.
A backup on the same NVMe does not protect against disk loss.

## Rollback boundary

Before any new records are created in `axora_hybrid`, rollback means restoring
Render's former `DATABASE_URL`. After new records are created, do not switch
back directly: freeze writes and migrate the Ubuntu database back first, or
those records will be lost.

Never run `docker compose down -v`; it deletes the PostgreSQL volume.
