BEGIN;

CREATE OR REPLACE FUNCTION public.protect_transactional_email_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  database_owner text;
  owner_reconciliation boolean:=false;
BEGIN
  SELECT pg_get_userbyid(database.datdba)
  INTO database_owner
  FROM pg_database database
  WHERE database.datname=current_database();

  owner_reconciliation := session_user=database_owner
    AND OLD.delivery_status='UNCERTAIN'
    AND OLD.last_delivery_error='lease_expired'
    AND NEW.delivery_status='SENT'
    AND NEW.delivery_attempt_count=OLD.delivery_attempt_count
    AND NEW.delivery_available_at=OLD.delivery_available_at
    AND NEW.delivery_attempted_at=OLD.delivery_attempted_at
    AND NEW.delivery_lease_id IS NOT DISTINCT FROM OLD.delivery_lease_id
    AND NEW.delivery_lease_expires_at IS NOT DISTINCT FROM OLD.delivery_lease_expires_at
    AND NEW.sent_at IS NOT NULL
    AND NEW.sent_at>=OLD.delivery_attempted_at-interval '5 minutes'
    AND NEW.sent_at<=now()+interval '10 minutes'
    AND NEW.provider_message_id IS NOT NULL
    AND NEW.last_delivery_error IS NULL
    AND NEW.token_ciphertext IS NOT DISTINCT FROM OLD.token_ciphertext
    AND NEW.token_nonce IS NOT DISTINCT FROM OLD.token_nonce
    AND NEW.token_authentication_tag IS NOT DISTINCT FROM OLD.token_authentication_tag;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.message_kind IS DISTINCT FROM OLD.message_kind
    OR NEW.contact_submission_id IS DISTINCT FROM OLD.contact_submission_id
    OR NEW.password_reset_token_id IS DISTINCT FROM OLD.password_reset_token_id
    OR NEW.email_verification_token_id IS DISTINCT FROM OLD.email_verification_token_id
    OR NEW.locale IS DISTINCT FROM OLD.locale
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Transactional email outbox identity is immutable';
  END IF;
  IF (OLD.token_ciphertext IS NULL AND NEW.token_ciphertext IS NOT NULL)
    OR (OLD.token_nonce IS NULL AND NEW.token_nonce IS NOT NULL)
    OR (OLD.token_authentication_tag IS NULL
      AND NEW.token_authentication_tag IS NOT NULL)
    OR (OLD.token_ciphertext IS NOT NULL AND NEW.token_ciphertext IS NOT NULL
      AND OLD.token_ciphertext IS DISTINCT FROM NEW.token_ciphertext)
    OR (OLD.token_nonce IS NOT NULL AND NEW.token_nonce IS NOT NULL
      AND OLD.token_nonce IS DISTINCT FROM NEW.token_nonce)
    OR (OLD.token_authentication_tag IS NOT NULL
      AND NEW.token_authentication_tag IS NOT NULL
      AND OLD.token_authentication_tag IS DISTINCT FROM NEW.token_authentication_tag) THEN
    RAISE EXCEPTION 'Transactional email encrypted payload is immutable';
  END IF;
  IF NEW.delivery_attempt_count < OLD.delivery_attempt_count THEN
    RAISE EXCEPTION 'Transactional email attempts cannot decrease';
  END IF;
  IF OLD.delivery_status NOT IN ('PENDING','SENDING')
    AND NOT owner_reconciliation AND (
      NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
      OR NEW.delivery_attempt_count IS DISTINCT FROM OLD.delivery_attempt_count
      OR NEW.delivery_available_at IS DISTINCT FROM OLD.delivery_available_at
      OR NEW.delivery_attempted_at IS DISTINCT FROM OLD.delivery_attempted_at
      OR NEW.delivery_lease_id IS DISTINCT FROM OLD.delivery_lease_id
      OR NEW.delivery_lease_expires_at IS DISTINCT FROM OLD.delivery_lease_expires_at
      OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
      OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
      OR NEW.last_delivery_error IS DISTINCT FROM OLD.last_delivery_error
    ) THEN
    RAISE EXCEPTION 'Transactional email delivery metadata is final';
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.delivery_status='PENDING' AND NEW.delivery_status NOT IN (
      'SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid transactional email delivery transition';
    ELSIF OLD.delivery_status='SENDING' AND NEW.delivery_status NOT IN (
      'PENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid transactional email delivery transition';
    ELSIF OLD.delivery_status NOT IN ('PENDING','SENDING')
      AND NOT owner_reconciliation THEN
      RAISE EXCEPTION 'Transactional email delivery status is final';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_reconcile_transactional_email_delivery(
  p_delivery_id uuid,
  p_provider_message_id text,
  p_provider_name text,
  p_delivered_at timestamptz,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  database_owner text;
  target record;
  changed integer;
BEGIN
  SELECT pg_get_userbyid(database.datdba)
  INTO database_owner
  FROM pg_database database
  WHERE database.datname=current_database();
  IF session_user<>database_owner THEN
    RAISE EXCEPTION 'Transactional email reconciliation requires database owner'
      USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_provider_name<>'resend'
    OR p_provider_message_id IS NULL
    OR char_length(p_provider_message_id) NOT BETWEEN 1 AND 255
    OR p_provider_message_id ~ '[[:cntrl:]]'
    OR p_delivered_at IS NULL OR p_delivered_at>now()+interval '10 minutes'
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 500
    OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Transactional email reconciliation evidence is invalid';
  END IF;

  SELECT outbox.* INTO target
  FROM public.transactional_email_outbox outbox
  WHERE outbox.id=p_delivery_id
    AND outbox.delivery_status='UNCERTAIN'
    AND outbox.last_delivery_error='lease_expired'
    AND outbox.delivery_attempt_count>0
    AND p_delivered_at>=outbox.delivery_attempted_at-interval '5 minutes'
  FOR UPDATE;
  IF target.id IS NULL THEN RETURN false; END IF;

  PERFORM set_config('axora.change_reason',btrim(p_reason),true);
  PERFORM set_config('axora.reason_code','EMAIL_PROVIDER_DELIVERY_RECONCILIATION',true);
  PERFORM set_config('axora.result_code','DELIVERED',true);
  PERFORM set_config('axora.outcome','SUCCESS',true);
  PERFORM set_config('axora.correlation_id',target.correlation_id::text,true);
  PERFORM set_config('axora.system_identity','email-delivery-reconciliation',true);

  UPDATE public.transactional_email_outbox
  SET delivery_status='SENT',sent_at=p_delivered_at,
      provider_message_id=p_provider_message_id,last_delivery_error=NULL
  WHERE id=target.id AND delivery_status='UNCERTAIN'
    AND last_delivery_error='lease_expired';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RETURN false; END IF;

  PERFORM public.axora_record_transactional_email_attempt(
    target.id,target.message_kind,target.template_key,target.template_version,
    p_provider_name,target.provider_agent,target.delivery_attempt_count,
    'sent',p_provider_message_id,NULL,NULL,target.correlation_id
  );

  IF target.message_kind='CONTACT_NOTIFICATION'
    AND target.contact_submission_id IS NOT NULL THEN
    UPDATE public.public_contact_submissions
    SET notification_status='NOTIFIED',notified_at=p_delivered_at,
        notification_finalized_at=now()
    WHERE id=target.contact_submission_id
      AND notification_status='NOTIFICATION_UNCERTAIN';
  ELSIF target.message_kind='CONTACT_ACKNOWLEDGEMENT'
    AND target.contact_submission_id IS NOT NULL THEN
    UPDATE public.public_contact_submissions
    SET acknowledgement_status='SENT',acknowledged_at=p_delivered_at,
        acknowledgement_finalized_at=now()
    WHERE id=target.contact_submission_id
      AND acknowledgement_status='UNCERTAIN';
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.axora_reconcile_transactional_email_delivery(
  uuid,text,text,timestamptz,text
) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_reconcile_transactional_email_delivery(
      uuid,text,text,timestamptz,text
    ) FROM axora_app;
  END IF;
END $$;

COMMIT;
