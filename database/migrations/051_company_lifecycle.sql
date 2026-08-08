BEGIN;

-- P0-04: company onboarding is a lifecycle, not a boolean. The existing
-- companies.active column remains the procurement transaction gate so every
-- request, approval, and delivery boundary added in P0-01/P0-02 keeps its
-- meaning. Lifecycle and publication are deliberately separate.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS registration_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lifecycle_status text,
  ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS duplicate_review_status text NOT NULL DEFAULT 'CLEAR',
  ADD COLUMN IF NOT EXISTS is_publicly_listed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.companies
SET legal_name=COALESCE(NULLIF(btrim(legal_name),''),name),
    lifecycle_status=COALESCE(
      lifecycle_status,
      CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END
    ),
    portal_access_enabled=CASE WHEN active THEN true ELSE portal_access_enabled END,
    activated_at=CASE WHEN active THEN COALESCE(activated_at,created_at) ELSE activated_at END,
    lifecycle_updated_at=COALESCE(lifecycle_updated_at,updated_at,created_at,now());

ALTER TABLE public.companies
  ALTER COLUMN legal_name SET NOT NULL,
  ALTER COLUMN lifecycle_status SET NOT NULL;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_legal_name_check,
  DROP CONSTRAINT IF EXISTS companies_registration_number_check,
  DROP CONSTRAINT IF EXISTS companies_lifecycle_status_check,
  DROP CONSTRAINT IF EXISTS companies_lifecycle_version_check,
  DROP CONSTRAINT IF EXISTS companies_duplicate_review_status_check,
  DROP CONSTRAINT IF EXISTS companies_lifecycle_active_check,
  DROP CONSTRAINT IF EXISTS companies_portal_access_check,
  DROP CONSTRAINT IF EXISTS companies_activation_evidence_check,
  DROP CONSTRAINT IF EXISTS companies_suspension_evidence_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_legal_name_check CHECK (
    char_length(btrim(legal_name)) BETWEEN 2 AND 300
  ),
  ADD CONSTRAINT companies_registration_number_check CHECK (
    char_length(btrim(registration_number)) <= 160
  ),
  ADD CONSTRAINT companies_lifecycle_status_check CHECK (
    lifecycle_status IN (
      'NEW_LEAD','UNDER_REVIEW','ASSIGNED','CONTACTED',
      'INFORMATION_PENDING','ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
      'COMPANY_ADMINISTRATOR_INVITED','COMPANY_ADMINISTRATOR_ACTIVATED',
      'ACTIVE','DUPLICATE','REJECTED','INACTIVE','SUSPENDED','ARCHIVED'
    )
  ),
  ADD CONSTRAINT companies_lifecycle_version_check CHECK (lifecycle_version > 0),
  ADD CONSTRAINT companies_duplicate_review_status_check CHECK (
    duplicate_review_status IN ('CLEAR','POSSIBLE_DUPLICATE','CLEARED','CONFIRMED')
  ),
  ADD CONSTRAINT companies_lifecycle_active_check CHECK (
    active=(lifecycle_status='ACTIVE')
  ),
  ADD CONSTRAINT companies_portal_access_check CHECK (
    NOT portal_access_enabled OR active
  ),
  ADD CONSTRAINT companies_activation_evidence_check CHECK (
    lifecycle_status<>'ACTIVE' OR activated_at IS NOT NULL
  ),
  ADD CONSTRAINT companies_suspension_evidence_check CHECK (
    lifecycle_status<>'SUSPENDED'
    OR (suspended_at IS NOT NULL
      AND char_length(btrim(COALESCE(suspension_reason,''))) BETWEEN 3 AND 1000)
  );

-- Hybrid imports and older administrative fixtures may still use the original
-- companies insert shape. Derive only missing lifecycle fields on INSERT; all
-- later changes remain behind the lifecycle capabilities below.
CREATE OR REPLACE FUNCTION public.axora_default_inserted_company_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  NEW.legal_name:=COALESCE(NULLIF(btrim(NEW.legal_name),''),NEW.name);
  IF NEW.lifecycle_status IS NULL THEN
    NEW.lifecycle_status:=CASE WHEN NEW.active THEN 'ACTIVE' ELSE 'NEW_LEAD' END;
  END IF;
  NEW.active:=NEW.lifecycle_status='ACTIVE';
  NEW.portal_access_enabled:=NEW.lifecycle_status='ACTIVE';
  IF NEW.lifecycle_status='ACTIVE' THEN
    NEW.activated_at:=COALESCE(NEW.activated_at,NEW.created_at,now());
  END IF;
  NEW.lifecycle_updated_at:=COALESCE(NEW.lifecycle_updated_at,NEW.created_at,now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS default_inserted_company_lifecycle ON public.companies;
CREATE TRIGGER default_inserted_company_lifecycle
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_default_inserted_company_lifecycle();

-- Exact names are duplicate evidence, not an instruction to merge or reject.
DROP INDEX IF EXISTS public.companies_name_lower_uq;
CREATE INDEX IF NOT EXISTS companies_name_lower_idx
  ON public.companies(lower(name));
CREATE INDEX IF NOT EXISTS companies_legal_name_lower_idx
  ON public.companies(lower(legal_name));
CREATE INDEX IF NOT EXISTS companies_registration_number_lower_idx
  ON public.companies(lower(registration_number))
  WHERE btrim(registration_number)<>'';
CREATE INDEX IF NOT EXISTS companies_lifecycle_status_idx
  ON public.companies(lifecycle_status,lifecycle_updated_at DESC,id);
CREATE INDEX IF NOT EXISTS companies_public_listing_idx
  ON public.companies(name,id) WHERE is_publicly_listed;

CREATE TABLE IF NOT EXISTS public.company_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  lifecycle_version integer NOT NULL CHECK (lifecycle_version > 0),
  from_status text,
  to_status text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata)
  ),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,lifecycle_version),
  CHECK (from_status IS NULL OR from_status<>to_status),
  CHECK (char_length(btrim(COALESCE(reason,''))) <= 1000)
);
CREATE INDEX IF NOT EXISTS company_status_history_company_idx
  ON public.company_status_history(company_id,lifecycle_version DESC);

