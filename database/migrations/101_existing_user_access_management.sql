BEGIN;

SELECT pg_advisory_xact_lock(101217731);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Prompt 5 reconciles the audited role/scope lifecycle with the canonical
-- Prompt 4 catalogue without deleting compatibility rows used by historical
-- assignments. Client Account Manager remains PLATFORM scoped; company
-- portfolio responsibility is intentionally separate.
INSERT INTO public.role_assignment_management_rules(
  manager_role_id,target_role_id,scope_type
)
SELECT manager_role.id,target_role.id,rule.scope_type
FROM (VALUES
  ('PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT','PLATFORM'),
  ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','PLATFORM'),
  ('PLATFORM_OWNER','DELIVERY_GUY','DELIVERY')
) AS rule(manager_role_key,target_role_key,scope_type)
JOIN public.roles manager_role ON manager_role.role_key=rule.manager_role_key
JOIN public.roles target_role ON target_role.role_key=rule.target_role_key
ON CONFLICT(manager_role_id,target_role_id,scope_type) DO NOTHING;

-- Replace one explicitly selected effective assignment. Assignment identity is
-- append-only: reuse an already-live identical assignment or insert a new one,
-- revoke only the selected assignment, update the preferred identity, retire
-- organization memberships no longer referenced by any live assignment,
-- invalidate stale pending invitations, and invalidate sessions in one database
-- transaction. Any failure rolls back every step.
CREATE OR REPLACE FUNCTION public.axora_replace_user_role_scope(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_current_role_assignment_id uuid,
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
  target_status text;
  target_active boolean;
  target_setup_completed_at timestamptz;
  target_auth_version integer;
  current_role_id uuid;
  current_role_key text;
  current_scope_type text;
  current_company_id uuid;
  current_branch_id uuid;
  current_department_id uuid;
  current_supplier_id uuid;
  selected_role_id uuid;
  prospective_owner boolean;
  existing_command public.permission_change_history%ROWTYPE;
  new_assignment_id uuid;
  existing_matching_assignment_id uuid;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
  department_branch_id uuid;
BEGIN
  IF p_command_id IS NULL OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL OR p_target_user_id IS NULL
    OR p_current_role_assignment_id IS NULL OR p_actor_user_id=p_target_user_id
    OR char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'The role replacement request is invalid';
  END IF;

  IF p_role_key NOT IN (
    'PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT','CLIENT_ACCOUNT_MANAGER',
    'COMPANY_ADMIN','BRANCH_ADMIN','DEPARTMENT_ADMIN','COMPANY_APPROVER',
    'BRANCH_APPROVER','REQUESTER','DELIVERY_GUY'
  ) THEN
    RAISE EXCEPTION 'The selected canonical role is unavailable';
  END IF;

  SELECT history.* INTO existing_command
  FROM public.permission_change_history history
  WHERE history.correlation_id=p_command_id
    AND history.change_type='ROLE_ASSIGNED'
  FOR SHARE;
  IF existing_command.id IS NOT NULL THEN
    IF existing_command.target_user_id=p_target_user_id
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
    RAISE EXCEPTION 'The role replacement command conflicts with another request';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id FOR UPDATE;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL THEN
    RAISE EXCEPTION 'The actor authorization context is unavailable';
  END IF;
  actor_role_key:=actor_snapshot->>'roleKey';
  IF actor_role_key='ADMIN' THEN
    actor_role_key:=CASE
      WHEN COALESCE((actor_snapshot->>'isOwner')::boolean,false)
        THEN 'PLATFORM_OWNER' ELSE 'COMPANY_ADMIN' END;
  END IF;

  SELECT account.account_kind,account.is_owner,account.account_status,
    account.active,account.account_setup_completed_at,account.auth_version
  INTO target_account_kind,target_is_owner,target_status,target_active,
    target_setup_completed_at,target_auth_version
  FROM public.users account
  WHERE account.id=p_target_user_id;
  IF target_account_kind IS NULL OR NOT target_active
    OR target_status NOT IN ('ACTIVE','INVITED') THEN
    RAISE EXCEPTION 'The target account is unavailable for role replacement';
  END IF;

  SELECT assignment.role_id,role.role_key,assignment.scope_type,
    assignment.company_id,assignment.branch_id,assignment.department_id,
    assignment.supplier_id
  INTO current_role_id,current_role_key,current_scope_type,
    current_company_id,current_branch_id,current_department_id,
    current_supplier_id
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.id=p_current_role_assignment_id
    AND assignment.user_id=p_target_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
  FOR UPDATE OF assignment;
  IF current_role_id IS NULL THEN
    RAISE EXCEPTION 'The selected current assignment is unavailable';
  END IF;

  SELECT role.id INTO selected_role_id
  FROM public.roles role WHERE role.role_key=p_role_key FOR KEY SHARE;
  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'The selected canonical role is unavailable';
  END IF;

  prospective_owner:=p_role_key='PLATFORM_OWNER';
  IF (target_account_kind='PLATFORM') IS DISTINCT FROM
      (p_role_key IN ('PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT','CLIENT_ACCOUNT_MANAGER'))
    OR (target_account_kind='COMPANY') IS DISTINCT FROM
      (p_role_key IN ('COMPANY_ADMIN','BRANCH_ADMIN','DEPARTMENT_ADMIN',
        'COMPANY_APPROVER','BRANCH_APPROVER','REQUESTER'))
    OR (target_account_kind='DELIVERY') IS DISTINCT FROM
      (p_role_key='DELIVERY_GUY') THEN
    RAISE EXCEPTION 'Cross-account-kind role conversion is unavailable';
  END IF;

  -- Migration 100 is the authoritative database role/scope contract. The
  -- prospective owner flag is validated rather than trusting the target's old
  -- identity flag.
  IF NOT public.axora_role_scope_contract_is_valid(
    target_account_kind,prospective_owner,p_role_key,p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_role_scope_resource_is_active(
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The selected role or organization scope is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    JOIN public.roles manager_role ON manager_role.id=rule.manager_role_id
    WHERE manager_role.role_key=actor_role_key
      AND rule.target_role_id=selected_role_id
      AND rule.scope_type=p_scope_type
  ) OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',current_scope_type,
    current_company_id,current_branch_id,current_department_id,
    current_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot replace this role and scope';
  END IF;

  IF target_account_kind='COMPANY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      JOIN public.companies company ON company.id=membership.company_id
      WHERE membership.user_id=p_target_user_id
        AND membership.company_id=p_company_id
        AND membership.status IN ('ACTIVE','INVITED')
        AND company.active
    ) THEN
      RAISE EXCEPTION 'The requested company membership is unavailable';
    END IF;

    IF p_scope_type IN ('BRANCH','DEPARTMENT') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.branches branch
        WHERE branch.id=p_branch_id AND branch.company_id=p_company_id
          AND branch.active
      ) THEN
        RAISE EXCEPTION 'The requested branch is unavailable';
      END IF;
      INSERT INTO public.branch_assignments(
        user_id,company_id,branch_id,status,is_primary,created_by
      ) VALUES (
        p_target_user_id,p_company_id,p_branch_id,'ACTIVE',false,p_actor_user_id
      ) ON CONFLICT(user_id,branch_id) DO UPDATE
        SET company_id=EXCLUDED.company_id,status='ACTIVE',ended_at=NULL;
    END IF;

    IF p_scope_type='DEPARTMENT' THEN
      SELECT department.branch_id INTO department_branch_id
      FROM public.departments department
      WHERE department.id=p_department_id
        AND department.company_id=p_company_id AND department.active
      FOR KEY SHARE;
      IF NOT FOUND OR department_branch_id IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'The requested department and branch are inconsistent';
      END IF;
      IF NOT EXISTS (
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
    END IF;
  ELSIF target_account_kind='DELIVERY' AND NOT EXISTS (
    SELECT 1 FROM public.delivery_agent_profiles profile
    WHERE profile.user_id=p_target_user_id AND profile.active
  ) THEN
    RAISE EXCEPTION 'The target delivery identity is unavailable';
  END IF;

  IF current_role_id=selected_role_id
    AND current_scope_type=p_scope_type
    AND current_company_id IS NOT DISTINCT FROM p_company_id
    AND current_branch_id IS NOT DISTINCT FROM p_branch_id
    AND current_department_id IS NOT DISTINCT FROM p_department_id
    AND current_supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND target_is_owner=prospective_owner THEN
    RETURN QUERY SELECT p_current_role_assignment_id,target_auth_version,0,false;
    RETURN;
  END IF;

  -- If the user legitimately already carries the desired live assignment,
  -- reuse it instead of accumulating a duplicate role. The exact selected old
  -- assignment is still the only one revoked by this operation.
  SELECT assignment.id INTO existing_matching_assignment_id
  FROM public.role_assignments assignment
  WHERE assignment.user_id=p_target_user_id
    AND assignment.id<>p_current_role_assignment_id
    AND assignment.role_id=selected_role_id
    AND assignment.scope_type=p_scope_type
    AND assignment.company_id IS NOT DISTINCT FROM p_company_id
    AND assignment.branch_id IS NOT DISTINCT FROM p_branch_id
    AND assignment.department_id IS NOT DISTINCT FROM p_department_id
    AND assignment.supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND assignment.active AND assignment.revoked_at IS NULL
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1
  FOR UPDATE;

  -- The assignment write trigger validates account.is_owner. Update the
  -- prospective owner flag inside this transaction before inserting a new
  -- assignment; existing last-owner protection remains authoritative.
  IF target_is_owner IS DISTINCT FROM prospective_owner THEN
    UPDATE public.users SET is_owner=prospective_owner
    WHERE id=p_target_user_id;
  END IF;

  IF existing_matching_assignment_id IS NOT NULL THEN
    new_assignment_id:=existing_matching_assignment_id;
  ELSE
    new_assignment_id:=p_command_id;
    INSERT INTO public.role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at,revoked_at,
      revoked_by,revoke_reason
    ) VALUES (
      new_assignment_id,p_target_user_id,selected_role_id,p_scope_type,
      p_company_id,p_branch_id,p_department_id,p_supplier_id,
      true,p_actor_user_id,now(),NULL,NULL,NULL
    );
  END IF;

  UPDATE public.role_assignments
  SET active=false,revoked_at=now(),revoked_by=p_actor_user_id,
      revoke_reason=clean_reason
  WHERE id=p_current_role_assignment_id;

  PERFORM public.axora_apply_preferred_role_assignment(
    p_target_user_id,new_assignment_id
  );

  -- End only organization assignments no longer referenced by any live role.
  -- This removes stale Requester department state when narrowing back to a
  -- branch while preserving any assignment still required by another active
  -- role assignment.
  UPDATE public.department_assignments department_assignment
  SET status='ENDED',ended_at=COALESCE(department_assignment.ended_at,now()),
      is_primary=false
  WHERE department_assignment.user_id=p_target_user_id
    AND department_assignment.status='ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM public.role_assignments role_assignment
      WHERE role_assignment.user_id=p_target_user_id
        AND role_assignment.active AND role_assignment.revoked_at IS NULL
        AND role_assignment.scope_type='DEPARTMENT'
        AND role_assignment.company_id=department_assignment.company_id
        AND role_assignment.department_id=department_assignment.department_id
    );

  UPDATE public.branch_assignments branch_assignment
  SET status='ENDED',ended_at=COALESCE(branch_assignment.ended_at,now()),
      is_primary=false
  WHERE branch_assignment.user_id=p_target_user_id
    AND branch_assignment.status='ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM public.role_assignments role_assignment
      WHERE role_assignment.user_id=p_target_user_id
        AND role_assignment.active AND role_assignment.revoked_at IS NULL
        AND role_assignment.scope_type IN ('BRANCH','DEPARTMENT')
        AND role_assignment.company_id=branch_assignment.company_id
        AND role_assignment.branch_id=branch_assignment.branch_id
    );

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,p_target_user_id,'ROLE_REVOKED',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',p_current_role_assignment_id,
      'roleId',current_role_id,'roleKey',current_role_key,
      'scopeType',current_scope_type,'companyId',current_company_id,
      'branchId',current_branch_id,'departmentId',current_department_id,
      'supplierId',current_supplier_id,'active',true
    )),
    jsonb_build_object('active',false,'revokedAt',now()),
    clean_reason
  );
  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,p_target_user_id,'ROLE_ASSIGNED',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',p_current_role_assignment_id,
      'roleId',current_role_id,'roleKey',current_role_key,
      'scopeType',current_scope_type,'companyId',current_company_id,
      'branchId',current_branch_id,'departmentId',current_department_id,
      'supplierId',current_supplier_id
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',new_assignment_id,
      'roleId',selected_role_id,'roleKey',p_role_key,
      'scopeType',p_scope_type,'companyId',p_company_id,
      'branchId',p_branch_id,'departmentId',p_department_id,
      'supplierId',p_supplier_id,'preferred',true,
      'reusedExistingAssignment',existing_matching_assignment_id IS NOT NULL
    )),
    clean_reason,p_command_id
  );

  -- An unconsumed setup bearer is bound to the previous authorization intent.
  -- Revoke it explicitly so the existing resend lifecycle can create exactly
  -- one replacement random token/hash for the new role/scope.
  IF target_setup_completed_at IS NULL THEN
    UPDATE public.account_setup_invitations invitation
    SET revoked_at=COALESCE(invitation.revoked_at,now()),
        delivery_status=CASE
          WHEN invitation.delivery_status IN ('PENDING','SENDING')
            THEN 'CANCELLED'
          ELSE invitation.delivery_status
        END
    WHERE invitation.user_id=p_target_user_id
      AND invitation.consumed_at IS NULL
      AND invitation.revoked_at IS NULL;
  END IF;

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    p_target_user_id,p_actor_user_id,
    'Role or scope replaced: ' || clean_reason
  );

  RETURN QUERY SELECT new_assignment_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

