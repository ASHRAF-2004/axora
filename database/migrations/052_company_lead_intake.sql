BEGIN;

-- P0-05: public enquiries become durable, trackable company leads. Existing
-- contact rows remain the original interaction and email-delivery source.
CREATE SEQUENCE IF NOT EXISTS public.company_lead_code_seq START WITH 1000;

CREATE TABLE public.company_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_code text NOT NULL UNIQUE DEFAULT (
    'LEAD-' || lpad(nextval('public.company_lead_code_seq')::text,8,'0')
  ) CHECK (lead_code ~ '^LEAD-[0-9]{8,}$'),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED',
    'CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
  )),
  status_version integer NOT NULL DEFAULT 1 CHECK (status_version>0),
  lead_source text NOT NULL DEFAULT 'WEBSITE_CONTACT' CHECK (
    char_length(btrim(lead_source)) BETWEEN 2 AND 80
      AND lead_source ~ '^[A-Z][A-Z0-9_]*$'
  ),
  duplicate_risk text NOT NULL DEFAULT 'CLEAR' CHECK (
    duplicate_risk IN ('CLEAR','POSSIBLE_DUPLICATE','CLEARED','CONFIRMED')
  ),
  uses_personal_email boolean NOT NULL DEFAULT false,
  sla_due_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  first_contacted_at timestamptz,
  first_contacted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  converted_company_id uuid UNIQUE REFERENCES public.companies(id) ON DELETE RESTRICT,
  duplicate_of_lead_id uuid REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  duplicate_of_company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  retention_until timestamptz NOT NULL DEFAULT (now()+interval '24 months'),
  anonymized_at timestamptz,
  anonymized_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sla_due_at>=created_at AND retention_until>created_at),
  CHECK (first_contacted_at IS NULL OR first_contacted_at>=created_at),
  CHECK (NOT (duplicate_of_lead_id IS NOT NULL AND duplicate_of_company_id IS NOT NULL)),
  CHECK (duplicate_of_lead_id IS NULL OR duplicate_of_lead_id<>id),
  CHECK (status<>'CONVERTED' OR converted_company_id IS NOT NULL),
  CHECK (status<>'DUPLICATE' OR duplicate_of_lead_id IS NOT NULL
    OR duplicate_of_company_id IS NOT NULL),
  CHECK ((anonymized_at IS NULL AND anonymized_by IS NULL)
    OR (anonymized_at IS NOT NULL AND anonymized_by IS NOT NULL))
);
CREATE INDEX company_leads_queue_idx
  ON public.company_leads(status,created_at DESC,id);
CREATE INDEX company_leads_sla_idx
  ON public.company_leads(sla_due_at,id)
  WHERE first_contacted_at IS NULL
    AND status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED');

ALTER TABLE public.public_contact_submissions
  ADD COLUMN lead_id uuid REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  ADD COLUMN idempotency_key text,
  ADD COLUMN company_legal_name text NOT NULL DEFAULT '',
  ADD COLUMN company_registration_number text NOT NULL DEFAULT '',
  ADD COLUMN phone_country_code text NOT NULL DEFAULT '',
  ADD COLUMN country text NOT NULL DEFAULT '',
  ADD COLUMN region text NOT NULL DEFAULT '',
  ADD COLUMN city text NOT NULL DEFAULT '',
  ADD COLUMN industry text NOT NULL DEFAULT '',
  ADD COLUMN employee_count_range text NOT NULL DEFAULT 'NOT_PROVIDED',
  ADD COLUMN branch_count_range text NOT NULL DEFAULT 'NOT_PROVIDED',
  ADD COLUMN monthly_spend_range text NOT NULL DEFAULT 'NOT_PROVIDED',
  ADD COLUMN preferred_contact_method text NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN preferred_contact_time text NOT NULL DEFAULT '',
  ADD COLUMN contact_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN display_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN privacy_policy_version text NOT NULL DEFAULT 'legacy-contact-v1',
  ADD COLUMN source_page text NOT NULL DEFAULT '/contact',
  ADD COLUMN source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN acknowledgement_status text NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledgement_finalized_at timestamptz;

UPDATE public.public_contact_submissions
SET company_legal_name=CASE WHEN btrim(company_legal_name)='' THEN company_name ELSE company_legal_name END,
    country=CASE WHEN btrim(country)='' THEN 'Not provided' ELSE country END,
    region=CASE WHEN btrim(region)='' THEN 'Not provided' ELSE region END,
    city=CASE WHEN btrim(city)='' THEN 'Not provided' ELSE city END,
    industry=CASE WHEN btrim(industry)='' THEN 'Not provided' ELSE industry END,
    idempotency_key=md5('legacy-company-lead:a:'||id::text)
      ||md5('legacy-company-lead:b:'||id::text)
WHERE idempotency_key IS NULL;

INSERT INTO public.company_leads(
  id,lead_code,status,lead_source,sla_due_at,retention_until,created_at,updated_at
)
SELECT submission.id,
  'LEAD-'||lpad(nextval('public.company_lead_code_seq')::text,8,'0'),
  'NEW','LEGACY_CONTACT',submission.created_at+interval '24 hours',
  submission.created_at+interval '24 months',submission.created_at,submission.created_at
FROM public.public_contact_submissions submission
WHERE submission.lead_id IS NULL;
UPDATE public.public_contact_submissions SET lead_id=id WHERE lead_id IS NULL;

