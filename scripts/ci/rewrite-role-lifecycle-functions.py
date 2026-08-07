from pathlib import Path
from textwrap import dedent


path = Path("database/migrations/042_role_scope_lifecycle.sql")
source = path.read_text()


def replace_block(start_marker: str, end_marker: str, replacement: str) -> None:
    global source
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    source = source[:start] + replacement + source[end:]


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
END;
$$;

""")
replace_block(
    "CREATE OR REPLACE FUNCTION public.axora_apply_preferred_role_assignment(",
    "CREATE OR REPLACE FUNCTION public.axora_refresh_preferred_role_assignment(",
    preferred_function,
)

assign_function = dedent("""\
CREATE OR REPLACE FUNCTION public.axora_assign_user_role_scope(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_role_key text,
  p_scope_type text,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
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
  target_account_kind text;
  target_is_owner boolean;
  target_current_role_id uuid;
  target_current_company_id uuid;
  target_current_branch_id uuid;
  target_auth_version integer;
  selected_role_id uuid;
  existing_command public.permission_change_history%ROWTYPE;
  existing_assignment_id uuid;
  previous_identity jsonb;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
  prospective_owner boolean;
  expected_company_id uuid;
  expected_branch_id uuid;
BEGIN
  IF p_command_id IS NULL OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'The role-assignment authorization context is incomplete';
  END IF;
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own role assignment';
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
    IF existing_command.change_type='ROLE_ASSIGNED'
      AND existing_command.target_user_id=p_target_user_id
      AND existing_command.new_value->>'roleKey'=p_role_key
      AND existing_command.new_value->>'scopeType'=p_scope_type
      AND NULLIF(existing_command.new_value->>'companyId','')::uuid
        IS NOT DISTINCT FROM p_company_id
      AND NULLIF(existing_command.new_value->>'branchId','')::uuid
        IS NOT DISTINCT FROM p_branch_id
      AND NULLIF(existing_command.new_value->>'departmentId','')::uuid
        IS NOT DISTINCT FROM p_department_id
      AND NULLIF(existing_command.new_value->>'supplierId','')::uuid
        IS NOT DISTINCT FROM p_supplier_id
      AND existing_command.reason=clean_reason THEN
      RETURN QUERY SELECT
        (existing_command.new_value->>'assignmentId')::uuid,
        (SELECT account.auth_version FROM public.users account
         WHERE account.id=p_target_user_id),
        0,false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'The role-assignment command ID conflicts with another request';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id
  FOR UPDATE;

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

  SELECT
    account.account_kind,
    account.is_owner,
    account.role_id,
    account.company_id,
    account.branch_id,
    account.auth_version
  INTO
    target_account_kind,
    target_is_owner,
    target_current_role_id,
    target_current_company_id,
    target_current_branch_id,
    target_auth_version
  FROM public.users account
  WHERE account.id=p_target_user_id
    AND account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL;
  IF target_account_kind IS NULL THEN
    RAISE EXCEPTION 'The target account is not active and fully established';
  END IF;

  SELECT role.id INTO selected_role_id
  FROM public.roles role
  WHERE role.role_key=p_role_key
    AND role.role_key IN (
      'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
      'CLIENT_ACCOUNT_MANAGER','COMPANY_ADMIN','BRANCH_ADMIN',
      'DEPARTMENT_ADMIN','COMPANY_APPROVER','BRANCH_APPROVER','REQUESTER',
      'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER','SUPPLIER_USER',
      'DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY_DRIVER'
    )
  FOR KEY SHARE;
  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'The selected canonical role is unavailable';
  END IF;

  prospective_owner:=p_role_key='PLATFORM_OWNER';
  IF target_is_owner AND NOT prospective_owner THEN
    RAISE EXCEPTION 'Revoke the current Platform Owner assignment before assigning a non-owner role';
  END IF;
  IF NOT public.axora_role_scope_contract_is_valid(
    target_account_kind,prospective_owner,p_role_key,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_role_scope_resource_is_active(
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The selected role does not fit the account or scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    JOIN public.roles manager_role ON manager_role.id=rule.manager_role_id
    WHERE manager_role.role_key=actor_role_key
      AND rule.target_role_id=selected_role_id
      AND rule.scope_type=p_scope_type
  ) THEN
    RAISE EXCEPTION 'The actor role cannot assign this role and scope';
  END IF;
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage role assignments in this scope';
  END IF;

  IF target_account_kind='COMPANY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id=p_target_user_id
        AND membership.company_id=p_company_id
        AND membership.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'The target account does not belong to the requested company';
    END IF;
    IF p_scope_type='BRANCH' THEN
      INSERT INTO public.branch_assignments(
        user_id,company_id,branch_id,status,is_primary,created_by
      ) VALUES (
        p_target_user_id,p_company_id,p_branch_id,'ACTIVE',false,p_actor_user_id
      )
      ON CONFLICT(user_id,branch_id) DO UPDATE
      SET company_id=EXCLUDED.company_id,status='ACTIVE',ended_at=NULL;
    END IF;
    IF p_scope_type='DEPARTMENT'
      AND NOT EXISTS (
        SELECT 1 FROM public.department_assignments assignment
        WHERE assignment.user_id=p_target_user_id
          AND assignment.department_id=p_department_id
          AND assignment.status='ACTIVE'
      ) THEN
      INSERT INTO public.department_assignments(
        user_id,company_id,department_id,status,is_primary,assigned_by
      ) VALUES (
        p_target_user_id,p_company_id,p_department_id,
        'ACTIVE',false,p_actor_user_id
      );
    END IF;
  ELSIF target_account_kind='SUPPLIER' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_memberships membership
      WHERE membership.user_id=p_target_user_id
        AND membership.supplier_id=p_supplier_id
        AND membership.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'The target account does not belong to the requested supplier';
    END IF;
  ELSIF target_account_kind='DELIVERY'
    AND p_role_key IN ('DELIVERY_AGENT','DELIVERY_DRIVER')
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_agent_profiles profile
      WHERE profile.user_id=p_target_user_id AND profile.active
    ) THEN
    RAISE EXCEPTION 'The target delivery agent profile is not active';
  END IF;

  expected_company_id:=CASE
    WHEN target_account_kind='COMPANY' THEN p_company_id
    ELSE NULL
  END;
  expected_branch_id:=CASE
    WHEN target_account_kind='COMPANY'
      AND p_scope_type IN ('BRANCH','DEPARTMENT') THEN p_branch_id
    ELSE NULL
  END;
  previous_identity:=jsonb_strip_nulls(jsonb_build_object(
    'roleId',target_current_role_id,
    'companyId',target_current_company_id,
    'branchId',target_current_branch_id,
    'isOwner',target_is_owner
  ));

  IF prospective_owner AND NOT target_is_owner THEN
    UPDATE public.users account
    SET is_owner=true,role_id=selected_role_id,
        company_id=NULL,branch_id=NULL
    WHERE account.id=p_target_user_id;
  END IF;

  SELECT assignment.id INTO existing_assignment_id
  FROM public.role_assignments assignment
  WHERE assignment.user_id=p_target_user_id
    AND assignment.role_id=selected_role_id
    AND assignment.scope_type=p_scope_type
    AND assignment.company_id IS NOT DISTINCT FROM p_company_id
    AND assignment.branch_id IS NOT DISTINCT FROM p_branch_id
    AND assignment.department_id IS NOT DISTINCT FROM p_department_id
    AND assignment.supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND assignment.active
  FOR UPDATE;

  IF existing_assignment_id IS NOT NULL
    AND target_current_role_id=selected_role_id
    AND target_is_owner=prospective_owner
    AND target_current_company_id IS NOT DISTINCT FROM expected_company_id
    AND target_current_branch_id IS NOT DISTINCT FROM expected_branch_id THEN
    RETURN QUERY SELECT existing_assignment_id,target_auth_version,0,false;
    RETURN;
  END IF;

  IF existing_assignment_id IS NULL THEN
    INSERT INTO public.role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at,revoked_at,
      revoked_by,revoke_reason
    ) VALUES (
      p_command_id,p_target_user_id,selected_role_id,p_scope_type,
      p_company_id,p_branch_id,p_department_id,p_supplier_id,
      true,p_actor_user_id,now(),NULL,NULL,NULL
    ) RETURNING id INTO existing_assignment_id;
  END IF;

  PERFORM public.axora_apply_preferred_role_assignment(
    p_target_user_id,existing_assignment_id
  );

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,p_target_user_id,'ROLE_ASSIGNED',
    previous_identity,
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',existing_assignment_id,
      'roleId',selected_role_id,
      'roleKey',p_role_key,
      'scopeType',p_scope_type,
      'companyId',p_company_id,
      'branchId',p_branch_id,
      'departmentId',p_department_id,
      'supplierId',p_supplier_id,
      'preferred',true
    )),
    clean_reason,p_command_id
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    p_target_user_id,p_actor_user_id,
    'Role or scope assigned: ' || clean_reason
  );
  RETURN QUERY SELECT existing_assignment_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END;
$$;

""")
replace_block(
    "CREATE OR REPLACE FUNCTION public.axora_assign_user_role_scope(",
    "CREATE OR REPLACE FUNCTION public.axora_revoke_user_role_scope(",
    assign_function,
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
      'roleId',assignment_role_id,
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
END;
$$;

""")
replace_block(
    "CREATE OR REPLACE FUNCTION public.axora_revoke_user_role_scope(",
    "REVOKE ALL ON TABLE public.role_assignment_management_rules",
    revoke_function,
)

path.write_text(source)
