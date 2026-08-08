BEGIN;

-- P0-09 extends the existing durable queues instead of replacing them. Seven
-- total submission attempts consume the six approved retry delays after the
-- initial attempt: 1m, 5m, 15m, 1h, 4h and 12h.
ALTER TABLE public.transactional_email_outbox
  DROP CONSTRAINT transactional_email_outbox_delivery_attempt_count_check,
  ADD CONSTRAINT transactional_email_outbox_delivery_attempt_count_check
    CHECK (delivery_attempt_count BETWEEN 0 AND 7);
ALTER TABLE public.workflow_email_outbox
  DROP CONSTRAINT workflow_email_outbox_delivery_attempt_count_check,
  ADD CONSTRAINT workflow_email_outbox_delivery_attempt_count_check
    CHECK (delivery_attempt_count BETWEEN 0 AND 7);

CREATE OR REPLACE FUNCTION public.axora_email_retry_delay(p_attempt integer)
RETURNS interval
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_attempt
    WHEN 1 THEN interval '1 minute'
    WHEN 2 THEN interval '5 minutes'
    WHEN 3 THEN interval '15 minutes'
    WHEN 4 THEN interval '1 hour'
    WHEN 5 THEN interval '4 hours'
    ELSE interval '12 hours'
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_email_template_key(p_event_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_event_key
    WHEN 'invitation.sent' THEN 'internal-user-invitation'
    WHEN 'invitation.accepted' THEN 'account-activated'
    WHEN 'company.lead.submitted' THEN 'company-lead-acknowledgement'
    WHEN 'company.lead.created' THEN 'new-lead-internal-alert'
    WHEN 'company.lead.assigned' THEN 'lead-assigned'
    WHEN 'company.lead.reassigned' THEN 'lead-reassigned'
    WHEN 'company.information_requested' THEN 'company-information-requested'
    WHEN 'company.activated' THEN 'company-activated'
    WHEN 'company.suspended' THEN 'company-suspended'
    WHEN 'request.submitted' THEN 'request-submitted'
    WHEN 'approval.department_required' THEN 'department-approval-required'
    WHEN 'approval.company_required' THEN 'company-approval-required'
    WHEN 'approval.axora_required' THEN 'axora-approval-required'
    WHEN 'approval.additional_actual_required' THEN 'additional-actual-approval-required'
    WHEN 'approval.needed' THEN 'company-approval-required'
    WHEN 'request.approved' THEN 'request-approved'
    WHEN 'request.rejected' THEN 'request-rejected'
    WHEN 'request.returned' THEN 'request-returned-for-changes'
    WHEN 'request.cancelled' THEN 'request-cancelled'
    WHEN 'budget.low' THEN 'budget-low'
    WHEN 'budget.zero' THEN 'budget-zero'
    WHEN 'budget.refreshed' THEN 'budget-refreshed'
    WHEN 'budget.refresh_failed' THEN 'budget-refresh-failed'
    WHEN 'delivery.assignment_created' THEN 'delivery-assignment-created'
    WHEN 'delivery.accepted' THEN 'delivery-agent-accepted'
    WHEN 'preparation.started' THEN 'shopping-started'
    WHEN 'supplier.order_acknowledged' THEN 'items-acquired'
    WHEN 'approval.substitute_required' THEN 'substitute-approval-required'
    WHEN 'delivery.out_for_delivery' THEN 'out-for-delivery'
    WHEN 'delivery.arrived' THEN 'delivery-arrived'
    WHEN 'delivery.failed' THEN 'failed-delivery-rescheduled'
    WHEN 'delivery.completed' THEN 'delivery-completed'
    WHEN 'document.approved_request_pdf' THEN 'approved-request-pdf-available'
    WHEN 'document.final_delivery_pdf' THEN 'final-delivery-pdf-available'
    WHEN 'document.supplier_po_ready' THEN 'supplier-purchase-order-ready'
    ELSE 'workflow-update'
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_email_provider_agent(p_event_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN p_event_key LIKE 'invitation.%'
      OR p_event_key LIKE 'account.%'
      OR p_event_key LIKE 'security.%' THEN 'axora-auth'
    WHEN p_event_key LIKE 'request.%'
      OR p_event_key LIKE 'approval.%' THEN 'axora-procurement'
    WHEN p_event_key LIKE 'budget.%' THEN 'axora-budget'
    WHEN p_event_key LIKE 'delivery.%'
      OR p_event_key LIKE 'preparation.%' THEN 'axora-delivery'
    WHEN p_event_key LIKE 'document.%' THEN 'axora-documents'
    ELSE 'axora-platform'
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_email_priority(p_event_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN p_event_key LIKE 'invitation.%'
      OR p_event_key LIKE 'account.%'
      OR p_event_key LIKE 'security.%' THEN 'URGENT'
    WHEN p_event_key LIKE 'approval.%' THEN 'URGENT'
    WHEN p_event_key IN ('budget.zero','budget.refresh_failed') THEN 'URGENT'
    WHEN p_event_key LIKE 'request.%' OR p_event_key LIKE 'budget.%' THEN 'HIGH'
    WHEN p_event_key LIKE 'delivery.%' OR p_event_key LIKE 'document.%' THEN 'NORMAL'
    ELSE 'LOW'
  END
$$;

ALTER TABLE public.transactional_email_outbox
  ADD COLUMN template_key text,
  ADD COLUMN template_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN priority text,
  ADD COLUMN provider_agent text,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE public.transactional_email_outbox
SET template_key=CASE message_kind
      WHEN 'CONTACT_NOTIFICATION' THEN 'new-lead-internal-alert'
      WHEN 'CONTACT_ACKNOWLEDGEMENT' THEN 'company-lead-acknowledgement'
      WHEN 'PASSWORD_RESET' THEN 'password-reset'
      WHEN 'PASSWORD_CHANGED' THEN 'password-changed'
      WHEN 'EMAIL_VERIFICATION' THEN 'email-verification'
      ELSE 'workflow-update' END,
    priority=CASE WHEN message_kind IN (
      'PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION'
    ) THEN 'URGENT' ELSE 'NORMAL' END,
    provider_agent=CASE WHEN message_kind IN (
      'PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION'
    ) THEN 'axora-auth' ELSE 'axora-platform' END;

ALTER TABLE public.transactional_email_outbox
  ALTER COLUMN template_key SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN provider_agent SET NOT NULL,
  ADD CONSTRAINT transactional_email_template_key_check CHECK (
    template_key ~ '^[a-z][a-z0-9-]{1,119}$'
  ),
  ADD CONSTRAINT transactional_email_template_version_check CHECK (
    template_version BETWEEN 1 AND 32767
  ),
  ADD CONSTRAINT transactional_email_priority_check CHECK (
    priority IN ('LOW','NORMAL','HIGH','URGENT')
  ),
  ADD CONSTRAINT transactional_email_provider_agent_check CHECK (
    provider_agent IN (
      'axora-auth','axora-procurement','axora-budget','axora-delivery',
      'axora-documents','axora-platform'
    )
  );

CREATE OR REPLACE FUNCTION public.axora_set_transactional_email_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.template_key:=CASE NEW.message_kind
    WHEN 'CONTACT_NOTIFICATION' THEN 'new-lead-internal-alert'
    WHEN 'CONTACT_ACKNOWLEDGEMENT' THEN 'company-lead-acknowledgement'
    WHEN 'PASSWORD_RESET' THEN 'password-reset'
    WHEN 'PASSWORD_CHANGED' THEN 'password-changed'
    WHEN 'EMAIL_VERIFICATION' THEN 'email-verification'
    ELSE 'workflow-update' END;
  NEW.priority:=CASE WHEN NEW.message_kind IN (
    'PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION'
  ) THEN 'URGENT' ELSE 'NORMAL' END;
  NEW.provider_agent:=CASE WHEN NEW.message_kind IN (
    'PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION'
  ) THEN 'axora-auth' ELSE 'axora-platform' END;
  RETURN NEW;
END $$;

CREATE TRIGGER set_transactional_email_metadata
BEFORE INSERT ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_set_transactional_email_metadata();

CREATE OR REPLACE FUNCTION public.axora_protect_transactional_email_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.provider_agent IS DISTINCT FROM OLD.provider_agent
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'Transactional email routing metadata is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_transactional_email_metadata
BEFORE UPDATE ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_transactional_email_metadata();

ALTER TABLE public.workflow_email_outbox
  ADD COLUMN template_key text,
  ADD COLUMN template_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN priority text,
  ADD COLUMN provider_agent text,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE public.workflow_email_outbox
SET template_key=public.axora_email_template_key(event_key),
    priority=public.axora_email_priority(event_key),
    provider_agent=public.axora_email_provider_agent(event_key);

ALTER TABLE public.workflow_email_outbox
  ALTER COLUMN template_key SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN provider_agent SET NOT NULL,
  ADD CONSTRAINT workflow_email_template_key_check CHECK (
    template_key ~ '^[a-z][a-z0-9-]{1,119}$'
  ),
  ADD CONSTRAINT workflow_email_template_version_check CHECK (
    template_version BETWEEN 1 AND 32767
  ),
  ADD CONSTRAINT workflow_email_priority_check CHECK (
    priority IN ('LOW','NORMAL','HIGH','URGENT')
  ),
  ADD CONSTRAINT workflow_email_provider_agent_check CHECK (
    provider_agent IN (
      'axora-auth','axora-procurement','axora-budget','axora-delivery',
      'axora-documents','axora-platform'
    )
  );

CREATE OR REPLACE FUNCTION public.axora_set_workflow_email_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.template_key:=public.axora_email_template_key(NEW.event_key);
  NEW.priority:=public.axora_email_priority(NEW.event_key);
  NEW.provider_agent:=public.axora_email_provider_agent(NEW.event_key);
  RETURN NEW;
END $$;

CREATE TRIGGER set_workflow_email_metadata
BEFORE INSERT ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_set_workflow_email_metadata();

CREATE OR REPLACE FUNCTION public.axora_protect_workflow_email_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.provider_agent IS DISTINCT FROM OLD.provider_agent
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'Workflow email routing metadata is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_workflow_email_metadata
BEFORE UPDATE ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_workflow_email_metadata();

CREATE TABLE public.email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_kind text NOT NULL CHECK (
    delivery_kind IN ('ACCOUNT_SETUP','TRANSACTIONAL','WORKFLOW')
  ),
  delivery_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    char_length(event_type) BETWEEN 2 AND 120
    AND event_type ~ '^[A-Za-z][A-Za-z0-9_.-]*$'
  ),
  template_key text NOT NULL CHECK (
    template_key ~ '^[a-z][a-z0-9-]{1,119}$'
  ),
  template_version smallint NOT NULL CHECK (template_version>0),
  provider_name text NOT NULL CHECK (
    provider_name IN ('zeptomail','cloudflare-email-service','test','unconfigured')
  ),
  provider_agent text NOT NULL CHECK (
    provider_agent IN (
      'axora-auth','axora-procurement','axora-budget','axora-delivery',
      'axora-documents','axora-platform'
    )
  ),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 7),
  outcome text NOT NULL CHECK (
    outcome IN ('sent','retry','failed','paused','disabled','uncertain')
  ),
  provider_message_fingerprint text CHECK (
    provider_message_fingerprint IS NULL
    OR provider_message_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  error_code text CHECK (
    error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  http_status smallint CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  correlation_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(delivery_kind,delivery_id,attempt_number)
);

CREATE INDEX email_delivery_attempts_operations_idx
  ON public.email_delivery_attempts(attempted_at DESC,provider_name,provider_agent);
CREATE INDEX email_delivery_attempts_company_idx
  ON public.email_delivery_attempts(company_id,attempted_at DESC)
  WHERE company_id IS NOT NULL;

CREATE TRIGGER email_delivery_attempts_are_append_only
BEFORE UPDATE OR DELETE ON public.email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE VIEW public.email_delivery_usage_daily
WITH (security_barrier=true)
AS
SELECT date_trunc('day',attempted_at) AS usage_day,
  provider_name,provider_agent,template_key,template_version,company_id,event_type,
  count(*) FILTER (WHERE outcome='sent')::bigint AS submitted_recipient_units,
  count(*)::bigint AS submission_attempts,
  count(*) FILTER (WHERE outcome='retry')::bigint AS retryable_attempts,
  count(*) FILTER (WHERE outcome='paused')::bigint AS operations_paused_attempts,
  count(*) FILTER (WHERE outcome='failed')::bigint AS permanent_failures,
  count(*) FILTER (WHERE outcome='uncertain')::bigint AS uncertain_attempts
FROM public.email_delivery_attempts
GROUP BY date_trunc('day',attempted_at),provider_name,provider_agent,
  template_key,template_version,company_id,event_type;

CREATE OR REPLACE FUNCTION public.axora_claim_workflow_email_v2(
  p_lease_seconds integer DEFAULT 90,
  p_max_attempts integer DEFAULT 7
) RETURNS TABLE(
  delivery_id uuid,
  lease_id uuid,
  locale text,
  recipient_email text,
  recipient_name text,
  title text,
  body text,
  route_path text,
  event_key text,
  template_key text,
  template_version smallint,
  priority text,
  provider_agent text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  selected_row record;
  selected_lease uuid;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300
    OR p_max_attempts < 1 OR p_max_attempts > 7 THEN
    RAISE EXCEPTION 'Workflow email lease configuration is invalid';
  END IF;

  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='recipient_unavailable'
  WHERE outbox.delivery_status='PENDING'
    AND NOT public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    );

  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='CANCELLED',last_delivery_error='email_preference_disabled'
  WHERE outbox.delivery_status='PENDING'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles profile
      WHERE profile.user_id=outbox.recipient_user_id
        AND (
          NOT profile.notification_email_enabled
          OR EXISTS (
            SELECT 1 FROM public.notification_preferences preference
            WHERE preference.user_id=profile.user_id
              AND preference.event_key=outbox.event_key
              AND NOT preference.email_enabled
          )
        )
    );

  UPDATE public.workflow_email_outbox outbox
  SET delivery_available_at=GREATEST(outbox.delivery_available_at,preference.muted_until)
  FROM public.notification_preferences preference
  WHERE outbox.delivery_status='PENDING'
    AND preference.user_id=outbox.recipient_user_id
    AND preference.event_key=outbox.event_key
    AND preference.muted_until>now();

  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='UNCERTAIN',delivery_lease_id=NULL,
      delivery_lease_expires_at=NULL,last_delivery_error='lease_expired'
  WHERE outbox.delivery_status='SENDING'
    AND outbox.delivery_lease_expires_at<=now();

  SELECT outbox.id,outbox.locale,lower(account.email) AS email,
    profile.display_name,outbox.title,outbox.body,outbox.route_path,
    outbox.event_key,outbox.template_key,outbox.template_version,
    outbox.priority,outbox.provider_agent
  INTO selected_row
  FROM public.workflow_email_outbox outbox
  JOIN public.users account ON account.id=outbox.recipient_user_id
  JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN public.notification_preferences preference
    ON preference.user_id=account.id AND preference.event_key=outbox.event_key
  WHERE outbox.delivery_status='PENDING'
    AND outbox.delivery_attempt_count<p_max_attempts
    AND outbox.delivery_available_at<=now()
    AND profile.notification_email_enabled
    AND COALESCE(preference.email_enabled,true)
    AND (preference.muted_until IS NULL OR preference.muted_until<=now())
    AND public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    )
  ORDER BY CASE outbox.priority
      WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
    outbox.delivery_available_at,outbox.created_at,outbox.id
  FOR UPDATE OF outbox SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;
  selected_lease:=gen_random_uuid();
  UPDATE public.workflow_email_outbox outbox
  SET delivery_status='SENDING',delivery_attempt_count=delivery_attempt_count+1,
      delivery_attempted_at=now(),delivery_lease_id=selected_lease,
      delivery_lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
      last_delivery_error=NULL
  WHERE outbox.id=selected_row.id AND outbox.delivery_status='PENDING';
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT selected_row.id::uuid,selected_lease,
    selected_row.locale::text,selected_row.email::text,
    selected_row.display_name::text,selected_row.title::text,
    selected_row.body::text,selected_row.route_path::text,
    selected_row.event_key::text,selected_row.template_key::text,
    selected_row.template_version::smallint,selected_row.priority::text,
    selected_row.provider_agent::text;
