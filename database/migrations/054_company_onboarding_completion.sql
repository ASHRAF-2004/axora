BEGIN;

-- P1-01: complete company onboarding without weakening the lifecycle gate
-- introduced in 051. Taxonomy codes are stable; labels are localized data.
CREATE TABLE public.industry_taxonomy (
  industry_code text PRIMARY KEY CHECK (industry_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  parent_industry_code text REFERENCES public.industry_taxonomy(industry_code) ON DELETE RESTRICT,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 160),
  name_ar text NOT NULL CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 160),
  name_ms text NOT NULL CHECK (char_length(btrim(name_ms)) BETWEEN 2 AND 160),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 1000 CHECK (sort_order >= 0),
  allows_custom_label boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_industry_code IS NULL OR parent_industry_code<>industry_code)
);

INSERT INTO public.industry_taxonomy(
  industry_code,name_en,name_ar,name_ms,sort_order,allows_custom_label
) VALUES
  ('CONSTRUCTION','Construction','البناء','Pembinaan',10,false),
  ('EDUCATION','Education','التعليم','Pendidikan',20,false),
  ('FINANCIAL_SERVICES','Financial services','الخدمات المالية','Perkhidmatan kewangan',30,false),
  ('HEALTHCARE','Healthcare','الرعاية الصحية','Penjagaan kesihatan',40,false),
  ('HOSPITALITY','Hospitality','الضيافة','Hospitaliti',50,false),
  ('LOGISTICS','Logistics and transport','الخدمات اللوجستية والنقل','Logistik dan pengangkutan',60,false),
  ('MANUFACTURING','Manufacturing','التصنيع','Pembuatan',70,false),
  ('PROFESSIONAL_SERVICES','Professional services','الخدمات المهنية','Perkhidmatan profesional',80,false),
  ('PUBLIC_SECTOR','Public sector','القطاع العام','Sektor awam',90,false),
  ('RETAIL','Retail and commerce','التجزئة والتجارة','Peruncitan dan perdagangan',100,false),
  ('TECHNOLOGY','Technology','التقنية','Teknologi',110,false),
  ('OTHER','Other','أخرى','Lain-lain',999,true)
ON CONFLICT(industry_code) DO UPDATE SET
  name_en=EXCLUDED.name_en,
  name_ar=EXCLUDED.name_ar,
  name_ms=EXCLUDED.name_ms,
  sort_order=EXCLUDED.sort_order,
  allows_custom_label=EXCLUDED.allows_custom_label;

ALTER TABLE public.companies
  ADD COLUMN industry_code text REFERENCES public.industry_taxonomy(industry_code) ON DELETE RESTRICT,
  ADD COLUMN industry_other_text text,
  ADD COLUMN registration_country_code text NOT NULL DEFAULT 'MY',
  ADD COLUMN tax_registration_number text NOT NULL DEFAULT '',
  ADD COLUMN registered_address text NOT NULL DEFAULT '',
  ADD COLUMN operating_address text NOT NULL DEFAULT '',
  ADD COLUMN default_locale text NOT NULL DEFAULT 'en',
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN onboarding_current_step text NOT NULL DEFAULT 'LEGAL_IDENTITY',
  ADD COLUMN onboarding_completed_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN onboarding_version integer NOT NULL DEFAULT 1,
  ADD COLUMN onboarding_saved_at timestamptz,
  ADD COLUMN verification_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN verification_updated_at timestamptz,
  ADD COLUMN verification_updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.companies company
SET industry_code=COALESCE((
      SELECT taxonomy.industry_code
      FROM public.industry_taxonomy taxonomy
      WHERE taxonomy.industry_code<>'OTHER'
        AND lower(taxonomy.name_en)=lower(btrim(company.industry))
      LIMIT 1
    ),'OTHER'),
    industry_other_text=CASE
      WHEN EXISTS (
        SELECT 1 FROM public.industry_taxonomy taxonomy
        WHERE taxonomy.industry_code<>'OTHER'
          AND lower(taxonomy.name_en)=lower(btrim(company.industry))
      ) THEN NULL
      ELSE COALESCE(NULLIF(btrim(company.industry),''),'Unspecified legacy industry')
    END,
    registered_address=COALESCE(NULLIF(btrim(company.registered_address),''),company.billing_address),
    operating_address=COALESCE(NULLIF(btrim(company.operating_address),''),company.billing_address),
    onboarding_saved_at=COALESCE(company.onboarding_saved_at,company.updated_at,company.created_at),
    verification_status=CASE WHEN company.active THEN 'VERIFIED' ELSE 'NOT_STARTED' END,
    verification_updated_at=CASE WHEN company.active
      THEN COALESCE(company.activated_at,company.updated_at,company.created_at)
      ELSE company.verification_updated_at END;

