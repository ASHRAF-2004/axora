BEGIN;

SELECT pg_advisory_xact_lock(95217731);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- The simplified operating model introduced canonical Human Resources
-- Management, platform-scoped Client Account Manager and Delivery Guy roles
-- after the original user-creation lock and management matrix were installed.
-- Keep the database capability aligned with the current TypeScript catalogue
-- without adding a broad owner bypass.
INSERT INTO public.role_assignment_management_rules(
  manager_role_id,
  target_role_id,
  scope_type
)
SELECT manager_role.id,target_role.id,rule.scope_type
FROM (VALUES
  ('PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT','PLATFORM'),
  ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','PLATFORM'),
  ('PLATFORM_OWNER','DELIVERY_GUY','DELIVERY')
) AS rule(manager_role_key,target_role_key,scope_type)
JOIN public.roles manager_role
  ON manager_role.role_key=rule.manager_role_key
JOIN public.roles target_role
  ON target_role.role_key=rule.target_role_key
ON CONFLICT(manager_role_id,target_role_id,scope_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.axora_role_scope_contract_is_valid(
  p_account_kind text,
  p_is_owner boolean,
  p_role_key text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role_key='PLATFORM_OWNER' THEN
      p_account_kind='PLATFORM' AND p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key IN (
      'PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
      'HUMAN_RESOURCES_MANAGEMENT'
    ) THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key='CLIENT_ACCOUNT_MANAGER' THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND (
        (
          p_scope_type='PLATFORM'
          AND p_company_id IS NULL AND p_branch_id IS NULL
          AND p_department_id IS NULL AND p_supplier_id IS NULL
        )
        OR (
          p_scope_type='COMPANY' AND p_company_id IS NOT NULL
          AND p_branch_id IS NULL AND p_department_id IS NULL
          AND p_supplier_id IS NULL
        )
      )
    WHEN p_role_key IN ('COMPANY_ADMIN','COMPANY_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
      AND p_branch_id IS NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('BRANCH_ADMIN','BRANCH_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='BRANCH' AND p_company_id IS NOT NULL
      AND p_branch_id IS NOT NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key='DEPARTMENT_ADMIN' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='DEPARTMENT' AND p_company_id IS NOT NULL
      AND p_department_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='REQUESTER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('FINANCE_REVIEWER','AUDITOR','RECEIVING_USER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key='SUPPLIER_USER' THEN
      p_account_kind='SUPPLIER' AND NOT p_is_owner
      AND p_scope_type='SUPPLIER' AND p_supplier_id IS NOT NULL
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL
    WHEN p_role_key IN (
      'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR',
      'DELIVERY_AGENT','DELIVERY_DRIVER'
    ) THEN
      p_account_kind='DELIVERY' AND NOT p_is_owner
      AND p_scope_type='DELIVERY'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL

    -- Retained aliases remain structurally valid for legacy invitation and
    -- bootstrap paths, but audited lifecycle commands accept canonical roles.
    WHEN p_role_key='ADMIN' THEN
      (
        p_account_kind='PLATFORM' AND p_is_owner
        AND p_scope_type='PLATFORM'
        AND p_company_id IS NULL AND p_branch_id IS NULL
        AND p_department_id IS NULL AND p_supplier_id IS NULL
      ) OR (
        p_account_kind='COMPANY' AND NOT p_is_owner
        AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
        AND p_branch_id IS NULL AND p_department_id IS NULL
        AND p_supplier_id IS NULL
      )
    WHEN p_role_key='APPROVER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
    WHEN p_role_key IN ('FINANCE','VIEWER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='OPERATIONS' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='IT_SUPPORT' THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    ELSE false
  END
$$;

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
      'TECHNICAL_SUPPORT','HUMAN_RESOURCES_MANAGEMENT'
    ) THEN 'PLATFORM'
    WHEN p_target_role_key='SUPPLIER_USER' THEN 'SUPPLIER'
    WHEN p_target_role_key IN (
      'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR',
      'DELIVERY_AGENT','DELIVERY_DRIVER'
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

REVOKE ALL ON FUNCTION public.axora_role_scope_contract_is_valid(
  text,boolean,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_lock_user_creation_scope(
  uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

-- Authentication resolves whether a signed-in account is an active delivery
-- identity, and invitation creation initializes a minimal delivery profile.
-- Keep private phone, vehicle and avatar columns inaccessible.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.delivery_agent_profiles FROM axora_app;
    GRANT SELECT (user_id,active),
      INSERT (user_id,agent_code,active),
      UPDATE (active)
    ON TABLE public.delivery_agent_profiles TO axora_app;

    GRANT EXECUTE ON FUNCTION public.axora_lock_user_creation_scope(
      uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;

    IF has_table_privilege(
      'axora_app','public.delivery_agent_profiles','SELECT'
    ) OR has_table_privilege(
      'axora_app','public.delivery_agent_profiles','INSERT'
    ) OR has_table_privilege(
      'axora_app','public.delivery_agent_profiles','UPDATE'
    ) THEN
      RAISE EXCEPTION
        'axora_app must not receive whole-table delivery profile privileges';
    END IF;

    IF NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','user_id','SELECT'
    ) OR NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','active','SELECT'
    ) OR NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','user_id','INSERT'
    ) OR NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','agent_code','INSERT'
    ) OR NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','active','INSERT'
    ) OR NOT has_column_privilege(
      'axora_app','public.delivery_agent_profiles','active','UPDATE'
    ) THEN
      RAISE EXCEPTION
        'axora_app is missing the narrow delivery identity column contract';
    END IF;

    IF has_column_privilege(
      'axora_app','public.delivery_agent_profiles','phone','SELECT'
    ) OR has_column_privilege(
      'axora_app','public.delivery_agent_profiles','vehicle_plate','SELECT'
    ) THEN
      RAISE EXCEPTION
        'axora_app must not receive private delivery profile column access';
    END IF;
  END IF;
END $$;

COMMIT;