CREATE TABLE IF NOT EXISTS public.company_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL CHECK (assignment_type IN ('PRIMARY','BACKUP')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  coverage_starts_at timestamptz NOT NULL DEFAULT now(),
  coverage_ends_at timestamptz,
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  assignment_reason text NOT NULL CHECK (
    char_length(btrim(assignment_reason)) BETWEEN 3 AND 1000
  ),
  end_reason text CHECK (char_length(btrim(COALESCE(end_reason,''))) <= 1000),
  CHECK (coverage_ends_at IS NULL OR coverage_ends_at>coverage_starts_at),
  CHECK (assignment_type='PRIMARY' OR coverage_ends_at IS NOT NULL),
  CHECK (
    (status='ACTIVE' AND ended_at IS NULL AND ended_by IS NULL)
    OR (status='ENDED' AND ended_at IS NOT NULL AND ended_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS company_assignments_one_primary_uq
  ON public.company_assignments(company_id)
  WHERE assignment_type='PRIMARY' AND status='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS company_assignments_one_backup_uq
  ON public.company_assignments(company_id)
  WHERE assignment_type='BACKUP' AND status='ACTIVE';
CREATE INDEX IF NOT EXISTS company_assignments_manager_access_idx
  ON public.company_assignments(manager_user_id,status,coverage_starts_at,coverage_ends_at,company_id);

CREATE TABLE IF NOT EXISTS public.company_onboarding_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  item_code text NOT NULL CHECK (item_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 200),
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PASSED','FAILED','WAIVED')),
  blocking_reason text CHECK (
    char_length(btrim(COALESCE(blocking_reason,''))) <= 1000
  ),
  assigned_manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,item_code),
  CHECK (
    (status IN ('PASSED','WAIVED') AND completed_at IS NOT NULL)
    OR (status IN ('PENDING','FAILED') AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS company_onboarding_items_open_idx
  ON public.company_onboarding_items(company_id,item_code)
  WHERE required AND status NOT IN ('PASSED','WAIVED');

CREATE TABLE IF NOT EXISTS public.company_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  candidate_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  matched_fields jsonb NOT NULL CHECK (
    jsonb_typeof(matched_fields)='array' AND jsonb_array_length(matched_fields)>0
  ),
  review_status text NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING','CLEARED','CONFIRMED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text CHECK (
    char_length(btrim(COALESCE(review_reason,''))) <= 1000
  ),
  UNIQUE(company_id,candidate_company_id),
  CHECK (company_id<>candidate_company_id),
  CHECK (
    (review_status='PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (review_status<>'PENDING' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.company_publication_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  is_publicly_listed boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  changed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_publication_history_company_idx
  ON public.company_publication_history(company_id,changed_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.axora_seed_legacy_company_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.company_status_history(
    company_id,lifecycle_version,from_status,to_status,reason,metadata,changed_at
  ) VALUES (
    NEW.id,NEW.lifecycle_version,NULL,NEW.lifecycle_status,
    'Lifecycle baseline created for a compatible company insert',
    jsonb_build_object('source','COMPATIBLE_INSERT_051'),NEW.created_at
  ) ON CONFLICT(company_id,lifecycle_version) DO NOTHING;

  INSERT INTO public.company_onboarding_items(
    company_id,item_code,label,required,status,blocking_reason,completed_at
  )
  SELECT NEW.id,item.item_code,item.label,true,
    CASE WHEN NEW.lifecycle_status='ACTIVE' THEN 'PASSED' ELSE 'PENDING' END,
    CASE WHEN NEW.lifecycle_status='ACTIVE' THEN NULL ELSE item.blocking_reason END,
    CASE WHEN NEW.lifecycle_status='ACTIVE' THEN NEW.activated_at ELSE NULL END
  FROM (VALUES
    ('LEGAL_IDENTITY','Legal identity and registration','Legal identity or registration number is incomplete.'),
    ('PRIMARY_CONTACT','Primary company contact','Primary contact details are incomplete.'),
    ('BILLING_CONFIGURATION','Billing configuration','Billing details are incomplete.'),
    ('APPROVED_BRAND','Reviewed logo and generated theme','An approved logo and generated theme are required.'),
    ('PRIMARY_MANAGER','Primary Client Account Manager','Assign a primary Client Account Manager.'),
    ('COMPANY_REVIEW','Company onboarding review','Complete the company review.'),
    ('ADMIN_INVITATION','Company Administrator invitation','Issue a valid Company Administrator invitation.'),
    ('ADMIN_ACTIVATION','Company Administrator activation','The invited Company Administrator must complete account setup.')
  ) AS item(item_code,label,blocking_reason)
  ON CONFLICT(company_id,item_code) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_legacy_company_lifecycle ON public.companies;
CREATE TRIGGER seed_legacy_company_lifecycle
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_legacy_company_lifecycle();

INSERT INTO public.company_status_history(
  company_id,lifecycle_version,from_status,to_status,reason,metadata,changed_at
)
SELECT company.id,company.lifecycle_version,NULL,company.lifecycle_status,
  'Lifecycle baseline created for an existing company',
  jsonb_build_object('source','MIGRATION_051'),company.created_at
FROM public.companies company
ON CONFLICT(company_id,lifecycle_version) DO NOTHING;

INSERT INTO public.company_onboarding_items(
  company_id,item_code,label,required,status,blocking_reason,completed_at
)
SELECT company.id,item.item_code,item.label,true,
  CASE WHEN company.lifecycle_status='ACTIVE' THEN 'PASSED' ELSE item.initial_status END,
  CASE WHEN company.lifecycle_status='ACTIVE' THEN NULL ELSE item.blocking_reason END,
  CASE WHEN company.lifecycle_status='ACTIVE' THEN company.activated_at ELSE NULL END
FROM public.companies company
CROSS JOIN (VALUES
  ('LEGAL_IDENTITY','Legal identity and registration','PENDING','Legal identity or registration number is incomplete.'),
  ('PRIMARY_CONTACT','Primary company contact','PENDING','Primary contact details are incomplete.'),
  ('BILLING_CONFIGURATION','Billing configuration','PENDING','Billing details are incomplete.'),
  ('APPROVED_BRAND','Reviewed logo and generated theme','PENDING','An approved logo and generated theme are required.'),
  ('PRIMARY_MANAGER','Primary Client Account Manager','PENDING','Assign a primary Client Account Manager.'),
  ('COMPANY_REVIEW','Company onboarding review','PENDING','Complete the company review.'),
  ('ADMIN_INVITATION','Company Administrator invitation','PENDING','Issue a valid Company Administrator invitation.'),
  ('ADMIN_ACTIVATION','Company Administrator activation','PENDING','The invited Company Administrator must complete account setup.')
) AS item(item_code,label,initial_status,blocking_reason)
ON CONFLICT(company_id,item_code) DO NOTHING;

-- Existing inactive companies retain their data but must satisfy the new
-- checklist before they can be activated again. Derivable fields are passed.
UPDATE public.company_onboarding_items item
SET status='PASSED',blocking_reason=NULL,completed_at=company.created_at
FROM public.companies company
WHERE item.company_id=company.id
  AND company.lifecycle_status<>'ACTIVE'
  AND (
    (item.item_code='LEGAL_IDENTITY'
      AND btrim(company.legal_name)<>'' AND btrim(company.registration_number)<>'')
    OR (item.item_code='PRIMARY_CONTACT'
      AND btrim(company.main_contact_email)<>'' AND btrim(company.main_contact_phone)<>'')
    OR (item.item_code='BILLING_CONFIGURATION'
      AND btrim(company.billing_address)<>'' AND btrim(company.billing_cycle)<>'')
    OR (item.item_code='APPROVED_BRAND' AND EXISTS (
      SELECT 1 FROM public.company_logos logo
      JOIN public.company_brand_themes theme
        ON theme.company_id=logo.company_id AND theme.source_logo_id=logo.id
      WHERE logo.company_id=company.id AND logo.active AND theme.active
    ))
  );

DROP TRIGGER IF EXISTS company_status_history_append_only ON public.company_status_history;
CREATE TRIGGER company_status_history_append_only
BEFORE UPDATE OR DELETE ON public.company_status_history
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
DROP TRIGGER IF EXISTS company_publication_history_append_only ON public.company_publication_history;
CREATE TRIGGER company_publication_history_append_only
BEFORE UPDATE OR DELETE ON public.company_publication_history
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_company_assignments ON public.company_assignments;
CREATE TRIGGER audit_company_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.company_assignments
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
DROP TRIGGER IF EXISTS audit_company_onboarding_items ON public.company_onboarding_items;
CREATE TRIGGER audit_company_onboarding_items
AFTER INSERT OR UPDATE OR DELETE ON public.company_onboarding_items
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
DROP TRIGGER IF EXISTS set_updated_at_company_onboarding_items ON public.company_onboarding_items;
CREATE TRIGGER set_updated_at_company_onboarding_items
BEFORE UPDATE ON public.company_onboarding_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.axora_normalize_company_identity(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_value,'')),'[^[:alnum:]]+','','g'))
$$;

CREATE OR REPLACE FUNCTION public.axora_normalize_company_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(p_value,''),'[^0-9]+','','g')
$$;

CREATE OR REPLACE FUNCTION public.axora_company_email_domain(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN position('@' IN lower(btrim(COALESCE(p_value,''))))>1
      THEN split_part(lower(btrim(p_value)),'@',2)
    ELSE ''
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_company_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'NEW_LEAD' THEN 10 WHEN 'UNDER_REVIEW' THEN 20
    WHEN 'ASSIGNED' THEN 30 WHEN 'CONTACTED' THEN 40
    WHEN 'INFORMATION_PENDING' THEN 50 WHEN 'ONBOARDING' THEN 60
    WHEN 'PORTAL_DRAFT' THEN 70 WHEN 'COMPANY_REVIEW' THEN 80
    WHEN 'COMPANY_ADMINISTRATOR_INVITED' THEN 90
    WHEN 'COMPANY_ADMINISTRATOR_ACTIVATED' THEN 100
    WHEN 'ACTIVE' THEN 110 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.axora_company_snapshot_role_permission(
  p_snapshot jsonb,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_snapshot->'rolePermissions','[]'::jsonb) ? p_permission_code
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(p_snapshot->'permissionOverrides','[]'::jsonb)
      ) override_row
      WHERE override_row->>'permission'=p_permission_code
        AND override_row->>'effect'='DENY'
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_is_owner(p_snapshot jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((p_snapshot->>'isOwner')::boolean,false)
    AND p_snapshot->>'accountKind'='PLATFORM'
    AND p_snapshot->>'roleKey'='PLATFORM_OWNER'
$$;

CREATE OR REPLACE FUNCTION public.axora_company_assignment_is_active(
  p_actor_user_id uuid,
  p_company_id uuid,
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
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_view(
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF public.axora_company_actor_is_owner(p_snapshot) THEN RETURN true; END IF;

  IF p_snapshot->>'accountKind'='PLATFORM'
    AND p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
    RETURN public.axora_company_assignment_is_active(
      p_actor_user_id,p_company_id,p_at
    );
  END IF;

  IF p_snapshot->>'accountKind'='COMPANY'
    AND p_snapshot->>'roleKey'='COMPANY_ADMIN'
    AND public.axora_snapshot_scope_contains(
      p_snapshot,'COMPANY',p_company_id,NULL,NULL,NULL
    ) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.account_setup_invitations invitation
      WHERE invitation.user_id=p_actor_user_id
        AND invitation.company_id=p_company_id
        AND invitation.revoked_at IS NULL
        AND (invitation.delivery_status='SENT' OR invitation.consumed_at IS NOT NULL)
    );
  END IF;

  RETURN false;
END $$;

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
    AND public.axora_company_assignment_is_active(
      p_actor_user_id,p_company_id,p_at
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

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_create(
  p_snapshot jsonb,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT (
    public.axora_company_actor_is_owner(p_snapshot)
    OR (
      p_snapshot->>'accountKind'='PLATFORM'
      AND p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
  ) AND public.axora_company_snapshot_role_permission(
    p_snapshot,p_permission_code
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_activation_blockers(
  p_company_id uuid
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT ARRAY(
    SELECT blocker
    FROM (
      SELECT item.item_code AS blocker,1 AS order_key
      FROM public.company_onboarding_items item
      WHERE item.company_id=p_company_id
        AND item.required
        AND item.status NOT IN ('PASSED','WAIVED')
      UNION ALL
      SELECT 'DUPLICATE_REVIEW',2
      FROM public.companies company
      WHERE company.id=p_company_id
        AND company.duplicate_review_status IN ('POSSIBLE_DUPLICATE','CONFIRMED')
    ) blockers
    ORDER BY order_key,blocker
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_apply_company_status(
  p_company_id uuid,
  p_to_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  old_status text;
  next_version integer;
BEGIN
  SELECT lifecycle_status INTO old_status
  FROM public.companies
  WHERE id=p_company_id
  FOR UPDATE;
  IF old_status IS NULL OR old_status=p_to_status THEN
    RAISE EXCEPTION 'The company lifecycle transition is unavailable';
  END IF;

  UPDATE public.companies
  SET lifecycle_status=p_to_status,
      lifecycle_version=lifecycle_version+1,
      lifecycle_updated_at=p_at,
      active=(p_to_status='ACTIVE'),
      portal_access_enabled=(p_to_status='ACTIVE'),
      activated_at=CASE
        WHEN p_to_status='ACTIVE' THEN COALESCE(activated_at,p_at)
        ELSE activated_at END,
      activated_by=CASE
        WHEN p_to_status='ACTIVE' THEN COALESCE(activated_by,p_actor_user_id)
        ELSE activated_by END,
      suspended_at=CASE WHEN p_to_status='SUSPENDED' THEN p_at
        WHEN p_to_status='ACTIVE' THEN NULL ELSE suspended_at END,
      suspension_reason=CASE WHEN p_to_status='SUSPENDED' THEN btrim(p_reason)
        WHEN p_to_status='ACTIVE' THEN NULL ELSE suspension_reason END
  WHERE id=p_company_id
  RETURNING lifecycle_version INTO next_version;

  INSERT INTO public.company_status_history(
    company_id,lifecycle_version,from_status,to_status,reason,metadata,
    changed_by,changed_at
  ) VALUES (
    p_company_id,next_version,old_status,p_to_status,NULLIF(btrim(p_reason),''),
    COALESCE(p_metadata,'{}'::jsonb),p_actor_user_id,p_at
  );
  RETURN next_version;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_notification_recipient_ids(
  p_company_id uuid,
  p_include_company_admins boolean,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(recipient.id ORDER BY recipient.id),'[]'::jsonb)
  FROM (
    SELECT DISTINCT account.id
    FROM public.users account
    WHERE account.active AND account.account_status='ACTIVE'
      AND (
        account.is_owner
        OR EXISTS (
          SELECT 1 FROM public.company_assignments assignment
          WHERE assignment.company_id=p_company_id
            AND assignment.manager_user_id=account.id
            AND assignment.status='ACTIVE'
            AND assignment.coverage_starts_at<=p_at
            AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>p_at)
        )
        OR (p_include_company_admins AND EXISTS (
          SELECT 1
          FROM public.role_assignments role_assignment
          JOIN public.roles role ON role.id=role_assignment.role_id
          WHERE role_assignment.user_id=account.id
            AND role_assignment.company_id=p_company_id
            AND role_assignment.active AND role_assignment.revoked_at IS NULL
            AND role.role_key='COMPANY_ADMIN'
        ))
      )
  ) recipient
$$;

CREATE OR REPLACE FUNCTION public.axora_company_lifecycle_record(
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
  result jsonb;
  actions text[];
  blockers text[];
  is_owner boolean:=public.axora_company_actor_is_owner(p_snapshot);
  can_edit boolean;
  can_assign boolean;
  can_reassign boolean;
  can_activate boolean;
  can_suspend boolean;
  can_publish boolean;
  company_status text;
  primary_exists boolean;
  backup_exists boolean;
BEGIN
  IF NOT public.axora_company_actor_can_view(
    p_snapshot,p_actor_user_id,p_company_id,p_at
  ) THEN RETURN NULL; END IF;

  SELECT lifecycle_status INTO company_status
  FROM public.companies WHERE id=p_company_id;
  IF company_status IS NULL THEN RETURN NULL; END IF;

  can_edit:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
  );
  can_assign:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.lead.assign',p_at
  );
  can_reassign:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.lead.reassign',p_at
  );
  can_activate:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
  );
  can_suspend:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.suspend',p_at
  );
  can_publish:=public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.portal.publish',p_at
  );
  SELECT EXISTS (
    SELECT 1 FROM public.company_assignments
    WHERE company_id=p_company_id AND assignment_type='PRIMARY' AND status='ACTIVE'
  ),EXISTS (
    SELECT 1 FROM public.company_assignments
    WHERE company_id=p_company_id AND assignment_type='BACKUP' AND status='ACTIVE'
  ) INTO primary_exists,backup_exists;
  blockers:=public.axora_company_activation_blockers(p_company_id);

  actions:=array_remove(ARRAY[
    CASE WHEN can_edit AND company_status='NEW_LEAD' THEN 'START_REVIEW' END,
    CASE WHEN can_assign AND NOT primary_exists
      AND company_status NOT IN ('DUPLICATE','REJECTED','ARCHIVED') THEN 'ASSIGN' END,
    CASE WHEN can_reassign AND primary_exists
      AND company_status NOT IN ('DUPLICATE','REJECTED','ARCHIVED') THEN 'REASSIGN' END,
    CASE WHEN can_assign AND primary_exists AND NOT backup_exists
      AND company_status NOT IN ('DUPLICATE','REJECTED','ARCHIVED') THEN 'ADD_BACKUP' END,
    CASE WHEN can_reassign AND backup_exists
      AND company_status NOT IN ('DUPLICATE','REJECTED','ARCHIVED') THEN 'REPLACE_BACKUP' END,
    CASE WHEN can_edit AND company_status='ASSIGNED' THEN 'MARK_CONTACTED' END,
    CASE WHEN can_edit AND company_status IN ('CONTACTED','ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW')
      THEN 'REQUEST_INFORMATION' END,
    CASE WHEN can_edit AND company_status IN ('CONTACTED','INFORMATION_PENDING') THEN 'START_ONBOARDING' END,
    CASE WHEN can_edit AND company_status='ONBOARDING' THEN 'CREATE_PORTAL_DRAFT' END,
    CASE WHEN can_edit AND company_status='PORTAL_DRAFT' THEN 'SUBMIT_COMPANY_REVIEW' END,
    CASE WHEN is_owner AND company_status='COMPANY_REVIEW' THEN 'INVITE_ADMINISTRATOR' END,
    CASE WHEN is_owner AND company_status IN ('COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED')
      THEN 'SYNC_ADMINISTRATOR' END,
    CASE WHEN can_activate AND company_status IN ('COMPANY_ADMINISTRATOR_ACTIVATED','SUSPENDED')
      THEN 'ACTIVATE' END,
    CASE WHEN can_suspend AND company_status='ACTIVE' THEN 'SUSPEND' END,
    CASE WHEN can_suspend AND company_status IN ('ACTIVE','SUSPENDED') THEN 'MARK_INACTIVE' END,
    CASE WHEN can_edit AND company_status NOT IN ('ACTIVE','ARCHIVED') THEN 'ARCHIVE' END,
    CASE WHEN can_edit AND company_status IN ('NEW_LEAD','UNDER_REVIEW') THEN 'MARK_DUPLICATE' END,
    CASE WHEN can_edit AND company_status IN ('NEW_LEAD','UNDER_REVIEW') THEN 'REJECT' END,
    CASE WHEN can_edit AND EXISTS (
      SELECT 1 FROM public.companies duplicate_company
      WHERE duplicate_company.id=p_company_id
        AND duplicate_company.duplicate_review_status='POSSIBLE_DUPLICATE'
    ) THEN 'CLEAR_DUPLICATE' END,
    CASE WHEN can_publish AND NOT EXISTS (
      SELECT 1 FROM public.companies publication_company
      WHERE publication_company.id=p_company_id
        AND publication_company.is_publicly_listed
    ) THEN 'PUBLISH' END,
    CASE WHEN can_publish AND EXISTS (
      SELECT 1 FROM public.companies publication_company
      WHERE publication_company.id=p_company_id
        AND publication_company.is_publicly_listed
    ) THEN 'UNPUBLISH' END
  ]::text[],NULL);

  SELECT jsonb_build_object(
    'id',company.id,
    'code',company.company_code,
    'name',company.name,
    'legalName',company.legal_name,
    'registrationNumber',company.registration_number,
    'industry',company.industry,
    'companyInformation',company.company_information,
    'websiteUrl',company.website_url,
    'mainContactName',company.main_contact_name,
    'mainContactEmail',company.main_contact_email,
    'mainContactPhone',company.main_contact_phone,
    'billingContactName',company.billing_contact_name,
    'billingContactEmail',company.billing_contact_email,
    'billingContactPhone',company.billing_contact_phone,
    'billingAddress',company.billing_address,
    'paymentTerms',company.payment_terms,
    'billingCycle',company.billing_cycle,
    'notes',company.notes,
    'status',company.lifecycle_status,
    'version',company.lifecycle_version,
    'active',company.active,
    'portalAccessEnabled',company.portal_access_enabled,
    'isPubliclyListed',company.is_publicly_listed,
    'duplicateReviewStatus',company.duplicate_review_status,
    'createdAt',company.created_at,
    'updatedAt',company.updated_at,
    'activatedAt',company.activated_at,
    'suspendedAt',company.suspended_at,
    'suspensionReason',company.suspension_reason,
    'isAssignedToActor',public.axora_company_assignment_is_active(
      p_actor_user_id,company.id,p_at
    ),
    'primaryManager',(
      SELECT jsonb_build_object(
        'id',manager.id,'name',manager.display_name,'email',manager.email,
        'assignedAt',assignment.assigned_at
      )
      FROM public.company_assignments assignment
      JOIN public.users manager ON manager.id=assignment.manager_user_id
      WHERE assignment.company_id=company.id
        AND assignment.assignment_type='PRIMARY' AND assignment.status='ACTIVE'
      LIMIT 1
    ),
    'backupManager',(
      SELECT jsonb_build_object(
        'id',manager.id,'name',manager.display_name,'email',manager.email,
        'coverageStartsAt',assignment.coverage_starts_at,
        'coverageEndsAt',assignment.coverage_ends_at
      )
      FROM public.company_assignments assignment
      JOIN public.users manager ON manager.id=assignment.manager_user_id
      WHERE assignment.company_id=company.id
        AND assignment.assignment_type='BACKUP' AND assignment.status='ACTIVE'
      LIMIT 1
    ),
    'onboarding',(
      SELECT jsonb_build_object(
        'required',count(*) FILTER (WHERE item.required),
        'passed',count(*) FILTER (
          WHERE item.required AND item.status IN ('PASSED','WAIVED')
        ),
        'items',COALESCE(jsonb_agg(jsonb_build_object(
          'code',item.item_code,'label',item.label,'required',item.required,
          'status',item.status,'blockingReason',item.blocking_reason,
          'completedAt',item.completed_at
        ) ORDER BY item.item_code),'[]'::jsonb)
      )
      FROM public.company_onboarding_items item
      WHERE item.company_id=company.id
    ),
    'duplicateCandidates',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',candidate.id,'code',candidate.company_code,'name',candidate.name,
        'matchedFields',duplicate_match.matched_fields,
        'reviewStatus',duplicate_match.review_status
      ) ORDER BY candidate.name,candidate.id)
      FROM public.company_duplicate_candidates duplicate_match
      JOIN public.companies candidate
        ON candidate.id=duplicate_match.candidate_company_id
      WHERE duplicate_match.company_id=company.id
    ),'[]'::jsonb),
    'history',COALESCE((
      SELECT jsonb_agg(history_row.entry ORDER BY history_row.lifecycle_version)
      FROM (
        SELECT history.lifecycle_version,jsonb_build_object(
          'version',history.lifecycle_version,'fromStatus',history.from_status,
          'toStatus',history.to_status,'reason',history.reason,
          'changedAt',history.changed_at,'changedByName',actor.display_name
        ) AS entry
        FROM public.company_status_history history
        LEFT JOIN public.users actor ON actor.id=history.changed_by
        WHERE history.company_id=company.id
        ORDER BY history.lifecycle_version DESC
        LIMIT 20
      ) history_row
    ),'[]'::jsonb),
    'activationBlockedReasons',to_jsonb(blockers),
    'availableActions',to_jsonb(actions)
  ) INTO result
  FROM public.companies company
  WHERE company.id=p_company_id;
  RETURN result;
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
        'id',manager.id,'name',manager.display_name,'email',manager.email
      ) ORDER BY manager.display_name,manager.id)
      FROM public.users manager
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

