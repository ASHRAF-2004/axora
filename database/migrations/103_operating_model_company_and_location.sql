BEGIN;

-- Prompt 7 keeps historical acquisition evidence while making a public enquiry
-- independent from the commercial lead workflow. Existing linked submissions
-- remain linked; new Contact Us submissions may deliberately have no lead.
ALTER TABLE public.public_contact_submissions
  ALTER COLUMN lead_id DROP NOT NULL,
  ALTER COLUMN contact_email DROP NOT NULL;

ALTER TABLE public.public_contact_submissions
  DROP CONSTRAINT IF EXISTS public_contact_submissions_contact_email_check,
  DROP CONSTRAINT IF EXISTS public_contact_submissions_location_check;

ALTER TABLE public.public_contact_submissions
  ADD CONSTRAINT public_contact_submissions_contact_email_v2_check CHECK (
    contact_email='' OR (
      char_length(contact_email) BETWEEN 3 AND 254
      AND contact_email=lower(contact_email)
      AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  ADD CONSTRAINT public_contact_submissions_location_v2_check CHECK (
    char_length(btrim(country))<=120
    AND char_length(btrim(region))<=160
    AND char_length(btrim(city)) BETWEEN 2 AND 160
  );

-- Direct inserts are retained for migration/maintenance compatibility, but no
-- trigger is allowed to turn a Contact Us row into a Company Lead implicitly.
CREATE OR REPLACE FUNCTION public.axora_prepare_legacy_public_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.id IS NULL THEN NEW.id:=gen_random_uuid(); END IF;
  IF NEW.idempotency_key IS NULL THEN
    NEW.idempotency_key:=md5('contact-submission:a:'||NEW.id::text)
      ||md5('contact-submission:b:'||NEW.id::text);
  END IF;
  IF btrim(COALESCE(NEW.company_legal_name,''))='' THEN
    NEW.company_legal_name:=NEW.company_name;
  END IF;
  IF btrim(COALESCE(NEW.city,''))='' THEN NEW.city:='Not provided'; END IF;
  IF btrim(COALESCE(NEW.industry,''))='' THEN NEW.industry:='Not provided'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_public_contact_submission(
  p_input jsonb,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE
  existing_submission public.public_contact_submissions%ROWTYPE;
  submission_id uuid;
  v_idempotency_key text:=p_input->>'idempotencyKey';
  locale_value text:=p_input->>'locale';
  contact_name_value text:=p_input->>'contactName';
  company_name_value text:=p_input->>'companyName';
  legal_name_value text:=p_input->>'companyLegalName';
  city_value text:=p_input->>'city';
  industry_value text:=p_input->>'industry';
  employee_range text:=p_input->>'employeeRange';
  branch_range text:=p_input->>'branchRange';
  spend_range text:=p_input->>'spendRange';
  contact_method text:=p_input->>'contactMethod';
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
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'The public contact submission is invalid';
  END;
  IF v_idempotency_key !~ '^[0-9a-f]{64}$'
    OR locale_value NOT IN ('en','ar','ms')
    OR char_length(btrim(COALESCE(contact_name_value,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(company_name_value,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(legal_name_value,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(city_value,''))) NOT BETWEEN 2 AND 160
    OR char_length(btrim(COALESCE(industry_value,''))) NOT BETWEEN 2 AND 200
    OR employee_range NOT IN ('1_10','11_50','51_200','201_500','501_1000','1001_PLUS')
    OR branch_range NOT IN ('1','2_5','6_20','21_50','51_PLUS')
    OR spend_range NOT IN ('UNDER_10K','10K_50K','50K_250K','250K_1M','OVER_1M','UNDISCLOSED')
    OR contact_method NOT IN ('EMAIL','PHONE','WHATSAPP','VIDEO_CALL')
    OR char_length(btrim(COALESCE(contact_timezone,''))) NOT BETWEEN 1 AND 80
    OR char_length(btrim(COALESCE(subject_value,''))) NOT BETWEEN 3 AND 200
    OR char_length(btrim(COALESCE(message_value,''))) NOT BETWEEN 10 AND 5000
    OR network_key !~ '^[0-9a-f]{64}$' OR sender_key !~ '^[0-9a-f]{64}$'
    OR challenge_at<p_at-interval '5 minutes' OR challenge_at>p_at+interval '1 minute'
    OR char_length(btrim(COALESCE(hostname,''))) NOT BETWEEN 1 AND 253
    OR char_length(btrim(COALESCE(policy_version,''))) NOT BETWEEN 1 AND 80
    OR source_page !~ '^/' OR source_page ~ '://'
    OR jsonb_typeof(source_metadata)<>'object'
    OR NOT public.workflow_metadata_is_safe(source_metadata)
  THEN RAISE EXCEPTION 'The public contact submission is invalid'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('public-contact-submission:'||v_idempotency_key,0)
  );
  SELECT * INTO existing_submission
  FROM public.public_contact_submissions submission
  WHERE submission.idempotency_key=v_idempotency_key;
  IF existing_submission.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created',false,'submissionId',existing_submission.id
    );
  END IF;

  INSERT INTO public.public_contact_submissions(
    lead_id,idempotency_key,locale,contact_name,contact_email,company_name,
    company_legal_name,company_registration_number,phone_country_code,phone,
    country,region,city,industry,employee_count_range,branch_count_range,
    monthly_spend_range,preferred_contact_method,preferred_contact_time,
    contact_timezone,display_timezone,subject,message,privacy_accepted_at,
    privacy_policy_version,source_page,source_metadata,network_rate_key,
    sender_rate_key,turnstile_success,turnstile_challenge_at,
    turnstile_verified_at,turnstile_hostname,turnstile_action,
    acknowledgement_status,acknowledgement_finalized_at,created_at
  ) VALUES (
    NULL,v_idempotency_key,locale_value,btrim(contact_name_value),'',
    btrim(company_name_value),btrim(legal_name_value),'','',NULL,'','',
    btrim(city_value),btrim(industry_value),employee_range,branch_range,
    spend_range,contact_method,'',btrim(contact_timezone),btrim(contact_timezone),
    btrim(subject_value),btrim(message_value),p_at,btrim(policy_version),
    source_page,source_metadata,network_key,sender_key,true,challenge_at,p_at,
    hostname,'contact','CANCELLED',p_at,p_at
  ) RETURNING id INTO submission_id;

  RETURN jsonb_build_object('created',true,'submissionId',submission_id);
END $$;

-- Owner-created leads use the canonical lead table with a distinct, private
-- profile. They are not represented as fabricated public contact submissions.
CREATE TABLE public.company_lead_profiles (
  lead_id uuid PRIMARY KEY REFERENCES public.company_leads(id) ON DELETE RESTRICT,
  company_name text NOT NULL CHECK (
    char_length(btrim(company_name)) BETWEEN 2 AND 200
      AND company_name !~ '[[:cntrl:]]'
  ),
  company_legal_name text NOT NULL CHECK (
    char_length(btrim(company_legal_name)) BETWEEN 2 AND 300
      AND company_legal_name !~ '[[:cntrl:]]'
  ),
  contact_name text NOT NULL CHECK (
    char_length(btrim(contact_name)) BETWEEN 2 AND 200
      AND contact_name !~ '[[:cntrl:]]'
  ),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 160),
  industry text NOT NULL CHECK (
    char_length(btrim(industry)) BETWEEN 2 AND 200
      AND industry !~ '[[:cntrl:]]'
  ),
  employee_count_range text NOT NULL CHECK (employee_count_range IN (
    '1_10','11_50','51_200','201_500','501_1000','1001_PLUS'
  )),
  branch_count_range text NOT NULL CHECK (
    branch_count_range IN ('1','2_5','6_20','21_50','51_PLUS')
  ),
  monthly_spend_range text NOT NULL CHECK (monthly_spend_range IN (
    'UNDER_10K','10K_50K','50K_250K','250K_1M','OVER_1M','UNDISCLOSED'
  )),
  locale text NOT NULL CHECK (locale IN ('en','ar','ms')),
  contact_timezone text NOT NULL CHECK (
    char_length(btrim(contact_timezone)) BETWEEN 1 AND 80
  ),
  subject text NOT NULL CHECK (
    char_length(btrim(subject)) BETWEEN 3 AND 200
      AND subject !~ '[[:cntrl:]]'
  ),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 5000),
  command_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_lead_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_lead_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_lead_profiles FROM PUBLIC;

CREATE FUNCTION public.axora_protect_company_lead_profile()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE'
    AND current_setting('axora.company_lead_anonymizing',true)=OLD.lead_id::text
    AND NEW.lead_id=OLD.lead_id
    AND NEW.company_name='Anonymized company'
    AND NEW.company_legal_name='Anonymized company'
    AND NEW.contact_name='Anonymized contact'
    AND NEW.city='Removed'
    AND NEW.industry='Removed'
    AND NEW.contact_timezone='UTC'
    AND NEW.subject='Anonymized lead'
    AND NEW.message='Personal data removed under the company lead retention policy.'
    AND NEW.employee_count_range=OLD.employee_count_range
    AND NEW.branch_count_range=OLD.branch_count_range
    AND NEW.monthly_spend_range=OLD.monthly_spend_range
    AND NEW.locale=OLD.locale
    AND NEW.command_id=OLD.command_id
    AND NEW.created_by=OLD.created_by
    AND NEW.created_at=OLD.created_at
    AND NEW.updated_at>=OLD.updated_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Company lead profiles are immutable outside authorized anonymization';
END $$;

CREATE TRIGGER company_lead_profiles_protected
BEFORE UPDATE OR DELETE ON public.company_lead_profiles
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_company_lead_profile();

CREATE VIEW public.company_lead_intake_rows
WITH (security_barrier=true) AS
SELECT submission.id,submission.lead_id,submission.company_name,
  submission.company_legal_name,submission.company_registration_number,
  submission.contact_name,submission.contact_email,
  submission.phone_country_code,submission.phone,submission.country,
  submission.region,submission.city,submission.industry,
  submission.employee_count_range,submission.branch_count_range,
  submission.monthly_spend_range,submission.preferred_contact_method,
  submission.preferred_contact_time,submission.contact_timezone,
  submission.locale,submission.subject,submission.message,
  submission.privacy_accepted_at,submission.privacy_policy_version,
  submission.source_page,submission.source_metadata,submission.created_at
FROM public.public_contact_submissions submission
WHERE submission.lead_id IS NOT NULL
UNION ALL
SELECT profile.lead_id,profile.lead_id,profile.company_name,
  profile.company_legal_name,''::text,profile.contact_name,''::text,''::text,
  NULL::text,''::text,''::text,profile.city,profile.industry,
  profile.employee_count_range,profile.branch_count_range,
  profile.monthly_spend_range,'EMAIL'::text,''::text,
  profile.contact_timezone,profile.locale,profile.subject,profile.message,
  NULL::timestamptz,'internal-lead-v1'::text,'/companies/leads/new'::text,
  jsonb_build_object('source','OWNER_CREATED_LEAD'),profile.created_at
FROM public.company_lead_profiles profile;
REVOKE ALL ON public.company_lead_intake_rows FROM PUBLIC;

-- The existing read model is retained, but it now reads either historical
-- public lead details or the private Owner-created profile.
DO $patch$
DECLARE function_name text; original_definition text; patched_definition text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'axora_company_lead_record','axora_company_lead_workspace'
  ] LOOP
    SELECT pg_get_functiondef(procedure.oid) INTO original_definition
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.proname=function_name;
    patched_definition:=replace(
      original_definition,
      'public.public_contact_submissions',
      'public.company_lead_intake_rows'
    );
    IF original_definition IS NULL OR patched_definition=original_definition THEN
      RAISE EXCEPTION 'Company lead read model % was not patched',function_name;
    END IF;
    EXECUTE patched_definition;
  END LOOP;
END $patch$;

-- Extend the retained privacy lifecycle to Owner-created profiles. Historical
-- public lead rows continue to use the same canonical anonymization command.
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
  PERFORM set_config('axora.company_lead_anonymizing',p_lead_id::text,true);
  UPDATE public.company_lead_profiles SET
    company_name='Anonymized company',company_legal_name='Anonymized company',
    contact_name='Anonymized contact',city='Removed',industry='Removed',
    contact_timezone='UTC',subject='Anonymized lead',
    message='Personal data removed under the company lead retention policy.',
    updated_at=p_at
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

CREATE OR REPLACE FUNCTION public.axora_create_acquisition_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_input jsonb,
  p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  snapshot jsonb;
  lead_id_value uuid;
  duplicate_count integer;
  event jsonb;
  company_name_value text:=p_input->>'companyName';
  legal_name_value text:=p_input->>'legalName';
  contact_name_value text:=p_input->>'contactName';
  city_value text:=p_input->>'city';
  industry_value text:=p_input->>'industry';
  employee_range text:=p_input->>'employeeRange';
  branch_range text:=p_input->>'branchRange';
  spend_range text:=p_input->>'spendRange';
  locale_value text:=p_input->>'locale';
  timezone_value text:=p_input->>'timezone';
  subject_value text:=p_input->>'subject';
  message_value text:=p_input->>'message';
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_actor_is_owner(snapshot)
    OR NOT public.axora_company_snapshot_role_permission(snapshot,'company.lead.create')
    OR char_length(btrim(COALESCE(company_name_value,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(legal_name_value,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(contact_name_value,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(city_value,''))) NOT BETWEEN 2 AND 160
    OR char_length(btrim(COALESCE(industry_value,''))) NOT BETWEEN 2 AND 200
    OR employee_range NOT IN ('1_10','11_50','51_200','201_500','501_1000','1001_PLUS')
    OR branch_range NOT IN ('1','2_5','6_20','21_50','51_PLUS')
    OR spend_range NOT IN ('UNDER_10K','10K_50K','50K_250K','250K_1M','OVER_1M','UNDISCLOSED')
    OR locale_value NOT IN ('en','ar','ms')
    OR char_length(btrim(COALESCE(timezone_value,''))) NOT BETWEEN 1 AND 80
    OR char_length(btrim(COALESCE(subject_value,''))) NOT BETWEEN 3 AND 200
    OR char_length(btrim(COALESCE(message_value,''))) NOT BETWEEN 10 AND 5000
  THEN RAISE EXCEPTION 'Company lead creation is unavailable'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'owner-company-lead:'||public.axora_normalize_company_identity(legal_name_value)
      ||':'||public.axora_normalize_company_identity(company_name_value),0
  ));
  SELECT profile.lead_id INTO lead_id_value
  FROM public.company_lead_profiles profile WHERE profile.command_id=p_command_id;
  IF lead_id_value IS NOT NULL THEN
    RETURN public.axora_company_lead_mutation_payload(lead_id_value,NULL);
  END IF;

  INSERT INTO public.company_leads(
    status,status_version,lead_source,uses_personal_email,sla_due_at,
    retention_until,created_at,updated_at
  ) VALUES (
    'NEW',1,'OWNER_CREATED',false,p_at+interval '24 hours',
    p_at+interval '24 months',p_at,p_at
  ) RETURNING id INTO lead_id_value;

  INSERT INTO public.company_lead_profiles(
    lead_id,company_name,company_legal_name,contact_name,city,industry,
    employee_count_range,branch_count_range,monthly_spend_range,locale,
    contact_timezone,subject,message,command_id,created_by,created_at,updated_at
  ) VALUES (
    lead_id_value,btrim(company_name_value),btrim(legal_name_value),
    btrim(contact_name_value),btrim(city_value),btrim(industry_value),
    employee_range,branch_range,spend_range,locale_value,btrim(timezone_value),
    btrim(subject_value),btrim(message_value),p_command_id,p_actor_user_id,p_at,p_at
  );
  INSERT INTO public.company_lead_status_history(
    lead_id,status_version,from_status,to_status,reason,changed_by,changed_at,metadata
  ) VALUES (
    lead_id_value,1,NULL,'NEW','Company Lead created by Platform Owner',
    p_actor_user_id,p_at,jsonb_build_object('source','OWNER_CREATED')
  );

  INSERT INTO public.company_lead_duplicate_candidates(
    lead_id,candidate_company_id,matched_fields,detected_at
  )
  SELECT lead_id_value,company.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN public.axora_normalize_company_identity(company.legal_name)
      =public.axora_normalize_company_identity(legal_name_value)
      THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(company.name)
      =public.axora_normalize_company_identity(company_name_value)
      THEN 'displayName' END
  ]::text[],NULL)),p_at
  FROM public.companies company
  WHERE public.axora_normalize_company_identity(company.legal_name)
      =public.axora_normalize_company_identity(legal_name_value)
    OR public.axora_normalize_company_identity(company.name)
      =public.axora_normalize_company_identity(company_name_value);

  INSERT INTO public.company_lead_duplicate_candidates(
    lead_id,candidate_lead_id,matched_fields,detected_at
  )
  SELECT lead_id_value,candidate.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN public.axora_normalize_company_identity(details.company_legal_name)
      =public.axora_normalize_company_identity(legal_name_value)
      THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(details.company_name)
      =public.axora_normalize_company_identity(company_name_value)
      THEN 'displayName' END,
    CASE WHEN candidate.status NOT IN ('CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
      AND candidate.created_at>=p_at-interval '90 days' THEN 'recentOpenLead' END
  ]::text[],NULL)),p_at
  FROM public.company_leads candidate
  JOIN LATERAL (
    SELECT intake.* FROM public.company_lead_intake_rows intake
    WHERE intake.lead_id=candidate.id
    ORDER BY intake.created_at DESC,intake.id DESC LIMIT 1
  ) details ON true
  WHERE candidate.id<>lead_id_value AND (
    public.axora_normalize_company_identity(details.company_legal_name)
      =public.axora_normalize_company_identity(legal_name_value)
    OR public.axora_normalize_company_identity(details.company_name)
      =public.axora_normalize_company_identity(company_name_value)
  );
  SELECT count(*)::integer INTO duplicate_count
  FROM public.company_lead_duplicate_candidates duplicate
  WHERE duplicate.lead_id=lead_id_value;
  IF duplicate_count>0 THEN
    UPDATE public.company_leads SET duplicate_risk='POSSIBLE_DUPLICATE'
    WHERE id=lead_id_value;
  END IF;
  event:=public.axora_append_company_lead_event(
    lead_id_value,'company.lead.created','owner-created:'||p_command_id::text,
    p_actor_user_id,jsonb_build_object('source','OWNER_CREATED'),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(lead_id_value,event);
END $$;

-- CAM coverage remains a separate mandatory boundary. A permission override,
-- including company.view.all, cannot enlarge a CAM's assigned portfolio.
CREATE OR REPLACE FUNCTION public.axora_snapshot_has_permission(
  p_snapshot jsonb,p_permission_code text,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_supplier_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE effective_code text; actor_user_id uuid;
BEGIN
  IF p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT') AND p_company_id IS NOT NULL THEN
    IF NOT public.axora_company_is_retained(p_company_id) THEN RETURN false; END IF;
    IF NOT public.axora_company_is_operational(p_company_id) AND (
      p_snapshot->>'accountKind'<>'PLATFORM'
      OR (
        p_permission_code NOT IN (
          'company.view','company.view.all','company.view.assigned',
          'company.create','company.edit','company.activate'
        )
        AND NOT (
          p_permission_code='company.portal.preview'
          AND public.axora_company_actor_is_owner(p_snapshot)
        )
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
    SELECT assignment.user_id INTO actor_user_id
    FROM public.role_assignments assignment
    WHERE assignment.id=NULLIF(p_snapshot->>'roleAssignmentId','')::uuid
      AND assignment.active AND assignment.revoked_at IS NULL;
    IF p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
      RETURN actor_user_id IS NOT NULL
        AND public.axora_company_assignment_allows_permission(
          actor_user_id,p_company_id,effective_code,now()
        );
    END IF;
    IF public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all',p_scope_type,p_company_id,p_branch_id,
      p_department_id,p_supplier_id
    ) THEN RETURN true; END IF;
    RETURN actor_user_id IS NOT NULL
      AND public.axora_company_assignment_allows_permission(
        actor_user_id,p_company_id,effective_code,now()
      );
  END IF;
  RETURN true;
END $$;

-- Prompt 7 restores lead assignment to the Platform Owner's canonical role
-- preset. Effective user DENY overrides still apply at command time.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'company.lead.assign','company.lead.reassign'
)
WHERE role.role_key='PLATFORM_OWNER' AND permission.active
ON CONFLICT DO NOTHING;

-- Lead visibility remains global for the Platform Owner, delegated to Human
-- Resources through its effective permission, and portfolio-bound for Client
-- Account Managers. Use the current override-aware permission snapshot so an
-- explicit GRANT can add the capability and a DENY can withdraw it without
-- widening a CAM's assignment boundary.
CREATE OR REPLACE FUNCTION public.axora_company_lead_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_lead_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_actor_is_owner(p_snapshot)
    OR (
      p_snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
      AND public.axora_snapshot_has_permission(
        p_snapshot,'company.lead.view','PLATFORM',NULL,NULL,NULL,NULL
      )
    )
    OR (
      p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
      AND public.axora_snapshot_has_permission(
        p_snapshot,'company.lead.view','PLATFORM',NULL,NULL,NULL,NULL
      )
      AND EXISTS (
        SELECT 1 FROM public.company_lead_assignments assignment
        WHERE assignment.lead_id=p_lead_id
          AND assignment.status='ACTIVE'
          AND assignment.manager_user_id=p_actor_user_id
          AND assignment.assigned_at<=p_at
      )
    )
$$;

-- Assigning a lead is an Owner-controlled acquisition operation with the
-- existing explicitly delegated HR path retained. Both paths must hold the
-- live effective assign/reassign permission; a CAM cannot self-claim a lead.
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
  assignment_actor:=snapshot IS NOT NULL
    AND (
      public.axora_company_actor_is_owner(snapshot)
      OR snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
    )
    AND public.axora_snapshot_has_permission(
      snapshot,required_permission,'PLATFORM',NULL,NULL,NULL,NULL
    );
  IF NOT assignment_actor
    OR lead_status IS NULL
    OR lead_status IN (
      'ONBOARDING','ACTIVE','CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
    )
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

-- The assigned CAM retains the normal follow-up lifecycle. The Platform Owner
-- can also perform every server-advertised transition while keeping HR's
-- historical assignment-only separation of duties.
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
  IF snapshot IS NULL
    OR NOT (
      public.axora_company_actor_is_owner(snapshot)
      OR snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'company.lead.view','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    )
    OR p_to_status NOT IN (
      'CONTACTED','INFORMATION_PENDING','QUALIFIED','ACTIVE','REJECTED','ARCHIVED'
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR (p_to_status='ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM public.company_leads lead
      JOIN public.companies company ON company.id=lead.converted_company_id
      WHERE lead.id=p_lead_id AND lead.status='ONBOARDING'
        AND company.lifecycle_status='ACTIVE' AND company.active
    ))
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
    WHEN 'ACTIVE' THEN 'company.lead.activated'
    WHEN 'REJECTED' THEN 'company.lead.rejected'
    WHEN 'ARCHIVED' THEN 'company.lead.archived'
    ELSE 'company.lead.status_changed' END;
  event:=public.axora_append_company_lead_event(
    p_lead_id,event_key,'status:'||version::text,p_actor_user_id,
    jsonb_build_object('status',p_to_status),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT public.axora_company_is_retained(p_company_id) THEN RETURN false; END IF;
  IF public.axora_company_actor_is_owner(p_snapshot) THEN RETURN true; END IF;
  IF p_snapshot->>'accountKind'='PLATFORM' THEN
    IF p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
      RETURN public.axora_company_assignment_is_active(
        p_actor_user_id,p_company_id,p_at
      ) AND (
        public.axora_snapshot_has_permission_base(
          p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
        ) OR public.axora_snapshot_has_permission_base(
          p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
        )
      );
    END IF;
    RETURN public.axora_snapshot_has_permission_base(
      p_snapshot,'company.view.all','COMPANY',p_company_id,NULL,NULL,NULL
    ) OR (
      public.axora_company_assignment_is_active(p_actor_user_id,p_company_id,p_at)
      AND public.axora_snapshot_has_permission_base(
        p_snapshot,'company.view.assigned','COMPANY',p_company_id,NULL,NULL,NULL
      )
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

-- Capability and portfolio are independent. Explicit user grants and denies
-- are resolved by the Prompt 7 snapshot wrapper, while the read check keeps a
-- CAM inside active company coverage (including access-mode restrictions).
CREATE OR REPLACE FUNCTION public.axora_company_actor_has_permission(
  p_snapshot jsonb,p_actor_user_id uuid,p_company_id uuid,
  p_permission_code text,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_actor_can_view(
    p_snapshot,p_actor_user_id,p_company_id,p_at
  ) AND public.axora_snapshot_has_permission(
    p_snapshot,p_permission_code,'COMPANY',p_company_id,NULL,NULL,NULL
  )
$$;

-- Company CAM handover is an accountable Platform Owner operation. Lead
-- assignment remains governed by the distinct company-lead functions.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$  can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot)
    OR (actor_snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
      AND public.axora_company_snapshot_role_permission(
        actor_snapshot,'company.lead.assign'
      ));$needle$,
    $replacement$  can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot);$replacement$
  );
  patched_definition:=replace(
    patched_definition,
    $needle$    'canCreate',public.axora_company_actor_can_create(
      actor_snapshot,'company.lead.create'
    ),$needle$,
    $replacement$    'canCreate',public.axora_company_actor_is_owner(actor_snapshot)
      AND public.axora_snapshot_has_permission(
        actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
      ),$replacement$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot);'
      IN patched_definition)=0
    OR position('''company.create'',''PLATFORM''' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Company lifecycle Owner workspace policy was not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_company_lifecycle_record(uuid,jsonb,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $needle$  can_assign:=is_owner OR public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.lead.assign',p_at
  );$needle$,
    $replacement$  can_assign:=is_owner;$replacement$
  );
  patched_definition:=replace(
    patched_definition,
    $needle$  can_reassign:=is_owner OR public.axora_company_actor_has_permission(
    p_snapshot,p_actor_user_id,p_company_id,'company.lead.reassign',p_at
  );$needle$,
    $replacement$  can_reassign:=is_owner;$replacement$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('can_assign:=is_owner;' IN patched_definition)=0
    OR position('can_reassign:=is_owner;' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Company lifecycle Owner assignment actions were not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_manage_company_assignment(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text[],text,text,text[],text,boolean,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'IF actor_snapshot IS NULL OR company_row.id IS NULL',
    'IF actor_snapshot IS NULL OR NOT public.axora_company_actor_is_owner(actor_snapshot) OR company_row.id IS NULL'
  );
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Company assignment live Owner policy was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- Durable command binding makes a retried direct creation replay the same
-- tenant. Nullable columns keep every pre-Prompt-7 row and prior image valid.
ALTER TABLE public.companies
  ADD COLUMN creation_command_id uuid,
  ADD COLUMN creation_payload_hash text,
  ADD COLUMN creation_logo_sha256 text,
  ADD CONSTRAINT companies_creation_command_binding_check CHECK (
    (creation_command_id IS NULL AND creation_payload_hash IS NULL
      AND creation_logo_sha256 IS NULL)
    OR (creation_command_id IS NOT NULL
      AND creation_payload_hash ~ '^[0-9a-f]{64}$'
      AND creation_logo_sha256 ~ '^[0-9a-f]{64}$')
  );
CREATE UNIQUE INDEX companies_creation_command_uq
  ON public.companies(creation_command_id)
  WHERE creation_command_id IS NOT NULL;

-- A CAM role never creates tenant roots in the Owner-controlled operating
-- model. This removes only the CAM preset; Platform Owner recovery authority
-- and any historical audit evidence remain intact.
DELETE FROM public.role_permissions role_permission
USING public.roles role,public.permissions permission
WHERE role_permission.role_id=role.id
  AND role_permission.permission_id=permission.id
  AND role.role_key='CLIENT_ACCOUNT_MANAGER'
  AND permission.permission_code='company.create';

-- Direct company creation is a Platform Owner operation. Removed acquisition
-- fields are stored as empty legacy-compatible values, never fabricated data.
CREATE OR REPLACE FUNCTION public.axora_create_company_record_internal(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_acquisition_lead_id uuid,
  p_name text,p_legal_name text,p_industry text,p_company_information text,
  p_website_url text,p_main_contact_name text,p_billing_cycle text,p_notes text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  company_id_value uuid;
  manager_id uuid;
  duplicate_count integer;
  source_value text;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL
    OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_legal_name,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_industry,''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_company_information,''))) NOT BETWEEN 3 AND 5000
    OR char_length(btrim(COALESCE(p_main_contact_name,'')))>300
    OR char_length(btrim(COALESCE(p_billing_cycle,''))) NOT BETWEEN 2 AND 300
  THEN RAISE EXCEPTION 'The company creation scope is unavailable'; END IF;

  IF p_acquisition_lead_id IS NULL THEN
    IF NOT public.axora_company_actor_is_owner(actor_snapshot)
      OR NOT public.axora_snapshot_has_permission(
        actor_snapshot,'company.create','PLATFORM',NULL,NULL,NULL,NULL
      )
    THEN RAISE EXCEPTION 'The company creation scope is unavailable'; END IF;
    source_value:='OWNER_DIRECT';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.company_leads lead
      WHERE lead.id=p_acquisition_lead_id AND lead.status='QUALIFIED'
        AND public.axora_company_lead_actor_can_view(
          actor_snapshot,p_actor_user_id,lead.id,p_at
        )
      FOR UPDATE
    ) THEN RAISE EXCEPTION 'Company lead conversion is unavailable'; END IF;
    source_value:='LEAD_CONVERSION';
    SELECT assignment.manager_user_id INTO manager_id
    FROM public.company_lead_assignments assignment
    WHERE assignment.lead_id=p_acquisition_lead_id AND assignment.status='ACTIVE'
    FOR KEY SHARE;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'axora-company-create:'
      ||public.axora_normalize_company_identity(p_legal_name)||':'
      ||public.axora_normalize_company_identity(p_name),0
  ));
  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason','Customer company created',true);

  INSERT INTO public.companies(
    company_code,name,legal_name,registration_number,industry,
    company_information,website_url,main_contact_name,main_contact_email,
    main_contact_phone,billing_contact_name,billing_contact_email,
    billing_contact_phone,billing_address,payment_terms,billing_cycle,notes,
    active,lifecycle_status,lifecycle_version,portal_access_enabled,
    is_publicly_listed,created_by,lifecycle_updated_at
  ) VALUES (
    public.next_company_code(),btrim(p_name),btrim(p_legal_name),'',
    btrim(p_industry),btrim(p_company_information),
    NULLIF(btrim(COALESCE(p_website_url,'')),''),
    btrim(COALESCE(p_main_contact_name,'')),'','','','','','',
    'Standard billing terms',btrim(p_billing_cycle),
    NULLIF(btrim(COALESCE(p_notes,'')),''),false,
    CASE WHEN manager_id IS NULL THEN 'ONBOARDING' ELSE 'ASSIGNED' END,
    1,false,false,
    p_actor_user_id,p_at
  ) RETURNING id INTO company_id_value;

  INSERT INTO public.company_status_history(
    company_id,lifecycle_version,from_status,to_status,reason,metadata,
    changed_by,changed_at
  ) VALUES (
    company_id_value,1,NULL,
    CASE WHEN manager_id IS NULL THEN 'ONBOARDING' ELSE 'ASSIGNED' END,
    'Customer company created',
    jsonb_build_object('source',source_value),p_actor_user_id,p_at
  );

  INSERT INTO public.company_duplicate_candidates(
    company_id,candidate_company_id,matched_fields
  )
  SELECT company_id_value,candidate.id,to_jsonb(array_remove(ARRAY[
    CASE WHEN public.axora_normalize_company_identity(candidate.legal_name)
      =public.axora_normalize_company_identity(p_legal_name)
      THEN 'legalName' END,
    CASE WHEN public.axora_normalize_company_identity(candidate.name)
      =public.axora_normalize_company_identity(p_name)
      THEN 'displayName' END
  ]::text[],NULL))
  FROM public.companies candidate
  WHERE candidate.id<>company_id_value AND (
    public.axora_normalize_company_identity(candidate.legal_name)
      =public.axora_normalize_company_identity(p_legal_name)
    OR public.axora_normalize_company_identity(candidate.name)
      =public.axora_normalize_company_identity(p_name)
  );
  GET DIAGNOSTICS duplicate_count=ROW_COUNT;
  IF duplicate_count>0 THEN
    UPDATE public.companies SET duplicate_review_status='POSSIBLE_DUPLICATE'
    WHERE id=company_id_value;
  END IF;

  INSERT INTO public.company_onboarding_items(
    company_id,item_code,label,required,status,blocking_reason,
    assigned_manager_user_id,completed_by,completed_at
  ) VALUES
    (company_id_value,'LEGAL_IDENTITY','Legal company identity',true,
      'PASSED',NULL,manager_id,p_actor_user_id,p_at),
    (company_id_value,'PRIMARY_CONTACT','Primary company contact',true,
      CASE WHEN btrim(COALESCE(p_main_contact_name,''))<>'' THEN 'PASSED' ELSE 'PENDING' END,
      CASE WHEN btrim(COALESCE(p_main_contact_name,''))<>'' THEN NULL
        ELSE 'A primary contact name is required.' END,
      manager_id,CASE WHEN btrim(COALESCE(p_main_contact_name,''))<>''
        THEN p_actor_user_id END,
      CASE WHEN btrim(COALESCE(p_main_contact_name,''))<>'' THEN p_at END),
    (company_id_value,'BILLING_CONFIGURATION','Billing configuration',true,
      'PENDING','Complete the billing configuration.',manager_id,NULL,NULL),
    (company_id_value,'APPROVED_BRAND','Reviewed logo and generated theme',true,
      'PENDING','An approved logo and generated theme are required.',manager_id,NULL,NULL),
    (company_id_value,'PRIMARY_MANAGER','Primary Client Account Manager',true,
      CASE WHEN manager_id IS NULL THEN 'PENDING' ELSE 'PASSED' END,
      CASE WHEN manager_id IS NULL THEN 'Assign a primary Client Account Manager.' END,
      manager_id,CASE WHEN manager_id IS NOT NULL THEN p_actor_user_id END,
      CASE WHEN manager_id IS NOT NULL THEN p_at END),
    (company_id_value,'COMPANY_REVIEW','Company onboarding review',true,
      'PENDING','Complete the company review.',manager_id,NULL,NULL),
    (company_id_value,'ADMIN_INVITATION','Company Administrator invitation',true,
      'PENDING','Issue a valid Company Administrator invitation.',manager_id,NULL,NULL),
    (company_id_value,'ADMIN_ACTIVATION','Company Administrator activation',true,
      'PENDING','The invited Company Administrator must complete account setup.',manager_id,NULL,NULL);

  IF manager_id IS NOT NULL THEN
    INSERT INTO public.company_assignments(
      company_id,manager_user_id,assignment_type,status,coverage_starts_at,
      assigned_by,assigned_at,assignment_reason
    ) VALUES (
      company_id_value,manager_id,'PRIMARY','ACTIVE',p_at,p_actor_user_id,p_at,
      'Acquisition lead handover retained during company conversion'
    );
  END IF;

  RETURN public.axora_company_mutation_payload(
    company_id_value,actor_snapshot,p_actor_user_id,p_at,'company.created',false,
    CASE WHEN manager_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[manager_id] END
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_create_company_direct(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_name text,
  p_legal_name text,p_industry text,p_company_information text,
  p_website_url text,p_main_contact_name text,p_billing_cycle text,p_notes text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_create_company_record_internal(
    p_actor_user_id,p_actor_role_assignment_id,NULL,p_name,p_legal_name,
    p_industry,p_company_information,p_website_url,p_main_contact_name,
    p_billing_cycle,p_notes,p_at
  )
$$;

-- The Prompt 7 signature binds a browser-generated command to the normalized
-- business payload and to the digest of the logo after trusted processing.
-- The historical overload above remains intact for a previous-image rollback.
CREATE OR REPLACE FUNCTION public.axora_create_company_direct(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_command_id uuid,
  p_logo_sha256 text,p_name text,p_legal_name text,p_industry text,
  p_company_information text,p_website_url text,p_main_contact_name text,
  p_billing_cycle text,p_notes text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor_snapshot jsonb;
  existing_company public.companies%ROWTYPE;
  company_payload jsonb;
  payload_hash_value text;
  logo_id_value uuid;
  theme_id_value uuid;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF p_command_id IS NULL OR p_logo_sha256 !~ '^[0-9a-f]{64}$'
    OR actor_snapshot IS NULL
    OR NOT public.axora_company_actor_is_owner(actor_snapshot)
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
    'notes',NULLIF(btrim(COALESCE(p_notes,'')),''),
    'logoSha256',p_logo_sha256
  )::text,'UTF8')),'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'company-create-command:'||p_command_id::text,0
  ));
  SELECT * INTO existing_company
  FROM public.companies company
  WHERE company.creation_command_id=p_command_id
  FOR UPDATE;
  IF existing_company.id IS NOT NULL THEN
    IF existing_company.created_by IS DISTINCT FROM p_actor_user_id
      OR existing_company.creation_payload_hash IS DISTINCT FROM payload_hash_value
      OR existing_company.creation_logo_sha256 IS DISTINCT FROM p_logo_sha256
    THEN RETURN jsonb_build_object('status','COMMAND_CONFLICT'); END IF;

    SELECT logo.id,theme.id INTO logo_id_value,theme_id_value
    FROM public.company_logos logo
    JOIN public.company_brand_themes theme
      ON theme.company_id=logo.company_id AND theme.source_logo_id=logo.id
    WHERE logo.company_id=existing_company.id AND logo.sha256=p_logo_sha256
    ORDER BY theme.version,theme.id LIMIT 1;
    RETURN public.axora_company_mutation_payload(
      existing_company.id,actor_snapshot,p_actor_user_id,p_at,
      'company.created',false,ARRAY[]::uuid[]
    ) || jsonb_build_object(
      'created',false,'creationLogoId',logo_id_value,
      'creationThemeId',theme_id_value
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
    creation_logo_sha256=p_logo_sha256
  WHERE id=(company_payload->>'companyId')::uuid;
  RETURN company_payload||jsonb_build_object(
    'created',true,'creationLogoId',NULL,'creationThemeId',NULL
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_create_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_name text,
  p_legal_name text,p_registration_number text,p_industry text,
  p_company_information text,p_website_url text,p_main_contact_name text,
  p_main_contact_email text,p_main_contact_phone text,p_billing_contact_name text,
  p_billing_contact_email text,p_billing_contact_phone text,p_billing_address text,
  p_payment_terms text,p_billing_cycle text,p_notes text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_create_company_direct(
    p_actor_user_id,p_actor_role_assignment_id,p_name,p_legal_name,p_industry,
    p_company_information,p_website_url,p_main_contact_name,p_billing_cycle,
    p_notes,p_at
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_convert_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  snapshot jsonb;
  lead public.company_leads%ROWTYPE;
  intake record;
  company_payload jsonb;
  company_id_value uuid;
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
  SELECT * INTO intake FROM public.company_lead_intake_rows details
  WHERE details.lead_id=p_lead_id
  ORDER BY details.created_at DESC,details.id DESC LIMIT 1;
  IF intake.id IS NULL THEN RAISE EXCEPTION 'Company lead conversion is unavailable'; END IF;

  company_payload:=public.axora_create_company_record_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_lead_id,intake.company_name,
    intake.company_legal_name,intake.industry,
    left(format('Employees: %s; branches: %s; monthly spend: %s.',
      intake.employee_count_range,intake.branch_count_range,
      intake.monthly_spend_range),5000),
    '',intake.contact_name,'Monthly','',p_at
  );
  company_id_value:=(company_payload->>'companyId')::uuid;
  UPDATE public.company_leads SET converted_company_id=company_id_value
  WHERE id=p_lead_id;
  PERFORM public.axora_apply_company_lead_status(
    p_lead_id,'ONBOARDING',p_actor_user_id,p_reason,p_at,
    jsonb_build_object('companyId',company_id_value)
  );
  event:=public.axora_append_company_lead_event(
    p_lead_id,'company.lead.converted','converted:'||company_id_value::text,
    p_actor_user_id,jsonb_build_object('companyId',company_id_value),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event)
    ||jsonb_build_object(
      'companyId',company_id_value,'companyPayload',company_payload
    );
END $$;

-- Keep the historical signature callable by a rolled-back image. Retired
-- values are accepted for wire compatibility but are neither required nor
-- written, so previously stored evidence is preserved without collecting more.
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
    legal_name=btrim(p_legal_name),
    registration_country_code=upper(btrim(p_registration_country_code)),
    tax_registration_number=btrim(p_tax_registration_number),
    industry_code=p_industry_code,
    industry_other_text=CASE WHEN custom_allowed THEN btrim(p_industry_other_text) ELSE NULL END,
    industry=CASE WHEN custom_allowed THEN btrim(p_industry_other_text)
      ELSE (SELECT name_en FROM public.industry_taxonomy WHERE industry_code=p_industry_code) END,
    registered_address=btrim(p_registered_address),operating_address=btrim(p_operating_address),
    main_contact_name=btrim(p_main_contact_name),
    billing_contact_name=btrim(p_billing_contact_name),
    billing_contact_email=lower(btrim(p_billing_contact_email)),
    billing_address=btrim(p_billing_address),
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
      AND p_registration_country_code ~ '^[A-Za-z]{2}$')
    OR item.item_code='INDUSTRY_CLASSIFICATION'
    OR (item.item_code='REGISTERED_ADDRESS' AND btrim(p_registered_address)<>''
      AND btrim(p_operating_address)<>'')
    OR (item.item_code='PRIMARY_CONTACT' AND btrim(p_main_contact_name)<>'')
    OR (item.item_code='BILLING_CONFIGURATION' AND btrim(p_billing_address)<>'')
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

-- Canonical branch destinations extend the existing delivery-location model.
-- Columns remain nullable for historical rows and previous-image compatibility;
-- the new save/payment capabilities require a validated pair.
ALTER TABLE public.delivery_locations
  ADD COLUMN latitude numeric(9,6),
  ADD COLUMN longitude numeric(9,6),
  ADD CONSTRAINT delivery_locations_coordinate_pair_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );

