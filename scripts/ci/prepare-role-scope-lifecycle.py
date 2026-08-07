from pathlib import Path
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


migration_path = Path("database/migrations/042_role_scope_lifecycle.sql")
migration = migration_path.read_text()

preferred_start = migration.index(
    "CREATE OR REPLACE FUNCTION public.axora_apply_preferred_role_assignment("
)
preferred_end = migration.index(
    "CREATE OR REPLACE FUNCTION public.axora_refresh_preferred_role_assignment(",
    preferred_start,
)
preferred_function = dedent("""\
CREATE OR REPLACE FUNCTION public.axora_apply_preferred_role_assignment(
  p_user_id uuid,
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  selected_role_id uuid;
  selected_scope_type text;
  selected_company_id uuid;
  selected_branch_id uuid;
  selected_role_key text;
  selected_account_kind text;
BEGIN
  SELECT
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    role.role_key,
    account.account_kind
  INTO
    selected_role_id,
    selected_scope_type,
    selected_company_id,
    selected_branch_id,
    selected_role_key,
    selected_account_kind
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.users account ON account.id=assignment.user_id
  WHERE assignment.id=p_assignment_id
    AND assignment.user_id=p_user_id
    AND assignment.active AND assignment.revoked_at IS NULL;

  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'The preferred role assignment is unavailable';
  END IF;

  UPDATE public.users account
  SET role_id=selected_role_id,
      is_owner=(
        selected_account_kind='PLATFORM'
        AND selected_role_key IN ('PLATFORM_OWNER','ADMIN')
      ),
      company_id=CASE
        WHEN selected_account_kind='COMPANY' THEN selected_company_id
        ELSE NULL
      END,
      branch_id=CASE
        WHEN selected_account_kind='COMPANY'
          AND selected_scope_type IN ('BRANCH','DEPARTMENT')
        THEN selected_branch_id
        ELSE NULL
      END
  WHERE account.id=p_user_id;
END $$;

""")
migration = migration[:preferred_start] + preferred_function + migration[preferred_end:]

revoke_start = migration.index(
    "CREATE OR REPLACE FUNCTION public.axora_revoke_user_role_scope("
)
revoke_end = migration.index(
    "REVOKE ALL ON TABLE public.role_assignment_management_rules",
    revoke_start,
)
revoke_function = dedent("""\
CREATE OR REPLACE FUNCTION public.axora_revoke_user_role_scope(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_role_assignment_id uuid,
  p_reason text
)
RETURNS TABLE(
  role_assignment_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  actor_role_key text;
  assignment_user_id uuid;
  assignment_role_id uuid;
  assignment_scope_type text;
  assignment_company_id uuid;
  assignment_branch_id uuid;
  assignment_department_id uuid;
  assignment_supplier_id uuid;
  assignment_active boolean;
  target_auth_version integer;
  revoked_role_key text;
  existing_command public.permission_change_history%ROWTYPE;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_command_id IS NULL OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_target_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The role-revocation authorization context is incomplete';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  SELECT history.* INTO existing_command
  FROM public.permission_change_history history
  WHERE history.correlation_id=p_command_id
    AND history.change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED')
  FOR SHARE;
  IF existing_command.id IS NOT NULL THEN
    IF existing_command.change_type='ROLE_REVOKED'
      AND existing_command.previous_value->>'assignmentId'
        =p_target_role_assignment_id::text
      AND existing_command.reason=clean_reason THEN
      RETURN QUERY SELECT p_target_role_assignment_id,
        (SELECT account.auth_version FROM public.users account
         WHERE account.id=existing_command.target_user_id),
        0,false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'The role-revocation command ID conflicts with another request';
  END IF;

  SELECT
    assignment.user_id,
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    assignment.department_id,
    assignment.supplier_id,
    assignment.active,
    account.auth_version,
    role.role_key
  INTO
    assignment_user_id,
    assignment_role_id,
    assignment_scope_type,
    assignment_company_id,
    assignment_branch_id,
    assignment_department_id,
    assignment_supplier_id,
    assignment_active,
    target_auth_version,
    revoked_role_key
  FROM public.role_assignments assignment
  JOIN public.users account ON account.id=assignment.user_id
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.id=p_target_role_assignment_id
  FOR UPDATE OF assignment,account;

  IF assignment_user_id IS NULL THEN
    RAISE EXCEPTION 'The selected role assignment is unavailable';
  END IF;
  IF assignment_user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot revoke their own role assignment';
  END IF;
  IF NOT assignment_active THEN
    RETURN QUERY SELECT p_target_role_assignment_id,target_auth_version,0,false;
    RETURN;
  END IF;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL THEN
    RAISE EXCEPTION 'The actor authorization context is no longer active';
  END IF;
  actor_role_key:=actor_snapshot->>'roleKey';
  IF actor_role_key='ADMIN' THEN
    actor_role_key:=CASE
      WHEN COALESCE((actor_snapshot->>'isOwner')::boolean,false)
        THEN 'PLATFORM_OWNER'
      ELSE 'COMPANY_ADMIN'
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    JOIN public.roles manager_role ON manager_role.id=rule.manager_role_id
    WHERE manager_role.role_key=actor_role_key
      AND rule.target_role_id=assignment_role_id
      AND rule.scope_type=assignment_scope_type
  ) THEN
    RAISE EXCEPTION 'The actor role cannot revoke this role and scope';
  END IF;
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    assignment_scope_type,assignment_company_id,
    assignment_branch_id,assignment_department_id,
    assignment_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage role assignments in this scope';
  END IF;

  UPDATE public.role_assignments assignment
  SET active=false,revoked_at=now(),revoked_by=p_actor_user_id,
      revoke_reason=clean_reason
  WHERE assignment.id=p_target_role_assignment_id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,assignment_user_id,'ROLE_REVOKED',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',p_target_role_assignment_id,
      'roleKey',revoked_role_key,
      'scopeType',assignment_scope_type,
      'companyId',assignment_company_id,
      'branchId',assignment_branch_id,
      'departmentId',assignment_department_id,
      'supplierId',assignment_supplier_id,
      'active',true
    )),
    jsonb_build_object('active',false,'revokedAt',now()),
    clean_reason,p_command_id
  );

  PERFORM public.axora_refresh_preferred_role_assignment(
    assignment_user_id
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    assignment_user_id,p_actor_user_id,
    'Role or scope revoked: ' || clean_reason
  );
  RETURN QUERY SELECT p_target_role_assignment_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

""")
migration = migration[:revoke_start] + revoke_function + migration[revoke_end:]

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

fixture_path = Path("tests/role-scope-lifecycle-migration.test.ts")
fixture = fixture_path.read_text()
fixture = replace_once(
    fixture,
    "'pending-account-setup',",
    "'$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By',",
    "invited account credential sentinel",
)
fixture_path.write_text(fixture)

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