END $$;

CREATE OR REPLACE FUNCTION public.axora_complete_workflow_email_v2(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_max_attempts integer DEFAULT 7,
  p_provider_name text DEFAULT NULL,
  p_provider_agent text DEFAULT NULL,
  p_http_status integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  completed record;
  normalized_provider text:=COALESCE(p_provider_name,'unconfigured');
BEGIN
  IF p_outcome NOT IN ('sent','retry','failed','paused','disabled','uncertain')
    OR p_max_attempts < 1 OR p_max_attempts > 7
    OR normalized_provider NOT IN (
      'zeptomail','cloudflare-email-service','test','unconfigured'
    )
    OR (p_provider_message_id IS NOT NULL AND (
      char_length(p_provider_message_id) NOT BETWEEN 1 AND 255
      OR p_provider_message_id ~ '[[:cntrl:]]'
    ))
    OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{1,64}$')
    OR (p_outcome='sent' AND p_error_code IS NOT NULL)
    OR (p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599) THEN
    RAISE EXCEPTION 'Workflow email completion is invalid';
  END IF;

  UPDATE public.workflow_email_outbox outbox
  SET delivery_status=CASE
        WHEN p_outcome='sent' THEN 'SENT'
        WHEN p_outcome='paused' THEN 'PENDING'
        WHEN p_outcome='disabled' THEN 'DISABLED'
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count<p_max_attempts
          THEN 'PENDING'
        WHEN p_outcome='uncertain' THEN 'UNCERTAIN'
        ELSE 'FAILED' END,
      delivery_available_at=CASE
        WHEN p_outcome='paused' THEN 'infinity'::timestamptz
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count<p_max_attempts
          THEN now()+public.axora_email_retry_delay(outbox.delivery_attempt_count)
        ELSE outbox.delivery_available_at END,
      sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE NULL END,
      provider_message_id=CASE WHEN p_outcome='sent'
        THEN p_provider_message_id ELSE NULL END,
      last_delivery_error=CASE
        WHEN p_outcome='sent' THEN NULL
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count>=p_max_attempts
          THEN 'retry_exhausted'
        WHEN p_outcome='paused' THEN COALESCE(p_error_code,'provider_paused')
        WHEN p_outcome='disabled' THEN COALESCE(p_error_code,'delivery_disabled')
        WHEN p_outcome='uncertain' THEN COALESCE(p_error_code,'delivery_uncertain')
        ELSE COALESCE(p_error_code,'delivery_failed') END,
      delivery_lease_id=NULL,delivery_lease_expires_at=NULL
  WHERE outbox.id=p_delivery_id
    AND outbox.delivery_status='SENDING'
    AND outbox.delivery_lease_id=p_lease_id
    AND (p_provider_agent IS NULL OR outbox.provider_agent=p_provider_agent)
  RETURNING outbox.id,outbox.company_id,outbox.event_key,outbox.template_key,
    outbox.template_version,outbox.provider_agent,outbox.delivery_attempt_count,
    outbox.correlation_id INTO completed;

  IF completed.id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.email_delivery_attempts(
    delivery_kind,delivery_id,company_id,event_type,template_key,template_version,
    provider_name,provider_agent,attempt_number,outcome,
    provider_message_fingerprint,error_code,http_status,correlation_id
  ) VALUES (
    'WORKFLOW',completed.id,completed.company_id,completed.event_key,
    completed.template_key,completed.template_version,normalized_provider,
    completed.provider_agent,completed.delivery_attempt_count,
    CASE WHEN p_outcome='retry' AND completed.delivery_attempt_count>=p_max_attempts
      THEN 'failed' ELSE p_outcome END,
    CASE WHEN p_provider_message_id IS NULL THEN NULL
      ELSE encode(sha256(convert_to(p_provider_message_id,'UTF8')),'hex') END,
    p_error_code,p_http_status,completed.correlation_id
  ) ON CONFLICT(delivery_kind,delivery_id,attempt_number) DO NOTHING;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_complete_workflow_email(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_max_attempts integer DEFAULT 7,
  p_retry_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.axora_complete_workflow_email_v2(
    p_delivery_id,p_lease_id,p_outcome,p_provider_message_id,p_error_code,
    p_max_attempts,NULL,NULL,NULL
  )
$$;

-- Provider events share one privacy-minimized lifecycle recorder. The public
-- wrappers pin the provider so application callers cannot forge identities.
ALTER TABLE public.email_provider_events
  DROP CONSTRAINT email_provider_events_provider_check,
  ADD CONSTRAINT email_provider_events_provider_check CHECK (
    provider IN ('CLOUDFLARE_EMAIL_SENDING','ZEPTOMAIL')
  );

CREATE OR REPLACE FUNCTION public.axora_record_email_provider_event(
  p_provider text,
  p_provider_event_id uuid,
  p_event_type text,
  p_recipient_fingerprint text,
  p_provider_message_fingerprint text,
  p_bounce_type text,
  p_terminal boolean,
  p_event_occurred_at timestamptz,
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
  IF p_provider NOT IN ('CLOUDFLARE_EMAIL_SENDING','ZEPTOMAIL')
    OR p_provider_event_id IS NULL
    OR p_event_type NOT IN (
      'MESSAGE_DELIVERED','MESSAGE_DEFERRED','MESSAGE_BOUNCED',
      'MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED'
    )
    OR p_recipient_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_provider_message_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_terminal IS NULL OR p_event_occurred_at IS NULL
    OR p_event_occurred_at>now()+interval '10 minutes'
    OR p_event_schema_version<>1
    OR NOT COALESCE(
      (p_event_type='MESSAGE_DELIVERED' AND p_terminal AND p_bounce_type IS NULL)
      OR (p_event_type='MESSAGE_DEFERRED' AND NOT p_terminal AND p_bounce_type IS NULL)
      OR (p_event_type='MESSAGE_BOUNCED' AND p_terminal
        AND p_bounce_type IN ('HARD','SOFT'))
      OR (p_event_type IN ('MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED')
        AND p_terminal AND p_bounce_type IS NULL),false
    ) THEN
    RAISE EXCEPTION 'Email provider lifecycle event is invalid';
  END IF;

  should_suppress:=p_event_type='MESSAGE_COMPLAINED'
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
      hard_bounce_count,complaint_count,event_count
    ) VALUES (
      p_recipient_fingerprint,p_provider_event_id,p_provider_event_id,
      p_event_occurred_at,p_event_occurred_at,
      CASE WHEN p_event_type='MESSAGE_BOUNCED' THEN 1 ELSE 0 END,
      CASE WHEN p_event_type='MESSAGE_COMPLAINED' THEN 1 ELSE 0 END,1
    ) ON CONFLICT(recipient_fingerprint) DO UPDATE SET
      first_provider_event_id=CASE
        WHEN EXCLUDED.first_suppressed_at<email_recipient_suppressions.first_suppressed_at
          THEN EXCLUDED.first_provider_event_id
        ELSE email_recipient_suppressions.first_provider_event_id END,
      first_suppressed_at=LEAST(
        email_recipient_suppressions.first_suppressed_at,EXCLUDED.first_suppressed_at
      ),
      most_recent_provider_event_id=CASE
        WHEN EXCLUDED.most_recent_suppressed_at>=email_recipient_suppressions.most_recent_suppressed_at
          THEN EXCLUDED.most_recent_provider_event_id
        ELSE email_recipient_suppressions.most_recent_provider_event_id END,
      most_recent_suppressed_at=GREATEST(
        email_recipient_suppressions.most_recent_suppressed_at,
        EXCLUDED.most_recent_suppressed_at
      ),
      hard_bounce_count=email_recipient_suppressions.hard_bounce_count
        +EXCLUDED.hard_bounce_count,
      complaint_count=email_recipient_suppressions.complaint_count
        +EXCLUDED.complaint_count,
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

CREATE OR REPLACE FUNCTION public.axora_record_cloudflare_email_event(
  p_provider_event_id uuid,p_event_type text,p_recipient_fingerprint text,
  p_provider_message_fingerprint text,p_bounce_type text,p_terminal boolean,
  p_event_occurred_at timestamptz,p_event_schema_version integer DEFAULT 1
) RETURNS TABLE(recorded boolean,suppressed boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT * FROM public.axora_record_email_provider_event(
    'CLOUDFLARE_EMAIL_SENDING',p_provider_event_id,p_event_type,
    p_recipient_fingerprint,p_provider_message_fingerprint,p_bounce_type,
    p_terminal,p_event_occurred_at,p_event_schema_version
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_record_zeptomail_email_event(
  p_provider_event_id uuid,p_event_type text,p_recipient_fingerprint text,
  p_provider_message_fingerprint text,p_bounce_type text,p_terminal boolean,
  p_event_occurred_at timestamptz,p_event_schema_version integer DEFAULT 1
) RETURNS TABLE(recorded boolean,suppressed boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT * FROM public.axora_record_email_provider_event(
    'ZEPTOMAIL',p_provider_event_id,p_event_type,p_recipient_fingerprint,
    p_provider_message_fingerprint,p_bounce_type,p_terminal,
    p_event_occurred_at,p_event_schema_version
  )
$$;

-- Notification copy is intentionally small and contains no buying cost,
-- supplier, document or location data. The authenticated route remains the
-- source for complete request details.
CREATE OR REPLACE FUNCTION public.axora_request_email_copy(
  p_event_key text,p_locale text,p_request_code text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  code text:=left(p_request_code,80);
BEGIN
  IF p_locale='ar' THEN
    RETURN CASE p_event_key
      WHEN 'request.submitted' THEN jsonb_build_object('title','تم إرسال الطلب','body','تم إرسال الطلب '||code||' للموافقة.')
      WHEN 'approval.department_required' THEN jsonb_build_object('title','موافقة القسم مطلوبة','body','الطلب '||code||' ينتظر مراجعة القسم.')
      WHEN 'approval.company_required' THEN jsonb_build_object('title','موافقة الشركة مطلوبة','body','الطلب '||code||' ينتظر مراجعة الشركة.')
      WHEN 'approval.axora_required' THEN jsonb_build_object('title','موافقة Axora مطلوبة','body','الطلب '||code||' ينتظر مراجعة Axora.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','موافقة مبلغ إضافي مطلوبة','body','الطلب '||code||' يحتاج موافقة على مبلغ فعلي إضافي.')
      WHEN 'request.approved' THEN jsonb_build_object('title','تمت الموافقة على الطلب','body','تمت الموافقة على الطلب '||code||' وحجز الميزانية.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','تم رفض الطلب','body','تم رفض الطلب '||code||'.')
      WHEN 'request.returned' THEN jsonb_build_object('title','أعيد الطلب للتعديل','body','أعيد الطلب '||code||' لإجراء التغييرات.')
      ELSE jsonb_build_object('title','تم إلغاء الطلب','body','تم إلغاء الطلب '||code||'.') END;
  ELSIF p_locale='ms' THEN
    RETURN CASE p_event_key
      WHEN 'request.submitted' THEN jsonb_build_object('title','Permintaan dihantar','body','Permintaan '||code||' telah dihantar untuk kelulusan.')
      WHEN 'approval.department_required' THEN jsonb_build_object('title','Kelulusan jabatan diperlukan','body','Permintaan '||code||' menunggu semakan jabatan.')
      WHEN 'approval.company_required' THEN jsonb_build_object('title','Kelulusan syarikat diperlukan','body','Permintaan '||code||' menunggu semakan syarikat.')
      WHEN 'approval.axora_required' THEN jsonb_build_object('title','Kelulusan Axora diperlukan','body','Permintaan '||code||' menunggu semakan Axora.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Kelulusan amaun tambahan diperlukan','body','Permintaan '||code||' memerlukan kelulusan amaun sebenar tambahan.')
      WHEN 'request.approved' THEN jsonb_build_object('title','Permintaan diluluskan','body','Permintaan '||code||' diluluskan dan bajet ditempah.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','Permintaan ditolak','body','Permintaan '||code||' telah ditolak.')
      WHEN 'request.returned' THEN jsonb_build_object('title','Permintaan dikembalikan','body','Permintaan '||code||' dikembalikan untuk perubahan.')
      ELSE jsonb_build_object('title','Permintaan dibatalkan','body','Permintaan '||code||' telah dibatalkan.') END;
  END IF;
  RETURN CASE p_event_key
    WHEN 'request.submitted' THEN jsonb_build_object('title','Request submitted','body','Request '||code||' was submitted for approval.')
    WHEN 'approval.department_required' THEN jsonb_build_object('title','Department approval required','body','Request '||code||' is waiting for department review.')
    WHEN 'approval.company_required' THEN jsonb_build_object('title','Company approval required','body','Request '||code||' is waiting for company review.')
    WHEN 'approval.axora_required' THEN jsonb_build_object('title','Axora approval required','body','Request '||code||' is waiting for Axora review.')
    WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Additional amount approval required','body','Request '||code||' needs approval for an additional actual amount.')
    WHEN 'request.approved' THEN jsonb_build_object('title','Request approved','body','Request '||code||' was approved and its budget was reserved.')
    WHEN 'request.rejected' THEN jsonb_build_object('title','Request rejected','body','Request '||code||' was rejected.')
    WHEN 'request.returned' THEN jsonb_build_object('title','Request returned','body','Request '||code||' was returned for changes.')
    ELSE jsonb_build_object('title','Request cancelled','body','Request '||code||' was cancelled.') END;
END $$;

CREATE OR REPLACE FUNCTION public.axora_request_approval_recipient_ids(
  p_request_id uuid,p_state text,p_at timestamptz
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT assignment.user_id ORDER BY assignment.user_id),ARRAY[]::uuid[])
  FROM public.requests request
  JOIN public.role_assignments assignment ON assignment.active
    AND assignment.revoked_at IS NULL
  JOIN public.users account ON account.id=assignment.user_id
    AND account.active AND account.account_status='ACTIVE'
  WHERE request.id=p_request_id
    AND public.axora_snapshot_has_permission(
      public.axora_live_authorization_snapshot(assignment.user_id,assignment.id,p_at),
      CASE WHEN request.created_by=assignment.user_id
        THEN 'request.approve.self' ELSE 'request.approve.other' END,
      CASE WHEN request.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request.company_id,request.branch_id,request.department_id,NULL
    )
    AND (p_state<>'PENDING_AXORA' OR assignment.scope_type='PLATFORM')
$$;

-- Approval notifications are derived by a database trigger after the
-- authorization decision has committed its durable outbox row. The generic
-- enqueue function intentionally requires the current request actor, which is
-- not available in this nested trigger context. Keep that guard unchanged and
-- provide only this evidence-backed, trigger-only path for approval events.
CREATE OR REPLACE FUNCTION public.axora_enqueue_approval_workflow_email(
  p_company_id uuid,
  p_workflow_event_id uuid,
  p_recipient_user_id uuid,
  p_event_key text,
  p_dedupe_key text,
  p_title text,
  p_body text,
  p_route_path text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  source_event public.workflow_events%ROWTYPE;
  selected_locale text;
  selected_schedule text;
  email_is_enabled boolean;
  inserted_id uuid;
BEGIN
  IF pg_trigger_depth()<1 THEN
    RAISE EXCEPTION 'Approval workflow email requires its database trigger';
  END IF;

  SELECT * INTO source_event
  FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id
    AND event.company_id=p_company_id
    AND event.event_key=p_event_key
    AND event.aggregate_type='request.approval.notification'
    AND EXISTS (
      SELECT 1
      FROM public.request_approval_outbox approval_outbox
      WHERE approval_outbox.id::text=event.metadata->>'approvalOutboxId'
        AND approval_outbox.request_id=event.request_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.in_app_notifications notification
      WHERE notification.company_id=event.company_id
        AND notification.workflow_event_id=event.id
        AND notification.recipient_user_id=p_recipient_user_id
        AND notification.event_key=p_event_key
        AND notification.dedupe_key=p_dedupe_key
        AND notification.title=p_title
        AND notification.body=p_body
        AND notification.route_path=p_route_path
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval workflow email source evidence is invalid';
  END IF;

  IF NOT public.axora_workflow_email_recipient_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT profile.preferred_locale,
    COALESCE(preference.digest_mode,'IMMEDIATE'),
    profile.notification_email_enabled
      AND COALESCE(preference.email_enabled,true)
      AND (preference.muted_until IS NULL OR preference.muted_until<=now())
  INTO selected_locale,selected_schedule,email_is_enabled
  FROM public.user_profiles profile
  LEFT JOIN public.notification_preferences preference
    ON preference.user_id=profile.user_id
   AND preference.event_key=p_event_key
  WHERE profile.user_id=p_recipient_user_id;

  IF email_is_enabled IS DISTINCT FROM true THEN RETURN NULL; END IF;
  IF selected_schedule NOT IN ('IMMEDIATE','DAILY','WEEKLY') THEN
    RAISE EXCEPTION 'Workflow email schedule is invalid';
  END IF;

  INSERT INTO public.workflow_email_outbox(
    company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
    title,body,route_path,locale,delivery_schedule,delivery_available_at
  ) VALUES (
    p_company_id,p_recipient_user_id,p_workflow_event_id,p_event_key,p_dedupe_key,
    p_title,p_body,p_route_path,selected_locale,selected_schedule,
    public.axora_workflow_email_available_at(selected_schedule,now())
  )
  ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id;
END $$;

CREATE OR REPLACE FUNCTION public.axora_emit_request_notification(
  p_outbox_id uuid,p_request_id uuid,p_event_key text,p_recipient_ids uuid[],
  p_actor_user_id uuid,p_correlation_id uuid,p_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request_row public.requests%ROWTYPE;
  event_id uuid;
  next_version integer;
  recipient_id uuid;
  selected_locale text;
  copy jsonb;
  actor_kind_value text;
  event_identity text:=p_outbox_id::text||':'||p_event_key;
  dedupe text;
BEGIN
  SELECT * INTO request_row FROM public.requests WHERE id=p_request_id;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Approval notification request is unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    request_row.company_id::text||':request-email:'||request_row.id::text,0
  ));
  SELECT COALESCE(max(event_version),0)+1 INTO next_version
  FROM public.workflow_events
  WHERE company_id=request_row.company_id
    AND aggregate_type='request.approval.notification'
    AND aggregate_id=request_row.id;
  SELECT account_kind INTO actor_kind_value FROM public.users
  WHERE id=p_actor_user_id AND active AND account_status='ACTIVE';
  event_id:=gen_random_uuid();
  INSERT INTO public.workflow_events(
    id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
    event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
    occurred_at,metadata
  ) VALUES (
    event_id,request_row.company_id,request_row.branch_id,request_row.id,
    'request.approval.notification',request_row.id,p_event_key,next_version,
    CASE WHEN actor_kind_value IS NULL THEN NULL ELSE p_actor_user_id END,
    COALESCE(actor_kind_value,'SYSTEM'),p_correlation_id,event_identity,p_at,
    jsonb_build_object(
      'requestVersion',request_row.request_version,
      'approvalRevision',request_row.approval_revision,
      'approvalOutboxId',p_outbox_id
    )
  );

  FOREACH recipient_id IN ARRAY COALESCE(p_recipient_ids,ARRAY[]::uuid[]) LOOP
    IF recipient_id IS NULL THEN CONTINUE; END IF;
    SELECT COALESCE(profile.preferred_locale,'en') INTO selected_locale
    FROM public.user_profiles profile WHERE profile.user_id=recipient_id;
    IF selected_locale IS NULL OR selected_locale NOT IN ('en','ar','ms') THEN
      selected_locale:='en';
    END IF;
    copy:=public.axora_request_email_copy(
      p_event_key,selected_locale,COALESCE(request_row.order_code,request_row.id::text)
    );
    dedupe:=event_identity||':'||recipient_id::text;
    INSERT INTO public.in_app_notifications(
      company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
      title,body,priority,route_path,created_at
    ) VALUES (
      request_row.company_id,recipient_id,event_id,p_event_key,dedupe,
      copy->>'title',copy->>'body',public.axora_email_priority(p_event_key),
      '/requests/'||request_row.id::text,p_at
    ) ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING;
    PERFORM public.axora_enqueue_approval_workflow_email(
      request_row.company_id,event_id,recipient_id,p_event_key,dedupe,
      copy->>'title',copy->>'body','/requests/'||request_row.id::text
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_dispatch_request_approval_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request_row public.requests%ROWTYPE;
  actor_id uuid;
  correlation uuid;
  state_value text:=COALESCE(NEW.payload->>'state','');
  action_value text:=COALESCE(NEW.payload->>'action','');
  approval_event_key text;
BEGIN
  IF NEW.job_type NOT IN (
    'APPROVAL_NOTIFICATION','ESCALATION_NOTIFICATION','DECISION_NOTIFICATION'
  ) THEN RETURN NEW; END IF;
  SELECT * INTO request_row FROM public.requests WHERE id=NEW.request_id;
  SELECT decision.actor_user_id,decision.correlation_id
  INTO actor_id,correlation
  FROM public.request_approval_decisions decision
  WHERE decision.id=(NEW.payload->>'decisionId')::uuid;
  correlation:=COALESCE(correlation,request_row.approval_last_correlation_id,gen_random_uuid());

  IF state_value IN ('PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA') THEN
    IF NEW.job_type='APPROVAL_NOTIFICATION' THEN
      PERFORM public.axora_emit_request_notification(
        NEW.id,NEW.request_id,'request.submitted',ARRAY[request_row.created_by],
        actor_id,correlation,NEW.created_at
      );
    END IF;
    approval_event_key:=CASE
      WHEN action_value='ADDITIONAL_ACTUAL_REQUIRED'
        THEN 'approval.additional_actual_required'
      WHEN state_value='PENDING_DEPARTMENT' THEN 'approval.department_required'
      WHEN state_value='PENDING_AXORA' THEN 'approval.axora_required'
      ELSE 'approval.company_required' END;
    PERFORM public.axora_emit_request_notification(
      NEW.id,NEW.request_id,approval_event_key,
      public.axora_request_approval_recipient_ids(NEW.request_id,state_value,NEW.created_at),
      actor_id,correlation,NEW.created_at
    );
  ELSE
    approval_event_key:=CASE
      WHEN action_value='REJECT' OR state_value='REJECTED' THEN 'request.rejected'
      WHEN action_value='RETURN' OR state_value='RETURNED' THEN 'request.returned'
      WHEN action_value='CANCEL' OR state_value='CANCELLED' THEN 'request.cancelled'
      ELSE 'request.approved' END;
    PERFORM public.axora_emit_request_notification(
      NEW.id,NEW.request_id,approval_event_key,ARRAY[request_row.created_by],
      actor_id,correlation,NEW.created_at
    );
  END IF;
  UPDATE public.request_approval_outbox
  SET status='COMPLETED',completed_at=now(),last_error=NULL
  WHERE id=NEW.id AND status='PENDING';
  RETURN NEW;
END $$;

CREATE TRIGGER dispatch_request_approval_notification
AFTER INSERT ON public.request_approval_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_dispatch_request_approval_notification();

CREATE OR REPLACE FUNCTION public.axora_resume_paused_email_jobs(
  p_provider_agent text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  changed integer:=0;
  row_count integer;
BEGIN
  IF p_provider_agent IS NOT NULL AND p_provider_agent NOT IN (
    'axora-auth','axora-procurement','axora-budget','axora-delivery',
    'axora-documents','axora-platform'
  ) THEN RAISE EXCEPTION 'Email provider Agent is invalid'; END IF;
  UPDATE public.transactional_email_outbox
  SET delivery_available_at=now()
  WHERE delivery_status='PENDING' AND delivery_available_at='infinity'::timestamptz
    AND (p_provider_agent IS NULL OR provider_agent=p_provider_agent);
  GET DIAGNOSTICS changed=ROW_COUNT;
  UPDATE public.workflow_email_outbox
  SET delivery_available_at=now()
  WHERE delivery_status='PENDING' AND delivery_available_at='infinity'::timestamptz
    AND (p_provider_agent IS NULL OR provider_agent=p_provider_agent);
  GET DIAGNOSTICS row_count=ROW_COUNT;
  RETURN changed+row_count;
END $$;

ALTER TABLE public.email_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_delivery_attempts,public.email_delivery_usage_daily
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_email_retry_delay(integer),
  public.axora_email_template_key(text),
  public.axora_email_provider_agent(text),
  public.axora_email_priority(text),
  public.axora_set_transactional_email_metadata(),
  public.axora_protect_transactional_email_metadata(),
  public.axora_set_workflow_email_metadata(),
  public.axora_protect_workflow_email_metadata(),
  public.axora_claim_workflow_email_v2(integer,integer),
  public.axora_complete_workflow_email_v2(uuid,uuid,text,text,text,integer,text,text,integer),
  public.axora_record_email_provider_event(text,uuid,text,text,text,text,boolean,timestamptz,integer),
  public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer),
  public.axora_request_email_copy(text,text,text),
  public.axora_request_approval_recipient_ids(uuid,text,timestamptz),
  public.axora_enqueue_approval_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
  public.axora_emit_request_notification(uuid,uuid,text,uuid[],uuid,uuid,timestamptz),
  public.axora_dispatch_request_approval_notification(),
  public.axora_resume_paused_email_jobs(text)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.email_delivery_attempts,public.email_delivery_usage_daily
      FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_claim_workflow_email_v2(integer,integer),
      public.axora_complete_workflow_email_v2(uuid,uuid,text,text,text,integer,text,text,integer),
      public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)
    TO axora_app;
  END IF;
END $$;

COMMIT;
