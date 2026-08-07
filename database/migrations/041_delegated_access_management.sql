BEGIN;

-- P0-01 management slice: temporary delegated access is assignment-bound,
-- time-bounded, non-chainable, audited, and fail-closed when the authorizer's
-- original direct role authority no longer exists.

ALTER TABLE public.permissions
  ADD COLUMN IF NOT EXISTS delegatable boolean NOT NULL DEFAULT false;

UPDATE public.permissions
SET delegatable=permission_code IN (
  'dashboard.view',
  'company.view',
  'organization.branch.view',
  'product.view',
  'cart.manage',
  'request.view',
  'request.create',
  'request.edit',
  'request.submit',
  'request.cancel',
  'request.approval_queue.view',
  'request.approve.other',
  'request.approve.over_budget',
  'request.approve.additional_actual',
  'budget.view',
  'delivery.view',
  'receiving.view',
  'receiving.confirm',
  'finance.invoice.view',
  'finance.manage',
  'finance.match.review',
  'document.view',
  'document.generate',
  'document.download',
  'report.view',
  'analytics.company.view'
);

ALTER TABLE public.delegated_access
  ADD COLUMN IF NOT EXISTS command_id uuid;
ALTER TABLE public.delegated_access
  ADD COLUMN IF NOT EXISTS authorized_by_role_assignment_id uuid;
ALTER TABLE public.delegated_access
  ADD COLUMN IF NOT EXISTS grantee_role_assignment_id uuid;

ALTER TABLE public.delegated_access
  DROP CONSTRAINT IF EXISTS delegated_access_authorizer_assignment_fkey;
ALTER TABLE public.delegated_access
  ADD CONSTRAINT delegated_access_authorizer_assignment_fkey
  FOREIGN KEY(authorized_by_role_assignment_id)
  REFERENCES public.role_assignments(id)
  ON DELETE RESTRICT;

ALTER TABLE public.delegated_access
  DROP CONSTRAINT IF EXISTS delegated_access_grantee_assignment_fkey;
ALTER TABLE public.delegated_access
  ADD CONSTRAINT delegated_access_grantee_assignment_fkey
  FOREIGN KEY(grantee_role_assignment_id)
  REFERENCES public.role_assignments(id)
  ON DELETE RESTRICT;

ALTER TABLE public.delegated_access
  DROP CONSTRAINT IF EXISTS delegated_access_managed_shape_check;
