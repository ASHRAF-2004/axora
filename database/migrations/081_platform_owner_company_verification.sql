BEGIN;

-- Company onboarding evidence and company activation already have separate
-- lifecycles. This migration makes the Platform Owner decision between them
-- explicit without rewriting prior verification history.
ALTER TABLE public.company_verification_history
  DROP CONSTRAINT IF EXISTS company_verification_history_to_status_check;
ALTER TABLE public.company_verification_history
  ADD CONSTRAINT company_verification_history_to_status_check CHECK (
    to_status IN (
      'NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','CHANGES_REQUIRED',
      'DRAFT','PENDING_VERIFICATION','CHANGES_REQUESTED','VERIFIED','REJECTED','INACTIVE'
    )
  );

INSERT INTO public.company_verification_history(
  company_id,from_status,to_status,reason,evidence,changed_by,changed_at
)
SELECT company.id,company.verification_status,
  CASE company.verification_status
    WHEN 'NOT_STARTED' THEN 'DRAFT'
    WHEN 'IN_PROGRESS' THEN 'DRAFT'
    WHEN 'READY_FOR_REVIEW' THEN 'PENDING_VERIFICATION'
    WHEN 'CHANGES_REQUIRED' THEN 'CHANGES_REQUESTED'
    ELSE company.verification_status
  END,
  'Verification workflow upgraded to explicit Platform Owner review',
  jsonb_build_object('source','MIGRATION_081','legacyStatus',company.verification_status),
  NULL,now()
FROM public.companies company
WHERE company.verification_status IN (
  'NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','CHANGES_REQUIRED'
);

UPDATE public.companies company
SET verification_status=CASE company.verification_status
    WHEN 'NOT_STARTED' THEN 'DRAFT'
    WHEN 'IN_PROGRESS' THEN 'DRAFT'
    WHEN 'READY_FOR_REVIEW' THEN 'PENDING_VERIFICATION'
    WHEN 'CHANGES_REQUIRED' THEN 'CHANGES_REQUESTED'
    ELSE company.verification_status
  END,
  verification_updated_at=COALESCE(company.verification_updated_at,now()),
  updated_at=GREATEST(company.updated_at,now())
WHERE company.verification_status IN (
  'NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','CHANGES_REQUIRED'
);

ALTER TABLE public.companies
  ALTER COLUMN verification_status SET DEFAULT 'DRAFT',
  DROP CONSTRAINT IF EXISTS companies_verification_status_check,
  DROP CONSTRAINT IF EXISTS companies_active_requires_verification,
  DROP CONSTRAINT IF EXISTS companies_portal_requires_verification;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_verification_status_check CHECK (
    verification_status IN (
      'DRAFT','PENDING_VERIFICATION','CHANGES_REQUESTED',
      'VERIFIED','REJECTED','INACTIVE'
    )
  ),
  ADD CONSTRAINT companies_active_requires_verification CHECK (
    NOT active OR verification_status='VERIFIED'
  ),
  ADD CONSTRAINT companies_portal_requires_verification CHECK (
    NOT portal_access_enabled OR verification_status='VERIFIED'
  );

-- Trusted seeds/imports may explicitly insert an already-active baseline after
-- the full migration chain. The application role has no direct company INSERT,
-- and the application creation capability always inserts an inactive draft.
CREATE OR REPLACE FUNCTION public.axora_default_active_company_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.active AND NEW.verification_status='DRAFT' THEN
    NEW.verification_status:='VERIFIED';
    NEW.verification_updated_at:=COALESCE(
      NEW.verification_updated_at,NEW.activated_at,NEW.updated_at,NEW.created_at,now()
    );
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ensure_active_company_verification ON public.companies;
CREATE TRIGGER ensure_active_company_verification
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_default_active_company_verification();

-- A Client Account Manager's role assignment is company-scoped. During
-- onboarding that company is deliberately inactive, so the generic live
-- authorization readiness check needs the same narrow lifecycle exception
-- already used for an invited Company Administrator. The manager must be the
-- active accountable assignee for this exact company; no other inactive
-- company scope becomes usable.
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
          'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
          'COMPANY_ADMINISTRATOR_ACTIVATED'
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

