BEGIN;

-- P0-02 request-isolation slice. Bind requests to an optional canonical
-- department and expose only assignment-aware, database-resolved request
-- capabilities. Missing and out-of-scope identifiers deliberately produce the
-- same NULL result.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS department_id uuid;

ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_department_company_fkey;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_department_company_fkey
  FOREIGN KEY(department_id,company_id)
  REFERENCES public.departments(id,company_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS requests_authorization_scope_idx
  ON public.requests(
    company_id,branch_id,department_id,created_by,request_date DESC,id
  );

CREATE OR REPLACE FUNCTION public.axora_validate_request_department_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  department_branch_id uuid;
BEGIN
  IF NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT department.branch_id INTO department_branch_id
  FROM public.departments department
  WHERE department.id=NEW.department_id
    AND department.company_id=NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected request department is unavailable';
  END IF;
  IF department_branch_id IS NOT NULL
    AND department_branch_id<>NEW.branch_id THEN
    RAISE EXCEPTION 'The selected request department belongs to another branch';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_validate_request_department_scope()
FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_request_department_scope
  ON public.requests;
CREATE TRIGGER validate_request_department_scope
BEFORE INSERT OR UPDATE OF company_id,branch_id,department_id
ON public.requests
FOR EACH ROW
EXECUTE FUNCTION public.axora_validate_request_department_scope();

-- Backfill only when exactly one canonical department matches the historical
-- display text inside the same company and compatible branch. Ambiguous or
-- unmatched legacy text remains NULL and therefore fails closed for a
-- department-only actor while remaining available to broader authorized roles.
WITH unique_match AS (
  SELECT
    request.id AS request_id,
    min(department.id) AS department_id
  FROM public.requests request
  JOIN public.departments department
    ON department.company_id=request.company_id
   AND (department.branch_id IS NULL
     OR department.branch_id=request.branch_id)
   AND (
     lower(btrim(department.name))=lower(btrim(request.department))
     OR lower(btrim(department.department_code))=
       lower(btrim(request.department))
   )
  WHERE request.department_id IS NULL
    AND btrim(request.department)<>''
  GROUP BY request.id
  HAVING count(*)=1
)
UPDATE public.requests request
SET department_id=unique_match.department_id
FROM unique_match
WHERE request.id=unique_match.request_id
  AND request.department_id IS NULL;

CREATE OR REPLACE FUNCTION public.axora_request_scope_type(
  p_department_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_department_id IS NULL
    THEN 'BRANCH'::text ELSE 'DEPARTMENT'::text END
$$;

REVOKE ALL ON FUNCTION public.axora_request_scope_type(uuid)
FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_request_permission_is_effective(
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_permission_code text,
  p_created_by uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  resource_type text:=public.axora_request_scope_type(p_department_id);
BEGIN
  IF p_snapshot IS NULL
    OR p_actor_user_id IS NULL
    OR p_permission_code IS NULL
    OR p_company_id IS NULL
    OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_permission_code='request.view' THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,'request.view',resource_type,
      p_company_id,p_branch_id,p_department_id,NULL
    ) OR (
      p_created_by=p_actor_user_id
      AND public.axora_snapshot_has_permission(
        p_snapshot,'request.view.own',resource_type,
        p_company_id,p_branch_id,p_department_id,NULL
      )
    );
  END IF;

  IF p_permission_code='request.view.own' THEN
    RETURN p_created_by=p_actor_user_id
      AND public.axora_snapshot_has_permission(
        p_snapshot,'request.view.own',resource_type,
        p_company_id,p_branch_id,p_department_id,NULL
      );
  END IF;

  RETURN public.axora_snapshot_has_permission(
    p_snapshot,p_permission_code,resource_type,
    p_company_id,p_branch_id,p_department_id,NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_request_permission_is_effective(
  jsonb,uuid,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_request_access_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  request_id uuid,
  company_id uuid,
  branch_id uuid,
  department_id uuid,
  owner_user_id uuid,
  can_view_finance boolean,
  can_view_sourcing boolean,
  can_view_commercial boolean,
  resource_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    request.id,
    request.company_id,
    request.branch_id,
    request.department_id,
    request.created_by,
    public.axora_request_permission_is_effective(
      actor_snapshot,p_actor_user_id,'finance.invoice.view',
      request.created_by,request.company_id,request.branch_id,
      request.department_id
    ),
    public.axora_request_permission_is_effective(
      actor_snapshot,p_actor_user_id,'sourcing.manage',
      request.created_by,request.company_id,request.branch_id,
      request.department_id
    ),
    public.axora_request_permission_is_effective(
      actor_snapshot,p_actor_user_id,'commercial.cost.view',
      request.created_by,request.company_id,request.branch_id,
      request.department_id
    ) OR public.axora_request_permission_is_effective(
      actor_snapshot,p_actor_user_id,'sourcing.manage',
      request.created_by,request.company_id,request.branch_id,
      request.department_id
    ),
    company.active
      AND branch.active
      AND (request.department_id IS NULL OR department.active)
  FROM public.requests request
  JOIN public.companies company ON company.id=request.company_id
  JOIN public.branches branch
    ON branch.id=request.branch_id
   AND branch.company_id=request.company_id
  LEFT JOIN public.departments department
    ON department.id=request.department_id
   AND department.company_id=request.company_id
  WHERE public.axora_request_permission_is_effective(
    actor_snapshot,p_actor_user_id,'request.view',
    request.created_by,request.company_id,request.branch_id,
    request.department_id
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_request_access_rows(
  uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_request_resource_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

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
  WHERE request.id=p_request_id;

  IF request_row.id IS NULL
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
    'active',request_row.resource_active,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',resource_type,
      'companyId',request_row.company_id,
      'branchId',request_row.branch_id,
      'departmentId',request_row.department_id
    ))
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_request_resource_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

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
  IF actor_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

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
    'active',request_row.resource_active,
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

CREATE OR REPLACE FUNCTION public.axora_lock_request_creation_scope(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid DEFAULT NULL,
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
  company_row record;
  branch_row record;
  department_row record;
  resource_type text;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_company_id IS NULL
    OR p_branch_id IS NULL
    OR p_at IS NULL THEN
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
  IF actor_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    company.id,company.name,company.tax_rate,
    company.estimated_delivery_fee
  INTO company_row
  FROM public.companies company
  WHERE company.id=p_company_id
    AND company.active
  FOR KEY SHARE;
  IF company_row.id IS NULL THEN RETURN NULL; END IF;

  SELECT branch.id,branch.name
  INTO branch_row
  FROM public.branches branch
  WHERE branch.id=p_branch_id
    AND branch.company_id=p_company_id
    AND branch.active
  FOR KEY SHARE;
  IF branch_row.id IS NULL THEN RETURN NULL; END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT department.id,department.name,department.branch_id
    INTO department_row
    FROM public.departments department
    WHERE department.id=p_department_id
      AND department.company_id=p_company_id
      AND department.active
      AND (department.branch_id IS NULL
        OR department.branch_id=p_branch_id)
    FOR KEY SHARE;
    IF department_row.id IS NULL THEN RETURN NULL; END IF;
  END IF;

  resource_type:=public.axora_request_scope_type(p_department_id);
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'request.create',resource_type,
    p_company_id,p_branch_id,p_department_id,NULL
  ) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'capturedAt',p_at,
    'companyId',company_row.id,
    'companyName',company_row.name,
    'branchId',branch_row.id,
    'branchName',branch_row.name,
    'departmentId',department_row.id,
    'departmentName',department_row.name,
    'taxRate',company_row.tax_rate,
    'estimatedDeliveryFee',company_row.estimated_delivery_fee,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',resource_type,
      'companyId',company_row.id,
      'branchId',branch_row.id,
      'departmentId',department_row.id
    ))
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_request_creation_scope(
  uuid,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_request_scope_type(uuid),
      public.axora_request_permission_is_effective(
        jsonb,uuid,text,uuid,uuid,uuid,uuid
      ),
      public.axora_request_access_rows(uuid,uuid,timestamptz),
      public.axora_request_resource_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_request_resource_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_request_creation_scope(
        uuid,uuid,uuid,uuid,uuid,timestamptz
      )
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_request_access_rows(uuid,uuid,timestamptz),
      public.axora_request_resource_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_request_resource_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_request_creation_scope(
        uuid,uuid,uuid,uuid,uuid,timestamptz
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;
