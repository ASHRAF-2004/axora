BEGIN;

SELECT pg_advisory_xact_lock(1104263085);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Resolve the actor assignment from live database state. The browser/session
-- claim is only a hint: canonical Owners may omit it, while every non-Owner
-- must still present the exact live assignment selected by authentication.
CREATE OR REPLACE FUNCTION public.axora_user_creation_actor_assignment(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor public.users%ROWTYPE;
  resolved_assignment_id uuid;
  snapshot jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_auth_version IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT account.* INTO actor
  FROM public.users account
  WHERE account.id=p_actor_user_id
  FOR KEY SHARE OF account;

  IF actor.id IS NULL OR NOT actor.active
    OR actor.account_status<>'ACTIVE'
    OR actor.account_setup_completed_at IS NULL
    OR actor.auth_version IS DISTINCT FROM p_actor_auth_version THEN
    RETURN NULL;
  END IF;

  IF p_claimed_role_assignment_id IS NOT NULL THEN
    snapshot:=public.axora_live_authorization_snapshot(
      p_actor_user_id,p_claimed_role_assignment_id,p_at
    );
    IF snapshot IS NULL
      OR (snapshot->>'authVersion')::integer IS DISTINCT FROM p_actor_auth_version THEN
      RETURN NULL;
    END IF;
    RETURN p_claimed_role_assignment_id;
  END IF;

  IF actor.account_kind<>'PLATFORM' OR NOT actor.is_owner THEN
    RETURN NULL;
  END IF;

  SELECT assignment.id INTO resolved_assignment_id
  FROM public.role_assignments assignment
  JOIN public.roles role
    ON role.id=assignment.role_id
   AND role.role_key='PLATFORM_OWNER'
  WHERE assignment.user_id=p_actor_user_id
    AND assignment.active
    AND assignment.revoked_at IS NULL
    AND assignment.scope_type='PLATFORM'
    AND assignment.company_id IS NULL
    AND assignment.branch_id IS NULL
    AND assignment.department_id IS NULL
    AND assignment.supplier_id IS NULL
  ORDER BY assignment.assigned_at DESC,assignment.id DESC
  LIMIT 1
  FOR KEY SHARE OF assignment;

  IF resolved_assignment_id IS NULL THEN RETURN NULL; END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,resolved_assignment_id,p_at
  );
  IF snapshot IS NULL
    OR NOT public.axora_company_actor_is_owner(snapshot)
    OR (snapshot->>'authVersion')::integer IS DISTINCT FROM p_actor_auth_version THEN
    RETURN NULL;
  END IF;
  RETURN resolved_assignment_id;
END $$;

-- Previous images continue using this signature. Expand only the explicitly
-- approved first-administrator states and allow an authorized platform CAM;
-- explicit DENY remains final through axora_company_snapshot_role_permission.
CREATE OR REPLACE FUNCTION public.axora_lock_company_admin_invitation_scope(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  company_name text;
  company_admin_role_id uuid;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL
    OR actor_snapshot->>'accountKind'<>'PLATFORM'
    OR NOT (
      public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.create'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.invite'
    ) THEN RETURN NULL; END IF;

  SELECT company.name INTO company_name
  FROM public.companies company
  WHERE company.id=p_company_id
    AND public.axora_company_is_retained(company.id)
    AND company.lifecycle_status IN (
      'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
      'COMPANY_ADMINISTRATOR_INVITED'
    )
  FOR KEY SHARE OF company;
  IF company_name IS NULL THEN RETURN NULL; END IF;

  SELECT role.id INTO company_admin_role_id
  FROM public.roles role
  WHERE role.role_key='COMPANY_ADMIN'
  FOR KEY SHARE OF role;
  IF company_admin_role_id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'capturedAt',p_at,'roleId',company_admin_role_id,
    'role','COMPANY_ADMIN','accountKind','COMPANY','isOwner',false,
    'organizationName',company_name,
    'scope',jsonb_build_object('type','COMPANY','companyId',p_company_id)
  );
END $$;

