BEGIN;

-- P0-01 administration read slice: expose one minimized, scope-filtered view
-- of a target user's live authorization. The application cannot read private
-- policy tables directly; this function rechecks both actor and target state.

CREATE OR REPLACE FUNCTION public.axora_access_administration_snapshot(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_target_role_assignment_id uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  target_snapshot jsonb;
  selected_assignment_id uuid;
  selected_role_id uuid;
  selected_scope_type text;
  selected_company_id uuid;
  selected_branch_id uuid;
  selected_department_id uuid;
  selected_supplier_id uuid;
  can_manage boolean;
  can_view_history boolean;
  snapshot jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  -- When no assignment is requested, choose the newest assignment the actor
  -- may actually see. A newer assignment in another tenant must not turn a
  -- valid in-scope user link into either a leak or a false not-found result.
  SELECT
    assignment.id,
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    assignment.department_id,
    assignment.supplier_id
  INTO
    selected_assignment_id,
    selected_role_id,
    selected_scope_type,
    selected_company_id,
    selected_branch_id,
    selected_department_id,
    selected_supplier_id
  FROM public.role_assignments assignment
  JOIN public.users account ON account.id=assignment.user_id
  WHERE assignment.user_id=p_target_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
    AND account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL
    AND (
      p_target_role_assignment_id IS NULL
      OR assignment.id=p_target_role_assignment_id
    )
    AND (
      public.axora_snapshot_has_permission(
        actor_snapshot,'user.view',
        assignment.scope_type,assignment.company_id,
        assignment.branch_id,assignment.department_id,
        assignment.supplier_id
      )
      OR public.axora_snapshot_has_permission(
        actor_snapshot,'user.permission.manage',
        assignment.scope_type,assignment.company_id,
        assignment.branch_id,assignment.department_id,
        assignment.supplier_id
      )
    )
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1;

  IF selected_assignment_id IS NULL THEN
    RETURN NULL;
  END IF;

  target_snapshot:=public.axora_effective_access_snapshot(
    p_target_user_id,selected_assignment_id,p_at
  );
  IF target_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  can_manage:=p_actor_user_id<>p_target_user_id
    AND public.axora_snapshot_has_permission(
      actor_snapshot,'user.permission.manage',
      selected_scope_type,selected_company_id,selected_branch_id,
      selected_department_id,selected_supplier_id
    );
  can_view_history:=public.axora_snapshot_has_permission(
    actor_snapshot,'audit.view',
    selected_scope_type,selected_company_id,selected_branch_id,
    selected_department_id,selected_supplier_id
  );

  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'canManagePermissions',can_manage,
    'canViewHistory',can_view_history,
    'selectedAssignmentId',selected_assignment_id,
    'selectedScope',jsonb_strip_nulls(jsonb_build_object(
      'type',selected_scope_type,
      'companyId',selected_company_id,
      'companyName',(
        SELECT company.name FROM public.companies company
        WHERE company.id=selected_company_id
      ),
      'branchId',selected_branch_id,
      'branchName',(
        SELECT branch.name FROM public.branches branch
        WHERE branch.id=selected_branch_id
      ),
      'departmentId',selected_department_id,
      'departmentName',(
        SELECT department.name FROM public.departments department
        WHERE department.id=selected_department_id
      ),
      'supplierId',selected_supplier_id,
      'supplierName',(
        SELECT supplier.name FROM public.suppliers supplier
        WHERE supplier.id=selected_supplier_id
      )
    )),
    'identity',(
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'id',account.id,
        'displayName',COALESCE(profile.display_name,account.display_name),
        'email',account.email,
        'accountKind',account.account_kind,
        'accountStatus',account.account_status,
        'active',account.active,
        'authVersion',account.auth_version,
        'setupCompleted',account.account_setup_completed_at IS NOT NULL,
        'preferredLocale',profile.preferred_locale,
        'jobTitle',NULLIF(profile.job_title,'')
      ))
      FROM public.users account
      LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
      WHERE account.id=p_target_user_id
    ),
    'assignments',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id',assignment.id,
          'roleKey',role.role_key,
          'roleLabel',role.label,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',assignment.scope_type,
            'companyId',assignment.company_id,
            'companyName',company.name,
            'branchId',assignment.branch_id,
            'branchName',branch.name,
            'departmentId',assignment.department_id,
            'departmentName',department.name,
            'supplierId',assignment.supplier_id,
            'supplierName',supplier.name
          )),
          'assignedAt',assignment.assigned_at,
          'selected',assignment.id=selected_assignment_id,
          'manageable',p_actor_user_id<>p_target_user_id
            AND public.axora_snapshot_has_permission(
              actor_snapshot,'user.permission.manage',
              assignment.scope_type,assignment.company_id,
              assignment.branch_id,assignment.department_id,
              assignment.supplier_id
            )
        ))
        ORDER BY assignment.assigned_at DESC,assignment.id
      )
      FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      LEFT JOIN public.companies company ON company.id=assignment.company_id
      LEFT JOIN public.branches branch ON branch.id=assignment.branch_id
      LEFT JOIN public.departments department
        ON department.id=assignment.department_id
      LEFT JOIN public.suppliers supplier ON supplier.id=assignment.supplier_id
      WHERE assignment.user_id=p_target_user_id
        AND assignment.active AND assignment.revoked_at IS NULL
        AND (
          public.axora_snapshot_has_permission(
            actor_snapshot,'user.view',
            assignment.scope_type,assignment.company_id,
            assignment.branch_id,assignment.department_id,
            assignment.supplier_id
          )
          OR public.axora_snapshot_has_permission(
            actor_snapshot,'user.permission.manage',
            assignment.scope_type,assignment.company_id,
            assignment.branch_id,assignment.department_id,
            assignment.supplier_id
          )
        )
    ),'[]'::jsonb),
    'rolePermissions',COALESCE(target_snapshot->'rolePermissions','[]'::jsonb),
    'scopes',COALESCE(target_snapshot->'scopes','[]'::jsonb),
    'permissionOptions',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'code',permission.permission_code,
          'group',permission.permission_group,
          'label',permission.label,
          'description',permission.description,
          'highRisk',permission.high_risk,
          'actorCanGrant',public.axora_snapshot_has_permission(
            actor_snapshot,permission.permission_code,
            selected_scope_type,selected_company_id,selected_branch_id,
            selected_department_id,selected_supplier_id
          ),
          'targetRoleIncludes',COALESCE(
            target_snapshot->'rolePermissions','[]'::jsonb
          ) ? permission.permission_code,
          'effective',public.axora_snapshot_has_permission(
            target_snapshot,permission.permission_code,
            selected_scope_type,selected_company_id,selected_branch_id,
            selected_department_id,selected_supplier_id
          )
        )
        ORDER BY permission.permission_group,permission.label,
          permission.permission_code
      )
      FROM public.permissions permission
      WHERE permission.active
        AND (
          -- A manager may proactively deny any active permission in scope,
          -- even when anti-escalation rules prohibit granting that permission.
          -- Read-only actors still receive only relevant permission facts.
          can_manage
          OR public.axora_snapshot_has_permission(
            actor_snapshot,permission.permission_code,
            selected_scope_type,selected_company_id,selected_branch_id,
            selected_department_id,selected_supplier_id
          )
          OR COALESCE(target_snapshot->'rolePermissions','[]'::jsonb)
            ? permission.permission_code
          OR public.axora_snapshot_has_permission(
            target_snapshot,permission.permission_code,
            selected_scope_type,selected_company_id,selected_branch_id,
            selected_department_id,selected_supplier_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.user_permission_overrides override_row
            WHERE override_row.user_id=p_target_user_id
              AND override_row.permission_id=permission.id
              AND override_row.active
              AND override_row.starts_at<=p_at
              AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
              AND public.axora_scope_contains_nullable(
                override_row.scope_type,override_row.company_id,
                override_row.branch_id,override_row.department_id,
                override_row.supplier_id,
                selected_scope_type,selected_company_id,selected_branch_id,
                selected_department_id,selected_supplier_id
              )
          )
        )
    ),'[]'::jsonb),
    'permissionOverrides',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id',override_row.id,
          'permission',permission.permission_code,
          'permissionLabel',permission.label,
          'effect',override_row.effect,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',override_row.scope_type,
            'companyId',override_row.company_id,
            'companyName',company.name,
            'branchId',override_row.branch_id,
            'branchName',branch.name,
            'departmentId',override_row.department_id,
            'departmentName',department.name,
            'supplierId',override_row.supplier_id,
            'supplierName',supplier.name
          )),
          'startsAt',override_row.starts_at,
          'endsAt',override_row.ends_at,
          'reason',override_row.reason,
          'changedByName',COALESCE(
            changed_by_profile.display_name,changed_by.display_name
          ),
          'manageable',p_actor_user_id<>p_target_user_id
            AND public.axora_snapshot_has_permission(
              actor_snapshot,'user.permission.manage',
              override_row.scope_type,override_row.company_id,
              override_row.branch_id,override_row.department_id,
              override_row.supplier_id
            )
        ))
        ORDER BY permission.permission_group,permission.label,override_row.id
      )
      FROM public.user_permission_overrides override_row
      JOIN public.permissions permission
        ON permission.id=override_row.permission_id
      JOIN public.users changed_by ON changed_by.id=override_row.changed_by
      LEFT JOIN public.user_profiles changed_by_profile
        ON changed_by_profile.user_id=changed_by.id
      LEFT JOIN public.companies company ON company.id=override_row.company_id
      LEFT JOIN public.branches branch ON branch.id=override_row.branch_id
      LEFT JOIN public.departments department
        ON department.id=override_row.department_id
      LEFT JOIN public.suppliers supplier ON supplier.id=override_row.supplier_id
      WHERE override_row.user_id=p_target_user_id
        AND override_row.active
        AND override_row.starts_at<=p_at
        AND (override_row.ends_at IS NULL OR override_row.ends_at>p_at)
        AND public.axora_scope_contains_nullable(
          override_row.scope_type,override_row.company_id,
          override_row.branch_id,override_row.department_id,
          override_row.supplier_id,
          selected_scope_type,selected_company_id,selected_branch_id,
          selected_department_id,selected_supplier_id
        )
    ),'[]'::jsonb),
    'approvalLimits',COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id',limit_row.id,
          'subjectType',CASE WHEN limit_row.user_id IS NULL
            THEN 'ROLE' ELSE 'USER' END,
          'permission',permission.permission_code,
          'permissionLabel',permission.label,
          'currency',limit_row.currency,
          'maximumAmount',limit_row.maximum_amount::text,
          'allowSelfApproval',limit_row.allow_self_approval,
          'scope',jsonb_strip_nulls(jsonb_build_object(
            'type',limit_row.scope_type,
            'companyId',limit_row.company_id,
            'companyName',company.name,
            'branchId',limit_row.branch_id,
            'branchName',branch.name,
            'departmentId',limit_row.department_id,
            'departmentName',department.name
          )),
          'startsAt',limit_row.starts_at,
          'endsAt',limit_row.ends_at,
          'reason',limit_row.reason
        ))
        ORDER BY permission.label,limit_row.maximum_amount,limit_row.id
      )
      FROM public.approval_limits limit_row
      JOIN public.permissions permission
        ON permission.id=limit_row.permission_id
      LEFT JOIN public.companies company ON company.id=limit_row.company_id
      LEFT JOIN public.branches branch ON branch.id=limit_row.branch_id
      LEFT JOIN public.departments department
        ON department.id=limit_row.department_id
      WHERE limit_row.active
        AND limit_row.starts_at<=p_at
        AND (limit_row.ends_at IS NULL OR limit_row.ends_at>p_at)
        AND (
          limit_row.user_id=p_target_user_id
          OR limit_row.role_id=selected_role_id
        )
        AND public.axora_scope_contains_nullable(
          limit_row.scope_type,limit_row.company_id,
          limit_row.branch_id,limit_row.department_id,NULL,
          selected_scope_type,selected_company_id,selected_branch_id,
          selected_department_id,selected_supplier_id
        )
    ),'[]'::jsonb),
    'delegations',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',delegation.id,
          'status',delegation.status,
          'startsAt',delegation.starts_at,
          'endsAt',delegation.ends_at,
          'reason',delegation.reason,
          'authorizedByName',COALESCE(
            authorizer_profile.display_name,authorizer.display_name
          ),
          'permissions',COALESCE((
            SELECT jsonb_agg(
              permission.permission_code ORDER BY permission.permission_code
            )
            FROM public.delegated_access_permissions delegated_permission
            JOIN public.permissions permission
              ON permission.id=delegated_permission.permission_id
            WHERE delegated_permission.delegated_access_id=delegation.id
          ),'[]'::jsonb),
          'scopes',COALESCE((
            SELECT jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                'type',delegated_scope.scope_type,
                'companyId',delegated_scope.company_id,
                'companyName',company.name,
                'branchId',delegated_scope.branch_id,
                'branchName',branch.name,
                'departmentId',delegated_scope.department_id,
                'departmentName',department.name,
                'supplierId',delegated_scope.supplier_id,
                'supplierName',supplier.name
              ))
              ORDER BY delegated_scope.scope_type,
                delegated_scope.company_id,delegated_scope.branch_id,
                delegated_scope.department_id,delegated_scope.supplier_id
            )
            FROM public.delegated_access_scopes delegated_scope
            LEFT JOIN public.companies company
              ON company.id=delegated_scope.company_id
            LEFT JOIN public.branches branch
              ON branch.id=delegated_scope.branch_id
            LEFT JOIN public.departments department
              ON department.id=delegated_scope.department_id
            LEFT JOIN public.suppliers supplier
              ON supplier.id=delegated_scope.supplier_id
            WHERE delegated_scope.delegated_access_id=delegation.id
          ),'[]'::jsonb)
        )
        ORDER BY delegation.ends_at,delegation.id
      )
      FROM public.delegated_access delegation
      JOIN public.users authorizer ON authorizer.id=delegation.authorized_by
      LEFT JOIN public.user_profiles authorizer_profile
        ON authorizer_profile.user_id=authorizer.id
      WHERE delegation.grantee_user_id=p_target_user_id
        AND delegation.grantee_role_assignment_id=selected_assignment_id
        AND delegation.status='ACTIVE'
        AND delegation.starts_at<=p_at
        AND delegation.ends_at>p_at
        AND public.axora_delegation_authority_is_live(delegation.id,p_at)
    ),'[]'::jsonb),
    'history',CASE WHEN can_view_history THEN COALESCE((
      SELECT jsonb_agg(history_row.payload ORDER BY history_row.occurred_at DESC)
      FROM (
        SELECT
          history.occurred_at,
          jsonb_strip_nulls(jsonb_build_object(
            'id',history.id,
            'changeType',history.change_type,
            'previousValue',history.previous_value,
            'newValue',history.new_value,
            'reason',history.reason,
            'occurredAt',history.occurred_at,
            'actorName',COALESCE(
              actor_profile.display_name,history_actor.display_name
            )
          )) AS payload
        FROM public.permission_change_history history
        JOIN public.users history_actor
          ON history_actor.id=history.actor_user_id
        LEFT JOIN public.user_profiles actor_profile
          ON actor_profile.user_id=history_actor.id
        WHERE (
            history.target_user_id=p_target_user_id
            OR (
              history.target_user_id IS NULL
              AND history.target_role_id=selected_role_id
            )
          )
          AND (
            -- Direct permission, approval-limit, and role events carry a
            -- normalized top-level scope. Include broader or narrower scopes
            -- only when they intersect the selected assignment.
            (
              COALESCE(
                history.new_value->>'scopeType',
                history.previous_value->>'scopeType'
              ) IS NOT NULL
              AND (
                public.axora_scope_contains_nullable(
                  COALESCE(
                    history.new_value->>'scopeType',
                    history.previous_value->>'scopeType'
                  ),
                  NULLIF(COALESCE(
                    history.new_value->>'companyId',
                    history.previous_value->>'companyId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'branchId',
                    history.previous_value->>'branchId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'departmentId',
                    history.previous_value->>'departmentId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'supplierId',
                    history.previous_value->>'supplierId'
                  ),'')::uuid,
                  selected_scope_type,selected_company_id,selected_branch_id,
                  selected_department_id,selected_supplier_id
                )
                OR public.axora_scope_contains_nullable(
                  selected_scope_type,selected_company_id,selected_branch_id,
                  selected_department_id,selected_supplier_id,
                  COALESCE(
                    history.new_value->>'scopeType',
                    history.previous_value->>'scopeType'
                  ),
                  NULLIF(COALESCE(
                    history.new_value->>'companyId',
                    history.previous_value->>'companyId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'branchId',
                    history.previous_value->>'branchId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'departmentId',
                    history.previous_value->>'departmentId'
                  ),'')::uuid,
                  NULLIF(COALESCE(
                    history.new_value->>'supplierId',
                    history.previous_value->>'supplierId'
                  ),'')::uuid
                )
              )
            )
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(
                history.new_value->'scopes',
                history.previous_value->'scopes',
                '[]'::jsonb
              )) history_scope(value)
              WHERE public.axora_scope_contains_nullable(
                history_scope.value->>'type',
                NULLIF(history_scope.value->>'companyId','')::uuid,
                NULLIF(history_scope.value->>'branchId','')::uuid,
                NULLIF(history_scope.value->>'departmentId','')::uuid,
                NULLIF(history_scope.value->>'supplierId','')::uuid,
                selected_scope_type,selected_company_id,selected_branch_id,
                selected_department_id,selected_supplier_id
              )
              OR public.axora_scope_contains_nullable(
                selected_scope_type,selected_company_id,selected_branch_id,
                selected_department_id,selected_supplier_id,
                history_scope.value->>'type',
                NULLIF(history_scope.value->>'companyId','')::uuid,
                NULLIF(history_scope.value->>'branchId','')::uuid,
                NULLIF(history_scope.value->>'departmentId','')::uuid,
                NULLIF(history_scope.value->>'supplierId','')::uuid
              )
            )
          )
        ORDER BY history.occurred_at DESC,history.id DESC
        LIMIT 50
      ) history_row
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO snapshot;

  RETURN snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.axora_access_administration_snapshot(
  uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_access_administration_snapshot(
      uuid,uuid,uuid,uuid,timestamptz
    ) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_access_administration_snapshot(
      uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;