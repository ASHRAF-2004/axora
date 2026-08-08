BEGIN;

-- P0-02 closure hardening. Child resources are first resolved without a lock,
-- their trusted parent is authorized and locked, then the child is locked and
-- its parent relationship is rechecked. This prevents an unauthorized caller
-- from using a denied identifier to hold operational row locks.

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
  observed_request_id uuid;
  locked_request_id uuid;
  access_snapshot jsonb;
BEGIN
  IF p_request_line_id IS NULL OR p_at IS NULL THEN RETURN NULL; END IF;

  SELECT line.request_id INTO observed_request_id
  FROM public.request_lines line
  WHERE line.id=p_request_line_id;
  IF observed_request_id IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    observed_request_id,p_at
  );
  IF access_snapshot IS NULL
    OR NOT COALESCE((access_snapshot->>'active')::boolean,false) THEN
    RETURN NULL;
  END IF;

  SELECT line.request_id INTO locked_request_id
  FROM public.request_lines line
  WHERE line.id=p_request_line_id
  FOR UPDATE OF line;
  IF locked_request_id IS NULL
    OR locked_request_id IS DISTINCT FROM observed_request_id
    OR (access_snapshot->>'requestId')::uuid IS DISTINCT FROM locked_request_id THEN
    RETURN NULL;
  END IF;

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
  observed_request_line_id uuid;
  locked_row record;
  access_snapshot jsonb;
BEGIN
  IF p_quotation_id IS NULL OR p_at IS NULL THEN RETURN NULL; END IF;

  SELECT quotation.request_line_id INTO observed_request_line_id
  FROM public.quotations quotation
  WHERE quotation.id=p_quotation_id;
  IF observed_request_line_id IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_line_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    observed_request_line_id,p_at
  );
  IF access_snapshot IS NULL THEN RETURN NULL; END IF;

  SELECT quotation.request_line_id,quotation.supplier_id
  INTO locked_row
  FROM public.quotations quotation
  WHERE quotation.id=p_quotation_id
  FOR UPDATE OF quotation;
  IF locked_row.request_line_id IS NULL
    OR locked_row.request_line_id IS DISTINCT FROM observed_request_line_id
    OR (access_snapshot->>'requestLineId')::uuid
      IS DISTINCT FROM locked_row.request_line_id THEN
    RETURN NULL;
  END IF;

  RETURN access_snapshot || jsonb_strip_nulls(jsonb_build_object(
    'quotationId',p_quotation_id,
    'supplierId',locked_row.supplier_id
  ));
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
  observed_request_id uuid;
  locked_row record;
  access_snapshot jsonb;
