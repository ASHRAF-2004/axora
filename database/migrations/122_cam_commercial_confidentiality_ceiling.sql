BEGIN;

SELECT pg_advisory_xact_lock(12220260827);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Client Account Managers operate on customer-facing lifecycle, request,
-- delivery and invoice records. Historical/custom grants must never turn that
-- role into an Axora sourcing or profitability role.
CREATE OR REPLACE FUNCTION public.axora_role_permission_is_allowed(
  p_role_key text,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT NOT (
    p_role_key='CLIENT_ACCOUNT_MANAGER'
    AND p_permission_code IN (
      'commercial.cost.view',
      'commercial.markup.view',
      'commercial.platform_margin.view',
      'commercial.pricing.manage',
      'supplier.manage',
      'sourcing.manage'
    )
  )
$$;

COMMENT ON FUNCTION public.axora_role_permission_is_allowed(text,text) IS
  'Final role ceiling for confidential Axora commercial and sourcing authority.';

REVOKE ALL ON FUNCTION public.axora_role_permission_is_allowed(text,text)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_role_permission_is_allowed(text,text)
    TO axora_app;
  END IF;
END $$;

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
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE base_scope boolean;
BEGIN
  IF p_snapshot IS NULL OR p_permission_code IS NULL THEN RETURN false; END IF;
  IF NOT public.axora_role_permission_is_allowed(
    p_snapshot->>'roleKey',p_permission_code
  ) THEN RETURN false; END IF;
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

REVOKE ALL ON FUNCTION public.axora_snapshot_has_permission_base(
  jsonb,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_snapshot_has_permission_base(
      jsonb,text,text,uuid,uuid,uuid,uuid
    ) TO axora_app;
  END IF;
END $$;

-- Reject future single-permission grants beyond the target role ceiling.
DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_set_user_permission_override(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    $old$  IF actor_snapshot IS NULL OR target_snapshot IS NULL THEN
    RAISE EXCEPTION 'The authorization context is no longer active';
  END IF;

  SELECT * INTO permission_row$old$,
    $new$  IF actor_snapshot IS NULL OR target_snapshot IS NULL THEN
    RAISE EXCEPTION 'The authorization context is no longer active';
  END IF;
  IF p_effect='GRANT' AND NOT public.axora_role_permission_is_allowed(
    target_snapshot->>'roleKey',p_permission_code
  ) THEN
    RAISE EXCEPTION 'The selected permission exceeds the target role ceiling';
  END IF;

  SELECT * INTO permission_row$new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Permission override role-ceiling patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

-- Reject future permission-set replacements beyond the target role ceiling.
DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    $old$  IF target_account.account_kind<>'PLATFORM' AND EXISTS ($old$,
    $new$  IF EXISTS (
    SELECT 1
    FROM public.roles target_role,unnest(selected_codes) selected_code
    WHERE target_role.id=target_assignment.role_id
      AND NOT public.axora_role_permission_is_allowed(
        target_role.role_key,selected_code
      )
  ) THEN
    RAISE EXCEPTION 'A selected permission exceeds the target role ceiling';
  END IF;

  IF target_account.account_kind<>'PLATFORM' AND EXISTS ($new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Permission-set role-ceiling patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

DO $$
BEGIN
  IF NOT public.axora_role_permission_is_allowed(
    'CLIENT_ACCOUNT_MANAGER','request.view'
  ) OR public.axora_role_permission_is_allowed(
    'CLIENT_ACCOUNT_MANAGER','commercial.cost.view'
  ) OR NOT public.axora_role_permission_is_allowed(
    'PLATFORM_OPERATIONS','commercial.cost.view'
  ) THEN
    RAISE EXCEPTION 'CAM commercial confidentiality ceiling is inconsistent';
  END IF;
END $$;

COMMIT;