ALTER TABLE public.delivery_jobs
  ADD COLUMN destination_location_id uuid
    REFERENCES public.delivery_locations(id) ON DELETE RESTRICT,
  ADD COLUMN destination_latitude numeric(9,6),
  ADD COLUMN destination_longitude numeric(9,6),
  ADD CONSTRAINT delivery_jobs_destination_coordinate_pair_check CHECK (
    (destination_latitude IS NULL AND destination_longitude IS NULL)
    OR (destination_latitude IS NOT NULL AND destination_longitude IS NOT NULL
      AND destination_latitude BETWEEN -90 AND 90
      AND destination_longitude BETWEEN -180 AND 180)
  );

-- Location-save commands are private immutable replay evidence. No direct app
-- table grant exists; the SECURITY DEFINER capability is the only writer.
CREATE TABLE public.branch_delivery_location_commands (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  location_id uuid NOT NULL REFERENCES public.delivery_locations(id) ON DELETE CASCADE,
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,command_id)
);
CREATE INDEX branch_delivery_location_commands_company_idx
  ON public.branch_delivery_location_commands(company_id,created_at,command_id);
ALTER TABLE public.branch_delivery_location_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_delivery_location_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.branch_delivery_location_commands FROM PUBLIC;
CREATE TRIGGER branch_delivery_location_commands_append_only
BEFORE UPDATE OR DELETE ON public.branch_delivery_location_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES (
  'branch_delivery_location_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
  'Immutable branch delivery-location command replay evidence is tenant-owned and privately retained only when protected evidence requires tenant retention.'
) ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

