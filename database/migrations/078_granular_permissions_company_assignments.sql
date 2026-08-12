BEGIN;

-- Granular access keeps role grants as templates while explicit grants/denies
-- and company-manager assignments remain the live authority.
INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES
  ('company.create','Companies','Create companies','Create a customer company and become its accountable manager.',true),
  ('company.view.all','Companies','View all companies','View every company without a manager assignment.',true),
  ('platform_user.view','Platform people','View Axora users','View Axora internal accounts.',true),
  ('platform_user.create','Platform people','Create Axora users','Create Axora internal accounts.',true),
  ('platform_user.invite','Platform people','Invite Axora users','Issue or resend Axora internal invitations.',true),
  ('platform_user.edit','Platform people','Edit Axora users','Edit Axora internal accounts.',true),
  ('platform_user.deactivate','Platform people','Deactivate Axora users','Deactivate or reactivate Axora internal accounts.',true),
  ('platform_user.permission.manage','Platform people','Manage Axora user permissions','Configure Axora internal permissions within delegation authority.',true),
  ('company_user.view','Company people','View company users','View customer-company accounts in assigned scope.',false),
  ('company_user.create','Company people','Create company users','Create customer-company accounts in assigned scope.',true),
  ('company_user.invite','Company people','Invite company users','Issue or resend customer-company invitations.',true),
  ('company_user.edit','Company people','Edit company users','Edit customer-company accounts in assigned scope.',true),
  ('company_user.deactivate','Company people','Deactivate company users','Deactivate or reactivate customer-company accounts.',true),
  ('company_user.permission.manage','Company people','Manage company user permissions','Configure customer-company permissions within delegation authority.',true),
  ('delivery_user.view','Delivery people','View delivery users','View delivery-network accounts.',true),
  ('delivery_user.create','Delivery people','Create delivery users','Create delivery-network accounts.',true),
  ('delivery_user.invite','Delivery people','Invite delivery users','Issue or resend delivery-network invitations.',true),
  ('delivery_user.edit','Delivery people','Edit delivery users','Edit delivery-network accounts.',true),
  ('delivery_user.deactivate','Delivery people','Deactivate delivery users','Deactivate or reactivate delivery-network accounts.',true),
  ('delivery_user.permission.manage','Delivery people','Manage delivery user permissions','Configure delivery-network permissions within delegation authority.',true),
  ('product.manage','Catalogue','Create and edit products','Create and edit product records without financial-reporting authority.',true),
  ('product.archive','Catalogue','Archive products','Activate, deactivate, or archive product records.',true),
  ('category.manage','Catalogue','Manage categories','Manage product category classifications.',true),
  ('analytics.revenue.view','Financial visibility','View revenue','View Axora revenue totals and revenue reports.',true)
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  high_risk=EXCLUDED.high_risk,
  active=true,
  updated_at=now();

-- The retained owner is always the recovery authority for every supported
-- permission. Other defaults preserve existing legitimate work conservatively.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.role_key='PLATFORM_OWNER' AND permission.active
ON CONFLICT DO NOTHING;