-- Permission customization runs before the first administrator activates the
-- Company. Permit that single initial-account boundary without teaching the
-- general scope evaluator that an inactive Company is an active resource.
CREATE OR REPLACE FUNCTION public.axora_initial_company_admin_permission_allowed(
  p_actor_snapshot jsonb,
  p_target_user_id uuid,
  p_target_role_id uuid,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid,
  p_permission_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT p_actor_snapshot IS NOT NULL
    AND p_actor_snapshot->>'accountKind'='PLATFORM'
    AND (
      public.axora_company_actor_is_owner(p_actor_snapshot)
      OR p_actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
    AND public.axora_company_snapshot_role_permission(
      p_actor_snapshot,'user.create'
    )
    AND public.axora_company_snapshot_role_permission(
      p_actor_snapshot,'user.invite'
    )
    AND (
      p_permission_code IS NULL
      OR public.axora_company_snapshot_role_permission(
        p_actor_snapshot,p_permission_code
      )
    )
    AND p_scope_type='COMPANY'
    AND p_company_id IS NOT NULL
    AND p_branch_id IS NULL
    AND p_department_id IS NULL
    AND p_supplier_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.users target_account
      JOIN public.roles target_role ON target_role.id=p_target_role_id
      JOIN public.companies company ON company.id=p_company_id
      WHERE target_account.id=p_target_user_id
        AND target_account.active
        AND target_account.account_status='INVITED'
        AND target_account.account_kind='COMPANY'
        AND target_account.account_setup_completed_at IS NULL
        AND target_role.role_key='COMPANY_ADMIN'
        AND public.axora_company_is_retained(company.id)
        AND company.lifecycle_status IN (
          'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
          'COMPANY_ADMINISTRATOR_INVITED'
        )
    )
$$;

-- Keep the historical permission-set signature for the rollback window, but
-- add the narrowly-scoped onboarding exception to both capability checks.
DO $permission_set$
DECLARE
  definition text;
  revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(
    definition,
    $old$  ) THEN RAISE EXCEPTION 'The actor cannot manage permissions in this scope'; END IF;$old$,
    $new$  ) AND NOT public.axora_initial_company_admin_permission_allowed(
    actor_snapshot,target_account.id,target_assignment.role_id,
    target_assignment.scope_type,target_assignment.company_id,
    target_assignment.branch_id,target_assignment.department_id,
    target_assignment.supplier_id,NULL
  ) THEN RAISE EXCEPTION 'The actor cannot manage permissions in this scope'; END IF;$new$
  );
  IF revised=definition THEN
    RAISE EXCEPTION 'Permission management authorization source is unavailable';
  END IF;
  definition:=revised;
  revised:=replace(
    definition,
    $old$      ) THEN
      RAISE EXCEPTION 'The actor cannot grant permission %',permission_code;
    END IF;$old$,
    $new$      ) AND NOT public.axora_initial_company_admin_permission_allowed(
      actor_snapshot,target_account.id,target_assignment.role_id,
      target_assignment.scope_type,target_assignment.company_id,
      target_assignment.branch_id,target_assignment.department_id,
      target_assignment.supplier_id,permission_code
    ) THEN
      RAISE EXCEPTION 'The actor cannot grant permission %',permission_code;
    END IF;$new$
  );
  IF revised=definition THEN
    RAISE EXCEPTION 'Permission delegation authorization source is unavailable';
  END IF;
  EXECUTE revised;
END
$permission_set$;

