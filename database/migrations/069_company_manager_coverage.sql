BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS service_region_code text;

UPDATE public.companies
SET service_region_code='GLOBAL'
WHERE service_region_code IS NULL;

ALTER TABLE public.companies
  ALTER COLUMN service_region_code SET DEFAULT 'GLOBAL',
  ALTER COLUMN service_region_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='companies_service_region_code_format'
      AND conrelid='public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_service_region_code_format CHECK (
        service_region_code ~ '^[A-Z][A-Z0-9_-]{1,39}$'
      );
  END IF;
END $$;

ALTER TABLE public.company_assignments
  ADD COLUMN IF NOT EXISTS access_mode text,
  ADD COLUMN IF NOT EXISTS specific_permission_codes text[],
  ADD COLUMN IF NOT EXISTS document_visibility text,
  ADD COLUMN IF NOT EXISTS handover_notes text,
  ADD COLUMN IF NOT EXISTS handover_checklist jsonb,
  ADD COLUMN IF NOT EXISTS predecessor_assignment_id uuid
    REFERENCES public.company_assignments(id) ON DELETE RESTRICT;

UPDATE public.company_assignments
SET access_mode=CASE WHEN assignment_type='BACKUP' THEN 'TEMPORARY' ELSE 'NORMAL' END
WHERE access_mode IS NULL;

UPDATE public.company_assignments
SET specific_permission_codes=ARRAY[]::text[]
WHERE specific_permission_codes IS NULL;

UPDATE public.company_assignments
SET document_visibility='STANDARD'
WHERE document_visibility IS NULL;

UPDATE public.company_assignments
SET handover_checklist='[]'::jsonb
WHERE handover_checklist IS NULL;

ALTER TABLE public.company_assignments
  ALTER COLUMN access_mode SET DEFAULT 'NORMAL',
  ALTER COLUMN access_mode SET NOT NULL,
  ALTER COLUMN specific_permission_codes SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN specific_permission_codes SET NOT NULL,
  ALTER COLUMN document_visibility SET DEFAULT 'STANDARD',
  ALTER COLUMN document_visibility SET NOT NULL,
  ALTER COLUMN handover_checklist SET DEFAULT '[]'::jsonb,
  ALTER COLUMN handover_checklist SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_access_mode_allowed'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_access_mode_allowed CHECK (
        access_mode IN ('NORMAL','TEMPORARY','READ_ONLY','SPECIFIC_PERMISSIONS')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_specific_permissions_valid'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_specific_permissions_valid CHECK (
        (access_mode='SPECIFIC_PERMISSIONS' AND cardinality(specific_permission_codes)>0)
        OR (access_mode<>'SPECIFIC_PERMISSIONS' AND cardinality(specific_permission_codes)=0)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_document_visibility_allowed'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_document_visibility_allowed CHECK (
        document_visibility IN ('STANDARD','COMPANY_SHARED_ONLY','NONE')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_handover_notes_length'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_handover_notes_length CHECK (
        char_length(btrim(COALESCE(handover_notes,'')))<=5000
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='company_assignments_handover_checklist_array'
      AND conrelid='public.company_assignments'::regclass
  ) THEN
    ALTER TABLE public.company_assignments
      ADD CONSTRAINT company_assignments_handover_checklist_array CHECK (
        jsonb_typeof(handover_checklist)='array'
        AND jsonb_array_length(handover_checklist)<=20
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.company_manager_profiles (
  manager_user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  service_region_code text NOT NULL DEFAULT 'GLOBAL' CHECK (
    service_region_code ~ '^[A-Z][A-Z0-9_-]{1,39}$'
  ),
  max_primary_companies integer NOT NULL DEFAULT 25 CHECK (
    max_primary_companies BETWEEN 1 AND 500
  ),
  availability_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (
    availability_status IN ('AVAILABLE','LIMITED','UNAVAILABLE')
  ),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.company_manager_profiles(manager_user_id)
SELECT DISTINCT manager.id
FROM public.users manager
JOIN public.role_assignments assignment ON assignment.user_id=manager.id
JOIN public.roles role ON role.id=assignment.role_id
WHERE manager.account_kind='PLATFORM'
  AND role.role_key='CLIENT_ACCOUNT_MANAGER'
ON CONFLICT (manager_user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_manager_continuity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'ASSIGNED','REASSIGNED','BACKUP_CONFIGURED','BACKUP_REPLACED',
    'AUTO_FAILOVER','COVERAGE_GAP'
  )),
  assignment_id uuid REFERENCES public.company_assignments(id) ON DELETE RESTRICT,
  former_manager_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  new_manager_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  accountable_owner_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  transfer_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(transfer_summary)='object'
  ),
  notification_recipient_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_manager_continuity_company_idx
  ON public.company_manager_continuity_events(company_id,occurred_at DESC,id);