REVOKE ALL ON FUNCTION public.axora_replace_user_role_scope(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
) FROM PUBLIC;

-- The authenticated effective-access snapshot intentionally remains ACTIVE
-- only. This separate read capability exposes an administrative preview for an
-- invited or suspended account without making that target authentically live.
CREATE OR REPLACE FUNCTION public.axora_pending_access_administration_snapshot(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_target_role_assignment_id uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  target_account_kind text;
  target_account_status text;
  target_active boolean;
  target_auth_version integer;
  target_display_name text;
  target_email text;
  target_setup_completed_at timestamptz;
  target_locale text;
  target_job_title text;
  target_is_owner boolean;
  selected_assignment_id uuid;
  selected_role_id uuid;
  selected_role_key text;
  selected_role_label text;
  selected_scope_type text;
  selected_company_id uuid;
  selected_branch_id uuid;
  selected_department_id uuid;
  selected_supplier_id uuid;
  selected_assigned_at timestamptz;
  can_manage boolean;
  can_view_history boolean;
  role_permissions jsonb;
  target_policy_snapshot jsonb;
BEGIN
  IF p_at IS NULL OR p_target_user_id IS NULL THEN RETURN NULL; END IF;
  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;

  SELECT account.account_kind,account.account_status,account.active,
    account.auth_version,COALESCE(profile.display_name,account.display_name),
    account.email,account.account_setup_completed_at,profile.preferred_locale,
    NULLIF(profile.job_title,''),account.is_owner
  INTO target_account_kind,target_account_status,target_active,target_auth_version,
    target_display_name,target_email,target_setup_completed_at,target_locale,
    target_job_title,target_is_owner
  FROM public.users account
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE account.id=p_target_user_id
    AND account.account_status IN ('INVITED','SUSPENDED');
  IF target_account_kind IS NULL THEN RETURN NULL; END IF;

  SELECT assignment.id,assignment.role_id,role.role_key,role.label,
    assignment.scope_type,assignment.company_id,assignment.branch_id,
    assignment.department_id,assignment.supplier_id,assignment.assigned_at
  INTO selected_assignment_id,selected_role_id,selected_role_key,
    selected_role_label,selected_scope_type,selected_company_id,
    selected_branch_id,selected_department_id,selected_supplier_id,
    selected_assigned_at
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.user_id=p_target_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
    AND (p_target_role_assignment_id IS NULL
      OR assignment.id=p_target_role_assignment_id)
    AND (
      public.axora_snapshot_has_permission(
        actor_snapshot,'user.view',assignment.scope_type,assignment.company_id,
        assignment.branch_id,assignment.department_id,assignment.supplier_id
      ) OR public.axora_snapshot_has_permission(
        actor_snapshot,'user.permission.manage',assignment.scope_type,
        assignment.company_id,assignment.branch_id,assignment.department_id,
        assignment.supplier_id
      )
    )
  ORDER BY assignment.assigned_at DESC,assignment.id LIMIT 1;
  IF selected_assignment_id IS NULL THEN RETURN NULL; END IF;

  can_manage:=p_actor_user_id<>p_target_user_id
    AND public.axora_snapshot_has_permission(
      actor_snapshot,'user.permission.manage',selected_scope_type,
      selected_company_id,selected_branch_id,selected_department_id,
      selected_supplier_id
    );
  can_view_history:=public.axora_snapshot_has_permission(
    actor_snapshot,'audit.view',selected_scope_type,selected_company_id,
    selected_branch_id,selected_department_id,selected_supplier_id
  );

  SELECT COALESCE(jsonb_agg(permission.permission_code
    ORDER BY permission.permission_code),'[]'::jsonb)
  INTO role_permissions
  FROM public.role_permissions role_permission
  JOIN public.permissions permission
    ON permission.id=role_permission.permission_id AND permission.active
  WHERE role_permission.role_id=selected_role_id;

  target_policy_snapshot:=jsonb_build_object(
    'accountKind',target_account_kind,
    'accountStatus',target_account_status,
    'isOwner',target_is_owner,
    'roleKey',selected_role_key,
    'roleAssignmentId',selected_assignment_id,
    'scopes',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type',selected_scope_type,'companyId',selected_company_id,
      'branchId',selected_branch_id,'departmentId',selected_department_id,
      'supplierId',selected_supplier_id
    ))),
    'rolePermissions',role_permissions,
    'permissionOverrides',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'permission',permission.permission_code,'effect',override_row.effect,
        'scope',jsonb_strip_nulls(jsonb_build_object(
          'type',override_row.scope_type,'companyId',override_row.company_id,
          'branchId',override_row.branch_id,
          'departmentId',override_row.department_id,
          'supplierId',override_row.supplier_id
        )),
        'active',true,'startsAt',override_row.starts_at,'endsAt',override_row.ends_at
      )))
      FROM public.user_permission_overrides override_row
      JOIN public.permissions permission ON permission.id=override_row.permission_id
      WHERE override_row.user_id=p_target_user_id AND override_row.active
        AND override_row.starts_at<=p_at
        AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
    ),'[]'::jsonb),
    'delegations','[]'::jsonb
  );

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'canManagePermissions',can_manage,
    'canViewHistory',can_view_history,
    'selectedAssignmentId',selected_assignment_id,
    'selectedScope',jsonb_strip_nulls(jsonb_build_object(
      'type',selected_scope_type,'companyId',selected_company_id,
      'companyName',(SELECT company.name FROM public.companies company
        WHERE company.id=selected_company_id),
      'branchId',selected_branch_id,
      'branchName',(SELECT branch.name FROM public.branches branch
        WHERE branch.id=selected_branch_id),
      'departmentId',selected_department_id,
      'departmentName',(SELECT department.name FROM public.departments department
        WHERE department.id=selected_department_id),
      'supplierId',selected_supplier_id,
      'supplierName',(SELECT supplier.name FROM public.suppliers supplier
        WHERE supplier.id=selected_supplier_id)
    )),
    'identity',jsonb_strip_nulls(jsonb_build_object(
      'id',p_target_user_id,'displayName',target_display_name,
      'email',target_email,'accountKind',target_account_kind,
      'accountStatus',target_account_status,'active',target_active,
      'authVersion',target_auth_version,
      'setupCompleted',target_setup_completed_at IS NOT NULL,
      'preferredLocale',target_locale,'jobTitle',target_job_title
    )),
    'assignments',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id',selected_assignment_id,'roleKey',selected_role_key,
      'roleLabel',selected_role_label,
      'scope',jsonb_strip_nulls(jsonb_build_object(
        'type',selected_scope_type,'companyId',selected_company_id,
        'companyName',(SELECT company.name FROM public.companies company
          WHERE company.id=selected_company_id),
        'branchId',selected_branch_id,
        'branchName',(SELECT branch.name FROM public.branches branch
          WHERE branch.id=selected_branch_id),
        'departmentId',selected_department_id,
        'departmentName',(SELECT department.name FROM public.departments department
          WHERE department.id=selected_department_id),
        'supplierId',selected_supplier_id,
        'supplierName',(SELECT supplier.name FROM public.suppliers supplier
          WHERE supplier.id=selected_supplier_id)
      )),
      'assignedAt',selected_assigned_at,'selected',true,
      'manageable',can_manage
    ))),
    'rolePermissions',role_permissions,
    'scopes',target_policy_snapshot->'scopes',
    'permissionOptions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code',permission.permission_code,'group',permission.permission_group,
        'label',permission.label,'description',permission.description,
        'highRisk',permission.high_risk,
        'actorCanGrant',public.axora_snapshot_has_permission(
          actor_snapshot,permission.permission_code,selected_scope_type,
          selected_company_id,selected_branch_id,selected_department_id,
          selected_supplier_id
        ),
        'targetRoleIncludes',role_permissions ? permission.permission_code,
        'effective',public.axora_snapshot_has_permission(
          target_policy_snapshot,permission.permission_code,selected_scope_type,
          selected_company_id,selected_branch_id,selected_department_id,
          selected_supplier_id
        )
      ) ORDER BY permission.permission_group,permission.label,
        permission.permission_code)
      FROM public.permissions permission
      WHERE permission.active AND (
        can_manage OR role_permissions ? permission.permission_code
        OR public.axora_snapshot_has_permission(
          target_policy_snapshot,permission.permission_code,selected_scope_type,
          selected_company_id,selected_branch_id,selected_department_id,
          selected_supplier_id
        )
      )
    ),'[]'::jsonb),
    'permissionOverrides',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',override_row.id,'permission',permission.permission_code,
        'permissionLabel',permission.label,'effect',override_row.effect,
        'scope',jsonb_strip_nulls(jsonb_build_object(
          'type',override_row.scope_type,'companyId',override_row.company_id,
          'companyName',(SELECT company.name FROM public.companies company
            WHERE company.id=override_row.company_id),
          'branchId',override_row.branch_id,
          'branchName',(SELECT branch.name FROM public.branches branch
            WHERE branch.id=override_row.branch_id),
          'departmentId',override_row.department_id,
          'departmentName',(SELECT department.name FROM public.departments department
            WHERE department.id=override_row.department_id),
          'supplierId',override_row.supplier_id,
          'supplierName',(SELECT supplier.name FROM public.suppliers supplier
            WHERE supplier.id=override_row.supplier_id)
        )),
        'startsAt',override_row.starts_at,'endsAt',override_row.ends_at,
        'reason',override_row.reason,
        'changedByName',COALESCE(changed_profile.display_name,changed_by.display_name),
        'manageable',can_manage
      )) ORDER BY permission.permission_group,permission.label,override_row.id)
      FROM public.user_permission_overrides override_row
      JOIN public.permissions permission ON permission.id=override_row.permission_id
      JOIN public.users changed_by ON changed_by.id=override_row.changed_by
      LEFT JOIN public.user_profiles changed_profile
        ON changed_profile.user_id=changed_by.id
      WHERE override_row.user_id=p_target_user_id AND override_row.active
        AND override_row.starts_at<=p_at
        AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
        AND public.axora_scope_contains_nullable(
          override_row.scope_type,override_row.company_id,override_row.branch_id,
          override_row.department_id,override_row.supplier_id,
          selected_scope_type,selected_company_id,selected_branch_id,
          selected_department_id,selected_supplier_id
        )
    ),'[]'::jsonb),
    -- Approval limits are not mutated from a non-ACTIVE account state; keeping
    -- this empty avoids implying live financial authority for pending/suspended
    -- users. Historical changes remain visible below when audit permission exists.
    'approvalLimits','[]'::jsonb,
    'delegations','[]'::jsonb,
    'history',CASE WHEN can_view_history THEN COALESCE((
      SELECT jsonb_agg(rows.payload ORDER BY rows.occurred_at DESC)
      FROM (
        SELECT history.occurred_at,jsonb_strip_nulls(jsonb_build_object(
          'id',history.id,'changeType',history.change_type,
          'previousValue',history.previous_value,'newValue',history.new_value,
          'reason',history.reason,'occurredAt',history.occurred_at,
          'actorName',COALESCE(actor_profile.display_name,history_actor.display_name)
        )) AS payload
        FROM public.permission_change_history history
        JOIN public.users history_actor ON history_actor.id=history.actor_user_id
        LEFT JOIN public.user_profiles actor_profile
          ON actor_profile.user_id=history_actor.id
        WHERE history.target_user_id=p_target_user_id
        ORDER BY history.occurred_at DESC,history.id DESC LIMIT 50
      ) rows
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_pending_access_administration_snapshot(
  uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_replace_user_role_scope(
      uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_pending_access_administration_snapshot(
      uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