ALTER TABLE public.delegated_access
  ADD CONSTRAINT delegated_access_managed_shape_check CHECK (
    (command_id IS NULL
      AND authorized_by_role_assignment_id IS NULL
      AND grantee_role_assignment_id IS NULL)
    OR
    (command_id IS NOT NULL
      AND authorized_by_role_assignment_id IS NOT NULL
      AND grantee_role_assignment_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS delegated_access_command_id_uq
  ON public.delegated_access(command_id)
  WHERE command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS delegated_access_grantee_assignment_lookup_idx
  ON public.delegated_access(
    grantee_user_id,grantee_role_assignment_id,status,starts_at,ends_at
  );

CREATE OR REPLACE FUNCTION public.axora_role_assignment_scope_contains(
  p_user_id uuid,
  p_role_assignment_id uuid,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.id=p_role_assignment_id
     AND assignment.user_id=account.id
     AND assignment.active
     AND assignment.revoked_at IS NULL
    JOIN public.user_scopes scope
      ON scope.user_id=account.id
     AND scope.source='ROLE_ASSIGNMENT'
     AND scope.source_reference=assignment.id
     AND scope.active
     AND scope.starts_at<=p_at
     AND (scope.ends_at IS NULL OR scope.ends_at>p_at)
    WHERE account.id=p_user_id
      AND account.active
      AND account.account_status='ACTIVE'
      AND public.axora_scope_contains_nullable(
        scope.scope_type,scope.company_id,scope.branch_id,
        scope.department_id,scope.supplier_id,
        p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
      )
  ),false)
$$;

CREATE OR REPLACE FUNCTION public.axora_role_assignment_has_direct_permission(
  p_user_id uuid,
  p_role_assignment_id uuid,
  p_permission_code text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(
    public.axora_role_assignment_scope_contains(
      p_user_id,p_role_assignment_id,p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id,p_at
    )
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      JOIN public.role_permissions role_permission
        ON role_permission.role_id=assignment.role_id
      JOIN public.permissions permission
        ON permission.id=role_permission.permission_id
       AND permission.active
      WHERE assignment.id=p_role_assignment_id
        AND assignment.user_id=p_user_id
        AND assignment.active
        AND assignment.revoked_at IS NULL
        AND permission.permission_code=p_permission_code
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_permission_overrides override_row
      JOIN public.permissions permission
        ON permission.id=override_row.permission_id
       AND permission.active
      WHERE override_row.user_id=p_user_id
        AND override_row.effect='DENY'
        AND override_row.active
        AND override_row.starts_at<=p_at
        AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
        AND permission.permission_code=p_permission_code
        AND public.axora_scope_contains_nullable(
          override_row.scope_type,override_row.company_id,
          override_row.branch_id,override_row.department_id,
          override_row.supplier_id,
          p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
        )
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_delegation_scope_is_active(
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT CASE p_scope_type
    WHEN 'COMPANY' THEN EXISTS (
      SELECT 1 FROM public.companies company
      WHERE company.id=p_company_id AND company.active
        AND p_branch_id IS NULL AND p_department_id IS NULL
        AND p_supplier_id IS NULL
    )
    WHEN 'BRANCH' THEN EXISTS (
      SELECT 1
      FROM public.branches branch
      JOIN public.companies company ON company.id=branch.company_id
      WHERE branch.id=p_branch_id
        AND branch.company_id=p_company_id
        AND branch.active AND company.active
        AND p_department_id IS NULL AND p_supplier_id IS NULL
    )
    WHEN 'DEPARTMENT' THEN EXISTS (
      SELECT 1
      FROM public.departments department
      JOIN public.companies company ON company.id=department.company_id
      WHERE department.id=p_department_id
        AND department.company_id=p_company_id
        AND department.branch_id IS NOT DISTINCT FROM p_branch_id
        AND department.active AND company.active
        AND p_supplier_id IS NULL
        AND (
          department.branch_id IS NULL OR EXISTS (
            SELECT 1 FROM public.branches branch
            WHERE branch.id=department.branch_id
              AND branch.company_id=department.company_id
              AND branch.active
          )
        )
    )
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_delegation_authority_is_live(
  p_delegated_access_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.delegated_access delegation
    WHERE delegation.id=p_delegated_access_id
      AND delegation.command_id IS NOT NULL
      AND delegation.authorized_by_role_assignment_id IS NOT NULL
      AND delegation.grantee_role_assignment_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.delegated_access_permissions delegated_permission
        WHERE delegated_permission.delegated_access_id=delegation.id
      )
      AND EXISTS (
        SELECT 1
        FROM public.delegated_access_scopes delegated_scope
        WHERE delegated_scope.delegated_access_id=delegation.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.delegated_access_scopes delegated_scope
        WHERE delegated_scope.delegated_access_id=delegation.id
          AND NOT public.axora_delegation_scope_is_active(
            delegated_scope.scope_type,delegated_scope.company_id,
            delegated_scope.branch_id,delegated_scope.department_id,
            delegated_scope.supplier_id
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.delegated_access_scopes delegated_scope
        WHERE delegated_scope.delegated_access_id=delegation.id
          AND NOT public.axora_role_assignment_has_direct_permission(
            delegation.authorized_by,
            delegation.authorized_by_role_assignment_id,
            'user.permission.manage',
            delegated_scope.scope_type,delegated_scope.company_id,
            delegated_scope.branch_id,delegated_scope.department_id,
            delegated_scope.supplier_id,p_at
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.delegated_access_permissions delegated_permission
        JOIN public.permissions permission
          ON permission.id=delegated_permission.permission_id
        CROSS JOIN public.delegated_access_scopes delegated_scope
        WHERE delegated_permission.delegated_access_id=delegation.id
          AND delegated_scope.delegated_access_id=delegation.id
          AND (
            NOT permission.active
            OR NOT permission.delegatable
            OR NOT public.axora_role_assignment_has_direct_permission(
              delegation.authorized_by,
              delegation.authorized_by_role_assignment_id,
              permission.permission_code,
              delegated_scope.scope_type,delegated_scope.company_id,
              delegated_scope.branch_id,delegated_scope.department_id,
              delegated_scope.supplier_id,p_at
            )
          )
      )
  ),false)
$$;

-- Replace the minimized snapshot so managed delegations are bound to the exact
-- selected grantee assignment and continuously revalidate the authorizer's
-- original direct role authority. Legacy unbound rows are retained but cannot
-- authorize access.
CREATE OR REPLACE FUNCTION public.axora_effective_access_snapshot(
  p_user_id uuid,
  p_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
BEGIN
  IF p_user_id IS NULL
    OR p_role_assignment_id IS NULL
    OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'accountStatus',account.account_status,
    'accountKind',account.account_kind,
    'isOwner',account.is_owner,
    'authVersion',account.auth_version,
    'roleAssignmentId',assignment.id,
    'roleKey',role.role_key,
    'scopes',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'type',scope.scope_type,
          'companyId',scope.company_id,
          'branchId',scope.branch_id,
          'departmentId',scope.department_id,
          'supplierId',scope.supplier_id
        ))
        ORDER BY
          scope.scope_type,scope.company_id,scope.branch_id,
          scope.department_id,scope.supplier_id,scope.id
      )
      FROM public.user_scopes scope
      WHERE scope.user_id=p_user_id
        AND scope.active
        AND scope.starts_at<=p_at
        AND (scope.ends_at IS NULL OR scope.ends_at>p_at)
        AND (
          scope.source<>'ROLE_ASSIGNMENT'
          OR scope.source_reference=assignment.id
        )
    ),'[]'::jsonb),
    'rolePermissions',COALESCE((
      SELECT jsonb_agg(permission.permission_code ORDER BY permission.permission_code)
      FROM public.role_permissions role_permission
      JOIN public.permissions permission
        ON permission.id=role_permission.permission_id
       AND permission.active
      WHERE role_permission.role_id=assignment.role_id
    ),'[]'::jsonb),
    'permissionOverrides',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'permission',permission.permission_code,
          'effect',override_row.effect,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',override_row.scope_type,
            'companyId',override_row.company_id,
            'branchId',override_row.branch_id,
            'departmentId',override_row.department_id,
            'supplierId',override_row.supplier_id
          )),
          'active',true,
          'startsAt',override_row.starts_at,
          'endsAt',override_row.ends_at
        ))
        ORDER BY permission.permission_code,override_row.effect,override_row.id
      )
      FROM public.user_permission_overrides override_row
      JOIN public.permissions permission
        ON permission.id=override_row.permission_id
       AND permission.active
      WHERE override_row.user_id=p_user_id
        AND override_row.active
        AND override_row.starts_at<=p_at
        AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
    ),'[]'::jsonb),
    'delegations',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'active',true,
          'startsAt',delegation.starts_at,
          'endsAt',delegation.ends_at,
          'permissions',COALESCE((
            SELECT jsonb_agg(
              permission.permission_code ORDER BY permission.permission_code
            )
            FROM public.delegated_access_permissions delegated_permission
            JOIN public.permissions permission
              ON permission.id=delegated_permission.permission_id
             AND permission.active
             AND permission.delegatable
            WHERE delegated_permission.delegated_access_id=delegation.id
          ),'[]'::jsonb),
          'scopes',COALESCE((
            SELECT jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                'type',delegated_scope.scope_type,
                'companyId',delegated_scope.company_id,
                'branchId',delegated_scope.branch_id,
                'departmentId',delegated_scope.department_id,
                'supplierId',delegated_scope.supplier_id
              ))
              ORDER BY
                delegated_scope.scope_type,delegated_scope.company_id,
                delegated_scope.branch_id,delegated_scope.department_id,
                delegated_scope.supplier_id,delegated_scope.id
            )
            FROM public.delegated_access_scopes delegated_scope
            WHERE delegated_scope.delegated_access_id=delegation.id
          ),'[]'::jsonb)
        )
        ORDER BY delegation.ends_at,delegation.id
      )
      FROM public.delegated_access delegation
      WHERE delegation.grantee_user_id=p_user_id
        AND delegation.grantee_role_assignment_id=assignment.id
        AND delegation.status='ACTIVE'
        AND delegation.starts_at<=p_at
        AND delegation.ends_at>p_at
        AND public.axora_delegation_authority_is_live(delegation.id,p_at)
    ),'[]'::jsonb),
    'approvalLimits',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'permission',permission.permission_code,
          'currency',limit_row.currency,
          'maximumAmount',limit_row.maximum_amount,
          'allowSelfApproval',limit_row.allow_self_approval,
          'active',true,
          'startsAt',limit_row.starts_at,
          'endsAt',limit_row.ends_at,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',limit_row.scope_type,
            'companyId',limit_row.company_id,
            'branchId',limit_row.branch_id,
            'departmentId',limit_row.department_id
          ))
        ))
        ORDER BY permission.permission_code,limit_row.maximum_amount,limit_row.id
      )
      FROM public.approval_limits limit_row
      JOIN public.permissions permission
        ON permission.id=limit_row.permission_id
       AND permission.active
      WHERE limit_row.active
        AND limit_row.starts_at<=p_at
        AND (limit_row.ends_at IS NULL OR limit_row.ends_at>p_at)
        AND (
          limit_row.user_id=p_user_id
          OR limit_row.role_id=assignment.role_id
        )
    ),'[]'::jsonb)
  )
  INTO snapshot
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.id=p_role_assignment_id
   AND assignment.user_id=account.id
   AND assignment.active
   AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE account.id=p_user_id
    AND account.active
    AND account.account_status='ACTIVE';

  RETURN snapshot;
