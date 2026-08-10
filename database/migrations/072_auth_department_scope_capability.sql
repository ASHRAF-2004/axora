BEGIN;

CREATE OR REPLACE FUNCTION public.axora_auth_department_scope(
  p_user_id uuid,
  p_role_assignment_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'departmentActive',department.active,
    'branchId',department.branch_id,
    'branchActive',branch.active,
    'assignmentStatus',department_assignment.status,
    'assignmentPrimary',department_assignment.is_primary
  )
  FROM public.role_assignments role_assignment
  JOIN public.departments department
    ON department.id=role_assignment.department_id
   AND department.company_id=role_assignment.company_id
  LEFT JOIN public.branches branch
    ON branch.id=department.branch_id
   AND branch.company_id=department.company_id
  LEFT JOIN public.department_assignments department_assignment
    ON department_assignment.user_id=role_assignment.user_id
   AND department_assignment.company_id=role_assignment.company_id
   AND department_assignment.department_id=role_assignment.department_id
  WHERE role_assignment.id=p_role_assignment_id
    AND role_assignment.user_id=p_user_id
    AND role_assignment.scope_type='DEPARTMENT'
$$;

REVOKE ALL ON FUNCTION public.axora_auth_department_scope(uuid,uuid)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_auth_department_scope(uuid,uuid) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_auth_department_scope(uuid,uuid) TO axora_app';
  END IF;
END $$;

COMMIT;