WITH defaults(role_key,permission_code) AS (VALUES
  ('PLATFORM_OPERATIONS','product.manage'),
  ('PLATFORM_OPERATIONS','product.archive'),
  ('PLATFORM_OPERATIONS','category.manage'),
  ('PLATFORM_OPERATIONS','commercial.cost.view'),
  ('PLATFORM_OPERATIONS','commercial.pricing.manage'),
  ('CLIENT_ACCOUNT_MANAGER','company.create'),
  ('CLIENT_ACCOUNT_MANAGER','company.view.assigned'),
  ('CLIENT_ACCOUNT_MANAGER','company_user.view'),
  ('CLIENT_ACCOUNT_MANAGER','company_user.create'),
  ('CLIENT_ACCOUNT_MANAGER','company_user.invite'),
  ('CLIENT_ACCOUNT_MANAGER','company_user.edit'),
  ('CLIENT_ACCOUNT_MANAGER','company_user.deactivate'),
  ('COMPANY_ADMIN','company_user.view'),
  ('COMPANY_ADMIN','company_user.create'),
  ('COMPANY_ADMIN','company_user.invite'),
  ('COMPANY_ADMIN','company_user.edit'),
  ('COMPANY_ADMIN','company_user.deactivate'),
  ('COMPANY_ADMIN','company_user.permission.manage'),
  ('BRANCH_ADMIN','company_user.view'),
  ('BRANCH_ADMIN','company_user.create'),
  ('BRANCH_ADMIN','company_user.invite'),
  ('BRANCH_ADMIN','company_user.edit'),
  ('BRANCH_ADMIN','company_user.deactivate'),
  ('BRANCH_ADMIN','company_user.permission.manage'),
  ('DEPARTMENT_ADMIN','company_user.view'),
  ('DEPARTMENT_ADMIN','company_user.create'),
  ('DEPARTMENT_ADMIN','company_user.invite'),
  ('DEPARTMENT_ADMIN','company_user.edit'),
  ('DEPARTMENT_ADMIN','company_user.deactivate'),
  ('DEPARTMENT_ADMIN','company_user.permission.manage'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.view'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.create'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.invite'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.edit'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.deactivate'),
  ('DELIVERY_TEAM_SUPERVISOR','delivery_user.permission.manage')
)
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM defaults
JOIN public.roles role ON role.role_key=defaults.role_key
JOIN public.permissions permission
  ON permission.permission_code=defaults.permission_code AND permission.active
ON CONFLICT DO NOTHING;

-- Preserve the original permission resolution as a narrow internal primitive.
CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission_base(
  p_snapshot jsonb,
  p_permission_code text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE base_scope boolean;
BEGIN
  IF p_snapshot IS NULL OR p_permission_code IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_snapshot->'permissionOverrides','[]'::jsonb)) override_row
    WHERE override_row->>'permission'=p_permission_code
      AND override_row->>'effect'='DENY'
      AND public.axora_scope_contains_nullable(
        override_row->'scope'->>'type',
        NULLIF(override_row->'scope'->>'companyId','')::uuid,
        NULLIF(override_row->'scope'->>'branchId','')::uuid,
        NULLIF(override_row->'scope'->>'departmentId','')::uuid,
        NULLIF(override_row->'scope'->>'supplierId','')::uuid,
        p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
      )
  ) THEN RETURN false; END IF;
  base_scope:=public.axora_snapshot_scope_contains(
    p_snapshot,p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  );
  IF base_scope AND (
    COALESCE(p_snapshot->'rolePermissions','[]'::jsonb) ? p_permission_code
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_snapshot->'permissionOverrides','[]'::jsonb)) override_row
      WHERE override_row->>'permission'=p_permission_code
        AND override_row->>'effect'='GRANT'
        AND public.axora_scope_contains_nullable(
          override_row->'scope'->>'type',
          NULLIF(override_row->'scope'->>'companyId','')::uuid,
          NULLIF(override_row->'scope'->>'branchId','')::uuid,
          NULLIF(override_row->'scope'->>'departmentId','')::uuid,
          NULLIF(override_row->'scope'->>'supplierId','')::uuid,
          p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
        )
    )
  ) THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_snapshot->'delegations','[]'::jsonb)) delegation
    WHERE COALESCE(delegation->'permissions','[]'::jsonb) ? p_permission_code
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(delegation->'scopes','[]'::jsonb)) scope
        WHERE public.axora_scope_contains_nullable(
          scope->>'type',
          NULLIF(scope->>'companyId','')::uuid,
          NULLIF(scope->>'branchId','')::uuid,
          NULLIF(scope->>'departmentId','')::uuid,
          NULLIF(scope->>'supplierId','')::uuid,
          p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
        )
      )
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_scoped_user_permission_code(
  p_permission_code text,p_scope_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_permission_code
    WHEN 'user.view' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.view'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.view'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.view' END
    WHEN 'user.create' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.create'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.create'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.create' END
    WHEN 'user.invite' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.invite'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.invite'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.invite' END
    WHEN 'user.edit' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.edit'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.edit'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.edit' END
    WHEN 'user.deactivate' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.deactivate'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.deactivate'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.deactivate' END
    WHEN 'user.permission.manage' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.permission.manage'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.permission.manage'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.permission.manage' END
    WHEN 'user.manage' THEN CASE
      WHEN p_scope_type='PLATFORM' THEN 'platform_user.permission.manage'
      WHEN p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') THEN 'company_user.permission.manage'
      WHEN p_scope_type='DELIVERY' THEN 'delivery_user.permission.manage' END
    ELSE p_permission_code
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
  p_snapshot jsonb,p_permission_code text,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_supplier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  effective_code text;
  actor_user_id uuid;
BEGIN
  effective_code:=public.axora_scoped_user_permission_code(
    p_permission_code,p_scope_type
  );
  IF effective_code IS NULL OR NOT public.axora_snapshot_has_permission_base(
    p_snapshot,effective_code,p_scope_type,p_company_id,p_branch_id,
    p_department_id,p_supplier_id
  ) THEN RETURN false; END IF;

  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
    AND p_company_id IS NOT NULL
    AND p_snapshot->>'accountKind'='PLATFORM'
    AND NOT public.axora_company_actor_is_owner(p_snapshot) THEN
    IF public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all',p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id
    ) THEN RETURN true; END IF;
    SELECT assignment.user_id INTO actor_user_id
    FROM public.role_assignments assignment
    WHERE assignment.id=NULLIF(p_snapshot->>'roleAssignmentId','')::uuid
      AND assignment.active AND assignment.revoked_at IS NULL;
    RETURN actor_user_id IS NOT NULL
      AND public.axora_company_assignment_allows_permission(
        actor_user_id,p_company_id,effective_code,now()
      );
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF public.axora_company_actor_is_owner(p_snapshot) THEN RETURN true; END IF;
  IF p_snapshot->>'accountKind'='PLATFORM' THEN
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
    ) OR (
      public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
      AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
      )
    );
  END IF;
  IF p_snapshot->>'accountKind'='COMPANY' THEN
    RETURN public.axora_snapshot_scope_contains(
      p_snapshot,'COMPANY',p_company_id,NULL,NULL,NULL
    ) AND public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view','COMPANY',p_company_id,NULL,NULL,NULL
    );
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_has_permission(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,
  p_permission_code text,p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_company_actor_can_view(
    p_snapshot,p_actor_user_id,p_company_id,p_at
  ) AND public.axora_snapshot_has_permission(
    p_snapshot,p_permission_code,'COMPANY',p_company_id,NULL,NULL,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_actor_company_accessible(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_company_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_company_actor_can_view(
    public.axora_live_authorization_snapshot(
      p_actor_user_id,p_actor_role_assignment_id,p_at
    ),
    p_actor_user_id,p_company_id,p_at
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_create(
  p_snapshot jsonb,p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.axora_company_actor_is_owner(p_snapshot)
    OR (
      p_snapshot->>'accountKind'='PLATFORM'
      AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
      )
    )
    OR (
      p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
      AND public.axora_company_snapshot_role_permission(p_snapshot,p_permission_code)
    )
$$;

-- Replace all explicit differences from a role template at one assignment
-- scope. The capability is idempotent, audited, grant-subset constrained, and
-- supports invited users before their first active session exists.
CREATE OR REPLACE FUNCTION public.axora_replace_user_permission_set(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_target_user_id uuid,p_target_role_assignment_id uuid,
  p_selected_permission_codes text[],p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  target_account public.users%ROWTYPE;
  target_assignment public.role_assignments%ROWTYPE;
  selected_codes text[];
  desired_signature jsonb;
  current_signature jsonb;
  invalidation record;
  permission_code text;
  override_count integer:=0;
  revoked_count integer:=0;
  resulting_auth_version integer;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_target_role_assignment_id IS NULL
    OR p_actor_user_id=p_target_user_id
    OR char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR COALESCE(cardinality(p_selected_permission_codes),0)>120 THEN
    RAISE EXCEPTION 'The permission configuration is invalid';
  END IF;
  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id FOR UPDATE;
  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO target_account FROM public.users WHERE id=p_target_user_id;
  SELECT * INTO target_assignment FROM public.role_assignments
  WHERE id=p_target_role_assignment_id AND user_id=p_target_user_id
    AND active AND revoked_at IS NULL FOR UPDATE;
  IF actor_snapshot IS NULL OR target_account.id IS NULL
    OR target_assignment.id IS NULL OR target_account.is_owner THEN
    RAISE EXCEPTION 'The permission configuration is unavailable';
  END IF;
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',target_assignment.scope_type,
    target_assignment.company_id,target_assignment.branch_id,
    target_assignment.department_id,target_assignment.supplier_id
  ) AND NOT (
    target_account.account_setup_completed_at IS NULL
    AND public.axora_snapshot_has_permission(
      actor_snapshot,'user.create',target_assignment.scope_type,
      target_assignment.company_id,target_assignment.branch_id,
      target_assignment.department_id,target_assignment.supplier_id
    )
  ) THEN RAISE EXCEPTION 'The actor cannot manage permissions in this scope'; END IF;

  SELECT COALESCE(array_agg(code ORDER BY code),ARRAY[]::text[])
  INTO selected_codes
  FROM (SELECT DISTINCT btrim(value) AS code
    FROM unnest(COALESCE(p_selected_permission_codes,ARRAY[]::text[])) value
    WHERE btrim(value)<>'') selected;
  IF EXISTS (
    SELECT 1 FROM unnest(selected_codes) code
    LEFT JOIN public.permissions permission
      ON permission.permission_code=code AND permission.active
    WHERE permission.id IS NULL
  ) THEN RAISE EXCEPTION 'A selected permission is unavailable'; END IF;

  IF target_account.account_kind<>'PLATFORM' AND EXISTS (
    SELECT 1 FROM unnest(selected_codes) code
    WHERE code LIKE 'platform_user.%'
      OR code IN (
        'company.create','company.view.all','analytics.platform.view',
        'analytics.revenue.view','commercial.cost.view','commercial.markup.view',
        'commercial.platform_margin.view','commercial.pricing.manage',
        'email.operations.view','email.operations.manage','system.diagnostics.view',
        'supplier.manage','sourcing.manage','catalog.manage','product.manage',
        'product.archive','category.manage'
      )
  ) THEN RAISE EXCEPTION 'Platform authority cannot be assigned to this account'; END IF;
  IF target_account.account_kind='DELIVERY' AND EXISTS (
    SELECT 1 FROM unnest(selected_codes) code
    WHERE code LIKE 'company_user.%' OR code LIKE 'company.%'
  ) THEN RAISE EXCEPTION 'Company authority cannot be assigned to a delivery account'; END IF;

  FOREACH permission_code IN ARRAY selected_codes LOOP
    IF NOT public.axora_snapshot_has_permission(
      actor_snapshot,permission_code,target_assignment.scope_type,
      target_assignment.company_id,target_assignment.branch_id,
      target_assignment.department_id,target_assignment.supplier_id
    ) THEN RAISE EXCEPTION 'The actor cannot grant permission %',permission_code; END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'permission',difference.permission_code,'effect',difference.effect
  ) ORDER BY difference.permission_code),'[]'::jsonb)
  INTO desired_signature
  FROM (
    SELECT permission.permission_code,
      CASE WHEN permission.permission_code=ANY(selected_codes) THEN 'GRANT' ELSE 'DENY' END AS effect
    FROM public.permissions permission
    WHERE permission.active AND (
      (permission.permission_code=ANY(selected_codes) AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions role_permission
        WHERE role_permission.role_id=target_assignment.role_id
          AND role_permission.permission_id=permission.id
      )) OR (
        NOT (permission.permission_code=ANY(selected_codes)) AND EXISTS (
          SELECT 1 FROM public.role_permissions role_permission
          WHERE role_permission.role_id=target_assignment.role_id
            AND role_permission.permission_id=permission.id
        )
      )
    )
  ) difference;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'permission',permission.permission_code,'effect',override_row.effect
  ) ORDER BY permission.permission_code),'[]'::jsonb)
  INTO current_signature
  FROM public.user_permission_overrides override_row
  JOIN public.permissions permission ON permission.id=override_row.permission_id
  WHERE override_row.user_id=p_target_user_id AND override_row.active
    AND override_row.scope_type=target_assignment.scope_type
    AND override_row.company_id IS NOT DISTINCT FROM target_assignment.company_id
    AND override_row.branch_id IS NOT DISTINCT FROM target_assignment.branch_id
    AND override_row.department_id IS NOT DISTINCT FROM target_assignment.department_id
    AND override_row.supplier_id IS NOT DISTINCT FROM target_assignment.supplier_id;
  IF current_signature=desired_signature THEN
    RETURN jsonb_build_object('changed',false,'overrideCount',jsonb_array_length(desired_signature),
      'revokedSessions',0,'authVersion',target_account.auth_version);
  END IF;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason
  )
  SELECT p_actor_user_id,p_target_user_id,override_row.permission_id,
    'PERMISSION_REMOVED',jsonb_build_object('effect',override_row.effect),
    jsonb_build_object('active',false),clean_reason
  FROM public.user_permission_overrides override_row
  WHERE override_row.user_id=p_target_user_id AND override_row.active
    AND override_row.scope_type=target_assignment.scope_type
    AND override_row.company_id IS NOT DISTINCT FROM target_assignment.company_id
    AND override_row.branch_id IS NOT DISTINCT FROM target_assignment.branch_id
    AND override_row.department_id IS NOT DISTINCT FROM target_assignment.department_id
    AND override_row.supplier_id IS NOT DISTINCT FROM target_assignment.supplier_id;
  UPDATE public.user_permission_overrides SET active=false
  WHERE user_id=p_target_user_id AND active
    AND scope_type=target_assignment.scope_type
    AND company_id IS NOT DISTINCT FROM target_assignment.company_id
    AND branch_id IS NOT DISTINCT FROM target_assignment.branch_id
    AND department_id IS NOT DISTINCT FROM target_assignment.department_id
    AND supplier_id IS NOT DISTINCT FROM target_assignment.supplier_id;

  INSERT INTO public.user_permission_overrides(
    user_id,permission_id,effect,scope_type,company_id,branch_id,
    department_id,supplier_id,starts_at,active,reason,changed_by
  )
  SELECT p_target_user_id,permission.id,difference.effect,
    target_assignment.scope_type,target_assignment.company_id,
    target_assignment.branch_id,target_assignment.department_id,
    target_assignment.supplier_id,p_at,true,clean_reason,p_actor_user_id
  FROM jsonb_to_recordset(desired_signature)
    AS difference(permission text,effect text)
  JOIN public.permissions permission
    ON permission.permission_code=difference.permission AND permission.active;
  GET DIAGNOSTICS override_count=ROW_COUNT;
  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason
  )
  SELECT p_actor_user_id,p_target_user_id,permission.id,
    CASE difference.effect WHEN 'GRANT' THEN 'PERMISSION_GRANTED'
      ELSE 'PERMISSION_DENIED' END,
    NULL,jsonb_build_object('effect',difference.effect),clean_reason
  FROM jsonb_to_recordset(desired_signature)
    AS difference(permission text,effect text)
  JOIN public.permissions permission ON permission.permission_code=difference.permission;

  resulting_auth_version:=target_account.auth_version;
  IF target_account.account_setup_completed_at IS NOT NULL THEN
    SELECT * INTO invalidation FROM public.axora_invalidate_authorization_sessions(
      p_target_user_id,p_actor_user_id,'Effective permissions changed: '||clean_reason
    );
    resulting_auth_version:=invalidation.auth_version;
    revoked_count:=invalidation.revoked_sessions;
  END IF;
  RETURN jsonb_build_object('changed',true,'overrideCount',override_count,
    'revokedSessions',revoked_count,'authVersion',resulting_auth_version);
