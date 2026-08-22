BEGIN;

SELECT pg_advisory_xact_lock(10720260822);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- The internal MVP has no CAM portfolio assignment boundary. Historical
-- assignment rows remain intact, but active platform CAM access is determined
-- only by the effective permission snapshot (including explicit DENY).
CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
  p_snapshot jsonb,p_permission_code text,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_supplier_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE effective_code text;
BEGIN
  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') AND p_company_id IS NOT NULL THEN
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
    IF p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN RETURN true; END IF;
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all',p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id
    );
  END IF;
  RETURN true;
END $$;

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
      RETURN public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
      ) OR public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
      );
    END IF;
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
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

-- Direct company creation is permission based for Platform Owner and CAM.
-- The role preset makes the intended MVP CAM role immediately usable; an
-- explicit DENY remains final and removes either view or create authority.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'company.create'
)
WHERE role.role_key='CLIENT_ACCOUNT_MANAGER' AND permission.active
ON CONFLICT DO NOTHING;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    '  can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot);',
    '  can_manage_assignments:=false;');
  revised:=replace(revised,
    $old$    'canCreate',public.axora_company_actor_is_owner(actor_snapshot)
      AND public.axora_snapshot_has_permission(
        actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
      ),$old$,
    $new$    'canCreate',public.axora_snapshot_has_permission(
      actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
    ),$new$);
  revised:=replace(revised,
    $old$    'canViewAll',public.axora_company_actor_is_owner(actor_snapshot),$old$,
    $new$    'canViewAll',public.axora_company_actor_is_owner(actor_snapshot)
      OR (actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' AND (
        public.axora_snapshot_has_permission_base(
          actor_snapshot,'company.view.assigned','PLATFORM',NULL,NULL,NULL,NULL
        ) OR public.axora_snapshot_has_permission_base(
          actor_snapshot,'company.view.all','PLATFORM',NULL,NULL,NULL,NULL
        )
      )),$new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Company workspace MVP patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_create_company_record_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    $old$    OR char_length(btrim(COALESCE(p_legal_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_industry,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_company_information,''))) NOT BETWEEN 3 AND 5000$old$,
    $new$    OR char_length(btrim(COALESCE(p_legal_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_industry,''))) > 300
    OR char_length(btrim(COALESCE(p_company_information,''))) > 5000$new$);
  revised:=replace(revised,
    $old$    IF NOT public.axora_company_actor_is_owner(actor_snapshot)
      OR NOT public.axora_snapshot_has_permission($old$,
    $new$    IF NOT (public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER')
      OR NOT public.axora_snapshot_has_permission($new$);
  revised:=replace(revised,
    $old$    (company_id_value,'PRIMARY_MANAGER','Primary Client Account Manager',true,
      CASE WHEN manager_id IS NULL THEN 'PENDING' ELSE 'PASSED' END,
      CASE WHEN manager_id IS NULL THEN 'Assign a primary Client Account Manager.' END,
      manager_id,CASE WHEN manager_id IS NOT NULL THEN p_actor_user_id END,
      CASE WHEN manager_id IS NOT NULL THEN p_at END),$old$,
    $new$    (company_id_value,'PRIMARY_MANAGER','Historical account manager coverage',false,
      'PASSED',NULL,NULL,p_actor_user_id,p_at),$new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Direct company creation MVP patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    $old$    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
    OR NOT public.axora_snapshot_has_permission($old$,
    $new$    OR NOT (public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER')
    OR NOT public.axora_snapshot_has_permission($new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Branded direct company creation MVP patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

-- A browser command may create a company before a logo is available. The
-- payload binding remains immutable and replay-safe; branding stays absent so
-- the established Axora fallback is used until reviewed logo processing runs.
ALTER TABLE public.companies
  DROP CONSTRAINT companies_creation_command_binding_check,
  ADD CONSTRAINT companies_creation_command_binding_check CHECK (
    (creation_command_id IS NULL AND creation_payload_hash IS NULL
      AND creation_logo_sha256 IS NULL)
    OR (creation_command_id IS NOT NULL
      AND creation_payload_hash ~ '^[0-9a-f]{64}$'
      AND (creation_logo_sha256 IS NULL
        OR creation_logo_sha256 ~ '^[0-9a-f]{64}$'))
  );

CREATE OR REPLACE FUNCTION public.axora_create_company_direct(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_command_id uuid,
  p_name text,p_legal_name text,p_industry text,p_company_information text,
  p_website_url text,p_main_contact_name text,p_billing_cycle text,p_notes text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  existing_company public.companies%ROWTYPE;
  company_payload jsonb;
  payload_hash_value text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF p_command_id IS NULL OR actor_snapshot IS NULL
    OR NOT (public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER')
    OR NOT public.axora_snapshot_has_permission(
      actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
    )
  THEN RAISE EXCEPTION 'The company creation scope is unavailable'; END IF;

  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'actorUserId',p_actor_user_id::text,
    'name',btrim(COALESCE(p_name,'')),
    'legalName',btrim(COALESCE(p_legal_name,'')),
    'industry',btrim(COALESCE(p_industry,'')),
    'companyInformation',btrim(COALESCE(p_company_information,'')),
    'websiteUrl',NULLIF(btrim(COALESCE(p_website_url,'')),''),
    'mainContactName',btrim(COALESCE(p_main_contact_name,'')),
    'billingCycle',btrim(COALESCE(p_billing_cycle,'')),
    'notes',NULLIF(btrim(COALESCE(p_notes,'')),'')
  )::text,'UTF8')),'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'company-create-command:'||p_command_id::text,0
  ));
  SELECT * INTO existing_company FROM public.companies company
  WHERE company.creation_command_id=p_command_id FOR UPDATE;
  IF existing_company.id IS NOT NULL THEN
    IF existing_company.created_by IS DISTINCT FROM p_actor_user_id
      OR existing_company.creation_payload_hash IS DISTINCT FROM payload_hash_value
      OR existing_company.creation_logo_sha256 IS NOT NULL
    THEN RETURN jsonb_build_object('status','COMMAND_CONFLICT'); END IF;
    RETURN public.axora_company_mutation_payload(
      existing_company.id,actor_snapshot,p_actor_user_id,p_at,
      'company.created',false,ARRAY[]::uuid[]
    ) || jsonb_build_object(
      'created',false,'creationLogoId',NULL,'creationThemeId',NULL
    );
  END IF;

  company_payload:=public.axora_create_company_record_internal(
    p_actor_user_id,p_actor_role_assignment_id,NULL,p_name,p_legal_name,
    p_industry,p_company_information,p_website_url,p_main_contact_name,
    p_billing_cycle,p_notes,p_at
  );
  UPDATE public.companies SET
    creation_command_id=p_command_id,
    creation_payload_hash=payload_hash_value,
    creation_logo_sha256=NULL
  WHERE id=(company_payload->>'companyId')::uuid;
  RETURN company_payload||jsonb_build_object(
    'created',true,'creationLogoId',NULL,'creationThemeId',NULL
  );
END $$;

DROP TRIGGER IF EXISTS company_creator_primary_assignment ON public.companies;
UPDATE public.company_onboarding_items
SET required=false,status='PASSED',blocking_reason=NULL,
    completed_at=COALESCE(completed_at,now())
WHERE item_code='PRIMARY_MANAGER';

CREATE OR REPLACE FUNCTION public.axora_company_activation_blockers(
  p_company_id uuid
)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(
    array_agg(DISTINCT blocker ORDER BY blocker),ARRAY[]::text[]
  )
  FROM unnest(
    CASE WHEN NOT public.axora_company_has_active_administrator(p_company_id)
      THEN ARRAY['ADMIN_ACTIVATION']::text[] ELSE ARRAY[]::text[] END
  ) blocker
$$;

-- Manage Products is the sole authority for the normal product editor,
-- including its base-cost input. Margin, profit, rule configuration, and
-- commercial history remain separate and are not returned here.
DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_product_administration_catalog(uuid,uuid,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,$old$'catalog.manage'$old$,$new$'product.manage'$new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Product base-cost authorization patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

-- The simple editor treats an unchecked toggle as "return to role default".
-- Replacing the set first retires every old override, so a checked toggle also
-- removes an invisible stale DENY before adding the explicit GRANT if needed.
DO $patch$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)'::regprocedure
  ) INTO definition;
  revised:=replace(definition,
    $old$  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'permission',difference.permission_code,'effect',difference.effect
  ) ORDER BY difference.permission_code),'[]'::jsonb)
  INTO desired_signature
  FROM (
    SELECT permission.permission_code,
      CASE WHEN permission.permission_code=ANY(selected_codes) THEN 'GRANT' ELSE 'DENY' END AS effect
    FROM public.permissions permission
    WHERE permission.active AND (
      (permission.permission_code=ANY(selected_codes) AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions role_permission
        WHERE role_permission.role_id=target_assignment.role_id
          AND role_permission.permission_id=permission.id
      )) OR (
        NOT (permission.permission_code=ANY(selected_codes)) AND EXISTS (
          SELECT 1 FROM public.role_permissions role_permission
          WHERE role_permission.role_id=target_assignment.role_id
            AND role_permission.permission_id=permission.id
        )
      )
    )
  ) difference;$old$,
    $new$  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'permission',difference.permission_code,'effect','GRANT'
  ) ORDER BY difference.permission_code),'[]'::jsonb)
  INTO desired_signature
  FROM (
    SELECT permission.permission_code
    FROM public.permissions permission
    WHERE permission.active
      AND permission.permission_code=ANY(selected_codes)
      AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions role_permission
        WHERE role_permission.role_id=target_assignment.role_id
          AND role_permission.permission_id=permission.id
      )
  ) difference;$new$);
  IF revised=definition THEN
    RAISE EXCEPTION 'Permission replacement semantics patch did not apply';
  END IF;
  EXECUTE revised;
END $patch$;

REVOKE ALL ON FUNCTION public.axora_create_company_direct(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz
) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_create_company_direct(
      uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz
    ) TO axora_app;
  END IF;
END $grants$;

COMMENT ON FUNCTION public.axora_create_company_direct(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz
) IS 'Creates an MVP company without requiring a lead, CAM assignment, or logo; command payload binding remains idempotent.';

COMMIT;