REVOKE ALL ON FUNCTION public.axora_role_assignment_target_is_ready(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_company_verification_mutation(
  p_company_id uuid,p_actor_user_id uuid,p_event_key text,p_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'companyId',company.id,
    'companyName',company.name,
    'version',company.onboarding_version,
    'eventKey',p_event_key,
    'notificationRecipientIds',COALESCE((
      SELECT jsonb_agg(recipient.id ORDER BY recipient.id)
      FROM (
        SELECT DISTINCT account.id
        FROM public.users account
        WHERE account.active AND account.account_status='ACTIVE'
          AND account.id<>p_actor_user_id
          AND (
            (p_event_key='company.verification.submitted'
              AND account.is_owner
              AND EXISTS (
                SELECT 1 FROM public.role_assignments owner_assignment
                JOIN public.roles owner_role ON owner_role.id=owner_assignment.role_id
                WHERE owner_assignment.user_id=account.id
                  AND owner_assignment.active AND owner_assignment.revoked_at IS NULL
                  AND owner_role.role_key='PLATFORM_OWNER'
              ))
            OR (p_event_key<>'company.verification.submitted' AND (
              account.id=company.created_by
              OR EXISTS (
                SELECT 1 FROM public.company_assignments manager_assignment
                WHERE manager_assignment.company_id=company.id
                  AND manager_assignment.manager_user_id=account.id
                  AND manager_assignment.status='ACTIVE'
                  AND manager_assignment.coverage_starts_at<=p_at
                  AND (manager_assignment.coverage_ends_at IS NULL
                    OR manager_assignment.coverage_ends_at>p_at)
              )
            ))
          )
      ) recipient
    ),'[]'::jsonb)
  )
  FROM public.companies company
  WHERE company.id=p_company_id
$$;

CREATE OR REPLACE FUNCTION public.axora_company_verification_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
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
  base_snapshot jsonb;
  selected_company public.companies%ROWTYPE;
  owner_edit boolean:=false;
  manager_edit boolean:=false;
  can_review boolean:=false;
  can_submit boolean:=false;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  base_snapshot:=public.axora_company_onboarding_workspace(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
  SELECT * INTO selected_company
  FROM public.companies WHERE id=p_company_id;
  IF actor_snapshot IS NULL OR base_snapshot IS NULL OR selected_company.id IS NULL THEN
    RETURN NULL;
  END IF;

  owner_edit:=public.axora_company_actor_is_owner(actor_snapshot)
    AND NOT selected_company.active
    AND selected_company.verification_status<>'INACTIVE'
    AND public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    );
  manager_edit:=actor_snapshot->>'accountKind'='PLATFORM'
    AND actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    AND selected_company.verification_status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')
    AND NOT selected_company.active
    AND public.axora_company_assignment_is_active(
      p_actor_user_id,p_company_id,p_at
    )
    AND public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    );
  can_review:=public.axora_company_actor_is_owner(actor_snapshot)
    AND selected_company.verification_status='PENDING_VERIFICATION'
    AND NOT selected_company.active
    AND public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    );
  can_submit:=manager_edit
    AND selected_company.lifecycle_status='COMPANY_REVIEW'
    AND cardinality(public.axora_company_onboarding_content_blockers(
      p_company_id,p_at
    ))=0;

  base_snapshot:=jsonb_set(
    base_snapshot,'{company}',
    (base_snapshot->'company') || jsonb_build_object(
      'companyInformation',COALESCE(selected_company.company_information,''),
      'websiteUrl',selected_company.website_url,
      'internalNotes',selected_company.notes,
      'createdBy',selected_company.created_by
    )
  );
  RETURN base_snapshot || jsonb_build_object(
    'canEdit',owner_edit OR manager_edit,
    'canApproveExceptions',owner_edit,
    'canVerify',can_review,
    'canReview',can_review,
    'canSubmit',can_submit,
    'canRequestChanges',can_review,
    'canReject',can_review
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_save_company_verification_draft(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_legal_name text,p_registration_number text,
  p_registration_country_code text,p_tax_registration_number text,
  p_industry_code text,p_industry_other_text text,p_registered_address text,
  p_operating_address text,p_main_contact_name text,p_main_contact_email text,
  p_main_contact_phone text,p_billing_contact_name text,p_billing_contact_email text,
  p_billing_contact_phone text,p_billing_address text,p_billing_cycle text,
  p_default_locale text,p_timezone text,p_current_step text,p_completed_steps text[],
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  selected_company public.companies%ROWTYPE;
  allowed boolean:=false;
BEGIN
  SELECT * INTO selected_company
  FROM public.companies
  WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR selected_company.id IS NULL THEN
    RAISE EXCEPTION 'The company onboarding update is unavailable';
  END IF;
  allowed:=(public.axora_company_actor_is_owner(actor_snapshot)
      AND NOT selected_company.active
      AND selected_company.verification_status<>'INACTIVE'
      AND public.axora_company_actor_has_permission(
        actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
      ))
    OR (actor_snapshot->>'accountKind'='PLATFORM'
      AND actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
      AND selected_company.verification_status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')
      AND NOT selected_company.active
      AND public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
      AND public.axora_company_actor_has_permission(
        actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
      ));
  IF NOT allowed THEN
    RAISE EXCEPTION 'The company onboarding update is unavailable';
  END IF;
  RETURN public.axora_save_company_onboarding(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_expected_version,
    p_legal_name,p_registration_number,p_registration_country_code,
    p_tax_registration_number,p_industry_code,p_industry_other_text,
    p_registered_address,p_operating_address,p_main_contact_name,
    p_main_contact_email,p_main_contact_phone,p_billing_contact_name,
    p_billing_contact_email,p_billing_contact_phone,p_billing_address,
    p_billing_cycle,p_default_locale,p_timezone,p_current_step,
    p_completed_steps,p_reason,p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_update_company_verification_item(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_item_code text,p_status text,
  p_responsible_user_id uuid,p_notes text,p_evidence_reference text,
  p_due_at timestamptz,p_exception_reason text,p_exception_expires_at timestamptz,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  selected_company public.companies%ROWTYPE;
  item_id uuid;
  owner_edit boolean:=false;
  manager_edit boolean:=false;
BEGIN
  IF p_status NOT IN ('PENDING','PASSED','FAILED','WAIVED')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(btrim(COALESCE(p_notes,'')))>3000
    OR char_length(btrim(COALESCE(p_evidence_reference,'')))>1000 THEN
    RAISE EXCEPTION 'The onboarding checklist update is unavailable';
  END IF;
  SELECT * INTO selected_company
  FROM public.companies
  WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR selected_company.id IS NULL THEN
    RAISE EXCEPTION 'The onboarding checklist update is unavailable';
  END IF;
  owner_edit:=public.axora_company_actor_is_owner(actor_snapshot)
    AND NOT selected_company.active
    AND selected_company.verification_status<>'INACTIVE'
    AND public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    );
  manager_edit:=actor_snapshot->>'accountKind'='PLATFORM'
    AND actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    AND selected_company.verification_status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')
    AND NOT selected_company.active
    AND public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
    AND public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    );
  IF NOT (owner_edit OR manager_edit) OR (p_status='WAIVED' AND (
      NOT owner_edit
      OR char_length(btrim(COALESCE(p_exception_reason,''))) NOT BETWEEN 3 AND 1000
      OR p_exception_expires_at IS NULL OR p_exception_expires_at<=p_at
    )) THEN
    RAISE EXCEPTION 'The onboarding checklist update is unavailable';
  END IF;
  IF p_responsible_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users responsible
    WHERE responsible.id=p_responsible_user_id AND responsible.active
      AND (EXISTS (
        SELECT 1 FROM public.company_assignments assignment
        WHERE assignment.company_id=p_company_id
          AND assignment.manager_user_id=responsible.id AND assignment.status='ACTIVE'
      ) OR EXISTS (
        SELECT 1 FROM public.company_memberships membership
        WHERE membership.company_id=p_company_id AND membership.user_id=responsible.id
          AND membership.status IN ('INVITED','ACTIVE')
      ))
  ) THEN RAISE EXCEPTION 'The onboarding checklist update is unavailable'; END IF;

  UPDATE public.company_onboarding_items SET
    status=p_status,responsible_user_id=p_responsible_user_id,
    notes=NULLIF(btrim(COALESCE(p_notes,'')),''),
    evidence_reference=NULLIF(btrim(COALESCE(p_evidence_reference,'')),''),
    due_at=p_due_at,
    blocking_reason=CASE WHEN p_status IN ('PENDING','FAILED') THEN btrim(p_reason) ELSE NULL END,
    completed_by=CASE WHEN p_status IN ('PASSED','WAIVED') THEN p_actor_user_id ELSE NULL END,
    completed_at=CASE WHEN p_status IN ('PASSED','WAIVED') THEN p_at ELSE NULL END,
    exception_reason=CASE WHEN p_status='WAIVED' THEN btrim(p_exception_reason) ELSE NULL END,
    exception_approved_by=CASE WHEN p_status='WAIVED' THEN p_actor_user_id ELSE NULL END,
    exception_approved_at=CASE WHEN p_status='WAIVED' THEN p_at ELSE NULL END,
    exception_expires_at=CASE WHEN p_status='WAIVED' THEN p_exception_expires_at ELSE NULL END,
    updated_at=p_at
  WHERE company_id=p_company_id AND item_code=p_item_code
  RETURNING id INTO item_id;
  IF item_id IS NULL THEN
    RAISE EXCEPTION 'The onboarding checklist update is unavailable';
  END IF;

  UPDATE public.company_onboarding_reminders SET status='CANCELLED'
  WHERE onboarding_item_id=item_id AND status='PENDING';
  IF p_due_at IS NOT NULL AND p_status IN ('PENDING','FAILED')
    AND p_responsible_user_id IS NOT NULL THEN
    INSERT INTO public.company_onboarding_reminders(
      company_id,onboarding_item_id,recipient_user_id,due_at,created_by
    ) VALUES (p_company_id,item_id,p_responsible_user_id,p_due_at,p_actor_user_id);
  END IF;

  UPDATE public.companies SET
    onboarding_version=onboarding_version+1,
    onboarding_saved_at=p_at,
    verification_updated_at=p_at,
    verification_updated_by=p_actor_user_id,
    updated_at=p_at
  WHERE id=p_company_id;
  RETURN public.axora_company_onboarding_mutation(
    p_company_id,p_actor_user_id,'company.onboarding.updated',p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_submit_company_verification(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  prior_status text;
  company_status text;
  company_active boolean;
  blockers text[];
BEGIN
  SELECT verification_status,lifecycle_status,active
  INTO prior_status,company_status,company_active
  FROM public.companies
  WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  blockers:=public.axora_company_onboarding_content_blockers(p_company_id,p_at);
  IF actor_snapshot IS NULL OR prior_status IS NULL OR company_active
    OR actor_snapshot->>'accountKind'<>'PLATFORM'
    OR actor_snapshot->>'roleKey'<>'CLIENT_ACCOUNT_MANAGER'
    OR prior_status NOT IN ('DRAFT','CHANGES_REQUESTED','REJECTED')
    OR company_status<>'COMPANY_REVIEW'
    OR cardinality(blockers)>0
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    ) THEN
    RAISE EXCEPTION 'The company verification submission is unavailable';
  END IF;

  UPDATE public.companies SET
    verification_status='PENDING_VERIFICATION',
    verification_updated_at=p_at,
    verification_updated_by=p_actor_user_id,
    onboarding_version=onboarding_version+1,
    onboarding_saved_at=p_at,
    updated_at=p_at
  WHERE id=p_company_id;
  INSERT INTO public.company_verification_history(
    company_id,from_status,to_status,reason,evidence,changed_by,changed_at
  ) VALUES (
    p_company_id,prior_status,'PENDING_VERIFICATION',btrim(p_reason),
    jsonb_build_object('source','MANAGER_SUBMISSION','blockers',to_jsonb(blockers)),
    p_actor_user_id,p_at
  );
  RETURN public.axora_company_verification_mutation(
    p_company_id,p_actor_user_id,'company.verification.submitted',p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_review_company_verification(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_decision text,p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  prior_status text;
  target_status text;
  event_key text;
  company_active boolean;
  blockers text[];
BEGIN
  SELECT verification_status,active INTO prior_status,company_active
  FROM public.companies
  WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  blockers:=public.axora_company_onboarding_content_blockers(p_company_id,p_at);
  IF p_decision='APPROVE' THEN
    target_status:='VERIFIED';
    event_key:='company.verification.approved';
  ELSIF p_decision='REQUEST_CHANGES' THEN
    target_status:='CHANGES_REQUESTED';
    event_key:='company.verification.changes_requested';
  ELSIF p_decision='REJECT' THEN
    target_status:='REJECTED';
    event_key:='company.verification.rejected';
  ELSE
    RAISE EXCEPTION 'The company verification decision is unavailable';
  END IF;
  IF actor_snapshot IS NULL OR prior_status<>'PENDING_VERIFICATION'
    OR company_active
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    )
    OR (p_decision='APPROVE' AND cardinality(blockers)>0) THEN
    RAISE EXCEPTION 'The company verification decision is unavailable';
  END IF;

  UPDATE public.companies SET
    verification_status=target_status,
    verification_updated_at=p_at,
    verification_updated_by=p_actor_user_id,
    onboarding_version=onboarding_version+1,
    onboarding_saved_at=p_at,
    updated_at=p_at
  WHERE id=p_company_id;
  INSERT INTO public.company_verification_history(
    company_id,from_status,to_status,reason,evidence,changed_by,changed_at
  ) VALUES (
    p_company_id,prior_status,target_status,btrim(p_reason),
    jsonb_build_object('source','PLATFORM_OWNER_REVIEW','decision',p_decision,
      'blockers',to_jsonb(blockers)),p_actor_user_id,p_at
  );
  RETURN public.axora_company_verification_mutation(
    p_company_id,p_actor_user_id,event_key,p_at
  );
END $$;

-- Preserve the deployed function signature for internal compatibility, while
-- making its authority owner-only through the new review capability.
CREATE OR REPLACE FUNCTION public.axora_verify_company_onboarding(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_review_company_verification(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,
    p_expected_version,'APPROVE',p_reason,p_at
  )
$$;

REVOKE ALL ON FUNCTION
  public.axora_default_active_company_verification(),
  public.axora_company_verification_mutation(uuid,uuid,text,timestamptz),
  public.axora_company_verification_workspace(uuid,uuid,uuid,timestamptz),
  public.axora_save_company_verification_draft(
    uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,
    text,text,text,text,text,text,text,text,text[],text,timestamptz
  ),
  public.axora_update_company_verification_item(
    uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz
  ),
  public.axora_submit_company_verification(uuid,uuid,uuid,integer,text,timestamptz),
  public.axora_review_company_verification(uuid,uuid,uuid,integer,text,text,timestamptz),
  public.axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz),
  public.axora_save_company_onboarding(
    uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,
    text,text,text,text,text,text,text,text,text[],text,timestamptz
  ),
  public.axora_update_company_onboarding_item(
    uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz
  ),
  public.axora_verify_company_onboarding(uuid,uuid,uuid,integer,text,timestamptz)
FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE EXECUTE ON FUNCTION
      public.axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz),
      public.axora_save_company_onboarding(
        uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,
        text,text,text,text,text,text,text,text,text[],text,timestamptz
      ),
      public.axora_update_company_onboarding_item(
        uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz
      ),
      public.axora_verify_company_onboarding(uuid,uuid,uuid,integer,text,timestamptz)
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_company_verification_workspace(uuid,uuid,uuid,timestamptz),
      public.axora_save_company_verification_draft(
        uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,
        text,text,text,text,text,text,text,text,text[],text,timestamptz
      ),
      public.axora_update_company_verification_item(
        uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz
      ),
      public.axora_submit_company_verification(uuid,uuid,uuid,integer,text,timestamptz),
      public.axora_review_company_verification(uuid,uuid,uuid,integer,text,text,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
