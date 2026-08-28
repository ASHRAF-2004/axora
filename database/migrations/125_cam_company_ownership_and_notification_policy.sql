BEGIN;

SELECT pg_advisory_xact_lock(12520260828);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- company_assignments is the canonical CAM/company authorization relationship.
-- Provenance is recorded separately from companies.created_by so future Owner
-- assignment and reassignment can retain an accountable history.
ALTER TABLE public.company_assignments
  ADD COLUMN IF NOT EXISTS assignment_source text;

UPDATE public.company_assignments
SET assignment_source='LEGACY'
WHERE assignment_source IS NULL;

ALTER TABLE public.company_assignments
  ALTER COLUMN assignment_source SET DEFAULT 'LEGACY',
  ALTER COLUMN assignment_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_source_allowed'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_source_allowed CHECK (
        assignment_source IN ('CREATED_BY_CAM','OWNER_ASSIGNED','LEGACY')
      );
  END IF;
END $$;

-- Resolve the live actor represented by an authorization snapshot without
-- trusting caller-supplied user identifiers.
CREATE OR REPLACE FUNCTION public.axora_company_snapshot_actor_can_view(
  p_snapshot jsonb,p_company_id uuid,p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_company_actor_is_owner(p_snapshot)
    OR EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.id=NULLIF(p_snapshot->>'roleAssignmentId','')::uuid
        AND assignment.active AND assignment.revoked_at IS NULL
        AND public.axora_company_actor_can_view(
          p_snapshot,assignment.user_id,p_company_id,p_at
        )
    )
$$;

REVOKE ALL ON FUNCTION public.axora_company_snapshot_actor_can_view(
  jsonb,uuid,timestamptz
) FROM PUBLIC;

-- Restore assignment-bound company visibility removed by migration 107.
-- Effective permission, explicit DENY, access mode, retained-company state,
-- and active CAM coverage must all agree. The Platform Owner remains global.
CREATE OR REPLACE FUNCTION public.axora_company_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_snapshot IS NULL OR NOT public.axora_company_is_retained(p_company_id) THEN
    RETURN false;
  END IF;
  IF public.axora_company_actor_is_owner(p_snapshot) THEN RETURN true; END IF;
  IF p_snapshot->>'accountKind'='PLATFORM' THEN
    IF p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
      RETURN public.axora_company_assignment_is_active(
        p_actor_user_id,p_company_id,p_at
      ) AND (
        public.axora_snapshot_has_permission_base(
          p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
        ) OR public.axora_snapshot_has_permission_base(
          p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
        )
      );
    END IF;
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
    ) OR (
      public.axora_company_assignment_is_active(
        p_actor_user_id,p_company_id,p_at
      ) AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
      )
    );
  END IF;
  IF p_snapshot->>'accountKind'='COMPANY' THEN
    RETURN public.axora_company_is_operational(p_company_id)
      AND public.axora_snapshot_scope_contains(
        p_snapshot,'COMPANY',p_company_id,NULL,NULL,NULL
      ) AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view','COMPANY',p_company_id,NULL,NULL,NULL
      );
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
  p_snapshot jsonb,p_permission_code text,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_supplier_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE effective_code text; actor_user_id uuid;
BEGIN
  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
    AND p_company_id IS NOT NULL THEN
    IF NOT public.axora_company_is_retained(p_company_id) THEN RETURN false; END IF;
    IF NOT public.axora_company_is_operational(p_company_id) AND (
      p_snapshot->>'accountKind'<>'PLATFORM'
      OR p_permission_code NOT IN (
        'company.view','company.view.all','company.view.assigned',
        'company.create','company.edit','company.activate','company.suspend',
        'company.portal.preview','company.portal.publish'
      )
    ) THEN RETURN false; END IF;
  END IF;
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
    SELECT assignment.user_id INTO actor_user_id
    FROM public.role_assignments assignment
    WHERE assignment.id=NULLIF(p_snapshot->>'roleAssignmentId','')::uuid
      AND assignment.active AND assignment.revoked_at IS NULL;
    IF p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
      RETURN actor_user_id IS NOT NULL
        AND public.axora_company_assignment_allows_permission(
          actor_user_id,p_company_id,effective_code,now()
        );
    END IF;
    IF public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all',p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id
    ) THEN RETURN true; END IF;
    RETURN actor_user_id IS NOT NULL
      AND public.axora_company_assignment_allows_permission(
        actor_user_id,p_company_id,effective_code,now()
      );
  END IF;
  RETURN true;
