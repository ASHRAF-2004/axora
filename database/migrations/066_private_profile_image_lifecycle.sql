BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS profile_photo_display_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.profile_image_policies (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000066'::uuid,
  delivery_agent_photo_required boolean NOT NULL DEFAULT false,
  retired_version_retention_days integer NOT NULL DEFAULT 30
    CHECK (retired_version_retention_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id='00000000-0000-4000-8000-000000000066'::uuid)
);

INSERT INTO public.profile_image_policies(id)
VALUES ('00000000-0000-4000-8000-000000000066'::uuid)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.profile_image_versions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  source_content_type text NOT NULL
    CHECK (source_content_type IN ('image/jpeg','image/png','image/webp')),
  source_width integer NOT NULL CHECK (source_width BETWEEN 64 AND 4096),
  source_height integer NOT NULL CHECK (source_height BETWEEN 64 AND 4096),
  focal_x numeric(5,2) NOT NULL CHECK (focal_x BETWEEN 0 AND 100),
  focal_y numeric(5,2) NOT NULL CHECK (focal_y BETWEEN 0 AND 100),
  zoom numeric(4,2) NOT NULL CHECK (zoom BETWEEN 1 AND 3),
  content_type text NOT NULL DEFAULT 'image/webp'
    CHECK (content_type='image/webp'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path_64 text NOT NULL,
  storage_path_128 text NOT NULL,
  storage_path_256 text NOT NULL,
  processing_version text NOT NULL DEFAULT 'axora-profile-image-v1',
  safety_status text NOT NULL DEFAULT 'DECODED_REENCODED'
    CHECK (safety_status='DECODED_REENCODED'),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL,
  retired_at timestamptz,
  retired_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  retired_reason text,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path_64<>storage_path_128
    AND storage_path_64<>storage_path_256
    AND storage_path_128<>storage_path_256),
  CHECK (storage_path_64 ~ '^profile-images/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  CHECK (storage_path_128 ~ '^profile-images/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  CHECK (storage_path_256 ~ '^profile-images/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  CHECK ((status='ACTIVE' AND retired_at IS NULL AND retention_until IS NULL)
    OR (status='RETIRED' AND retired_at IS NOT NULL AND retention_until IS NOT NULL)),
  CHECK (retired_reason IS NULL OR char_length(retired_reason) BETWEEN 3 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_image_versions_one_active_idx
  ON public.profile_image_versions(user_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS profile_image_versions_retention_idx
  ON public.profile_image_versions(retention_until)
  WHERE status='RETIRED';
CREATE INDEX IF NOT EXISTS profile_image_versions_user_history_idx
  ON public.profile_image_versions(user_id,created_at DESC,id);

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS active_avatar_version_id uuid;

DO $profile_image_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='user_profiles_active_avatar_version_fk'
      AND conrelid='public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_active_avatar_version_fk
      FOREIGN KEY (active_avatar_version_id)
      REFERENCES public.profile_image_versions(id)
      ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$profile_image_fk$;

ALTER TABLE public.profile_image_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_image_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profile_image_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_image_policies FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS profile_image_versions_audit
  ON public.profile_image_versions;
CREATE TRIGGER profile_image_versions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.profile_image_versions
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

DROP TRIGGER IF EXISTS profile_image_policies_audit
  ON public.profile_image_policies;
CREATE TRIGGER profile_image_policies_audit
AFTER INSERT OR UPDATE OR DELETE ON public.profile_image_policies
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE OR REPLACE FUNCTION public.axora_profile_image_available(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_snapshot jsonb; authorized boolean:=false;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN false; END IF;
  authorized:=p_actor_user_id=p_target_user_id OR EXISTS (
    SELECT 1 FROM public.axora_user_directory_rows(
      p_actor_user_id,p_actor_role_assignment_id,p_at
    ) visible WHERE visible.user_id=p_target_user_id
  );
  IF NOT authorized THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.user_profiles profile ON profile.user_id=account.id
    LEFT JOIN public.profile_image_versions image
      ON image.id=profile.active_avatar_version_id
     AND image.user_id=profile.user_id AND image.status='ACTIVE'
    WHERE account.id=p_target_user_id
      AND account.active
      AND account.account_status IN ('ACTIVE','INVITED')
      AND (image.id IS NOT NULL OR profile.avatar_content IS NOT NULL)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_profile_image_file(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_delivery_job_id uuid,
  p_size integer,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  version_id uuid,
  storage_path text,
  legacy_content bytea,
  content_type text,
  sha256 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_snapshot jsonb; authorized boolean:=false;
BEGIN
  IF p_size NOT IN (64,128,256) THEN RETURN; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;
  authorized:=public.axora_profile_image_available(
    p_actor_user_id,p_actor_role_assignment_id,p_target_user_id,p_at
  );
  IF NOT authorized AND p_delivery_job_id IS NOT NULL THEN
    authorized:=EXISTS (
      SELECT 1
      FROM public.delivery_jobs job
      JOIN public.delivery_job_assignments assignment
        ON assignment.delivery_job_id=job.id
       AND assignment.driver_user_id=p_target_user_id
       AND assignment.status IN ('ASSIGNED','ACCEPTED')
       AND assignment.ended_at IS NULL
      JOIN public.companies company ON company.id=job.company_id
      WHERE job.id=p_delivery_job_id
        AND job.status NOT IN ('COMPLETED','CANCELLED')
        AND company.profile_photo_display_enabled
        AND public.axora_snapshot_has_permission(
          actor_snapshot,'receiving.confirm','BRANCH',
          job.company_id,job.branch_id,NULL,NULL
        )
        AND public.axora_user_can_receive(
          p_actor_user_id,job.company_id,job.branch_id
        )
    );
  END IF;
  IF NOT authorized THEN RETURN; END IF;

  RETURN QUERY
  SELECT image.id,
    CASE p_size
      WHEN 64 THEN image.storage_path_64
      WHEN 128 THEN image.storage_path_128
      ELSE image.storage_path_256
    END,
    CASE WHEN image.id IS NULL THEN profile.avatar_content END,
    COALESCE(image.content_type,profile.avatar_content_type),
    COALESCE(image.sha256,profile.avatar_sha256)
  FROM public.users account
  JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN public.profile_image_versions image
    ON image.id=profile.active_avatar_version_id
   AND image.user_id=profile.user_id AND image.status='ACTIVE'
  WHERE account.id=p_target_user_id
    AND account.active
    AND account.account_status IN ('ACTIVE','INVITED')
    AND (image.id IS NOT NULL OR profile.avatar_content IS NOT NULL)
  LIMIT 1;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_activate_profile_image(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_version_id uuid,
  p_source_content_type text,
  p_source_width integer,
  p_source_height integer,
  p_focal_x numeric,
  p_focal_y numeric,
  p_zoom numeric,
  p_sha256 text,
  p_storage_path_64 text,
  p_storage_path_128 text,
  p_storage_path_256 text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_snapshot jsonb; target_account record; access_snapshot jsonb;
  current_image record; retention_days integer;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR p_version_id IS NULL
    OR p_source_content_type NOT IN ('image/jpeg','image/png','image/webp')
    OR p_source_width NOT BETWEEN 64 AND 4096
    OR p_source_height NOT BETWEEN 64 AND 4096
    OR p_focal_x NOT BETWEEN 0 AND 100 OR p_focal_y NOT BETWEEN 0 AND 100
    OR p_zoom NOT BETWEEN 1 AND 3
    OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path_64 NOT LIKE
      'profile-images/'||p_target_user_id::text||'/'||p_version_id::text||'/%'
    OR p_storage_path_128 NOT LIKE
      'profile-images/'||p_target_user_id::text||'/'||p_version_id::text||'/%'
    OR p_storage_path_256 NOT LIKE
      'profile-images/'||p_target_user_id::text||'/'||p_version_id::text||'/%'
    OR p_storage_path_64=p_storage_path_128
    OR p_storage_path_64=p_storage_path_256
    OR p_storage_path_128=p_storage_path_256 THEN
    RETURN NULL;
  END IF;

  SELECT account.id,account.active,account.account_status
    INTO target_account
  FROM public.users account WHERE account.id=p_target_user_id FOR UPDATE;
  IF target_account.id IS NULL OR NOT target_account.active
    OR target_account.account_status NOT IN ('ACTIVE','INVITED') THEN
    RETURN NULL;
  END IF;
  IF p_actor_user_id<>p_target_user_id THEN
    access_snapshot:=public.axora_lock_user_target_access(
      p_actor_user_id,p_actor_role_assignment_id,'user.edit',
      p_target_user_id,p_at
    );
    IF access_snapshot IS NULL THEN RETURN NULL; END IF;
  END IF;

  PERFORM 1 FROM public.user_profiles
  WHERE user_id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT image.id,image.sha256 INTO current_image
  FROM public.user_profiles profile
  JOIN public.profile_image_versions image
    ON image.id=profile.active_avatar_version_id
   AND image.user_id=profile.user_id AND image.status='ACTIVE'
  WHERE profile.user_id=p_target_user_id;
  IF current_image.sha256=p_sha256 THEN
    RETURN jsonb_build_object(
      'status','UNCHANGED','versionId',current_image.id
    );
  END IF;

  SELECT retired_version_retention_days INTO retention_days
  FROM public.profile_image_policies
  WHERE id='00000000-0000-4000-8000-000000000066'::uuid;
  UPDATE public.profile_image_versions SET
    status='RETIRED',retired_at=p_at,retired_by=p_actor_user_id,
    retired_reason='REPLACED',
    retention_until=p_at+make_interval(days=>COALESCE(retention_days,30)),
    updated_at=p_at
  WHERE user_id=p_target_user_id AND status='ACTIVE';

  INSERT INTO public.profile_image_versions(
    id,user_id,status,source_content_type,source_width,source_height,
    focal_x,focal_y,zoom,sha256,storage_path_64,storage_path_128,
    storage_path_256,created_by,activated_at,created_at,updated_at
  ) VALUES (
    p_version_id,p_target_user_id,'ACTIVE',p_source_content_type,
    p_source_width,p_source_height,p_focal_x,p_focal_y,p_zoom,p_sha256,
    p_storage_path_64,p_storage_path_128,p_storage_path_256,
    p_actor_user_id,p_at,p_at,p_at
  );
  UPDATE public.user_profiles SET
    active_avatar_version_id=p_version_id,updated_at=p_at
  WHERE user_id=p_target_user_id;
  RETURN jsonb_build_object('status','ACTIVATED','versionId',p_version_id);
END
$$;

CREATE OR REPLACE FUNCTION public.axora_remove_profile_image(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_snapshot jsonb; access_snapshot jsonb; retention_days integer;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR char_length(btrim(COALESCE(p_reason,'')))
    NOT BETWEEN 3 AND 160 THEN RETURN false; END IF;
  IF p_actor_user_id<>p_target_user_id THEN
    access_snapshot:=public.axora_lock_user_target_access(
      p_actor_user_id,p_actor_role_assignment_id,'user.edit',
      p_target_user_id,p_at
    );
    IF access_snapshot IS NULL THEN RETURN false; END IF;
  ELSE
    PERFORM 1 FROM public.users account
    WHERE account.id=p_target_user_id AND account.active
      AND account.account_status IN ('ACTIVE','INVITED') FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  PERFORM 1 FROM public.user_profiles
  WHERE user_id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT retired_version_retention_days INTO retention_days
  FROM public.profile_image_policies
  WHERE id='00000000-0000-4000-8000-000000000066'::uuid;
  UPDATE public.profile_image_versions SET
    status='RETIRED',retired_at=p_at,retired_by=p_actor_user_id,
    retired_reason=btrim(p_reason),
    retention_until=p_at+make_interval(days=>COALESCE(retention_days,30)),
    updated_at=p_at
  WHERE user_id=p_target_user_id AND status='ACTIVE';
  UPDATE public.user_profiles SET
    active_avatar_version_id=NULL,
    avatar_file_name=NULL,avatar_content_type=NULL,
    avatar_content=NULL,avatar_sha256=NULL,updated_at=p_at
  WHERE user_id=p_target_user_id;
  RETURN true;
END
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
DECLARE snapshot jsonb; policy public.profile_image_policies%ROWTYPE;
  company_row record;
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
      INTO company_row
    FROM public.companies company
    WHERE company.id=p_company_id AND company.active;
    IF company_row.id IS NULL THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object(
    'deliveryAgentPhotoRequired',policy.delivery_agent_photo_required,
    'retiredVersionRetentionDays',policy.retired_version_retention_days,
    'companyId',company_row.id,'companyName',company_row.name,
    'companyPhotoDisplayEnabled',company_row.profile_photo_display_enabled
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_update_profile_image_policy(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_delivery_agent_photo_required boolean,
  p_company_photo_display_enabled boolean,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  IF p_company_id IS NULL THEN
    IF p_delivery_agent_photo_required IS NULL
      OR NOT public.axora_snapshot_has_permission(
        snapshot,'settings.manage','PLATFORM',NULL,NULL,NULL,NULL
      ) THEN RETURN NULL; END IF;
    UPDATE public.profile_image_policies SET
      delivery_agent_photo_required=p_delivery_agent_photo_required,
      updated_by=p_actor_user_id,updated_at=p_at
    WHERE id='00000000-0000-4000-8000-000000000066'::uuid;
  ELSE
    IF p_company_photo_display_enabled IS NULL
      OR NOT public.axora_snapshot_has_permission(
        snapshot,'settings.manage','COMPANY',p_company_id,NULL,NULL,NULL
      ) THEN RETURN NULL; END IF;
    UPDATE public.companies SET
      profile_photo_display_enabled=p_company_photo_display_enabled,
      updated_at=p_at
    WHERE id=p_company_id AND active;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN public.axora_profile_image_policy(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_retire_profile_image_on_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE retention_days integer;
BEGIN
  IF (OLD.active AND OLD.account_status IN ('ACTIVE','INVITED'))
    AND (NOT NEW.active OR NEW.account_status NOT IN ('ACTIVE','INVITED')) THEN
    SELECT retired_version_retention_days INTO retention_days
    FROM public.profile_image_policies
    WHERE id='00000000-0000-4000-8000-000000000066'::uuid;
    UPDATE public.profile_image_versions SET
      status='RETIRED',retired_at=now(),retired_by=NULL,
      retired_reason='ACCOUNT_DEACTIVATED',
      retention_until=now()+make_interval(days=>COALESCE(retention_days,30)),
      updated_at=now()
    WHERE user_id=NEW.id AND status='ACTIVE';
    UPDATE public.user_profiles SET
      active_avatar_version_id=NULL,
      avatar_file_name=NULL,avatar_content_type=NULL,
      avatar_content=NULL,avatar_sha256=NULL,updated_at=now()
    WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS retire_profile_image_on_account_deactivation
  ON public.users;
CREATE TRIGGER retire_profile_image_on_account_deactivation
AFTER UPDATE OF active,account_status ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_retire_profile_image_on_deactivation();

CREATE OR REPLACE FUNCTION public.validate_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE driver_is_active boolean; job_status text;
  photo_required boolean; driver_has_photo boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT profile.active AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind='DELIVERY'
      INTO driver_is_active
    FROM public.delivery_agent_profiles profile
    JOIN public.users account ON account.id=profile.user_id
    WHERE profile.user_id=NEW.driver_user_id;
    IF driver_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Only an active delivery driver can be assigned';
    END IF;
    SELECT policy.delivery_agent_photo_required INTO photo_required
    FROM public.profile_image_policies policy
    WHERE policy.id='00000000-0000-4000-8000-000000000066'::uuid;
    IF photo_required THEN
      SELECT (image.id IS NOT NULL OR profile.avatar_content IS NOT NULL)
        INTO driver_has_photo
      FROM public.user_profiles profile
      LEFT JOIN public.profile_image_versions image
        ON image.id=profile.active_avatar_version_id
       AND image.user_id=profile.user_id AND image.status='ACTIVE'
      WHERE profile.user_id=NEW.driver_user_id;
      IF driver_has_photo IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'A processed profile photo is required for this delivery agent';
      END IF;
    END IF;
    IF NOT public.axora_user_is_platform(NEW.assigned_by) THEN
      RAISE EXCEPTION 'Only a platform operator may assign a delivery job';
    END IF;
    IF NEW.driver_role_assignment_id IS NULL THEN
      SELECT role_assignment.id INTO NEW.driver_role_assignment_id
      FROM public.role_assignments role_assignment
      WHERE role_assignment.user_id=NEW.driver_user_id
        AND role_assignment.active AND role_assignment.revoked_at IS NULL
        AND role_assignment.scope_type='DELIVERY'
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            role_assignment.user_id,role_assignment.id,now()
          ),'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
        )
      ORDER BY role_assignment.assigned_at DESC,role_assignment.id LIMIT 1;
    END IF;
    IF NEW.supervisor_role_assignment_id IS NULL THEN
      NEW.supervisor_role_assignment_id:=public.axora_context_role_assignment_id();
    END IF;
    SELECT status INTO job_status FROM public.delivery_jobs
    WHERE id=NEW.delivery_job_id AND company_id=NEW.company_id;
    IF job_status IS NULL OR job_status IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'A terminal or missing delivery job cannot be assigned';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','accepted_at','ended_at','updated_at'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','accepted_at','ended_at','updated_at']) THEN
      RAISE EXCEPTION 'Delivery assignment identity is immutable';
    END IF;
    IF OLD.status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED')
      AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'A terminal assignment cannot be reopened';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON TABLE public.profile_image_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.profile_image_policies FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_profile_image_available(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_profile_image_file(
  uuid,uuid,uuid,uuid,integer,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_activate_profile_image(
  uuid,uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,
  text,text,text,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_remove_profile_image(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_profile_image_policy(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_update_profile_image_policy(
  uuid,uuid,uuid,boolean,boolean,timestamptz
) FROM PUBLIC;

DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.profile_image_versions FROM axora_app;
    REVOKE ALL ON TABLE public.profile_image_policies FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_profile_image_available(
      uuid,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_profile_image_file(
      uuid,uuid,uuid,uuid,integer,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_activate_profile_image(
      uuid,uuid,uuid,uuid,text,integer,integer,numeric,numeric,numeric,
      text,text,text,text,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_remove_profile_image(
      uuid,uuid,uuid,text,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_profile_image_policy(
      uuid,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_update_profile_image_policy(
      uuid,uuid,uuid,boolean,boolean,timestamptz
    ) TO axora_app;
  END IF;
END
$axora_runtime_role$;

COMMIT;