-- Auth-version-bound overloads used by the new image. They resolve a missing
-- Owner assignment from the canonical database row and delegate to the
-- established authorization functions. Non-Owners cannot use the fallback.
CREATE OR REPLACE FUNCTION public.axora_lock_company_admin_invitation_scope(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE resolved_assignment_id uuid;
BEGIN
  resolved_assignment_id:=public.axora_user_creation_actor_assignment(
    p_actor_user_id,p_claimed_role_assignment_id,p_actor_auth_version,p_at
  );
  IF resolved_assignment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.axora_lock_company_admin_invitation_scope(
    p_actor_user_id,resolved_assignment_id,p_company_id,p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_lock_user_creation_scope(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
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
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE resolved_assignment_id uuid;
BEGIN
  resolved_assignment_id:=public.axora_user_creation_actor_assignment(
    p_actor_user_id,p_claimed_role_assignment_id,p_actor_auth_version,p_at
  );
  IF resolved_assignment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.axora_lock_user_creation_scope(
    p_actor_user_id,resolved_assignment_id,p_target_role_key,p_scope_type,
    p_company_id,p_branch_id,p_department_id,p_supplier_id,p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_replace_user_permission_set(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_target_user_id uuid,
  p_target_role_assignment_id uuid,
  p_selected_permission_codes text[],
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE resolved_assignment_id uuid;
BEGIN
  resolved_assignment_id:=public.axora_user_creation_actor_assignment(
    p_actor_user_id,p_claimed_role_assignment_id,p_actor_auth_version,p_at
  );
  IF resolved_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The permission configuration is unavailable';
  END IF;
  RETURN public.axora_replace_user_permission_set(
    p_actor_user_id,resolved_assignment_id,p_target_user_id,
    p_target_role_assignment_id,p_selected_permission_codes,p_reason,p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_account_setup_resend_target(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_target_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE resolved_assignment_id uuid;
BEGIN
  resolved_assignment_id:=public.axora_user_creation_actor_assignment(
    p_actor_user_id,p_claimed_role_assignment_id,p_actor_auth_version,p_at
  );
  IF resolved_assignment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.axora_account_setup_resend_target(
    p_actor_user_id,resolved_assignment_id,p_target_user_id,p_at
  );
END $$;

-- Synchronizing the Company lifecycle happens after the invited account has
-- committed and its delivery outcome has been recorded. Keep the old
-- signature safe for the previous image and accept the same onboarding states
-- and authorized platform actors as the invitation transaction.
CREATE OR REPLACE FUNCTION public.axora_sync_company_administrator(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  current_status text;
  administrator_id uuid;
  administrator_active boolean;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status FROM public.companies
  WHERE id=p_company_id
    AND public.axora_company_is_retained(id)
  FOR UPDATE;
  IF actor_snapshot IS NULL
    OR actor_snapshot->>'accountKind'<>'PLATFORM'
    OR current_status NOT IN (
      'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
      'COMPANY_ADMINISTRATOR_INVITED'
    )
    OR NOT (
      public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.create'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.invite'
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The Company Administrator lifecycle is unavailable';
  END IF;

  SELECT account.id,(account.account_setup_completed_at IS NOT NULL
    AND account.active AND account.account_status='ACTIVE')
  INTO administrator_id,administrator_active
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id AND assignment.company_id=p_company_id
    AND assignment.active AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE role.role_key='COMPANY_ADMIN'
    AND EXISTS (
      SELECT 1 FROM public.account_setup_invitations invitation
      WHERE invitation.user_id=account.id AND invitation.company_id=p_company_id
        AND invitation.revoked_at IS NULL
        AND (invitation.delivery_status='SENT' OR invitation.consumed_at IS NOT NULL)
    )
  ORDER BY account.account_setup_completed_at DESC NULLS LAST,account.created_at
  LIMIT 1;
  IF administrator_id IS NULL THEN
    RAISE EXCEPTION 'A delivered Company Administrator invitation is required';
  END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,
    completed_at=p_at
  WHERE company_id=p_company_id AND item_code='ADMIN_INVITATION';
  IF current_status<>'COMPANY_ADMINISTRATOR_INVITED' THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_INVITED',p_actor_user_id,
      btrim(p_reason),p_at,jsonb_build_object(
        'administratorUserId',administrator_id
      )
    );
  END IF;

  IF administrator_active THEN
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,completed_by=administrator_id,
      completed_at=p_at
    WHERE company_id=p_company_id AND item_code='ADMIN_ACTIVATION';
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_ACTIVATED',p_actor_user_id,
      'Company Administrator completed secure account setup',p_at,
      jsonb_build_object('administratorUserId',administrator_id)
    );
  END IF;

  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,
    CASE WHEN administrator_active THEN 'company.administrator_activated'
      ELSE 'company.administrator_invited' END,true,ARRAY[administrator_id]
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_sync_company_administrator(
  p_actor_user_id uuid,
  p_claimed_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_company_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE resolved_assignment_id uuid;
BEGIN
  resolved_assignment_id:=public.axora_user_creation_actor_assignment(
    p_actor_user_id,p_claimed_role_assignment_id,p_actor_auth_version,p_at
  );
  IF resolved_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The Company Administrator lifecycle is unavailable';
  END IF;
  RETURN public.axora_sync_company_administrator(
    p_actor_user_id,resolved_assignment_id,p_company_id,p_reason,p_at
  );
END $$;

-- The invited Company's canonical assignment and invitation triggers must
-- accept the same onboarding states as the authorization lock.
CREATE OR REPLACE FUNCTION public.axora_role_assignment_target_is_ready(
  p_user_id uuid,
  p_role_id uuid,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  account_row public.users%ROWTYPE;
  role_key text;
  onboarding_company_admin boolean:=false;
  onboarding_client_account_manager boolean:=false;
BEGIN
  SELECT account.* INTO account_row FROM public.users account
  WHERE account.id=p_user_id;
  IF account_row.id IS NULL OR NOT account_row.active
    OR account_row.account_status NOT IN ('ACTIVE','INVITED') THEN
    RETURN false;
  END IF;

  SELECT role.role_key INTO role_key FROM public.roles role
  WHERE role.id=p_role_id;
  onboarding_company_admin:=role_key='COMPANY_ADMIN'
    AND p_scope_type='COMPANY'
    AND p_company_id IS NOT NULL
    AND p_branch_id IS NULL AND p_department_id IS NULL AND p_supplier_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.companies company
      WHERE company.id=p_company_id
        AND company.lifecycle_status IN (
          'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
          'COMPANY_ADMINISTRATOR_INVITED','COMPANY_ADMINISTRATOR_ACTIVATED'
        )
    );
  onboarding_client_account_manager:=role_key='CLIENT_ACCOUNT_MANAGER'
    AND p_scope_type='COMPANY'
    AND p_company_id IS NOT NULL
    AND p_branch_id IS NULL AND p_department_id IS NULL AND p_supplier_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.companies company
      JOIN public.company_assignments assignment
        ON assignment.company_id=company.id
       AND assignment.manager_user_id=p_user_id
       AND assignment.status='ACTIVE'
       AND assignment.coverage_starts_at<=now()
       AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>now())
      WHERE company.id=p_company_id
        AND NOT company.active
        AND company.lifecycle_status='COMPANY_REVIEW'
        AND company.verification_status IN (
          'DRAFT','PENDING_VERIFICATION','CHANGES_REQUESTED','REJECTED'
        )
    );

  IF role_key IS NULL OR NOT public.axora_role_scope_contract_is_valid(
    account_row.account_kind,account_row.is_owner,role_key,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT (
    onboarding_company_admin OR onboarding_client_account_manager
    OR public.axora_role_scope_resource_is_active(
      p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
    )
  ) THEN RETURN false; END IF;

  IF account_row.account_kind='COMPANY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id=p_user_id
        AND membership.company_id=p_company_id
        AND membership.status IN ('ACTIVE','INVITED')
    ) THEN RETURN false; END IF;
    IF p_scope_type='BRANCH' AND NOT EXISTS (
      SELECT 1 FROM public.branch_assignments assignment
      WHERE assignment.user_id=p_user_id
        AND assignment.company_id=p_company_id
        AND assignment.branch_id=p_branch_id
        AND assignment.status='ACTIVE'
    ) THEN RETURN false; END IF;
    IF p_scope_type='DEPARTMENT' AND NOT EXISTS (
      SELECT 1 FROM public.department_assignments assignment
      WHERE assignment.user_id=p_user_id
        AND assignment.company_id=p_company_id
        AND assignment.department_id=p_department_id
        AND assignment.status='ACTIVE'
    ) THEN RETURN false; END IF;
  ELSIF account_row.account_kind='SUPPLIER' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_memberships membership
      WHERE membership.user_id=p_user_id
        AND membership.supplier_id=p_supplier_id
        AND membership.status IN ('ACTIVE','INVITED')
    ) THEN RETURN false; END IF;
  ELSIF account_row.account_kind='DELIVERY'
    AND role_key IN ('DELIVERY_AGENT','DELIVERY_DRIVER') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_agent_profiles profile
      WHERE profile.user_id=p_user_id AND profile.active
    ) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;

-- Preserve the established trigger and activation logic while broadening only
-- the first-administrator lifecycle and CAM checks.
DO $migration$
DECLARE
  definition text;
  revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enforce_account_setup_invitation_scope()'::regprocedure
  ) INTO definition;
  revised:=regexp_replace(
    definition,
    $pattern$'COMPANY_REVIEW'\s*,\s*'COMPANY_ADMINISTRATOR_INVITED'$pattern$,
    $replacement$'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
              'COMPANY_ADMINISTRATOR_INVITED'$replacement$,
    'g'
  );
  IF revised=definition THEN
    RAISE EXCEPTION 'Invitation lifecycle guard source is unavailable';
  END IF;
  definition:=revised;
  revised:=regexp_replace(
    definition,
    $pattern$public\.axora_company_actor_is_owner\(snapshot\.value\)\s+AND NEW\.intended_scope_type='COMPANY'$pattern$,
    $replacement$(public.axora_company_actor_is_owner(snapshot.value)
            OR (
              snapshot.value->>'accountKind'='PLATFORM'
              AND snapshot.value->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
            ))
          AND NEW.intended_scope_type='COMPANY'$replacement$
  );
  IF revised=definition THEN
    RAISE EXCEPTION 'Invitation creator authorization source is unavailable';
  END IF;
  EXECUTE revised;
END
$migration$;

CREATE OR REPLACE FUNCTION public.axora_account_setup_inviter_can_activate(
  p_invitation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users creator ON creator.id=invitation.created_by
      AND creator.active AND creator.account_status='ACTIVE'
      AND creator.account_setup_completed_at IS NOT NULL
    JOIN public.roles intended_role ON intended_role.id=invitation.intended_role_id
    WHERE invitation.id=p_invitation_id AND (
      EXISTS (
        SELECT 1
        FROM public.role_assignments creator_assignment
        CROSS JOIN LATERAL (
          SELECT public.axora_live_authorization_snapshot(
            creator.id,creator_assignment.id,p_at
          ) AS value
        ) creator_snapshot
        WHERE creator_assignment.user_id=creator.id
          AND creator_assignment.active
          AND creator_assignment.revoked_at IS NULL
          AND creator_snapshot.value IS NOT NULL
          AND (
            (
              intended_role.role_key='COMPANY_ADMIN'
              AND invitation.company_id IS NOT NULL
              AND creator_snapshot.value->>'accountKind'='PLATFORM'
              AND (
                public.axora_company_actor_is_owner(creator_snapshot.value)
                OR creator_snapshot.value->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
              )
              AND EXISTS (
                SELECT 1 FROM public.companies company
                WHERE company.id=invitation.company_id
                  AND public.axora_company_is_retained(company.id)
                  AND company.lifecycle_status IN (
                    'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
                    'COMPANY_ADMINISTRATOR_INVITED',
                    'COMPANY_ADMINISTRATOR_ACTIVATED'
                  )
              )
              AND public.axora_company_snapshot_role_permission(
                creator_snapshot.value,'user.invite'
              )
            )
            OR public.axora_snapshot_has_permission(
              creator_snapshot.value,'user.invite',invitation.intended_scope_type,
              invitation.company_id,invitation.intended_branch_id,
              invitation.intended_department_id,invitation.intended_supplier_id
            )
          )
      )
      OR (
        intended_role.role_key='COMPANY_ADMIN'
        AND invitation.company_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.company_assignments company_assignment
          JOIN public.role_assignments creator_assignment
            ON creator_assignment.user_id=creator.id AND creator_assignment.active
            AND creator_assignment.revoked_at IS NULL
          JOIN public.roles creator_role ON creator_role.id=creator_assignment.role_id
            AND creator_role.role_key='CLIENT_ACCOUNT_MANAGER'
          WHERE company_assignment.company_id=invitation.company_id
            AND company_assignment.manager_user_id=creator.id
            AND company_assignment.status='ACTIVE'
            AND company_assignment.coverage_starts_at<=p_at
            AND (company_assignment.coverage_ends_at IS NULL
              OR company_assignment.coverage_ends_at>p_at)
        )
      )
    )
  )
$$;

REVOKE ALL ON FUNCTION public.axora_user_creation_actor_assignment(
  uuid,uuid,integer,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_initial_company_admin_permission_allowed(
  jsonb,uuid,uuid,text,uuid,uuid,uuid,uuid,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_lock_company_admin_invitation_scope(
  uuid,uuid,integer,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_lock_user_creation_scope(
  uuid,uuid,integer,text,text,uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_replace_user_permission_set(
  uuid,uuid,integer,uuid,uuid,text[],text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_account_setup_resend_target(
  uuid,uuid,integer,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_sync_company_administrator(
  uuid,uuid,integer,uuid,text,timestamptz
) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_lock_company_admin_invitation_scope(
      uuid,uuid,integer,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_lock_user_creation_scope(
      uuid,uuid,integer,text,text,uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_replace_user_permission_set(
      uuid,uuid,integer,uuid,uuid,text[],text,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_account_setup_resend_target(
      uuid,uuid,integer,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_sync_company_administrator(
      uuid,uuid,integer,uuid,text,timestamptz
    ) TO axora_app;
  END IF;
END
$grants$;

COMMENT ON FUNCTION public.axora_user_creation_actor_assignment(
  uuid,uuid,integer,timestamptz
) IS
  'Resolves the live, auth-version-bound user-creation actor assignment; only a canonical active Platform Owner may omit the session assignment claim.';
COMMENT ON FUNCTION public.axora_lock_company_admin_invitation_scope(
  uuid,uuid,integer,uuid,timestamptz
) IS
  'Locks first Company Administrator invitation scope using live actor identity, auth version, explicit DENY, and retained onboarding-company lifecycle checks.';

COMMIT;
