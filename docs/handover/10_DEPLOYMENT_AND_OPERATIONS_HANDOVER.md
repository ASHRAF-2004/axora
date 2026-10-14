# Deployment and Operations Handover

**Inspected repository commit:** `49ccf0e3413504e1f5a753b491dc1770533a6e80`.

## CI/CD path in the current repository

`.github/workflows/ci.yml` builds one immutable production image. Main-branch pushes are prepared to deploy the exact image digest through a Tailscale-protected, host-key-pinned SSH path. The workflow separates package-build permissions from production deployment permissions.

## Prepared production request path

Repository documentation defines the intended path as:

```text
Browser
  -> Cloudflare edge
  -> dedicated Cloudflare Tunnel
  -> Caddy
  -> Next.js application
  -> PostgreSQL
```

Neither PostgreSQL nor the application port should be published directly to the LAN/Internet.

## Operator checklist

### Before deploy

- Confirm branch/commit and CI results.
- Confirm approved production environment/secrets are available.
- Confirm backup destination and free space.
- Confirm migration list and whether new migrations are pending.
- Confirm there is no conflicting deployment/backup/restore operation.

### During deploy

- Deploy the exact tested commit/image digest.
- Create and verify pre-migration backup if migrations are pending.
- Apply migrations under the deployment lock.
- Check local readiness before switching application-facing services.
- Verify public health after release.

### After deploy

- Record commit and image digest.
- Verify representative authenticated workflow, not just `/health`.
- Review errors/queues/retries.
- Confirm scheduled backup/recovery jobs still run.
- Keep rollback path available until the release is accepted.

## Rollback

Normal rollback should switch the application image/release only. Forward database migrations should not be casually reversed. Data recovery requires a separately verified restore procedure and approved recovery point.

## Backup and disaster recovery

A backup on the same physical device is not sufficient. The next operator must verify:

- database backup integrity/checksum;
- upload/document evidence included where required;
- encrypted off-machine copy;
- separately controlled recovery credential/passphrase;
- isolated restore test;
- application smoke test against restored data.

## Operational ownership transfer

Before the internship handover is considered complete, the receiving developer/operator should know:

- where production configuration and secrets are stored;
- which GitHub Environment/branch rules control deployment;
- how to run verification locally;
- how to inspect migrations and current release state;
- how to back up, restore and rollback;
- which external services require separate credentials/approval;
- who can authorize destructive recovery or provider/DNS changes.

Do not place real credentials inside this handover package.