ALTER TABLE public.companies
  ALTER COLUMN industry_code SET NOT NULL,
  DROP CONSTRAINT IF EXISTS companies_industry_other_check,
  DROP CONSTRAINT IF EXISTS companies_registration_country_check,
  DROP CONSTRAINT IF EXISTS companies_tax_registration_check,
  DROP CONSTRAINT IF EXISTS companies_registered_address_check,
  DROP CONSTRAINT IF EXISTS companies_operating_address_check,
  DROP CONSTRAINT IF EXISTS companies_default_locale_check,
  DROP CONSTRAINT IF EXISTS companies_timezone_check,
  DROP CONSTRAINT IF EXISTS companies_onboarding_step_check,
  DROP CONSTRAINT IF EXISTS companies_onboarding_steps_check,
  DROP CONSTRAINT IF EXISTS companies_onboarding_version_check,
  DROP CONSTRAINT IF EXISTS companies_verification_status_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_industry_other_check CHECK (
    industry_code<>'OTHER'
    OR char_length(btrim(COALESCE(industry_other_text,''))) BETWEEN 2 AND 300
  ),
  ADD CONSTRAINT companies_registration_country_check CHECK (
    registration_country_code ~ '^[A-Z]{2}$'
  ),
  ADD CONSTRAINT companies_tax_registration_check CHECK (
    char_length(btrim(tax_registration_number)) <= 160
  ),
  ADD CONSTRAINT companies_registered_address_check CHECK (
    char_length(btrim(registered_address)) <= 5000
  ),
  ADD CONSTRAINT companies_operating_address_check CHECK (
    char_length(btrim(operating_address)) <= 5000
  ),
  ADD CONSTRAINT companies_default_locale_check CHECK (default_locale IN ('en','ar','ms')),
  ADD CONSTRAINT companies_timezone_check CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  ADD CONSTRAINT companies_onboarding_step_check CHECK (
    onboarding_current_step IN (
      'LEGAL_IDENTITY','INDUSTRY','ADDRESSES','CONTACTS','BILLING',
      'PROCUREMENT','BRAND','ADMINISTRATOR','REVIEW'
    )
  ),
  ADD CONSTRAINT companies_onboarding_steps_check CHECK (
    cardinality(onboarding_completed_steps)<=9
    AND onboarding_completed_steps <@ ARRAY[
      'LEGAL_IDENTITY','INDUSTRY','ADDRESSES','CONTACTS','BILLING',
      'PROCUREMENT','BRAND','ADMINISTRATOR','REVIEW'
    ]::text[]
  ),
  ADD CONSTRAINT companies_onboarding_version_check CHECK (onboarding_version>0),
  ADD CONSTRAINT companies_verification_status_check CHECK (
    verification_status IN ('NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','VERIFIED','CHANGES_REQUIRED')
  );

CREATE OR REPLACE FUNCTION public.axora_default_company_onboarding_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE matched_code text;
BEGIN
  IF NEW.industry_code IS NULL THEN
    SELECT taxonomy.industry_code INTO matched_code
    FROM public.industry_taxonomy taxonomy
    WHERE taxonomy.active AND taxonomy.industry_code<>'OTHER'
      AND lower(taxonomy.name_en)=lower(btrim(COALESCE(NEW.industry,'')))
    LIMIT 1;
    NEW.industry_code:=COALESCE(matched_code,'OTHER');
  END IF;
  IF NEW.industry_code='OTHER' THEN
    NEW.industry_other_text:=COALESCE(
      NULLIF(btrim(NEW.industry_other_text),''),
      NULLIF(btrim(NEW.industry),''),
      'Not specified'
    );
  ELSE
    NEW.industry_other_text:=NULL;
  END IF;
  NEW.registered_address:=COALESCE(NULLIF(btrim(NEW.registered_address),''),NEW.billing_address,'');
  NEW.operating_address:=COALESCE(NULLIF(btrim(NEW.operating_address),''),NEW.billing_address,'');
  NEW.onboarding_saved_at:=COALESCE(NEW.onboarding_saved_at,NEW.updated_at,NEW.created_at,now());
  IF NEW.active AND NEW.verification_status='NOT_STARTED' THEN
    NEW.verification_status:='VERIFIED';
    NEW.verification_updated_at:=COALESCE(NEW.activated_at,NEW.updated_at,NEW.created_at,now());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS default_company_onboarding_fields ON public.companies;
CREATE TRIGGER default_company_onboarding_fields
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_default_company_onboarding_fields();

ALTER TABLE public.company_onboarding_items
  ADD COLUMN description text,
  ADD COLUMN responsible_role text,
  ADD COLUMN responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN notes text,
  ADD COLUMN evidence_reference text,
  ADD COLUMN evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN due_at timestamptz,
  ADD COLUMN exception_reason text,
  ADD COLUMN exception_approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN exception_approved_at timestamptz,
  ADD COLUMN exception_expires_at timestamptz;

