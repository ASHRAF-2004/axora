BEGIN;

-- Workflow email is deliberately separate from account/security email. It has
-- no bearer token and stores a user reference rather than copying an email
-- address into another durable table. The address is resolved and revalidated
-- only while a private sender lease is claimed.
CREATE TABLE IF NOT EXISTS workflow_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workflow_event_id uuid NOT NULL,
  event_key text NOT NULL CHECK (
    char_length(event_key) BETWEEN 2 AND 120
    AND event_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  dedupe_key text NOT NULL CHECK (
    char_length(dedupe_key) BETWEEN 8 AND 200
    AND dedupe_key !~ '[[:cntrl:]]'
  ),
  title text NOT NULL CHECK (
    char_length(btrim(title)) BETWEEN 1 AND 180
    AND title !~ '[[:cntrl:]]'
  ),
  body text NOT NULL CHECK (
    char_length(btrim(body)) BETWEEN 1 AND 2000
    AND body !~ '[[:cntrl:]]'
  ),
  route_path text CHECK (
    route_path IS NULL OR (
      char_length(route_path) BETWEEN 1 AND 500
      AND (route_path='/' OR route_path ~ '^/[^/]')
      AND route_path !~ '[[:cntrl:]]'
      AND route_path !~ '://'
      AND position('#' IN route_path)=0
    )
  ),
  locale text NOT NULL CHECK (locale IN ('en','ar','ms')),
  delivery_schedule text NOT NULL CHECK (
    delivery_schedule IN ('IMMEDIATE','DAILY','WEEKLY')
  ),
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (
    delivery_status IN (
      'PENDING','SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    )
  ),
  delivery_attempt_count integer NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count BETWEEN 0 AND 3),
  delivery_available_at timestamptz NOT NULL,
  delivery_attempted_at timestamptz,
  delivery_lease_id uuid,
  delivery_lease_expires_at timestamptz,
  sent_at timestamptz,
  provider_message_id text CHECK (
    provider_message_id IS NULL OR (
      char_length(provider_message_id) BETWEEN 1 AND 255
      AND provider_message_id !~ '[[:cntrl:]]'
    )
  ),
  last_delivery_error text CHECK (
    last_delivery_error IS NULL OR last_delivery_error ~ '^[a-z0-9_]{1,64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,recipient_user_id,dedupe_key),
  FOREIGN KEY(workflow_event_id,company_id)
    REFERENCES workflow_events(id,company_id) ON DELETE RESTRICT,
  CHECK (delivery_available_at >= created_at - interval '5 seconds'),
  CHECK (
    (delivery_status='PENDING'
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='SENDING'
      AND delivery_attempt_count > 0 AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NOT NULL AND delivery_lease_expires_at IS NOT NULL
      AND delivery_lease_expires_at > delivery_attempted_at
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='SENT'
      AND delivery_attempt_count > 0 AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NOT NULL)
    OR (delivery_status IN ('FAILED','DISABLED','UNCERTAIN')
      AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='CANCELLED'
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS workflow_email_outbox_ready_idx
  ON workflow_email_outbox(delivery_available_at,created_at,id)
  WHERE delivery_status='PENDING';
CREATE INDEX IF NOT EXISTS workflow_email_outbox_lease_idx
  ON workflow_email_outbox(delivery_lease_expires_at)
  WHERE delivery_status='SENDING';
CREATE INDEX IF NOT EXISTS workflow_email_outbox_event_idx
  ON workflow_email_outbox(company_id,workflow_event_id);

-- Immediate messages are available now. The delayed choices are delivery
-- windows for individual messages, not synthetic digests: next 08:00 UTC
-- (16:00 Malaysia time), or next Monday at the same time.
CREATE OR REPLACE FUNCTION axora_workflow_email_available_at(
  p_schedule text,
  p_now timestamptz DEFAULT now()
) RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT CASE p_schedule
    WHEN 'IMMEDIATE' THEN p_now
    WHEN 'DAILY' THEN date_trunc('day',p_now) + interval '1 day 8 hours'
    WHEN 'WEEKLY' THEN date_trunc('week',p_now) + interval '1 week 8 hours'
    ELSE NULL
  END
$$;

-- The common notification scope check intentionally does not require a
-- verified email address: an account whose address is being re-verified may
-- still receive an in-app update. Supplier and driver access is bound to the
-- RFQ/job rather than a broad company identifier.
CREATE OR REPLACE FUNCTION axora_workflow_notification_recipient_is_valid(
  p_company_id uuid,
  p_workflow_event_id uuid,
  p_recipient_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workflow_events event
    JOIN public.users account ON account.id=p_recipient_user_id
    WHERE event.id=p_workflow_event_id
      AND event.company_id=p_company_id
      AND account.active
      AND account.account_status='ACTIVE'
      AND (
        account.account_kind='PLATFORM'
        OR (
          account.account_kind='COMPANY'
          AND EXISTS (
            SELECT 1
            FROM public.company_memberships membership
            WHERE membership.user_id=account.id
              AND membership.company_id=event.company_id
              AND membership.status='ACTIVE'
          )
        )
        OR (
          account.account_kind='SUPPLIER'
          AND event.aggregate_type='supplier-rfq'
          AND EXISTS (
            SELECT 1
            FROM public.supplier_rfqs rfq
            JOIN public.supplier_memberships membership
              ON membership.supplier_id=rfq.supplier_id
             AND membership.user_id=account.id
             AND membership.status='ACTIVE'
            WHERE rfq.id=event.aggregate_id
              AND rfq.company_id=event.company_id
          )
        )
        OR (
          account.account_kind='DELIVERY'
          AND EXISTS (
            SELECT 1
            FROM public.delivery_job_assignments assignment
            WHERE assignment.company_id=event.company_id
              AND assignment.driver_user_id=account.id
              AND assignment.status IN ('ASSIGNED','ACCEPTED')
              AND (
                (event.aggregate_type='delivery-job'
                  AND assignment.delivery_job_id=event.aggregate_id)
                OR (
                  event.metadata->>'deliveryJobId'
                    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  AND assignment.delivery_job_id=(event.metadata->>'deliveryJobId')::uuid
                )
              )
          )
        )
      )
  )
$$;

-- Email adds current verified-address validation to the common tenant scope.
CREATE OR REPLACE FUNCTION axora_workflow_email_recipient_is_valid(
  p_company_id uuid,
  p_workflow_event_id uuid,
  p_recipient_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.axora_workflow_notification_recipient_is_valid(
      p_company_id,p_workflow_event_id,p_recipient_user_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.users account
      WHERE account.id=p_recipient_user_id
        AND account.email_verified_at IS NOT NULL
        AND char_length(account.email) BETWEEN 3 AND 254
        AND lower(account.email)
          ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND account.email !~ '[[:cntrl:]]'
    )
$$;

-- Preference rows are protected by self-only RLS. This capability returns
-- only the effective inputs required by a source-event actor, so that the
-- sender never bypasses a recipient's settings and the actor cannot inspect
-- the preference table itself.
CREATE OR REPLACE FUNCTION axora_workflow_notification_preference(
  p_company_id uuid,
  p_workflow_event_id uuid,
  p_recipient_user_id uuid,
  p_event_key text
) RETURNS TABLE(
  global_in_app_enabled boolean,
  global_email_enabled boolean,
  event_preference_exists boolean,
  event_in_app_enabled boolean,
  event_email_enabled boolean,
  delivery_schedule text,
  muted_until timestamptz,
  recipient_locale text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_event public.workflow_events%ROWTYPE;
BEGIN
  SELECT * INTO source_event
  FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id;
  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow notification source event is invalid';
  END IF;
  IF NOT public.axora_context_is_platform()
    AND source_event.actor_user_id IS DISTINCT FROM public.axora_context_user_id() THEN
    RAISE EXCEPTION 'Workflow notification preferences require the event actor';
  END IF;
  IF NOT public.axora_workflow_notification_recipient_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT profile.notification_in_app_enabled,
    profile.notification_email_enabled,
    preference.user_id IS NOT NULL,
    COALESCE(preference.in_app_enabled,true),
    COALESCE(preference.email_enabled,true),
    COALESCE(preference.digest_mode,'IMMEDIATE'),
    preference.muted_until,
    profile.preferred_locale
  FROM public.user_profiles profile
  LEFT JOIN public.notification_preferences preference
    ON preference.user_id=profile.user_id
   AND preference.event_key=p_event_key
  WHERE profile.user_id=p_recipient_user_id;
END $$;

CREATE OR REPLACE FUNCTION protect_workflow_email_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
    OR NEW.workflow_event_id IS DISTINCT FROM OLD.workflow_event_id
    OR NEW.event_key IS DISTINCT FROM OLD.event_key
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.route_path IS DISTINCT FROM OLD.route_path
    OR NEW.locale IS DISTINCT FROM OLD.locale
    OR NEW.delivery_schedule IS DISTINCT FROM OLD.delivery_schedule
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Workflow email identity and content are immutable';
  END IF;
  IF NEW.delivery_attempt_count < OLD.delivery_attempt_count THEN
    RAISE EXCEPTION 'Workflow email attempts cannot decrease';
  END IF;
  IF OLD.delivery_status NOT IN ('PENDING','SENDING') AND (
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
    RAISE EXCEPTION 'Workflow email delivery metadata is final';
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.delivery_status='PENDING' AND NEW.delivery_status NOT IN (
      'SENDING','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid workflow email delivery transition';
    ELSIF OLD.delivery_status='SENDING' AND NEW.delivery_status NOT IN (
      'PENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid workflow email delivery transition';
    ELSIF OLD.delivery_status NOT IN ('PENDING','SENDING') THEN
      RAISE EXCEPTION 'Workflow email delivery status is final';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_workflow_email_outbox_trigger
  ON workflow_email_outbox;
CREATE TRIGGER protect_workflow_email_outbox_trigger
BEFORE UPDATE ON workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION protect_workflow_email_outbox();

-- Content, addresses, provider identifiers and leases never enter audit JSON.
CREATE OR REPLACE FUNCTION audit_workflow_email_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor_text text;
  actor uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN actor := actor_text::uuid; END IF;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,company_id,reason
  ) VALUES (
    TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object(
      'workflow_event_id',OLD.workflow_event_id,
      'recipient_user_id',OLD.recipient_user_id,
      'event_key',OLD.event_key,
      'delivery_schedule',OLD.delivery_schedule,
      'delivery_status',OLD.delivery_status,
      'delivery_attempt_count',OLD.delivery_attempt_count,
      'delivery_available_at',OLD.delivery_available_at,
      'delivery_attempted_at',OLD.delivery_attempted_at,
      'sent_at',OLD.sent_at,
      'created_at',OLD.created_at
    ) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object(
      'workflow_event_id',NEW.workflow_event_id,
      'recipient_user_id',NEW.recipient_user_id,
      'event_key',NEW.event_key,
      'delivery_schedule',NEW.delivery_schedule,
      'delivery_status',NEW.delivery_status,
      'delivery_attempt_count',NEW.delivery_attempt_count,
      'delivery_available_at',NEW.delivery_available_at,
      'delivery_attempted_at',NEW.delivery_attempted_at,
      'sent_at',NEW.sent_at,
      'created_at',NEW.created_at
    ) ELSE NULL END,
    actor,COALESCE(NEW.company_id,OLD.company_id),
    current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS audit_workflow_email_outbox_trigger
  ON workflow_email_outbox;
CREATE TRIGGER audit_workflow_email_outbox_trigger
AFTER INSERT OR UPDATE OR DELETE ON workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION audit_workflow_email_outbox();

-- The application cannot read or mutate the outbox table directly. Enqueue is
-- tied to the current audited actor and checks both global and event-specific
-- email preferences again inside this privileged boundary.
CREATE OR REPLACE FUNCTION axora_enqueue_workflow_email(
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_event public.workflow_events%ROWTYPE;
  selected_locale text;
  selected_schedule text;
  email_is_enabled boolean;
  inserted_id uuid;
BEGIN
  SELECT * INTO source_event
  FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id;
  IF NOT FOUND OR source_event.event_key IS DISTINCT FROM p_event_key THEN
    RAISE EXCEPTION 'Workflow email source event is invalid';
  END IF;
  IF NOT public.axora_context_is_platform()
    AND source_event.actor_user_id IS DISTINCT FROM public.axora_context_user_id() THEN
    RAISE EXCEPTION 'Workflow email can be enqueued only by its event actor';
  END IF;
  IF NOT public.axora_workflow_email_recipient_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN
    -- A disabled, unverified, or out-of-scope recipient must never make the
    -- business transaction fail. Refuse delivery without disclosing why.
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

-- Claim performs another recipient, scope and preference check, acquires one
-- bounded lease with SKIP LOCKED, and returns only the one job the private
-- sender is authorized to deliver.
CREATE OR REPLACE FUNCTION axora_claim_workflow_email(
  p_lease_seconds integer DEFAULT 90,
  p_max_attempts integer DEFAULT 3
) RETURNS TABLE(
  delivery_id uuid,
  lease_id uuid,
  locale text,
  recipient_email text,
  recipient_name text,
  title text,
  body text,
  route_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  selected_row record;
  selected_lease uuid;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300
    OR p_max_attempts < 1 OR p_max_attempts > 3 THEN
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
      SELECT 1
      FROM public.user_profiles profile
      WHERE profile.user_id=outbox.recipient_user_id
        AND (
          NOT profile.notification_email_enabled
          OR EXISTS (
            SELECT 1
            FROM public.notification_preferences preference
            WHERE preference.user_id=profile.user_id
              AND preference.event_key=outbox.event_key
              AND NOT preference.email_enabled
          )
        )
    );

  UPDATE public.workflow_email_outbox outbox
  SET delivery_available_at=GREATEST(
    outbox.delivery_available_at,preference.muted_until
  )
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
    profile.display_name,outbox.title,outbox.body,outbox.route_path
  INTO selected_row
  FROM public.workflow_email_outbox outbox
  JOIN public.users account ON account.id=outbox.recipient_user_id
  JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN public.notification_preferences preference
    ON preference.user_id=account.id
   AND preference.event_key=outbox.event_key
  WHERE outbox.delivery_status='PENDING'
    AND outbox.delivery_attempt_count<p_max_attempts
    AND outbox.delivery_available_at<=now()
    AND profile.notification_email_enabled
    AND COALESCE(preference.email_enabled,true)
    AND (preference.muted_until IS NULL OR preference.muted_until<=now())
    AND public.axora_workflow_email_recipient_is_valid(
      outbox.company_id,outbox.workflow_event_id,outbox.recipient_user_id
    )
  ORDER BY outbox.delivery_available_at,outbox.created_at,outbox.id
  FOR UPDATE OF outbox SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;
  selected_lease := gen_random_uuid();
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
    selected_row.body::text,selected_row.route_path::text;
END $$;

CREATE OR REPLACE FUNCTION axora_complete_workflow_email(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_max_attempts integer DEFAULT 3,
  p_retry_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  changed_count integer;
BEGIN
  IF p_outcome NOT IN ('sent','retry','failed','disabled','uncertain')
    OR p_max_attempts < 1 OR p_max_attempts > 3
    OR p_retry_seconds < 30 OR p_retry_seconds > 3600
    OR (p_provider_message_id IS NOT NULL AND (
      char_length(p_provider_message_id) NOT BETWEEN 1 AND 255
      OR p_provider_message_id ~ '[[:cntrl:]]'
    ))
    OR (p_error_code IS NOT NULL
      AND p_error_code !~ '^[a-z0-9_]{1,64}$')
    OR (p_outcome='sent' AND p_error_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Workflow email completion is invalid';
  END IF;

  UPDATE public.workflow_email_outbox outbox
  SET delivery_status=CASE
        WHEN p_outcome='sent' THEN 'SENT'
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count<p_max_attempts
          THEN 'PENDING'
        WHEN p_outcome='uncertain' THEN 'UNCERTAIN'
        WHEN p_outcome='disabled' THEN 'DISABLED'
        ELSE 'FAILED'
      END,
      delivery_available_at=CASE
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count<p_max_attempts
          THEN now()+make_interval(secs=>p_retry_seconds)
        ELSE outbox.delivery_available_at
      END,
      sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE NULL END,
      provider_message_id=CASE WHEN p_outcome='sent'
        THEN p_provider_message_id ELSE NULL END,
      last_delivery_error=CASE
        WHEN p_outcome='sent' THEN NULL
        WHEN p_outcome='retry' AND outbox.delivery_attempt_count>=p_max_attempts
          THEN 'retry_exhausted'
        WHEN p_outcome='disabled'
          THEN COALESCE(p_error_code,'delivery_disabled')
        WHEN p_outcome='uncertain'
          THEN COALESCE(p_error_code,'delivery_uncertain')
        ELSE COALESCE(p_error_code,'delivery_failed')
      END,
      delivery_lease_id=NULL,delivery_lease_expires_at=NULL
  WHERE outbox.id=p_delivery_id
    AND outbox.delivery_status='SENDING'
    AND outbox.delivery_lease_id=p_lease_id;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count=1;
END $$;

ALTER TABLE workflow_email_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE workflow_email_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION
  axora_workflow_email_available_at(text,timestamptz),
  axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid),
  axora_workflow_email_recipient_is_valid(uuid,uuid,uuid),
  axora_workflow_notification_preference(uuid,uuid,uuid,text),
  axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
  axora_claim_workflow_email(integer,integer),
  axora_complete_workflow_email(uuid,uuid,text,text,text,integer,integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  protect_workflow_email_outbox(),
  audit_workflow_email_outbox()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE workflow_email_outbox FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      axora_workflow_notification_preference(uuid,uuid,uuid,text),
      axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
      axora_claim_workflow_email(integer,integer),
      axora_complete_workflow_email(uuid,uuid,text,text,text,integer,integer)
    TO axora_app;
  END IF;
END $$;

COMMIT;
