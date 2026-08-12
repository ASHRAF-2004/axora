BEGIN;

-- Resend extends the provider-neutral queue and privacy-minimized lifecycle
-- evidence. No message content, subject, recipient address, or provider secret
-- is persisted by this migration.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.email_delivery_attempts'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%provider_name%'
  LOOP
    EXECUTE format('ALTER TABLE public.email_delivery_attempts DROP CONSTRAINT %I',constraint_name);
  END LOOP;
END $$;
ALTER TABLE public.email_delivery_attempts
  ADD CONSTRAINT email_delivery_attempts_provider_name_check CHECK (
    provider_name IN ('resend','zeptomail','cloudflare-email-service','test','unconfigured')
  );

ALTER TABLE public.email_provider_events
  DROP CONSTRAINT email_provider_events_provider_check,
  DROP CONSTRAINT email_provider_events_event_type_check;
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.email_provider_events'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.email_provider_events DROP CONSTRAINT %I',constraint_name);
  END LOOP;
END $$;
ALTER TABLE public.email_provider_events
  ADD CONSTRAINT email_provider_events_provider_check CHECK (
    provider IN ('CLOUDFLARE_EMAIL_SENDING','ZEPTOMAIL','RESEND')
  ),
  ADD CONSTRAINT email_provider_events_event_type_check CHECK (
    event_type IN (
      'MESSAGE_SUBMITTED','MESSAGE_DELIVERED','MESSAGE_DEFERRED',
      'MESSAGE_BOUNCED','MESSAGE_FAILED','MESSAGE_REJECTED',
      'MESSAGE_COMPLAINED','MESSAGE_SUPPRESSED'
    )
  ),
  ADD CONSTRAINT email_provider_events_lifecycle_shape_check CHECK (
    (event_type='MESSAGE_SUBMITTED' AND NOT terminal AND bounce_type IS NULL
      AND NOT suppresses_recipient)
    OR (event_type='MESSAGE_DELIVERED' AND terminal AND bounce_type IS NULL
      AND NOT suppresses_recipient)
    OR (event_type='MESSAGE_DEFERRED' AND NOT terminal AND bounce_type IS NULL
      AND NOT suppresses_recipient)
    OR (event_type='MESSAGE_BOUNCED' AND terminal
      AND bounce_type IN ('HARD','SOFT')
      AND suppresses_recipient=(bounce_type='HARD'))
    OR (event_type IN ('MESSAGE_FAILED','MESSAGE_REJECTED') AND terminal
      AND bounce_type IS NULL AND NOT suppresses_recipient)
    OR (event_type IN ('MESSAGE_COMPLAINED','MESSAGE_SUPPRESSED') AND terminal
      AND bounce_type IS NULL AND suppresses_recipient)
  );

ALTER TABLE public.email_recipient_suppressions
  ADD COLUMN provider_suppression_count integer NOT NULL DEFAULT 0
    CHECK (provider_suppression_count>=0);
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.email_recipient_suppressions'::regclass AND contype='c'
      AND (pg_get_constraintdef(oid) LIKE '%event_count%'
        OR pg_get_constraintdef(oid) LIKE '%hard_bounce_count > 0%')
  LOOP
    EXECUTE format('ALTER TABLE public.email_recipient_suppressions DROP CONSTRAINT %I',constraint_name);
  END LOOP;
END $$;
ALTER TABLE public.email_recipient_suppressions
  ADD CONSTRAINT email_recipient_suppressions_event_count_check CHECK (
    event_count>0 AND event_count=hard_bounce_count+complaint_count
      +provider_suppression_count
  ),
  ADD CONSTRAINT email_recipient_suppressions_reason_check CHECK (
    hard_bounce_count>0 OR complaint_count>0 OR provider_suppression_count>0
  );