UPDATE public.company_onboarding_items
SET responsible_role=CASE
      WHEN item_code IN ('ADMIN_INVITATION','ADMIN_ACTIVATION') THEN 'COMPANY_ADMIN'
      ELSE 'CLIENT_ACCOUNT_MANAGER'
    END,
    description=COALESCE(description,label),
    evidence_metadata=COALESCE(evidence_metadata,'{}'::jsonb),
    exception_reason=CASE WHEN status='WAIVED'
      THEN COALESCE(NULLIF(btrim(exception_reason),''),'Legacy onboarding exception')
      ELSE exception_reason END,
    exception_approved_at=CASE WHEN status='WAIVED'
      THEN COALESCE(exception_approved_at,completed_at,updated_at)
      ELSE exception_approved_at END,
    exception_expires_at=CASE WHEN status='WAIVED'
      THEN COALESCE(exception_expires_at,'9999-12-31 00:00:00+00'::timestamptz)
      ELSE exception_expires_at END;

ALTER TABLE public.company_onboarding_items
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN responsible_role SET NOT NULL,
  DROP CONSTRAINT IF EXISTS company_onboarding_item_description_check,
  DROP CONSTRAINT IF EXISTS company_onboarding_item_responsible_role_check,
  DROP CONSTRAINT IF EXISTS company_onboarding_item_notes_check,
  DROP CONSTRAINT IF EXISTS company_onboarding_item_evidence_check,
  DROP CONSTRAINT IF EXISTS company_onboarding_item_exception_check;

ALTER TABLE public.company_onboarding_items
  ADD CONSTRAINT company_onboarding_item_description_check CHECK (
    char_length(btrim(description)) BETWEEN 2 AND 1000
  ),
  ADD CONSTRAINT company_onboarding_item_responsible_role_check CHECK (
    responsible_role IN ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','COMPANY_ADMIN')
  ),
  ADD CONSTRAINT company_onboarding_item_notes_check CHECK (
    char_length(btrim(COALESCE(notes,'')))<=3000
  ),
  ADD CONSTRAINT company_onboarding_item_evidence_check CHECK (
    char_length(btrim(COALESCE(evidence_reference,'')))<=1000
    AND jsonb_typeof(evidence_metadata)='object'
    AND public.workflow_metadata_is_safe(evidence_metadata)
  ),
  ADD CONSTRAINT company_onboarding_item_exception_check CHECK (
    (status<>'WAIVED'
      AND exception_reason IS NULL AND exception_approved_by IS NULL
      AND exception_approved_at IS NULL AND exception_expires_at IS NULL)
    OR
    (status='WAIVED'
      AND char_length(btrim(COALESCE(exception_reason,''))) BETWEEN 3 AND 1000
      AND exception_approved_at IS NOT NULL
      AND exception_expires_at IS NOT NULL
      AND exception_expires_at>exception_approved_at)
  );

-- Migration 051 remains the compatibility insertion path for companies. Fill
-- the P1 detail columns before constraints are checked when that trigger seeds
-- a newly imported or newly converted company.
CREATE OR REPLACE FUNCTION public.axora_default_onboarding_item_detail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  NEW.description:=COALESCE(NULLIF(btrim(NEW.description),''),NEW.label);
  NEW.responsible_role:=COALESCE(NULLIF(NEW.responsible_role,''),
    CASE WHEN NEW.item_code IN ('ADMIN_INVITATION','ADMIN_ACTIVATION')
      THEN 'COMPANY_ADMIN' ELSE 'CLIENT_ACCOUNT_MANAGER' END);
  NEW.evidence_metadata:=COALESCE(NEW.evidence_metadata,'{}'::jsonb);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS default_onboarding_item_detail ON public.company_onboarding_items;
CREATE TRIGGER default_onboarding_item_detail
BEFORE INSERT ON public.company_onboarding_items
FOR EACH ROW EXECUTE FUNCTION public.axora_default_onboarding_item_detail();

CREATE OR REPLACE FUNCTION public.axora_seed_company_onboarding_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.company_onboarding_items(
    company_id,item_code,label,description,required,status,blocking_reason,
    responsible_role,completed_at
  )
  SELECT NEW.id,item.item_code,item.label,item.description,true,
    CASE WHEN NEW.active THEN 'PASSED' ELSE 'PENDING' END,
    CASE WHEN NEW.active THEN NULL ELSE item.blocking_reason END,
    'CLIENT_ACCOUNT_MANAGER',
    CASE WHEN NEW.active THEN COALESCE(NEW.activated_at,NEW.created_at,now()) ELSE NULL END
  FROM (VALUES
    ('INDUSTRY_CLASSIFICATION','Managed industry classification',
      'Select a managed industry code and provide a custom label only for Other.',
      'Industry classification is incomplete.'),
    ('REGISTERED_ADDRESS','Registered and operating addresses',
      'Record the registered and operating addresses.',
      'Registered or operating address is incomplete.'),
    ('PROCUREMENT_CONFIGURATION','Procurement configuration',
      'Confirm locale, timezone, billing and procurement contacts.',
      'Procurement configuration is incomplete.')
  ) item(item_code,label,description,blocking_reason)
  ON CONFLICT(company_id,item_code) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seed_company_onboarding_completion ON public.companies;
