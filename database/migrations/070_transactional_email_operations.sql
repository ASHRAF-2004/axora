BEGIN;

-- P2-04 extends the provider-neutral delivery evidence installed by migration
-- 058. Operations staff receive narrow capabilities rather than direct table
-- access, and company-scoped account managers can inspect only their live
-- assigned-company rows.
INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES (
  'email.operations.manage','Email','Manage email operations',
  'Retry, cancel, suppress, reconcile, and control transactional email delivery.',true
) ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  high_risk=EXCLUDED.high_risk,
  active=true,
  updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM (VALUES
  ('PLATFORM_OWNER','email.operations.view'),
  ('PLATFORM_OWNER','email.operations.manage'),
  ('PLATFORM_OPERATIONS','email.operations.view'),
  ('PLATFORM_OPERATIONS','email.operations.manage'),
  ('CLIENT_ACCOUNT_MANAGER','email.operations.view')
) grant_row(role_key,permission_code)
JOIN public.roles role ON role.role_key=grant_row.role_key
JOIN public.permissions permission
  ON permission.permission_code=grant_row.permission_code
ON CONFLICT(role_id,permission_id) DO NOTHING;

CREATE TABLE public.email_agent_controls (
  provider_agent text PRIMARY KEY CHECK (provider_agent IN (
    'axora-auth','axora-procurement','axora-budget','axora-delivery',
    'axora-documents','axora-platform'
  )),
  paused boolean NOT NULL DEFAULT false,
  pause_reason text CHECK (
    pause_reason IS NULL OR (
      char_length(btrim(pause_reason)) BETWEEN 10 AND 1000
      AND pause_reason !~ '[[:cntrl:]]'
    )
  ),
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  CHECK ((paused AND pause_reason IS NOT NULL AND changed_by IS NOT NULL)
    OR (NOT paused AND pause_reason IS NULL))
);

INSERT INTO public.email_agent_controls(provider_agent) VALUES
  ('axora-auth'),('axora-procurement'),('axora-budget'),
  ('axora-delivery'),('axora-documents'),('axora-platform')
ON CONFLICT(provider_agent) DO NOTHING;

CREATE TABLE public.email_operations_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'VIEW','RETRY','CANCEL','RESEND','REVEAL','SUPPRESS','UNSUPPRESS',
    'PAUSE_AGENT','RESUME_AGENT','RECONCILE','RECORD_PROVIDER_HEALTH'
  )),
  delivery_kind text CHECK (
    delivery_kind IS NULL OR delivery_kind IN (
      'ACCOUNT_SETUP','TRANSACTIONAL','WORKFLOW'
    )
  ),
  delivery_id uuid,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  provider_agent text CHECK (provider_agent IS NULL OR provider_agent IN (
    'axora-auth','axora-procurement','axora-budget','axora-delivery',
    'axora-documents','axora-platform'
  )),
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 10 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','NOOP')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object'
    AND public.workflow_metadata_is_safe(metadata)
  ),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(result)='object'
    AND public.workflow_metadata_is_safe(result)
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((delivery_kind IS NULL)=(delivery_id IS NULL))
);

CREATE UNIQUE INDEX email_operations_events_command_uq
  ON public.email_operations_events(command_id) WHERE command_id IS NOT NULL;
CREATE INDEX email_operations_events_recent_idx
  ON public.email_operations_events(occurred_at DESC,action,id);
CREATE INDEX email_operations_events_company_idx
  ON public.email_operations_events(company_id,occurred_at DESC)
  WHERE company_id IS NOT NULL;

CREATE TABLE public.email_agent_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_event_id uuid NOT NULL UNIQUE
    REFERENCES public.email_operations_events(id) ON DELETE RESTRICT,
  provider_agent text NOT NULL CHECK (provider_agent IN (
    'axora-auth','axora-procurement','axora-budget','axora-delivery',
    'axora-documents','axora-platform'
  )),
  from_paused boolean NOT NULL,
  to_paused boolean NOT NULL,
  affected_jobs integer NOT NULL DEFAULT 0 CHECK (affected_jobs>=0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_resend_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_event_id uuid NOT NULL UNIQUE
    REFERENCES public.email_operations_events(id) ON DELETE RESTRICT,
  original_delivery_id uuid NOT NULL
    REFERENCES public.workflow_email_outbox(id) ON DELETE RESTRICT,
  new_delivery_id uuid NOT NULL UNIQUE
    REFERENCES public.workflow_email_outbox(id) ON DELETE RESTRICT,
  original_template_version smallint NOT NULL CHECK (original_template_version>0),
  new_template_version smallint NOT NULL CHECK (
    new_template_version=original_template_version+1
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_operator_suppression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_event_id uuid NOT NULL UNIQUE
    REFERENCES public.email_operations_events(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('ADDRESS','DOMAIN')),
  target_fingerprint text NOT NULL CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),
  masked_target text NOT NULL CHECK (
    char_length(masked_target) BETWEEN 3 AND 320
    AND masked_target !~ '[[:cntrl:]]'
  ),
  action text NOT NULL CHECK (action IN ('SUPPRESS','UNSUPPRESS')),
  correction_resolved boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action='SUPPRESS' OR correction_resolved)
);

CREATE INDEX email_operator_suppression_target_idx
  ON public.email_operator_suppression_events(
    target_type,target_fingerprint,occurred_at DESC,id DESC
  );

CREATE VIEW public.email_operator_suppressions_current
WITH (security_barrier=true)
AS
SELECT DISTINCT ON (target_type,target_fingerprint)
  id,operation_event_id,target_type,target_fingerprint,masked_target,
  action,correction_resolved,occurred_at
FROM public.email_operator_suppression_events
ORDER BY target_type,target_fingerprint,occurred_at DESC,id DESC;

CREATE TABLE public.email_provider_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_event_id uuid NOT NULL UNIQUE
    REFERENCES public.email_operations_events(id) ON DELETE RESTRICT,
  provider_name text NOT NULL CHECK (provider_name IN (
    'zeptomail','cloudflare-email-service','test','unconfigured'
  )),
  source text NOT NULL CHECK (source IN ('SUPPORTED_API','MANUAL')),
  remaining_recipient_units bigint CHECK (remaining_recipient_units>=0),
  allowance_renews_at timestamptz,
  credit_expires_at timestamptz,
  account_state text NOT NULL CHECK (
    account_state IN ('HEALTHY','DEGRADED','PAUSED','EXPIRED','UNKNOWN')
  ),
  domain_name text CHECK (
    domain_name IS NULL OR (
      char_length(domain_name) BETWEEN 3 AND 253
      AND domain_name=lower(domain_name)
      AND domain_name ~ '^[a-z0-9.-]+$'
    )
  ),
  domain_state text NOT NULL CHECK (
    domain_state IN ('VERIFIED','PENDING','FAILED','UNKNOWN')
  ),
  configuration_state text NOT NULL CHECK (
    configuration_state IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')
  ),
  last_provider_submission_at timestamptz,
  last_provider_webhook_at timestamptz,
  note text CHECK (
    note IS NULL OR (
      char_length(btrim(note)) BETWEEN 10 AND 1000
      AND note !~ '[[:cntrl:]]'
    )
  ),
  captured_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_provider_health_recent_idx
  ON public.email_provider_health_snapshots(provider_name,captured_at DESC,id DESC);

