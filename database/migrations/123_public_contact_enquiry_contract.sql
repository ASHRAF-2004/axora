BEGIN;

-- Contact Us is an enquiry channel, not a commercial lead intake form. Keep
-- historical lead-shaped submissions unchanged while allowing new rows to
-- leave retired lead attributes genuinely absent.
ALTER TABLE public.public_contact_submissions
  ALTER COLUMN company_name DROP NOT NULL,
  ALTER COLUMN company_legal_name DROP NOT NULL,
  ALTER COLUMN company_registration_number DROP NOT NULL,
  ALTER COLUMN phone_country_code DROP NOT NULL,
  ALTER COLUMN country DROP NOT NULL,
  ALTER COLUMN region DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN industry DROP NOT NULL,
  ALTER COLUMN employee_count_range DROP NOT NULL,
  ALTER COLUMN branch_count_range DROP NOT NULL,
  ALTER COLUMN monthly_spend_range DROP NOT NULL,
  ALTER COLUMN preferred_contact_method DROP NOT NULL,
  ALTER COLUMN preferred_contact_time DROP NOT NULL,
  ALTER COLUMN contact_timezone DROP NOT NULL,
  ALTER COLUMN display_timezone DROP NOT NULL,
  ALTER COLUMN subject DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.axora_prepare_legacy_public_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.id IS NULL THEN NEW.id:=gen_random_uuid(); END IF;
  IF NEW.idempotency_key IS NULL THEN
    NEW.idempotency_key:=md5('contact-submission:a:'||NEW.id::text)
      ||md5('contact-submission:b:'||NEW.id::text);
  END IF;
  -- Only historical company-lead rows retain the compatibility defaults.
  -- Enquiry-only rows deliberately preserve NULL for fields not supplied.
  IF btrim(COALESCE(NEW.company_name,''))<>'' THEN
    IF btrim(COALESCE(NEW.company_legal_name,''))='' THEN
      NEW.company_legal_name:=NEW.company_name;
    END IF;
    IF btrim(COALESCE(NEW.city,''))='' THEN NEW.city:='Not provided'; END IF;
    IF btrim(COALESCE(NEW.industry,''))='' THEN NEW.industry:='Not provided'; END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_prepare_legacy_public_contact() FROM PUBLIC;

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
  full_name_value text:=p_input->>'fullName';
  email_value text:=lower(btrim(COALESCE(p_input->>'email','')));
  phone_value text:=btrim(COALESCE(p_input->>'phone',''));
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
    OR char_length(btrim(COALESCE(full_name_value,''))) NOT BETWEEN 2 AND 200
    OR full_name_value ~ '[[:cntrl:]]'
    OR char_length(email_value) NOT BETWEEN 3 AND 254
    OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR phone_value !~ '^\+[1-9][0-9]{7,14}$'
    OR char_length(btrim(COALESCE(message_value,''))) NOT BETWEEN 10 AND 5000
    OR regexp_replace(message_value,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
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
    NULL,v_idempotency_key,locale_value,btrim(full_name_value),email_value,NULL,
    NULL,NULL,NULL,phone_value,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
    NULL,NULL,NULL,btrim(message_value),p_at,btrim(policy_version),source_page,
    source_metadata,network_key,sender_key,true,challenge_at,p_at,hostname,
    'contact','CANCELLED',p_at,p_at
  ) RETURNING id INTO submission_id;

  RETURN jsonb_build_object('created',true,'submissionId',submission_id);
END $$;

REVOKE ALL ON FUNCTION public.axora_record_public_contact_submission(jsonb,timestamptz)
  FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  GRANT EXECUTE ON FUNCTION
    public.axora_record_public_contact_submission(jsonb,timestamptz)
  TO axora_app;
END IF; END $$;

COMMIT;