BEGIN
  IF p_invoice_id IS NULL OR p_at IS NULL THEN RETURN NULL; END IF;

  SELECT invoice.request_id INTO observed_request_id
  FROM public.invoices invoice
  WHERE invoice.id=p_invoice_id;
  IF observed_request_id IS NULL THEN RETURN NULL; END IF;

  access_snapshot:=public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,p_permission_code,
    observed_request_id,p_at
  );
  IF access_snapshot IS NULL
    OR NOT COALESCE((access_snapshot->>'active')::boolean,false) THEN
    RETURN NULL;
  END IF;

  SELECT invoice.request_id,invoice.direction,invoice.supplier_id,
         invoice.company_id
  INTO locked_row
  FROM public.invoices invoice
  WHERE invoice.id=p_invoice_id
  FOR UPDATE OF invoice;
  IF locked_row.request_id IS NULL
    OR locked_row.request_id IS DISTINCT FROM observed_request_id
    OR (access_snapshot->>'requestId')::uuid
      IS DISTINCT FROM locked_row.request_id THEN
    RETURN NULL;
  END IF;

  RETURN access_snapshot || jsonb_strip_nulls(jsonb_build_object(
    'invoiceId',p_invoice_id,
    'invoiceDirection',locked_row.direction,
    'invoiceSupplierId',locked_row.supplier_id,
    'invoiceCompanyId',locked_row.company_id
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_invoice_access(
  uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;

-- Lock and recheck the exact target assignment selected by user administration.
-- The target account row is locked only when an authorized assignment exists.
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
  locked_assignment record;
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
    assignment.role_id,
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

  SELECT
    assignment.user_id,
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    assignment.department_id,
    assignment.supplier_id,
    assignment.active,
    assignment.revoked_at
  INTO locked_assignment
  FROM public.role_assignments assignment
  WHERE assignment.id=target_row.assignment_id
  FOR KEY SHARE OF assignment;

  IF locked_assignment.user_id IS NULL
    OR NOT locked_assignment.active
    OR locked_assignment.revoked_at IS NOT NULL
    OR locked_assignment.user_id IS DISTINCT FROM target_row.id
    OR locked_assignment.role_id IS DISTINCT FROM target_row.role_id
    OR locked_assignment.scope_type IS DISTINCT FROM target_row.scope_type
    OR locked_assignment.company_id IS DISTINCT FROM target_row.company_id
    OR locked_assignment.branch_id IS DISTINCT FROM target_row.branch_id
    OR locked_assignment.department_id
      IS DISTINCT FROM target_row.department_id
    OR locked_assignment.supplier_id IS DISTINCT FROM target_row.supplier_id THEN
    RETURN NULL;
  END IF;

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

-- Reauthorize account creation after the transaction begins. The hierarchy is
-- sourced from role_assignment_management_rules and the target resource is
-- locked before any account, membership, assignment, or invitation row is made.
CREATE OR REPLACE FUNCTION public.axora_lock_user_creation_scope(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_role_key text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid,
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
  actor_role_id uuid;
  resolved_target_role_id uuid;
  target_account_kind text;
  target_is_owner boolean:=false;
  organization_name text:='Axora';
  branch_name text;
  department_name text;
  supplier_name text;
  department_branch_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_target_role_key IS NULL
    OR p_scope_type NOT IN (
      'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
    )
    OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.users actor
  WHERE actor.id=p_actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT assignment.role_id INTO actor_role_id
  FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
  FOR KEY SHARE OF assignment;
  IF actor_role_id IS NULL THEN RETURN NULL; END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;

  SELECT role.id INTO resolved_target_role_id
  FROM public.roles role
  WHERE role.role_key=p_target_role_key
  FOR KEY SHARE OF role;
  IF resolved_target_role_id IS NULL THEN RETURN NULL; END IF;

  target_account_kind:=CASE
    WHEN p_target_role_key IN (
      'PLATFORM_OWNER','PLATFORM_OPERATIONS','CLIENT_ACCOUNT_MANAGER',
      'TECHNICAL_SUPPORT'
    ) THEN 'PLATFORM'
    WHEN p_target_role_key='SUPPLIER_USER' THEN 'SUPPLIER'
    WHEN p_target_role_key IN (
      'DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY_DRIVER'
    ) THEN 'DELIVERY'
    ELSE 'COMPANY'
  END;
  target_is_owner:=p_target_role_key='PLATFORM_OWNER';

  IF NOT public.axora_role_scope_contract_is_valid(
    target_account_kind,target_is_owner,p_target_role_key,p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    WHERE rule.manager_role_id=actor_role_id
      AND rule.target_role_id=resolved_target_role_id
      AND rule.scope_type=p_scope_type
  ) OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.create',p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.invite',p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RETURN NULL;
  END IF;

  IF p_scope_type='PLATFORM' THEN
    IF p_company_id IS NOT NULL OR p_branch_id IS NOT NULL
      OR p_department_id IS NOT NULL OR p_supplier_id IS NOT NULL THEN
      RETURN NULL;
    END IF;
  ELSIF p_scope_type='COMPANY' THEN
    SELECT company.name INTO organization_name
    FROM public.companies company
    WHERE company.id=p_company_id AND company.active
      AND p_branch_id IS NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    FOR KEY SHARE OF company;
    IF organization_name IS NULL THEN RETURN NULL; END IF;
  ELSIF p_scope_type='BRANCH' THEN
    SELECT company.name,branch.name
    INTO organization_name,branch_name
    FROM public.companies company
    JOIN public.branches branch
      ON branch.company_id=company.id
    WHERE company.id=p_company_id
      AND branch.id=p_branch_id
      AND company.active AND branch.active
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    FOR KEY SHARE OF company,branch;
    IF branch_name IS NULL THEN RETURN NULL; END IF;
  ELSIF p_scope_type='DEPARTMENT' THEN
    SELECT company.name,department.name,department.branch_id
    INTO organization_name,department_name,department_branch_id
    FROM public.companies company
    JOIN public.departments department
      ON department.company_id=company.id
    WHERE company.id=p_company_id
      AND department.id=p_department_id
      AND company.active AND department.active
      AND p_supplier_id IS NULL
    FOR KEY SHARE OF company,department;
    IF department_name IS NULL
      OR p_branch_id IS DISTINCT FROM department_branch_id THEN
      RETURN NULL;
    END IF;
    IF department_branch_id IS NOT NULL THEN
      SELECT branch.name INTO branch_name
      FROM public.branches branch
      WHERE branch.id=department_branch_id
        AND branch.company_id=p_company_id
        AND branch.active
      FOR KEY SHARE OF branch;
      IF branch_name IS NULL THEN RETURN NULL; END IF;
    END IF;
  ELSIF p_scope_type='SUPPLIER' THEN
    SELECT supplier.name INTO supplier_name
    FROM public.suppliers supplier
    WHERE supplier.id=p_supplier_id AND supplier.active
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL
    FOR KEY SHARE OF supplier;
    IF supplier_name IS NULL THEN RETURN NULL; END IF;
    organization_name:=supplier_name;
  ELSIF p_scope_type='DELIVERY' THEN
    IF p_company_id IS NOT NULL OR p_branch_id IS NOT NULL
      OR p_department_id IS NOT NULL OR p_supplier_id IS NOT NULL THEN
      RETURN NULL;
    END IF;
    organization_name:='Axora delivery network';
  ELSE
    RETURN NULL;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'capturedAt',p_at,
    'roleId',resolved_target_role_id,
    'role',p_target_role_key,
    'accountKind',target_account_kind,
    'isOwner',target_is_owner,
    'organizationName',organization_name,
    'branchName',branch_name,
    'departmentName',department_name,
    'supplierName',supplier_name,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',p_scope_type,
      'companyId',p_company_id,
      'branchId',p_branch_id,
      'departmentId',p_department_id,
      'supplierId',p_supplier_id
    ))
  ));
END $$;

REVOKE ALL ON FUNCTION public.axora_lock_user_creation_scope(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_lock_request_line_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_quotation_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_invoice_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_user_target_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_user_creation_scope(
        uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
      )
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_lock_request_line_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_quotation_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_invoice_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_user_target_access(
        uuid,uuid,text,uuid,timestamptz
      ),
      public.axora_lock_user_creation_scope(
        uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;