CREATE TRIGGER seed_company_onboarding_completion
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_company_onboarding_completion();

INSERT INTO public.company_onboarding_items(
  company_id,item_code,label,description,required,status,blocking_reason,
  responsible_role,completed_at
)
SELECT company.id,item.item_code,item.label,item.description,true,
  CASE WHEN company.active THEN 'PASSED' ELSE item.initial_status END,
  CASE WHEN company.active THEN NULL ELSE item.blocking_reason END,
  item.responsible_role,
  CASE WHEN company.active THEN company.activated_at ELSE NULL END
FROM public.companies company
CROSS JOIN (VALUES
  ('INDUSTRY_CLASSIFICATION','Managed industry classification','Select a managed industry code and provide a custom label only for Other.','PENDING','Industry classification is incomplete.','CLIENT_ACCOUNT_MANAGER'),
  ('REGISTERED_ADDRESS','Registered and operating addresses','Record the registered and operating addresses.','PENDING','Registered or operating address is incomplete.','CLIENT_ACCOUNT_MANAGER'),
  ('PROCUREMENT_CONFIGURATION','Procurement configuration','Confirm locale, timezone, billing and procurement contacts.','PENDING','Procurement configuration is incomplete.','CLIENT_ACCOUNT_MANAGER')
) item(item_code,label,description,initial_status,blocking_reason,responsible_role)
ON CONFLICT(company_id,item_code) DO NOTHING;

UPDATE public.company_onboarding_items item
SET status='PASSED',blocking_reason=NULL,completed_at=company.onboarding_saved_at
FROM public.companies company
WHERE item.company_id=company.id AND item.status='PENDING' AND (
  (item.item_code='INDUSTRY_CLASSIFICATION' AND company.industry_code IS NOT NULL)
  OR (item.item_code='REGISTERED_ADDRESS'
    AND btrim(company.registered_address)<>'' AND btrim(company.operating_address)<>'')
  OR (item.item_code='PROCUREMENT_CONFIGURATION'
    AND company.default_locale IN ('en','ar','ms') AND btrim(company.timezone)<>'')
);

CREATE TABLE public.company_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','VERIFIED','CHANGES_REQUIRED')
  ),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(evidence)='object' AND public.workflow_metadata_is_safe(evidence)
  ),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status IS NULL OR from_status<>to_status)
);
CREATE INDEX company_verification_history_company_idx
  ON public.company_verification_history(company_id,changed_at DESC,id DESC);

INSERT INTO public.company_verification_history(
  company_id,from_status,to_status,reason,evidence,changed_at
)
SELECT company.id,NULL,company.verification_status,
  'Company onboarding verification baseline',
  jsonb_build_object('source','MIGRATION_054'),
  COALESCE(company.verification_updated_at,company.created_at)
FROM public.companies company;

CREATE TABLE public.company_onboarding_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  onboarding_item_id uuid NOT NULL REFERENCES public.company_onboarding_items(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','CANCELLED')),
  sent_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='SENT')=(sent_at IS NOT NULL))
);
CREATE UNIQUE INDEX company_onboarding_reminders_open_uq
  ON public.company_onboarding_reminders(onboarding_item_id,recipient_user_id)
  WHERE status='PENDING';
CREATE INDEX company_onboarding_reminders_due_idx
  ON public.company_onboarding_reminders(due_at,company_id) WHERE status='PENDING';

