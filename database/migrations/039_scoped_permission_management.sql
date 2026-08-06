BEGIN;

-- P0-01 management slice: explicit user grants and denials are changed only
-- through audited, scope-aware database commands. The application role retains
-- no raw write access to authorization tables.

CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_active_identity_uq
  ON public.user_permission_overrides(
    user_id,permission_id,scope_type,
    COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;

CREATE OR REPLACE FUNCTION public.axora_authorization_scope_contains(
  p_granted_type text,
  p_granted_company_id uuid,
  p_granted_branch_id uuid,
  p_granted_department_id uuid,
  p_granted_supplier_id uuid,
  p_resource_type text,
  p_resource_company_id uuid,
  p_resource_branch_id uuid,
  p_resource_department_id uuid,
  p_resource_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_granted_type
    WHEN 'PLATFORM' THEN true
    WHEN 'COMPANY' THEN p_granted_company_id=p_resource_company_id
    WHEN 'BRANCH' THEN p_granted_company_id=p_resource_company_id
      AND p_granted_branch_id=p_resource_branch_id
    WHEN 'DEPARTMENT' THEN p_granted_company_id=p_resource_company_id
      AND p_granted_department_id=p_resource_department_id
    WHEN 'SUPPLIER' THEN p_granted_supplier_id=p_resource_supplier_id
    WHEN 'DELIVERY' THEN p_resource_type='DELIVERY'
    ELSE false
  END
$$;

-- The STRICT helper above cannot receive nullable scope identifiers. This
-- wrapper preserves nulls while retaining the same containment semantics.
CREATE OR REPLACE FUNCTION public.axora_scope_contains_nullable(
  p_granted_type text,
  p_granted_company_id uuid,
  p_granted_branch_id uuid,
  p_granted_department_id uuid,
  p_granted_supplier_id uuid,
  p_resource_type text,
  p_resource_company_id uuid,
  p_resource_branch_id uuid,
  p_resource_department_id uuid,
  p_resource_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_granted_type
    WHEN 'PLATFORM' THEN true
    WHEN 'COMPANY' THEN p_granted_company_id IS NOT NULL
      AND p_granted_company_id=p_resource_company_id
    WHEN 'BRANCH' THEN p_granted_company_id IS NOT NULL
      AND p_granted_branch_id IS NOT NULL
      AND p_granted_company_id=p_resource_company_id
      AND p_granted_branch_id=p_resource_branch_id
    WHEN 'DEPARTMENT' THEN p_granted_company_id IS NOT NULL
      AND p_granted_department_id IS NOT NULL
      AND p_granted_company_id=p_resource_company_id
      AND p_granted_department_id=p_resource_department_id
    WHEN 'SUPPLIER' THEN p_granted_supplier_id IS NOT NULL
      AND p_granted_supplier_id=p_resource_supplier_id
    WHEN 'DELIVERY' THEN p_resource_type='DELIVERY'
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_snapshot_scope_contains(
  p_snapshot jsonb,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_snapshot->'scopes','[]'::jsonb)) scope
    WHERE public.axora_scope_contains_nullable(
      scope->>'type',
      NULLIF(scope->>'companyId','')::uuid,
      NULLIF(scope->>'branchId','')::uuid,
      NULLIF(scope->>'departmentId','')::uuid,
      NULLIF(scope->>'supplierId','')::uuid,
      p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
    )
  ),false)
$$;

CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
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
DECLARE
  base_scope boolean;
BEGIN
  IF p_snapshot IS NULL OR p_permission_code IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(p_snapshot->'permissionOverrides','[]'::jsonb)
    ) override_row
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
  ) THEN
    RETURN false;
  END IF;

  base_scope := public.axora_snapshot_scope_contains(
    p_snapshot,p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  );

  IF base_scope AND (
    COALESCE(p_snapshot->'rolePermissions','[]'::jsonb)
      ? p_permission_code
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(p_snapshot->'permissionOverrides','[]'::jsonb)
      ) override_row
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
  ) THEN
    RETURN true;
  END IF;

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

