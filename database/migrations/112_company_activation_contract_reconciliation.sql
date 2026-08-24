BEGIN;

SELECT pg_advisory_xact_lock(11220260824);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Migration 081 made VERIFIED a final invariant for both operational status
-- and portal access. Migration 107 later simplified the activation preview to
-- the administrator check alone, so a DRAFT company could be presented as
-- eligible before the invariant rejected the transition. Keep the invariant
-- and restore verification as part of the canonical eligibility calculation.
CREATE OR REPLACE FUNCTION public.axora_company_activation_blockers(
  p_company_id uuid
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT current_blocker.blocker ORDER BY current_blocker.blocker),
    ARRAY[]::text[]
  )
  FROM unnest(
    CASE WHEN NOT public.axora_company_has_active_administrator(p_company_id)
      THEN ARRAY['ADMIN_ACTIVATION']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (
      SELECT 1
      FROM public.companies company
      WHERE company.id=p_company_id
        AND company.verification_status<>'VERIFIED'
    ) THEN ARRAY['COMPANY_VERIFICATION_REQUIRED']::text[]
      ELSE ARRAY[]::text[] END
  ) AS current_blocker(blocker)
$$;

-- The compact MVP setup page is the supported source for these essential
-- fields. Retired CRM checklist items are deliberately not restored as hidden
-- blockers; the current administrator lifecycle and essential setup evidence
-- are rechecked immediately before an Owner can approve verification.
CREATE OR REPLACE FUNCTION public.axora_company_verification_readiness_blockers(
  p_company_id uuid
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT current_blocker.blocker ORDER BY current_blocker.blocker),
    ARRAY[]::text[]
  )
  FROM unnest(
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM public.companies company
      WHERE company.id=p_company_id
        AND public.axora_company_is_retained(company.id)
        AND NOT company.active
        AND company.lifecycle_status='COMPANY_ADMINISTRATOR_ACTIVATED'
    ) THEN ARRAY['COMPANY_LIFECYCLE_REQUIRED']::text[]
      ELSE ARRAY[]::text[] END
    || CASE WHEN NOT public.axora_company_has_active_administrator(p_company_id)
      THEN ARRAY['ADMIN_ACTIVATION']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (
      SELECT 1
      FROM public.companies company
      WHERE company.id=p_company_id AND (
        btrim(company.legal_name)=''
        OR btrim(company.main_contact_name)=''
        OR btrim(company.industry_code)=''
        OR company.default_locale NOT IN ('en','ar','ms')
        OR btrim(company.timezone)=''
      )
    ) THEN ARRAY['COMPANY_SETUP_REQUIRED']::text[]
      ELSE ARRAY[]::text[] END
  ) AS current_blocker(blocker)
$$;

-- A separate read capability lets the new image expose the compact Owner
-- verification action without changing the strict lifecycle JSON consumed by
-- the previous image during the rollback window.
CREATE OR REPLACE FUNCTION public.axora_company_activation_contract_workspace(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
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
  readiness_blockers text[];
  result jsonb;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR NOT public.axora_company_actor_can_view(
    actor_snapshot,p_actor_user_id,p_company_id,p_at
  ) THEN RETURN NULL; END IF;

  readiness_blockers:=public.axora_company_verification_readiness_blockers(
    p_company_id
  );
  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'companyId',company.id,
    'verificationStatus',company.verification_status,
    'verificationVersion',company.onboarding_version,
    'verificationApprovalAvailable',(
      public.axora_company_actor_is_owner(actor_snapshot)
      AND public.axora_company_actor_has_permission(
        actor_snapshot,p_actor_user_id,company.id,'company.activate',p_at
      )
      AND company.verification_status IN ('DRAFT','PENDING_VERIFICATION')
      AND cardinality(readiness_blockers)=0
    ),
    'verificationApprovalBlockers',to_jsonb(readiness_blockers)
  ) INTO result
  FROM public.companies company
  WHERE company.id=p_company_id
    AND public.axora_company_is_retained(company.id);
  RETURN result;
END $$;