DROP TRIGGER IF EXISTS company_verification_history_append_only ON public.company_verification_history;
CREATE TRIGGER company_verification_history_append_only
BEFORE UPDATE OR DELETE ON public.company_verification_history
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_industry_taxonomy ON public.industry_taxonomy;
CREATE TRIGGER audit_industry_taxonomy
AFTER INSERT OR UPDATE OR DELETE ON public.industry_taxonomy
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
DROP TRIGGER IF EXISTS set_updated_at_industry_taxonomy ON public.industry_taxonomy;
CREATE TRIGGER set_updated_at_industry_taxonomy
BEFORE UPDATE ON public.industry_taxonomy
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_company_onboarding_reminders ON public.company_onboarding_reminders;
CREATE TRIGGER audit_company_onboarding_reminders
AFTER INSERT OR UPDATE OR DELETE ON public.company_onboarding_reminders
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE OR REPLACE FUNCTION public.axora_company_onboarding_content_blockers(
  p_company_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT ARRAY(
    SELECT blocker FROM (
      SELECT item.item_code AS blocker,1 AS order_key
      FROM public.company_onboarding_items item
      WHERE item.company_id=p_company_id AND item.required AND (
        item.status NOT IN ('PASSED','WAIVED')
        OR (item.status='WAIVED' AND item.exception_expires_at<=p_at)
      )
      UNION ALL
      SELECT 'DUPLICATE_REVIEW',2
      FROM public.companies company
      WHERE company.id=p_company_id
        AND company.duplicate_review_status IN ('POSSIBLE_DUPLICATE','CONFIRMED')
    ) blockers ORDER BY order_key,blocker
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_activation_blockers(p_company_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_onboarding_content_blockers(p_company_id,now())
    || CASE WHEN EXISTS (
      SELECT 1 FROM public.companies company
      WHERE company.id=p_company_id AND company.verification_status<>'VERIFIED'
    ) THEN ARRAY['ONBOARDING_VERIFICATION']::text[] ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION public.axora_company_onboarding_recipients(
  p_company_id uuid,p_actor_user_id uuid,p_at timestamptz
)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(array_agg(DISTINCT recipient_id) FILTER (
    WHERE recipient_id IS NOT NULL AND recipient_id<>p_actor_user_id
  ),ARRAY[]::uuid[])
  FROM (
    SELECT assignment.manager_user_id AS recipient_id
    FROM public.company_assignments assignment
    JOIN public.users account ON account.id=assignment.manager_user_id
      AND account.active AND account.account_status='ACTIVE'
    WHERE assignment.company_id=p_company_id AND assignment.status='ACTIVE'
      AND assignment.coverage_starts_at<=p_at
      AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>p_at)
    UNION ALL
    SELECT membership.user_id
    FROM public.company_memberships membership
    JOIN public.users account ON account.id=membership.user_id
      AND account.active AND account.account_status='ACTIVE'
    JOIN public.role_assignments assignment ON assignment.user_id=account.id
      AND assignment.company_id=p_company_id AND assignment.scope_type='COMPANY'
      AND assignment.active AND assignment.revoked_at IS NULL
    JOIN public.roles role ON role.id=assignment.role_id AND role.role_key='COMPANY_ADMIN'
    WHERE membership.company_id=p_company_id AND membership.status='ACTIVE'
  ) recipients
$$;

CREATE OR REPLACE FUNCTION public.axora_company_onboarding_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; can_edit boolean; can_verify boolean;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL OR NOT public.axora_company_actor_can_view(
    actor_snapshot,p_actor_user_id,p_company_id,p_at
  ) THEN RETURN NULL; END IF;
  can_edit:=public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
  );
  can_verify:=public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
  );
  RETURN (
    SELECT jsonb_build_object(
      'capturedAt',p_at,'canEdit',can_edit,'canApproveExceptions',can_verify,
      'canVerify',can_verify,
      'company',jsonb_build_object(
        'id',company.id,'code',company.company_code,'name',company.name,
        'status',company.lifecycle_status,'legalName',company.legal_name,
        'registrationNumber',company.registration_number,
        'registrationCountryCode',company.registration_country_code,
        'taxRegistrationNumber',company.tax_registration_number,
        'industryCode',company.industry_code,
        'industryOtherText',company.industry_other_text,
        'registeredAddress',company.registered_address,
        'operatingAddress',company.operating_address,
        'mainContactName',company.main_contact_name,
        'mainContactEmail',company.main_contact_email,
        'mainContactPhone',company.main_contact_phone,
        'billingContactName',company.billing_contact_name,
        'billingContactEmail',company.billing_contact_email,
        'billingContactPhone',company.billing_contact_phone,
        'billingAddress',company.billing_address,
        'billingCycle',company.billing_cycle,
        'defaultLocale',company.default_locale,'timezone',company.timezone,
        'currentStep',company.onboarding_current_step,
        'completedSteps',to_jsonb(company.onboarding_completed_steps),
        'version',company.onboarding_version,'savedAt',company.onboarding_saved_at,
        'verificationStatus',company.verification_status,
        'activationBlockers',to_jsonb(public.axora_company_activation_blockers(company.id))
      ),
      'industries',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'code',taxonomy.industry_code,'nameEn',taxonomy.name_en,
          'nameAr',taxonomy.name_ar,'nameMs',taxonomy.name_ms,
          'allowsCustomLabel',taxonomy.allows_custom_label
        ) ORDER BY taxonomy.sort_order,taxonomy.industry_code)
        FROM public.industry_taxonomy taxonomy
        WHERE taxonomy.active OR taxonomy.industry_code=company.industry_code
      ),'[]'::jsonb),
      'responsibleUsers',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',responsible.id,'name',responsible.display_name,'email',responsible.email
        ) ORDER BY responsible.display_name,responsible.id)
        FROM public.users responsible
        WHERE responsible.active AND responsible.account_status='ACTIVE'
          AND (
            EXISTS (SELECT 1 FROM public.company_assignments assignment
              WHERE assignment.company_id=company.id
                AND assignment.manager_user_id=responsible.id AND assignment.status='ACTIVE')
            OR EXISTS (SELECT 1 FROM public.company_memberships membership
              WHERE membership.company_id=company.id AND membership.user_id=responsible.id
                AND membership.status='ACTIVE')
          )
      ),'[]'::jsonb),
      'items',COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id',item.id,'code',item.item_code,'label',item.label,
          'description',item.description,'required',item.required,'status',item.status,
          'responsibleRole',item.responsible_role,
          'responsibleUserId',item.responsible_user_id,
          'notes',item.notes,'evidenceReference',item.evidence_reference,
          'evidenceMetadata',item.evidence_metadata,'dueAt',item.due_at,
          'completedAt',item.completed_at,
          'exceptionReason',item.exception_reason,
          'exceptionApprovedAt',item.exception_approved_at,
          'exceptionExpiresAt',item.exception_expires_at
        )) ORDER BY item.required DESC,item.item_code)
        FROM public.company_onboarding_items item WHERE item.company_id=company.id
      ),'[]'::jsonb),
      'verificationHistory',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',history.id,'fromStatus',history.from_status,'toStatus',history.to_status,
          'reason',history.reason,'changedAt',history.changed_at,
          'changedByName',actor.display_name
        ) ORDER BY history.changed_at DESC,history.id DESC)
        FROM (SELECT * FROM public.company_verification_history
          WHERE company_id=company.id ORDER BY changed_at DESC,id DESC LIMIT 20) history
        LEFT JOIN public.users actor ON actor.id=history.changed_by
      ),'[]'::jsonb)
    ) FROM public.companies company WHERE company.id=p_company_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_onboarding_mutation(
  p_company_id uuid,p_actor_user_id uuid,p_event_key text,p_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'companyId',company.id,'companyName',company.name,
    'version',company.onboarding_version,'eventKey',p_event_key,
    'notificationRecipientIds',to_jsonb(public.axora_company_onboarding_recipients(
      company.id,p_actor_user_id,p_at
    ))
  ) FROM public.companies company WHERE company.id=p_company_id