END $$;

-- A CAM-created company and its creator ownership row commit together. The
-- live role and effective company.create permission are rechecked by the
-- trigger; Owner-created companies intentionally receive no assignment.
CREATE OR REPLACE FUNCTION public.axora_assign_company_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_assignment_id uuid; actor_snapshot jsonb;
BEGIN
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
  SELECT assignment.id INTO actor_assignment_id
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.users account ON account.id=assignment.user_id
  WHERE assignment.user_id=NEW.created_by
    AND assignment.active AND assignment.revoked_at IS NULL
    AND assignment.scope_type='PLATFORM'
    AND role.role_key='CLIENT_ACCOUNT_MANAGER'
    AND account.active AND account.account_status='ACTIVE'
    AND account.account_kind='PLATFORM' AND NOT account.is_owner
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1;
  IF actor_assignment_id IS NULL THEN RETURN NEW; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    NEW.created_by,actor_assignment_id,NEW.created_at
  );
  IF actor_snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NEW; END IF;
  INSERT INTO public.company_assignments(
    company_id,manager_user_id,assignment_type,status,coverage_starts_at,
    assigned_by,assigned_at,assignment_reason,assignment_source
  ) VALUES (
    NEW.id,NEW.created_by,'PRIMARY','ACTIVE',NEW.created_at,
    NEW.created_by,NEW.created_at,
    'Company assigned atomically to its creating Client Account Manager',
    'CREATED_BY_CAM'
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS company_creator_primary_assignment ON public.companies;
CREATE TRIGGER company_creator_primary_assignment
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_assign_company_creator();

-- Conservative historical backfill: only creation-time CAM role evidence is
-- sufficient. Owner-created and ambiguous companies remain Owner-only.
INSERT INTO public.company_assignments(
  company_id,manager_user_id,assignment_type,status,coverage_starts_at,
  assigned_by,assigned_at,assignment_reason,assignment_source
)
SELECT company.id,company.created_by,'PRIMARY','ACTIVE',company.created_at,
  company.created_by,company.created_at,
  'Reliable historical CAM creation provenance backfill','CREATED_BY_CAM'
FROM public.companies company
JOIN public.users creator ON creator.id=company.created_by
WHERE creator.account_kind='PLATFORM' AND NOT creator.is_owner
  AND EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE assignment.user_id=creator.id
      AND assignment.scope_type='PLATFORM'
      AND role.role_key='CLIENT_ACCOUNT_MANAGER'
      AND assignment.assigned_at<=company.created_at
      AND (assignment.revoked_at IS NULL OR assignment.revoked_at>company.created_at)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.company_assignments existing
    WHERE existing.company_id=company.id
      AND existing.assignment_type='PRIMARY'
      AND existing.status='ACTIVE'
  )
ON CONFLICT DO NOTHING;

UPDATE public.company_assignments assignment
SET assignment_source='CREATED_BY_CAM'
FROM public.companies company
WHERE assignment.company_id=company.id
  AND assignment.manager_user_id=company.created_by
  AND assignment.assignment_source='LEGACY'
  AND EXISTS (
    SELECT 1 FROM public.role_assignments role_assignment
    JOIN public.roles role ON role.id=role_assignment.role_id
    WHERE role_assignment.user_id=company.created_by
      AND role_assignment.scope_type='PLATFORM'
      AND role.role_key='CLIENT_ACCOUNT_MANAGER'
      AND role_assignment.assigned_at<=company.created_at
      AND (role_assignment.revoked_at IS NULL
        OR role_assignment.revoked_at>company.created_at)
  );