-- Webhook request bodies and recipient data are never retained. This bounded
-- hourly aggregate records only validated-provider processing health.
CREATE TABLE public.email_webhook_health_hourly (
  provider_name text NOT NULL CHECK (provider_name IN (
    'zeptomail','cloudflare-email-service'
  )),
  period_start timestamptz NOT NULL,
  accepted_count bigint NOT NULL DEFAULT 0 CHECK (accepted_count>=0),
  rejected_count bigint NOT NULL DEFAULT 0 CHECK (rejected_count>=0),
  processing_failure_count bigint NOT NULL DEFAULT 0
    CHECK (processing_failure_count>=0),
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider_name,period_start),
  CHECK (period_start=date_trunc('hour',period_start))
);

CREATE OR REPLACE FUNCTION public.axora_email_operations_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Email operations evidence is append-only';
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'email_operations_events','email_agent_control_events',
    'email_resend_versions','email_operator_suppression_events',
    'email_provider_health_snapshots'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER protect_%I_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.axora_email_operations_append_only()',
      table_name,table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_email_domain_fingerprint(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT encode(sha256(convert_to(
    lower(split_part(btrim(p_email),'@',2)),'UTF8'
  )),'hex')
$$;

CREATE OR REPLACE FUNCTION public.axora_mask_email_address(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email)=0
      THEN 'private operations recipient'
    ELSE left(split_part(lower(btrim(p_email)),'@',1),2)
      ||'***@'||split_part(lower(btrim(p_email)),'@',2)
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_email_recipient_is_suppressed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  WITH fingerprints AS (
    SELECT public.axora_email_recipient_fingerprint(p_email) AS address_hash,
      public.axora_email_domain_fingerprint(p_email) AS domain_hash
    WHERE p_email IS NOT NULL AND position('@' IN p_email)>1
  ), address_action AS (
    SELECT current.action,current.correction_resolved,current.occurred_at
    FROM public.email_operator_suppressions_current current,fingerprints
    WHERE current.target_type='ADDRESS'
      AND current.target_fingerprint=fingerprints.address_hash
  ), domain_action AS (
    SELECT current.action,current.correction_resolved,current.occurred_at
    FROM public.email_operator_suppressions_current current,fingerprints
    WHERE current.target_type='DOMAIN'
      AND current.target_fingerprint=fingerprints.domain_hash
  ), provider_suppression AS (
    SELECT suppression.most_recent_suppressed_at
    FROM public.email_recipient_suppressions suppression,fingerprints
    WHERE suppression.recipient_fingerprint=fingerprints.address_hash
  )
  SELECT COALESCE((SELECT action='SUPPRESS' FROM domain_action),false)
    OR COALESCE((SELECT action='SUPPRESS' FROM address_action),false)
    OR (
      EXISTS (SELECT 1 FROM provider_suppression)
      AND NOT COALESCE((
        SELECT action='UNSUPPRESS' AND correction_resolved
          AND occurred_at>=(SELECT most_recent_suppressed_at
            FROM provider_suppression)
        FROM address_action
      ),false)
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_email_agent_is_paused(p_provider_agent text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE((
    SELECT control.paused
    FROM public.email_agent_controls control
    WHERE control.provider_agent=p_provider_agent
  ),true)
$$;

CREATE OR REPLACE FUNCTION public.axora_apply_email_agent_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.delivery_status='PENDING'
    AND public.axora_email_agent_is_paused(NEW.provider_agent) THEN
    NEW.delivery_available_at:='infinity'::timestamptz;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER zz_hold_transactional_email_insert
BEFORE INSERT ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_apply_email_agent_hold();
CREATE TRIGGER zz_hold_transactional_email_update
BEFORE UPDATE OF delivery_status,delivery_available_at,provider_agent
ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_apply_email_agent_hold();
CREATE TRIGGER zz_hold_workflow_email_insert
BEFORE INSERT ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_apply_email_agent_hold();
CREATE TRIGGER zz_hold_workflow_email_update
BEFORE UPDATE OF delivery_status,delivery_available_at,provider_agent
ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_apply_email_agent_hold();

-- This private view is the only place where recipient addresses are joined to
-- all three queues. It is never granted to the application role. The public
-- workspace capability below masks every address before returning a row.
CREATE VIEW public.email_operations_delivery_queue
WITH (security_barrier=true)
AS
SELECT
  'ACCOUNT_SETUP'::text AS delivery_kind,
  invitation.id AS delivery_id,
  invitation.company_id,
  invitation.user_id AS entity_id,
  'account'::text AS entity_type,
  'invitation.sent'::text AS event_key,
  'internal-user-invitation'::text AS template_key,
  1::smallint AS template_version,
  'URGENT'::text AS priority,
  'axora-auth'::text AS provider_agent,
  invitation.delivery_status,
  invitation.delivery_attempt_count,
  1 AS maximum_attempts,
  invitation.created_at AS delivery_available_at,
  invitation.delivery_attempted_at,
  invitation.sent_at,
  invitation.last_delivery_error,
  invitation.created_at,
  invitation.id AS correlation_id,
  account.email AS recipient_email,
  '/users'::text AS route_path
FROM public.account_setup_invitations invitation
JOIN public.users account ON account.id=invitation.user_id

UNION ALL

SELECT
  'TRANSACTIONAL'::text,
  outbox.id,
  COALESCE(reset_account.company_id,verification_account.company_id,
    lead.converted_company_id),
  COALESCE(outbox.contact_submission_id,outbox.password_reset_token_id,
    outbox.email_verification_token_id),
  CASE WHEN outbox.contact_submission_id IS NOT NULL THEN 'company_lead'
    ELSE 'account' END,
  lower(replace(outbox.message_kind,'_','.')),
  outbox.template_key,
  outbox.template_version,
  outbox.priority,
  outbox.provider_agent,
  outbox.delivery_status,
  outbox.delivery_attempt_count,
  7,
  outbox.delivery_available_at,
  outbox.delivery_attempted_at,
  outbox.sent_at,
  outbox.last_delivery_error,
  outbox.created_at,
  outbox.correlation_id,
  CASE
    WHEN outbox.message_kind='CONTACT_ACKNOWLEDGEMENT'
      THEN submission.contact_email
    WHEN outbox.message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED')
      THEN reset_account.email
    WHEN outbox.message_kind='EMAIL_VERIFICATION' THEN verification.email
    ELSE NULL
  END,
  CASE WHEN outbox.contact_submission_id IS NOT NULL
    THEN '/companies?view=leads' ELSE '/account' END
FROM public.transactional_email_outbox outbox
LEFT JOIN public.public_contact_submissions submission
  ON submission.id=outbox.contact_submission_id
LEFT JOIN public.company_leads lead ON lead.id=submission.lead_id
LEFT JOIN public.password_reset_tokens reset
  ON reset.id=outbox.password_reset_token_id
LEFT JOIN public.users reset_account ON reset_account.id=reset.user_id
LEFT JOIN public.email_verification_tokens verification
  ON verification.id=outbox.email_verification_token_id
LEFT JOIN public.users verification_account
  ON verification_account.id=verification.user_id

UNION ALL

SELECT
  'WORKFLOW'::text,
  outbox.id,
  outbox.company_id,
  event.aggregate_id,
  event.aggregate_type,
  outbox.event_key,
  outbox.template_key,
  outbox.template_version,
  outbox.priority,
  outbox.provider_agent,
  outbox.delivery_status,
  outbox.delivery_attempt_count,
  7,
  outbox.delivery_available_at,
  outbox.delivery_attempted_at,
  outbox.sent_at,
  outbox.last_delivery_error,
  outbox.created_at,
  outbox.correlation_id,
  account.email,
  outbox.route_path
FROM public.workflow_email_outbox outbox
JOIN public.workflow_events event ON event.id=outbox.workflow_event_id
  AND event.company_id=outbox.company_id
JOIN public.users account ON account.id=outbox.recipient_user_id;

CREATE OR REPLACE FUNCTION public.axora_email_operations_actor_snapshot(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_id uuid; assignment_id uuid;
BEGIN
  actor_id:=public.axora_context_user_id();
  assignment_id:=NULLIF(
    current_setting('axora.role_assignment_id',true),''
  )::uuid;
  IF actor_id IS NULL OR assignment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.axora_effective_access_snapshot(actor_id,assignment_id,p_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_email_operations_snapshot(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  at_time timestamptz:=now();
  actor_id uuid:=public.axora_context_user_id();
  assignment_id uuid:=NULLIF(
    current_setting('axora.role_assignment_id',true),''
  )::uuid;
  actor_snapshot jsonb;
  global_allowed boolean:=false;
  can_manage boolean:=false;
  company_filter uuid;
  correlation_filter uuid;
  from_at timestamptz:=now()-interval '30 days';
  to_at timestamptz:=now()+interval '1 second';
  agent_filter text;
  event_filter text;
  template_filter text;
  status_filter text;
  domain_filter text;
  error_filter text;
  entity_filter text;
  row_offset integer:=0;
  result jsonb;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object'
    OR NOT public.workflow_metadata_is_safe(p_filters) THEN
    RAISE EXCEPTION 'Email operations filters are invalid';
  END IF;
  actor_snapshot:=public.axora_email_operations_actor_snapshot(at_time);
  IF actor_snapshot IS NULL THEN
    RAISE EXCEPTION 'Email operations are unavailable';
  END IF;
  global_allowed:=public.axora_snapshot_has_permission(
    actor_snapshot,'email.operations.view','PLATFORM',NULL,NULL,NULL,NULL
  );
  can_manage:=public.axora_snapshot_has_permission(
    actor_snapshot,'email.operations.manage','PLATFORM',NULL,NULL,NULL,NULL
  );
  IF NOT global_allowed AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(actor_snapshot->'scopes','[]'::jsonb)) scope
    WHERE scope->>'type'='COMPANY'
      AND public.axora_snapshot_has_permission(
        actor_snapshot,'email.operations.view','COMPANY',
        NULLIF(scope->>'companyId','')::uuid,NULL,NULL,NULL
      )
  ) THEN
    RAISE EXCEPTION 'Email operations are unavailable';
  END IF;

  IF COALESCE(p_filters->>'companyId','') ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    company_filter:=(p_filters->>'companyId')::uuid;
  END IF;
  IF COALESCE(p_filters->>'correlation','') ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    correlation_filter:=(p_filters->>'correlation')::uuid;
  END IF;
  IF COALESCE(p_filters->>'from','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
    from_at:=((p_filters->>'from')||' 00:00:00+00')::timestamptz;
  END IF;
  IF COALESCE(p_filters->>'to','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
    to_at:=((p_filters->>'to')||' 00:00:00+00')::timestamptz+interval '1 day';
  END IF;
  IF from_at>=to_at THEN RAISE EXCEPTION 'Email operations date range is invalid'; END IF;

  agent_filter:=NULLIF(p_filters->>'agent','');
  IF agent_filter IS NOT NULL AND agent_filter NOT IN (
    'axora-auth','axora-procurement','axora-budget','axora-delivery',
    'axora-documents','axora-platform'
  ) THEN agent_filter:=NULL; END IF;
  status_filter:=upper(NULLIF(p_filters->>'status',''));
  IF status_filter IS NOT NULL AND status_filter NOT IN (
    'PENDING','SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
  ) THEN status_filter:=NULL; END IF;
  event_filter:=NULLIF(left(p_filters->>'event',120),'');
  template_filter:=NULLIF(left(p_filters->>'template',120),'');
  domain_filter:=lower(NULLIF(left(p_filters->>'domain',253),''));
  error_filter:=lower(NULLIF(left(p_filters->>'error',64),''));
  entity_filter:=NULLIF(left(p_filters->>'entity',120),'');
  IF COALESCE(p_filters->>'offset','') ~ '^[0-9]{1,5}$' THEN
    row_offset:=LEAST((p_filters->>'offset')::integer,10000);
  END IF;

  WITH base AS (
    SELECT queue.*,
      public.axora_mask_email_address(queue.recipient_email) AS masked_recipient,
      lower(NULLIF(split_part(queue.recipient_email,'@',2),'')) AS recipient_domain,
      CASE WHEN queue.recipient_email IS NULL THEN false
        ELSE public.axora_email_recipient_is_suppressed(queue.recipient_email)
      END AS recipient_suppressed,
      attempt.provider_name,attempt.outcome AS attempt_outcome,
      attempt.error_code AS attempt_error,attempt.http_status,
      attempt.provider_message_fingerprint,
      provider_event.event_type AS provider_status,
      provider_event.event_occurred_at AS provider_status_at
    FROM public.email_operations_delivery_queue queue
    LEFT JOIN LATERAL (
      SELECT item.provider_name,item.outcome,item.error_code,item.http_status,
        item.provider_message_fingerprint
      FROM public.email_delivery_attempts item
      WHERE item.delivery_kind=queue.delivery_kind
        AND item.delivery_id=queue.delivery_id
      ORDER BY item.attempt_number DESC,item.attempted_at DESC,item.id DESC
      LIMIT 1
    ) attempt ON true
    LEFT JOIN LATERAL (
      SELECT event.event_type,event.event_occurred_at
      FROM public.email_provider_events event
      WHERE attempt.provider_message_fingerprint IS NOT NULL
        AND event.provider_message_fingerprint=attempt.provider_message_fingerprint
        AND (queue.recipient_email IS NULL OR event.recipient_fingerprint=
          public.axora_email_recipient_fingerprint(queue.recipient_email))
      ORDER BY event.event_occurred_at DESC,event.provider_event_id DESC
      LIMIT 1
    ) provider_event ON true
  ), authorized AS (
    SELECT * FROM base item
    WHERE global_allowed OR (
      item.company_id IS NOT NULL
      AND public.axora_snapshot_has_permission(
        actor_snapshot,'email.operations.view','COMPANY',
        item.company_id,NULL,NULL,NULL
      )
    )
  ), filtered AS (
    SELECT * FROM authorized item
    WHERE item.created_at>=from_at AND item.created_at<to_at
      AND (company_filter IS NULL OR item.company_id=company_filter)
      AND (agent_filter IS NULL OR item.provider_agent=agent_filter)
      AND (status_filter IS NULL OR item.delivery_status=status_filter)
      AND (event_filter IS NULL OR item.event_key=event_filter)
      AND (template_filter IS NULL OR item.template_key=template_filter)
      AND (domain_filter IS NULL OR item.recipient_domain=domain_filter)
      AND (error_filter IS NULL OR lower(COALESCE(
        item.last_delivery_error,item.attempt_error,''))=error_filter)
      AND (correlation_filter IS NULL OR item.correlation_id=correlation_filter)
      AND (entity_filter IS NULL OR item.entity_id::text=entity_filter
        OR item.entity_type=entity_filter)
  ), paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC,delivery_id DESC
    LIMIT 100 OFFSET row_offset
  ), scoped_attempts AS (
    SELECT attempt.*
    FROM public.email_delivery_attempts attempt
    JOIN filtered item ON item.delivery_kind=attempt.delivery_kind
      AND item.delivery_id=attempt.delivery_id
    WHERE attempt.attempted_at>=from_at AND attempt.attempted_at<to_at
  ), scoped_events AS (
    SELECT event.*
    FROM public.email_provider_events event
    JOIN scoped_attempts attempt
      ON attempt.provider_message_fingerprint=event.provider_message_fingerprint
    WHERE event.event_occurred_at>=from_at AND event.event_occurred_at<to_at
  ), daily_usage AS (
    SELECT date_trunc('day',attempted_at) AS usage_day,
      count(*) FILTER (WHERE outcome='sent')::bigint AS recipient_units,
      count(*)::bigint AS attempts
    FROM scoped_attempts
    GROUP BY date_trunc('day',attempted_at)
    ORDER BY usage_day
  ), current_month_usage AS (
    SELECT count(*) FILTER (WHERE attempt.outcome='sent')::bigint AS units
    FROM public.email_delivery_attempts attempt
    JOIN authorized item ON item.delivery_kind=attempt.delivery_kind
      AND item.delivery_id=attempt.delivery_id
    WHERE attempt.attempted_at>=date_trunc('month',at_time)
  ), thirty_day_usage AS (
    SELECT count(*) FILTER (WHERE attempt.outcome='sent')::numeric AS units
    FROM public.email_delivery_attempts attempt
    JOIN authorized item ON item.delivery_kind=attempt.delivery_kind
      AND item.delivery_id=attempt.delivery_id
    WHERE attempt.attempted_at>=at_time-interval '30 days'
  ), latest_health AS (
    SELECT * FROM public.email_provider_health_snapshots
    WHERE global_allowed
    ORDER BY captured_at DESC,id DESC LIMIT 1
  ), provider_suppression_rows AS (
    SELECT DISTINCT ON (suppression.recipient_fingerprint)
      suppression.recipient_fingerprint,item.masked_recipient,
      item.recipient_domain,suppression.most_recent_suppressed_at
    FROM public.email_recipient_suppressions suppression
    JOIN authorized item ON item.recipient_email IS NOT NULL
      AND public.axora_email_recipient_fingerprint(item.recipient_email)
        =suppression.recipient_fingerprint
      AND public.axora_email_recipient_is_suppressed(item.recipient_email)
    ORDER BY suppression.recipient_fingerprint,
      suppression.most_recent_suppressed_at DESC
  )
  SELECT jsonb_build_object(
    'capturedAt',at_time,
    'canManage',can_manage,
    'totalRecords',(SELECT count(*) FROM filtered),
    'metrics',jsonb_build_object(
      'created',(SELECT count(*) FROM filtered),
      'submitted',(SELECT count(*) FROM scoped_attempts WHERE outcome='sent'),
      'delivered',(SELECT count(*) FROM scoped_events
        WHERE event_type='MESSAGE_DELIVERED'),
      'queueDepth',(SELECT count(*) FROM authorized
        WHERE delivery_status='PENDING'),
      'oldestQueuedAt',(SELECT min(created_at) FROM authorized
        WHERE delivery_status='PENDING'),
      'retries',(SELECT count(*) FROM scoped_attempts WHERE outcome='retry'),
      'permanentFailures',(SELECT count(*) FROM scoped_attempts
        WHERE outcome='failed'),
      'softBounces',(SELECT count(*) FROM scoped_events
        WHERE event_type='MESSAGE_BOUNCED' AND bounce_type='SOFT'),
      'hardBounces',(SELECT count(*) FROM scoped_events
        WHERE event_type='MESSAGE_BOUNCED' AND bounce_type='HARD'),
      'complaints',(SELECT count(*) FROM scoped_events
        WHERE event_type='MESSAGE_COMPLAINED'),
      'suppressedRecipients',(SELECT count(DISTINCT
        public.axora_email_recipient_fingerprint(recipient_email))
        FROM authorized WHERE recipient_email IS NOT NULL
          AND recipient_suppressed),
      'invalidRecipients',(SELECT count(*) FROM scoped_attempts
        WHERE error_code IN ('invalid_recipient','recipient_invalid')),
      'dailyRecipientUnits',COALESCE((SELECT recipient_units
        FROM daily_usage ORDER BY usage_day DESC LIMIT 1),0),
      'monthlyRecipientUnits',COALESCE((SELECT units FROM current_month_usage),0),
      'lastProviderSubmissionAt',(SELECT max(attempted_at) FROM scoped_attempts),
      'lastProviderWebhookAt',(SELECT max(received_at) FROM scoped_events),
      'webhookFailures',CASE WHEN global_allowed THEN COALESCE((
        SELECT sum(rejected_count+processing_failure_count)
        FROM public.email_webhook_health_hourly
        WHERE period_start>=from_at AND period_start<to_at
      ),0) ELSE 0 END
    ),
    'records',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'deliveryKind',delivery_kind,'deliveryId',delivery_id,
      'companyId',company_id,'entityId',entity_id,'entityType',entity_type,
      'eventKey',event_key,'templateKey',template_key,
      'templateVersion',template_version,'priority',priority,
      'providerAgent',provider_agent,'status',delivery_status,
      'attemptCount',delivery_attempt_count,'maximumAttempts',maximum_attempts,
      'availableAt',delivery_available_at,'attemptedAt',delivery_attempted_at,
      'sentAt',sent_at,'createdAt',created_at,
      'maskedRecipient',masked_recipient,'recipientDomain',recipient_domain,
      'recipientSuppressed',recipient_suppressed,
      'providerName',provider_name,'attemptOutcome',attempt_outcome,
      'providerStatus',provider_status,'providerStatusAt',provider_status_at,
      'lastError',COALESCE(last_delivery_error,attempt_error),
      'httpStatus',http_status,'correlationId',correlation_id,
      'routePath',route_path,
      'retryable',delivery_kind<>'ACCOUNT_SETUP'
        AND delivery_status='PENDING'
        AND delivery_attempt_count<maximum_attempts,
      'cancellable',delivery_status='PENDING',
      'resendable',delivery_kind='WORKFLOW'
        AND delivery_status IN ('SENT','FAILED','UNCERTAIN','CANCELLED'),
      'canReveal',can_manage AND recipient_email IS NOT NULL
    ) ORDER BY created_at DESC,delivery_id DESC) FROM paged),'[]'::jsonb),
    'agents',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'providerAgent',control.provider_agent,'paused',control.paused,
      'changedAt',control.changed_at,'revision',control.revision,
      'queueDepth',COALESCE(summary.queue_depth,0),
      'retrying',COALESCE(summary.retrying,0),
      'failures',COALESCE(summary.failures,0),
      'oldestQueuedAt',summary.oldest_queued_at
    ) ORDER BY control.provider_agent)
    FROM public.email_agent_controls control
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE delivery_status='PENDING') AS queue_depth,
        count(*) FILTER (WHERE delivery_status='PENDING'
          AND delivery_attempt_count>0) AS retrying,
        count(*) FILTER (WHERE delivery_status IN ('FAILED','UNCERTAIN'))
          AS failures,
        min(created_at) FILTER (WHERE delivery_status='PENDING') AS oldest_queued_at
      FROM authorized item WHERE item.provider_agent=control.provider_agent
    ) summary ON true),'[]'::jsonb),
    'dailyUsage',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'day',usage_day,'recipientUnits',recipient_units,'attempts',attempts
    ) ORDER BY usage_day) FROM daily_usage),'[]'::jsonb),
    'providerHealth',CASE WHEN NOT global_allowed THEN NULL ELSE COALESCE((
      SELECT jsonb_build_object(
        'providerName',health.provider_name,'source',health.source,
        'remainingRecipientUnits',health.remaining_recipient_units,
        'allowanceRenewsAt',health.allowance_renews_at,
        'creditExpiresAt',health.credit_expires_at,
        'accountState',health.account_state,'domainName',health.domain_name,
        'domainState',health.domain_state,
        'configurationState',health.configuration_state,
        'lastProviderSubmissionAt',COALESCE(health.last_provider_submission_at,
          (SELECT max(attempted_at) FROM scoped_attempts)),
        'lastProviderWebhookAt',COALESCE(health.last_provider_webhook_at,
          (SELECT max(received_at) FROM scoped_events)),
        'capturedAt',health.captured_at,
        'forecastDays',CASE WHEN health.remaining_recipient_units IS NULL
          OR COALESCE((SELECT units FROM thirty_day_usage),0)=0 THEN NULL
          ELSE floor(health.remaining_recipient_units/
            ((SELECT units FROM thirty_day_usage)/30)) END,
        'threshold',CASE WHEN health.remaining_recipient_units IS NULL
          OR COALESCE((SELECT units FROM thirty_day_usage),0)=0 THEN 'UNKNOWN'
          WHEN health.remaining_recipient_units/
            ((SELECT units FROM thirty_day_usage)/30)<7 THEN 'CRITICAL'
          WHEN health.remaining_recipient_units/
            ((SELECT units FROM thirty_day_usage)/30)<14 THEN 'WARNING'
          ELSE 'HEALTHY' END
      ) FROM latest_health health
    ),jsonb_build_object('source','MISSING','accountState','UNKNOWN',
      'domainState','UNKNOWN','configurationState','UNKNOWN',
      'threshold','UNKNOWN')) END,
    'webhooks',CASE WHEN NOT global_allowed THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'providerName',provider_name,'periodStart',period_start,
        'accepted',accepted_count,'rejected',rejected_count,
        'processingFailures',processing_failure_count,
        'lastErrorCode',last_error_code,'lastEventAt',last_event_at
      ) ORDER BY period_start DESC,provider_name)
      FROM (SELECT * FROM public.email_webhook_health_hourly
        WHERE period_start>=from_at AND period_start<to_at
        ORDER BY period_start DESC LIMIT 168) webhook_rows
    ),'[]'::jsonb) END,
    'suppressions',COALESCE((
      SELECT jsonb_agg(item ORDER BY item->>'occurredAt' DESC)
      FROM (
        SELECT jsonb_build_object(
          'source','OPERATOR','targetType',current.target_type,
          'maskedTarget',current.masked_target,'action',current.action,
          'correctionResolved',current.correction_resolved,
          'occurredAt',current.occurred_at
        ) AS item
        FROM public.email_operator_suppressions_current current
        WHERE global_allowed OR EXISTS (
          SELECT 1 FROM authorized delivery
          WHERE delivery.recipient_email IS NOT NULL
            AND current.target_fingerprint=CASE current.target_type
              WHEN 'ADDRESS' THEN public.axora_email_recipient_fingerprint(
                delivery.recipient_email)
              ELSE public.axora_email_domain_fingerprint(delivery.recipient_email)
            END
        )
        UNION ALL
        SELECT jsonb_build_object(
          'source','PROVIDER','targetType','ADDRESS',
          'maskedTarget',provider_row.masked_recipient,
          'action','SUPPRESS','correctionResolved',false,
          'occurredAt',provider_row.most_recent_suppressed_at
        ) FROM provider_suppression_rows provider_row
        LIMIT 100
      ) suppression_items
    ),'[]'::jsonb),
    'companies',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',company.id,'name',company.name
    ) ORDER BY company.name,company.id)
      FROM public.companies company
      WHERE EXISTS (SELECT 1 FROM authorized item
        WHERE item.company_id=company.id)),'[]'::jsonb)
  ) INTO result;

  INSERT INTO public.email_operations_events(
    actor_user_id,actor_role_assignment_id,action,company_id,reason,
    outcome,metadata,result,occurred_at
  ) VALUES (
    actor_id,assignment_id,'VIEW',company_filter,
    'Email operations workspace viewed','SUCCESS',
    jsonb_build_object(
      'companyFiltered',company_filter IS NOT NULL,
      'agentFiltered',agent_filter IS NOT NULL,
      'statusFiltered',status_filter IS NOT NULL,
      'dateFiltered',(p_filters ? 'from') OR (p_filters ? 'to')
    ),
    jsonb_build_object('recordCount',COALESCE((result->>'totalRecords')::int,0)),
    at_time
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_email_operations_command(
  p_command_id uuid,
  p_action text,
  p_delivery_kind text DEFAULT NULL,
  p_delivery_id uuid DEFAULT NULL,
  p_provider_agent text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  at_time timestamptz:=now();
  actor_id uuid:=public.axora_context_user_id();
  assignment_id uuid:=NULLIF(
    current_setting('axora.role_assignment_id',true),''
  )::uuid;
  actor_snapshot jsonb;
  existing public.email_operations_events%ROWTYPE;
  target public.email_operations_delivery_queue%ROWTYPE;
  original public.workflow_email_outbox%ROWTYPE;
  operation_id uuid:=gen_random_uuid();
  new_delivery_id uuid;
  action_value text:=upper(COALESCE(p_action,''));
  result jsonb:='{}'::jsonb;
  audit_result jsonb:='{}'::jsonb;
  outcome_value text:='SUCCESS';
  affected integer:=0;
  changed integer:=0;
  old_paused boolean;
  target_type text;
  target_value text;
  target_hash text;
  masked_target text;
  suppression_action text;
  correction_resolved boolean:=false;
  provider_name text;
  health_source text;
  remaining_units bigint;
  allowance_renews timestamptz;
  credit_expires timestamptz;
  account_state text;
  domain_name text;
  domain_state text;
  configuration_state text;
  provider_note text;
BEGIN
  IF p_command_id IS NULL OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 1000
    OR p_reason ~ '[[:cntrl:]]'
    OR p_details IS NULL OR jsonb_typeof(p_details)<>'object'
    OR NOT public.workflow_metadata_is_safe(p_details) THEN
    RAISE EXCEPTION 'Email operation is unavailable';
  END IF;
  IF action_value NOT IN (
    'RETRY','CANCEL','RESEND','REVEAL','SUPPRESS','UNSUPPRESS',
    'PAUSE_AGENT','RESUME_AGENT','RECONCILE','RECORD_PROVIDER_HEALTH'
  ) THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;

  actor_snapshot:=public.axora_email_operations_actor_snapshot(at_time);
  IF actor_snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    actor_snapshot,'email.operations.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;

  SELECT * INTO existing FROM public.email_operations_events event
  WHERE event.command_id=p_command_id;
  IF FOUND THEN
    IF existing.action<>action_value THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    IF action_value='REVEAL' THEN
      SELECT * INTO target FROM public.email_operations_delivery_queue queue
      WHERE queue.delivery_kind=p_delivery_kind
        AND queue.delivery_id=p_delivery_id;
      IF target.recipient_email IS NULL THEN
        RAISE EXCEPTION 'Email operation is unavailable';
      END IF;
      RETURN existing.result||jsonb_build_object(
        'recipient',target.recipient_email
      );
    END IF;
    RETURN existing.result;
  END IF;

  IF action_value IN (
    'RETRY','CANCEL','RESEND','REVEAL','SUPPRESS','UNSUPPRESS'
  ) THEN
    IF p_delivery_kind NOT IN ('ACCOUNT_SETUP','TRANSACTIONAL','WORKFLOW')
      OR p_delivery_id IS NULL THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    SELECT * INTO target FROM public.email_operations_delivery_queue queue
    WHERE queue.delivery_kind=p_delivery_kind
      AND queue.delivery_id=p_delivery_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;
  END IF;

  IF action_value='RETRY' THEN
    IF target.delivery_kind='TRANSACTIONAL'
      AND target.delivery_status='PENDING'
      AND target.delivery_attempt_count<target.maximum_attempts
      AND (target.recipient_email IS NULL
        OR NOT public.axora_email_recipient_is_suppressed(target.recipient_email)) THEN
      UPDATE public.transactional_email_outbox
      SET delivery_available_at=CASE
          WHEN public.axora_email_agent_is_paused(target.provider_agent)
            THEN 'infinity'::timestamptz ELSE at_time END,
        last_delivery_error=NULL
      WHERE id=target.delivery_id AND delivery_status='PENDING'
        AND delivery_attempt_count<7;
      GET DIAGNOSTICS affected=ROW_COUNT;
    ELSIF target.delivery_kind='WORKFLOW'
      AND target.delivery_status='PENDING'
      AND target.delivery_attempt_count<target.maximum_attempts
      AND NOT public.axora_email_recipient_is_suppressed(target.recipient_email) THEN
      UPDATE public.workflow_email_outbox
      SET delivery_available_at=CASE
          WHEN public.axora_email_agent_is_paused(target.provider_agent)
            THEN 'infinity'::timestamptz ELSE at_time END,
        last_delivery_error=NULL
      WHERE id=target.delivery_id AND delivery_status='PENDING'
        AND delivery_attempt_count<7;
      GET DIAGNOSTICS affected=ROW_COUNT;
    END IF;
    IF affected=0 THEN outcome_value:='NOOP'; END IF;
    result:=jsonb_build_object('changed',affected=1,'action','RETRY');
    audit_result:=result;

  ELSIF action_value='CANCEL' THEN
    IF target.delivery_kind='ACCOUNT_SETUP' THEN
      UPDATE public.account_setup_invitations
      SET delivery_status='CANCELLED',last_delivery_error='cancelled_by_operator'
      WHERE id=target.delivery_id AND delivery_status='PENDING';
    ELSIF target.delivery_kind='TRANSACTIONAL' THEN
      UPDATE public.transactional_email_outbox
      SET delivery_status='CANCELLED',last_delivery_error='cancelled_by_operator',
        token_ciphertext=NULL,token_nonce=NULL,token_authentication_tag=NULL
      WHERE id=target.delivery_id AND delivery_status='PENDING';
    ELSE
      UPDATE public.workflow_email_outbox
      SET delivery_status='CANCELLED',last_delivery_error='cancelled_by_operator'
      WHERE id=target.delivery_id AND delivery_status='PENDING';
    END IF;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected=0 THEN outcome_value:='NOOP'; END IF;
    result:=jsonb_build_object('changed',affected=1,'action','CANCEL');
    audit_result:=result;

  ELSIF action_value='RESEND' THEN
    IF target.delivery_kind='WORKFLOW'
      AND target.delivery_status IN ('SENT','FAILED','UNCERTAIN','CANCELLED')
      AND target.template_version<32767
      AND NOT public.axora_email_recipient_is_suppressed(target.recipient_email) THEN
      SELECT * INTO original FROM public.workflow_email_outbox
      WHERE id=target.delivery_id FOR UPDATE;
      INSERT INTO public.workflow_email_outbox(
        company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
        title,body,route_path,locale,delivery_schedule,delivery_status,
        delivery_attempt_count,delivery_available_at,template_version,
        correlation_id
      ) VALUES (
        original.company_id,original.recipient_user_id,original.workflow_event_id,
        original.event_key,left(original.dedupe_key,150)||':resend:'
          ||replace(p_command_id::text,'-',''),
        original.title,original.body,original.route_path,original.locale,
        'IMMEDIATE','PENDING',0,at_time,original.template_version+1,
        gen_random_uuid()
      ) RETURNING id INTO new_delivery_id;
      affected:=1;
    END IF;
    IF affected=0 THEN outcome_value:='NOOP'; END IF;
    result:=jsonb_strip_nulls(jsonb_build_object(
      'changed',affected=1,'action','RESEND','newDeliveryId',new_delivery_id
    ));
    audit_result:=result;

  ELSIF action_value='REVEAL' THEN
    IF target.recipient_email IS NULL THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    masked_target:=public.axora_mask_email_address(target.recipient_email);
    result:=jsonb_build_object('changed',false,'action','REVEAL',
      'recipient',target.recipient_email,'maskedRecipient',masked_target);
    audit_result:=result-'recipient';

  ELSIF action_value IN ('SUPPRESS','UNSUPPRESS') THEN
    IF target.recipient_email IS NULL THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    target_type:=upper(COALESCE(p_details->>'targetType','ADDRESS'));
    IF target_type NOT IN ('ADDRESS','DOMAIN') THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    suppression_action:=action_value;
    correction_resolved:=COALESCE((p_details->>'correctionResolved')::boolean,false);
    IF suppression_action='UNSUPPRESS' AND NOT correction_resolved THEN
      RAISE EXCEPTION 'Email operation is unavailable';
    END IF;
    IF target_type='ADDRESS' THEN
      target_value:=target.recipient_email;
      target_hash:=public.axora_email_recipient_fingerprint(target_value);
      masked_target:=public.axora_mask_email_address(target_value);
    ELSE
      target_value:=lower(split_part(target.recipient_email,'@',2));
      IF target_value='' THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;
      target_hash:=public.axora_email_domain_fingerprint(target.recipient_email);
      masked_target:='***@'||target_value;
    END IF;
    affected:=1;
    result:=jsonb_build_object('changed',true,'action',suppression_action,
      'targetType',target_type,'maskedTarget',masked_target,
      'correctionResolved',correction_resolved);
    audit_result:=result;

    IF suppression_action='SUPPRESS' THEN
      UPDATE public.account_setup_invitations invitation
      SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
      FROM public.users account
      WHERE invitation.user_id=account.id
        AND invitation.delivery_status='PENDING'
        AND CASE target_type WHEN 'ADDRESS' THEN
          public.axora_email_recipient_fingerprint(account.email)=target_hash
        ELSE public.axora_email_domain_fingerprint(account.email)=target_hash END;
      UPDATE public.transactional_email_outbox outbox
      SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed',
        token_ciphertext=NULL,token_nonce=NULL,token_authentication_tag=NULL
      WHERE outbox.delivery_status='PENDING' AND EXISTS (
        SELECT 1 FROM public.email_operations_delivery_queue queue
        WHERE queue.delivery_kind='TRANSACTIONAL'
          AND queue.delivery_id=outbox.id AND queue.recipient_email IS NOT NULL
          AND CASE target_type WHEN 'ADDRESS' THEN
            public.axora_email_recipient_fingerprint(queue.recipient_email)=target_hash
          ELSE public.axora_email_domain_fingerprint(queue.recipient_email)=target_hash END
      );
      UPDATE public.workflow_email_outbox outbox
      SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
      FROM public.users account
      WHERE outbox.recipient_user_id=account.id
        AND outbox.delivery_status='PENDING'
        AND CASE target_type WHEN 'ADDRESS' THEN
          public.axora_email_recipient_fingerprint(account.email)=target_hash
        ELSE public.axora_email_domain_fingerprint(account.email)=target_hash END;
    END IF;

  ELSIF action_value IN ('PAUSE_AGENT','RESUME_AGENT') THEN
    IF p_provider_agent NOT IN (
      'axora-auth','axora-procurement','axora-budget','axora-delivery',
      'axora-documents','axora-platform'
    ) THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;
    SELECT paused INTO old_paused FROM public.email_agent_controls
    WHERE provider_agent=p_provider_agent FOR UPDATE;
    IF action_value='PAUSE_AGENT' THEN
      UPDATE public.email_agent_controls
      SET paused=true,pause_reason=btrim(p_reason),changed_by=actor_id,
        changed_at=at_time,revision=revision+1
      WHERE provider_agent=p_provider_agent AND NOT paused;
      GET DIAGNOSTICS affected=ROW_COUNT;
      UPDATE public.transactional_email_outbox
      SET delivery_available_at='infinity'::timestamptz
      WHERE provider_agent=p_provider_agent AND delivery_status='PENDING'
        AND delivery_available_at<>'infinity'::timestamptz;
      GET DIAGNOSTICS changed=ROW_COUNT;
      affected:=affected+changed;
      UPDATE public.workflow_email_outbox
      SET delivery_available_at='infinity'::timestamptz
      WHERE provider_agent=p_provider_agent AND delivery_status='PENDING'
        AND delivery_available_at<>'infinity'::timestamptz;
      GET DIAGNOSTICS changed=ROW_COUNT;
      affected:=affected+changed;
    ELSE
      UPDATE public.email_agent_controls
      SET paused=false,pause_reason=NULL,changed_by=actor_id,
        changed_at=at_time,revision=revision+1
      WHERE provider_agent=p_provider_agent AND paused;
      GET DIAGNOSTICS affected=ROW_COUNT;
      affected:=affected+public.axora_resume_paused_email_jobs(p_provider_agent);
    END IF;
    IF affected=0 THEN outcome_value:='NOOP'; END IF;
    result:=jsonb_build_object('changed',affected>0,'action',action_value,
      'providerAgent',p_provider_agent,'affectedJobs',GREATEST(affected,0));
    audit_result:=result;

  ELSE
    provider_name:=lower(COALESCE(p_details->>'providerName','zeptomail'));
    health_source:=upper(COALESCE(p_details->>'source','MANUAL'));
    account_state:=upper(COALESCE(p_details->>'accountState','UNKNOWN'));
    domain_state:=upper(COALESCE(p_details->>'domainState','UNKNOWN'));
    configuration_state:=upper(COALESCE(
      p_details->>'configurationState','UNKNOWN'));
    domain_name:=lower(NULLIF(btrim(p_details->>'domainName'),''));
    provider_note:=NULLIF(btrim(p_details->>'note'),'');
    IF provider_name NOT IN (
      'zeptomail','cloudflare-email-service','test','unconfigured'
    ) OR health_source NOT IN ('SUPPORTED_API','MANUAL')
      OR account_state NOT IN ('HEALTHY','DEGRADED','PAUSED','EXPIRED','UNKNOWN')
      OR domain_state NOT IN ('VERIFIED','PENDING','FAILED','UNKNOWN')
      OR configuration_state NOT IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')
      OR (domain_name IS NOT NULL AND (char_length(domain_name)>253
        OR domain_name !~ '^[a-z0-9.-]+$'))
      OR (provider_note IS NOT NULL AND char_length(provider_note) NOT BETWEEN 10 AND 1000)
    THEN RAISE EXCEPTION 'Email operation is unavailable'; END IF;
    IF COALESCE(p_details->>'remainingRecipientUnits','') ~ '^[0-9]{1,18}$' THEN
      remaining_units:=(p_details->>'remainingRecipientUnits')::bigint;
    END IF;
    IF COALESCE(p_details->>'allowanceRenewsAt','') ~
      '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN
      allowance_renews:=(p_details->>'allowanceRenewsAt')::timestamptz;
    END IF;
    IF COALESCE(p_details->>'creditExpiresAt','') ~
      '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN
      credit_expires:=(p_details->>'creditExpiresAt')::timestamptz;
    END IF;
    result:=jsonb_build_object('changed',true,'action',action_value,
      'providerName',provider_name,'source',health_source);
    audit_result:=result;
  END IF;

  INSERT INTO public.email_operations_events(
    id,command_id,actor_user_id,actor_role_assignment_id,action,
    delivery_kind,delivery_id,company_id,provider_agent,reason,outcome,
    metadata,result,occurred_at
  ) VALUES (
    operation_id,p_command_id,actor_id,assignment_id,action_value,
    CASE WHEN p_delivery_id IS NULL THEN NULL ELSE p_delivery_kind END,
    p_delivery_id,CASE WHEN p_delivery_id IS NULL THEN NULL ELSE target.company_id END,
    COALESCE(p_provider_agent,CASE WHEN p_delivery_id IS NULL
      THEN NULL ELSE target.provider_agent END),btrim(p_reason),outcome_value,
    jsonb_strip_nulls(jsonb_build_object(
      'targetType',target_type,'providerName',provider_name,
      'source',health_source
    )),audit_result,at_time
  );

  IF action_value='RESEND' AND new_delivery_id IS NOT NULL THEN
    INSERT INTO public.email_resend_versions(
      operation_event_id,original_delivery_id,new_delivery_id,
      original_template_version,new_template_version,created_at
    ) VALUES (
      operation_id,target.delivery_id,new_delivery_id,target.template_version,
      target.template_version+1,at_time
    );
  ELSIF action_value IN ('SUPPRESS','UNSUPPRESS') THEN
    INSERT INTO public.email_operator_suppression_events(
      operation_event_id,target_type,target_fingerprint,masked_target,
      action,correction_resolved,occurred_at
    ) VALUES (
      operation_id,target_type,target_hash,masked_target,
      suppression_action,correction_resolved,at_time
    );
  ELSIF action_value IN ('PAUSE_AGENT','RESUME_AGENT') THEN
    INSERT INTO public.email_agent_control_events(
      operation_event_id,provider_agent,from_paused,to_paused,
      affected_jobs,occurred_at
    ) VALUES (
      operation_id,p_provider_agent,COALESCE(old_paused,false),
      action_value='PAUSE_AGENT',GREATEST(affected,0),at_time
    );
  ELSIF action_value IN ('RECONCILE','RECORD_PROVIDER_HEALTH') THEN
    INSERT INTO public.email_provider_health_snapshots(
      operation_event_id,provider_name,source,remaining_recipient_units,
      allowance_renews_at,credit_expires_at,account_state,domain_name,
      domain_state,configuration_state,last_provider_submission_at,
      last_provider_webhook_at,note,captured_by,captured_at
    ) VALUES (
      operation_id,provider_name,health_source,remaining_units,
      allowance_renews,credit_expires,account_state,domain_name,
      domain_state,configuration_state,
      (SELECT max(attempted_at) FROM public.email_delivery_attempts),
      (SELECT max(received_at) FROM public.email_provider_events),
      provider_note,actor_id,at_time
    );
  END IF;

  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_email_webhook_failure(
  p_provider_name text,p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE provider_value text:=lower(COALESCE(p_provider_name,''));
  error_value text:=lower(COALESCE(p_error_code,''));
  period_value timestamptz:=date_trunc('hour',now());
BEGIN
  IF provider_value NOT IN ('zeptomail','cloudflare-email-service')
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
    rejected_count=email_webhook_health_hourly.rejected_count
      +EXCLUDED.rejected_count,
    processing_failure_count=email_webhook_health_hourly.processing_failure_count
      +EXCLUDED.processing_failure_count,
    last_error_code=EXCLUDED.last_error_code,
    last_event_at=GREATEST(email_webhook_health_hourly.last_event_at,
      EXCLUDED.last_event_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_email_webhook_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE provider_value text:=CASE NEW.provider
  WHEN 'ZEPTOMAIL' THEN 'zeptomail'
  ELSE 'cloudflare-email-service' END;
  period_value timestamptz:=date_trunc('hour',NEW.received_at);
BEGIN
  INSERT INTO public.email_webhook_health_hourly(
    provider_name,period_start,accepted_count,last_event_at
  ) VALUES (provider_value,period_value,1,NEW.received_at)
  ON CONFLICT(provider_name,period_start) DO UPDATE SET
    accepted_count=email_webhook_health_hourly.accepted_count+1,
    last_event_at=GREATEST(email_webhook_health_hourly.last_event_at,
      EXCLUDED.last_event_at);
  RETURN NEW;
END $$;

CREATE TRIGGER record_email_webhook_success
AFTER INSERT ON public.email_provider_events
FOR EACH ROW EXECUTE FUNCTION public.axora_record_email_webhook_success();

ALTER TABLE public.email_agent_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_operations_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_agent_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_resend_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_operator_suppression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_webhook_health_hourly ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.email_agent_controls,public.email_operations_events,
  public.email_agent_control_events,public.email_resend_versions,
  public.email_operator_suppression_events,
  public.email_operator_suppressions_current,
  public.email_provider_health_snapshots,
  public.email_webhook_health_hourly,
  public.email_operations_delivery_queue
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_email_operations_append_only(),
  public.axora_email_domain_fingerprint(text),
  public.axora_mask_email_address(text),
  public.axora_email_agent_is_paused(text),
  public.axora_apply_email_agent_hold(),
  public.axora_email_operations_actor_snapshot(timestamptz),
  public.axora_email_operations_snapshot(jsonb),
  public.axora_email_operations_command(uuid,text,text,uuid,text,text,jsonb),
  public.axora_record_email_webhook_failure(text,text),
  public.axora_record_email_webhook_success()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.email_agent_controls,public.email_operations_events,
      public.email_agent_control_events,public.email_resend_versions,
      public.email_operator_suppression_events,
      public.email_operator_suppressions_current,
      public.email_provider_health_snapshots,
      public.email_webhook_health_hourly,
      public.email_operations_delivery_queue
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_email_recipient_is_suppressed(text),
      public.axora_email_agent_is_paused(text),
      public.axora_email_operations_snapshot(jsonb),
      public.axora_email_operations_command(uuid,text,text,uuid,text,text,jsonb),
      public.axora_record_email_webhook_failure(text,text)
    TO axora_app;
  END IF;
END $$;

COMMIT;
