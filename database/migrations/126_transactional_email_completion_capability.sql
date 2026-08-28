BEGIN;

CREATE OR REPLACE FUNCTION public.axora_record_transactional_email_attempt(
  p_delivery_id uuid,
  p_event_type text,
  p_template_key text,
  p_template_version integer,
  p_provider_name text,
  p_provider_agent text,
  p_attempt_number integer,
  p_outcome text,
  p_provider_message_id text,
  p_error_code text,
  p_http_status integer,
  p_correlation_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  expected_status text;
BEGIN
  expected_status := CASE
    WHEN p_outcome='sent' THEN 'SENT'
    WHEN p_outcome IN ('paused','retry') THEN 'PENDING'
    WHEN p_outcome='uncertain' THEN 'UNCERTAIN'
    WHEN p_outcome='disabled' THEN 'DISABLED'
    WHEN p_outcome='failed' THEN 'FAILED'
    ELSE NULL
  END;

  IF expected_status IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.transactional_email_outbox outbox
    WHERE outbox.id=p_delivery_id
      AND outbox.message_kind=p_event_type
      AND outbox.template_key=p_template_key
      AND outbox.template_version=p_template_version
      AND outbox.provider_agent=p_provider_agent
      AND outbox.delivery_attempt_count=p_attempt_number
      AND outbox.correlation_id=p_correlation_id
      AND outbox.delivery_status=expected_status
  ) THEN
    RAISE EXCEPTION 'Transactional email attempt does not match its delivery'
      USING ERRCODE='check_violation';
  END IF;

  INSERT INTO public.email_delivery_attempts(
    delivery_kind,delivery_id,event_type,template_key,template_version,
    provider_name,provider_agent,attempt_number,outcome,
    provider_message_fingerprint,error_code,http_status,correlation_id
  ) VALUES (
    'TRANSACTIONAL',p_delivery_id,p_event_type,p_template_key,
    p_template_version,p_provider_name,p_provider_agent,p_attempt_number,
    p_outcome,
    CASE WHEN p_provider_message_id IS NULL THEN NULL
      ELSE encode(sha256(convert_to(p_provider_message_id,'UTF8')),'hex') END,
    p_error_code,p_http_status,p_correlation_id
  ) ON CONFLICT(delivery_kind,delivery_id,attempt_number) DO NOTHING;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.axora_record_transactional_email_attempt(
  uuid,text,text,integer,text,text,integer,text,text,text,integer,uuid
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.email_delivery_attempts FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_record_transactional_email_attempt(
      uuid,text,text,integer,text,text,integer,text,text,text,integer,uuid
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
