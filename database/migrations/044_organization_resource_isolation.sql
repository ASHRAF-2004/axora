BEGIN;

-- P0-02 isolation foundation: resolve organization ownership from trusted
-- database rows before evaluating the actor's exact live role assignment.
-- Missing and out-of-scope resources both return NULL so callers cannot use
-- identifiers, counts, or error details to enumerate another tenant.

CREATE OR REPLACE FUNCTION public.axora_live_authorization_snapshot(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  assignment_row public.role_assignments%ROWTYPE;
  snapshot jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT assignment.* INTO assignment_row
  FROM public.role_assignments assignment
  JOIN public.users account
    ON account.id=assignment.user_id
   AND account.active
   AND account.account_status='ACTIVE'
   AND account.account_setup_completed_at IS NOT NULL
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=p_actor_user_id
    AND assignment.active
    AND assignment.revoked_at IS NULL;

  IF assignment_row.id IS NULL
    OR NOT public.axora_role_assignment_target_is_ready(
      assignment_row.user_id,
      assignment_row.role_id,
      assignment_row.scope_type,
      assignment_row.company_id,
      assignment_row.branch_id,
      assignment_row.department_id,
      assignment_row.supplier_id
    ) THEN
    RETURN NULL;
  END IF;

  snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  RETURN snapshot;
END $$;

REVOKE ALL ON FUNCTION public.axora_live_authorization_snapshot(
  uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_resolve_organization_resource_scope(
  p_resource_type text,
  p_resource_id uuid
)
RETURNS TABLE(
  resource_type text,
  resource_id uuid,
  scope_type text,
  company_id uuid,
  branch_id uuid,
  department_id uuid,
  supplier_id uuid,
  resource_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF p_resource_type='COMPANY' THEN
    RETURN QUERY
    SELECT
      'COMPANY'::text,
      company.id,
      'COMPANY'::text,
      company.id,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      company.active
    FROM public.companies company
    WHERE company.id=p_resource_id;
    RETURN;
  END IF;

  IF p_resource_type='BRANCH' THEN
    RETURN QUERY
    SELECT
      'BRANCH'::text,
      branch.id,
      'BRANCH'::text,
      branch.company_id,
      branch.id,
      NULL::uuid,
      NULL::uuid,
      branch.active AND company.active
    FROM public.branches branch
    JOIN public.companies company ON company.id=branch.company_id
    WHERE branch.id=p_resource_id;
    RETURN;
  END IF;

  IF p_resource_type='DEPARTMENT' THEN
    RETURN QUERY
    SELECT
      'DEPARTMENT'::text,
      department.id,
      'DEPARTMENT'::text,
      department.company_id,
      department.branch_id,
      department.id,
      NULL::uuid,
      department.active
        AND company.active
        AND (department.branch_id IS NULL OR branch.active)
    FROM public.departments department
    JOIN public.companies company ON company.id=department.company_id
    LEFT JOIN public.branches branch
      ON branch.id=department.branch_id
     AND branch.company_id=department.company_id
    WHERE department.id=p_resource_id;
    RETURN;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.axora_resolve_organization_resource_scope(
  text,uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_organization_resource_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_permission_code text,
  p_resource_type text,
  p_resource_id uuid,
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
  resource_row record;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_permission_code IS NULL
    OR p_resource_type IS NULL
    OR p_resource_id IS NULL
    OR p_at IS NULL
    OR p_resource_type NOT IN ('COMPANY','BRANCH','DEPARTMENT')
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

  SELECT * INTO resource_row
  FROM public.axora_resolve_organization_resource_scope(
    p_resource_type,p_resource_id
  );
  IF resource_row.resource_id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      actor_snapshot,
      p_permission_code,
      resource_row.scope_type,
      resource_row.company_id,
      resource_row.branch_id,
      resource_row.department_id,
      resource_row.supplier_id
    ) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'permission',p_permission_code,
    'resourceType',resource_row.resource_type,
    'resourceId',resource_row.resource_id,
    'active',resource_row.resource_active,
    'scope',jsonb_strip_nulls(jsonb_build_object(
      'type',resource_row.scope_type,
      'companyId',resource_row.company_id,
      'branchId',resource_row.branch_id,
      'departmentId',resource_row.department_id,
      'supplierId',resource_row.supplier_id
    ))
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_organization_resource_access(
  uuid,uuid,text,text,uuid,timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_organization_directory_snapshot(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
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
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'companies',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id',company.id,
          'code',company.company_code,
          'name',company.name,
          'industry',company.industry,
          'companyInformation',NULLIF(company.company_information,''),
          'websiteUrl',NULLIF(company.website_url,''),
          'mainContactName',company.main_contact_name,
          'mainContactEmail',company.main_contact_email,
          'mainContactPhone',company.main_contact_phone,
          'billingContactName',company.billing_contact_name,
          'billingContactEmail',company.billing_contact_email,
          'billingContactPhone',company.billing_contact_phone,
          'billingAddress',company.billing_address,
          'paymentTerms',company.payment_terms,
          'billingCycle',company.billing_cycle,
          'taxRate',company.tax_rate,
          'estimatedDeliveryFee',company.estimated_delivery_fee,
          'notes',company.notes,
          'status',CASE WHEN company.active THEN 'Active' ELSE 'Inactive' END
        )) ORDER BY company.name,company.id
      )
      FROM public.companies company
      WHERE
        public.axora_snapshot_has_permission(
          actor_snapshot,'company.view',
          'COMPANY',company.id,NULL,NULL,NULL
        )
        OR public.axora_snapshot_has_permission(
          actor_snapshot,'company.view.assigned',
          'COMPANY',company.id,NULL,NULL,NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.branches branch_context
          WHERE branch_context.company_id=company.id
            AND public.axora_snapshot_has_permission(
              actor_snapshot,'company.view',
              'BRANCH',company.id,branch_context.id,NULL,NULL
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.departments department_context
          WHERE department_context.company_id=company.id
            AND public.axora_snapshot_has_permission(
              actor_snapshot,'company.view',
              'DEPARTMENT',company.id,department_context.branch_id,
              department_context.id,NULL
            )
        )
    ),'[]'::jsonb),
    'branches',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id',branch.id,
          'code',branch.branch_code_id,
          'companyId',branch.company_id,
          'companyName',company.name,
          'name',branch.name,
          'branchCode',branch.branch_code,
          'deliveryAddress',branch.delivery_address,
          'city',branch.city,
          'contactName',branch.contact_name,
          'contactPhone',branch.contact_phone,
          'contactEmail',branch.contact_email,
          'deliveryInstructions',branch.delivery_instructions,
          'notes',branch.notes,
          'canViewBudget',public.axora_snapshot_has_permission(
            actor_snapshot,'budget.view',
            'BRANCH',branch.company_id,branch.id,NULL,NULL
          ),
          'monthlyBudget',CASE WHEN public.axora_snapshot_has_permission(
            actor_snapshot,'budget.view',
            'BRANCH',branch.company_id,branch.id,NULL,NULL
          ) THEN branch.monthly_budget ELSE NULL END,
          'committedAmount',CASE WHEN public.axora_snapshot_has_permission(
            actor_snapshot,'budget.view',
            'BRANCH',branch.company_id,branch.id,NULL,NULL
          ) THEN COALESCE(budget.committed_amount,0) ELSE NULL END,
          'remainingAmount',CASE WHEN public.axora_snapshot_has_permission(
            actor_snapshot,'budget.view',
            'BRANCH',branch.company_id,branch.id,NULL,NULL
          ) THEN budget.remaining_amount ELSE NULL END,
          'status',CASE WHEN branch.active THEN 'Active' ELSE 'Inactive' END
        )) ORDER BY company.name,branch.name,branch.id
      )
      FROM public.branches branch
      JOIN public.companies company ON company.id=branch.company_id
      LEFT JOIN public.v_branch_budget_usage budget ON budget.branch_id=branch.id
      WHERE
        public.axora_snapshot_has_permission(
          actor_snapshot,'organization.branch.view',
          'BRANCH',branch.company_id,branch.id,NULL,NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.departments department_context
          WHERE department_context.company_id=branch.company_id
            AND department_context.branch_id=branch.id
            AND public.axora_snapshot_has_permission(
              actor_snapshot,'organization.branch.view',
              'DEPARTMENT',branch.company_id,branch.id,
              department_context.id,NULL
            )
        )
    ),'[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_organization_directory_snapshot(
  uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_live_authorization_snapshot(uuid,uuid,timestamptz),
      public.axora_resolve_organization_resource_scope(text,uuid),
      public.axora_organization_resource_access(
        uuid,uuid,text,text,uuid,timestamptz
      ),
      public.axora_organization_directory_snapshot(uuid,uuid,timestamptz)
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_organization_resource_access(
        uuid,uuid,text,text,uuid,timestamptz
      ),
      public.axora_organization_directory_snapshot(uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
