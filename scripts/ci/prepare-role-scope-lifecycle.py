from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


migration_path = Path("database/migrations/042_role_scope_lifecycle.sql")
migration = migration_path.read_text()
migration = replace_once(
    migration,
    "  SELECT assignment.*,role.role_key,account.account_kind\n"
    "  INTO assignment_row,role_key,account_kind",
    "  SELECT assignment,role.role_key,account.account_kind\n"
    "  INTO assignment_row,role_key,account_kind",
    "preferred assignment composite select",
)
migration = replace_once(
    migration,
    "  SELECT assignment.*,account.*,role.*\n"
    "  INTO assignment_row,target_row,role_row",
    "  SELECT assignment,account,role\n"
    "  INTO assignment_row,target_row,role_row",
    "revocation composite select",
)
migration = replace_once(
    migration,
    "  INSERT INTO public.permission_change_history(\n"
    "    actor_user_id,target_user_id,target_role_id,change_type,\n"
    "    previous_value,new_value,reason,correlation_id\n"
    "  ) VALUES (\n"
    "    p_actor_user_id,p_target_user_id,role_row.id,'ROLE_ASSIGNED',",
    "  INSERT INTO public.permission_change_history(\n"
    "    actor_user_id,target_user_id,change_type,\n"
    "    previous_value,new_value,reason,correlation_id\n"
    "  ) VALUES (\n"
    "    p_actor_user_id,p_target_user_id,'ROLE_ASSIGNED',",
    "assigned role history subject",
)
migration = replace_once(
    migration,
    "  INSERT INTO public.permission_change_history(\n"
    "    actor_user_id,target_user_id,target_role_id,change_type,\n"
    "    previous_value,new_value,reason,correlation_id\n"
    "  ) VALUES (\n"
    "    p_actor_user_id,assignment_row.user_id,assignment_row.role_id,\n"
    "    'ROLE_REVOKED',",
    "  INSERT INTO public.permission_change_history(\n"
    "    actor_user_id,target_user_id,change_type,\n"
    "    previous_value,new_value,reason,correlation_id\n"
    "  ) VALUES (\n"
    "    p_actor_user_id,assignment_row.user_id,'ROLE_REVOKED',",
    "revoked role history subject",
)
no_op_anchor = """  IF existing_assignment.id IS NULL THEN
    INSERT INTO public.role_assignments("""
no_op_replacement = """  IF existing_assignment.id IS NOT NULL
    AND target_row.role_id=role_row.id
    AND target_row.is_owner=prospective_owner
    AND target_row.company_id IS NOT DISTINCT FROM CASE
      WHEN target_row.account_kind='COMPANY' THEN p_company_id
      ELSE NULL
    END
    AND target_row.branch_id IS NOT DISTINCT FROM CASE
      WHEN target_row.account_kind='COMPANY'
        AND p_scope_type IN ('BRANCH','DEPARTMENT') THEN p_branch_id
      ELSE NULL
    END THEN
    RETURN QUERY SELECT existing_assignment.id,target_row.auth_version,0,false;
    RETURN;
  END IF;

  IF existing_assignment.id IS NULL THEN
    INSERT INTO public.role_assignments("""
migration = replace_once(
    migration,
    no_op_anchor,
    no_op_replacement,
    "existing preferred assignment no-op",
)
migration_path.write_text(migration)

full_path = Path("tests/full-migration-chain.test.ts")
full = full_path.read_text()
full = replace_once(
    full,
    'it("applies every numbered migration through 041 to an empty database"',
    'it("applies every numbered migration through 042 to an empty database"',
    "full migration title",
)
full = replace_once(
    full,
    "available.slice(-6)",
    "available.slice(-7)",
    "full migration latest slice",
)
list_anchor = '        "041_delegated_access_management.sql",\n'
full = replace_once(
    full,
    list_anchor,
    list_anchor + '        "042_role_scope_lifecycle.sql",\n',
    "full migration latest list",
)
apply_anchor = (
    "      await db.exec(await readFile(\n"
    "        migrationUrl(\"041_delegated_access_management.sql\"),\n"
    "        \"utf8\",\n"
    "      ));\n\n"
    "      const after"
)
apply_replacement = (
    "      await db.exec(await readFile(\n"
    "        migrationUrl(\"041_delegated_access_management.sql\"),\n"
    "        \"utf8\",\n"
    "      ));\n"
    "      await db.exec(await readFile(\n"
    "        migrationUrl(\"042_role_scope_lifecycle.sql\"),\n"
    "        \"utf8\",\n"
    "      ));\n\n"
    "      const after"
)
full = replace_once(
    full,
    apply_anchor,
    apply_replacement,
    "full migration populated upgrade",
)
full = replace_once(
    full,
    'it("keeps reset migration discovery dynamic through 040 while bootstrap retains its 032 minimum"',
    'it("keeps reset migration discovery dynamic through 042 while bootstrap retains its 032 minimum"',
    "migration discovery title",
)
full = full.replace(
    "|040_approval/",
    "|040_approval|041_delegated|042_role/",
)
full_path.write_text(full)

for path in [
    "tests/support-diagnostics-migration.test.ts",
    "tests/account-security-session-audit-migration.test.ts",
]:
    file = Path(path)
    text = file.read_text()
    old = '"041_delegated_access_management.sql"'
    if old not in text:
        raise SystemExit(f"{path}: latest migration expectation missing")
    file.write_text(text.replace(old, '"042_role_scope_lifecycle.sql"'))
