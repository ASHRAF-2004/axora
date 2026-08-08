BEGIN;

-- A write lock is a mutation capability, not a read snapshot. Even when an
-- actor retains scoped permission, an inactive company, branch, or department
-- must not remain writable. Read capabilities may still expose an inactive
-- record where policy allows historical visibility.
CREATE OR REPLACE FUNCTION public.axora_lock_request_resource_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  request_row record;
  resource_type text;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_permission_code IS NULL
    OR p_request_id IS NULL
    OR p_at IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.permissions permission
      WHERE permission.permission_code=p_permission_code
        AND permission.active
    ) THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.users account
  WHERE account.id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1
  FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;

  SELECT
    request.id,
    request.company_id,
    request.branch_id,
    request.department_id,
    request.created_by,
    company.active
      AND branch.active
      AND (request.department_id IS NULL OR department.active)
      AS resource_active
  INTO request_row
  FROM public.requests request
  JOIN public.companies company ON company.id=request.company_id
  JOIN public.branches branch
    ON branch.id=request.branch_id
   AND branch.company_id=request.company_id
  LEFT JOIN public.departments department
    ON department.id=request.department_id
   AND department.company_id=request.company_id
  WHERE request.id=p_request_id
  FOR UPDATE OF request;

  IF request_row.id IS NULL
    OR NOT request_row.resource_active
    OR NOT public.axora_request_permission_is_effective(
      actor_snapshot,p_actor_user_id,p_permission_code,
      request_row.created_by,request_row.company_id,request_row.branch_id,
      request_row.department_id
    ) THEN
    RETURN NULL;
  END IF;

  resource_type:=public.axora_request_scope_type(
    request_row.department_id
  );
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'capturedAt',p_at,
    'permission',p_permission_code,
    'requestId',request_row.id,
    'ownerUserId',request_row.created_by,
    'companyId',request_row.company_id,
    'branchId',request_row.branch_id,
    'departmentId',request_row.department_id,
    'active',true,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',resource_type,
      'companyId',request_row.company_id,
      'branchId',request_row.branch_id,
      'departmentId',request_row.department_id
    ))
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_request_resource_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_lock_request_resource_access(
      uuid,uuid,text,uuid,timestamptz
    ) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_lock_request_resource_access(
      uuid,uuid,text,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