-- Compact Owner verification. The browser supplies no reason: the audit
-- reason and evidence source are deterministic, while live readiness and
-- authorization are rebuilt under the company row lock.
CREATE OR REPLACE FUNCTION public.axora_review_company_verification(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_company_id uuid,
  p_expected_verification_version integer,
  p_decision text,
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
  current_verification_status text;
  current_verification_version integer;
  company_active boolean;
  readiness_blockers text[];
  mutation jsonb;
BEGIN
  SELECT company.verification_status,company.onboarding_version,company.active
  INTO current_verification_status,current_verification_version,company_active
  FROM public.companies company
  WHERE company.id=p_company_id
  FOR UPDATE;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF current_verification_status IS NULL
    OR actor_snapshot IS NULL
    OR (actor_snapshot->>'authVersion')::integer IS DISTINCT FROM p_actor_auth_version
    OR NOT public.axora_company_is_retained(p_company_id)
    OR p_decision<>'APPROVE'
    OR p_reason<>'COMPANY_VERIFICATION_APPROVED'
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    ) THEN
    RETURN jsonb_build_object('status','DENIED');
  END IF;

  IF current_verification_status='VERIFIED' THEN
    RETURN jsonb_build_object('status','ALREADY_VERIFIED');
  END IF;
  IF current_verification_version IS DISTINCT FROM p_expected_verification_version THEN
    RETURN jsonb_build_object('status','STALE');
  END IF;
  IF company_active
    OR current_verification_status NOT IN ('DRAFT','PENDING_VERIFICATION') THEN
    RETURN jsonb_build_object('status','UNAVAILABLE');
  END IF;

  readiness_blockers:=public.axora_company_verification_readiness_blockers(
    p_company_id
  );
  IF cardinality(readiness_blockers)>0 THEN
    RETURN jsonb_build_object(
      'status','BLOCKED','blockedReasons',to_jsonb(readiness_blockers)
    );
  END IF;

  UPDATE public.companies
  SET verification_status='VERIFIED',
      verification_updated_at=p_at,
      verification_updated_by=p_actor_user_id,
      onboarding_version=onboarding_version+1,
      onboarding_saved_at=p_at,
      updated_at=p_at
  WHERE id=p_company_id;

  INSERT INTO public.company_verification_history(
    company_id,from_status,to_status,reason,evidence,changed_by,changed_at
  ) VALUES (
    p_company_id,current_verification_status,'VERIFIED',
    'COMPANY_VERIFICATION_APPROVED',
    jsonb_build_object(
      'source','PLATFORM_OWNER_COMPACT_REVIEW',
      'readinessBlockers',to_jsonb(readiness_blockers)
    ),
    p_actor_user_id,p_at
  );

  mutation:=public.axora_company_verification_mutation(
    p_company_id,p_actor_user_id,'company.verification.approved',p_at
  );
  RETURN jsonb_build_object('status','VERIFIED','mutation',mutation);
END $$;

-- The new application sends both the authenticated session generation and the
-- lifecycle version rendered by the page. Expected domain races are returned
-- as typed outcomes. The invariant remains the final backstop.
CREATE OR REPLACE FUNCTION public.axora_activate_company(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_actor_auth_version integer,
  p_company_id uuid,
  p_expected_lifecycle_version integer,
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
  current_version integer;
  current_active boolean;
  blockers text[];
  mutation jsonb;
BEGIN
  SELECT company.lifecycle_status,company.lifecycle_version,company.active
  INTO current_status,current_version,current_active
  FROM public.companies company
  WHERE company.id=p_company_id
  FOR UPDATE;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF current_status IS NULL
    OR actor_snapshot IS NULL
    OR (actor_snapshot->>'authVersion')::integer IS DISTINCT FROM p_actor_auth_version
    OR NOT public.axora_company_is_retained(p_company_id)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    ) THEN
    RETURN jsonb_build_object('status','DENIED');
  END IF;

  IF current_active OR current_status='ACTIVE' THEN
    RETURN jsonb_build_object('status','ALREADY_ACTIVE');
  END IF;
  IF current_version IS DISTINCT FROM p_expected_lifecycle_version THEN
    RETURN jsonb_build_object('status','STALE');
  END IF;
  IF current_status NOT IN ('COMPANY_ADMINISTRATOR_ACTIVATED','SUSPENDED') THEN
    RETURN jsonb_build_object('status','UNAVAILABLE');
  END IF;

  blockers:=public.axora_company_activation_blockers(p_company_id);
  IF cardinality(blockers)>0 THEN
    RETURN jsonb_build_object(
      'status','BLOCKED','blockedReasons',to_jsonb(blockers)
    );
  END IF;

  PERFORM public.axora_apply_company_status(
    p_company_id,'ACTIVE',p_actor_user_id,btrim(p_reason),p_at
  );
  mutation:=public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,'company.activated',true
  );
  RETURN jsonb_build_object('status','ACTIVATED','mutation',mutation);
END $$;

REVOKE ALL ON FUNCTION
  public.axora_company_verification_readiness_blockers(uuid),
  public.axora_company_activation_contract_workspace(uuid,uuid,uuid,timestamptz),
  public.axora_review_company_verification(uuid,uuid,integer,uuid,integer,text,text,timestamptz),
  public.axora_activate_company(uuid,uuid,integer,uuid,integer,text,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    -- Reapply the existing signatures as well as the new capabilities so a
    -- grant manifest replay and an application-image rollback remain safe.
    GRANT EXECUTE ON FUNCTION
      public.axora_company_activation_blockers(uuid),
      public.axora_activate_company(uuid,uuid,uuid,text,timestamptz),
      public.axora_company_activation_contract_workspace(uuid,uuid,uuid,timestamptz),
      public.axora_review_company_verification(uuid,uuid,integer,uuid,integer,text,text,timestamptz),
      public.axora_activate_company(uuid,uuid,integer,uuid,integer,text,timestamptz)
    TO axora_app;
    REVOKE EXECUTE ON FUNCTION
      public.axora_company_verification_readiness_blockers(uuid)
    FROM axora_app;
  END IF;
END $$;

COMMENT ON FUNCTION public.axora_company_activation_blockers(uuid) IS
  'Canonical live company activation blockers; verification remains mandatory.';
COMMENT ON FUNCTION public.axora_company_activation_contract_workspace(
  uuid,uuid,uuid,timestamptz
) IS 'Authorized compact verification state for the Company activation workspace.';
COMMENT ON FUNCTION public.axora_review_company_verification(
  uuid,uuid,integer,uuid,integer,text,text,timestamptz
) IS 'Auth-version-bound compact Owner overload of the existing company verification review workflow.';
COMMENT ON FUNCTION public.axora_activate_company(
  uuid,uuid,integer,uuid,integer,text,timestamptz
) IS 'Auth-version and lifecycle-version-bound company activation with controlled outcomes.';

COMMIT;