CREATE OR REPLACE FUNCTION public.axora_create_company_lead(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_name text,
  p_legal_name text,
  p_registration_number text,
  p_industry text,
  p_company_information text,
  p_website_url text,
  p_main_contact_name text,
  p_main_contact_email text,
  p_main_contact_phone text,
  p_billing_contact_name text,
  p_billing_contact_email text,
  p_billing_contact_phone text,
  p_billing_address text,
  p_payment_terms text,
  p_billing_cycle text,
  p_notes text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  company_id uuid;
  company_domain text;
  duplicate_count integer;
  actor_auto_assigned boolean:=false;
  identity_lock text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR NOT public.axora_company_actor_can_create(
    actor_snapshot,'company.lead.create'
  ) THEN RAISE EXCEPTION 'The company creation scope is unavailable'; END IF;

  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_legal_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_registration_number,''))) NOT BETWEEN 1 AND 160
    OR char_length(btrim(COALESCE(p_industry,''))) NOT BETWEEN 1 AND 300
    OR char_length(btrim(COALESCE(p_main_contact_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_main_contact_email,''))) NOT BETWEEN 3 AND 320
    OR position('@' IN p_main_contact_email)=0
    OR char_length(btrim(COALESCE(p_main_contact_phone,''))) NOT BETWEEN 3 AND 120
    OR char_length(btrim(COALESCE(p_billing_address,''))) NOT BETWEEN 3 AND 5000
    OR p_payment_terms<>'Cash on delivery (COD)' THEN
    RAISE EXCEPTION 'The company details are invalid';
  END IF;

  identity_lock:=concat_ws(':',
    public.axora_normalize_company_identity(p_registration_number),
    public.axora_normalize_company_identity(p_legal_name),
    public.axora_normalize_company_identity(p_name),
    public.axora_company_email_domain(p_main_contact_email),
    lower(btrim(p_main_contact_email)),
    public.axora_normalize_company_phone(p_main_contact_phone)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('axora-company-create:' || identity_lock,0)
  );

  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason','Company lead created',true);

  INSERT INTO public.companies(
    company_code,name,legal_name,registration_number,industry,
    company_information,website_url,main_contact_name,main_contact_email,
    main_contact_phone,billing_contact_name,billing_contact_email,
    billing_contact_phone,billing_address,payment_terms,billing_cycle,notes,
    active,lifecycle_status,lifecycle_version,portal_access_enabled,
    is_publicly_listed,created_by,lifecycle_updated_at
  ) VALUES (
    public.next_company_code(),btrim(p_name),btrim(p_legal_name),
    btrim(p_registration_number),btrim(p_industry),btrim(p_company_information),
    NULLIF(btrim(COALESCE(p_website_url,'')),''),btrim(p_main_contact_name),
    lower(btrim(p_main_contact_email)),btrim(p_main_contact_phone),
    btrim(p_billing_contact_name),lower(btrim(p_billing_contact_email)),
    btrim(p_billing_contact_phone),btrim(p_billing_address),p_payment_terms,
    btrim(p_billing_cycle),NULLIF(btrim(COALESCE(p_notes,'')),''),
    false,'NEW_LEAD',1,false,false,p_actor_user_id,p_at
  ) RETURNING id INTO company_id;

  INSERT INTO public.company_status_history(
    company_id,lifecycle_version,from_status,to_status,reason,metadata,
    changed_by,changed_at
  ) VALUES (
    company_id,1,NULL,'NEW_LEAD','Company lead created',
    jsonb_build_object('source','COMPANY_CREATE'),p_actor_user_id,p_at
  );

  company_domain:=public.axora_company_email_domain(p_main_contact_email);
  INSERT INTO public.company_duplicate_candidates(
    company_id,candidate_company_id,matched_fields
  )
  SELECT company_id,candidate.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN public.axora_normalize_company_identity(candidate.registration_number)
      =public.axora_normalize_company_identity(p_registration_number)
      AND btrim(candidate.registration_number)<>'' THEN 'registrationNumber' END,
    CASE WHEN public.axora_normalize_company_identity(candidate.legal_name)
      =public.axora_normalize_company_identity(p_legal_name) THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(candidate.name)
      =public.axora_normalize_company_identity(p_name) THEN 'displayName' END,
    CASE WHEN company_domain<>'' AND public.axora_company_email_domain(
      candidate.main_contact_email
    )=company_domain THEN 'emailDomain' END,
    CASE WHEN lower(btrim(candidate.main_contact_email))
      =lower(btrim(p_main_contact_email)) THEN 'contactEmail' END,
    CASE WHEN public.axora_normalize_company_phone(candidate.main_contact_phone)
      =public.axora_normalize_company_phone(p_main_contact_phone)
      AND public.axora_normalize_company_phone(p_main_contact_phone)<>''
      THEN 'phone' END
  ]::text[],NULL))
  FROM public.companies candidate
  WHERE candidate.id<>company_id
    AND (
      (btrim(candidate.registration_number)<>''
        AND public.axora_normalize_company_identity(candidate.registration_number)
          =public.axora_normalize_company_identity(p_registration_number))
      OR public.axora_normalize_company_identity(candidate.legal_name)
          =public.axora_normalize_company_identity(p_legal_name)
      OR public.axora_normalize_company_identity(candidate.name)
          =public.axora_normalize_company_identity(p_name)
      OR (company_domain<>'' AND public.axora_company_email_domain(
          candidate.main_contact_email)=company_domain)
      OR lower(btrim(candidate.main_contact_email))=lower(btrim(p_main_contact_email))
      OR (public.axora_normalize_company_phone(p_main_contact_phone)<>''
        AND public.axora_normalize_company_phone(candidate.main_contact_phone)
          =public.axora_normalize_company_phone(p_main_contact_phone))
    );
  GET DIAGNOSTICS duplicate_count=ROW_COUNT;
  IF duplicate_count>0 THEN
    UPDATE public.companies
    SET duplicate_review_status='POSSIBLE_DUPLICATE'
    WHERE id=company_id;
  END IF;

  INSERT INTO public.company_onboarding_items(
    company_id,item_code,label,required,status,blocking_reason,
    assigned_manager_user_id,completed_by,completed_at
  ) VALUES
    (company_id,'LEGAL_IDENTITY','Legal identity and registration',true,
      'PASSED',NULL,NULL,p_actor_user_id,p_at),
    (company_id,'PRIMARY_CONTACT','Primary company contact',true,
      'PASSED',NULL,NULL,p_actor_user_id,p_at),
    (company_id,'BILLING_CONFIGURATION','Billing configuration',true,
      'PASSED',NULL,NULL,p_actor_user_id,p_at),
    (company_id,'APPROVED_BRAND','Reviewed logo and generated theme',true,
      'PENDING','An approved logo and generated theme are required.',NULL,NULL,NULL),
    (company_id,'PRIMARY_MANAGER','Primary Client Account Manager',true,
      'PENDING','Assign a primary Client Account Manager.',NULL,NULL,NULL),
    (company_id,'COMPANY_REVIEW','Company onboarding review',true,
      'PENDING','Complete the company review.',NULL,NULL,NULL),
    (company_id,'ADMIN_INVITATION','Company Administrator invitation',true,
      'PENDING','Issue a valid Company Administrator invitation.',NULL,NULL,NULL),
    (company_id,'ADMIN_ACTIVATION','Company Administrator activation',true,
      'PENDING','The invited Company Administrator must complete account setup.',NULL,NULL,NULL);

  IF actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    AND public.axora_company_snapshot_role_permission(
      actor_snapshot,'company.lead.assign'
    ) THEN
    INSERT INTO public.company_assignments(
      company_id,manager_user_id,assignment_type,status,coverage_starts_at,
      assigned_by,assigned_at,assignment_reason
    ) VALUES (
      company_id,p_actor_user_id,'PRIMARY','ACTIVE',p_at,
      p_actor_user_id,p_at,'Lead automatically assigned to its authorized creator'
    );
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,assigned_manager_user_id=p_actor_user_id,
      completed_by=p_actor_user_id,completed_at=p_at
    WHERE company_id=axora_create_company_lead.company_id
      AND item_code='PRIMARY_MANAGER';
    UPDATE public.company_onboarding_items
    SET assigned_manager_user_id=p_actor_user_id
    WHERE company_id=axora_create_company_lead.company_id
      AND status IN ('PENDING','FAILED');
    PERFORM public.axora_apply_company_status(
      company_id,'UNDER_REVIEW',p_actor_user_id,
      'Lead entered review during authorized creator assignment',p_at,
      jsonb_build_object('automaticAssignment',true)
    );
    PERFORM public.axora_apply_company_status(
      company_id,'ASSIGNED',p_actor_user_id,
      'Lead automatically assigned to its authorized creator',p_at,
      jsonb_build_object('automaticAssignment',true)
    );
    actor_auto_assigned:=true;
  END IF;

  RETURN public.axora_company_mutation_payload(
    company_id,actor_snapshot,p_actor_user_id,p_at,'company.lead.created',false,
    CASE WHEN actor_auto_assigned THEN ARRAY[p_actor_user_id] ELSE ARRAY[]::uuid[] END
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_mark_company_brand_ready(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  creator_id uuid;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT created_by INTO creator_id FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR creator_id IS NULL OR NOT (
    public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    ) OR creator_id=p_actor_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.company_logos logo
    JOIN public.company_brand_themes theme
      ON theme.company_id=logo.company_id AND theme.source_logo_id=logo.id
    WHERE logo.company_id=p_company_id AND logo.active AND theme.active
  ) THEN RAISE EXCEPTION 'The company brand readiness update is unavailable'; END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,
    completed_at=p_at
  WHERE company_id=p_company_id AND item_code='APPROVED_BRAND';
  RETURN true;
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  company_row public.companies%ROWTYPE;
  former_manager_id uuid;
  required_permission text;
  event_key text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO company_row FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR company_row.id IS NULL
    OR p_assignment_type NOT IN ('PRIMARY','BACKUP')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR company_row.lifecycle_status IN ('DUPLICATE','REJECTED','ARCHIVED') THEN
    RAISE EXCEPTION 'The company assignment is unavailable';
  END IF;

  SELECT manager_user_id INTO former_manager_id
  FROM public.company_assignments
  WHERE company_id=p_company_id AND assignment_type=p_assignment_type
    AND status='ACTIVE'
  FOR UPDATE;
  required_permission:=CASE WHEN former_manager_id IS NULL
    THEN 'company.lead.assign' ELSE 'company.lead.reassign' END;

  IF NOT public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,required_permission,p_at
  ) AND NOT (
    former_manager_id IS NULL AND company_row.created_by=p_actor_user_id
    AND public.axora_company_snapshot_role_permission(
      actor_snapshot,required_permission
    )
  ) THEN RAISE EXCEPTION 'The company assignment is unavailable'; END IF;

  IF former_manager_id=p_manager_user_id THEN
    RAISE EXCEPTION 'The selected manager already holds this assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users manager
    WHERE manager.id=p_manager_user_id
      AND manager.active AND manager.account_status='ACTIVE'
      AND manager.account_kind='PLATFORM'
      AND manager.account_setup_completed_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.role_assignments role_assignment
        JOIN public.roles role ON role.id=role_assignment.role_id
        WHERE role_assignment.user_id=manager.id
          AND role_assignment.active AND role_assignment.revoked_at IS NULL
          AND role.role_key='CLIENT_ACCOUNT_MANAGER'
      )
    FOR KEY SHARE OF manager
  ) THEN RAISE EXCEPTION 'The selected manager is unavailable'; END IF;

  IF p_assignment_type='BACKUP' AND (
    p_coverage_starts_at IS NULL OR p_coverage_ends_at IS NULL
    OR p_coverage_ends_at<=p_coverage_starts_at OR p_coverage_ends_at<=p_at
  ) THEN RAISE EXCEPTION 'Backup coverage requires a valid future end time'; END IF;
  IF p_assignment_type='PRIMARY' AND (
    p_coverage_ends_at IS NOT NULL
    OR (p_coverage_starts_at IS NOT NULL AND p_coverage_starts_at>p_at)
  ) THEN RAISE EXCEPTION 'A primary assignment must begin immediately and cannot expire'; END IF;

  UPDATE public.company_assignments
  SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
    end_reason='Reassigned: ' || btrim(p_reason)
  WHERE company_id=p_company_id AND assignment_type=p_assignment_type
    AND status='ACTIVE';

  INSERT INTO public.company_assignments(
    company_id,manager_user_id,assignment_type,status,coverage_starts_at,
    coverage_ends_at,assigned_by,assigned_at,assignment_reason
  ) VALUES (
    p_company_id,p_manager_user_id,p_assignment_type,'ACTIVE',
    COALESCE(p_coverage_starts_at,p_at),p_coverage_ends_at,
    p_actor_user_id,p_at,btrim(p_reason)
  );

  IF p_assignment_type='PRIMARY' THEN
    UPDATE public.company_onboarding_items
    SET assigned_manager_user_id=p_manager_user_id
    WHERE company_id=p_company_id AND status IN ('PENDING','FAILED');
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
  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,event_key,false,
    array_remove(ARRAY[p_manager_user_id,former_manager_id],NULL)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_transition_company_lifecycle(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_to_status text,
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
  from_status text;
  required_permission text:='company.edit';
  event_key text:='company.lifecycle.updated';
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO from_status
  FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR from_status IS NULL
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The company lifecycle transition is unavailable';
  END IF;

  IF p_to_status IN ('SUSPENDED','INACTIVE') THEN
    required_permission:='company.suspend';
  END IF;
  IF NOT public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,required_permission,p_at
  ) THEN RAISE EXCEPTION 'The company lifecycle transition is unavailable'; END IF;

  IF NOT (
    (from_status='NEW_LEAD' AND p_to_status IN ('UNDER_REVIEW','DUPLICATE','REJECTED'))
    OR (from_status='UNDER_REVIEW' AND p_to_status IN ('DUPLICATE','REJECTED'))
    OR (from_status='ASSIGNED' AND p_to_status='CONTACTED')
    OR (from_status IN ('CONTACTED','ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW')
      AND p_to_status='INFORMATION_PENDING')
    OR (from_status IN ('CONTACTED','INFORMATION_PENDING') AND p_to_status='ONBOARDING')
    OR (from_status='ONBOARDING' AND p_to_status='PORTAL_DRAFT')
    OR (from_status='PORTAL_DRAFT' AND p_to_status='COMPANY_REVIEW')
    OR (from_status IN ('ACTIVE','SUSPENDED') AND p_to_status='INACTIVE')
    OR (from_status<>'ACTIVE' AND from_status<>'ARCHIVED' AND p_to_status='ARCHIVED')
  ) THEN RAISE EXCEPTION 'The company lifecycle transition is not permitted'; END IF;

  IF p_to_status='COMPANY_REVIEW' THEN
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,
      completed_at=p_at
    WHERE company_id=p_company_id AND item_code='COMPANY_REVIEW';
  ELSIF p_to_status='DUPLICATE' THEN
    UPDATE public.companies SET duplicate_review_status='CONFIRMED'
    WHERE id=p_company_id;
    UPDATE public.company_duplicate_candidates
    SET review_status='CONFIRMED',reviewed_by=p_actor_user_id,
      reviewed_at=p_at,review_reason=btrim(p_reason)
    WHERE company_id=p_company_id AND review_status='PENDING';
  END IF;

  IF p_to_status='INFORMATION_PENDING' THEN event_key:='company.information_requested'; END IF;
  PERFORM public.axora_apply_company_status(
    p_company_id,p_to_status,p_actor_user_id,btrim(p_reason),p_at
  );
  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,event_key,false
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_resolve_company_duplicate(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
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
  current_status text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status FROM public.companies
  WHERE id=p_company_id AND duplicate_review_status='POSSIBLE_DUPLICATE'
  FOR UPDATE;
  IF actor_snapshot IS NULL OR current_status IS NULL
    OR p_decision NOT IN ('CLEAR','CONFIRM')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    ) THEN RAISE EXCEPTION 'The duplicate review is unavailable'; END IF;

  UPDATE public.company_duplicate_candidates
  SET review_status=CASE WHEN p_decision='CLEAR' THEN 'CLEARED' ELSE 'CONFIRMED' END,
    reviewed_by=p_actor_user_id,reviewed_at=p_at,review_reason=btrim(p_reason)
  WHERE company_id=p_company_id AND review_status='PENDING';
  UPDATE public.companies
  SET duplicate_review_status=CASE WHEN p_decision='CLEAR' THEN 'CLEARED' ELSE 'CONFIRMED' END
  WHERE id=p_company_id;

  IF p_decision='CONFIRM' AND current_status<>'DUPLICATE' THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'DUPLICATE',p_actor_user_id,btrim(p_reason),p_at
    );
  ELSIF p_decision='CLEAR' AND current_status='NEW_LEAD' THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'UNDER_REVIEW',p_actor_user_id,btrim(p_reason),p_at
    );
  END IF;
  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,'company.duplicate_reviewed',false
  );