ALTER TABLE public.public_contact_submissions
  ALTER COLUMN lead_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT public_contact_submissions_idempotency_key_check
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT public_contact_submissions_company_legal_name_check
    CHECK (char_length(btrim(company_legal_name)) BETWEEN 2 AND 300
      AND company_legal_name !~ '[[:cntrl:]]'),
  ADD CONSTRAINT public_contact_submissions_registration_number_check
    CHECK (char_length(btrim(company_registration_number))<=160
      AND company_registration_number !~ '[[:cntrl:]]'),
  ADD CONSTRAINT public_contact_submissions_phone_country_code_check
    CHECK (char_length(btrim(phone_country_code))<=12
      AND phone_country_code !~ '[[:cntrl:]]'),
  ADD CONSTRAINT public_contact_submissions_location_check
    CHECK (char_length(btrim(country)) BETWEEN 2 AND 120
      AND char_length(btrim(region)) BETWEEN 2 AND 160
      AND char_length(btrim(city)) BETWEEN 2 AND 160),
  ADD CONSTRAINT public_contact_submissions_industry_check
    CHECK (char_length(btrim(industry)) BETWEEN 2 AND 200
      AND industry !~ '[[:cntrl:]]'),
  ADD CONSTRAINT public_contact_submissions_employee_range_check CHECK (
    employee_count_range IN (
      'NOT_PROVIDED','1_10','11_50','51_200','201_500','501_1000','1001_PLUS'
    )
  ),
  ADD CONSTRAINT public_contact_submissions_branch_range_check CHECK (
    branch_count_range IN ('NOT_PROVIDED','1','2_5','6_20','21_50','51_PLUS')
  ),
  ADD CONSTRAINT public_contact_submissions_spend_range_check CHECK (
    monthly_spend_range IN (
      'NOT_PROVIDED','UNDER_10K','10K_50K','50K_250K','250K_1M','OVER_1M','UNDISCLOSED'
    )
  ),
  ADD CONSTRAINT public_contact_submissions_contact_method_check CHECK (
    preferred_contact_method IN ('EMAIL','PHONE','WHATSAPP','VIDEO_CALL')
  ),
  ADD CONSTRAINT public_contact_submissions_contact_time_check CHECK (
    char_length(btrim(preferred_contact_time))<=160
      AND preferred_contact_time !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT public_contact_submissions_contact_timezone_check CHECK (
    char_length(btrim(contact_timezone)) BETWEEN 1 AND 80
      AND contact_timezone !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT public_contact_submissions_display_timezone_check CHECK (
    char_length(btrim(display_timezone)) BETWEEN 1 AND 80
      AND display_timezone !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT public_contact_submissions_policy_version_check CHECK (
    char_length(btrim(privacy_policy_version)) BETWEEN 1 AND 80
      AND privacy_policy_version ~ '^[A-Za-z0-9._-]+$'
  ),
  ADD CONSTRAINT public_contact_submissions_source_page_check CHECK (
    char_length(source_page) BETWEEN 1 AND 500
      AND source_page ~ '^/' AND source_page !~ '://'
      AND source_page !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT public_contact_submissions_source_metadata_check CHECK (
    jsonb_typeof(source_metadata)='object'
      AND public.workflow_metadata_is_safe(source_metadata)
  ),
  ADD CONSTRAINT public_contact_submissions_ack_status_check CHECK (
    (acknowledgement_status='QUEUED'
      AND acknowledged_at IS NULL AND acknowledgement_finalized_at IS NULL)
    OR (acknowledgement_status='SENT'
      AND acknowledged_at IS NOT NULL AND acknowledgement_finalized_at IS NOT NULL)
    OR (acknowledgement_status IN ('FAILED','UNCERTAIN','CANCELLED')
      AND acknowledged_at IS NULL AND acknowledgement_finalized_at IS NOT NULL)
  );
CREATE UNIQUE INDEX public_contact_submissions_idempotency_uq
  ON public.public_contact_submissions(idempotency_key);
CREATE INDEX public_contact_submissions_lead_idx
  ON public.public_contact_submissions(lead_id,created_at DESC,id DESC);

CREATE TABLE public.company_lead_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  status_version integer NOT NULL CHECK (status_version>0),
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata)
  ),
  UNIQUE(lead_id,status_version),
  CHECK (from_status IS NULL OR from_status<>to_status)
);
CREATE INDEX company_lead_status_history_idx
  ON public.company_lead_status_history(lead_id,status_version DESC);
INSERT INTO public.company_lead_status_history(
  lead_id,status_version,from_status,to_status,reason,changed_at,metadata
)
SELECT lead.id,1,NULL,'NEW','Existing contact submission migrated to company lead',
  lead.created_at,jsonb_build_object('source','LEGACY_CONTACT')
FROM public.company_leads lead;

CREATE TABLE public.company_lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assignment_reason text NOT NULL CHECK (
    char_length(btrim(assignment_reason)) BETWEEN 3 AND 1000
  ),
  ended_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  end_reason text CHECK (char_length(btrim(COALESCE(end_reason,'')))<=1000),
  CHECK ((status='ACTIVE' AND ended_by IS NULL AND ended_at IS NULL)
    OR (status='ENDED' AND ended_by IS NOT NULL AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX company_lead_assignments_active_uq
  ON public.company_lead_assignments(lead_id) WHERE status='ACTIVE';
CREATE INDEX company_lead_assignments_manager_idx
  ON public.company_lead_assignments(manager_user_id,status,lead_id);

CREATE TABLE public.company_lead_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  candidate_lead_id uuid REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  candidate_company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  matched_fields jsonb NOT NULL CHECK (
    jsonb_typeof(matched_fields)='array' AND jsonb_array_length(matched_fields)>0
  ),
  review_status text NOT NULL DEFAULT 'PENDING' CHECK (
    review_status IN ('PENDING','CLEARED','CONFIRMED')
  ),
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text CHECK (char_length(btrim(COALESCE(review_reason,'')))<=1000),
  CHECK ((candidate_lead_id IS NOT NULL)::integer
    +(candidate_company_id IS NOT NULL)::integer=1),
  CHECK (candidate_lead_id IS NULL OR candidate_lead_id<>lead_id),
  CHECK ((review_status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (review_status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX company_lead_duplicate_lead_uq
  ON public.company_lead_duplicate_candidates(lead_id,candidate_lead_id)
  WHERE candidate_lead_id IS NOT NULL;
CREATE UNIQUE INDEX company_lead_duplicate_company_uq
  ON public.company_lead_duplicate_candidates(lead_id,candidate_company_id)
  WHERE candidate_company_id IS NOT NULL;

CREATE TABLE public.company_lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  note_type text NOT NULL CHECK (
    note_type IN ('INTERNAL','CONTACT_ATTEMPT','INFORMATION_RECEIVED')
  ),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 2 AND 5000),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_lead_notes_idx
  ON public.company_lead_notes(lead_id,created_at DESC,id DESC);

CREATE TABLE public.company_lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  due_at timestamptz NOT NULL,
  assigned_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN','COMPLETED','CANCELLED')
  ),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  completion_note text CHECK (
    char_length(btrim(COALESCE(completion_note,'')))<=1000
  ),
  CHECK ((status='OPEN' AND completed_by IS NULL AND completed_at IS NULL)
    OR (status<>'OPEN' AND completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX company_lead_tasks_open_idx
  ON public.company_lead_tasks(assigned_user_id,due_at,lead_id)
  WHERE status='OPEN';

CREATE TABLE public.company_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  event_version integer NOT NULL CHECK (event_version>0),
  event_key text NOT NULL CHECK (
    char_length(event_key) BETWEEN 2 AND 120
      AND event_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  stable_key text NOT NULL CHECK (
    char_length(stable_key) BETWEEN 2 AND 160 AND stable_key !~ '[[:cntrl:]]'
  ),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata)
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id,event_version),UNIQUE(lead_id,stable_key),UNIQUE(id,lead_id)
);
CREATE INDEX company_lead_events_idx
  ON public.company_lead_events(lead_id,event_version DESC);
INSERT INTO public.company_lead_events(
  lead_id,event_version,event_key,stable_key,metadata,occurred_at
)
SELECT lead.id,1,'company.lead.submitted','legacy-submission',
  jsonb_build_object('source','LEGACY_CONTACT'),lead.created_at
FROM public.company_leads lead;

-- Preserve additive compatibility for trusted maintenance jobs and historical
-- test fixtures that still insert the original contact shape. Public traffic
-- uses axora_record_public_company_lead instead.
CREATE OR REPLACE FUNCTION public.axora_prepare_legacy_public_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE generated_lead_id uuid;
BEGIN
  IF NEW.id IS NULL THEN NEW.id:=gen_random_uuid(); END IF;
  IF NEW.idempotency_key IS NULL THEN
    NEW.idempotency_key:=md5('legacy-company-lead:a:'||NEW.id::text)
      ||md5('legacy-company-lead:b:'||NEW.id::text);
  END IF;
  IF btrim(COALESCE(NEW.company_legal_name,''))='' THEN
    NEW.company_legal_name:=NEW.company_name;
  END IF;
  IF btrim(COALESCE(NEW.country,''))='' THEN NEW.country:='Not provided'; END IF;
  IF btrim(COALESCE(NEW.region,''))='' THEN NEW.region:='Not provided'; END IF;
  IF btrim(COALESCE(NEW.city,''))='' THEN NEW.city:='Not provided'; END IF;
  IF btrim(COALESCE(NEW.industry,''))='' THEN NEW.industry:='Not provided'; END IF;
  IF NEW.lead_id IS NULL THEN
    INSERT INTO public.company_leads(
      status,status_version,lead_source,sla_due_at,retention_until,
      created_at,updated_at
    ) VALUES (
      'NEW',1,'LEGACY_CONTACT',COALESCE(NEW.created_at,now())+interval '24 hours',
      COALESCE(NEW.created_at,now())+interval '24 months',
      COALESCE(NEW.created_at,now()),COALESCE(NEW.created_at,now())
    ) RETURNING id INTO generated_lead_id;
    NEW.lead_id:=generated_lead_id;
    INSERT INTO public.company_lead_status_history(
      lead_id,status_version,from_status,to_status,reason,changed_at,metadata
    ) VALUES (
      generated_lead_id,1,NULL,'NEW','Legacy contact interaction received',
      COALESCE(NEW.created_at,now()),jsonb_build_object('source','LEGACY_CONTACT')
    );
    PERFORM public.axora_append_company_lead_event(
      generated_lead_id,'company.lead.submitted','legacy-submission',NULL,
      jsonb_build_object('source','LEGACY_CONTACT'),COALESCE(NEW.created_at,now())
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prepare_legacy_public_contact
BEFORE INSERT ON public.public_contact_submissions
FOR EACH ROW EXECUTE FUNCTION public.axora_prepare_legacy_public_contact();

CREATE TABLE public.company_lead_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  access_kind text NOT NULL CHECK (access_kind IN ('VIEW','EXPORT')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_lead_access_events_idx
  ON public.company_lead_access_events(lead_id,occurred_at DESC,id DESC);

-- Pre-conversion leads have no tenant. Extend the personal notification table
-- with an exclusive lead-event source while retaining tenant workflow FKs.
ALTER TABLE public.in_app_notifications
  ALTER COLUMN company_id DROP NOT NULL,
  ALTER COLUMN workflow_event_id DROP NOT NULL,
  ADD COLUMN lead_event_id uuid
    REFERENCES public.company_lead_events(id) ON DELETE RESTRICT,
  ADD CONSTRAINT in_app_notifications_source_check CHECK (
    (company_id IS NOT NULL AND workflow_event_id IS NOT NULL
      AND lead_event_id IS NULL)
    OR (company_id IS NULL AND workflow_event_id IS NULL
      AND lead_event_id IS NOT NULL)
  );
CREATE UNIQUE INDEX in_app_notifications_lead_dedupe_uq
  ON public.in_app_notifications(recipient_user_id,dedupe_key)
  WHERE lead_event_id IS NOT NULL;
CREATE INDEX in_app_notifications_lead_event_idx
  ON public.in_app_notifications(lead_event_id) WHERE lead_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_in_app_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_event_key text; recipient_is_active boolean;
BEGIN
  IF NEW.lead_event_id IS NOT NULL THEN
    SELECT event_key INTO source_event_key
    FROM public.company_lead_events WHERE id=NEW.lead_event_id;
    IF NEW.company_id IS NOT NULL OR NEW.workflow_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Lead notification source is invalid';
    END IF;
  ELSE
    SELECT event_key INTO source_event_key FROM public.workflow_events
    WHERE id=NEW.workflow_event_id AND company_id=NEW.company_id;
  END IF;
  IF source_event_key IS NULL OR source_event_key<>NEW.event_key THEN
    RAISE EXCEPTION 'Notification event key must match its source event';
  END IF;
  SELECT active AND account_status IN ('ACTIVE','INVITED')
  INTO recipient_is_active FROM public.users WHERE id=NEW.recipient_user_id;
  IF recipient_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Notification recipient must be an active account';
  END IF;
  RETURN NEW;
END $$;

-- Queue one private intake notification and one visitor acknowledgement.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.transactional_email_outbox'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%message_kind%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transactional_email_outbox DROP CONSTRAINT %I',
      item.conname
    );
  END LOOP;
END $$;
ALTER TABLE public.transactional_email_outbox
  DROP CONSTRAINT transactional_email_outbox_contact_submission_id_key,
  ADD CONSTRAINT transactional_email_outbox_message_kind_v2_check CHECK (
    message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT',
      'PASSWORD_RESET','EMAIL_VERIFICATION')
  ),
  ADD CONSTRAINT transactional_email_outbox_source_v2_check CHECK (
    (message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT')
      AND contact_submission_id IS NOT NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind='PASSWORD_RESET' AND contact_submission_id IS NULL
      AND password_reset_token_id IS NOT NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind='EMAIL_VERIFICATION' AND contact_submission_id IS NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NOT NULL)
  ),
  ADD CONSTRAINT transactional_email_outbox_payload_v2_check CHECK (
    (message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT')
      AND token_ciphertext IS NULL AND token_nonce IS NULL
      AND token_authentication_tag IS NULL)
    OR (message_kind IN ('PASSWORD_RESET','EMAIL_VERIFICATION') AND (
      (delivery_status IN ('PENDING','SENDING')
        AND token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL
        AND token_authentication_tag IS NOT NULL)
      OR (delivery_status NOT IN ('PENDING','SENDING')
        AND token_ciphertext IS NULL AND token_nonce IS NULL
        AND token_authentication_tag IS NULL)
    ))
  );
CREATE UNIQUE INDEX transactional_email_outbox_contact_kind_uq
  ON public.transactional_email_outbox(contact_submission_id,message_kind)
  WHERE contact_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_public_contact_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_text text; actor uuid;
BEGIN
  actor_text:=current_setting('axora.user_id',true);
  IF actor_text IS NOT NULL AND actor_text<>'' THEN actor:=actor_text::uuid; END IF;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,reason
  ) VALUES (
    TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object(
      'lead_id',OLD.lead_id,'notification_status',OLD.notification_status,
      'acknowledgement_status',OLD.acknowledgement_status,
      'created_at',OLD.created_at,'notified_at',OLD.notified_at,
      'acknowledged_at',OLD.acknowledged_at
    ) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object(
      'lead_id',NEW.lead_id,'notification_status',NEW.notification_status,
      'acknowledgement_status',NEW.acknowledgement_status,
      'created_at',NEW.created_at,'notified_at',NEW.notified_at,
      'acknowledged_at',NEW.acknowledged_at
    ) END,
    actor,current_setting('axora.change_reason',true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Company lead evidence is append-only'; END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'company_lead_status_history','company_lead_notes',
    'company_lead_events','company_lead_access_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER protect_%I_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.axora_company_lead_append_only()',
      table_name,table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_protect_company_lead_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
    OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.assignment_reason IS DISTINCT FROM OLD.assignment_reason
    OR OLD.status='ENDED' THEN
    RAISE EXCEPTION 'Company lead assignment identity is immutable';
  END IF;
  IF OLD.status='ACTIVE' AND NEW.status<>'ENDED' THEN
    RAISE EXCEPTION 'Company lead assignment transition is invalid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_company_lead_assignment
BEFORE UPDATE ON public.company_lead_assignments
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_company_lead_assignment();

CREATE OR REPLACE FUNCTION public.axora_company_lead_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_lead_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_actor_is_owner(p_snapshot) OR (
    public.axora_company_snapshot_role_permission(p_snapshot,'company.lead.view')
    AND EXISTS (
      SELECT 1 FROM public.company_lead_assignments assignment
      WHERE assignment.lead_id=p_lead_id AND assignment.status='ACTIVE'
        AND assignment.manager_user_id=p_actor_user_id
        AND assignment.assigned_at<=p_at
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_manager_is_valid(
  p_user_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users account
    WHERE account.id=p_user_id AND account.active
      AND account.account_status='ACTIVE' AND account.account_kind='PLATFORM'
      AND account.account_setup_completed_at IS NOT NULL
      AND (account.is_owner OR EXISTS (
        SELECT 1 FROM public.role_assignments assignment
        JOIN public.roles role ON role.id=assignment.role_id
        WHERE assignment.user_id=account.id AND assignment.active
          AND assignment.revoked_at IS NULL AND assignment.assigned_at<=p_at
          AND role.role_key='CLIENT_ACCOUNT_MANAGER'
      ))
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_recipient_ids(
  p_lead_id uuid,p_include_owners boolean DEFAULT true
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT recipient_id),'[]'::jsonb)
  FROM (
    SELECT account.id::text AS recipient_id FROM public.users account
    WHERE p_include_owners AND account.active AND account.account_status='ACTIVE'
      AND account.account_kind='PLATFORM' AND (account.is_owner OR EXISTS (
        SELECT 1 FROM public.role_assignments assignment
        JOIN public.roles role ON role.id=assignment.role_id
        WHERE assignment.user_id=account.id AND assignment.active
          AND assignment.revoked_at IS NULL AND role.role_key='PLATFORM_OWNER'
      ))
    UNION ALL
    SELECT assignment.manager_user_id::text
    FROM public.company_lead_assignments assignment
    JOIN public.users account ON account.id=assignment.manager_user_id
    WHERE assignment.lead_id=p_lead_id AND assignment.status='ACTIVE'
      AND account.active AND account.account_status='ACTIVE'
  ) recipients
$$;

CREATE OR REPLACE FUNCTION public.axora_append_company_lead_event(
  p_lead_id uuid,p_event_key text,p_stable_key text,p_actor_user_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE existing public.company_lead_events%ROWTYPE;
  event_row public.company_lead_events%ROWTYPE;
BEGIN
  IF p_event_key !~ '^[a-z][a-z0-9_.-]{1,119}$'
    OR char_length(btrim(COALESCE(p_stable_key,''))) NOT BETWEEN 2 AND 160
    OR jsonb_typeof(COALESCE(p_metadata,'{}'::jsonb))<>'object'
    OR NOT public.workflow_metadata_is_safe(COALESCE(p_metadata,'{}'::jsonb))
  THEN RAISE EXCEPTION 'Company lead event is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('company-lead-event:'||p_lead_id::text,0)
  );
  SELECT * INTO existing FROM public.company_lead_events
  WHERE lead_id=p_lead_id AND stable_key=p_stable_key;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('id',existing.id,'leadId',existing.lead_id,
      'eventKey',existing.event_key,'eventVersion',existing.event_version,
      'created',false,'occurredAt',existing.occurred_at);
  END IF;
  INSERT INTO public.company_lead_events(
    lead_id,event_version,event_key,stable_key,actor_user_id,metadata,occurred_at
  ) SELECT p_lead_id,COALESCE(max(event_version),0)+1,p_event_key,p_stable_key,
      p_actor_user_id,COALESCE(p_metadata,'{}'::jsonb),p_at
    FROM public.company_lead_events WHERE lead_id=p_lead_id
  RETURNING * INTO event_row;
  RETURN jsonb_build_object('id',event_row.id,'leadId',event_row.lead_id,
    'eventKey',event_row.event_key,'eventVersion',event_row.event_version,
    'created',true,'occurredAt',event_row.occurred_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_mutation_payload(
  p_lead_id uuid,p_event jsonb
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'leadId',lead.id,'leadCode',lead.lead_code,'status',lead.status,
    'statusVersion',lead.status_version,'event',p_event,
    'notificationRecipientIds',public.axora_company_lead_recipient_ids(lead.id,true)
  ) FROM public.company_leads lead WHERE lead.id=p_lead_id
$$;

CREATE OR REPLACE FUNCTION public.axora_record_public_company_lead(
  p_input jsonb,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE
  existing_submission public.public_contact_submissions%ROWTYPE;
  new_lead_id uuid; submission_id uuid; event jsonb; duplicate_count integer;
  email_domain text; personal_email boolean;
  v_idempotency_key text:=p_input->>'idempotencyKey';
  locale text:=p_input->>'locale';
  contact_name text:=p_input->>'contactName';
  contact_email text:=lower(btrim(p_input->>'contactEmail'));
  company_name text:=p_input->>'companyName';
  legal_name text:=p_input->>'companyLegalName';
  registration_number text:=COALESCE(p_input->>'registrationNumber','');
  phone_country_code text:=COALESCE(p_input->>'phoneCountryCode','');
  phone_value text:=p_input->>'phone';
  country_value text:=p_input->>'country';
  region_value text:=p_input->>'region';
  city_value text:=p_input->>'city';
  industry_value text:=p_input->>'industry';
  employee_range text:=p_input->>'employeeRange';
  branch_range text:=p_input->>'branchRange';
  spend_range text:=p_input->>'spendRange';
  contact_method text:=p_input->>'contactMethod';
  contact_time text:=COALESCE(p_input->>'contactTime','');
  contact_timezone text:=p_input->>'contactTimezone';
  subject_value text:=p_input->>'subject';
  message_value text:=p_input->>'message';
  policy_version text:=p_input->>'privacyPolicyVersion';
  source_page text:=p_input->>'sourcePage';
  source_metadata jsonb:=COALESCE(p_input->'sourceMetadata','{}'::jsonb);
  network_key text:=p_input->>'networkRateKey';
  sender_key text:=p_input->>'senderRateKey';
  challenge_at timestamptz;
  hostname text:=lower(btrim(p_input->>'turnstileHostname'));
BEGIN
  BEGIN challenge_at:=(p_input->>'turnstileChallengeAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'The public company lead is invalid'; END;
  IF v_idempotency_key !~ '^[0-9a-f]{64}$' OR locale NOT IN ('en','ar','ms')
    OR char_length(btrim(COALESCE(contact_name,''))) NOT BETWEEN 2 AND 200
    OR char_length(contact_email) NOT BETWEEN 3 AND 254 OR position('@' IN contact_email)=0
    OR char_length(btrim(COALESCE(company_name,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(legal_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(registration_number))>160
    OR char_length(btrim(COALESCE(phone_value,''))) NOT BETWEEN 3 AND 40
    OR char_length(btrim(COALESCE(country_value,''))) NOT BETWEEN 2 AND 120
    OR char_length(btrim(COALESCE(region_value,''))) NOT BETWEEN 2 AND 160
    OR char_length(btrim(COALESCE(city_value,''))) NOT BETWEEN 2 AND 160
    OR char_length(btrim(COALESCE(industry_value,''))) NOT BETWEEN 2 AND 200
    OR employee_range NOT IN ('1_10','11_50','51_200','201_500','501_1000','1001_PLUS')
    OR branch_range NOT IN ('1','2_5','6_20','21_50','51_PLUS')
    OR spend_range NOT IN ('UNDER_10K','10K_50K','50K_250K','250K_1M','OVER_1M','UNDISCLOSED')
    OR contact_method NOT IN ('EMAIL','PHONE','WHATSAPP','VIDEO_CALL')
    OR char_length(btrim(COALESCE(subject_value,''))) NOT BETWEEN 3 AND 200
    OR char_length(btrim(COALESCE(message_value,''))) NOT BETWEEN 10 AND 5000
    OR network_key !~ '^[0-9a-f]{64}$' OR sender_key !~ '^[0-9a-f]{64}$'
    OR challenge_at<p_at-interval '5 minutes' OR challenge_at>p_at+interval '1 minute'
    OR char_length(btrim(COALESCE(policy_version,''))) NOT BETWEEN 1 AND 80
    OR source_page !~ '^/' OR source_page ~ '://'
    OR jsonb_typeof(source_metadata)<>'object'
    OR NOT public.workflow_metadata_is_safe(source_metadata)
  THEN RAISE EXCEPTION 'The public company lead is invalid'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('public-company-lead:'||v_idempotency_key,0)
  );
  SELECT * INTO existing_submission FROM public.public_contact_submissions
  WHERE public_contact_submissions.idempotency_key=v_idempotency_key;
  IF existing_submission.id IS NOT NULL THEN
    event:=public.axora_append_company_lead_event(
      existing_submission.lead_id,'company.lead.submitted','public-submission',
      NULL,jsonb_build_object('source','WEBSITE_CONTACT'),existing_submission.created_at
    );
    RETURN jsonb_build_object('created',false,
      'leadId',existing_submission.lead_id,'submissionId',existing_submission.id,
      'leadCode',(SELECT lead_code FROM public.company_leads
        WHERE id=existing_submission.lead_id),
      'event',event,'notificationRecipientIds','[]'::jsonb);
  END IF;

  email_domain:=public.axora_company_email_domain(contact_email);
  personal_email:=email_domain=ANY(ARRAY[
    'gmail.com','googlemail.com','yahoo.com','outlook.com','hotmail.com',
    'live.com','icloud.com','proton.me','protonmail.com','mail.com'
  ]);
  INSERT INTO public.company_leads(
    status,status_version,lead_source,uses_personal_email,sla_due_at,
    retention_until,created_at,updated_at
  ) VALUES ('NEW',1,'WEBSITE_CONTACT',personal_email,p_at+interval '24 hours',
    p_at+interval '24 months',p_at,p_at)
  RETURNING id INTO new_lead_id;

  INSERT INTO public.public_contact_submissions(
    lead_id,idempotency_key,locale,contact_name,contact_email,company_name,
    company_legal_name,company_registration_number,phone_country_code,phone,
    country,region,city,industry,employee_count_range,branch_count_range,
    monthly_spend_range,preferred_contact_method,preferred_contact_time,
    contact_timezone,display_timezone,subject,message,privacy_accepted_at,
    privacy_policy_version,source_page,source_metadata,network_rate_key,
    sender_rate_key,turnstile_success,turnstile_challenge_at,
    turnstile_verified_at,turnstile_hostname,turnstile_action,created_at
  ) VALUES (
    new_lead_id,v_idempotency_key,locale,btrim(contact_name),contact_email,
    btrim(company_name),btrim(legal_name),btrim(registration_number),
    btrim(phone_country_code),btrim(phone_value),btrim(country_value),
    btrim(region_value),btrim(city_value),btrim(industry_value),employee_range,
    branch_range,spend_range,contact_method,btrim(contact_time),
    btrim(contact_timezone),btrim(contact_timezone),btrim(subject_value),
    btrim(message_value),p_at,btrim(policy_version),source_page,source_metadata,
    network_key,sender_key,true,challenge_at,p_at,hostname,'contact',p_at
  ) RETURNING id INTO submission_id;
  INSERT INTO public.company_lead_status_history(
    lead_id,status_version,from_status,to_status,reason,changed_at,metadata
  ) VALUES (new_lead_id,1,NULL,'NEW','Website company enquiry received',p_at,
    jsonb_build_object('source','WEBSITE_CONTACT'));

  INSERT INTO public.company_lead_duplicate_candidates(
    lead_id,candidate_company_id,matched_fields,detected_at
  )
  SELECT new_lead_id,company.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN btrim(registration_number)<>''
      AND public.axora_normalize_company_identity(company.registration_number)
        =public.axora_normalize_company_identity(registration_number)
      THEN 'registrationNumber' END,
    CASE WHEN public.axora_normalize_company_identity(company.legal_name)
      =public.axora_normalize_company_identity(legal_name) THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(company.name)
      =public.axora_normalize_company_identity(company_name) THEN 'displayName' END,
    CASE WHEN email_domain<>''
      AND public.axora_company_email_domain(company.main_contact_email)=email_domain
      THEN 'emailDomain' END,
    CASE WHEN lower(btrim(company.main_contact_email))=contact_email
      THEN 'contactEmail' END,
    CASE WHEN public.axora_normalize_company_phone(company.main_contact_phone)
      =public.axora_normalize_company_phone(phone_value) THEN 'phone' END
  ]::text[],NULL)),p_at
  FROM public.companies company
  WHERE (btrim(registration_number)<>''
      AND public.axora_normalize_company_identity(company.registration_number)
        =public.axora_normalize_company_identity(registration_number))
    OR public.axora_normalize_company_identity(company.legal_name)
      =public.axora_normalize_company_identity(legal_name)
    OR public.axora_normalize_company_identity(company.name)
      =public.axora_normalize_company_identity(company_name)
    OR (email_domain<>''
      AND public.axora_company_email_domain(company.main_contact_email)=email_domain)
    OR lower(btrim(company.main_contact_email))=contact_email
    OR public.axora_normalize_company_phone(company.main_contact_phone)
      =public.axora_normalize_company_phone(phone_value);

  INSERT INTO public.company_lead_duplicate_candidates(
    lead_id,candidate_lead_id,matched_fields,detected_at
  )
  SELECT new_lead_id,candidate.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN btrim(registration_number)<>''
      AND public.axora_normalize_company_identity(submission.company_registration_number)
        =public.axora_normalize_company_identity(registration_number)
      THEN 'registrationNumber' END,
    CASE WHEN public.axora_normalize_company_identity(submission.company_legal_name)
      =public.axora_normalize_company_identity(legal_name) THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(submission.company_name)
      =public.axora_normalize_company_identity(company_name) THEN 'displayName' END,
    CASE WHEN public.axora_company_email_domain(submission.contact_email)=email_domain
      THEN 'emailDomain' END,
    CASE WHEN submission.contact_email=contact_email THEN 'contactEmail' END,
    CASE WHEN public.axora_normalize_company_phone(submission.phone)
      =public.axora_normalize_company_phone(phone_value) THEN 'phone' END,
    CASE WHEN candidate.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      AND candidate.created_at>=p_at-interval '90 days' THEN 'recentOpenLead' END
  ]::text[],NULL)),p_at
  FROM public.company_leads candidate
  JOIN LATERAL (
    SELECT item.* FROM public.public_contact_submissions item
    WHERE item.lead_id=candidate.id
    ORDER BY item.created_at DESC,item.id DESC LIMIT 1
  ) submission ON true
  WHERE candidate.id<>new_lead_id AND (
    (btrim(registration_number)<>''
      AND public.axora_normalize_company_identity(submission.company_registration_number)
        =public.axora_normalize_company_identity(registration_number))
    OR public.axora_normalize_company_identity(submission.company_legal_name)
      =public.axora_normalize_company_identity(legal_name)
    OR public.axora_normalize_company_identity(submission.company_name)
      =public.axora_normalize_company_identity(company_name)
    OR public.axora_company_email_domain(submission.contact_email)=email_domain
    OR submission.contact_email=contact_email
    OR public.axora_normalize_company_phone(submission.phone)
      =public.axora_normalize_company_phone(phone_value)
  );
  SELECT count(*)::integer INTO duplicate_count
  FROM public.company_lead_duplicate_candidates candidate
  WHERE candidate.lead_id=new_lead_id;
  IF duplicate_count>0 THEN
    UPDATE public.company_leads SET duplicate_risk='POSSIBLE_DUPLICATE'
    WHERE id=new_lead_id;
  END IF;
  event:=public.axora_append_company_lead_event(
    new_lead_id,'company.lead.submitted','public-submission',NULL,
    jsonb_build_object('source','WEBSITE_CONTACT'),p_at
  );
  RETURN jsonb_build_object('created',true,'leadId',new_lead_id,
    'leadCode',(SELECT lead_code FROM public.company_leads WHERE id=new_lead_id),
    'submissionId',submission_id,'event',event,
    'notificationRecipientIds',
      public.axora_company_lead_recipient_ids(new_lead_id,true));
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_record(
  p_lead_id uuid,p_snapshot jsonb,p_actor_user_id uuid,p_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; actions text[]; owner_actor boolean;
BEGIN
  IF NOT public.axora_company_lead_actor_can_view(
    p_snapshot,p_actor_user_id,p_lead_id,p_at
  ) THEN RETURN NULL; END IF;
  owner_actor:=public.axora_company_actor_is_owner(p_snapshot);
  INSERT INTO public.company_lead_access_events(
    lead_id,actor_user_id,access_kind,occurred_at
  ) VALUES (p_lead_id,p_actor_user_id,'VIEW',p_at);
  SELECT array_remove(ARRAY[
    CASE WHEN owner_actor AND assignment.id IS NULL
      AND lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'ASSIGN' END,
    CASE WHEN owner_actor AND assignment.id IS NOT NULL
      AND lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'REASSIGN' END,
    CASE WHEN lead.status IN ('NEW','ASSIGNED','INFORMATION_PENDING')
      THEN 'MARK_CONTACTED' END,
    CASE WHEN lead.status IN ('NEW','ASSIGNED','CONTACTED','QUALIFIED')
      THEN 'REQUEST_INFORMATION' END,
    CASE WHEN lead.status IN ('NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING')
      THEN 'QUALIFY' END,
    CASE WHEN lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'REJECT' END,
    CASE WHEN lead.status='QUALIFIED'
      AND lead.duplicate_risk<>'POSSIBLE_DUPLICATE' THEN 'CONVERT' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.company_lead_duplicate_candidates c
      WHERE c.lead_id=lead.id AND c.review_status='PENDING')
      THEN 'REVIEW_DUPLICATE' END,
    CASE WHEN lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'ADD_NOTE' END,
    CASE WHEN lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'ADD_TASK' END
    ,CASE WHEN owner_actor AND lead.anonymized_at IS NULL
      AND lead.retention_until<=p_at
      AND lead.status IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      THEN 'ANONYMIZE' END
  ]::text[],NULL) INTO actions
  FROM public.company_leads lead
  LEFT JOIN public.company_lead_assignments assignment
    ON assignment.lead_id=lead.id AND assignment.status='ACTIVE'
  WHERE lead.id=p_lead_id;

  SELECT jsonb_build_object(
    'id',lead.id,'code',lead.lead_code,'status',lead.status,
    'statusVersion',lead.status_version,'source',lead.lead_source,
    'duplicateRisk',lead.duplicate_risk,
    'usesPersonalEmail',lead.uses_personal_email,
    'slaDueAt',lead.sla_due_at,
    'overdue',lead.first_contacted_at IS NULL AND lead.sla_due_at<p_at
      AND lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED'),
    'createdAt',lead.created_at,'updatedAt',lead.updated_at,
    'retentionUntil',lead.retention_until,'anonymizedAt',lead.anonymized_at,
    'convertedCompanyId',lead.converted_company_id,
    'companyName',submission.company_name,
    'legalName',submission.company_legal_name,
    'registrationNumber',submission.company_registration_number,
    'contactName',submission.contact_name,'contactEmail',submission.contact_email,
    'phoneCountryCode',submission.phone_country_code,'phone',submission.phone,
    'country',submission.country,'region',submission.region,'city',submission.city,
    'industry',submission.industry,
    'employeeRange',submission.employee_count_range,
    'branchRange',submission.branch_count_range,
    'spendRange',submission.monthly_spend_range,
    'preferredContactMethod',submission.preferred_contact_method,
    'preferredContactTime',submission.preferred_contact_time,
    'contactTimezone',submission.contact_timezone,'locale',submission.locale,
    'subject',submission.subject,'message',submission.message,
    'consentAt',submission.privacy_accepted_at,
    'privacyPolicyVersion',submission.privacy_policy_version,
    'sourcePage',submission.source_page,
    'sourceMetadata',submission.source_metadata,
    'assignment',CASE WHEN assignment.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',assignment.id,'managerId',assignment.manager_user_id,
      'managerName',manager.display_name,'assignedAt',assignment.assigned_at,
      'reason',assignment.assignment_reason
    ) END,
    'assignmentHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',history.id,'managerId',history.manager_user_id,
      'managerName',history_manager.display_name,'status',history.status,
      'assignedAt',history.assigned_at,'endedAt',history.ended_at,
      'reason',history.assignment_reason,'endReason',history.end_reason
    ) ORDER BY history.assigned_at DESC,history.id DESC)
      FROM public.company_lead_assignments history
      JOIN public.users history_manager ON history_manager.id=history.manager_user_id
      WHERE history.lead_id=lead.id),'[]'::jsonb),
    'duplicateCandidates',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',candidate.id,
      'kind',CASE WHEN candidate.candidate_company_id IS NULL
        THEN 'LEAD' ELSE 'COMPANY' END,
      'recordId',COALESCE(candidate.candidate_lead_id,candidate.candidate_company_id),
      'label',COALESCE(candidate_company.name,candidate_submission.company_name),
      'matchedFields',candidate.matched_fields,
      'reviewStatus',candidate.review_status
    ) ORDER BY candidate.detected_at DESC,candidate.id DESC)
      FROM public.company_lead_duplicate_candidates candidate
      LEFT JOIN public.companies candidate_company
        ON candidate_company.id=candidate.candidate_company_id
      LEFT JOIN LATERAL (
        SELECT item.company_name FROM public.public_contact_submissions item
        WHERE item.lead_id=candidate.candidate_lead_id
        ORDER BY item.created_at DESC LIMIT 1
      ) candidate_submission ON true
      WHERE candidate.lead_id=lead.id),'[]'::jsonb),
    'notes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',note.id,'type',note.note_type,'note',note.note,
      'createdByName',author.display_name,'createdAt',note.created_at
    ) ORDER BY note.created_at DESC,note.id DESC)
      FROM public.company_lead_notes note
      JOIN public.users author ON author.id=note.created_by
      WHERE note.lead_id=lead.id),'[]'::jsonb),
    'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',task.id,'title',task.title,'dueAt',task.due_at,
      'status',task.status,'assignedUserId',task.assigned_user_id,
      'assignedUserName',assignee.display_name,
      'completionNote',task.completion_note
    ) ORDER BY (task.status='OPEN') DESC,task.due_at,task.id)
      FROM public.company_lead_tasks task
      JOIN public.users assignee ON assignee.id=task.assigned_user_id
      WHERE task.lead_id=lead.id),'[]'::jsonb),
    'statusHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'fromStatus',history.from_status,'toStatus',history.to_status,
      'reason',history.reason,'changedAt',history.changed_at,
      'changedByName',actor.display_name
    ) ORDER BY history.status_version DESC)
      FROM public.company_lead_status_history history
      LEFT JOIN public.users actor ON actor.id=history.changed_by
      WHERE history.lead_id=lead.id),'[]'::jsonb),
    'availableActions',to_jsonb(actions)
  ) INTO result
  FROM public.company_leads lead
  JOIN LATERAL (
    SELECT item.* FROM public.public_contact_submissions item
    WHERE item.lead_id=lead.id
    ORDER BY item.created_at DESC,item.id DESC LIMIT 1
  ) submission ON true
  LEFT JOIN public.company_lead_assignments assignment
    ON assignment.lead_id=lead.id AND assignment.status='ACTIVE'
  LEFT JOIN public.users manager ON manager.id=assignment.manager_user_id
  WHERE lead.id=p_lead_id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_export_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR NOT public.axora_company_snapshot_role_permission(
      snapshot,'company.lead.view'
    ) THEN RETURN NULL; END IF;
  result:=public.axora_company_lead_record(
    p_lead_id,snapshot,p_actor_user_id,p_at
  );
  IF result IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.company_lead_access_events(
    lead_id,actor_user_id,access_kind,occurred_at
  ) VALUES (p_lead_id,p_actor_user_id,'EXPORT',p_at);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; owner_actor boolean;
  status_filter text:=NULLIF(p_filters->>'status','');
  assignment_filter text:=COALESCE(NULLIF(p_filters->>'assignment',''),'VISIBLE');
  source_filter text:=NULLIF(p_filters->>'source','');
  industry_filter text:=NULLIF(p_filters->>'industry','');
  region_filter text:=NULLIF(p_filters->>'region','');
  risk_filter text:=NULLIF(p_filters->>'duplicateRisk','');
  created_from date;
