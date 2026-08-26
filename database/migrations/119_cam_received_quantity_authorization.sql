BEGIN;

SELECT pg_advisory_xact_lock(11920260826);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Request readers resolve the actor through axora_request_access_rows before
-- projecting receipt progress. Keep this secondary projection on the same
-- live, assignment-bound permission contract. The legacy implementation used
-- a role-name allowlist for platform users and a broad membership check for
-- company users, which rejected permitted Client Account Managers and could
-- bypass an explicit request.view DENY when called directly.
CREATE OR REPLACE FUNCTION public.axora_received_quantity(
  p_request_line_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  context_user_id uuid;
  context_role_assignment_id uuid;
  actor_snapshot jsonb;
  line_created_by uuid;
  line_company_id uuid;
  line_branch_id uuid;
  line_department_id uuid;
BEGIN
  IF p_request_line_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    request.created_by,
    request.company_id,
    request.branch_id,
    request.department_id
  INTO
    line_created_by,
    line_company_id,
    line_branch_id,
    line_department_id
  FROM public.request_lines line
  JOIN public.requests request ON request.id=line.request_id
  JOIN public.companies company
    ON company.id=request.company_id
   AND company.active
  JOIN public.branches branch
    ON branch.id=request.branch_id
   AND branch.company_id=request.company_id
   AND branch.active
  WHERE line.id=p_request_line_id;

  IF line_company_id IS NULL THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  context_user_id:=public.axora_context_user_id();
  context_role_assignment_id:=public.axora_context_role_assignment_id();
  IF context_user_id IS NULL OR context_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    context_user_id,context_role_assignment_id,now()
  );
  IF NOT public.axora_request_permission_is_effective(
    actor_snapshot,context_user_id,'request.view',line_created_by,
    line_company_id,line_branch_id,line_department_id
  ) THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  RETURN public.axora_effective_received_quantity_internal(
    p_request_line_id
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_received_quantity(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_received_quantity(uuid) TO axora_app;
  END IF;
END $$;

COMMIT;
