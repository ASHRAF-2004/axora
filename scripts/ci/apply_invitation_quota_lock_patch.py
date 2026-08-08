from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if new in source:
        return
    if source.count(old) != 1:
        raise RuntimeError(
            f"Expected one patch anchor in {path}, found {source.count(old)}"
        )
    file.write_text(source.replace(old, new, 1))


account_path = Path("src/lib/account-setup.ts")
account_source = account_path.read_text()
old_quota = '''async function enforceInvitationQuota(
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
new_quota = '''async function enforceInvitationQuota(
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
if new_quota not in account_source:
    if account_source.count(old_quota) != 1:
        raise RuntimeError(
            "Expected one invitation quota function before patching"
        )
    account_path.write_text(account_source.replace(old_quota, new_quota, 1))


test_path = Path("tests/account-setup-lifecycle.test.ts")
test_source = test_path.read_text()
mock_anchor = '''    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('AS "actorId"')) {
'''
mock_replacement = '''    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
'''
if mock_replacement not in test_source:
    if test_source.count(mock_anchor) != 2:
        raise RuntimeError(
            f"Expected two invitation SQL mocks, found {test_source.count(mock_anchor)}"
        )
    test_source = test_source.replace(mock_anchor, mock_replacement)

old_expectation = '''    expect(statements[0]).toContain("FOR UPDATE OF u,c");
'''
new_expectation = '''    expect(statements[0]).toContain("axora-account-invite-actor:");
    expect(statements[1]).toContain("axora-account-invite-company:");
    expect(statements.find((sql) => sql.includes('AS "actorId"')))
      .toContain("FOR KEY SHARE OF u,c");
'''
if new_expectation not in test_source:
    if test_source.count(old_expectation) != 1:
        raise RuntimeError(
            f"Expected one quota lock assertion, found {test_source.count(old_expectation)}"
        )
    test_source = test_source.replace(old_expectation, new_expectation, 1)

test_path.write_text(test_source)
