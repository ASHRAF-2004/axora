BEGIN;

-- Platform Owners review and assign acquisition leads. Human Resources keeps
-- its existing delegated assignment authority, while Client Account Managers
-- continue to receive portfolio access only through lead/company assignments.
CREATE OR REPLACE FUNCTION public.axora_assign_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_manager_user_id uuid,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  snapshot jsonb;
  current_assignment public.company_lead_assignments%ROWTYPE;
  lead_status text;
  required_permission text;
  assignment_actor boolean:=false;
  event jsonb;
  event_key text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT status INTO lead_status FROM public.company_leads
  WHERE id=p_lead_id FOR UPDATE;
  SELECT * INTO current_assignment FROM public.company_lead_assignments
  WHERE lead_id=p_lead_id AND status='ACTIVE' FOR UPDATE;
  required_permission:=CASE WHEN current_assignment.id IS NULL
    THEN 'company.lead.assign' ELSE 'company.lead.reassign' END;
  assignment_actor:=snapshot IS NOT NULL AND (
    public.axora_company_actor_is_owner(snapshot)
    OR (
      snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
      AND public.axora_company_snapshot_role_permission(snapshot,required_permission)
    )
  );
  IF NOT assignment_actor
    OR lead_status IS NULL
    OR lead_status IN ('ONBOARDING','ACTIVE','CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
    OR NOT public.axora_company_lead_manager_is_valid(p_manager_user_id,p_at)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead assignment is unavailable'; END IF;
  IF current_assignment.manager_user_id=p_manager_user_id THEN
    RAISE EXCEPTION 'Company lead is already assigned to this Agent';
  END IF;
  IF current_assignment.id IS NOT NULL THEN
    UPDATE public.company_lead_assignments
    SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
      end_reason='Reassigned: '||btrim(p_reason)
    WHERE id=current_assignment.id;
    event_key:='company.lead.reassigned';
  ELSE
    event_key:='company.lead.assigned';
  END IF;
  INSERT INTO public.company_lead_assignments(
    lead_id,manager_user_id,assigned_by,assigned_at,assignment_reason
  ) VALUES (p_lead_id,p_manager_user_id,p_actor_user_id,p_at,btrim(p_reason));
  IF lead_status='NEW' THEN
    PERFORM public.axora_apply_company_lead_status(
      p_lead_id,'ASSIGNED',p_actor_user_id,'Lead assigned to Agent',p_at,
      jsonb_build_object('managerUserId',p_manager_user_id)
    );
  END IF;
  event:=public.axora_append_company_lead_event(
    p_lead_id,event_key,
    event_key||':'||p_manager_user_id::text||':'
      ||extract(epoch FROM p_at)::bigint::text,
    p_actor_user_id,jsonb_build_object('managerUserId',p_manager_user_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

-- Public enquiry content remains acquisition-internal. Conversion transfers
-- approved company facts, not the visitor's message, campaign evidence, or
-- internal qualification context into company-visible profile fields.
CREATE OR REPLACE FUNCTION public.axora_convert_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  snapshot jsonb;
  lead public.company_leads%ROWTYPE;
  submission public.public_contact_submissions%ROWTYPE;
  company_payload jsonb;
  company_id uuid;
  manager_id uuid;
  event jsonb;
  pending_count integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO lead FROM public.company_leads WHERE id=p_lead_id FOR UPDATE;
  IF snapshot IS NULL OR lead.id IS NULL OR lead.status<>'QUALIFIED'
    OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead conversion is unavailable'; END IF;
  SELECT count(*)::integer INTO pending_count
  FROM public.company_lead_duplicate_candidates
  WHERE lead_id=p_lead_id AND review_status='PENDING';
  IF pending_count>0 OR lead.duplicate_risk='POSSIBLE_DUPLICATE' THEN
    RAISE EXCEPTION 'Company lead duplicate review must be completed';
  END IF;
  SELECT * INTO submission FROM public.public_contact_submissions
  WHERE lead_id=p_lead_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF btrim(submission.company_registration_number)='' THEN
    RAISE EXCEPTION 'Company registration information is required before conversion';
  END IF;
  company_payload:=public.axora_create_company_lead(
    p_actor_user_id,p_actor_role_assignment_id,submission.company_name,
    submission.company_legal_name,submission.company_registration_number,
    submission.industry,
    left(format('Employees: %s; branches: %s; monthly spend: %s.',
      submission.employee_count_range,submission.branch_count_range,
      submission.monthly_spend_range),5000),
    '',submission.contact_name,submission.contact_email,
    concat_ws(' ',submission.phone_country_code,submission.phone),
    submission.contact_name,submission.contact_email,
    concat_ws(' ',submission.phone_country_code,submission.phone),
    left(concat_ws(', ',submission.city,submission.region,submission.country),5000),
    'Standard billing terms','Monthly','',p_at
  );
  company_id:=(company_payload->>'companyId')::uuid;
  SELECT assignment.manager_user_id INTO manager_id
  FROM public.company_lead_assignments assignment
  WHERE assignment.lead_id=p_lead_id AND assignment.status='ACTIVE';
  IF public.axora_company_actor_is_owner(snapshot) AND manager_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      WHERE assignment.user_id=manager_id AND assignment.active
        AND assignment.revoked_at IS NULL
        AND role.role_key='CLIENT_ACCOUNT_MANAGER'
    ) THEN
    PERFORM public.axora_assign_company_manager(
      p_actor_user_id,p_actor_role_assignment_id,company_id,manager_id,
      'PRIMARY',p_at,NULL,
      'Converted lead manager retained on onboarding company',p_at
    );
  END IF;
  UPDATE public.company_leads SET converted_company_id=company_id
  WHERE id=p_lead_id;
  PERFORM public.axora_apply_company_lead_status(
    p_lead_id,'ONBOARDING',p_actor_user_id,p_reason,p_at,
    jsonb_build_object('companyId',company_id)
  );
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.converted','converted:'||company_id::text,
    p_actor_user_id,jsonb_build_object('companyId',company_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event)
    ||jsonb_build_object('companyId',company_id,'companyPayload',company_payload);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_has_active_administrator(
  p_company_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id
     AND assignment.scope_type='COMPANY'
     AND assignment.company_id=p_company_id
     AND assignment.active
     AND assignment.revoked_at IS NULL
    JOIN public.roles role
      ON role.id=assignment.role_id
     AND role.role_key='COMPANY_ADMIN'
    JOIN public.company_memberships membership
      ON membership.user_id=account.id
     AND membership.company_id=p_company_id
     AND membership.status='ACTIVE'
    WHERE account.account_kind='COMPANY'
      AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_setup_completed_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.account_setup_invitations invitation
        WHERE invitation.user_id=account.id
          AND invitation.company_id=p_company_id
          AND invitation.intended_role_id=assignment.role_id
          AND invitation.intended_scope_type='COMPANY'
          AND invitation.consumed_at IS NOT NULL
          AND invitation.revoked_at IS NULL
      )
  )
$$;

REVOKE ALL ON FUNCTION public.axora_company_has_active_administrator(uuid) FROM PUBLIC;

-- The invitation issuer must retain authority until setup is consumed. A
-- Platform Owner is canonically PLATFORM-scoped, so validate the live owner
-- role permission rather than incorrectly demanding a COMPANY role scope.
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
              creator.is_owner
              AND creator.account_kind='PLATFORM'
              AND public.axora_company_actor_is_owner(creator_snapshot.value)
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

REVOKE ALL ON FUNCTION public.axora_account_setup_inviter_can_activate(
  uuid,timestamptz
) FROM PUBLIC;

-- Item state remains useful evidence, but high-impact activation rechecks the
-- live manager, duplicate, verification, and account state every time.
CREATE OR REPLACE FUNCTION public.axora_company_activation_blockers(
  p_company_id uuid
)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(
    array_agg(DISTINCT current_blocker.blocker ORDER BY current_blocker.blocker),
    ARRAY[]::text[]
  )
  FROM unnest(
    public.axora_company_onboarding_content_blockers(p_company_id,now())
    || CASE WHEN EXISTS (
      SELECT 1 FROM public.companies company
      WHERE company.id=p_company_id
        AND company.duplicate_review_status='POSSIBLE_DUPLICATE'
    ) THEN ARRAY['DUPLICATE_REVIEW']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT EXISTS (
      SELECT 1
      FROM public.company_assignments assignment
      JOIN public.users manager ON manager.id=assignment.manager_user_id
      WHERE assignment.company_id=p_company_id
        AND assignment.assignment_type='PRIMARY'
        AND assignment.status='ACTIVE'
        AND assignment.coverage_starts_at<=now()
        AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>now())
        AND manager.account_kind='PLATFORM'
        AND manager.active
        AND manager.account_status='ACTIVE'
        AND manager.account_setup_completed_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.role_assignments manager_assignment
          JOIN public.roles manager_role ON manager_role.id=manager_assignment.role_id
          WHERE manager_assignment.user_id=manager.id
            AND manager_assignment.active
            AND manager_assignment.revoked_at IS NULL
            AND manager_role.role_key='CLIENT_ACCOUNT_MANAGER'
        )
    ) THEN ARRAY['PRIMARY_MANAGER']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN NOT public.axora_company_has_active_administrator(p_company_id)
      THEN ARRAY['ADMIN_ACTIVATION']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (
      SELECT 1 FROM public.companies company
      WHERE company.id=p_company_id AND company.verification_status<>'VERIFIED'
    ) THEN ARRAY['ONBOARDING_VERIFICATION']::text[] ELSE ARRAY[]::text[] END
  ) AS current_blocker(blocker)
