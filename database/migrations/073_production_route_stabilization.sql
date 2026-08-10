BEGIN;

CREATE OR REPLACE FUNCTION public.axora_request_escalation_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  id uuid,
  request_id uuid,
  request_version integer,
  escalation_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT DISTINCT ON (escalation.request_id,escalation.request_version)
    escalation.id,
    escalation.request_id,
    escalation.request_version,
    escalation.escalation_type
  FROM public.axora_request_access_rows(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  ) access
  JOIN public.request_approval_escalations escalation
    ON escalation.request_id=access.request_id
  ORDER BY escalation.request_id,escalation.request_version,
    escalation.created_at DESC,escalation.id DESC
$$;

CREATE OR REPLACE FUNCTION public.axora_profile_image_policy(
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
  snapshot jsonb;
  policy public.profile_image_policies%ROWTYPE;
  selected_company_id uuid;
  selected_company_name text;
  company_photo_display_enabled boolean;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO policy FROM public.profile_image_policies
  WHERE id='00000000-0000-4000-8000-000000000066'::uuid;
  IF p_company_id IS NOT NULL THEN
    IF NOT public.axora_snapshot_has_permission(
      snapshot,'settings.manage','COMPANY',p_company_id,NULL,NULL,NULL
    ) THEN RETURN NULL; END IF;
    SELECT company.id,company.name,company.profile_photo_display_enabled
      INTO selected_company_id,selected_company_name,company_photo_display_enabled
    FROM public.companies company
    WHERE company.id=p_company_id AND company.active;
    IF selected_company_id IS NULL THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object(
    'deliveryAgentPhotoRequired',policy.delivery_agent_photo_required,
    'retiredVersionRetentionDays',policy.retired_version_retention_days,
    'companyId',selected_company_id,
    'companyName',selected_company_name,
    'companyPhotoDisplayEnabled',company_photo_display_enabled
  );
END
$$;

REVOKE ALL ON FUNCTION public.axora_request_escalation_rows(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_profile_image_policy(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.request_approval_escalations FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_request_escalation_rows(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_profile_image_policy(
      uuid,uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END
$axora_runtime_role$;

COMMIT;