BEGIN
  BEGIN
    IF NULLIF(p_filters->>'createdFrom','') IS NOT NULL THEN
      created_from:=(p_filters->>'createdFrom')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Company lead filter is invalid'; END;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_snapshot_role_permission(
    snapshot,'company.lead.view'
  ) THEN RETURN NULL; END IF;
  owner_actor:=public.axora_company_actor_is_owner(snapshot);
  IF (status_filter IS NOT NULL AND status_filter NOT IN (
      'NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED',
      'CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
    )) OR assignment_filter NOT IN ('VISIBLE','ALL','MINE','UNASSIGNED')
  THEN RAISE EXCEPTION 'Company lead filter is invalid'; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,'canViewAll',owner_actor,
    'managers',CASE WHEN owner_actor THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',account.id,'name',profile.display_name,'email',account.email
      ) ORDER BY profile.display_name,account.id)
      FROM public.users account
      JOIN public.user_profiles profile ON profile.user_id=account.id
      WHERE public.axora_company_lead_manager_is_valid(account.id,p_at)
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'leads',COALESCE((
      SELECT jsonb_agg(record ORDER BY created_at DESC,id DESC)
      FROM (
        SELECT lead.id,lead.created_at,
          public.axora_company_lead_record(
            lead.id,snapshot,p_actor_user_id,p_at
          ) AS record
        FROM public.company_leads lead
        JOIN LATERAL (
          SELECT item.* FROM public.public_contact_submissions item
          WHERE item.lead_id=lead.id
          ORDER BY item.created_at DESC,item.id DESC LIMIT 1
        ) submission ON true
        LEFT JOIN public.company_lead_assignments assignment
          ON assignment.lead_id=lead.id AND assignment.status='ACTIVE'
        WHERE public.axora_company_lead_actor_can_view(
            snapshot,p_actor_user_id,lead.id,p_at
          )
          AND (status_filter IS NULL OR lead.status=status_filter)
          AND (source_filter IS NULL OR lead.lead_source=source_filter)
          AND (industry_filter IS NULL
            OR lower(submission.industry)=lower(industry_filter))
          AND (region_filter IS NULL
            OR lower(submission.region)=lower(region_filter))
          AND (risk_filter IS NULL OR lead.duplicate_risk=risk_filter)
          AND (created_from IS NULL OR lead.created_at>=created_from::timestamptz)
          AND (NOT owner_actor OR assignment_filter IN ('VISIBLE','ALL')
            OR (assignment_filter='MINE'
              AND assignment.manager_user_id=p_actor_user_id)
            OR (assignment_filter='UNASSIGNED' AND assignment.id IS NULL))
      ) visible WHERE record IS NOT NULL
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_apply_company_lead_status(
  p_lead_id uuid,p_to_status text,p_actor_user_id uuid,p_reason text,
  p_at timestamptz,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE from_status text; next_version integer;
BEGIN
  SELECT status,status_version+1 INTO from_status,next_version
  FROM public.company_leads WHERE id=p_lead_id FOR UPDATE;
  IF from_status IS NULL OR p_to_status NOT IN (
      'NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED',
      'CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
    ) OR NOT (
      (from_status='NEW' AND p_to_status IN (
        'ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='ASSIGNED' AND p_to_status IN (
        'CONTACTED','INFORMATION_PENDING','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='CONTACTED' AND p_to_status IN (
        'INFORMATION_PENDING','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='INFORMATION_PENDING' AND p_to_status IN (
        'CONTACTED','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='QUALIFIED' AND p_to_status IN (
        'INFORMATION_PENDING','CONVERTED','DUPLICATE','REJECTED'
      ))
      OR (from_status IN ('CONVERTED','DUPLICATE','REJECTED')
        AND p_to_status='ARCHIVED')
    ) THEN RAISE EXCEPTION 'Company lead transition is unavailable'; END IF;
  UPDATE public.company_leads
  SET status=p_to_status,status_version=next_version,updated_at=p_at,
    first_contacted_at=CASE WHEN p_to_status='CONTACTED'
      THEN COALESCE(first_contacted_at,p_at) ELSE first_contacted_at END,
    first_contacted_by=CASE WHEN p_to_status='CONTACTED'
      THEN COALESCE(first_contacted_by,p_actor_user_id)
      ELSE first_contacted_by END
  WHERE id=p_lead_id;
  INSERT INTO public.company_lead_status_history(
    lead_id,status_version,from_status,to_status,reason,changed_by,changed_at,metadata
  ) VALUES (p_lead_id,next_version,from_status,p_to_status,btrim(p_reason),
    p_actor_user_id,p_at,COALESCE(p_metadata,'{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.axora_assign_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_manager_user_id uuid,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
  current_assignment public.company_lead_assignments%ROWTYPE;
  lead_status text; event jsonb; event_key text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT status INTO lead_status FROM public.company_leads
  WHERE id=p_lead_id FOR UPDATE;
  IF snapshot IS NULL OR NOT public.axora_company_actor_is_owner(snapshot)
    OR lead_status IS NULL
    OR lead_status IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
    OR NOT public.axora_company_snapshot_role_permission(snapshot,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.company_lead_assignments
        WHERE lead_id=p_lead_id AND status='ACTIVE'
      ) THEN 'company.lead.reassign' ELSE 'company.lead.assign' END)
    OR NOT public.axora_company_lead_manager_is_valid(p_manager_user_id,p_at)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead assignment is unavailable'; END IF;
  SELECT * INTO current_assignment FROM public.company_lead_assignments
  WHERE lead_id=p_lead_id AND status='ACTIVE' FOR UPDATE;
  IF current_assignment.manager_user_id=p_manager_user_id THEN
    RAISE EXCEPTION 'Company lead is already assigned to this manager';
  END IF;
  IF current_assignment.id IS NOT NULL THEN
    UPDATE public.company_lead_assignments
    SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
      end_reason='Reassigned: '||btrim(p_reason)
    WHERE id=current_assignment.id;
    event_key:='company.lead.reassigned';
  ELSE event_key:='company.lead.assigned'; END IF;
  INSERT INTO public.company_lead_assignments(
    lead_id,manager_user_id,assigned_by,assigned_at,assignment_reason
  ) VALUES (p_lead_id,p_manager_user_id,p_actor_user_id,p_at,btrim(p_reason));
  IF lead_status='NEW' THEN
    PERFORM public.axora_apply_company_lead_status(
      p_lead_id,'ASSIGNED',p_actor_user_id,'Lead assigned for follow-up',p_at,
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

CREATE OR REPLACE FUNCTION public.axora_transition_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_to_status text,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; event jsonb; event_key text; version integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR NOT public.axora_company_snapshot_role_permission(
      snapshot,'company.lead.view'
    ) OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_to_status IN ('CONVERTED','DUPLICATE')
  THEN RAISE EXCEPTION 'Company lead transition is unavailable'; END IF;
  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason','Company lead status changed',true);
  PERFORM public.axora_apply_company_lead_status(
    p_lead_id,p_to_status,p_actor_user_id,p_reason,p_at
  );
  SELECT status_version INTO version FROM public.company_leads WHERE id=p_lead_id;
  event_key:=CASE p_to_status
    WHEN 'CONTACTED' THEN 'company.lead.contacted'
    WHEN 'INFORMATION_PENDING' THEN 'company.lead.information_requested'
    WHEN 'QUALIFIED' THEN 'company.lead.qualified'
    WHEN 'REJECTED' THEN 'company.lead.rejected'
    WHEN 'ARCHIVED' THEN 'company.lead.archived'
    ELSE 'company.lead.status_changed' END;
  event:=public.axora_append_company_lead_event(
    p_lead_id,event_key,'status:'||version::text,p_actor_user_id,
    jsonb_build_object('status',p_to_status),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_resolve_company_lead_duplicate(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_candidate_id uuid,p_resolution text,p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
  candidate public.company_lead_duplicate_candidates%ROWTYPE;
  event jsonb; pending_count integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR p_resolution NOT IN ('CLEAR','CONFIRM')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead duplicate review is unavailable'; END IF;
  SELECT * INTO candidate FROM public.company_lead_duplicate_candidates
  WHERE id=p_candidate_id AND lead_id=p_lead_id
    AND review_status='PENDING' FOR UPDATE;
  IF candidate.id IS NULL THEN
    RAISE EXCEPTION 'Company lead duplicate review is unavailable';
  END IF;
  UPDATE public.company_lead_duplicate_candidates
  SET review_status=CASE WHEN p_resolution='CLEAR'
      THEN 'CLEARED' ELSE 'CONFIRMED' END,
    reviewed_by=p_actor_user_id,reviewed_at=p_at,
    review_reason=btrim(p_reason)
  WHERE id=candidate.id;
  IF p_resolution='CONFIRM' THEN
    UPDATE public.company_leads SET duplicate_risk='CONFIRMED',
      duplicate_of_lead_id=candidate.candidate_lead_id,
      duplicate_of_company_id=candidate.candidate_company_id
    WHERE id=p_lead_id;
    PERFORM public.axora_apply_company_lead_status(
      p_lead_id,'DUPLICATE',p_actor_user_id,p_reason,p_at,
      jsonb_build_object('candidateId',candidate.id)
    );
  ELSE
    SELECT count(*)::integer INTO pending_count
    FROM public.company_lead_duplicate_candidates
    WHERE lead_id=p_lead_id AND review_status='PENDING';
    IF pending_count=0 THEN
      UPDATE public.company_leads SET duplicate_risk='CLEARED',updated_at=p_at
      WHERE id=p_lead_id;
    END IF;
  END IF;
  event:=public.axora_append_company_lead_event(
    p_lead_id,CASE WHEN p_resolution='CLEAR'
      THEN 'company.lead.duplicate_cleared'
      ELSE 'company.lead.duplicate_confirmed' END,
    'duplicate:'||candidate.id::text||':'||p_resolution,p_actor_user_id,
    jsonb_build_object('resolution',p_resolution),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_add_company_lead_note(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_note_type text,p_note text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; note_id uuid; event jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR p_note_type NOT IN (
      'INTERNAL','CONTACT_ATTEMPT','INFORMATION_RECEIVED'
    ) OR char_length(btrim(COALESCE(p_note,''))) NOT BETWEEN 2 AND 5000
  THEN RAISE EXCEPTION 'Company lead note is unavailable'; END IF;
  INSERT INTO public.company_lead_notes(
    lead_id,note_type,note,created_by,created_at
  ) VALUES (p_lead_id,p_note_type,btrim(p_note),p_actor_user_id,p_at)
  RETURNING id INTO note_id;
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.note_added','note:'||note_id::text,
    p_actor_user_id,jsonb_build_object('noteType',p_note_type),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_add_company_lead_task(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_title text,p_due_at timestamptz,p_assigned_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; task_id uuid; event jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 240
    OR p_due_at<=p_at
    OR NOT public.axora_company_lead_manager_is_valid(p_assigned_user_id,p_at)
  THEN RAISE EXCEPTION 'Company lead task is unavailable'; END IF;
  INSERT INTO public.company_lead_tasks(
    lead_id,title,due_at,assigned_user_id,created_by,created_at
  ) VALUES (
    p_lead_id,btrim(p_title),p_due_at,p_assigned_user_id,
    p_actor_user_id,p_at
  ) RETURNING id INTO task_id;
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.task_added','task:'||task_id::text,
    p_actor_user_id,jsonb_build_object('taskId',task_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_complete_company_lead_task(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_task_id uuid,p_completion_note text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; event jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    ) OR char_length(btrim(COALESCE(p_completion_note,'')))>1000
  THEN RAISE EXCEPTION 'Company lead task completion is unavailable'; END IF;
  UPDATE public.company_lead_tasks
  SET status='COMPLETED',completed_by=p_actor_user_id,completed_at=p_at,
    completion_note=NULLIF(btrim(COALESCE(p_completion_note,'')),'')
  WHERE id=p_task_id AND lead_id=p_lead_id AND status='OPEN';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company lead task completion is unavailable';
  END IF;
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.task_completed',
    'task-completed:'||p_task_id::text,p_actor_user_id,
    jsonb_build_object('taskId',p_task_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_convert_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; lead public.company_leads%ROWTYPE;
  submission public.public_contact_submissions%ROWTYPE;
  company_payload jsonb; company_id uuid; manager_id uuid;
  event jsonb; pending_count integer;
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
    left(format('Employees: %s; branches: %s; monthly spend: %s. %s',
      submission.employee_count_range,submission.branch_count_range,
      submission.monthly_spend_range,submission.message),5000),
    '',submission.contact_name,submission.contact_email,
    concat_ws(' ',submission.phone_country_code,submission.phone),
    submission.contact_name,submission.contact_email,
    concat_ws(' ',submission.phone_country_code,submission.phone),
    left(concat_ws(', ',submission.city,submission.region,submission.country),5000),
    'Cash on delivery (COD)','Monthly',
    left('Converted from '||lead.lead_code||'. '
      ||submission.subject||': '||submission.message,5000),p_at
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
    p_lead_id,'CONVERTED',p_actor_user_id,p_reason,p_at,
    jsonb_build_object('companyId',company_id)
  );
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.converted','converted:'||company_id::text,
    p_actor_user_id,jsonb_build_object('companyId',company_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event)
    ||jsonb_build_object('companyId',company_id,'companyPayload',company_payload);
END $$;

CREATE OR REPLACE FUNCTION public.axora_anonymize_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; lead public.company_leads%ROWTYPE; event jsonb;
  anonymous_email text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO lead FROM public.company_leads WHERE id=p_lead_id FOR UPDATE;
  IF snapshot IS NULL OR lead.id IS NULL
    OR NOT public.axora_company_actor_is_owner(snapshot)
    OR lead.anonymized_at IS NOT NULL OR lead.retention_until>p_at
    OR lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead anonymization is unavailable'; END IF;
  anonymous_email:='anonymized+'||replace(p_lead_id::text,'-','')
    ||'@example.invalid';
  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason',btrim(p_reason),true);
  UPDATE public.public_contact_submissions SET
    contact_name='Anonymized contact',contact_email=anonymous_email,
    company_name='Anonymized company',company_legal_name='Anonymized company',
    company_registration_number='',phone_country_code='',phone='Removed',
    country='Removed',region='Removed',city='Removed',industry='Removed',
    preferred_contact_time='',subject='Anonymized enquiry',
    message='Personal data removed under the company lead retention policy.',
    source_metadata='{}'::jsonb
  WHERE lead_id=p_lead_id;
  UPDATE public.company_leads SET anonymized_at=p_at,
    anonymized_by=p_actor_user_id,updated_at=p_at
  WHERE id=p_lead_id;
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.anonymized',
    'anonymized:'||lead.status_version::text,p_actor_user_id,
    jsonb_build_object('reasonRecorded',true),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_claim_overdue_company_lead_events(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; lead_row record; event jsonb;
  result jsonb:='[]'::jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_snapshot_role_permission(
    snapshot,'company.lead.view'
  ) THEN RETURN result; END IF;
  FOR lead_row IN
    SELECT lead.id FROM public.company_leads lead
    WHERE lead.first_contacted_at IS NULL AND lead.sla_due_at<p_at
      AND lead.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      AND public.axora_company_lead_actor_can_view(
        snapshot,p_actor_user_id,lead.id,p_at
      )
  LOOP
    event:=public.axora_append_company_lead_event(
      lead_row.id,'company.lead.sla_overdue','sla-overdue',NULL,
      jsonb_build_object('sla','24_hours'),p_at
    );
    IF COALESCE((event->>'created')::boolean,false) THEN
      result:=result||jsonb_build_array(jsonb_build_object(
        'leadId',lead_row.id,
        'leadCode',(SELECT lead_code FROM public.company_leads
          WHERE id=lead_row.id),'event',event,
        'notificationRecipientIds',
          public.axora_company_lead_recipient_ids(lead_row.id,true)
      ));
    END IF;
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON TABLE
  public.company_leads,public.company_lead_status_history,
  public.company_lead_assignments,public.company_lead_duplicate_candidates,
  public.company_lead_notes,public.company_lead_tasks,
  public.company_lead_events,public.company_lead_access_events
FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.company_lead_code_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_company_lead_append_only(),
  public.axora_protect_company_lead_assignment(),
  public.axora_company_lead_actor_can_view(jsonb,uuid,uuid,timestamptz),
  public.axora_company_lead_manager_is_valid(uuid,timestamptz),
  public.axora_company_lead_recipient_ids(uuid,boolean),
  public.axora_append_company_lead_event(uuid,text,text,uuid,jsonb,timestamptz),
  public.axora_company_lead_mutation_payload(uuid,jsonb),
  public.axora_apply_company_lead_status(uuid,text,uuid,text,timestamptz,jsonb),
  public.axora_company_lead_record(uuid,jsonb,uuid,timestamptz),
  public.axora_prepare_legacy_public_contact(),
  public.validate_in_app_notification()
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_record_public_company_lead(jsonb,timestamptz),
  public.axora_company_lead_workspace(uuid,uuid,jsonb,timestamptz),
  public.axora_export_company_lead(uuid,uuid,uuid,timestamptz),
  public.axora_assign_company_lead(uuid,uuid,uuid,uuid,text,timestamptz),
  public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_resolve_company_lead_duplicate(
    uuid,uuid,uuid,uuid,text,text,timestamptz
  ),
  public.axora_add_company_lead_note(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_add_company_lead_task(
    uuid,uuid,uuid,text,timestamptz,uuid,timestamptz
  ),
  public.axora_complete_company_lead_task(
    uuid,uuid,uuid,uuid,text,timestamptz
  ),
  public.axora_convert_company_lead(uuid,uuid,uuid,text,timestamptz),
  public.axora_anonymize_company_lead(uuid,uuid,uuid,text,timestamptz),
  public.axora_claim_overdue_company_lead_events(uuid,uuid,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.company_leads,public.company_lead_status_history,
      public.company_lead_assignments,public.company_lead_duplicate_candidates,
      public.company_lead_notes,public.company_lead_tasks,
      public.company_lead_events,public.company_lead_access_events
    FROM axora_app;
    REVOKE ALL ON SEQUENCE public.company_lead_code_seq FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_record_public_company_lead(jsonb,timestamptz),
      public.axora_company_lead_workspace(uuid,uuid,jsonb,timestamptz),
      public.axora_export_company_lead(uuid,uuid,uuid,timestamptz),
      public.axora_assign_company_lead(uuid,uuid,uuid,uuid,text,timestamptz),
      public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_resolve_company_lead_duplicate(
        uuid,uuid,uuid,uuid,text,text,timestamptz
      ),
      public.axora_add_company_lead_note(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_add_company_lead_task(
        uuid,uuid,uuid,text,timestamptz,uuid,timestamptz
      ),
      public.axora_complete_company_lead_task(
        uuid,uuid,uuid,uuid,text,timestamptz
      ),
      public.axora_convert_company_lead(uuid,uuid,uuid,text,timestamptz),
      public.axora_anonymize_company_lead(uuid,uuid,uuid,text,timestamptz),
      public.axora_claim_overdue_company_lead_events(uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