$$;

CREATE OR REPLACE FUNCTION public.axora_save_company_onboarding(
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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; current_status text; custom_allowed boolean;
  previous_verification text;
BEGIN
  IF char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_default_locale NOT IN ('en','ar','ms')
    OR NOT (p_timezone='UTC' OR p_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$')
    OR p_current_step NOT IN (
      'LEGAL_IDENTITY','INDUSTRY','ADDRESSES','CONTACTS','BILLING',
      'PROCUREMENT','BRAND','ADMINISTRATOR','REVIEW'
    ) OR cardinality(COALESCE(p_completed_steps,ARRAY[]::text[]))>9
    OR NOT COALESCE(p_completed_steps,ARRAY[]::text[]) <@ ARRAY[
      'LEGAL_IDENTITY','INDUSTRY','ADDRESSES','CONTACTS','BILLING',
      'PROCUREMENT','BRAND','ADMINISTRATOR','REVIEW'
    ]::text[]
  THEN RAISE EXCEPTION 'The company onboarding update is unavailable'; END IF;

  SELECT verification_status INTO previous_verification
  FROM public.companies WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF previous_verification IS NULL OR actor_snapshot IS NULL
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    ) THEN RAISE EXCEPTION 'The company onboarding update is unavailable'; END IF;

  SELECT allows_custom_label INTO custom_allowed
  FROM public.industry_taxonomy
  WHERE industry_code=p_industry_code AND active FOR KEY SHARE;
  IF custom_allowed IS NULL OR (custom_allowed
    AND char_length(btrim(COALESCE(p_industry_other_text,''))) NOT BETWEEN 2 AND 300)
  THEN RAISE EXCEPTION 'The company onboarding update is unavailable'; END IF;

  UPDATE public.companies SET
    legal_name=btrim(p_legal_name),registration_number=btrim(p_registration_number),
    registration_country_code=upper(btrim(p_registration_country_code)),
    tax_registration_number=btrim(p_tax_registration_number),
    industry_code=p_industry_code,
    industry_other_text=CASE WHEN custom_allowed THEN btrim(p_industry_other_text) ELSE NULL END,
    industry=CASE WHEN custom_allowed THEN btrim(p_industry_other_text)
      ELSE (SELECT name_en FROM public.industry_taxonomy WHERE industry_code=p_industry_code) END,
    registered_address=btrim(p_registered_address),operating_address=btrim(p_operating_address),
    main_contact_name=btrim(p_main_contact_name),main_contact_email=lower(btrim(p_main_contact_email)),
    main_contact_phone=btrim(p_main_contact_phone),
    billing_contact_name=btrim(p_billing_contact_name),
    billing_contact_email=lower(btrim(p_billing_contact_email)),
    billing_contact_phone=btrim(p_billing_contact_phone),billing_address=btrim(p_billing_address),
    billing_cycle=btrim(p_billing_cycle),default_locale=p_default_locale,timezone=p_timezone,
    onboarding_current_step=p_current_step,
    onboarding_completed_steps=COALESCE(p_completed_steps,ARRAY[]::text[]),
    onboarding_version=onboarding_version+1,onboarding_saved_at=p_at,
    verification_status=CASE WHEN verification_status='NOT_STARTED' THEN 'IN_PROGRESS'
      WHEN verification_status='VERIFIED' THEN 'CHANGES_REQUIRED' ELSE verification_status END,
    verification_updated_at=CASE WHEN verification_status IN ('NOT_STARTED','VERIFIED')
      THEN p_at ELSE verification_updated_at END,
    verification_updated_by=CASE WHEN verification_status IN ('NOT_STARTED','VERIFIED')
      THEN p_actor_user_id ELSE verification_updated_by END,
    updated_at=p_at
  WHERE id=p_company_id;

  UPDATE public.company_onboarding_items item SET
    status='PASSED',blocking_reason=NULL,completed_by=p_actor_user_id,completed_at=p_at
  WHERE item.company_id=p_company_id AND item.status IN ('PENDING','FAILED') AND (
    (item.item_code='LEGAL_IDENTITY' AND btrim(p_legal_name)<>''
      AND btrim(p_registration_number)<>'' AND p_registration_country_code ~ '^[A-Za-z]{2}$')
    OR item.item_code='INDUSTRY_CLASSIFICATION'
    OR (item.item_code='REGISTERED_ADDRESS' AND btrim(p_registered_address)<>''
      AND btrim(p_operating_address)<>'')
    OR (item.item_code='PRIMARY_CONTACT' AND btrim(p_main_contact_name)<>''
      AND btrim(p_main_contact_email)<>'' AND btrim(p_main_contact_phone)<>'')
    OR (item.item_code='BILLING_CONFIGURATION' AND btrim(p_billing_address)<>''
      AND btrim(p_billing_cycle)<>'')
    OR item.item_code='PROCUREMENT_CONFIGURATION'
  );

  SELECT verification_status INTO current_status FROM public.companies WHERE id=p_company_id;
  IF current_status IS DISTINCT FROM previous_verification THEN
    INSERT INTO public.company_verification_history(
      company_id,from_status,to_status,reason,evidence,changed_by,changed_at
    ) VALUES (
      p_company_id,previous_verification,current_status,btrim(p_reason),
      jsonb_build_object('source','PROFILE_SAVE'),p_actor_user_id,p_at
    );
  END IF;
  RETURN public.axora_company_onboarding_mutation(
    p_company_id,p_actor_user_id,'company.onboarding.updated',p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_update_company_onboarding_item(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_item_code text,p_status text,
  p_responsible_user_id uuid,p_notes text,p_evidence_reference text,
  p_due_at timestamptz,p_exception_reason text,p_exception_expires_at timestamptz,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; item_id uuid; can_approve boolean; next_verification text;
  prior_verification text;
BEGIN
  IF p_status NOT IN ('PENDING','PASSED','FAILED','WAIVED')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(btrim(COALESCE(p_notes,'')))>3000
    OR char_length(btrim(COALESCE(p_evidence_reference,'')))>1000
  THEN RAISE EXCEPTION 'The onboarding checklist update is unavailable'; END IF;
  SELECT verification_status INTO prior_verification
  FROM public.companies WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF prior_verification IS NULL OR actor_snapshot IS NULL
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.edit',p_at
    ) THEN RAISE EXCEPTION 'The onboarding checklist update is unavailable'; END IF;
  can_approve:=public.axora_company_actor_has_permission(
    actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
  );
  IF p_status='WAIVED' AND (NOT can_approve
    OR char_length(btrim(COALESCE(p_exception_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_exception_expires_at IS NULL OR p_exception_expires_at<=p_at)
  THEN RAISE EXCEPTION 'The onboarding checklist update is unavailable'; END IF;
  IF p_responsible_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users responsible
    WHERE responsible.id=p_responsible_user_id AND responsible.active
      AND (EXISTS (SELECT 1 FROM public.company_assignments assignment
        WHERE assignment.company_id=p_company_id
          AND assignment.manager_user_id=responsible.id AND assignment.status='ACTIVE')
        OR EXISTS (SELECT 1 FROM public.company_memberships membership
          WHERE membership.company_id=p_company_id AND membership.user_id=responsible.id
            AND membership.status IN ('INVITED','ACTIVE')))
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
  WHERE company_id=p_company_id AND item_code=p_item_code RETURNING id INTO item_id;
  IF item_id IS NULL THEN RAISE EXCEPTION 'The onboarding checklist update is unavailable'; END IF;

  UPDATE public.company_onboarding_reminders SET status='CANCELLED'
  WHERE onboarding_item_id=item_id AND status='PENDING';
  IF p_due_at IS NOT NULL AND p_status IN ('PENDING','FAILED')
    AND p_responsible_user_id IS NOT NULL THEN
    INSERT INTO public.company_onboarding_reminders(
      company_id,onboarding_item_id,recipient_user_id,due_at,created_by
    ) VALUES (p_company_id,item_id,p_responsible_user_id,p_due_at,p_actor_user_id);
  END IF;

  next_verification:=CASE
    WHEN cardinality(public.axora_company_onboarding_content_blockers(p_company_id,p_at))=0
      THEN 'READY_FOR_REVIEW'
    WHEN prior_verification='NOT_STARTED' THEN 'IN_PROGRESS'
    ELSE 'CHANGES_REQUIRED' END;
  UPDATE public.companies SET onboarding_version=onboarding_version+1,
    onboarding_saved_at=p_at,verification_status=next_verification,
    verification_updated_at=p_at,verification_updated_by=p_actor_user_id,updated_at=p_at
  WHERE id=p_company_id;
  IF next_verification IS DISTINCT FROM prior_verification THEN
    INSERT INTO public.company_verification_history(
      company_id,from_status,to_status,reason,evidence,changed_by,changed_at
    ) VALUES (p_company_id,prior_verification,next_verification,btrim(p_reason),
      jsonb_build_object('source','CHECKLIST','itemCode',p_item_code),p_actor_user_id,p_at);
  END IF;
  RETURN public.axora_company_onboarding_mutation(
    p_company_id,p_actor_user_id,
    CASE WHEN next_verification='READY_FOR_REVIEW'
      THEN 'company.onboarding.ready' ELSE 'company.onboarding.updated' END,p_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_verify_company_onboarding(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_expected_version integer,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; prior_verification text; blockers text[];
BEGIN
  SELECT verification_status INTO prior_verification
  FROM public.companies WHERE id=p_company_id AND onboarding_version=p_expected_version
  FOR UPDATE;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  blockers:=public.axora_company_onboarding_content_blockers(p_company_id,p_at);
  IF prior_verification IS NULL OR actor_snapshot IS NULL
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR cardinality(blockers)>0
    OR NOT public.axora_company_actor_has_permission(
      actor_snapshot,p_actor_user_id,p_company_id,'company.activate',p_at
    ) THEN RAISE EXCEPTION 'The company onboarding verification is unavailable'; END IF;
  UPDATE public.companies SET verification_status='VERIFIED',
    verification_updated_at=p_at,verification_updated_by=p_actor_user_id,
    onboarding_version=onboarding_version+1,onboarding_saved_at=p_at,updated_at=p_at
  WHERE id=p_company_id;
  IF prior_verification<>'VERIFIED' THEN
    INSERT INTO public.company_verification_history(
      company_id,from_status,to_status,reason,evidence,changed_by,changed_at
    ) VALUES (p_company_id,prior_verification,'VERIFIED',btrim(p_reason),
      jsonb_build_object('source','VERIFICATION','blockers',to_jsonb(blockers)),
      p_actor_user_id,p_at);
  END IF;
  RETURN public.axora_company_onboarding_mutation(
    p_company_id,p_actor_user_id,'company.onboarding.verified',p_at
  );
END $$;

REVOKE ALL ON TABLE public.industry_taxonomy,public.company_verification_history,
  public.company_onboarding_reminders FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_default_company_onboarding_fields(),
  public.axora_default_onboarding_item_detail(),
  public.axora_seed_company_onboarding_completion(),
  public.axora_company_onboarding_content_blockers(uuid,timestamptz),
  public.axora_company_onboarding_recipients(uuid,uuid,timestamptz),
  public.axora_company_onboarding_mutation(uuid,uuid,text,timestamptz),
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
    REVOKE ALL ON TABLE public.industry_taxonomy,public.company_verification_history,
      public.company_onboarding_reminders FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz),
      public.axora_save_company_onboarding(
        uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,
        text,text,text,text,text,text,text,text,text[],text,timestamptz
      ),
      public.axora_update_company_onboarding_item(
        uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz
      ),
      public.axora_verify_company_onboarding(uuid,uuid,uuid,integer,text,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