CREATE OR REPLACE FUNCTION public.axora_branch_delivery_location_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; location_row record;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=p_branch_id AND branch.active;
  IF snapshot IS NULL OR branch_row.id IS NULL
    OR NOT public.axora_organization_permission_at(
      snapshot,'organization.branch.view',branch_row.company_id,branch_row.id,NULL
    )
  THEN RETURN NULL; END IF;
  SELECT location.* INTO location_row FROM public.delivery_locations location
  WHERE location.branch_id=branch_row.id AND location.active AND location.is_primary
  ORDER BY location.created_at,location.id LIMIT 1;
  RETURN jsonb_build_object(
    'capturedAt',p_at,'companyId',branch_row.company_id,'branchId',branch_row.id,
    'branchName',branch_row.name,'canManage',public.axora_organization_permission_at(
      snapshot,'organization.delivery_location.manage',branch_row.company_id,
      branch_row.id,NULL
    ),
    'location',CASE WHEN location_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',location_row.id,'addressLabel',location_row.address,
      'latitude',location_row.latitude::text,
      'longitude',location_row.longitude::text,
      'instructions',location_row.delivery_instructions,
      'updatedAt',location_row.updated_at
    ) END
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_save_branch_delivery_location(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_address_label text,p_latitude numeric,p_longitude numeric,
  p_instructions text,p_reason text,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE;
  location_row public.delivery_locations%ROWTYPE; previous_snapshot jsonb;
  existing_command public.branch_delivery_location_commands%ROWTYPE;
  location_id_value uuid; location_code_value text;
  payload_hash_value text; result_value jsonb;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL
    OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    OR char_length(btrim(COALESCE(p_address_label,''))) NOT BETWEEN 3 AND 5000
    OR char_length(btrim(COALESCE(p_instructions,'')))>5000
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'The branch delivery location is invalid'; END IF;
  IF p_command_id IS NULL THEN
    RAISE EXCEPTION 'The branch delivery location is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'branch-delivery-location-command:'||p_actor_user_id::text||':'
      ||p_command_id::text,0
  ));
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=p_branch_id AND branch.active FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL
    OR char_length(btrim(branch_row.city))<2
    OR NOT public.axora_organization_permission_at(
      snapshot,'organization.delivery_location.manage',branch_row.company_id,
      branch_row.id,NULL
  )
  THEN RAISE EXCEPTION 'The branch delivery location is unavailable'; END IF;

  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'branchId',p_branch_id::text,
    'addressLabel',btrim(p_address_label),
    'latitude',round(p_latitude,6),
    'longitude',round(p_longitude,6),
    'instructions',NULLIF(btrim(COALESCE(p_instructions,'')),''),
    'reason',btrim(p_reason)
  )::text,'UTF8')),'hex');
  SELECT * INTO existing_command
  FROM public.branch_delivery_location_commands command
  WHERE command.actor_user_id=p_actor_user_id AND command.command_id=p_command_id
  FOR UPDATE;
  IF existing_command.command_id IS NOT NULL THEN
    IF existing_command.branch_id IS DISTINCT FROM p_branch_id
      OR existing_command.company_id IS DISTINCT FROM branch_row.company_id
      OR existing_command.payload_hash IS DISTINCT FROM payload_hash_value
    THEN RAISE EXCEPTION 'The branch delivery location command is unavailable'; END IF;
    RETURN existing_command.result||jsonb_build_object(
      'capturedAt',p_at,'commandId',p_command_id
    );
  END IF;

  SELECT * INTO location_row FROM public.delivery_locations location
  WHERE location.branch_id=branch_row.id AND location.active AND location.is_primary
  FOR UPDATE;
  previous_snapshot:=CASE WHEN location_row.id IS NULL THEN NULL
    ELSE to_jsonb(location_row) END;
  IF location_row.id IS NULL THEN
    location_id_value:=gen_random_uuid();
    location_code_value:=left('DELIVERY_'||upper(regexp_replace(
      branch_row.branch_code,'[^A-Za-z0-9_-]+','_','g'
    )),40);
    INSERT INTO public.delivery_locations(
      id,company_id,branch_id,location_code,name,address,city,country_code,
      timezone,delivery_instructions,is_primary,active,created_by,
      latitude,longitude,created_at,updated_at
    ) VALUES (
      location_id_value,branch_row.company_id,branch_row.id,location_code_value,
      left(branch_row.name||' delivery',200),btrim(p_address_label),
      btrim(branch_row.city),'MY',branch_row.timezone,
      NULLIF(btrim(COALESCE(p_instructions,'')),''),true,true,p_actor_user_id,
      round(p_latitude,6),round(p_longitude,6),p_at,p_at
    );
  ELSE
    location_id_value:=location_row.id;
    UPDATE public.delivery_locations SET address=btrim(p_address_label),
      delivery_instructions=NULLIF(btrim(COALESCE(p_instructions,'')),''),
      latitude=round(p_latitude,6),longitude=round(p_longitude,6),updated_at=p_at
    WHERE id=location_id_value;
  END IF;
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,
    reason,changed_by,changed_at
  ) VALUES (
    branch_row.company_id,'DELIVERY_LOCATION',location_id_value,
    CASE WHEN previous_snapshot IS NULL THEN 'CREATED' ELSE 'UPDATED' END,
    previous_snapshot,(SELECT to_jsonb(location) FROM public.delivery_locations location
      WHERE location.id=location_id_value),btrim(p_reason),p_actor_user_id,p_at
  );
  result_value:=public.axora_branch_delivery_location_workspace(
    p_actor_user_id,p_actor_role_assignment_id,p_branch_id,p_at
  ) || jsonb_build_object('commandId',p_command_id);
  INSERT INTO public.branch_delivery_location_commands(
    actor_user_id,command_id,company_id,branch_id,payload_hash,location_id,
    result,created_at
  ) VALUES (
    p_actor_user_id,p_command_id,branch_row.company_id,p_branch_id,
    payload_hash_value,location_id_value,result_value,p_at
  );
  RETURN result_value;