-- Existing accountable Owner assignment machinery remains the future manual
-- assignment architecture. Mark its newly-created relationship explicitly.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_manage_company_assignment(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text[],text,text,text[],text,boolean,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    '  ) RETURNING id INTO new_assignment_id;',
    '  ) RETURNING id INTO new_assignment_id;
  UPDATE public.company_assignments
  SET assignment_source=''OWNER_ASSIGNED''
  WHERE id=new_assignment_id;'
  );
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company assignment provenance patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- The workspace advertises global company visibility only to the Owner. CAM
-- rows remain filtered by axora_company_actor_can_view.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=regexp_replace(
    original_definition,
    E'''canViewAll'',public\\.axora_company_actor_is_owner\\(actor_snapshot\\)\\n      OR \\(actor_snapshot->>''roleKey''=''CLIENT_ACCOUNT_MANAGER'' AND \\(\\n        public\\.axora_snapshot_has_permission_base\\(\\n          actor_snapshot,''company\\.view\\.assigned'',''PLATFORM'',NULL,NULL,NULL,NULL\\n        \\) OR public\\.axora_snapshot_has_permission_base\\(\\n          actor_snapshot,''company\\.view\\.all'',''PLATFORM'',NULL,NULL,NULL,NULL\\n        \\)\\n      \\)\\)',
    '''canViewAll'',public.axora_company_actor_is_owner(actor_snapshot)'
  );
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company workspace visibility patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- Initial Company Administrator creation/activation follows the same company
-- assignment boundary as every other company-user operation.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_lock_company_admin_invitation_scope(uuid,uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $old$    OR NOT (
      public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )$old$,
    $new$    OR NOT public.axora_company_actor_can_view(
      actor_snapshot,p_actor_user_id,p_company_id,p_at
    )$new$);
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company Administrator invitation scope patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_sync_company_administrator(uuid,uuid,uuid,text,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $old$    OR NOT (
      public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )$old$,
    $new$    OR NOT public.axora_company_actor_can_view(
      actor_snapshot,p_actor_user_id,p_company_id,p_at
    )$new$);
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company Administrator lifecycle scope patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_initial_company_admin_permission_allowed(
  p_actor_snapshot jsonb,p_target_user_id uuid,p_target_role_id uuid,
  p_scope_type text,p_company_id uuid,p_branch_id uuid,p_department_id uuid,
  p_supplier_id uuid,p_permission_code text DEFAULT NULL
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT p_actor_snapshot IS NOT NULL
    AND p_actor_snapshot->>'accountKind'='PLATFORM'
    AND public.axora_company_snapshot_actor_can_view(
      p_actor_snapshot,p_company_id,now()
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
        AND NOT target_account.is_owner
        AND target_account.company_id=p_company_id
        AND target_role.role_key='COMPANY_ADMIN'
        AND public.axora_company_is_retained(company.id)
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_account_setup_inviter_can_activate(
  p_invitation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users creator ON creator.id=invitation.created_by
      AND creator.active AND creator.account_status='ACTIVE'
      AND creator.account_setup_completed_at IS NOT NULL
    JOIN public.roles intended_role ON intended_role.id=invitation.intended_role_id
    WHERE invitation.id=p_invitation_id
      AND EXISTS (
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
              AND public.axora_company_snapshot_actor_can_view(
                creator_snapshot.value,invitation.company_id,p_at
              )
              AND public.axora_company_snapshot_role_permission(
                creator_snapshot.value,'user.invite'
              )
              AND EXISTS (
                SELECT 1 FROM public.companies company
                WHERE company.id=invitation.company_id
                  AND public.axora_company_is_retained(company.id)
                  AND company.lifecycle_status IN (
                    'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
                    'COMPANY_ADMINISTRATOR_INVITED',
                    'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
                  )
              )
            )
            OR public.axora_snapshot_has_permission(
              creator_snapshot.value,'user.invite',invitation.intended_scope_type,
              invitation.company_id,invitation.intended_branch_id,
              invitation.intended_department_id,invitation.intended_supplier_id
            )
          )
      )
  )
