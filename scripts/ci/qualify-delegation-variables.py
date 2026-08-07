from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


path = Path("database/migrations/041_delegated_access_management.sql")
source = path.read_text()
start = source.index(
    "CREATE OR REPLACE FUNCTION public.axora_create_delegated_access("
)
end = source.index(
    "CREATE OR REPLACE FUNCTION public.axora_revoke_delegated_access(",
    start,
)
command = source[start:end]
command = replace_once(
    command,
    "AS $$\nDECLARE\n",
    "AS $$\n<<delegation_command>>\nDECLARE\n",
    "delegation command block label",
)

replacements = [
    (
        "WHERE company.id=company_id AND company.active",
        "WHERE company.id=delegation_command.company_id AND company.active",
        "company lookup variable",
    ),
    (
        "WHERE branch.id=branch_id AND branch.company_id=company_id",
        "WHERE branch.id=delegation_command.branch_id "
        "AND branch.company_id=delegation_command.company_id",
        "branch lookup variables",
    ),
    (
        "WHERE department.id=department_id\n"
        "        AND department.company_id=company_id",
        "WHERE department.id=delegation_command.department_id\n"
        "        AND department.company_id=delegation_command.company_id",
        "department lookup variables",
    ),
    (
        "WHERE branch.id=canonical_branch_id\n"
        "          AND branch.company_id=company_id AND branch.active",
        "WHERE branch.id=delegation_command.canonical_branch_id\n"
        "          AND branch.company_id=delegation_command.company_id "
        "AND branch.active",
        "department parent branch variables",
    ),
    (
        "AND membership.company_id=company_id",
        "AND membership.company_id=delegation_command.company_id",
        "membership company variable",
    ),
    (
        "AND permission.permission_code=permission_code",
        "AND permission.permission_code=delegation_command.permission_code",
        "permission loop variable",
    ),
]
for old, new, label in replacements:
    command = replace_once(command, old, new, label)

long_scope_args = (
    "scope_type,company_id,branch_id,department_id,NULL,now()"
)
qualified_long_scope_args = (
    "delegation_command.scope_type,delegation_command.company_id,"
    "delegation_command.branch_id,delegation_command.department_id,NULL,now()"
)
if long_scope_args not in command:
    raise SystemExit("delegation command live scope arguments were not found")
command = command.replace(long_scope_args, qualified_long_scope_args)

short_scope_args = "scope_type,company_id,branch_id,department_id,NULL"
qualified_short_scope_args = (
    "delegation_command.scope_type,delegation_command.company_id,"
    "delegation_command.branch_id,delegation_command.department_id,NULL"
)
if short_scope_args not in command:
    raise SystemExit("delegation command scoped-denial arguments were not found")
command = command.replace(short_scope_args, qualified_short_scope_args)

permission_argument = (
    "p_actor_user_id,p_actor_role_assignment_id,permission_code,"
)
if permission_argument not in command:
    raise SystemExit("delegation permission argument was not found")
command = command.replace(
    permission_argument,
    "p_actor_user_id,p_actor_role_assignment_id,"
    "delegation_command.permission_code,",
)

path.write_text(source[:start] + command + source[end:])

test_path = Path("tests/delegated-access-management-migration.test.ts")
test_source = test_path.read_text()
old_snapshot_type = """      const snapshot = await db.query<{ snapshot: {
        delegations: Array<{
          permissions: string[];
          scopes: Array<Record<string, string>>;
        }>;
      } }>(`"""
new_snapshot_type = """      const snapshot = await db.query<{ snapshot: {
        delegations: Array<{
          active: boolean;
          startsAt: string;
          endsAt: string;
          permissions: string[];
          scopes: Array<Record<string, string>>;
        }>;
      } }>(`"""
test_source = replace_once(
    test_source,
    old_snapshot_type,
    new_snapshot_type,
    "delegated snapshot timestamp fields",
)
old_assertion = """      expect(snapshot.rows[0].snapshot.delegations).toEqual([{
        active: true,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        permissions: [\"document.download\", \"request.view\"],
        scopes: [{
          type: \"BRANCH\",
          companyId: ids.company,
          branchId: ids.branch,
        }],
      }]);"""
new_assertion = """      expect(snapshot.rows[0].snapshot.delegations).toHaveLength(1);
      const effectiveDelegation = snapshot.rows[0].snapshot.delegations[0];
      expect(effectiveDelegation).toMatchObject({
        active: true,
        permissions: [\"document.download\", \"request.view\"],
        scopes: [{
          type: \"BRANCH\",
          companyId: ids.company,
          branchId: ids.branch,
        }],
      });
      expect(new Date(effectiveDelegation.startsAt).getTime())
        .toBe(startsAt.getTime());
      expect(new Date(effectiveDelegation.endsAt).getTime())
        .toBe(endsAt.getTime());"""
test_path.write_text(replace_once(
    test_source,
    old_assertion,
    new_assertion,
    "delegated timestamp assertion",
))