CREATE OR REPLACE FUNCTION public.axora_record_email_provider_event(
  p_provider text,p_provider_event_id uuid,p_event_type text,
  p_recipient_fingerprint text,p_provider_message_fingerprint text,
  p_bounce_type text,p_terminal boolean,p_event_occurred_at timestamptz,
  p_event_schema_version integer DEFAULT 1
) RETURNS TABLE(recorded boolean,suppressed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  should_suppress boolean;
  inserted_count integer;
  existing_event public.email_provider_events%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('CLOUDFLARE_EMAIL_SENDING','ZEPTOMAIL','RESEND')
    OR p_provider_event_id IS NULL
    OR p_event_type NOT IN (
      'MESSAGE_SUBMITTED','MESSAGE_DELIVERED','MESSAGE_DEFERRED',
      'MESSAGE_BOUNCED','MESSAGE_FAILED','MESSAGE_REJECTED',
      'MESSAGE_COMPLAINED','MESSAGE_SUPPRESSED'
    )
    OR p_recipient_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_provider_message_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_terminal IS NULL OR p_event_occurred_at IS NULL
    OR p_event_occurred_at>now()+interval '10 minutes'
    OR p_event_schema_version<>1
    OR NOT COALESCE(
      (p_event_type='MESSAGE_SUBMITTED' AND NOT p_terminal AND p_bounce_type IS NULL)
      OR (p_event_type='MESSAGE_DELIVERED' AND p_terminal AND p_bounce_type IS NULL)
      OR (p_event_type='MESSAGE_DEFERRED' AND NOT p_terminal AND p_bounce_type IS NULL)
      OR (p_event_type='MESSAGE_BOUNCED' AND p_terminal
        AND p_bounce_type IN ('HARD','SOFT'))
      OR (p_event_type IN (
        'MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED','MESSAGE_SUPPRESSED'
      ) AND p_terminal AND p_bounce_type IS NULL),false
    ) THEN
    RAISE EXCEPTION 'Email provider lifecycle event is invalid';
  END IF;

  should_suppress:=p_event_type IN ('MESSAGE_COMPLAINED','MESSAGE_SUPPRESSED')
    OR (p_event_type='MESSAGE_BOUNCED' AND p_bounce_type='HARD');
  INSERT INTO public.email_provider_events(
    provider_event_id,provider,event_type,recipient_fingerprint,
    provider_message_fingerprint,bounce_type,terminal,suppresses_recipient,
    event_schema_version,event_occurred_at
  ) VALUES (
    p_provider_event_id,p_provider,p_event_type,p_recipient_fingerprint,
    p_provider_message_fingerprint,p_bounce_type,p_terminal,should_suppress,
    p_event_schema_version,p_event_occurred_at
  ) ON CONFLICT(provider_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;

  IF inserted_count=0 THEN
    SELECT * INTO existing_event FROM public.email_provider_events
    WHERE provider_event_id=p_provider_event_id;
    IF existing_event.provider IS DISTINCT FROM p_provider
      OR existing_event.event_type IS DISTINCT FROM p_event_type
      OR existing_event.recipient_fingerprint IS DISTINCT FROM p_recipient_fingerprint
      OR existing_event.provider_message_fingerprint IS DISTINCT FROM p_provider_message_fingerprint
      OR existing_event.bounce_type IS DISTINCT FROM p_bounce_type
      OR existing_event.terminal IS DISTINCT FROM p_terminal
      OR existing_event.suppresses_recipient IS DISTINCT FROM should_suppress
      OR existing_event.event_schema_version IS DISTINCT FROM p_event_schema_version
      OR existing_event.event_occurred_at IS DISTINCT FROM p_event_occurred_at THEN
      RAISE EXCEPTION 'Email provider event identifier conflict';
    END IF;
    RETURN QUERY SELECT false,existing_event.suppresses_recipient;
    RETURN;
  END IF;

  IF should_suppress THEN
    INSERT INTO public.email_recipient_suppressions(
      recipient_fingerprint,first_provider_event_id,most_recent_provider_event_id,
      first_suppressed_at,most_recent_suppressed_at,
      hard_bounce_count,complaint_count,provider_suppression_count,event_count
    ) VALUES (
      p_recipient_fingerprint,p_provider_event_id,p_provider_event_id,
      p_event_occurred_at,p_event_occurred_at,
      CASE WHEN p_event_type='MESSAGE_BOUNCED' THEN 1 ELSE 0 END,
      CASE WHEN p_event_type='MESSAGE_COMPLAINED' THEN 1 ELSE 0 END,
      CASE WHEN p_event_type='MESSAGE_SUPPRESSED' THEN 1 ELSE 0 END,1
    ) ON CONFLICT(recipient_fingerprint) DO UPDATE SET
      first_provider_event_id=CASE
        WHEN EXCLUDED.first_suppressed_at<email_recipient_suppressions.first_suppressed_at
          THEN EXCLUDED.first_provider_event_id
        ELSE email_recipient_suppressions.first_provider_event_id END,
      first_suppressed_at=LEAST(email_recipient_suppressions.first_suppressed_at,
        EXCLUDED.first_suppressed_at),
      most_recent_provider_event_id=CASE
        WHEN EXCLUDED.most_recent_suppressed_at>=email_recipient_suppressions.most_recent_suppressed_at
          THEN EXCLUDED.most_recent_provider_event_id
        ELSE email_recipient_suppressions.most_recent_provider_event_id END,
      most_recent_suppressed_at=GREATEST(
        email_recipient_suppressions.most_recent_suppressed_at,
        EXCLUDED.most_recent_suppressed_at),
      hard_bounce_count=email_recipient_suppressions.hard_bounce_count
        +EXCLUDED.hard_bounce_count,
      complaint_count=email_recipient_suppressions.complaint_count
        +EXCLUDED.complaint_count,
      provider_suppression_count=email_recipient_suppressions.provider_suppression_count
        +EXCLUDED.provider_suppression_count,
      event_count=email_recipient_suppressions.event_count+1;

    UPDATE public.account_setup_invitations invitation
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
    FROM public.users account
    WHERE invitation.delivery_status='PENDING' AND account.id=invitation.user_id
      AND public.axora_email_recipient_fingerprint(account.email)=p_recipient_fingerprint;

    UPDATE public.transactional_email_outbox outbox
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed',
        token_ciphertext=NULL,token_nonce=NULL,token_authentication_tag=NULL
    WHERE outbox.delivery_status='PENDING' AND (
      EXISTS (
        SELECT 1 FROM public.public_contact_submissions submission
        WHERE submission.id=outbox.contact_submission_id
          AND outbox.message_kind='CONTACT_ACKNOWLEDGEMENT'
          AND public.axora_email_recipient_fingerprint(submission.contact_email)
            =p_recipient_fingerprint
      ) OR EXISTS (
        SELECT 1 FROM public.password_reset_tokens reset
        JOIN public.users account ON account.id=reset.user_id
        WHERE reset.id=outbox.password_reset_token_id
          AND public.axora_email_recipient_fingerprint(account.email)
            =p_recipient_fingerprint
      ) OR EXISTS (
        SELECT 1 FROM public.email_verification_tokens verification
        WHERE verification.id=outbox.email_verification_token_id
          AND public.axora_email_recipient_fingerprint(verification.email)
            =p_recipient_fingerprint
      )
    );

    UPDATE public.workflow_email_outbox outbox
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
    FROM public.users account
    WHERE outbox.delivery_status='PENDING' AND account.id=outbox.recipient_user_id
      AND public.axora_email_recipient_fingerprint(account.email)=p_recipient_fingerprint;
  END IF;
  RETURN QUERY SELECT true,should_suppress;
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_resend_email_event(
  p_provider_event_id uuid,p_event_type text,p_recipient_fingerprint text,
  p_provider_message_fingerprint text,p_bounce_type text,p_terminal boolean,
  p_event_occurred_at timestamptz,p_event_schema_version integer DEFAULT 1
) RETURNS TABLE(recorded boolean,suppressed boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT * FROM public.axora_record_email_provider_event(
    'RESEND',p_provider_event_id,p_event_type,p_recipient_fingerprint,
    p_provider_message_fingerprint,p_bounce_type,p_terminal,
    p_event_occurred_at,p_event_schema_version
  )
$$;

ALTER TABLE public.email_provider_health_snapshots
  DROP CONSTRAINT email_provider_health_snapshots_provider_name_check,
  ADD CONSTRAINT email_provider_health_snapshots_provider_name_check CHECK (
    provider_name IN ('resend','zeptomail','cloudflare-email-service','test','unconfigured')
  );
ALTER TABLE public.email_webhook_health_hourly
  DROP CONSTRAINT email_webhook_health_hourly_provider_name_check,
  ADD CONSTRAINT email_webhook_health_hourly_provider_name_check CHECK (
    provider_name IN ('resend','zeptomail','cloudflare-email-service')
  );

CREATE OR REPLACE FUNCTION public.axora_record_email_webhook_failure(
  p_provider_name text,p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE provider_value text:=lower(COALESCE(p_provider_name,''));
  error_value text:=lower(COALESCE(p_error_code,''));
  period_value timestamptz:=date_trunc('hour',now());
BEGIN
  IF provider_value NOT IN ('resend','zeptomail','cloudflare-email-service')
    OR error_value !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'Email webhook health event is invalid';
  END IF;
  INSERT INTO public.email_webhook_health_hourly(
    provider_name,period_start,rejected_count,processing_failure_count,
    last_error_code,last_event_at
  ) VALUES (
    provider_value,period_value,
    CASE WHEN error_value='invalid_payload' THEN 1 ELSE 0 END,
    CASE WHEN error_value='invalid_payload' THEN 0 ELSE 1 END,
    error_value,now()
  ) ON CONFLICT(provider_name,period_start) DO UPDATE SET
    rejected_count=email_webhook_health_hourly.rejected_count+EXCLUDED.rejected_count,
    processing_failure_count=email_webhook_health_hourly.processing_failure_count
      +EXCLUDED.processing_failure_count,
    last_error_code=EXCLUDED.last_error_code,
    last_event_at=GREATEST(email_webhook_health_hourly.last_event_at,EXCLUDED.last_event_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_email_webhook_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE provider_value text:=CASE NEW.provider
  WHEN 'RESEND' THEN 'resend'
  WHEN 'ZEPTOMAIL' THEN 'zeptomail'
  ELSE 'cloudflare-email-service' END;
  period_value timestamptz:=date_trunc('hour',NEW.received_at);
BEGIN
  INSERT INTO public.email_webhook_health_hourly(
    provider_name,period_start,accepted_count,last_event_at
  ) VALUES (provider_value,period_value,1,NEW.received_at)
  ON CONFLICT(provider_name,period_start) DO UPDATE SET
    accepted_count=email_webhook_health_hourly.accepted_count+1,
    last_event_at=GREATEST(email_webhook_health_hourly.last_event_at,EXCLUDED.last_event_at);
  RETURN NEW;
END $$;

-- Extend provider allowlists in the two existing guarded command functions
-- without duplicating their authorization and audit implementations.
DO $$
DECLARE function_oid oid; definition text; updated text;
BEGIN
  FOREACH function_oid IN ARRAY ARRAY[
    'public.axora_complete_workflow_email_v2(uuid,uuid,text,text,text,integer,text,text,integer)'::regprocedure::oid,
    'public.axora_email_operations_command(uuid,text,text,uuid,text,text,jsonb)'::regprocedure::oid
  ] LOOP
    SELECT pg_get_functiondef(function_oid) INTO definition;
    updated:=regexp_replace(
      definition,
      '''zeptomail''\s*,\s*''cloudflare-email-service''\s*,\s*''test''\s*,\s*''unconfigured''',
      '''resend'',''zeptomail'',''cloudflare-email-service'',''test'',''unconfigured''',
      'g'
    );
    IF updated=definition THEN
      RAISE EXCEPTION 'Resend provider allowlist target was not found';
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.axora_record_resend_email_event(
  uuid,text,text,text,text,boolean,timestamptz,integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_record_email_provider_event(
  text,uuid,text,text,text,text,boolean,timestamptz,integer
) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_record_resend_email_event(
      uuid,text,text,text,text,boolean,timestamptz,integer
    ) TO axora_app;
    REVOKE ALL ON FUNCTION public.axora_record_email_provider_event(
      text,uuid,text,text,text,text,boolean,timestamptz,integer
    ) FROM axora_app;
  END IF;
END $$;

COMMIT;