$$;

CREATE OR REPLACE FUNCTION public.axora_activate_company(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  current_status text;
  blockers text[];
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL
    OR current_status NOT IN ('COMPANY_ADMINISTRATOR_ACTIVATED','SUSPENDED')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    ) THEN RAISE EXCEPTION 'The company activation is unavailable'; END IF;

  blockers:=public.axora_company_activation_blockers(p_company_id);
  IF cardinality(blockers)>0 THEN
    RETURN jsonb_build_object(
      'company',public.axora_company_lifecycle_record(
        p_company_id,actor_snapshot,p_actor_user_id,p_at
      ) || public.axora_company_manager_coverage_record(
        p_company_id,actor_snapshot,p_actor_user_id,p_at
      ),
      'companyId',p_company_id,
      'companyName',(SELECT company.name FROM public.companies company
        WHERE company.id=p_company_id),
      'companyVersion',(SELECT company.lifecycle_version FROM public.companies company
        WHERE company.id=p_company_id),
      'eventKey','company.activation_blocked',
      'notificationRecipientIds','[]'::jsonb,
      'blockedReasons',to_jsonb(blockers)
    );
  END IF;

  PERFORM public.axora_apply_company_status(
    p_company_id,'ACTIVE',p_actor_user_id,btrim(p_reason),p_at
  );
  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,'company.activated',true
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_sync_company_administrator(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  current_status text;
  administrator_id uuid;
  administrator_active boolean:=false;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL
    OR current_status NOT IN ('COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED')
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The Company Administrator lifecycle is unavailable';
  END IF;

  SELECT account.id,(
    account.account_kind='COMPANY'
    AND account.account_setup_completed_at IS NOT NULL
    AND account.active
    AND account.account_status='ACTIVE'
    AND membership.status='ACTIVE'
    AND EXISTS (
      SELECT 1 FROM public.account_setup_invitations consumed_invitation
      WHERE consumed_invitation.user_id=account.id
        AND consumed_invitation.company_id=p_company_id
        AND consumed_invitation.intended_role_id=assignment.role_id
        AND consumed_invitation.intended_scope_type='COMPANY'
        AND consumed_invitation.consumed_at IS NOT NULL
        AND consumed_invitation.revoked_at IS NULL
    )
  )
  INTO administrator_id,administrator_active
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id
   AND assignment.scope_type='COMPANY'
   AND assignment.company_id=p_company_id
   AND assignment.active
   AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.company_memberships membership
    ON membership.user_id=account.id
   AND membership.company_id=p_company_id
   AND membership.status IN ('INVITED','ACTIVE')
  WHERE role.role_key='COMPANY_ADMIN'
    AND EXISTS (
      SELECT 1 FROM public.account_setup_invitations invitation
      WHERE invitation.user_id=account.id
        AND invitation.company_id=p_company_id
        AND invitation.intended_role_id=assignment.role_id
        AND invitation.intended_scope_type='COMPANY'
        AND invitation.revoked_at IS NULL
        AND (invitation.delivery_status='SENT' OR invitation.consumed_at IS NOT NULL)
    )
  ORDER BY administrator_active DESC,account.account_setup_completed_at DESC NULLS LAST,
    account.created_at
  LIMIT 1;
  IF administrator_id IS NULL THEN
    RAISE EXCEPTION 'A delivered Company Administrator invitation is required';
  END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,
    completed_at=p_at
  WHERE company_id=p_company_id AND item_code='ADMIN_INVITATION';
  IF current_status='COMPANY_REVIEW' THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_INVITED',p_actor_user_id,
      btrim(p_reason),p_at,jsonb_build_object('administratorUserId',administrator_id)
    );
  END IF;

  IF administrator_active THEN
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,completed_by=administrator_id,
      completed_at=p_at,exception_reason=NULL,exception_approved_by=NULL,
      exception_approved_at=NULL,exception_expires_at=NULL
    WHERE company_id=p_company_id AND item_code='ADMIN_ACTIVATION';
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_ACTIVATED',p_actor_user_id,
      'Company Administrator completed secure account setup',p_at,
      jsonb_build_object('administratorUserId',administrator_id)
    );
  ELSE
    UPDATE public.company_onboarding_items
    SET status='PENDING',
      blocking_reason='The invited Company Administrator must complete account setup.',
      completed_by=NULL,completed_at=NULL,exception_reason=NULL,
      exception_approved_by=NULL,exception_approved_at=NULL,
      exception_expires_at=NULL
    WHERE company_id=p_company_id AND item_code='ADMIN_ACTIVATION';
  END IF;

  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,
    CASE WHEN administrator_active THEN 'company.administrator_activated'
      ELSE 'company.administrator_invited' END,true,ARRAY[administrator_id]
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_company_publication(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_is_publicly_listed boolean,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  existing_value boolean;
  current_status text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT is_publicly_listed,lifecycle_status
  INTO existing_value,current_status
  FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR existing_value IS NULL
    OR existing_value=p_is_publicly_listed
    OR (p_is_publicly_listed AND current_status<>'ACTIVE')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.portal.publish',p_at
    ) THEN RAISE EXCEPTION 'The company publication change is unavailable'; END IF;

  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason',btrim(p_reason),true);
  UPDATE public.companies SET is_publicly_listed=p_is_publicly_listed
  WHERE id=p_company_id;
  INSERT INTO public.company_publication_history(
    company_id,is_publicly_listed,reason,changed_by,changed_at
  ) VALUES (p_company_id,p_is_publicly_listed,btrim(p_reason),p_actor_user_id,p_at);

  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,
    CASE WHEN p_is_publicly_listed THEN 'company.published'
      ELSE 'company.unpublished' END,false
  );