CREATE INDEX IF NOT EXISTS company_assignments_manager_workload_idx
  ON public.company_assignments(manager_user_id,assignment_type,status,coverage_starts_at,coverage_ends_at);

ALTER TABLE public.company_manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_manager_continuity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_manager_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.company_manager_continuity_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.company_manager_profiles FROM axora_app';
    EXECUTE 'REVOKE ALL ON TABLE public.company_manager_continuity_events FROM axora_app';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_company_manager_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Company manager continuity events are append-only';
END $$;

DROP TRIGGER IF EXISTS company_manager_continuity_append_only
  ON public.company_manager_continuity_events;
CREATE TRIGGER company_manager_continuity_append_only
BEFORE UPDATE OR DELETE ON public.company_manager_continuity_events
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_company_manager_event_mutation();

CREATE OR REPLACE FUNCTION public.axora_company_assignment_allows_permission(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_code text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_assignments assignment
    WHERE assignment.manager_user_id=p_actor_user_id
      AND assignment.company_id=p_company_id
      AND assignment.status='ACTIVE'
      AND assignment.coverage_starts_at<=p_at
      AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>p_at)
      AND CASE assignment.access_mode
        WHEN 'NORMAL' THEN true
        WHEN 'TEMPORARY' THEN true
        WHEN 'READ_ONLY' THEN p_permission_code LIKE '%.view'
          OR p_permission_code IN ('dashboard.view','company.view.assigned')
        WHEN 'SPECIFIC_PERMISSIONS' THEN p_permission_code=ANY(assignment.specific_permission_codes)
        ELSE false
      END
      AND NOT (
        p_permission_code='document.view'
        AND assignment.document_visibility='NONE'
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_has_permission(
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_code text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF public.axora_company_actor_is_owner(p_snapshot) THEN
    RETURN public.axora_snapshot_has_permission(
      p_snapshot,p_permission_code,'COMPANY',p_company_id,NULL,NULL,NULL
    );
  END IF;

  IF p_snapshot->>'accountKind'='PLATFORM'
    AND p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    AND public.axora_company_assignment_allows_permission(
      p_actor_user_id,p_company_id,p_permission_code,p_at
    ) THEN
    RETURN public.axora_company_snapshot_role_permission(
      p_snapshot,p_permission_code
    );
  END IF;

  RETURN public.axora_company_actor_can_view(
      p_snapshot,p_actor_user_id,p_company_id,p_at
    ) AND public.axora_snapshot_has_permission(
      p_snapshot,p_permission_code,'COMPANY',p_company_id,NULL,NULL,NULL
    );
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_manager_is_eligible(
  p_manager_user_id uuid,
  p_company_id uuid,
  p_assignment_type text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users manager
    JOIN public.companies company ON company.id=p_company_id
    LEFT JOIN public.company_manager_profiles profile
      ON profile.manager_user_id=manager.id
    WHERE manager.id=p_manager_user_id
      AND manager.active
      AND manager.account_status='ACTIVE'
      AND manager.account_kind='PLATFORM'
      AND manager.account_setup_completed_at IS NOT NULL
      AND COALESCE(profile.availability_status,'AVAILABLE')<>'UNAVAILABLE'
      AND (
        company.service_region_code='GLOBAL'
        OR COALESCE(profile.service_region_code,'GLOBAL')='GLOBAL'
        OR profile.service_region_code=company.service_region_code
      )
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments role_assignment
        JOIN public.roles role ON role.id=role_assignment.role_id
        WHERE role_assignment.user_id=manager.id
          AND role_assignment.active
          AND role_assignment.revoked_at IS NULL
          AND role.role_key='CLIENT_ACCOUNT_MANAGER'
      )
      AND (
        p_assignment_type<>'PRIMARY'
        OR (
          SELECT count(*)
          FROM public.company_assignments workload
          WHERE workload.manager_user_id=manager.id
            AND workload.assignment_type='PRIMARY'
            AND workload.status='ACTIVE'
            AND workload.coverage_starts_at<=p_at
            AND (workload.coverage_ends_at IS NULL OR workload.coverage_ends_at>p_at)
            AND workload.company_id<>p_company_id
        )<COALESCE(profile.max_primary_companies,25)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_transfer_company_manager_work(
  p_company_id uuid,
  p_from_manager_user_id uuid,
  p_to_manager_user_id uuid,
  p_actor_user_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  onboarding_count integer:=0;
  reminder_count integer:=0;
  reminder_cancelled_count integer:=0;
  lead_task_count integer:=0;
BEGIN
  IF p_to_manager_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'onboardingItems',0,'reminders',0,'cancelledDuplicateReminders',0,'leadTasks',0
    );
  END IF;

  UPDATE public.company_onboarding_items item
  SET assigned_manager_user_id=p_to_manager_user_id
  WHERE item.company_id=p_company_id
    AND item.status IN ('PENDING','FAILED')
    AND (p_from_manager_user_id IS NULL
      OR item.assigned_manager_user_id=p_from_manager_user_id
      OR item.assigned_manager_user_id IS NULL);
  GET DIAGNOSTICS onboarding_count=ROW_COUNT;

  IF p_from_manager_user_id IS NOT NULL
    AND p_from_manager_user_id<>p_to_manager_user_id THEN
    UPDATE public.company_onboarding_reminders reminder
    SET status='CANCELLED'
    WHERE reminder.company_id=p_company_id
      AND reminder.status='PENDING'
      AND reminder.recipient_user_id=p_from_manager_user_id
      AND EXISTS (
        SELECT 1 FROM public.company_onboarding_reminders replacement
        WHERE replacement.company_id=reminder.company_id
          AND replacement.onboarding_item_id=reminder.onboarding_item_id
          AND replacement.recipient_user_id=p_to_manager_user_id
          AND replacement.status='PENDING'
      );
    GET DIAGNOSTICS reminder_cancelled_count=ROW_COUNT;
  END IF;

  UPDATE public.company_onboarding_reminders reminder
  SET recipient_user_id=p_to_manager_user_id
  WHERE reminder.company_id=p_company_id
    AND reminder.status='PENDING'
    AND (p_from_manager_user_id IS NULL
      OR reminder.recipient_user_id=p_from_manager_user_id);
  GET DIAGNOSTICS reminder_count=ROW_COUNT;

  UPDATE public.company_lead_tasks task
  SET assigned_user_id=p_to_manager_user_id
  FROM public.company_leads lead
  WHERE lead.id=task.lead_id
    AND lead.converted_company_id=p_company_id
    AND task.status='OPEN'
    AND (p_from_manager_user_id IS NULL
      OR task.assigned_user_id=p_from_manager_user_id);
  GET DIAGNOSTICS lead_task_count=ROW_COUNT;

  RETURN jsonb_build_object(
    'onboardingItems',onboarding_count,
    'reminders',reminder_count,
    'cancelledDuplicateReminders',reminder_cancelled_count,
    'leadTasks',lead_task_count,
    'transferredAt',p_at,
    'transferredBy',p_actor_user_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_manager_coverage_record(
  p_company_id uuid,
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  can_view_private boolean;
BEGIN
  can_view_private:=public.axora_company_actor_is_owner(p_snapshot)
    OR (
      p_snapshot->>'accountKind'='PLATFORM'
      AND p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
      AND public.axora_company_assignment_is_active(
        p_actor_user_id,p_company_id,p_at
      )
    );

  RETURN jsonb_build_object(
    'serviceRegionCode',(
      SELECT company.service_region_code
      FROM public.companies company WHERE company.id=p_company_id
    ),
    'primaryManager',(
      SELECT jsonb_build_object(
        'assignmentId',assignment.id,
        'id',manager.id,'name',manager.display_name,'email',manager.email,
        'assignedAt',assignment.assigned_at,
        'coverageStartsAt',assignment.coverage_starts_at,
        'coverageEndsAt',assignment.coverage_ends_at,
        'accessMode',assignment.access_mode,
        'specificPermissionCodes',to_jsonb(assignment.specific_permission_codes),
        'documentVisibility',assignment.document_visibility,
        'coverageReason',assignment.assignment_reason,
        'assignedByName',assigner.display_name,
        'handoverNotes',CASE WHEN can_view_private THEN assignment.handover_notes END,
        'handoverChecklist',CASE WHEN can_view_private
          THEN assignment.handover_checklist ELSE '[]'::jsonb END
      )
      FROM public.company_assignments assignment
      JOIN public.users manager ON manager.id=assignment.manager_user_id
      JOIN public.users assigner ON assigner.id=assignment.assigned_by
      WHERE assignment.company_id=p_company_id
        AND assignment.assignment_type='PRIMARY'
        AND assignment.status='ACTIVE'
      LIMIT 1
    ),
    'backupManager',(
      SELECT jsonb_build_object(
        'assignmentId',assignment.id,
        'id',manager.id,'name',manager.display_name,'email',manager.email,
        'assignedAt',assignment.assigned_at,
        'coverageStartsAt',assignment.coverage_starts_at,
        'coverageEndsAt',assignment.coverage_ends_at,
        'accessMode',assignment.access_mode,
        'specificPermissionCodes',to_jsonb(assignment.specific_permission_codes),
        'documentVisibility',assignment.document_visibility,
        'coverageReason',assignment.assignment_reason,
        'assignedByName',assigner.display_name,
        'handoverNotes',CASE WHEN can_view_private THEN assignment.handover_notes END,
        'handoverChecklist',CASE WHEN can_view_private
          THEN assignment.handover_checklist ELSE '[]'::jsonb END
      )
      FROM public.company_assignments assignment
      JOIN public.users manager ON manager.id=assignment.manager_user_id
      JOIN public.users assigner ON assigner.id=assignment.assigned_by
      WHERE assignment.company_id=p_company_id
        AND assignment.assignment_type='BACKUP'
        AND assignment.status='ACTIVE'
      LIMIT 1
    ),
    'assignmentHistory',CASE WHEN can_view_private THEN COALESCE((
      SELECT jsonb_agg(history.entry ORDER BY history.assigned_at DESC,history.id DESC)
      FROM (
        SELECT assignment.id,assignment.assigned_at,jsonb_build_object(
          'assignmentId',assignment.id,
          'managerId',manager.id,'managerName',manager.display_name,
          'assignmentType',assignment.assignment_type,'status',assignment.status,
          'accessMode',assignment.access_mode,
          'specificPermissionCodes',to_jsonb(assignment.specific_permission_codes),
          'documentVisibility',assignment.document_visibility,
          'coverageStartsAt',assignment.coverage_starts_at,
          'coverageEndsAt',assignment.coverage_ends_at,
          'coverageReason',assignment.assignment_reason,
          'assignedByName',assigner.display_name,'assignedAt',assignment.assigned_at,
          'endedByName',ender.display_name,'endedAt',assignment.ended_at,
          'endReason',assignment.end_reason,
          'handoverNotes',assignment.handover_notes,
          'handoverChecklist',assignment.handover_checklist
        ) AS entry
        FROM public.company_assignments assignment
        JOIN public.users manager ON manager.id=assignment.manager_user_id
        JOIN public.users assigner ON assigner.id=assignment.assigned_by
        LEFT JOIN public.users ender ON ender.id=assignment.ended_by
        WHERE assignment.company_id=p_company_id
        ORDER BY assignment.assigned_at DESC,assignment.id DESC
        LIMIT 20
      ) history
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'openManagerWork',CASE WHEN can_view_private THEN jsonb_build_object(
      'onboardingItems',(
        SELECT count(*)::integer FROM public.company_onboarding_items item
        WHERE item.company_id=p_company_id AND item.status IN ('PENDING','FAILED')
      ),
      'reminders',(
        SELECT count(*)::integer FROM public.company_onboarding_reminders reminder
        WHERE reminder.company_id=p_company_id AND reminder.status='PENDING'
      ),
      'leadTasks',(
        SELECT count(*)::integer
        FROM public.company_lead_tasks task
        JOIN public.company_leads lead ON lead.id=task.lead_id
        WHERE lead.converted_company_id=p_company_id AND task.status='OPEN'
      )
    ) ELSE jsonb_build_object('onboardingItems',0,'reminders',0,'leadTasks',0) END,
    'managerCoverage',jsonb_build_object(
      'status',CASE WHEN EXISTS (
        SELECT 1
        FROM public.company_assignments assignment
        JOIN public.users manager ON manager.id=assignment.manager_user_id
        WHERE assignment.company_id=p_company_id
          AND assignment.assignment_type='PRIMARY'
          AND assignment.status='ACTIVE'
          AND assignment.coverage_starts_at<=p_at
          AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>p_at)
          AND manager.active AND manager.account_status='ACTIVE'
      ) THEN 'COVERED' ELSE 'GAP' END,
      'reason',(
        SELECT event.reason
        FROM public.company_manager_continuity_events event
        WHERE event.company_id=p_company_id
        ORDER BY event.occurred_at DESC,event.id DESC LIMIT 1
      ),
      'lastChangedAt',(
        SELECT event.occurred_at
        FROM public.company_manager_continuity_events event
        WHERE event.company_id=p_company_id
        ORDER BY event.occurred_at DESC,event.id DESC LIMIT 1
      )
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lifecycle_workspace(
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
  can_manage_assignments boolean;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;

  can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot)
    OR public.axora_company_snapshot_role_permission(
      actor_snapshot,'company.lead.assign'
    );

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'canCreate',public.axora_company_actor_can_create(
      actor_snapshot,'company.lead.create'
    ),
    'canViewAll',public.axora_company_actor_is_owner(actor_snapshot),
    'managers',CASE WHEN can_manage_assignments THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',manager.id,'name',manager.display_name,'email',manager.email,
        'serviceRegionCode',COALESCE(profile.service_region_code,'GLOBAL'),
        'availabilityStatus',COALESCE(profile.availability_status,'AVAILABLE'),
        'activePrimaryAssignments',(
          SELECT count(*)::integer
          FROM public.company_assignments workload
          WHERE workload.manager_user_id=manager.id
            AND workload.assignment_type='PRIMARY'
            AND workload.status='ACTIVE'
            AND workload.coverage_starts_at<=p_at
            AND (workload.coverage_ends_at IS NULL OR workload.coverage_ends_at>p_at)
        ),
        'maxPrimaryAssignments',COALESCE(profile.max_primary_companies,25),
        'availableForPrimary',COALESCE(profile.availability_status,'AVAILABLE')<>'UNAVAILABLE'
          AND (
            SELECT count(*)
            FROM public.company_assignments workload
            WHERE workload.manager_user_id=manager.id
              AND workload.assignment_type='PRIMARY'
              AND workload.status='ACTIVE'
              AND workload.coverage_starts_at<=p_at
              AND (workload.coverage_ends_at IS NULL OR workload.coverage_ends_at>p_at)
          )<COALESCE(profile.max_primary_companies,25),
        'availableForBackup',COALESCE(profile.availability_status,'AVAILABLE')<>'UNAVAILABLE'
      ) ORDER BY manager.display_name,manager.id)
      FROM public.users manager
      LEFT JOIN public.company_manager_profiles profile
        ON profile.manager_user_id=manager.id
      WHERE manager.active AND manager.account_status='ACTIVE'
        AND manager.account_kind='PLATFORM'
        AND manager.account_setup_completed_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.role_assignments assignment
          JOIN public.roles role ON role.id=assignment.role_id
          WHERE assignment.user_id=manager.id
            AND assignment.active AND assignment.revoked_at IS NULL
            AND role.role_key='CLIENT_ACCOUNT_MANAGER'
        )
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'companies',COALESCE((
      SELECT jsonb_agg(company_record.record ORDER BY company_record.name,company_record.id)
      FROM (
        SELECT company.id,company.name,
          public.axora_company_lifecycle_record(
            company.id,actor_snapshot,p_actor_user_id,p_at
          ) || public.axora_company_manager_coverage_record(
            company.id,actor_snapshot,p_actor_user_id,p_at
          ) AS record
        FROM public.companies company
        WHERE public.axora_company_actor_can_view(
          actor_snapshot,p_actor_user_id,company.id,p_at
        )
      ) company_record
      WHERE company_record.record IS NOT NULL
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_mutation_payload(
  p_company_id uuid,
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_at timestamptz,
  p_event_key text,
  p_include_company_admins boolean DEFAULT false,
  p_extra_recipients uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'company',public.axora_company_lifecycle_record(
      p_company_id,p_snapshot,p_actor_user_id,p_at
    ) || public.axora_company_manager_coverage_record(
      p_company_id,p_snapshot,p_actor_user_id,p_at
    ),
    'companyId',p_company_id,
    'companyName',(SELECT company.name FROM public.companies company WHERE company.id=p_company_id),
    'companyVersion',(SELECT company.lifecycle_version FROM public.companies company WHERE company.id=p_company_id),
    'eventKey',p_event_key,
    'notificationRecipientIds',(
      SELECT COALESCE(jsonb_agg(DISTINCT recipient_id),'[]'::jsonb)
      FROM (
        SELECT value #>> '{}' AS recipient_id
        FROM jsonb_array_elements(
          public.axora_company_notification_recipient_ids(
            p_company_id,p_include_company_admins,p_at
          )
        ) value
        UNION ALL
        SELECT unnest(p_extra_recipients)::text
      ) recipients
      WHERE recipient_id IS NOT NULL AND recipient_id<>''
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_manage_company_assignment(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_manager_user_id uuid,
  p_assignment_type text,
  p_coverage_starts_at timestamptz,
  p_coverage_ends_at timestamptz,
  p_access_mode text,
  p_specific_permission_codes text[],
  p_document_visibility text,
  p_handover_notes text,
  p_handover_checklist text[],
  p_reason text,
  p_allow_lead_self_claim boolean,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  company_row public.companies%ROWTYPE;
  former_assignment_id uuid;
  former_manager_id uuid;
  new_assignment_id uuid;
  continuity_event_id uuid;
  required_permission text;
  event_key text;
  continuity_type text;
  transfer_summary jsonb:='{}'::jsonb;
  selected_permission_code text;
  checklist_item text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO company_row FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR company_row.id IS NULL
    OR p_assignment_type NOT IN ('PRIMARY','BACKUP')
    OR p_access_mode NOT IN ('NORMAL','TEMPORARY','READ_ONLY','SPECIFIC_PERMISSIONS')
    OR p_document_visibility NOT IN ('STANDARD','COMPANY_SHARED_ONLY','NONE')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(btrim(COALESCE(p_handover_notes,'')))>5000
    OR COALESCE(cardinality(p_handover_checklist),0)>20
    OR company_row.lifecycle_status IN ('DUPLICATE','REJECTED','ARCHIVED') THEN
    RAISE EXCEPTION 'The company assignment is unavailable';
  END IF;

  SELECT assignment.id,assignment.manager_user_id
  INTO former_assignment_id,former_manager_id
  FROM public.company_assignments assignment
  WHERE assignment.company_id=p_company_id
    AND assignment.assignment_type=p_assignment_type
    AND assignment.status='ACTIVE'
  FOR UPDATE;

  required_permission:=CASE WHEN former_manager_id IS NULL
    THEN 'company.lead.assign' ELSE 'company.lead.reassign' END;
  IF NOT public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,required_permission,p_at
  ) AND NOT (
    former_manager_id IS NULL
    AND company_row.created_by=p_actor_user_id
    AND public.axora_company_snapshot_role_permission(
      actor_snapshot,required_permission
    )
  ) THEN RAISE EXCEPTION 'The company assignment is unavailable'; END IF;

  IF former_manager_id=p_manager_user_id THEN
    RAISE EXCEPTION 'The selected manager already holds this assignment';
  END IF;
  IF p_actor_user_id=p_manager_user_id AND NOT (
    p_allow_lead_self_claim
    AND p_assignment_type='PRIMARY'
    AND former_manager_id IS NULL
    AND company_row.created_by=p_actor_user_id
  ) THEN RAISE EXCEPTION 'The company assignment is unavailable'; END IF;

  PERFORM 1 FROM public.users manager
  WHERE manager.id=p_manager_user_id FOR UPDATE;
  IF NOT public.axora_company_manager_is_eligible(
    p_manager_user_id,p_company_id,p_assignment_type,p_at
  ) THEN RAISE EXCEPTION 'The selected manager is unavailable'; END IF;

  IF p_assignment_type='BACKUP' AND (
    p_coverage_starts_at IS NULL OR p_coverage_ends_at IS NULL
    OR p_coverage_ends_at<=p_coverage_starts_at OR p_coverage_ends_at<=p_at
  ) THEN RAISE EXCEPTION 'Backup coverage requires a valid future end time'; END IF;
  IF p_assignment_type='PRIMARY' AND (
    p_access_mode='TEMPORARY' OR p_coverage_ends_at IS NOT NULL
    OR (p_coverage_starts_at IS NOT NULL AND p_coverage_starts_at>p_at)
  ) THEN RAISE EXCEPTION 'A primary assignment must begin immediately and cannot expire'; END IF;

  IF p_access_mode='SPECIFIC_PERMISSIONS' AND COALESCE(cardinality(p_specific_permission_codes),0)=0 THEN
    RAISE EXCEPTION 'Specific assignment permissions are required';
  ELSIF p_access_mode<>'SPECIFIC_PERMISSIONS' AND COALESCE(cardinality(p_specific_permission_codes),0)>0 THEN
    RAISE EXCEPTION 'Specific permissions require the matching access mode';
  END IF;

  FOREACH selected_permission_code IN ARRAY COALESCE(p_specific_permission_codes,ARRAY[]::text[])
  LOOP
    IF selected_permission_code !~ '^[a-z][a-z0-9_.-]{1,119}$'
      OR NOT EXISTS (
        SELECT 1
        FROM public.role_assignments role_assignment
        JOIN public.role_permissions role_permission
          ON role_permission.role_id=role_assignment.role_id
        JOIN public.permissions permission
          ON permission.id=role_permission.permission_id
        WHERE role_assignment.user_id=p_manager_user_id
          AND role_assignment.active AND role_assignment.revoked_at IS NULL
          AND permission.permission_code=selected_permission_code
      ) THEN RAISE EXCEPTION 'A selected assignment permission is unavailable'; END IF;
  END LOOP;

  FOREACH checklist_item IN ARRAY COALESCE(p_handover_checklist,ARRAY[]::text[])
  LOOP
    IF char_length(btrim(checklist_item)) NOT BETWEEN 2 AND 240 THEN
      RAISE EXCEPTION 'A handover checklist item is invalid';
    END IF;
  END LOOP;

  UPDATE public.company_assignments
  SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
    end_reason='Reassigned: ' || btrim(p_reason)
  WHERE id=former_assignment_id;

  INSERT INTO public.company_assignments(
    company_id,manager_user_id,assignment_type,status,coverage_starts_at,
    coverage_ends_at,assigned_by,assigned_at,assignment_reason,
    access_mode,specific_permission_codes,document_visibility,
    handover_notes,handover_checklist,predecessor_assignment_id
  ) VALUES (
    p_company_id,p_manager_user_id,p_assignment_type,'ACTIVE',
    COALESCE(p_coverage_starts_at,p_at),p_coverage_ends_at,
    p_actor_user_id,p_at,btrim(p_reason),p_access_mode,
    COALESCE((SELECT array_agg(DISTINCT code ORDER BY code)
      FROM unnest(COALESCE(p_specific_permission_codes,ARRAY[]::text[])) code),ARRAY[]::text[]),
    p_document_visibility,NULLIF(btrim(COALESCE(p_handover_notes,'')),''),
    to_jsonb(COALESCE(p_handover_checklist,ARRAY[]::text[])),former_assignment_id
  ) RETURNING id INTO new_assignment_id;

  IF p_assignment_type='PRIMARY' THEN
    transfer_summary:=public.axora_transfer_company_manager_work(
      p_company_id,former_manager_id,p_manager_user_id,p_actor_user_id,p_at
    );
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,
      completed_at=p_at,assigned_manager_user_id=p_manager_user_id
    WHERE company_id=p_company_id AND item_code='PRIMARY_MANAGER';

    IF company_row.lifecycle_status='NEW_LEAD' THEN
      PERFORM public.axora_apply_company_status(
        p_company_id,'UNDER_REVIEW',p_actor_user_id,
        'Lead reviewed during assignment',p_at,
        jsonb_build_object('assignmentType','PRIMARY')
      );
      PERFORM public.axora_apply_company_status(
        p_company_id,'ASSIGNED',p_actor_user_id,btrim(p_reason),p_at,
        jsonb_build_object('managerUserId',p_manager_user_id)
      );
    ELSIF company_row.lifecycle_status='UNDER_REVIEW' THEN
      PERFORM public.axora_apply_company_status(
        p_company_id,'ASSIGNED',p_actor_user_id,btrim(p_reason),p_at,
        jsonb_build_object('managerUserId',p_manager_user_id)
      );
    END IF;
  END IF;

  event_key:=CASE WHEN former_manager_id IS NULL
    THEN 'company.assigned' ELSE 'company.reassigned' END;
  continuity_type:=CASE
    WHEN p_assignment_type='PRIMARY' AND former_manager_id IS NULL THEN 'ASSIGNED'
    WHEN p_assignment_type='PRIMARY' THEN 'REASSIGNED'
    WHEN former_manager_id IS NULL THEN 'BACKUP_CONFIGURED'
    ELSE 'BACKUP_REPLACED' END;
  INSERT INTO public.company_manager_continuity_events(
    company_id,event_type,assignment_id,former_manager_user_id,
    new_manager_user_id,reason,transfer_summary,notification_recipient_ids,
    actor_user_id,occurred_at
  ) VALUES (
    p_company_id,continuity_type,new_assignment_id,former_manager_id,
    p_manager_user_id,btrim(p_reason),transfer_summary,
    array_remove(ARRAY[p_manager_user_id,former_manager_id],NULL),
    p_actor_user_id,p_at
  ) RETURNING id INTO continuity_event_id;

  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,event_key,false,
    array_remove(ARRAY[p_manager_user_id,former_manager_id],NULL)
  ) || jsonb_build_object('eventSequence',continuity_event_id);
END $$;

CREATE OR REPLACE FUNCTION public.axora_assign_company_manager(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_manager_user_id uuid,
  p_assignment_type text,
  p_coverage_starts_at timestamptz,
  p_coverage_ends_at timestamptz,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_manage_company_assignment(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_manager_user_id,
    p_assignment_type,p_coverage_starts_at,p_coverage_ends_at,
    CASE WHEN p_assignment_type='BACKUP' THEN 'TEMPORARY' ELSE 'NORMAL' END,
    ARRAY[]::text[],'STANDARD',NULL,ARRAY[]::text[],p_reason,true,p_at
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_failover_deactivated_company_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  primary_assignment public.company_assignments%ROWTYPE;
  backup_assignment public.company_assignments%ROWTYPE;
  promoted_assignment_id uuid;
  trigger_actor_id uuid;
  fallback_owner_id uuid;
  transfer_summary jsonb;
  event_time timestamptz:=statement_timestamp();
BEGIN
  IF NOT (
    (OLD.active AND NOT NEW.active)
    OR (OLD.account_status='ACTIVE' AND NEW.account_status<>'ACTIVE')
  ) THEN RETURN NEW; END IF;

  BEGIN
    trigger_actor_id:=NULLIF(current_setting('axora.user_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    trigger_actor_id:=NULL;
  END;
  IF trigger_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users actor WHERE actor.id=trigger_actor_id
  ) THEN trigger_actor_id:=OLD.id; END IF;

  SELECT owner.id INTO fallback_owner_id
  FROM public.users owner
  WHERE owner.active AND owner.account_status='ACTIVE'
    AND owner.account_kind='PLATFORM' AND owner.is_owner
    AND owner.id<>OLD.id
  ORDER BY owner.created_at,owner.id LIMIT 1;

  FOR primary_assignment IN
    SELECT assignment.*
    FROM public.company_assignments assignment
    WHERE assignment.manager_user_id=OLD.id
      AND assignment.assignment_type='PRIMARY'
      AND assignment.status='ACTIVE'
    ORDER BY assignment.company_id
    FOR UPDATE
  LOOP
    SELECT assignment.* INTO backup_assignment
    FROM public.company_assignments assignment
    WHERE assignment.company_id=primary_assignment.company_id
      AND assignment.assignment_type='BACKUP'
      AND assignment.status='ACTIVE'
      AND assignment.coverage_starts_at<=event_time
      AND assignment.coverage_ends_at>event_time
      AND public.axora_company_manager_is_eligible(
        assignment.manager_user_id,assignment.company_id,'PRIMARY',event_time
      )
    FOR UPDATE LIMIT 1;

    UPDATE public.company_assignments
    SET status='ENDED',ended_by=trigger_actor_id,ended_at=event_time,
      end_reason='Manager account became unavailable'
    WHERE id=primary_assignment.id;

    IF backup_assignment.id IS NOT NULL THEN
      UPDATE public.company_assignments
      SET status='ENDED',ended_by=trigger_actor_id,ended_at=event_time,
        end_reason='Promoted automatically after primary manager became unavailable'
      WHERE id=backup_assignment.id;

      INSERT INTO public.company_assignments(
        company_id,manager_user_id,assignment_type,status,coverage_starts_at,
        coverage_ends_at,assigned_by,assigned_at,assignment_reason,
        access_mode,specific_permission_codes,document_visibility,
        handover_notes,handover_checklist,predecessor_assignment_id
      ) VALUES (
        primary_assignment.company_id,backup_assignment.manager_user_id,
        'PRIMARY','ACTIVE',event_time,NULL,trigger_actor_id,event_time,
        'Automatic backup promotion after primary manager deactivation',
        CASE WHEN backup_assignment.access_mode='TEMPORARY'
          THEN 'NORMAL' ELSE backup_assignment.access_mode END,
        backup_assignment.specific_permission_codes,
        backup_assignment.document_visibility,backup_assignment.handover_notes,
        backup_assignment.handover_checklist,primary_assignment.id
      ) RETURNING id INTO promoted_assignment_id;

      transfer_summary:=public.axora_transfer_company_manager_work(
        primary_assignment.company_id,OLD.id,backup_assignment.manager_user_id,
        trigger_actor_id,event_time
      );
      INSERT INTO public.company_manager_continuity_events(
        company_id,event_type,assignment_id,former_manager_user_id,
        new_manager_user_id,accountable_owner_user_id,reason,transfer_summary,
        notification_recipient_ids,actor_user_id,occurred_at
      ) VALUES (
        primary_assignment.company_id,'AUTO_FAILOVER',promoted_assignment_id,
        OLD.id,backup_assignment.manager_user_id,fallback_owner_id,
        'Backup manager promoted after primary manager became unavailable',
        transfer_summary,
        array_remove(ARRAY[backup_assignment.manager_user_id,fallback_owner_id],NULL),
        trigger_actor_id,event_time
      );
    ELSE
      UPDATE public.company_assignments assignment
      SET status='ENDED',ended_by=trigger_actor_id,ended_at=event_time,
        end_reason='Backup manager was unavailable during primary manager deactivation'
      FROM public.users backup_user
      WHERE assignment.company_id=primary_assignment.company_id
        AND assignment.assignment_type='BACKUP'
        AND assignment.status='ACTIVE'
        AND backup_user.id=assignment.manager_user_id
        AND (NOT backup_user.active OR backup_user.account_status<>'ACTIVE');

      transfer_summary:=public.axora_transfer_company_manager_work(
        primary_assignment.company_id,OLD.id,fallback_owner_id,
        trigger_actor_id,event_time
      );
      INSERT INTO public.company_manager_continuity_events(
        company_id,event_type,former_manager_user_id,
        accountable_owner_user_id,reason,transfer_summary,
        notification_recipient_ids,actor_user_id,occurred_at
      ) VALUES (
        primary_assignment.company_id,'COVERAGE_GAP',OLD.id,fallback_owner_id,
        'Primary manager became unavailable without eligible backup coverage',
        transfer_summary,array_remove(ARRAY[fallback_owner_id],NULL),
        trigger_actor_id,event_time
      );
    END IF;
    backup_assignment:=NULL;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_company_manager_failover ON public.users;
CREATE TRIGGER users_company_manager_failover
AFTER UPDATE OF active,account_status ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_failover_deactivated_company_manager();

REVOKE ALL ON FUNCTION public.axora_reject_company_manager_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_assignment_allows_permission(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_manager_is_eligible(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_transfer_company_manager_work(uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_manager_coverage_record(uuid,jsonb,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_manage_company_assignment(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text[],text,text,text[],text,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_failover_deactivated_company_manager() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_manage_company_assignment(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text[],text,text,text[],text,boolean,timestamptz) TO axora_app';
  END IF;
END $$;

COMMIT;