$$;

-- Every company-bound CAM notification (including events without an explicit
-- requiredPermission field) is revalidated against active ownership. This
-- same predicate protects both in-app and workflow-email delivery.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $old$  IF NOT public.axora_workflow_notification_recipient_is_valid_base(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN RETURN false; END IF;
  required_permission:=NULLIF(event_row.metadata->>'requiredPermission','');$old$,
    $new$  IF NOT public.axora_workflow_notification_recipient_is_valid_base(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.users recipient
    JOIN public.role_assignments recipient_assignment
      ON recipient_assignment.user_id=recipient.id
     AND recipient_assignment.active
     AND recipient_assignment.revoked_at IS NULL
    JOIN public.roles recipient_role ON recipient_role.id=recipient_assignment.role_id
    WHERE recipient.id=p_recipient_user_id
      AND recipient.account_kind='PLATFORM'
      AND recipient_role.role_key='CLIENT_ACCOUNT_MANAGER'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.role_assignments recipient_assignment
    JOIN public.roles recipient_role ON recipient_role.id=recipient_assignment.role_id
    WHERE recipient_assignment.user_id=p_recipient_user_id
      AND recipient_assignment.active
      AND recipient_assignment.revoked_at IS NULL
      AND recipient_role.role_key='CLIENT_ACCOUNT_MANAGER'
      AND public.axora_company_actor_can_view(
        public.axora_live_authorization_snapshot(
          recipient_assignment.user_id,recipient_assignment.id,now()
        ),p_recipient_user_id,p_company_id,now()
      )
  ) THEN RETURN false; END IF;
  required_permission:=NULLIF(event_row.metadata->>'requiredPermission','');$new$);
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'CAM notification recipient patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- Routine operational events stay durable in-app and on the Request timeline,
-- but never consume an external email delivery.
CREATE OR REPLACE FUNCTION public.axora_workflow_event_email_allowed(
  p_event_key text
)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(p_event_key,'') NOT IN (
    'company.created',
    'delivery.claimed','delivery.assigned','delivery.assignment_created',
    'delivery.accepted','delivery.shopping_started','delivery.items_acquired',
    'delivery.out_for_delivery','delivery.en_route','delivery.arrived',
    'delivery.partially_delivered','delivery.delivered','delivery.completed',
    'delivery.tracking_started','delivery.tracking_paused','delivery.tracking_resumed'
  )
$$;

REVOKE ALL ON FUNCTION public.axora_workflow_event_email_allowed(text)
FROM PUBLIC;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $old$  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow email source event is invalid';
  END IF;$old$,
    $new$  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow email source event is invalid';
  END IF;
  IF NOT public.axora_workflow_event_email_allowed(p_event_key) THEN
    RETURN NULL;
  END IF;$new$);
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Workflow email policy patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

UPDATE public.notification_event_policies
SET email_mandatory=false
WHERE event_key IN (
  'company.created',
  'delivery.claimed','delivery.assigned','delivery.assignment_created',
  'delivery.accepted','delivery.shopping_started','delivery.items_acquired',
  'delivery.out_for_delivery','delivery.en_route','delivery.arrived',
  'delivery.partially_delivered','delivery.delivered','delivery.completed',
  'delivery.tracking_started','delivery.tracking_paused','delivery.tracking_resumed'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_company_snapshot_actor_can_view(
      jsonb,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_workflow_event_email_allowed(text)
    TO axora_app;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.axora_assign_company_creator() FROM PUBLIC;

COMMENT ON COLUMN public.company_assignments.assignment_source IS
  'Authorization relationship provenance: CAM creation, accountable Owner assignment, or retained legacy history.';
COMMENT ON FUNCTION public.axora_workflow_event_email_allowed(text) IS
  'Final channel policy: routine company-creation and delivery progress remain in-app and are not emailed.';

COMMIT;