END $$;

-- Migration 080 retained one reference to the removed legacy company status
-- lookup. PostgreSQL prepares that branch on the first lead transition even
-- when the requested state is not ACTIVE, causing a valid first mutation to
-- fail with SQLSTATE 42703.
DO $patch$
DECLARE original_definition text; create_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_lock_company_admin_invitation_scope(uuid,uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  create_definition:=replace(
    original_definition,
    $needle$public.axora_snapshot_has_permission(
      actor_snapshot,'user.create','COMPANY',p_company_id,NULL,NULL,NULL
    )$needle$,
    $replacement$public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.create'
    )$replacement$
  );
  IF create_definition=original_definition THEN
    RAISE EXCEPTION 'Company Administrator creation authority was not patched';
  END IF;
  patched_definition:=replace(
    create_definition,
    $needle$public.axora_snapshot_has_permission(
      actor_snapshot,'user.invite','COMPANY',p_company_id,NULL,NULL,NULL
    )$needle$,
    $replacement$public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.invite'
    )$replacement$
  );
  IF patched_definition=create_definition THEN
    RAISE EXCEPTION 'Company Administrator invitation authority was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enforce_account_setup_invitation_scope()'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$      AND public.axora_snapshot_has_permission(
        snapshot.value,'user.create',NEW.intended_scope_type,
        NEW.company_id,NEW.intended_branch_id,
        NEW.intended_department_id,NEW.intended_supplier_id
      )
      AND public.axora_snapshot_has_permission(
        snapshot.value,'user.invite',NEW.intended_scope_type,
        NEW.company_id,NEW.intended_branch_id,
        NEW.intended_department_id,NEW.intended_supplier_id
      )$needle$,
    $replacement$      AND (
        (
          public.axora_company_actor_is_owner(snapshot.value)
          AND NEW.intended_scope_type='COMPANY'
          AND NEW.company_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.roles intended_role
            WHERE intended_role.id=NEW.intended_role_id
              AND intended_role.role_key='COMPANY_ADMIN'
          )
          AND EXISTS (
            SELECT 1 FROM public.companies onboarding_company
            WHERE onboarding_company.id=NEW.company_id
              AND onboarding_company.lifecycle_status IN (
                'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED'
              )
          )
          AND public.axora_company_snapshot_role_permission(
            snapshot.value,'user.create'
          )
          AND public.axora_company_snapshot_role_permission(
            snapshot.value,'user.invite'
          )
        )
        OR (
          public.axora_snapshot_has_permission(
            snapshot.value,'user.create',NEW.intended_scope_type,
            NEW.company_id,NEW.intended_branch_id,
            NEW.intended_department_id,NEW.intended_supplier_id
          )
          AND public.axora_snapshot_has_permission(
            snapshot.value,'user.invite',NEW.intended_scope_type,
            NEW.company_id,NEW.intended_branch_id,
            NEW.intended_department_id,NEW.intended_supplier_id
          )
        )
      )$replacement$
  );
  IF patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company Administrator invitation trigger was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enforce_account_setup_invitation_scope()'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$        FROM public.companies company
        WHERE company.id=NEW.company_id AND company.active$needle$,
    $replacement$        FROM public.companies company
        WHERE company.id=NEW.company_id AND (
          company.active
          OR (
            NEW.intended_scope_type='COMPANY'
            AND intended_role_key='COMPANY_ADMIN'
            AND company.lifecycle_status IN (
              'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED'
            )
          )
        )$replacement$
  );
  IF patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company Administrator inactive-onboarding scope was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  next_definition text;
  patch_index integer;
  needles text[]:=ARRAY[
    E'  company_id uuid;',
    E'  ) RETURNING id INTO company_id;',
    E'    company_id,1,NULL,''NEW_LEAD''',
    E'  SELECT company_id,candidate.id',
    E'  WHERE candidate.id<>company_id',
    E'    WHERE id=company_id;',
    E'    (company_id,''',
    E'      company_id,p_actor_user_id,''PRIMARY''',
    E'    WHERE company_id=axora_create_company_lead.company_id',
    E'      company_id,''UNDER_REVIEW''',
    E'      company_id,''ASSIGNED''',
    E'    company_id,actor_snapshot'
  ];
  replacements text[]:=ARRAY[
    E'  new_company_id uuid;',
    E'  ) RETURNING id INTO new_company_id;',
    E'    new_company_id,1,NULL,''NEW_LEAD''',
    E'  SELECT new_company_id,candidate.id',
    E'  WHERE candidate.id<>new_company_id',
    E'    WHERE id=new_company_id;',
    E'    (new_company_id,''',
    E'      new_company_id,p_actor_user_id,''PRIMARY''',
    E'    WHERE company_id=new_company_id',
    E'      new_company_id,''UNDER_REVIEW''',
    E'      new_company_id,''ASSIGNED''',
    E'    new_company_id,actor_snapshot'
  ];
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_create_company_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=original_definition;
  FOR patch_index IN 1..cardinality(needles) LOOP
    next_definition:=replace(
      patched_definition,needles[patch_index],replacements[patch_index]
    );
    IF next_definition=patched_definition THEN
      RAISE EXCEPTION 'Company creation variable patch % was not applied',patch_index;
    END IF;
    patched_definition:=next_definition;
  END LOOP;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$        AND company.status_id=public.lookup_id('master_status','Active')$needle$,
    $replacement$        AND company.lifecycle_status='ACTIVE' AND company.active$replacement$
  );
  IF patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company lead ACTIVE transition policy was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- Patch the large workspace/controller functions in place. Each exact
