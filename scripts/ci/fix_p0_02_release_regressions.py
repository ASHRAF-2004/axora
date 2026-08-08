from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if new in source:
        return
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one anchor in {path}, found {count}")
    file.write_text(source.replace(old, new, 1))


# Every resend SQL mock must accept the transaction-scoped advisory locks.
lifecycle_path = Path("tests/account-setup-lifecycle.test.ts")
lifecycle = lifecycle_path.read_text()
mock_anchor = '''    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT") && sql.includes("setupCompleted")) {
'''
mock_replacement = '''    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("SELECT") && sql.includes("setupCompleted")) {
'''
remaining = lifecycle.count(mock_anchor)
if remaining:
    lifecycle = lifecycle.replace(mock_anchor, mock_replacement)
    lifecycle_path.write_text(lifecycle)
if lifecycle_path.read_text().count("Unexpected SQL: ${sql}") < 4:
    raise RuntimeError("Invitation lifecycle fixture shape changed unexpectedly")

# Authorization now belongs to the resend transaction, not a preflight action.
actions_path = Path("tests/account-setup-actions.test.ts")
actions = actions_path.read_text()
actions = actions.replace("  lockAuthorizedUserTarget: vi.fn(),\n", "")
actions = actions.replace(
    '''vi.mock("@/lib/user-isolation", () => ({
  lockAuthorizedUserTarget: mocks.lockAuthorizedUserTarget,
  setAuthorizedUserActive: mocks.setAuthorizedUserActive,
}));''',
    '''vi.mock("@/lib/user-isolation", () => ({
  setAuthorizedUserActive: mocks.setAuthorizedUserActive,
}));''',
)
actions = actions.replace(
    '''    mocks.lockAuthorizedUserTarget.mockResolvedValue({
      userId: invitation.userId,
      permission: "user.invite",
    });
''',
    "",
)
actions = actions.replace(
    '  it("resends only after the exact scoped target is authorized", async () => {',
    '  it("delegates exact target authorization to the resend transaction", async () => {',
)
actions = actions.replace(
    '''    expect(mocks.lockAuthorizedUserTarget).toHaveBeenCalledWith(
      actor,
      invitation.userId,
      "user.invite",
    );
''',
    "",
)
if "lockAuthorizedUserTarget" in actions:
    raise RuntimeError("Stale action-level invitation lock expectation remains")
actions_path.write_text(actions)

# Revoke a non-critical branch assignment; last-admin protection is intentional.
replace_once(
    "tests/isolation-closure-migration.test.ts",
    '''      `, [ids.companyAssignmentA, ids.owner]);
      expect(await operationRows(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
        "request.approval_queue.view",
      )).toEqual([]);
      expect(await userIds(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
      )).toEqual([]);''',
    '''      `, [ids.branchAssignmentA, ids.owner]);
      expect(await operationRows(
        db,
        ids.branchAdminA,
        ids.branchAssignmentA,
        "request.approval_queue.view",
      )).toEqual([]);
      expect(await userIds(
        db,
        ids.branchAdminA,
        ids.branchAssignmentA,
      )).toEqual([]);''',
)

# Avoid PL/pgSQL ambiguity with role_assignment_management_rules.target_role_id.
migration_path = Path(
    "database/migrations/048_isolation_transaction_lock_hardening.sql"
)
migration = migration_path.read_text()
for old, new in (
    ("  target_role_id uuid;", "  resolved_target_role_id uuid;"),
    ("SELECT role.id INTO target_role_id", "SELECT role.id INTO resolved_target_role_id"),
    ("IF target_role_id IS NULL", "IF resolved_target_role_id IS NULL"),
    (
        "rule.target_role_id=target_role_id",
        "rule.target_role_id=resolved_target_role_id",
    ),
    ("'roleId',target_role_id", "'roleId',resolved_target_role_id"),
):
    if old not in migration and new not in migration:
        raise RuntimeError(f"Missing migration anchor: {old}")
    migration = migration.replace(old, new)
migration_path.write_text(migration)

# Coverage now asserts the write-transaction invitation boundary.
coverage_path = Path("tests/p0-02-isolation-coverage.test.ts")
coverage = coverage_path.read_text()
coverage = coverage.replace(
    '''    const [users, userActions, userRuntime, newRequest, settingsAction] =
      await Promise.all([
        source("src/app/(portal)/users/page.tsx"),
        source("src/app/(portal)/users/actions.ts"),
        source("src/lib/user-isolation.ts"),
        source("src/app/(portal)/requests/new/page.tsx"),
        source("src/app/(portal)/settings/actions.ts"),
      ]);''',
    '''    const [users, userActions, userRuntime, accountSetup, newRequest,
      settingsAction] = await Promise.all([
        source("src/app/(portal)/users/page.tsx"),
        source("src/app/(portal)/users/actions.ts"),
        source("src/lib/user-isolation.ts"),
        source("src/lib/account-setup.ts"),
        source("src/app/(portal)/requests/new/page.tsx"),
        source("src/app/(portal)/settings/actions.ts"),
      ]);''',
)
coverage = coverage.replace(
    '''    expect(userActions).toContain("setAuthorizedUserActive");
    expect(userActions).toContain("lockAuthorizedUserTarget");
    expect(userRuntime).toContain("axora_user_directory_rows");''',
    '''    expect(userActions).toContain("setAuthorizedUserActive");
    expect(userActions).toContain(
      "resendAccountSetupInvitation(safeUserId, actor)",
    );
    expect(accountSetup).toContain(
      "lockAuthorizedInvitationCreationScope(client, actor, resolved)",
    );
    expect(accountSetup).toContain(
      "lockAuthorizedInvitationTarget(client, actor, userId)",
    );
    expect(userRuntime).toContain("axora_user_directory_rows");''',
)
if 'expect(userActions).toContain("lockAuthorizedUserTarget")' in coverage:
    raise RuntimeError("Stale coverage assertion remains")
coverage_path.write_text(coverage)

# Keep the release lint-clean.
scoped_path = Path("src/lib/scoped-operations.ts")
scoped = scoped_path.read_text()
scoped = scoped.replace('import { randomUUID } from "node:crypto";\n', "")
scoped = scoped.replace('import { roundMoney } from "./domain";\n', "")
scoped_path.write_text(scoped)