END $$;

-- A non-owner platform creator with explicit company.create authority becomes
-- the primary manager. This deferred trigger runs after onboarding rows exist.
CREATE OR REPLACE FUNCTION public.axora_assign_company_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_assignment_id uuid; actor_snapshot jsonb;
BEGIN
  SELECT assignment.id INTO actor_assignment_id
  FROM public.role_assignments assignment
  JOIN public.users account ON account.id=assignment.user_id
  WHERE assignment.user_id=NEW.created_by
    AND assignment.active AND assignment.revoked_at IS NULL
    AND assignment.scope_type='PLATFORM'
    AND account.active AND account.account_status='ACTIVE'
    AND account.account_kind='PLATFORM' AND NOT account.is_owner
  ORDER BY assignment.assigned_at DESC,assignment.id LIMIT 1;
  IF actor_assignment_id IS NULL THEN RETURN NEW; END IF;
  actor_snapshot:=public.axora_effective_access_snapshot(
    NEW.created_by,actor_assignment_id,clock_timestamp()
  );
  IF NOT public.axora_snapshot_has_permission_base(
    actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NEW; END IF;
  INSERT INTO public.company_assignments(
    company_id,manager_user_id,assignment_type,status,coverage_starts_at,
    assigned_by,assigned_at,assignment_reason
  ) VALUES (
    NEW.id,NEW.created_by,'PRIMARY','ACTIVE',NEW.created_at,
    NEW.created_by,NEW.created_at,'Company assigned to its authorized creator'
  ) ON CONFLICT DO NOTHING;
  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,
    assigned_manager_user_id=NEW.created_by,completed_by=NEW.created_by,
    completed_at=COALESCE(completed_at,clock_timestamp())
  WHERE company_id=NEW.id AND item_code='PRIMARY_MANAGER';
  UPDATE public.company_onboarding_items
  SET assigned_manager_user_id=NEW.created_by
  WHERE company_id=NEW.id AND status IN ('PENDING','FAILED');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS company_creator_primary_assignment ON public.companies;
CREATE CONSTRAINT TRIGGER company_creator_primary_assignment
AFTER INSERT ON public.companies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.axora_assign_company_creator();

-- Buying cost and private supplier identity are redacted inside PostgreSQL.
CREATE OR REPLACE FUNCTION public.axora_product_administration_catalog(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; payload jsonb; can_view_cost boolean; can_view_supplier boolean;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'product.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'Product catalog is unavailable'; END IF;
  can_view_cost:=public.axora_snapshot_has_permission(
    snapshot,'commercial.cost.view','PLATFORM',NULL,NULL,NULL,NULL
  );
  can_view_supplier:=public.axora_snapshot_has_permission(
    snapshot,'supplier.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) OR public.axora_snapshot_has_permission(
    snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
  );
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',product.id::text,'companyId',product.company_id::text,
    'companyName',company.name,'code',product.product_code,'name',product.name,
    'category',product.category,'subcategory',product.subcategory,
    'brand',product.brand,'size',product.product_size,'unit',product.unit_of_measure,
    'packaging',product.packaging,'description',product.description,
    'defaultBuyPrice',CASE WHEN can_view_cost THEN offer.base_cost ELSE 0 END,
    'defaultSellPrice',offer.selling_price,
    'minimumOrderQuantity',offer.minimum_quantity,
    'maximumOrderQuantity',offer.maximum_quantity,'orderIncrement',offer.order_increment,
    'packSize',offer.pack_size,'packUnit',offer.pack_unit,
    'quantityRuleVersion',offer.quantity_rule_version,
    'quantityRuleEffectiveFrom',offer.quantity_rule_effective_from,
    'priceRuleVersion',offer.pricing_rule_version,
    'priceEffectiveFrom',offer.price_effective_from,'priceChangedAt',offer.price_changed_at,
    'priceCurrency',offer.price_currency,'deliverySlaDays',product.delivery_sla_days,
    'preferredSupplierId',CASE WHEN can_view_supplier THEN offer.quantity_supplier_id::text END,
    'preferredSupplierName',CASE WHEN can_view_supplier THEN supplier.name END,
    'hasImage',(product.image_content IS NOT NULL),'imageAltText',product.image_alt_text,
    'status',CASE WHEN product.needs_review THEN 'Needs Review'
      WHEN product.active THEN 'Active' ELSE 'Inactive' END,
    'duplicateWarning',(SELECT count(*)>1 FROM public.products duplicate
      WHERE lower(btrim(duplicate.name))=lower(btrim(product.name)))
  ) ORDER BY product.name),'[]'::jsonb) INTO payload
  FROM public.products product
  LEFT JOIN public.companies company ON company.id=product.company_id
  CROSS JOIN LATERAL public.axora_current_product_offer_internal(product.id,p_at) offer
  LEFT JOIN public.suppliers supplier ON supplier.id=offer.quantity_supplier_id;
  INSERT INTO public.audit_logs(entity_type,record_id,action,actor_id,reason)
  VALUES ('product_catalog',p_actor_user_id,'VIEW',p_actor_user_id,
    CASE WHEN can_view_cost THEN 'Viewed product administration catalog with authorized cost data'
      ELSE 'Viewed product administration catalog with cost data redacted' END);
  RETURN payload;
END $$;

REVOKE ALL ON FUNCTION public.axora_snapshot_has_permission_base(
  jsonb,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_scoped_user_permission_code(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_snapshot_has_permission(
  jsonb,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_replace_user_permission_set(
  uuid,uuid,uuid,uuid,text[],text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_actor_company_accessible(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_assign_company_creator() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_replace_user_permission_set(
      uuid,uuid,uuid,uuid,text[],text,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_actor_company_accessible(
      uuid,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_product_administration_catalog(
      uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
