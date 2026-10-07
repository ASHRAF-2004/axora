BEGIN;

-- The app's transactional worker previously called invoice helpers which the
-- deployment grants deliberately keep private. Expose only queue eligibility
-- and a live-lease-bound payload under the non-user worker transaction context.
-- Keep the original unrestricted payload helper owner-only.
-- The retry delay routine is an immutable, table-free schedule calculation;
-- the runtime completion UPDATE also needs its exact EXECUTE grant.
CREATE OR REPLACE FUNCTION public.axora_transactional_invoice_email_state(
  p_outbox_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('axora.system_identity',true),'')
      <>'transactional-email-worker'
    OR COALESCE(current_setting('axora.user_id',true),'')<>''
    OR COALESCE(current_setting('axora.role_assignment_id',true),'')<>'' THEN
    RAISE EXCEPTION 'Transactional email worker context required'
      USING ERRCODE='insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactional_email_outbox outbox
    WHERE outbox.id=p_outbox_id
      AND outbox.message_kind='INVOICE_FINALIZED'
      AND outbox.delivery_status IN ('PENDING','SENDING')
  ) THEN
    RETURN jsonb_build_object('ready',false,'suppressed',false);
  END IF;
  RETURN jsonb_build_object(
    'ready',public.axora_invoice_email_ready(p_outbox_id),
    'suppressed',public.axora_invoice_email_recipient_suppressed(p_outbox_id)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_claimed_invoice_email_payload(
  p_outbox_id uuid,p_lease_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('axora.system_identity',true),'')
      <>'transactional-email-worker'
    OR COALESCE(current_setting('axora.user_id',true),'')<>''
    OR COALESCE(current_setting('axora.role_assignment_id',true),'')<>'' THEN
    RAISE EXCEPTION 'Transactional email worker context required'
      USING ERRCODE='insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactional_email_outbox outbox
    WHERE outbox.id=p_outbox_id
      AND outbox.message_kind='INVOICE_FINALIZED'
      AND outbox.delivery_status='SENDING'
      AND outbox.delivery_lease_id=p_lease_id
      AND outbox.delivery_lease_expires_at>now()
  ) THEN RETURN NULL; END IF;
  RETURN public.axora_invoice_email_payload(p_outbox_id);
END $$;

REVOKE ALL ON FUNCTION
  public.axora_transactional_invoice_email_state(uuid),
  public.axora_claimed_invoice_email_payload(uuid,uuid),
  public.axora_email_retry_delay(integer)
FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.axora_transactional_invoice_email_state(uuid),
      public.axora_claimed_invoice_email_payload(uuid,uuid),
      public.axora_email_retry_delay(integer)
    TO axora_app;
  END IF;
END $$;

COMMIT;