END $$;

CREATE OR REPLACE FUNCTION public.axora_create_delegated_access(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_grantee_user_id uuid,
  p_grantee_role_assignment_id uuid,
  p_permission_codes text[],
  p_scopes jsonb,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS TABLE(
  delegated_access_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
<<delegation_command>>
DECLARE
  normalized_permissions text[];
  normalized_scopes jsonb:='[]'::jsonb;
  scope_value jsonb;
  scope_type text;
  company_text text;
  branch_text text;
  department_text text;
  company_id uuid;
  branch_id uuid;
  department_id uuid;
  canonical_branch_id uuid;
  permission_code text;
  grantee_account_kind text;
  grantee_role_key text;
  grantee_scope_type text;
  grantee_is_owner boolean;
  existing_row public.delegated_access%ROWTYPE;
  existing_permissions text[];
  existing_scopes jsonb;
  created_id uuid;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_command_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_grantee_user_id IS NULL
    OR p_grantee_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The delegation context is incomplete';
  END IF;
  IF p_actor_user_id=p_grantee_user_id THEN
    RAISE EXCEPTION 'Users cannot delegate access to themselves';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL
    OR p_ends_at<=p_starts_at
    OR p_ends_at>p_starts_at+interval '30 days' THEN
    RAISE EXCEPTION 'Delegated access must have a valid period of at most 30 days';
  END IF;
  IF p_permission_codes IS NULL
    OR cardinality(p_permission_codes) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Choose between 1 and 20 delegated permissions';
  END IF;
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes)<>'array'
    OR jsonb_array_length(p_scopes) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Choose between 1 and 10 delegated scopes';
  END IF;
  IF cardinality(p_permission_codes)*jsonb_array_length(p_scopes)>100 THEN
    RAISE EXCEPTION 'The delegated permission and scope combination is too large';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_permission_codes) permission(value)
    WHERE permission.value IS NULL OR btrim(permission.value)=''
  ) THEN
    RAISE EXCEPTION 'A delegated permission is invalid';
  END IF;
  SELECT array_agg(DISTINCT btrim(permission.value) ORDER BY btrim(permission.value))
  INTO normalized_permissions
  FROM unnest(p_permission_codes) permission(value);
  IF cardinality(normalized_permissions)<>cardinality(p_permission_codes) THEN
    RAISE EXCEPTION 'Delegated permissions must be unique';
  END IF;

  FOR scope_value IN
    SELECT item.value FROM jsonb_array_elements(p_scopes) item(value)
  LOOP
    IF jsonb_typeof(scope_value)<>'object'
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(scope_value) key(value)
        WHERE key.value NOT IN ('type','companyId','branchId','departmentId')
      ) THEN
      RAISE EXCEPTION 'A delegated scope is invalid';
    END IF;

    scope_type:=scope_value->>'type';
    company_text:=scope_value->>'companyId';
    branch_text:=scope_value->>'branchId';
    department_text:=scope_value->>'departmentId';
    IF scope_type NOT IN ('COMPANY','BRANCH','DEPARTMENT')
      OR company_text IS NULL
      OR company_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'A delegated scope is invalid';
    END IF;
    company_id:=company_text::uuid;
    branch_id:=NULL;
    department_id:=NULL;
    canonical_branch_id:=NULL;

    IF scope_type='COMPANY' THEN
      IF branch_text IS NOT NULL OR department_text IS NOT NULL THEN
        RAISE EXCEPTION 'A delegated company scope is invalid';
      END IF;
      PERFORM 1 FROM public.companies company
      WHERE company.id=delegation_command.company_id AND company.active
      FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'The delegated company is unavailable'; END IF;
    ELSIF scope_type='BRANCH' THEN
      IF branch_text IS NULL OR department_text IS NOT NULL
        OR branch_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'A delegated branch scope is invalid';
      END IF;
      branch_id:=branch_text::uuid;
      PERFORM 1
      FROM public.branches branch
      JOIN public.companies company ON company.id=branch.company_id
      WHERE branch.id=delegation_command.branch_id AND branch.company_id=delegation_command.company_id
        AND branch.active AND company.active
      FOR KEY SHARE OF branch,company;
      IF NOT FOUND THEN RAISE EXCEPTION 'The delegated branch is unavailable'; END IF;
    ELSE
      IF department_text IS NULL
        OR department_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR (branch_text IS NOT NULL AND branch_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'A delegated department scope is invalid';
      END IF;
      department_id:=department_text::uuid;
      SELECT department.branch_id
      INTO canonical_branch_id
      FROM public.departments department
      JOIN public.companies company ON company.id=department.company_id
      WHERE department.id=delegation_command.department_id
        AND department.company_id=delegation_command.company_id
        AND department.active AND company.active
      FOR KEY SHARE OF department,company;
      IF NOT FOUND THEN RAISE EXCEPTION 'The delegated department is unavailable'; END IF;
      IF branch_text IS NOT NULL
        AND branch_text::uuid IS DISTINCT FROM canonical_branch_id THEN
        RAISE EXCEPTION 'The delegated department branch is invalid';
      END IF;
      IF canonical_branch_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.branches branch
        WHERE branch.id=delegation_command.canonical_branch_id
          AND branch.company_id=delegation_command.company_id AND branch.active
      ) THEN
        RAISE EXCEPTION 'The delegated department branch is unavailable';
      END IF;
      branch_id:=canonical_branch_id;
    END IF;

    normalized_scopes:=normalized_scopes || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'type',scope_type,
        'companyId',company_id,
        'branchId',branch_id,
        'departmentId',department_id
      ))
    );
  END LOOP;

  SELECT jsonb_agg(item.value ORDER BY
    item.value->>'type',item.value->>'companyId',
    COALESCE(item.value->>'branchId',''),
    COALESCE(item.value->>'departmentId','')
  )
  INTO normalized_scopes
  FROM jsonb_array_elements(normalized_scopes) item(value);
  IF jsonb_array_length(normalized_scopes)<>(
    SELECT count(DISTINCT item.value::text)
    FROM jsonb_array_elements(normalized_scopes) item(value)
  ) THEN
    RAISE EXCEPTION 'Delegated scopes must be unique';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('axora-delegation-command:' || p_command_id::text,0)
  );
  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_grantee_user_id)
  ORDER BY account.id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    JOIN public.users account ON account.id=assignment.user_id
    WHERE assignment.id=p_actor_role_assignment_id
      AND assignment.user_id=p_actor_user_id
      AND assignment.active AND assignment.revoked_at IS NULL
      AND account.active AND account.account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'The delegation authorizer context is no longer active';
  END IF;

  SELECT account.account_kind,account.is_owner,role.role_key,
    assignment.scope_type
  INTO grantee_account_kind,grantee_is_owner,grantee_role_key,
    grantee_scope_type
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.id=p_grantee_role_assignment_id
   AND assignment.user_id=account.id
   AND assignment.active
   AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE account.id=p_grantee_user_id
    AND account.active
    AND account.account_status='ACTIVE';
  IF grantee_account_kind IS NULL THEN
    RAISE EXCEPTION 'The delegation grantee context is no longer active';
  END IF;
  IF grantee_is_owner OR grantee_role_key='PLATFORM_OWNER' THEN
    RAISE EXCEPTION 'Platform-owner authority cannot be delegated';
  END IF;

  SELECT delegation.*
  INTO existing_row
  FROM public.delegated_access delegation
  WHERE delegation.command_id=p_command_id
  FOR UPDATE;
  IF existing_row.id IS NOT NULL THEN
    SELECT array_agg(permission.permission_code ORDER BY permission.permission_code)
    INTO existing_permissions
    FROM public.delegated_access_permissions delegated_permission
    JOIN public.permissions permission
      ON permission.id=delegated_permission.permission_id
    WHERE delegated_permission.delegated_access_id=existing_row.id;
    SELECT jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'type',delegated_scope.scope_type,
        'companyId',delegated_scope.company_id,
        'branchId',delegated_scope.branch_id,
        'departmentId',delegated_scope.department_id
      ))
      ORDER BY delegated_scope.scope_type,delegated_scope.company_id,
        delegated_scope.branch_id,delegated_scope.department_id
    )
    INTO existing_scopes
    FROM public.delegated_access_scopes delegated_scope
    WHERE delegated_scope.delegated_access_id=existing_row.id;

    IF existing_row.authorized_by<>p_actor_user_id
      OR existing_row.authorized_by_role_assignment_id<>p_actor_role_assignment_id
      OR existing_row.grantee_user_id<>p_grantee_user_id
      OR existing_row.grantee_role_assignment_id<>p_grantee_role_assignment_id
      OR existing_row.starts_at<>p_starts_at
      OR existing_row.ends_at<>p_ends_at
      OR existing_row.reason<>clean_reason
      OR existing_permissions IS DISTINCT FROM normalized_permissions
      OR existing_scopes IS DISTINCT FROM normalized_scopes THEN
      RAISE EXCEPTION 'The delegation command identifier conflicts with another request';
    END IF;

    RETURN QUERY SELECT existing_row.id,
      (SELECT account.auth_version::integer
       FROM public.users account WHERE account.id=p_grantee_user_id),
      0,false;
    RETURN;
  END IF;

  IF p_starts_at<now()-interval '15 minutes'
    OR p_starts_at>now()+interval '90 days'
    OR p_ends_at<=now() THEN
    RAISE EXCEPTION 'The delegated access schedule is invalid';
  END IF;
  IF (
    SELECT count(*) FROM public.delegated_access delegation
    WHERE delegation.grantee_user_id=p_grantee_user_id
      AND delegation.status='ACTIVE'
      AND delegation.ends_at>now()
  )>=20 THEN
    RAISE EXCEPTION 'The grantee has reached the active delegation limit';
  END IF;

  IF (
    SELECT count(*) FROM public.permissions permission
    WHERE permission.permission_code=ANY(normalized_permissions)
      AND permission.active AND permission.delegatable
  )<>cardinality(normalized_permissions) THEN
    RAISE EXCEPTION 'One or more permissions cannot be delegated';
  END IF;

  FOR scope_value IN
    SELECT item.value FROM jsonb_array_elements(normalized_scopes) item(value)
  LOOP
    scope_type:=scope_value->>'type';
    company_id:=(scope_value->>'companyId')::uuid;
    branch_id:=NULLIF(scope_value->>'branchId','')::uuid;
    department_id:=NULLIF(scope_value->>'departmentId','')::uuid;

    IF grantee_account_kind='COMPANY' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.company_memberships membership
        WHERE membership.user_id=p_grantee_user_id
          AND membership.company_id=delegation_command.company_id
          AND membership.status='ACTIVE'
      ) THEN
        RAISE EXCEPTION 'A company grantee cannot receive another tenant scope';
      END IF;

      IF grantee_role_key IN (
        'COMPANY_ADMIN','ADMIN','COMPANY_APPROVER',
        'FINANCE_REVIEWER','FINANCE','AUDITOR','VIEWER','RECEIVING_USER'
      ) OR (grantee_role_key='APPROVER' AND grantee_scope_type='COMPANY') THEN
        IF scope_type NOT IN ('COMPANY','BRANCH','DEPARTMENT') THEN
          RAISE EXCEPTION 'The grantee role cannot receive this delegated scope';
        END IF;
      ELSIF grantee_role_key IN ('BRANCH_ADMIN','BRANCH_APPROVER')
        OR (grantee_role_key='APPROVER'
          AND grantee_scope_type IN ('BRANCH','DEPARTMENT')) THEN
        IF scope_type NOT IN ('BRANCH','DEPARTMENT') THEN
          RAISE EXCEPTION 'The grantee role cannot receive this delegated scope';
        END IF;
      ELSIF grantee_role_key='DEPARTMENT_ADMIN' THEN
        IF scope_type<>'DEPARTMENT' THEN
          RAISE EXCEPTION 'The grantee role cannot receive this delegated scope';
        END IF;
      ELSIF grantee_role_key IN ('REQUESTER','OPERATIONS') THEN
        IF scope_type NOT IN ('BRANCH','DEPARTMENT') THEN
          RAISE EXCEPTION 'The grantee role cannot receive this delegated scope';
        END IF;
      ELSE
        RAISE EXCEPTION 'The grantee role cannot receive this delegated scope';
      END IF;
    ELSIF grantee_account_kind='PLATFORM'
      AND grantee_role_key='CLIENT_ACCOUNT_MANAGER' THEN
      IF scope_type<>'COMPANY' THEN
        RAISE EXCEPTION 'A backup account manager can receive company scope only';
      END IF;
    ELSE
      RAISE EXCEPTION 'This account type cannot receive company delegated access';
    END IF;

    IF NOT public.axora_role_assignment_has_direct_permission(
      p_actor_user_id,p_actor_role_assignment_id,'user.permission.manage',
      delegation_command.scope_type,delegation_command.company_id,delegation_command.branch_id,delegation_command.department_id,NULL,now()
    ) THEN
      RAISE EXCEPTION 'The actor cannot manage delegated access in this scope';
    END IF;

    FOREACH permission_code IN ARRAY normalized_permissions
    LOOP
      IF NOT public.axora_role_assignment_has_direct_permission(
        p_actor_user_id,p_actor_role_assignment_id,delegation_command.permission_code,
        delegation_command.scope_type,delegation_command.company_id,delegation_command.branch_id,delegation_command.department_id,NULL,now()
      ) THEN
        RAISE EXCEPTION 'The actor cannot delegate a permission they do not directly possess';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.user_permission_overrides override_row
        JOIN public.permissions permission
          ON permission.id=override_row.permission_id
         AND permission.permission_code=delegation_command.permission_code
        WHERE override_row.user_id=p_grantee_user_id
          AND override_row.effect='DENY'
          AND override_row.active
          AND override_row.starts_at<=now()
          AND (override_row.ends_at IS NULL OR override_row.ends_at>now())
          AND public.axora_scope_contains_nullable(
            override_row.scope_type,override_row.company_id,
            override_row.branch_id,override_row.department_id,
            override_row.supplier_id,
            delegation_command.scope_type,delegation_command.company_id,delegation_command.branch_id,delegation_command.department_id,NULL
          )
      ) THEN
        RAISE EXCEPTION 'The grantee has an explicit denial for a delegated permission';
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.delegated_access(
    grantee_user_id,authorized_by,starts_at,ends_at,status,reason,
    command_id,authorized_by_role_assignment_id,grantee_role_assignment_id
  ) VALUES (
    p_grantee_user_id,p_actor_user_id,p_starts_at,p_ends_at,'ACTIVE',
    clean_reason,p_command_id,p_actor_role_assignment_id,
    p_grantee_role_assignment_id
  ) RETURNING id INTO created_id;

  INSERT INTO public.delegated_access_permissions(
    delegated_access_id,permission_id
  )
  SELECT created_id,permission.id
  FROM public.permissions permission
  WHERE permission.permission_code=ANY(normalized_permissions);

  INSERT INTO public.delegated_access_scopes(
    delegated_access_id,scope_type,company_id,branch_id,department_id
  )
  SELECT
    created_id,item.value->>'type',
    (item.value->>'companyId')::uuid,
    NULLIF(item.value->>'branchId','')::uuid,
    NULLIF(item.value->>'departmentId','')::uuid
  FROM jsonb_array_elements(normalized_scopes) item(value);

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,p_grantee_user_id,NULL,'DELEGATION_CREATED',NULL,
    jsonb_build_object(
      'delegatedAccessId',created_id,
      'commandId',p_command_id,
      'authorizedByRoleAssignmentId',p_actor_role_assignment_id,
      'granteeRoleAssignmentId',p_grantee_role_assignment_id,
      'permissions',to_jsonb(normalized_permissions),
      'scopes',normalized_scopes,
      'startsAt',p_starts_at,
      'endsAt',p_ends_at,
      'status','ACTIVE'
    ),
    clean_reason,p_command_id
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    p_grantee_user_id,p_actor_user_id,
    'Delegated access created: ' || clean_reason
  );
  RETURN QUERY SELECT created_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_revoke_delegated_access(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delegated_access_id uuid,
  p_reason text
)
RETURNS TABLE(
  delegated_access_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  delegation_row public.delegated_access%ROWTYPE;
  scope_row public.delegated_access_scopes%ROWTYPE;
  permissions_value jsonb;
  scopes_value jsonb;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_delegated_access_id IS NULL THEN
    RAISE EXCEPTION 'The delegation revocation context is incomplete';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    JOIN public.users account ON account.id=assignment.user_id
    WHERE assignment.id=p_actor_role_assignment_id
      AND assignment.user_id=p_actor_user_id
      AND assignment.active AND assignment.revoked_at IS NULL
      AND account.active AND account.account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'The delegation revoker context is no longer active';
  END IF;

  SELECT delegation.*
  INTO delegation_row
  FROM public.delegated_access delegation
  WHERE delegation.id=p_delegated_access_id
  FOR UPDATE;
  IF delegation_row.id IS NULL THEN
    RAISE EXCEPTION 'The delegated access is unavailable';
  END IF;

  IF delegation_row.authorized_by<>p_actor_user_id THEN
    FOR scope_row IN
      SELECT delegated_scope.*
      FROM public.delegated_access_scopes delegated_scope
      WHERE delegated_scope.delegated_access_id=delegation_row.id
    LOOP
      IF NOT public.axora_role_assignment_has_direct_permission(
        p_actor_user_id,p_actor_role_assignment_id,'user.permission.manage',
        scope_row.scope_type,scope_row.company_id,scope_row.branch_id,
        scope_row.department_id,scope_row.supplier_id,now()
      ) THEN
        RAISE EXCEPTION 'The actor cannot revoke delegated access in this scope';
      END IF;
    END LOOP;
  END IF;

  IF delegation_row.status<>'ACTIVE' THEN
    RETURN QUERY SELECT delegation_row.id,
      (SELECT account.auth_version::integer
       FROM public.users account
       WHERE account.id=delegation_row.grantee_user_id),
      0,false;
    RETURN;
  END IF;

  SELECT jsonb_agg(permission.permission_code ORDER BY permission.permission_code)
  INTO permissions_value
  FROM public.delegated_access_permissions delegated_permission
  JOIN public.permissions permission
    ON permission.id=delegated_permission.permission_id
  WHERE delegated_permission.delegated_access_id=delegation_row.id;
  SELECT jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'type',delegated_scope.scope_type,
      'companyId',delegated_scope.company_id,
      'branchId',delegated_scope.branch_id,
      'departmentId',delegated_scope.department_id,
      'supplierId',delegated_scope.supplier_id
    ))
    ORDER BY delegated_scope.scope_type,delegated_scope.company_id,
      delegated_scope.branch_id,delegated_scope.department_id,
      delegated_scope.supplier_id
  )
  INTO scopes_value
  FROM public.delegated_access_scopes delegated_scope
  WHERE delegated_scope.delegated_access_id=delegation_row.id;

  UPDATE public.delegated_access delegation
  SET status='REVOKED',revoked_at=now(),revoked_by=p_actor_user_id
  WHERE delegation.id=delegation_row.id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,delegation_row.grantee_user_id,NULL,
    'DELEGATION_REVOKED',
    jsonb_build_object(
      'delegatedAccessId',delegation_row.id,
      'commandId',delegation_row.command_id,
      'authorizedByRoleAssignmentId',
        delegation_row.authorized_by_role_assignment_id,
      'granteeRoleAssignmentId',delegation_row.grantee_role_assignment_id,
      'permissions',COALESCE(permissions_value,'[]'::jsonb),
      'scopes',COALESCE(scopes_value,'[]'::jsonb),
      'startsAt',delegation_row.starts_at,
      'endsAt',delegation_row.ends_at,
      'status',delegation_row.status
    ),
    jsonb_build_object('status','REVOKED','revoked',true),
    clean_reason
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    delegation_row.grantee_user_id,p_actor_user_id,
    'Delegated access revoked: ' || clean_reason
  );
  RETURN QUERY SELECT delegation_row.id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

REVOKE ALL ON FUNCTION public.axora_role_assignment_scope_contains(
  uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_role_assignment_has_direct_permission(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delegation_scope_is_active(
  text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delegation_authority_is_live(
  uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_delegated_access(
  uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_revoke_delegated_access(
  uuid,uuid,uuid,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_effective_access_snapshot(
  uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_role_assignment_scope_contains(
      uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_role_assignment_has_direct_permission(
      uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_delegation_scope_is_active(
      text,uuid,uuid,uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_delegation_authority_is_live(
      uuid,timestamptz
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_create_delegated_access(
      uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_revoke_delegated_access(
      uuid,uuid,uuid,text
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_effective_access_snapshot(
      uuid,uuid,timestamptz
    ) FROM axora_app;

    GRANT EXECUTE ON FUNCTION public.axora_effective_access_snapshot(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_create_delegated_access(
      uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_revoke_delegated_access(
      uuid,uuid,uuid,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
