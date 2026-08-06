BEGIN;

-- P0-01 runtime slice: expose one minimized, live authorization snapshot for
-- the authenticated user and the exact selected role assignment. The
-- application receives policy facts only; no email, phone, password, token,
-- raw network identifier, or other private profile data is returned.

CREATE INDEX IF NOT EXISTS user_scopes_role_reference_idx
  ON public.user_scopes(user_id,source,source_reference,active);

CREATE OR REPLACE FUNCTION public.axora_sync_role_assignment_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  UPDATE public.user_scopes scope
  SET
    active=false,
    ends_at=COALESCE(NEW.revoked_at,now())
  WHERE scope.source='ROLE_ASSIGNMENT'
    AND scope.source_reference=NEW.id
    AND scope.active
    AND (
      NOT NEW.active
      OR scope.scope_type<>NEW.scope_type
      OR scope.company_id IS DISTINCT FROM NEW.company_id
      OR scope.branch_id IS DISTINCT FROM NEW.branch_id
      OR scope.supplier_id IS DISTINCT FROM NEW.supplier_id
    );

  IF NEW.active THEN
    INSERT INTO public.user_scopes(
      user_id,scope_type,company_id,branch_id,supplier_id,
      source,source_reference,starts_at,ends_at,active,assigned_by
    ) VALUES (
      NEW.user_id,NEW.scope_type,NEW.company_id,NEW.branch_id,NEW.supplier_id,
      'ROLE_ASSIGNMENT',NEW.id,NEW.assigned_at,NULL,true,NEW.assigned_by
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_sync_role_assignment_scope()
FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_role_assignment_scope
  ON public.role_assignments;
CREATE TRIGGER sync_role_assignment_scope
AFTER INSERT OR UPDATE OF
  user_id,scope_type,company_id,branch_id,supplier_id,
  active,assigned_at,revoked_at,assigned_by
ON public.role_assignments
FOR EACH ROW
EXECUTE FUNCTION public.axora_sync_role_assignment_scope();

-- Repair any role assignment created after migration 036 but before this
-- synchronization trigger was installed.
INSERT INTO public.user_scopes(
  user_id,scope_type,company_id,branch_id,supplier_id,
  source,source_reference,starts_at,ends_at,active,assigned_by
)
SELECT
  assignment.user_id,assignment.scope_type,assignment.company_id,
  assignment.branch_id,assignment.supplier_id,
  'ROLE_ASSIGNMENT',assignment.id,assignment.assigned_at,
  assignment.revoked_at,assignment.active,assignment.assigned_by
FROM public.role_assignments assignment
ON CONFLICT DO NOTHING;

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
          scope.scope_type,
          scope.company_id,
          scope.branch_id,
          scope.department_id,
          scope.supplier_id,
          scope.id
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
          'effect',override.effect,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',override.scope_type,
            'companyId',override.company_id,
            'branchId',override.branch_id,
            'departmentId',override.department_id,
            'supplierId',override.supplier_id
          )),
          'active',true,
          'startsAt',override.starts_at,
          'endsAt',override.ends_at
        ))
        ORDER BY permission.permission_code,override.effect,override.id
      )
      FROM public.user_permission_overrides override
      JOIN public.permissions permission
        ON permission.id=override.permission_id
       AND permission.active
      WHERE override.user_id=p_user_id
        AND override.active
        AND override.starts_at<=p_at
        AND (override.ends_at IS NULL OR override.ends_at>p_at)
    ),'[]'::jsonb),
    'delegations',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'active',true,
          'startsAt',delegation.starts_at,
          'endsAt',delegation.ends_at,
          'permissions',COALESCE((
            SELECT jsonb_agg(
              permission.permission_code
              ORDER BY permission.permission_code
            )
            FROM public.delegated_access_permissions delegated_permission
            JOIN public.permissions permission
              ON permission.id=delegated_permission.permission_id
             AND permission.active
            WHERE delegated_permission.delegated_access_id=delegation.id
          ),'[]'::jsonb),
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
                scope.scope_type,
                scope.company_id,
                scope.branch_id,
                scope.department_id,
                scope.supplier_id,
                scope.id
            )
            FROM public.delegated_access_scopes scope
            WHERE scope.delegated_access_id=delegation.id
          ),'[]'::jsonb)
        )
        ORDER BY delegation.ends_at,delegation.id
      )
      FROM public.delegated_access delegation
      WHERE delegation.grantee_user_id=p_user_id
        AND delegation.status='ACTIVE'
        AND delegation.starts_at<=p_at
        AND delegation.ends_at>p_at
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

REVOKE ALL ON FUNCTION public.axora_effective_access_snapshot(
  uuid,uuid,timestamptz
)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_effective_access_snapshot(
      uuid,uuid,timestamptz
    ) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_effective_access_snapshot(
      uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
