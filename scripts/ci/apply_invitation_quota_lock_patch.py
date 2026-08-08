from pathlib import Path

path = Path("src/lib/account-setup.ts")
source = path.read_text()
old = '''async function enforceInvitationQuota(
  client: PoolClient,
  actorId: string,
  companyId?: string,
) {
  // Both quota dimensions are serialized before counting. The actor lock
  // prevents parallel requests from one administrator; the company lock keeps
  // different administrators from racing past the shared daily ceiling.
  const scope = companyId
    ? await client.query(
      `SELECT u.id::text AS "actorId",c.id::text AS "companyId"
       FROM users u CROSS JOIN companies c
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
         AND c.id=$2 AND c.active=true
       FOR UPDATE OF u,c`,
      [actorId, companyId],
    )
    : await client.query(
      `SELECT u.id::text AS "actorId"
       FROM users u
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
       FOR UPDATE OF u`,
      [actorId],
    );
  if (!scope.rowCount) {
    throw new Error("The account invitation scope is no longer active.");
  }

  const usage = await client.query<{ actorCount: number; companyCount: number }>(
    `SELECT
       count(*) FILTER (
         WHERE created_by=$1 AND created_at > now()-interval '1 hour'
       )::integer AS "actorCount",
       count(*) FILTER (
         WHERE $2::uuid IS NOT NULL AND company_id=$2
           AND created_at > now()-interval '1 day'
       )::integer AS "companyCount"
     FROM account_setup_invitations
     WHERE (created_by=$1 AND created_at > now()-interval '1 hour')
        OR ($2::uuid IS NOT NULL AND company_id=$2
          AND created_at > now()-interval '1 day')`,
    [actorId, companyId ?? null],
  );
'''
new = '''async function enforceInvitationQuota(
  client: PoolClient,
  actorId: string,
  companyId?: string,
) {
  // Serialize each quota dimension with transaction-scoped advisory locks.
  // Using advisory locks avoids upgrading a KEY SHARE resource lock to UPDATE,
  // which can deadlock when concurrent administrators invite into one company.
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('axora-account-invite-actor:' || $1::text,0)
     )`,
    [actorId],
  );
  if (companyId) {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('axora-account-invite-company:' || $1::text,0)
       )`,
      [companyId],
    );
  }

  const scope = companyId
    ? await client.query(
      `SELECT u.id::text AS "actorId",c.id::text AS "companyId"
       FROM users u CROSS JOIN companies c
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
         AND c.id=$2 AND c.active=true
       FOR KEY SHARE OF u,c`,
      [actorId, companyId],
    )
    : await client.query(
      `SELECT u.id::text AS "actorId"
       FROM users u
       WHERE u.id=$1 AND u.active=true AND u.account_status='ACTIVE'
       FOR KEY SHARE OF u`,
      [actorId],
    );
  if (!scope.rowCount) {
    throw new Error("The account invitation scope is no longer active.");
  }

  const usage = await client.query<{ actorCount: number; companyCount: number }>(
    `SELECT
       count(*) FILTER (
         WHERE created_by=$1 AND created_at > now()-interval '1 hour'
       )::integer AS "actorCount",
       count(*) FILTER (
         WHERE $2::uuid IS NOT NULL AND company_id=$2
           AND created_at > now()-interval '1 day'
       )::integer AS "companyCount"
     FROM account_setup_invitations
     WHERE (created_by=$1 AND created_at > now()-interval '1 hour')
        OR ($2::uuid IS NOT NULL AND company_id=$2
          AND created_at > now()-interval '1 day')`,
    [actorId, companyId ?? null],
  );
'''

if new in source:
    raise SystemExit(0)
if source.count(old) != 1:
    raise RuntimeError(
        f"Expected one invitation quota function, found {source.count(old)}"
    )
path.write_text(source.replace(old, new, 1))