END $$;

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
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL
    OR current_status NOT IN ('COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED')
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
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
  IF current_status='COMPANY_REVIEW' THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_INVITED',p_actor_user_id,
      btrim(p_reason),p_at,jsonb_build_object('administratorUserId',administrator_id)
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

CREATE OR REPLACE FUNCTION public.axora_activate_company(
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
      ),
      'companyId',p_company_id,
      'companyName',(SELECT company.name FROM public.companies company WHERE company.id=p_company_id),
      'companyVersion',(SELECT company.lifecycle_version FROM public.companies company WHERE company.id=p_company_id),
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

CREATE OR REPLACE FUNCTION public.axora_suspend_company(
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
  open_requests integer;
  open_deliveries integer;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR current_status<>'ACTIVE'
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.suspend',p_at
    ) THEN RAISE EXCEPTION 'The company suspension is unavailable'; END IF;

  SELECT count(*)::int INTO open_requests
  FROM public.requests request
  JOIN public.lookup_values status ON status.id=request.status_id
  WHERE request.company_id=p_company_id
    AND status.label NOT IN ('Completed','Cancelled');
  SELECT count(*)::int INTO open_deliveries
  FROM public.deliveries delivery
  JOIN public.request_lines line ON line.id=delivery.request_line_id
  JOIN public.requests request ON request.id=line.request_id
  JOIN public.lookup_values status ON status.id=delivery.status_id
  WHERE request.company_id=p_company_id
    AND status.label NOT IN ('Delivered','Cancelled','Failed');

  PERFORM public.axora_apply_company_status(
    p_company_id,'SUSPENDED',p_actor_user_id,btrim(p_reason),p_at,
    jsonb_build_object(
      'openRequestsPreserved',open_requests,
      'openDeliveriesPreserved',open_deliveries
    )
  );
  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,'company.suspended',true
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_company_publication(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_is_publicly_listed boolean,
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
  existing_value boolean;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT is_publicly_listed INTO existing_value FROM public.companies
  WHERE id=p_company_id FOR UPDATE;
  IF actor_snapshot IS NULL OR existing_value IS NULL
    OR existing_value=p_is_publicly_listed
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

CREATE OR REPLACE FUNCTION public.axora_public_company_listing_rows()
RETURNS TABLE(
  company_id uuid,
  company_code text,
  display_name text,
  industry text,
  website_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT company.id,company.company_code,company.name,company.industry,
    company.website_url
  FROM public.companies company
  WHERE company.is_publicly_listed
  ORDER BY company.name,company.id
$$;

-- The normal invitation capability intentionally requires active companies.
-- This narrow exception permits only a Platform Owner to create the first
-- COMPANY_ADMIN invitation after company review and before activation.
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
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
    OR NOT public.axora_snapshot_has_permission(
      actor_snapshot,'user.create','COMPANY',p_company_id,NULL,NULL,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      actor_snapshot,'user.invite','COMPANY',p_company_id,NULL,NULL,NULL
    ) THEN RETURN NULL; END IF;

  SELECT company.name INTO company_name
  FROM public.companies company
  WHERE company.id=p_company_id
    AND company.lifecycle_status IN (
      'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED'
    )
  FOR KEY SHARE OF company;
  IF company_name IS NULL THEN RETURN NULL; END IF;
  SELECT role.id INTO company_admin_role_id FROM public.roles role
  WHERE role.role_key='COMPANY_ADMIN';

  RETURN jsonb_build_object(
    'capturedAt',p_at,'roleId',company_admin_role_id,
    'role','COMPANY_ADMIN','accountKind','COMPANY','isOwner',false,
    'organizationName',company_name,
    'scope',jsonb_build_object('type','COMPANY','companyId',p_company_id)
  );
END $$;

-- Keep all role-target readiness rules, with one explicit onboarding
-- exception for the invited Company Administrator of a reviewed company.
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

  IF role_key IS NULL OR NOT public.axora_role_scope_contract_is_valid(
    account_row.account_kind,account_row.is_owner,role_key,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT (
    onboarding_company_admin OR public.axora_role_scope_resource_is_active(
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

REVOKE ALL ON TABLE
  public.company_status_history,
  public.company_assignments,
  public.company_onboarding_items,
  public.company_duplicate_candidates,
  public.company_publication_history
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.axora_default_inserted_company_lifecycle(),
  public.axora_seed_legacy_company_lifecycle(),
  public.axora_normalize_company_identity(text),
  public.axora_normalize_company_phone(text),
  public.axora_company_email_domain(text),
  public.axora_company_status_rank(text),
  public.axora_company_snapshot_role_permission(jsonb,text),
  public.axora_company_actor_is_owner(jsonb),
  public.axora_company_assignment_is_active(uuid,uuid,timestamptz),
  public.axora_company_actor_can_view(jsonb,uuid,uuid,timestamptz),
  public.axora_company_actor_has_permission(jsonb,uuid,uuid,text,timestamptz),
  public.axora_company_actor_can_create(jsonb,text),
  public.axora_company_activation_blockers(uuid),
  public.axora_apply_company_status(uuid,text,uuid,text,timestamptz,jsonb),
  public.axora_company_notification_recipient_ids(uuid,boolean,timestamptz),
  public.axora_company_lifecycle_record(uuid,jsonb,uuid,timestamptz),
  public.axora_company_mutation_payload(uuid,jsonb,uuid,timestamptz,text,boolean,uuid[]),
  public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz),
  public.axora_create_company_lead(
    uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz
  ),
  public.axora_mark_company_brand_ready(uuid,uuid,uuid,timestamptz),
  public.axora_assign_company_manager(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,timestamptz),
  public.axora_transition_company_lifecycle(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_resolve_company_duplicate(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_sync_company_administrator(uuid,uuid,uuid,text,timestamptz),
  public.axora_activate_company(uuid,uuid,uuid,text,timestamptz),
  public.axora_suspend_company(uuid,uuid,uuid,text,timestamptz),
  public.axora_set_company_publication(uuid,uuid,uuid,boolean,text,timestamptz),
  public.axora_public_company_listing_rows(),
  public.axora_lock_company_admin_invitation_scope(uuid,uuid,uuid,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.company_status_history,
      public.company_assignments,
      public.company_onboarding_items,
      public.company_duplicate_candidates,
      public.company_publication_history
    FROM axora_app;

    REVOKE ALL ON FUNCTION
      public.axora_company_assignment_is_active(uuid,uuid,timestamptz),
      public.axora_company_actor_can_view(jsonb,uuid,uuid,timestamptz),
      public.axora_company_actor_has_permission(jsonb,uuid,uuid,text,timestamptz),
      public.axora_company_activation_blockers(uuid),
      public.axora_apply_company_status(uuid,text,uuid,text,timestamptz,jsonb),
      public.axora_company_notification_recipient_ids(uuid,boolean,timestamptz),
      public.axora_company_lifecycle_record(uuid,jsonb,uuid,timestamptz),
      public.axora_company_mutation_payload(uuid,jsonb,uuid,timestamptz,text,boolean,uuid[])
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz),
      public.axora_create_company_lead(
        uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz
      ),
      public.axora_mark_company_brand_ready(uuid,uuid,uuid,timestamptz),
      public.axora_assign_company_manager(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,timestamptz),
      public.axora_transition_company_lifecycle(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_resolve_company_duplicate(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_sync_company_administrator(uuid,uuid,uuid,text,timestamptz),
      public.axora_activate_company(uuid,uuid,uuid,text,timestamptz),
      public.axora_suspend_company(uuid,uuid,uuid,text,timestamptz),
      public.axora_set_company_publication(uuid,uuid,uuid,boolean,text,timestamptz),
      public.axora_public_company_listing_rows(),
      public.axora_lock_company_admin_invitation_scope(uuid,uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