-- replacement is asserted so a future definition drift fails the migration
-- rather than silently weakening authorization.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$  can_manage_assignments:=actor_snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
    AND public.axora_company_snapshot_role_permission(
      actor_snapshot,'company.lead.assign'
    );$needle$,
    $replacement$  can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot)
    OR (actor_snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
      AND public.axora_company_snapshot_role_permission(
        actor_snapshot,'company.lead.assign'
      ));$replacement$
  );
  IF patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company lifecycle workspace assignment policy was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; role_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_manage_company_assignment(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text[],text,text,text[],text,boolean,timestamptz)'::regprocedure
  ) INTO original_definition;
  role_definition:=replace(
    original_definition,
    $needle$  IF actor_snapshot->>'roleKey'<>'HUMAN_RESOURCES_MANAGEMENT' AND NOT ($needle$,
    $replacement$  IF NOT public.axora_company_actor_is_owner(actor_snapshot)
    AND actor_snapshot->>'roleKey'<>'HUMAN_RESOURCES_MANAGEMENT' AND NOT ($replacement$
  );
  IF role_definition=original_definition THEN
    RAISE EXCEPTION 'Company assignment actor policy was not patched';
  END IF;
  patched_definition:=replace(
    role_definition,
    $needle$  IF NOT public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,required_permission,p_at
  ) AND NOT ($needle$,
    $replacement$  IF NOT public.axora_company_actor_is_owner(actor_snapshot)
    AND NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,required_permission,p_at
    ) AND NOT ($replacement$
  );
  IF patched_definition=role_definition THEN
    RAISE EXCEPTION 'Company assignment permission policy was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; assignment_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_record(uuid,jsonb,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  assignment_definition:=replace(
    replace(
      original_definition,
      $needle$  can_assign:=public.axora_company_actor_has_permission($needle$,
      $replacement$  can_assign:=is_owner OR public.axora_company_actor_has_permission($replacement$
    ),
    $needle$  can_reassign:=public.axora_company_actor_has_permission($needle$,
    $replacement$  can_reassign:=is_owner OR public.axora_company_actor_has_permission($replacement$
  );
  IF assignment_definition=original_definition THEN
    RAISE EXCEPTION 'Company lifecycle owner assignment actions were not patched';
  END IF;
  patched_definition:=replace(
    assignment_definition,
    $needle$    CASE WHEN can_publish AND NOT EXISTS ($needle$,
    $replacement$    CASE WHEN can_publish AND company_status='ACTIVE' AND NOT EXISTS ($replacement$
  );
  IF patched_definition=assignment_definition THEN
    RAISE EXCEPTION 'Company lifecycle publication action was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

REVOKE ALL ON FUNCTION public.axora_assign_company_lead(
  uuid,uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_convert_company_lead(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_activation_blockers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_activate_company(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_sync_company_administrator(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_company_publication(
  uuid,uuid,uuid,boolean,text,timestamptz
) FROM PUBLIC;

COMMIT;
