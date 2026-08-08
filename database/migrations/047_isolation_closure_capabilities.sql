BEGIN;

-- P0-02 closure: provide reusable exact-assignment capabilities for every
-- remaining request-derived operational register and user-administration
-- target. Application callers receive only minimized identities; ownership,
-- tenant and scope facts are resolved from trusted database rows.

CREATE OR REPLACE FUNCTION public.axora_operation_request_access_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  request_id uuid,
  company_id uuid,
  branch_id uuid,
  department_id uuid,
  owner_user_id uuid,
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
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_permission_code IS NULL
    OR p_at IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.permissions permission
      WHERE permission.permission_code=p_permission_code
        AND permission.active
    ) THEN
    RETURN;
  END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    request.id,
    request.company_id,
    request.branch_id,
    request.department_id,
    request.created_by,
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
    actor_snapshot,p_actor_user_id,p_permission_code,
    request.created_by,request.company_id,request.branch_id,
    request.department_id
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_operation_request_access_rows(
  uuid,uuid,text,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_lock_request_line_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_request_line_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request_id_value uuid;
  access_snapshot jsonb;
BEGIN
  IF p_request_line_id IS NULL THEN RETURN NULL; END IF;

  SELECT line.request_id INTO request_id_value
  FROM public.request_lines line
  WHERE line.id=p_request_line_id
  FOR UPDATE OF line;
  IF request_id_value IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    request_id_value,p_at
  );
  IF access_snapshot IS NULL THEN RETURN NULL; END IF;

  RETURN access_snapshot || jsonb_build_object(
    'requestLineId',p_request_line_id
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_request_line_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_lock_quotation_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_quotation_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  quotation_row record;
  access_snapshot jsonb;
BEGIN
  IF p_quotation_id IS NULL THEN RETURN NULL; END IF;

  SELECT quotation.request_line_id,quotation.supplier_id
  INTO quotation_row
  FROM public.quotations quotation
  WHERE quotation.id=p_quotation_id
  FOR UPDATE OF quotation;
  IF quotation_row.request_line_id IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_line_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    quotation_row.request_line_id,p_at
  );
  IF access_snapshot IS NULL THEN RETURN NULL; END IF;

  RETURN access_snapshot || jsonb_build_object(
    'quotationId',p_quotation_id,
    'supplierId',quotation_row.supplier_id
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_quotation_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_lock_invoice_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_invoice_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  invoice_row record;
  access_snapshot jsonb;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN NULL; END IF;

  SELECT invoice.request_id,invoice.direction,invoice.supplier_id,
         invoice.company_id
  INTO invoice_row
  FROM public.invoices invoice
  WHERE invoice.id=p_invoice_id
  FOR UPDATE OF invoice;
  IF invoice_row.request_id IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    invoice_row.request_id,p_at
  );
  IF access_snapshot IS NULL THEN RETURN NULL; END IF;

  RETURN access_snapshot || jsonb_strip_nulls(jsonb_build_object(
    'invoiceId',p_invoice_id,
    'invoiceDirection',invoice_row.direction,
    'invoiceSupplierId',invoice_row.supplier_id,
    'invoiceCompanyId',invoice_row.company_id
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_invoice_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_user_directory_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  user_id uuid,
  email text,
  display_name text,
  role_key text,
  active boolean,
  is_owner boolean,
  account_kind text,
  account_status text,
  scope_type text,
  company_id uuid,
  company_name text,
  branch_id uuid,
  branch_name text,
  department_id uuid,
  department_name text,
  supplier_id uuid,
  supplier_name text,
  job_title text,
  account_setup_completed_at timestamptz,
  account_setup_delivery_status text,
  account_setup_expires_at timestamptz,
  account_setup_sent_at timestamptz,
  account_setup_delivery_attempted_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz
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
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    account.id,
    account.email,
    account.display_name,
    role.role_key,
    account.active,
    account.is_owner,
    account.account_kind,
    account.account_status,
    assignment.scope_type,
    assignment.company_id,
    company.name,
    assignment.branch_id,
    branch.name,
    assignment.department_id,
    department.name,
    assignment.supplier_id,
    supplier.name,
    profile.job_title,
    account.account_setup_completed_at,
    invitation.delivery_status,
    invitation.expires_at,
    invitation.sent_at,
    invitation.delivery_attempted_at,
    account.last_login_at,
    account.created_at
  FROM public.users account
  CROSS JOIN LATERAL (
    SELECT candidate.*
    FROM public.role_assignments candidate
    WHERE candidate.user_id=account.id
      AND candidate.active
      AND candidate.revoked_at IS NULL
      AND public.axora_snapshot_has_permission(
        actor_snapshot,'user.view',candidate.scope_type,
        candidate.company_id,candidate.branch_id,
        candidate.department_id,candidate.supplier_id
      )
    ORDER BY candidate.assigned_at DESC,candidate.id DESC
    LIMIT 1
  ) assignment
  JOIN public.roles role ON role.id=assignment.role_id
  LEFT JOIN public.companies company ON company.id=assignment.company_id
  LEFT JOIN public.branches branch
    ON branch.id=assignment.branch_id
   AND branch.company_id=assignment.company_id
  LEFT JOIN public.departments department
    ON department.id=assignment.department_id
   AND department.company_id=assignment.company_id
  LEFT JOIN public.suppliers supplier ON supplier.id=assignment.supplier_id
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN LATERAL (
    SELECT setup.delivery_status,setup.expires_at,setup.sent_at,
           setup.delivery_attempted_at
    FROM public.account_setup_invitations setup
    WHERE setup.user_id=account.id
    ORDER BY setup.created_at DESC,setup.id DESC
    LIMIT 1
  ) invitation ON true
  ORDER BY account.display_name,account.id;
END $$;

REVOKE ALL ON FUNCTION public.axora_user_directory_rows(
  uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_lock_user_target_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_target_user_id uuid,
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
  target_row record;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL
    OR p_permission_code NOT IN (
      'user.view','user.edit','user.deactivate','user.invite',
      'user.permission.manage'
    )
    OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.users actor
  WHERE actor.id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1 FROM public.role_assignments actor_assignment
  WHERE actor_assignment.id=p_actor_role_assignment_id
    AND actor_assignment.user_id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;

  SELECT
    account.id,
    account.active,
    account.is_owner,
    account.account_kind,
    account.account_status,
    account.account_setup_completed_at,
    assignment.id AS assignment_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    assignment.department_id,
    assignment.supplier_id,
    role.role_key
  INTO target_row
  FROM public.users account
  CROSS JOIN LATERAL (
    SELECT candidate.*
    FROM public.role_assignments candidate
    WHERE candidate.user_id=account.id
      AND candidate.active
      AND candidate.revoked_at IS NULL
      AND public.axora_snapshot_has_permission(
        actor_snapshot,p_permission_code,candidate.scope_type,
        candidate.company_id,candidate.branch_id,
        candidate.department_id,candidate.supplier_id
      )
    ORDER BY candidate.assigned_at DESC,candidate.id DESC
    LIMIT 1
  ) assignment
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE account.id=p_target_user_id
  FOR UPDATE OF account;

  IF target_row.id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'capturedAt',p_at,
    'permission',p_permission_code,
    'userId',target_row.id,
    'active',target_row.active,
    'isOwner',target_row.is_owner,
    'accountKind',target_row.account_kind,
    'accountStatus',target_row.account_status,
    'setupCompleted',target_row.account_setup_completed_at IS NOT NULL,
    'roleAssignmentId',target_row.assignment_id,
    'role',target_row.role_key,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',target_row.scope_type,
      'companyId',target_row.company_id,
      'branchId',target_row.branch_id,
      'departmentId',target_row.department_id,
      'supplierId',target_row.supplier_id
    ))
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_user_target_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_operation_request_access_rows(
        uuid,uuid,text,timestamptz
      ),
      public.axora_lock_request_line_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_quotation_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_invoice_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_user_directory_rows(uuid,uuid,timestamptz),
      public.axora_lock_user_target_access(
        uuid,uuid,text,uuid,timestamptz
      )
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_operation_request_access_rows(
        uuid,uuid,text,timestamptz
      ),
      public.axora_lock_request_line_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_quotation_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_invoice_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_user_directory_rows(uuid,uuid,timestamptz),
      public.axora_lock_user_target_access(
        uuid,uuid,text,uuid,timestamptz
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;