END $$;

-- Snapshot the canonical location under a share lock when a paid job is made.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_ensure_available_job_for_paid_payment(uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'DECLARE company_active boolean;',
    'DECLARE company_active boolean; DECLARE location_row public.delivery_locations%ROWTYPE;'
  );
  patched_definition:=replace(
    patched_definition,
    $$SELECT company.active INTO company_active FROM public.companies company$$,
    $$SELECT * INTO location_row FROM public.delivery_locations location
  WHERE location.branch_id=request_row.branch_id AND location.active
    AND location.is_primary ORDER BY location.created_at,location.id LIMIT 1 FOR SHARE;
  IF location_row.id IS NULL OR location_row.latitude IS NULL
    OR location_row.longitude IS NULL
    OR location_row.latitude NOT BETWEEN -90 AND 90
    OR location_row.longitude NOT BETWEEN -180 AND 180
  THEN RAISE EXCEPTION USING ERRCODE='P7301',
    MESSAGE='AXORA_BRANCH_DELIVERY_LOCATION_REQUIRED'; END IF;
  SELECT company.active INTO company_active FROM public.companies company$$
  );
  patched_definition:=replace(
    patched_definition,
    $$instructions,idempotency_key,created_by,workflow_version,$$,
    $$instructions,destination_location_id,destination_latitude,
    destination_longitude,idempotency_key,created_by,workflow_version,$$
  );
  patched_definition:=replace(
    patched_definition,
    $$branch_row.contact_phone,NULL,'paid-request-'||request_row.id::text,$$,
    $$branch_row.contact_phone,COALESCE(location_row.delivery_instructions,
      branch_row.delivery_instructions),location_row.id,location_row.latitude,
    location_row.longitude,'paid-request-'||request_row.id::text,$$
  );
  patched_definition:=replace(
    patched_definition,
    $$'AWAITING_ASSIGNMENT',branch_row.delivery_address,branch_row.contact_name,$$,
    $$'AWAITING_ASSIGNMENT',COALESCE(location_row.address,
      branch_row.delivery_address),branch_row.contact_name,$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('destination_latitude' IN patched_definition)=0
    OR position('AXORA_BRANCH_DELIVERY_LOCATION_REQUIRED' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Paid delivery destination snapshot was not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- A retried upload/claim replays its durable result. The advisory key closes
-- the small pre-row-lock window where identical commands could otherwise race
-- into a uniqueness error instead of returning a controlled result.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_claim_available_delivery_job(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    E'BEGIN\n  SELECT * INTO existing',
    E'BEGIN\n  PERFORM pg_advisory_xact_lock(hashtextextended(''delivery-claim-command:''||p_command_id::text,0));\n  SELECT * INTO existing'
  );
  patched_definition:=replace(
    patched_definition,
    $$IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('assignmentId',existing.id,'jobId',existing.delivery_job_id,'status',existing.status,'created',false);
  END IF;$$,
    $$IF existing.id IS NOT NULL THEN
    IF existing.delivery_job_id IS DISTINCT FROM p_delivery_job_id
      OR existing.driver_role_assignment_id IS DISTINCT FROM p_actor_role_assignment_id
    THEN RAISE EXCEPTION USING ERRCODE='P7302',
      MESSAGE='AXORA_DELIVERY_CLAIM_COMMAND_CONFLICT'; END IF;
    RETURN jsonb_build_object('assignmentId',existing.id,'jobId',existing.delivery_job_id,'status',existing.status,'created',false);
  END IF;$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('delivery-claim-command:' IN patched_definition)=0
    OR position('AXORA_DELIVERY_CLAIM_COMMAND_CONFLICT' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery claim idempotency lock was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    E'BEGIN\n  SELECT * INTO existing',
    E'BEGIN\n  PERFORM pg_advisory_xact_lock(hashtextextended(''delivery-evidence-command:''||COALESCE(p_actor_user_id::text,'''')||'':''||COALESCE(p_client_evidence_id::text,''''),0));\n  SELECT * INTO existing'
  );
  patched_definition:=replace(
    patched_definition,
    $$IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('evidenceId',existing.id,'version',existing.evidence_version);
  END IF;$$,
    $$IF existing.id IS NOT NULL THEN
    IF existing.delivery_job_id IS DISTINCT FROM p_delivery_job_id
      OR existing.evidence_type IS DISTINCT FROM p_evidence_type
    THEN RAISE EXCEPTION 'The delivery evidence command is unavailable'; END IF;
    RETURN jsonb_build_object('evidenceId',existing.id,'version',
      existing.evidence_version,'created',false,'storagePath',existing.storage_path);
  END IF;$$
  );
  patched_definition:=replace(
    patched_definition,
    $$RETURN jsonb_build_object('evidenceId',evidence_id,'version',next_version,
    'validationStatus','ACCEPTED');$$,
    $$RETURN jsonb_build_object('evidenceId',evidence_id,'version',next_version,
    'validationStatus','ACCEPTED','created',true,'storagePath',p_storage_path);$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('delivery-evidence-command:' IN patched_definition)=0
    OR position('existing.delivery_job_id IS DISTINCT FROM p_delivery_job_id' IN patched_definition)=0
    OR position('''created'',false' IN patched_definition)=0
    OR position('''created'',true' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery evidence replay result was not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Delivery audiences are resolved from live permission and exact request
-- scope, with the driver actor added explicitly. Notification preferences are
-- still applied by the central outbox capability.
CREATE OR REPLACE FUNCTION public.axora_delivery_notification_recipients(
  p_delivery_job_id uuid,p_actor_user_id uuid,p_at timestamptz
)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(array_agg(DISTINCT candidate.user_id ORDER BY candidate.user_id),
    ARRAY[]::uuid[])
  FROM (
    SELECT p_actor_user_id AS user_id
    UNION ALL
    SELECT assignment.user_id
    FROM public.delivery_jobs job
    JOIN public.requests request ON request.id=job.request_id
    JOIN public.role_assignments assignment
      ON assignment.active AND assignment.revoked_at IS NULL
    JOIN public.users account ON account.id=assignment.user_id
      AND account.active AND account.account_status='ACTIVE'
    WHERE job.id=p_delivery_job_id
      AND public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot(
          assignment.user_id,assignment.id,p_at
        ),'delivery.view',
        CASE WHEN request.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
        job.company_id,job.branch_id,request.department_id,NULL
      )
  ) candidate
  WHERE candidate.user_id IS NOT NULL
$$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'ARRAY[p_actor_user_id,job.created_by]',
    'public.axora_delivery_notification_recipients(job.id,p_actor_user_id,p_at)'
  );
  patched_definition:=replace(
    patched_definition,
    $$jsonb_build_object('jobId',job.id,'status',next_status)$$,
    $$jsonb_build_object(
      'jobId',job.id,'status',next_status,'requiredPermission','delivery.view',
      'deliveryActorConfirmation',true,'actorPermission',required_permission,
      'branchId',job.branch_id,'departmentId',(SELECT request.department_id
        FROM public.requests request WHERE request.id=job.request_id)
    )$$
  );
  patched_definition:=replace(
    patched_definition,
    $$payload_hash:=encode(digest(concat_ws('|',p_delivery_job_id,p_assignment_id,
    p_expected_workflow_version,p_device_id,p_device_sequence,p_event_type,
    p_client_recorded_at,p_metadata::text),'sha256'),'hex');$$,
    $$payload_hash:=encode(pg_catalog.sha256(convert_to(concat_ws('|',
    p_delivery_job_id,p_assignment_id,p_expected_workflow_version,p_device_id,
    p_device_sequence,p_event_type,p_client_recorded_at,p_metadata::text
    ),'UTF8')),'hex');$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('axora_delivery_notification_recipients' IN patched_definition)=0
    OR position('requiredPermission' IN patched_definition)=0
    OR position('pg_catalog.sha256' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery recipient resolution was not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_assign_delivery_job(uuid,uuid,uuid,uuid,uuid,integer,text,timestamptz,text,text,text,text[],uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,$$'delivery.assigned'$$,$$'driver.assigned'$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Delivery assignment event key was not patched';
  END IF;
  EXECUTE patched_definition;
END $patch$;

INSERT INTO public.notification_event_policies(
  event_key,category,email_mandatory,default_reminder_hours,company_configurable
) VALUES ('company.created','LEAD',false,NULL,false)
ON CONFLICT(event_key) DO NOTHING;

REVOKE ALL ON FUNCTION public.axora_record_public_contact_submission(jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_acquisition_lead(uuid,uuid,jsonb,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_company_lead_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_company_record_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_company_direct(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_branch_delivery_location_workspace(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_save_branch_delivery_location(uuid,uuid,uuid,text,numeric,numeric,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_notification_recipients(uuid,uuid,timestamptz) FROM PUBLIC;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  REVOKE ALL ON TABLE public.company_lead_profiles,public.company_lead_intake_rows,
    public.branch_delivery_location_commands FROM axora_app;
  REVOKE ALL ON FUNCTION public.axora_protect_company_lead_profile() FROM axora_app;
  REVOKE ALL ON FUNCTION public.axora_create_company_record_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz) FROM axora_app;
  REVOKE ALL ON FUNCTION public.axora_delivery_notification_recipients(uuid,uuid,timestamptz) FROM axora_app;
  GRANT EXECUTE ON FUNCTION
    public.axora_record_public_contact_submission(jsonb,timestamptz),
    public.axora_create_acquisition_lead(uuid,uuid,jsonb,uuid,timestamptz),
    public.axora_create_company_direct(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz),
    public.axora_create_company_direct(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz),
    public.axora_branch_delivery_location_workspace(uuid,uuid,uuid,timestamptz),
    public.axora_save_branch_delivery_location(uuid,uuid,uuid,text,numeric,numeric,text,text,uuid,timestamptz)
  TO axora_app;
END IF; END $$;

COMMIT;
