BEGIN;

-- P0-01 management slice: approval limits are financial authorization facts.
-- They are changed only through audited, scope-aware SECURITY DEFINER commands;
-- the application role retains no direct access to the underlying policy rows.

CREATE UNIQUE INDEX IF NOT EXISTS approval_limits_active_identity_uq
  ON public.approval_limits(
    COALESCE(user_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(role_id,'00000000-0000-0000-0000-000000000000'::uuid),
    permission_id,scope_type,company_id,
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    currency
  ) WHERE active;

CREATE OR REPLACE FUNCTION public.axora_invalidate_approval_limit_subject(
  p_user_id uuid,
  p_role_id uuid,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
RETURNS TABLE(affected_users integer,revoked_sessions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  affected_count integer:=0;
  revoked_count integer:=0;
  single_auth_version integer;
BEGIN
  IF (p_user_id IS NULL)=(p_role_id IS NULL) THEN
    RAISE EXCEPTION 'The approval-limit subject is invalid';
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT invalidation.auth_version,invalidation.revoked_sessions
    INTO single_auth_version,revoked_count
    FROM public.axora_invalidate_authorization_sessions(
      p_user_id,p_actor_user_id,p_reason
    ) invalidation;
    RETURN QUERY SELECT 1,COALESCE(revoked_count,0);
    RETURN;
  END IF;

  WITH affected AS (
    UPDATE public.users AS account
    SET auth_version=account.auth_version+1
    WHERE account.active
      AND account.account_status='ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        JOIN public.user_scopes scope
          ON scope.user_id=assignment.user_id
         AND scope.source='ROLE_ASSIGNMENT'
         AND scope.source_reference=assignment.id
         AND scope.active
         AND scope.starts_at<=now()
         AND (scope.ends_at IS NULL OR scope.ends_at>now())
        WHERE assignment.user_id=account.id
          AND assignment.role_id=p_role_id
          AND assignment.active
          AND assignment.revoked_at IS NULL
          AND (
            public.axora_scope_contains_nullable(
              scope.scope_type,scope.company_id,scope.branch_id,
              scope.department_id,scope.supplier_id,
              p_scope_type,p_company_id,p_branch_id,p_department_id,NULL
            )
            OR public.axora_scope_contains_nullable(
              p_scope_type,p_company_id,p_branch_id,p_department_id,NULL,
              scope.scope_type,scope.company_id,scope.branch_id,
              scope.department_id,scope.supplier_id
            )
          )
      )
    RETURNING account.id
  ), revoked AS (
    UPDATE public.user_sessions AS session
    SET revoked_at=COALESCE(session.revoked_at,now()),
        revoked_by=COALESCE(session.revoked_by,p_actor_user_id),
        revoke_reason=COALESCE(session.revoke_reason,left(p_reason,240))
    WHERE session.user_id IN (SELECT affected.id FROM affected)
      AND session.revoked_at IS NULL
    RETURNING session.id
  )
  SELECT
    (SELECT count(*)::integer FROM affected),
    (SELECT count(*)::integer FROM revoked)
  INTO affected_count,revoked_count;

  RETURN QUERY SELECT COALESCE(affected_count,0),COALESCE(revoked_count,0);
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_approval_limit(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_target_role_assignment_id uuid,
  p_target_role_id uuid,
  p_permission_code text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_currency text,
  p_maximum_amount numeric,
  p_allow_self_approval boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS TABLE(
  approval_limit_id uuid,
  affected_users integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  target_snapshot jsonb;
  actor_role_id uuid;
  permission_row public.permissions%ROWTYPE;
  existing_row public.approval_limits%ROWTYPE;
  created_id uuid;
  normalized_branch_id uuid;
  invalidation record;
  clean_permission text:=btrim(COALESCE(p_permission_code,''));
  clean_currency text:=upper(btrim(COALESCE(p_currency,'')));
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The authorization context is incomplete';
  END IF;
  IF (p_target_user_id IS NULL)=(p_target_role_id IS NULL) THEN
    RAISE EXCEPTION 'Choose exactly one user or role approval-limit subject';
  END IF;
  IF p_target_user_id IS NOT NULL AND p_target_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The target user assignment is required';
  END IF;
  IF p_target_role_id IS NOT NULL AND p_target_role_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'A role approval limit cannot carry a user assignment';
  END IF;
  IF p_target_user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own approval limits';
  END IF;
  IF clean_permission NOT IN (
    'request.approve.other','request.approve.self',
    'request.approve.over_budget','request.approve.additional_actual'
  ) THEN
    RAISE EXCEPTION 'The selected permission does not support approval limits';
  END IF;
  IF clean_permission='request.approve.self' THEN
    IF p_target_user_id IS NULL OR p_allow_self_approval IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Self-approval limits require an explicitly permitted user';
    END IF;
  ELSIF p_allow_self_approval IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Self-approval cannot be enabled for this permission';
  END IF;
  IF clean_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'The approval-limit currency is invalid';
  END IF;
  IF p_maximum_amount IS NULL
    OR p_maximum_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_maximum_amount<0
    OR p_maximum_amount>9999999999999999.99
    OR p_maximum_amount<>round(p_maximum_amount,2) THEN
    RAISE EXCEPTION 'The approval-limit amount is invalid';
  END IF;
  IF p_starts_at IS NULL OR (p_ends_at IS NOT NULL AND p_ends_at<=p_starts_at) THEN
    RAISE EXCEPTION 'The approval-limit effective period is invalid';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  IF p_scope_type='COMPANY' THEN
    IF p_company_id IS NULL OR p_branch_id IS NOT NULL OR p_department_id IS NOT NULL THEN
      RAISE EXCEPTION 'The approval-limit scope is invalid';
    END IF;
    PERFORM 1 FROM public.companies company
    WHERE company.id=p_company_id AND company.active
    FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The approval-limit company is unavailable'; END IF;
    normalized_branch_id:=NULL;
  ELSIF p_scope_type='BRANCH' THEN
    IF p_company_id IS NULL OR p_branch_id IS NULL OR p_department_id IS NOT NULL THEN
      RAISE EXCEPTION 'The approval-limit scope is invalid';
    END IF;
    PERFORM 1
    FROM public.branches branch
    JOIN public.companies company ON company.id=branch.company_id
    WHERE branch.id=p_branch_id AND branch.company_id=p_company_id
      AND branch.active AND company.active
    FOR KEY SHARE OF branch,company;
    IF NOT FOUND THEN RAISE EXCEPTION 'The approval-limit branch is unavailable'; END IF;
    normalized_branch_id:=p_branch_id;
  ELSIF p_scope_type='DEPARTMENT' THEN
    IF p_company_id IS NULL OR p_department_id IS NULL THEN
      RAISE EXCEPTION 'The approval-limit scope is invalid';
    END IF;
    SELECT department.branch_id
    INTO normalized_branch_id
    FROM public.departments department
    JOIN public.companies company ON company.id=department.company_id
    WHERE department.id=p_department_id
      AND department.company_id=p_company_id
      AND department.active AND company.active
    FOR KEY SHARE OF department,company;
    IF NOT FOUND THEN RAISE EXCEPTION 'The approval-limit department is unavailable'; END IF;
    IF p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM normalized_branch_id THEN
      RAISE EXCEPTION 'The approval-limit department branch is invalid';
    END IF;
    IF normalized_branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.branches branch
      WHERE branch.id=normalized_branch_id
        AND branch.company_id=p_company_id AND branch.active
    ) THEN
      RAISE EXCEPTION 'The approval-limit department branch is unavailable';
    END IF;
  ELSE
    RAISE EXCEPTION 'The approval-limit scope is invalid';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id
  FOR UPDATE;

  SELECT assignment.role_id
  INTO actor_role_id
  FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The authorization context is no longer active'; END IF;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    p_scope_type,p_company_id,normalized_branch_id,p_department_id,NULL
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage approval limits in this scope';
  END IF;

  SELECT permission.*
  INTO permission_row
  FROM public.permissions permission
  WHERE permission.permission_code=clean_permission AND permission.active
  FOR KEY SHARE;
  IF permission_row.id IS NULL THEN
    RAISE EXCEPTION 'The selected approval permission is unavailable';
  END IF;

  IF p_target_user_id IS NOT NULL THEN
    target_snapshot:=public.axora_effective_access_snapshot(
      p_target_user_id,p_target_role_assignment_id,now()
    );
    IF target_snapshot IS NULL
      OR NOT public.axora_snapshot_scope_contains(
        target_snapshot,p_scope_type,p_company_id,normalized_branch_id,
        p_department_id,NULL
      ) THEN
      RAISE EXCEPTION 'The target account is outside the requested scope';
    END IF;
    IF NOT public.axora_snapshot_has_permission(
      target_snapshot,clean_permission,
      p_scope_type,p_company_id,normalized_branch_id,p_department_id,NULL
    ) THEN
      RAISE EXCEPTION 'The target account does not possess the approval permission';
    END IF;
  ELSE
    IF actor_role_id=p_target_role_id THEN
      RAISE EXCEPTION 'Users cannot change approval limits for their own role';
    END IF;
    PERFORM 1
    FROM public.roles role
    JOIN public.role_permissions role_permission ON role_permission.role_id=role.id
    WHERE role.id=p_target_role_id
      AND role_permission.permission_id=permission_row.id
    FOR KEY SHARE OF role;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The target role does not possess the approval permission';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
    COALESCE(p_target_user_id::text,''),COALESCE(p_target_role_id::text,''),
    permission_row.id::text,p_scope_type,p_company_id::text,
    COALESCE(normalized_branch_id::text,''),COALESCE(p_department_id::text,''),
    clean_currency
  ),0));

  SELECT limit_row.*
  INTO existing_row
  FROM public.approval_limits limit_row
  WHERE limit_row.user_id IS NOT DISTINCT FROM p_target_user_id
    AND limit_row.role_id IS NOT DISTINCT FROM p_target_role_id
    AND limit_row.permission_id=permission_row.id
    AND limit_row.scope_type=p_scope_type
    AND limit_row.company_id=p_company_id
    AND limit_row.branch_id IS NOT DISTINCT FROM normalized_branch_id
    AND limit_row.department_id IS NOT DISTINCT FROM p_department_id
    AND limit_row.currency=clean_currency
    AND limit_row.active
  FOR UPDATE;

  IF existing_row.id IS NOT NULL
    AND existing_row.maximum_amount=p_maximum_amount
    AND existing_row.allow_self_approval=p_allow_self_approval
    AND existing_row.starts_at=p_starts_at
    AND existing_row.ends_at IS NOT DISTINCT FROM p_ends_at
    AND existing_row.reason=clean_reason THEN
    RETURN QUERY SELECT existing_row.id,0,0,false;
    RETURN;
  END IF;

  IF existing_row.id IS NOT NULL THEN
    UPDATE public.approval_limits AS limit_row
    SET active=false
    WHERE limit_row.id=existing_row.id;
  END IF;

  INSERT INTO public.approval_limits(
    user_id,role_id,permission_id,scope_type,company_id,branch_id,
    department_id,currency,maximum_amount,allow_self_approval,
    starts_at,ends_at,active,reason,changed_by
  ) VALUES (
    p_target_user_id,p_target_role_id,permission_row.id,p_scope_type,
    p_company_id,normalized_branch_id,p_department_id,clean_currency,
    p_maximum_amount,p_allow_self_approval,p_starts_at,p_ends_at,true,
    clean_reason,p_actor_user_id
  ) RETURNING id INTO created_id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,target_role_id,permission_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,p_target_user_id,p_target_role_id,permission_row.id,
    'APPROVAL_LIMIT_SET',
    CASE WHEN existing_row.id IS NULL THEN NULL ELSE jsonb_strip_nulls(
      jsonb_build_object(
        'scopeType',existing_row.scope_type,
        'companyId',existing_row.company_id,
        'branchId',existing_row.branch_id,
        'departmentId',existing_row.department_id,
        'currency',existing_row.currency,
        'maximumAmount',existing_row.maximum_amount,
        'allowSelfApproval',existing_row.allow_self_approval,
        'startsAt',existing_row.starts_at,
        'endsAt',existing_row.ends_at,
        'active',existing_row.active
      )
    ) END,
    jsonb_strip_nulls(jsonb_build_object(
      'scopeType',p_scope_type,
      'companyId',p_company_id,
      'branchId',normalized_branch_id,
      'departmentId',p_department_id,
      'currency',clean_currency,
      'maximumAmount',p_maximum_amount,
      'allowSelfApproval',p_allow_self_approval,
      'startsAt',p_starts_at,
      'endsAt',p_ends_at,
      'active',true
    )),
    clean_reason
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_approval_limit_subject(
    p_target_user_id,p_target_role_id,p_scope_type,p_company_id,
    normalized_branch_id,p_department_id,p_actor_user_id,
    'Approval limit changed: ' || clean_reason
  );
  RETURN QUERY SELECT created_id,invalidation.affected_users,
    invalidation.revoked_sessions,true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_remove_approval_limit(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_approval_limit_id uuid,
  p_reason text
)
RETURNS TABLE(
  approval_limit_id uuid,
  affected_users integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  actor_role_id uuid;
  existing_row public.approval_limits%ROWTYPE;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The authorization context is incomplete';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  SELECT limit_row.*
  INTO existing_row
  FROM public.approval_limits limit_row
  WHERE limit_row.id=p_approval_limit_id
  FOR UPDATE;
  IF existing_row.id IS NULL THEN
    RAISE EXCEPTION 'The approval limit is unavailable';
  END IF;
  IF existing_row.user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own approval limits';
  END IF;

  SELECT assignment.role_id
  INTO actor_role_id
  FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The authorization context is no longer active'; END IF;
  IF existing_row.role_id=actor_role_id THEN
    RAISE EXCEPTION 'Users cannot change approval limits for their own role';
  END IF;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    existing_row.scope_type,existing_row.company_id,existing_row.branch_id,
    existing_row.department_id,NULL
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage approval limits in this scope';
  END IF;

  IF NOT existing_row.active THEN
    RETURN QUERY SELECT existing_row.id,0,0,false;
    RETURN;
  END IF;

  UPDATE public.approval_limits AS limit_row
  SET active=false
  WHERE limit_row.id=existing_row.id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,target_role_id,permission_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,existing_row.user_id,existing_row.role_id,
    existing_row.permission_id,'APPROVAL_LIMIT_REMOVED',
    jsonb_strip_nulls(jsonb_build_object(
      'scopeType',existing_row.scope_type,
      'companyId',existing_row.company_id,
      'branchId',existing_row.branch_id,
      'departmentId',existing_row.department_id,
      'currency',existing_row.currency,
      'maximumAmount',existing_row.maximum_amount,
      'allowSelfApproval',existing_row.allow_self_approval,
      'startsAt',existing_row.starts_at,
      'endsAt',existing_row.ends_at,
      'active',existing_row.active
    )),
    jsonb_build_object('active',false),
    clean_reason
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_approval_limit_subject(
    existing_row.user_id,existing_row.role_id,existing_row.scope_type,
    existing_row.company_id,existing_row.branch_id,existing_row.department_id,
    p_actor_user_id,'Approval limit removed: ' || clean_reason
  );
  RETURN QUERY SELECT existing_row.id,invalidation.affected_users,
    invalidation.revoked_sessions,true;
END $$;

REVOKE ALL ON FUNCTION public.axora_invalidate_approval_limit_subject(
  uuid,uuid,text,uuid,uuid,uuid,uuid,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_approval_limit(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,
  boolean,timestamptz,timestamptz,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_remove_approval_limit(
  uuid,uuid,uuid,text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_invalidate_approval_limit_subject(
      uuid,uuid,text,uuid,uuid,uuid,uuid,text
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_set_approval_limit(
      uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,
      boolean,timestamptz,timestamptz,text
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_remove_approval_limit(
      uuid,uuid,uuid,text
    ) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_set_approval_limit(
      uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,
      boolean,timestamptz,timestamptz,text
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_remove_approval_limit(
      uuid,uuid,uuid,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