CREATE OR REPLACE FUNCTION public.axora_invalidate_authorization_sessions(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
RETURNS TABLE(auth_version integer,revoked_sessions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  new_version integer;
  revoked integer;
BEGIN
  UPDATE public.users
  SET auth_version=auth_version+1
  WHERE id=p_target_user_id
  RETURNING users.auth_version INTO new_version;
  IF new_version IS NULL THEN
    RAISE EXCEPTION 'The target account is unavailable';
  END IF;

  UPDATE public.user_sessions
  SET revoked_at=COALESCE(revoked_at,now()),
      revoked_by=COALESCE(revoked_by,p_actor_user_id),
      revoke_reason=COALESCE(revoke_reason,left(p_reason,240))
  WHERE user_id=p_target_user_id
    AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked=ROW_COUNT;

  RETURN QUERY SELECT new_version,revoked;
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_user_permission_override(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_target_role_assignment_id uuid,
  p_permission_code text,
  p_effect text,
  p_scope_type text,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT now(),
  p_ends_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  override_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  target_snapshot jsonb;
  permission_row public.permissions%ROWTYPE;
  existing_row public.user_permission_overrides%ROWTYPE;
  created_id uuid;
  invalidation record;
  protected_owner boolean;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_target_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The authorization context is incomplete';
  END IF;
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own protected permissions';
  END IF;
  IF p_effect NOT IN ('GRANT','DENY') THEN
    RAISE EXCEPTION 'The permission effect is invalid';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;
  IF p_starts_at IS NULL OR (p_ends_at IS NOT NULL AND p_ends_at<=p_starts_at) THEN
    RAISE EXCEPTION 'The permission effective period is invalid';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id
  FOR UPDATE;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  target_snapshot:=public.axora_effective_access_snapshot(
    p_target_user_id,p_target_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL OR target_snapshot IS NULL THEN
    RAISE EXCEPTION 'The authorization context is no longer active';
  END IF;

  SELECT * INTO permission_row
  FROM public.permissions permission
  WHERE permission.permission_code=p_permission_code
    AND permission.active
  FOR KEY SHARE;
  IF permission_row.id IS NULL THEN
    RAISE EXCEPTION 'The selected permission is unavailable';
  END IF;

  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage permissions in this scope';
  END IF;
  IF NOT public.axora_snapshot_scope_contains(
    target_snapshot,p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The target account is outside the requested scope';
  END IF;
  IF p_effect='GRANT' AND NOT public.axora_snapshot_has_permission(
    actor_snapshot,p_permission_code,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot grant a permission they do not possess';
  END IF;

  protected_owner := target_snapshot->>'roleKey'='PLATFORM_OWNER'
    AND p_permission_code IN (
      'platform.view','user.permission.manage','settings.manage','audit.view'
    );
  IF protected_owner AND p_effect='DENY' THEN
    RAISE EXCEPTION 'Essential platform-owner permissions cannot be denied';
  END IF;

  SELECT override_row.* INTO existing_row
  FROM public.user_permission_overrides override_row
  WHERE override_row.user_id=p_target_user_id
    AND override_row.permission_id=permission_row.id
    AND override_row.scope_type=p_scope_type
    AND override_row.company_id IS NOT DISTINCT FROM p_company_id
    AND override_row.branch_id IS NOT DISTINCT FROM p_branch_id
    AND override_row.department_id IS NOT DISTINCT FROM p_department_id
    AND override_row.supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND override_row.active
  FOR UPDATE;

  IF existing_row.id IS NOT NULL
    AND existing_row.effect=p_effect
    AND existing_row.starts_at=p_starts_at
    AND existing_row.ends_at IS NOT DISTINCT FROM p_ends_at
    AND existing_row.reason=clean_reason THEN
    RETURN QUERY SELECT existing_row.id,
      (target_snapshot->>'authVersion')::integer,0,false;
    RETURN;
  END IF;

  IF existing_row.id IS NOT NULL THEN
    UPDATE public.user_permission_overrides
    SET active=false
    WHERE id=existing_row.id;
  END IF;

  INSERT INTO public.user_permission_overrides(
    user_id,permission_id,effect,scope_type,
    company_id,branch_id,department_id,supplier_id,
    starts_at,ends_at,active,reason,changed_by
  ) VALUES (
    p_target_user_id,permission_row.id,p_effect,p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id,
    p_starts_at,p_ends_at,true,clean_reason,p_actor_user_id
  ) RETURNING id INTO created_id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,p_target_user_id,permission_row.id,
    CASE WHEN p_effect='GRANT'
      THEN 'PERMISSION_GRANTED' ELSE 'PERMISSION_DENIED' END,
    CASE WHEN existing_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'effect',existing_row.effect,
      'scopeType',existing_row.scope_type,
      'companyId',existing_row.company_id,
      'branchId',existing_row.branch_id,
      'departmentId',existing_row.department_id,
      'supplierId',existing_row.supplier_id,
      'startsAt',existing_row.starts_at,
      'endsAt',existing_row.ends_at
    ) END,
    jsonb_strip_nulls(jsonb_build_object(
      'effect',p_effect,
      'scopeType',p_scope_type,
      'companyId',p_company_id,
      'branchId',p_branch_id,
      'departmentId',p_department_id,
      'supplierId',p_supplier_id,
      'startsAt',p_starts_at,
      'endsAt',p_ends_at
    )),
    clean_reason
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    p_target_user_id,p_actor_user_id,'Permission changed: ' || clean_reason
  );
  RETURN QUERY SELECT created_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_remove_user_permission_override(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_override_id uuid,
  p_reason text
)
RETURNS TABLE(
  override_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  existing_row public.user_permission_overrides%ROWTYPE;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  SELECT override_row.*
  INTO existing_row
  FROM public.user_permission_overrides override_row
  WHERE override_row.id=p_override_id
  FOR UPDATE;
  IF existing_row.id IS NULL THEN
    RAISE EXCEPTION 'The permission override is unavailable';
  END IF;
  IF existing_row.user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own protected permissions';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,existing_row.user_id)
  ORDER BY account.id
  FOR UPDATE;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    existing_row.scope_type,existing_row.company_id,existing_row.branch_id,
    existing_row.department_id,existing_row.supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage permissions in this scope';
  END IF;

  IF NOT existing_row.active THEN
    RETURN QUERY SELECT existing_row.id,
      (SELECT auth_version FROM public.users WHERE id=existing_row.user_id),
      0,false;
    RETURN;
  END IF;

  UPDATE public.user_permission_overrides
  SET active=false
  WHERE id=existing_row.id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,permission_id,change_type,
    previous_value,new_value,reason
  ) VALUES (
    p_actor_user_id,existing_row.user_id,existing_row.permission_id,
    'PERMISSION_REMOVED',
    jsonb_strip_nulls(jsonb_build_object(
      'effect',existing_row.effect,
      'scopeType',existing_row.scope_type,
      'companyId',existing_row.company_id,
      'branchId',existing_row.branch_id,
      'departmentId',existing_row.department_id,
      'supplierId',existing_row.supplier_id,
      'startsAt',existing_row.starts_at,
      'endsAt',existing_row.ends_at
    )),
    jsonb_build_object('active',false),
    clean_reason
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    existing_row.user_id,p_actor_user_id,
    'Permission override removed: ' || clean_reason
  );
  RETURN QUERY SELECT existing_row.id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END $$;

REVOKE ALL ON FUNCTION public.axora_authorization_scope_contains(
  text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_scope_contains_nullable(
  text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_snapshot_scope_contains(
  jsonb,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_snapshot_has_permission(
  jsonb,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_invalidate_authorization_sessions(
  uuid,uuid,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_user_permission_override(
  uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
  timestamptz,timestamptz,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_remove_user_permission_override(
  uuid,uuid,uuid,text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_set_user_permission_override(
      uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
      timestamptz,timestamptz,text
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_remove_user_permission_override(
      uuid,uuid,uuid,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
