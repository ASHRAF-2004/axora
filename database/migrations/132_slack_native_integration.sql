BEGIN;

-- Slack is a provider-owned OAuth installation, not an Axora API principal.
-- Keep provider OAuth applications outside the public Axora OAuth issuance
-- path while preserving the application -> company connection separation.
ALTER TABLE public.integration_applications
  ADD COLUMN authorization_mode text NOT NULL DEFAULT 'AXORA_OAUTH'
  CONSTRAINT integration_applications_authorization_mode_check
  CHECK (authorization_mode IN ('AXORA_OAUTH','PROVIDER_OAUTH'));

ALTER TABLE public.integration_api_rate_buckets
  DROP CONSTRAINT integration_api_rate_buckets_route_class_check;
ALTER TABLE public.integration_api_rate_buckets
  ADD CONSTRAINT integration_api_rate_buckets_route_class_check CHECK (
    route_class IN (
      'OAUTH_AUTHORIZE','OAUTH_TOKEN','API_READ','API_WRITE',
      'SLACK_OAUTH','SLACK_EVENTS','SLACK_API'
    )
  );

INSERT INTO public.integration_applications(
  id,client_id,client_secret_hash,client_type,token_endpoint_auth_method,
  slug,name,description,status,redirect_uris,allowed_scopes,authorization_mode
) VALUES (
  '8a0b0000-0000-4000-8000-000000000004'::uuid,
  'axora_client_slack_native_v1_0000000000000000',
  NULL,'PUBLIC','none','axora-slack','Slack',
  'Native Slack notifications with authorization-preserving Axora deep links.',
  'ACTIVE',ARRAY['https://axora.management/api/integrations/slack/oauth/callback'],
  ARRAY['webhooks:manage'], 'PROVIDER_OAUTH'
)
ON CONFLICT(slug) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  redirect_uris=EXCLUDED.redirect_uris,
  authorization_mode='PROVIDER_OAUTH',
  updated_at=now();

DO $provider_application_boundary$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_applications
    WHERE id='8a0b0000-0000-4000-8000-000000000004'::uuid
      AND slug='axora-slack' AND authorization_mode='PROVIDER_OAUTH'
  ) THEN
    RAISE EXCEPTION 'The reserved Slack application identity is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.integration_oauth_grants
    WHERE application_id='8a0b0000-0000-4000-8000-000000000004'::uuid
    UNION ALL
    SELECT 1 FROM public.integration_oauth_authorization_requests
    WHERE application_id='8a0b0000-0000-4000-8000-000000000004'::uuid
  ) THEN
    RAISE EXCEPTION 'Provider-owned Slack application has Axora OAuth state';
  END IF;
END
$provider_application_boundary$;

CREATE FUNCTION public.axora_require_axora_oauth_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_applications application
    WHERE application.id=NEW.application_id
      AND application.authorization_mode='AXORA_OAUTH'
  ) THEN
    RAISE EXCEPTION 'Provider OAuth applications cannot issue Axora OAuth state'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.axora_require_axora_oauth_application()
  FROM PUBLIC;
CREATE TRIGGER integration_oauth_grants_require_axora_application
BEFORE INSERT OR UPDATE OF application_id ON public.integration_oauth_grants
FOR EACH ROW EXECUTE FUNCTION public.axora_require_axora_oauth_application();
CREATE TRIGGER integration_oauth_requests_require_axora_application
BEFORE INSERT OR UPDATE OF application_id
ON public.integration_oauth_authorization_requests
FOR EACH ROW EXECUTE FUNCTION public.axora_require_axora_oauth_application();

CREATE TABLE public.integration_slack_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  auth_version_at_start integer NOT NULL CHECK (auth_version_at_start>0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONSUMED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failure_category text CHECK (
    failure_category IS NULL OR failure_category IN (
      'ACCESS_DENIED','AUTHORIZATION_REVOKED','INVALID_CALLBACK',
      'PROVIDER_ERROR','SCOPE_MISMATCH','WORKSPACE_CONFLICT'
    )
  ),
  UNIQUE(id,company_id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
  CHECK (
    (status='PENDING' AND consumed_at IS NULL AND failure_category IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND failure_category IS NULL)
    OR (status='FAILED' AND consumed_at IS NOT NULL AND failure_category IS NOT NULL)
  )
);
CREATE INDEX integration_slack_oauth_states_expiry_idx
  ON public.integration_slack_oauth_states(expires_at,id);

CREATE TABLE public.integration_slack_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL DEFAULT
    '8a0b0000-0000-4000-8000-000000000004'::uuid,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workspace_id text NOT NULL CHECK (workspace_id ~ '^T[A-Z0-9]{8,32}$'),
  workspace_name text NOT NULL CHECK (
    char_length(btrim(workspace_name)) BETWEEN 1 AND 120
    AND workspace_name !~ '[[:cntrl:]]'
  ),
  enterprise_id text CHECK (
    enterprise_id IS NULL OR enterprise_id ~ '^E[A-Z0-9]{8,32}$'
  ),
  bot_user_id text NOT NULL CHECK (bot_user_id ~ '^[UB][A-Z0-9]{8,32}$'),
  granted_scopes text[] NOT NULL CHECK (
    cardinality(granted_scopes)=2
    AND granted_scopes @> ARRAY['chat:write','channels:read']::text[]
    AND granted_scopes <@ ARRAY['chat:write','channels:read']::text[]
  ),
  access_token_ciphertext jsonb CHECK (
    access_token_ciphertext IS NULL
    OR public.axora_integration_ciphertext_is_valid(access_token_ciphertext)
  ),
  refresh_token_ciphertext jsonb CHECK (
    refresh_token_ciphertext IS NULL
    OR public.axora_integration_ciphertext_is_valid(refresh_token_ciphertext)
  ),
  access_token_expires_at timestamptz,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version>0),
  selected_channel_id text CHECK (
    selected_channel_id IS NULL OR selected_channel_id ~ '^C[A-Z0-9]{8,32}$'
  ),
  selected_channel_name text CHECK (
    selected_channel_name IS NULL OR (
      char_length(btrim(selected_channel_name)) BETWEEN 1 AND 120
      AND selected_channel_name !~ '[[:cntrl:]]'
    )
  ),
  enabled_event_types text[] NOT NULL DEFAULT ARRAY[
    'request.submitted','request.approved','invoice.finalized',
    'delivery.out_for_delivery','delivery.completed'
  ]::text[] CHECK (
    cardinality(enabled_event_types) BETWEEN 1 AND 5
    AND array_position(enabled_event_types,NULL) IS NULL
    AND enabled_event_types <@ ARRAY[
      'request.submitted','request.approved','invoice.finalized',
      'delivery.out_for_delivery','delivery.completed'
    ]::text[]
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','PAUSED','REVOKING','REVOKED')
  ),
  pause_reason text CHECK (
    pause_reason IS NULL OR pause_reason IN (
      'AUTHORIZATION_REVOKED','MISSING_SCOPE','OPERATOR_PAUSED'
    )
  ),
  installed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  authorized_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  auth_version_at_install integer NOT NULL CHECK (auth_version_at_install>0),
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_channel_sync_at timestamptz,
  revocation_requested_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
  ),
  revocation_attempt_count integer NOT NULL DEFAULT 0
    CHECK (revocation_attempt_count BETWEEN 0 AND 8),
  revocation_available_at timestamptz NOT NULL DEFAULT now(),
  revocation_leased_by text,
  revocation_lease_token uuid,
  revocation_lease_expires_at timestamptz,
  revocation_error_category text CHECK (
    revocation_error_category IS NULL OR revocation_error_category IN (
      'NETWORK_ERROR','PROVIDER_UNAVAILABLE','RATE_LIMITED',
      'INVALID_RESPONSE','REVOCATION_DEAD'
    )
  ),
  FOREIGN KEY(connection_id,application_id,company_id)
    REFERENCES public.integration_connections(id,application_id,company_id)
    ON DELETE CASCADE,
  UNIQUE(id,company_id),
  UNIQUE(id,connection_id,company_id),
  CHECK (application_id='8a0b0000-0000-4000-8000-000000000004'::uuid),
  CHECK (
    (selected_channel_id IS NULL AND selected_channel_name IS NULL)
    OR (selected_channel_id IS NOT NULL AND selected_channel_name IS NOT NULL)
  ),
  CHECK (
    (status IN ('ACTIVE','PAUSED','REVOKING')
      AND access_token_ciphertext IS NOT NULL
      AND refresh_token_ciphertext IS NOT NULL
      AND access_token_expires_at IS NOT NULL)
    OR status='REVOKED'
  ),
  CHECK (
    (status='ACTIVE' AND pause_reason IS NULL AND revoked_at IS NULL
      AND revocation_requested_at IS NULL)
    OR (status='PAUSED' AND pause_reason IS NOT NULL AND revoked_at IS NULL
      AND revocation_requested_at IS NULL)
    OR (status='REVOKING' AND pause_reason IS NULL AND revoked_at IS NULL
      AND revocation_requested_at IS NOT NULL AND revoke_reason IS NOT NULL)
    OR (status='REVOKED' AND pause_reason IS NULL AND revoked_at IS NOT NULL
      AND revocation_requested_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CHECK (
    (revocation_leased_by IS NULL AND revocation_lease_token IS NULL
      AND revocation_lease_expires_at IS NULL)
    OR (status='REVOKING' AND revocation_leased_by IS NOT NULL
      AND revocation_leased_by ~ '^integration-[A-Za-z0-9_-]{8,120}$'
      AND revocation_lease_token IS NOT NULL
      AND revocation_lease_expires_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX integration_slack_installations_company_active_uq
  ON public.integration_slack_installations(company_id)
  WHERE status<>'REVOKED';
CREATE UNIQUE INDEX integration_slack_installations_workspace_active_uq
  ON public.integration_slack_installations(workspace_id)
  WHERE status<>'REVOKED';
CREATE INDEX integration_slack_installations_revocation_claim_idx
  ON public.integration_slack_installations(
    status,revocation_available_at,installed_at,id
  ) WHERE status='REVOKING';

CREATE TABLE public.integration_slack_channels (
  installation_id uuid NOT NULL,
  company_id uuid NOT NULL,
  channel_id text NOT NULL CHECK (channel_id ~ '^C[A-Z0-9]{8,32}$'),
  channel_name text NOT NULL CHECK (
    char_length(btrim(channel_name)) BETWEEN 1 AND 120
    AND channel_name !~ '[[:cntrl:]]'
  ),
  is_member boolean NOT NULL,
  is_archived boolean NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(installation_id,channel_id),
  FOREIGN KEY(installation_id,company_id)
    REFERENCES public.integration_slack_installations(id,company_id)
    ON DELETE CASCADE
);

CREATE TABLE public.integration_slack_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.integration_events(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','DELIVERING','SUCCEEDED','RETRY','FAILED','DEAD')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  cycle_attempt_count integer NOT NULL DEFAULT 0 CHECK (cycle_attempt_count BETWEEN 0 AND 8),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_by text,
  lease_token uuid,
  lease_token_version integer CHECK (
    lease_token_version IS NULL OR lease_token_version>0
  ),
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  response_status integer CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  error_category text CHECK (
    error_category IS NULL OR error_category IN (
      'LEASE_EXPIRED','AUTHORIZATION_REVOKED','INSTALLATION_INACTIVE',
      'NETWORK_ERROR','TIMEOUT','RATE_LIMITED','PROVIDER_UNAVAILABLE',
      'INVALID_RESPONSE','TOKEN_REVOKED','MISSING_SCOPE',
      'CHANNEL_UNAVAILABLE','PROVIDER_REJECTED'
    )
  ),
  last_duration_ms integer CHECK (
    last_duration_ms IS NULL OR last_duration_ms BETWEEN 0 AND 120000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  manual_retry_count integer NOT NULL DEFAULT 0 CHECK (manual_retry_count BETWEEN 0 AND 10),
  last_manual_retry_at timestamptz,
  last_manual_retry_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY(installation_id,connection_id,company_id)
    REFERENCES public.integration_slack_installations(id,connection_id,company_id)
    ON DELETE CASCADE,
  UNIQUE(event_id,installation_id),
  UNIQUE(id,event_id,installation_id,company_id),
  CHECK (
    (status='DELIVERING' AND leased_by IS NOT NULL
      AND leased_by ~ '^integration-[A-Za-z0-9_-]{8,120}$'
      AND lease_token IS NOT NULL AND lease_token_version IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (status<>'DELIVERING' AND leased_by IS NULL AND lease_token IS NULL
      AND lease_token_version IS NULL AND lease_expires_at IS NULL)
  )
);
CREATE INDEX integration_slack_deliveries_claim_idx
  ON public.integration_slack_deliveries(status,available_at,created_at,id)
  WHERE status IN ('PENDING','RETRY','DELIVERING');
CREATE INDEX integration_slack_deliveries_company_idx
  ON public.integration_slack_deliveries(company_id,created_at DESC,id DESC);
CREATE INDEX integration_slack_deliveries_retention_idx
  ON public.integration_slack_deliveries(completed_at,id)
  WHERE completed_at IS NOT NULL;

CREATE TABLE public.integration_slack_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL,
  event_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  company_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 100),
  token_version integer NOT NULL CHECK (token_version>0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED','RETRY','FAILED','DEAD')),
  response_status integer CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  error_category text CHECK (
    error_category IS NULL OR error_category IN (
      'LEASE_EXPIRED','AUTHORIZATION_REVOKED','INSTALLATION_INACTIVE',
      'NETWORK_ERROR','TIMEOUT','RATE_LIMITED','PROVIDER_UNAVAILABLE',
      'INVALID_RESPONSE','TOKEN_REVOKED','MISSING_SCOPE',
      'CHANNEL_UNAVAILABLE','PROVIDER_REJECTED'
    )
  ),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 0 AND 120000),
  retry_after_seconds integer CHECK (
    retry_after_seconds IS NULL OR retry_after_seconds BETWEEN 1 AND 86400
  ),
  FOREIGN KEY(delivery_id,event_id,installation_id,company_id)
    REFERENCES public.integration_slack_deliveries(
      id,event_id,installation_id,company_id
    ) ON DELETE CASCADE,
  CONSTRAINT integration_slack_attempt_unique
    UNIQUE(delivery_id,attempt_number),
  CHECK (completed_at>=started_at)
);
CREATE INDEX integration_slack_attempts_retention_idx
  ON public.integration_slack_attempts(completed_at,id);

CREATE TABLE public.integration_slack_inbound_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^Ev[A-Za-z0-9]{6,80}$'),
  workspace_id text NOT NULL CHECK (workspace_id ~ '^T[A-Z0-9]{8,32}$'),
  event_type text NOT NULL CHECK (event_type IN ('app_uninstalled','tokens_revoked')),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_slack_inbound_events_retention_idx
  ON public.integration_slack_inbound_events(received_at,event_id);

CREATE FUNCTION public.axora_slack_installation_is_authorized(
  p_installation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE installation record; actor_snapshot jsonb;
BEGIN
  IF p_installation_id IS NULL OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RETURN false; END IF;
  SELECT slack.* INTO installation
  FROM public.integration_slack_installations slack
  JOIN public.integration_applications application
    ON application.id=slack.application_id
   AND application.slug='axora-slack'
   AND application.authorization_mode='PROVIDER_OAUTH'
   AND application.status='ACTIVE'
  JOIN public.integration_connections connection
    ON connection.id=slack.connection_id
   AND connection.application_id=slack.application_id
   AND connection.company_id=slack.company_id
   AND connection.status='ACTIVE'
  JOIN public.users account
    ON account.id=slack.installed_by
   AND account.active AND account.account_status='ACTIVE'
   AND account.account_setup_completed_at IS NOT NULL
   AND account.auth_version=slack.auth_version_at_install
  JOIN public.role_assignments assignment
    ON assignment.id=slack.authorized_role_assignment_id
   AND assignment.user_id=slack.installed_by
   AND assignment.active AND assignment.revoked_at IS NULL
  WHERE slack.id=p_installation_id AND slack.status='ACTIVE';
  IF installation.id IS NULL THEN RETURN false; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    installation.installed_by,
    installation.authorized_role_assignment_id,p_at
  );
  RETURN actor_snapshot IS NOT NULL
    AND (actor_snapshot->>'authVersion')::integer
      = installation.auth_version_at_install
    AND public.axora_snapshot_has_permission(
      actor_snapshot,'integration.connection.manage','COMPANY',
      installation.company_id,NULL,NULL,NULL
    );
END
$$;
REVOKE ALL ON FUNCTION public.axora_slack_installation_is_authorized(
  uuid,timestamptz
) FROM PUBLIC;

-- Projection remains asynchronous. The worker sets this transaction-local
-- capability flag; ordinary business transactions never execute this trigger.
CREATE FUNCTION public.axora_enqueue_slack_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF COALESCE(
    NULLIF(current_setting('axora.integration_slack_enabled',true),''),
    'false'
  )::boolean THEN
    INSERT INTO public.integration_slack_deliveries(
      event_id,installation_id,connection_id,company_id
    )
    SELECT NEW.id,installation.id,installation.connection_id,NEW.company_id
    FROM public.integration_slack_installations installation
    WHERE installation.company_id=NEW.company_id
      AND installation.status='ACTIVE'
      AND installation.selected_channel_id IS NOT NULL
      AND NEW.event_type=ANY(installation.enabled_event_types)
      AND public.axora_slack_installation_is_authorized(
        installation.id,clock_timestamp()
      )
    ON CONFLICT(event_id,installation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.axora_enqueue_slack_delivery() FROM PUBLIC;
CREATE TRIGGER integration_events_enqueue_slack
AFTER INSERT ON public.integration_events
FOR EACH ROW EXECUTE FUNCTION public.axora_enqueue_slack_delivery();

-- Preserve the Phase II interface for administrative replay while allowing
-- the runtime worker to disable generic webhook fanout independently.
CREATE OR REPLACE FUNCTION public.axora_insert_projected_integration_event(
  p_event_type text,p_company_id uuid,p_resource_type text,p_resource_id uuid,
  p_resource_url text,p_source_name text,p_source_id uuid,p_source_version integer,
  p_occurred_at timestamptz,p_summary jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE projected_event_id uuid;
BEGIN
  IF NOT public.axora_integration_worker_allowed() THEN
    RAISE EXCEPTION 'Integration worker capability is unavailable'
      USING ERRCODE='42501';
  END IF;
  INSERT INTO public.integration_events(
    event_type,company_id,resource_type,resource_id,resource_url,
    source_name,source_id,source_version,occurred_at,summary
  ) VALUES (
    p_event_type,p_company_id,p_resource_type,p_resource_id,p_resource_url,
    p_source_name,p_source_id,p_source_version,p_occurred_at,p_summary
  )
  ON CONFLICT(source_name,source_id,event_type,schema_version) DO NOTHING
  RETURNING id INTO projected_event_id;
  IF projected_event_id IS NULL THEN RETURN false; END IF;

  IF COALESCE(
    NULLIF(current_setting('axora.integration_webhooks_enabled',true),''),
    'true'
  )::boolean THEN
    INSERT INTO public.integration_webhook_deliveries(
      event_id,subscription_id,company_id
    )
    SELECT projected_event_id,subscription.id,p_company_id
    FROM public.integration_webhook_subscriptions subscription
    WHERE subscription.company_id=p_company_id
      AND subscription.status='ACTIVE'
      AND p_event_type=ANY(subscription.event_types)
      AND public.axora_integration_subscription_is_authorized(
        subscription.id,clock_timestamp()
      )
    ON CONFLICT(event_id,subscription_id) DO NOTHING;
  END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.axora_insert_projected_integration_event(
  text,uuid,text,uuid,text,text,uuid,integer,timestamptz,jsonb
) FROM PUBLIC;

CREATE FUNCTION public.axora_project_integration_events_with_capabilities(
  p_batch_size integer,p_at timestamptz,
  p_webhooks_enabled boolean,p_slack_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NOT public.axora_integration_worker_allowed()
    OR p_webhooks_enabled IS NULL OR p_slack_enabled IS NULL
  THEN RAISE EXCEPTION 'Integration worker capability is unavailable'
    USING ERRCODE='42501'; END IF;
  PERFORM set_config(
    'axora.integration_webhooks_enabled',p_webhooks_enabled::text,true
  );
  PERFORM set_config(
    'axora.integration_slack_enabled',p_slack_enabled::text,true
  );
  RETURN public.axora_project_integration_events(p_batch_size,p_at);
END
$$;
REVOKE ALL ON FUNCTION public.axora_project_integration_events_with_capabilities(
  integer,timestamptz,boolean,boolean
) FROM PUBLIC;

CREATE FUNCTION public.axora_claim_integration_slack_deliveries(
  p_worker_id text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 45,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  delivery_id uuid,event_id uuid,installation_id uuid,connection_id uuid,
  company_id uuid,attempt_number integer,cycle_attempt_number integer,
  token_version integer,access_token_ciphertext jsonb,
  refresh_token_ciphertext jsonb,access_token_expires_at timestamptz,
  workspace_id text,channel_id text,event_type text,schema_version integer,
  occurred_at timestamptz,resource_type text,resource_id uuid,
  resource_url text,summary jsonb,lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NOT public.axora_integration_worker_allowed() THEN
    RAISE EXCEPTION 'Integration worker capability is unavailable'
      USING ERRCODE='42501';
  END IF;
  IF p_worker_id IS NULL OR p_limit IS NULL OR p_lease_seconds IS NULL
    OR p_worker_id !~ '^integration-[A-Za-z0-9_-]{8,120}$'
    OR p_limit<1 OR p_limit>50 OR p_lease_seconds<10 OR p_lease_seconds>120
    OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack claim' USING ERRCODE='22023'; END IF;

  WITH expired AS (
    SELECT delivery.*,
      LEAST(120000::numeric,GREATEST(0::numeric,
        EXTRACT(epoch FROM (p_at-COALESCE(delivery.last_attempt_at,p_at)))*1000
      ))::integer AS lease_duration_ms
    FROM public.integration_slack_deliveries delivery
    WHERE delivery.status='DELIVERING' AND delivery.lease_expires_at<=p_at
    FOR UPDATE
  ), recorded AS (
    INSERT INTO public.integration_slack_attempts(
      delivery_id,event_id,installation_id,company_id,attempt_number,
      token_version,started_at,completed_at,outcome,response_status,
      error_category,duration_ms,retry_after_seconds
    ) SELECT expired.id,expired.event_id,expired.installation_id,
      expired.company_id,expired.attempt_count,expired.lease_token_version,
      p_at-make_interval(secs=>expired.lease_duration_ms::double precision/1000),
      p_at,CASE WHEN expired.cycle_attempt_count>=8 THEN 'DEAD' ELSE 'RETRY' END,
      NULL,'LEASE_EXPIRED',expired.lease_duration_ms,
      CASE WHEN expired.cycle_attempt_count>=8 THEN NULL ELSE 1 END
    FROM expired
    ON CONFLICT ON CONSTRAINT integration_slack_attempt_unique DO NOTHING
  )
  UPDATE public.integration_slack_deliveries delivery
  SET status=CASE WHEN expired.cycle_attempt_count>=8 THEN 'DEAD' ELSE 'RETRY' END,
    leased_by=NULL,lease_token=NULL,lease_token_version=NULL,lease_expires_at=NULL,
    available_at=CASE WHEN expired.cycle_attempt_count>=8
      THEN delivery.available_at ELSE p_at+interval '1 second' END,
    completed_at=CASE WHEN expired.cycle_attempt_count>=8 THEN p_at ELSE NULL END,
    response_status=NULL,error_category='LEASE_EXPIRED',
    last_duration_ms=expired.lease_duration_ms,updated_at=p_at
  FROM expired WHERE delivery.id=expired.id;

  UPDATE public.integration_slack_installations installation
  SET status='PAUSED',pause_reason='AUTHORIZATION_REVOKED',updated_at=p_at
  WHERE installation.status='ACTIVE'
    AND NOT public.axora_slack_installation_is_authorized(installation.id,p_at);

  UPDATE public.integration_slack_deliveries delivery
  SET status='FAILED',completed_at=p_at,response_status=NULL,
    error_category=CASE WHEN installation.status='PAUSED'
      THEN 'AUTHORIZATION_REVOKED' ELSE 'INSTALLATION_INACTIVE' END,
    leased_by=NULL,lease_token=NULL,lease_token_version=NULL,
    lease_expires_at=NULL,updated_at=p_at
  FROM public.integration_slack_installations installation
  WHERE installation.id=delivery.installation_id
    AND delivery.status IN ('PENDING','RETRY')
    AND installation.status<>'ACTIVE';

  RETURN QUERY
  WITH candidates AS (
    SELECT candidate.id
    FROM public.integration_slack_installations installation
    CROSS JOIN LATERAL (
      SELECT delivery.id
      FROM public.integration_slack_deliveries delivery
      WHERE delivery.installation_id=installation.id
        AND delivery.status IN ('PENDING','RETRY')
        AND delivery.available_at<=p_at
        AND NOT EXISTS (
          SELECT 1 FROM public.integration_slack_deliveries active_delivery
          WHERE active_delivery.installation_id=installation.id
            AND active_delivery.status='DELIVERING'
        )
      ORDER BY delivery.available_at,delivery.created_at,delivery.id
      FOR UPDATE SKIP LOCKED LIMIT 1
    ) candidate
    WHERE installation.status='ACTIVE'
      AND installation.selected_channel_id IS NOT NULL
      AND public.axora_slack_installation_is_authorized(installation.id,p_at)
    ORDER BY installation.installed_at,installation.id
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.integration_slack_deliveries delivery
    SET status='DELIVERING',attempt_count=delivery.attempt_count+1,
      cycle_attempt_count=delivery.cycle_attempt_count+1,
      leased_by=p_worker_id,lease_token=gen_random_uuid(),
      lease_token_version=installation.token_version,
      lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
      first_attempt_at=COALESCE(delivery.first_attempt_at,p_at),
      last_attempt_at=p_at,response_status=NULL,error_category=NULL,
      last_duration_ms=NULL,updated_at=p_at
    FROM candidates,public.integration_slack_installations installation
    WHERE delivery.id=candidates.id
      AND installation.id=delivery.installation_id
    RETURNING delivery.*
  )
  SELECT claimed.id,claimed.event_id,claimed.installation_id,
    claimed.connection_id,claimed.company_id,claimed.attempt_count,
    claimed.cycle_attempt_count,claimed.lease_token_version,
    installation.access_token_ciphertext,
    installation.refresh_token_ciphertext,
    installation.access_token_expires_at,installation.workspace_id,
    installation.selected_channel_id,event.event_type,event.schema_version,
    event.occurred_at,event.resource_type,event.resource_id,
    event.resource_url,event.summary,claimed.lease_token
  FROM claimed
  JOIN public.integration_slack_installations installation
    ON installation.id=claimed.installation_id
  JOIN public.integration_events event ON event.id=claimed.event_id;
END
$$;
REVOKE ALL ON FUNCTION public.axora_claim_integration_slack_deliveries(
  text,integer,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_claimed_slack_delivery_is_authorized(
  p_worker_id text,p_delivery_id uuid,p_lease_token uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT p_at IS NOT NULL
    AND p_at>=clock_timestamp()-interval '5 minutes'
    AND p_at<=clock_timestamp()+interval '5 minutes'
    AND public.axora_integration_worker_allowed()
    AND EXISTS (
      SELECT 1 FROM public.integration_slack_deliveries delivery
      WHERE delivery.id=p_delivery_id AND delivery.status='DELIVERING'
        AND delivery.leased_by=p_worker_id AND delivery.lease_token=p_lease_token
        AND delivery.lease_expires_at>p_at
        AND public.axora_slack_installation_is_authorized(
          delivery.installation_id,p_at
        )
    )
$$;
REVOKE ALL ON FUNCTION public.axora_claimed_slack_delivery_is_authorized(
  text,uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_rotate_claimed_slack_token(
  p_worker_id text,p_delivery_id uuid,p_lease_token uuid,
  p_expected_token_version integer,p_access_ciphertext jsonb,
  p_refresh_ciphertext jsonb,p_access_expires_at timestamptz,
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE delivery record; next_version integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed()
    OR p_worker_id IS NULL OR p_delivery_id IS NULL OR p_lease_token IS NULL
    OR p_expected_token_version IS NULL OR p_access_expires_at IS NULL
    OR p_access_ciphertext IS NULL OR p_refresh_ciphertext IS NULL
    OR p_at IS NULL OR p_expected_token_version<1
    OR NOT public.axora_integration_ciphertext_is_valid(p_access_ciphertext)
    OR NOT public.axora_integration_ciphertext_is_valid(p_refresh_ciphertext)
    OR p_access_expires_at<=p_at+interval '5 minutes'
    OR p_access_expires_at>p_at+interval '13 hours'
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack token rotation' USING ERRCODE='22023'; END IF;
  SELECT * INTO delivery FROM public.integration_slack_deliveries
  WHERE id=p_delivery_id AND status='DELIVERING' AND leased_by=p_worker_id
    AND lease_token=p_lease_token AND lease_token_version=p_expected_token_version
    AND lease_expires_at>p_at FOR UPDATE;
  IF delivery.id IS NULL THEN
    RAISE EXCEPTION 'Slack delivery lease is unavailable' USING ERRCODE='P8601';
  END IF;
  UPDATE public.integration_slack_installations
  SET token_version=token_version+1,
    access_token_ciphertext=p_access_ciphertext,
    refresh_token_ciphertext=p_refresh_ciphertext,
    access_token_expires_at=p_access_expires_at,updated_at=p_at
  WHERE id=delivery.installation_id AND status='ACTIVE'
    AND token_version=p_expected_token_version
  RETURNING token_version INTO next_version;
  IF next_version IS NULL THEN
    RAISE EXCEPTION 'Slack installation token changed' USING ERRCODE='P8601';
  END IF;
  UPDATE public.integration_slack_deliveries
  SET lease_token_version=next_version,updated_at=p_at
  WHERE id=delivery.id;
  RETURN next_version;
END
$$;
REVOKE ALL ON FUNCTION public.axora_rotate_claimed_slack_token(
  text,uuid,uuid,integer,jsonb,jsonb,timestamptz,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_complete_integration_slack_delivery(
  p_worker_id text,p_delivery_id uuid,p_lease_token uuid,p_outcome text,
  p_response_status integer,p_error_category text,p_duration_ms integer,
  p_retry_after_seconds integer,p_token_version integer,
  p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE delivery record; final_status text; safe_retry integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed()
    OR p_worker_id IS NULL OR p_delivery_id IS NULL OR p_lease_token IS NULL
    OR p_outcome IS NULL OR p_duration_ms IS NULL OR p_token_version IS NULL
    OR p_at IS NULL OR p_outcome NOT IN ('SUCCEEDED','RETRY','FAILED')
    OR p_duration_ms<0 OR p_duration_ms>120000 OR p_token_version<1
    OR (p_response_status IS NOT NULL AND (p_response_status<100 OR p_response_status>599))
    OR (p_retry_after_seconds IS NOT NULL
      AND (p_retry_after_seconds<1 OR p_retry_after_seconds>86400))
    OR (p_error_category IS NOT NULL AND p_error_category NOT IN (
      'NETWORK_ERROR','TIMEOUT','RATE_LIMITED','PROVIDER_UNAVAILABLE',
      'INVALID_RESPONSE','TOKEN_REVOKED','MISSING_SCOPE',
      'CHANNEL_UNAVAILABLE','PROVIDER_REJECTED',
      'AUTHORIZATION_REVOKED','INSTALLATION_INACTIVE'
    ))
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack completion' USING ERRCODE='22023'; END IF;
  IF p_outcome='SUCCEEDED' AND (
    p_response_status IS DISTINCT FROM 200 OR p_error_category IS NOT NULL
  ) THEN RAISE EXCEPTION 'Invalid successful Slack completion'
    USING ERRCODE='22023'; END IF;
  IF p_outcome<>'SUCCEEDED' AND p_error_category IS NULL THEN
    RAISE EXCEPTION 'Failed Slack completion requires a safe category'
      USING ERRCODE='22023';
  END IF;
  SELECT * INTO delivery FROM public.integration_slack_deliveries
  WHERE id=p_delivery_id AND status='DELIVERING' AND leased_by=p_worker_id
    AND lease_token=p_lease_token FOR UPDATE;
  IF delivery.id IS NULL OR delivery.lease_token_version<>p_token_version THEN
    RAISE EXCEPTION 'Slack delivery lease is unavailable' USING ERRCODE='P8601';
  END IF;
  safe_retry:=LEAST(86400,GREATEST(1,COALESCE(p_retry_after_seconds,30)));
  final_status:=CASE
    WHEN p_outcome='SUCCEEDED' THEN 'SUCCEEDED'
    WHEN p_outcome='FAILED' THEN 'FAILED'
    WHEN delivery.cycle_attempt_count>=8 THEN 'DEAD'
    ELSE 'RETRY' END;

  UPDATE public.integration_slack_deliveries
  SET status=final_status,leased_by=NULL,lease_token=NULL,
    lease_token_version=NULL,lease_expires_at=NULL,
    available_at=CASE WHEN final_status='RETRY'
      THEN p_at+make_interval(secs=>safe_retry) ELSE available_at END,
    completed_at=CASE WHEN final_status IN ('SUCCEEDED','FAILED','DEAD')
      THEN p_at ELSE NULL END,
    response_status=p_response_status,error_category=p_error_category,
    last_duration_ms=p_duration_ms,updated_at=p_at
  WHERE id=p_delivery_id;

  INSERT INTO public.integration_slack_attempts(
    delivery_id,event_id,installation_id,company_id,attempt_number,
    token_version,started_at,completed_at,outcome,response_status,
    error_category,duration_ms,retry_after_seconds
  ) VALUES (
    delivery.id,delivery.event_id,delivery.installation_id,delivery.company_id,
    delivery.attempt_count,p_token_version,
    p_at-make_interval(secs=>p_duration_ms::double precision/1000),p_at,
    final_status,p_response_status,p_error_category,p_duration_ms,
    CASE WHEN final_status='RETRY' THEN safe_retry ELSE NULL END
  );

  IF p_error_category IN ('TOKEN_REVOKED','MISSING_SCOPE') THEN
    UPDATE public.integration_connections
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,p_at),
      revoke_reason=COALESCE(revoke_reason,
        CASE WHEN p_error_category='TOKEN_REVOKED'
          THEN 'Slack token revoked by provider' ELSE 'Slack scopes revoked by provider' END
      ),updated_at=p_at
    WHERE id=delivery.connection_id AND status='ACTIVE';
    UPDATE public.integration_slack_installations
    SET status='REVOKED',pause_reason=NULL,
      revocation_requested_at=COALESCE(revocation_requested_at,p_at),
      revoked_at=p_at,revoke_reason=COALESCE(revoke_reason,
        CASE WHEN p_error_category='TOKEN_REVOKED'
          THEN 'Slack token revoked by provider' ELSE 'Slack scopes revoked by provider' END
      ),access_token_ciphertext=NULL,refresh_token_ciphertext=NULL,
      access_token_expires_at=NULL,selected_channel_id=NULL,
      selected_channel_name=NULL,updated_at=p_at
    WHERE id=delivery.installation_id;
  ELSIF p_error_category='CHANNEL_UNAVAILABLE' THEN
    UPDATE public.integration_slack_installations
    SET selected_channel_id=NULL,selected_channel_name=NULL,updated_at=p_at
    WHERE id=delivery.installation_id;
  END IF;
  RETURN final_status;
END
$$;
REVOKE ALL ON FUNCTION public.axora_complete_integration_slack_delivery(
  text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_claim_slack_revocations(
  p_worker_id text,p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 45,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  installation_id uuid,token_version integer,access_token_ciphertext jsonb,
  refresh_token_ciphertext jsonb,attempt_number integer,lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NOT public.axora_integration_worker_allowed()
    OR p_worker_id IS NULL OR p_limit IS NULL OR p_lease_seconds IS NULL
    OR p_at IS NULL OR p_worker_id !~ '^integration-[A-Za-z0-9_-]{8,120}$'
    OR p_limit<1 OR p_limit>20 OR p_lease_seconds<10 OR p_lease_seconds>120
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack revocation claim'
    USING ERRCODE='22023'; END IF;

  UPDATE public.integration_slack_installations
  SET revocation_leased_by=NULL,revocation_lease_token=NULL,
    revocation_lease_expires_at=NULL,
    revocation_available_at=p_at+interval '1 second',
    revocation_error_category='NETWORK_ERROR',updated_at=p_at
  WHERE status='REVOKING' AND revocation_lease_expires_at<=p_at;

  RETURN QUERY
  WITH candidates AS (
    SELECT installation.id
    FROM public.integration_slack_installations installation
    WHERE installation.status='REVOKING'
      AND installation.revocation_available_at<=p_at
      AND installation.revocation_attempt_count<8
      AND installation.revocation_lease_token IS NULL
    ORDER BY installation.revocation_available_at,installation.installed_at,
      installation.id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.integration_slack_installations installation
    SET revocation_attempt_count=installation.revocation_attempt_count+1,
      revocation_leased_by=p_worker_id,revocation_lease_token=gen_random_uuid(),
      revocation_lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
      revocation_error_category=NULL,updated_at=p_at
    FROM candidates WHERE installation.id=candidates.id
    RETURNING installation.*
  )
  SELECT claimed.id,claimed.token_version,claimed.access_token_ciphertext,
    claimed.refresh_token_ciphertext,claimed.revocation_attempt_count,
    claimed.revocation_lease_token
  FROM claimed;
END
$$;
REVOKE ALL ON FUNCTION public.axora_claim_slack_revocations(
  text,integer,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_complete_slack_revocation(
  p_worker_id text,p_installation_id uuid,p_lease_token uuid,
  p_succeeded boolean,p_error_category text,p_retry_after_seconds integer,
  p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE installation record; final_status text; safe_retry integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed()
    OR p_worker_id IS NULL OR p_installation_id IS NULL
    OR p_lease_token IS NULL OR p_at IS NULL OR p_succeeded IS NULL
    OR (p_succeeded AND p_error_category IS NOT NULL)
    OR (NOT p_succeeded AND p_error_category NOT IN (
      'NETWORK_ERROR','PROVIDER_UNAVAILABLE','RATE_LIMITED','INVALID_RESPONSE'
    ))
    OR (p_retry_after_seconds IS NOT NULL
      AND (p_retry_after_seconds<1 OR p_retry_after_seconds>86400))
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack revocation completion'
    USING ERRCODE='22023'; END IF;
  SELECT * INTO installation FROM public.integration_slack_installations
  WHERE id=p_installation_id AND status='REVOKING'
    AND revocation_leased_by=p_worker_id
    AND revocation_lease_token=p_lease_token FOR UPDATE;
  IF installation.id IS NULL THEN
    RAISE EXCEPTION 'Slack revocation lease is unavailable' USING ERRCODE='P8601';
  END IF;
  safe_retry:=LEAST(86400,GREATEST(1,COALESCE(p_retry_after_seconds,30)));
  final_status:=CASE WHEN p_succeeded THEN 'REVOKED'
    WHEN installation.revocation_attempt_count>=8 THEN 'REVOKED'
    ELSE 'REVOKING' END;
  UPDATE public.integration_slack_installations
  SET status=final_status,
    revoked_at=CASE WHEN final_status='REVOKED' THEN p_at ELSE NULL END,
    revocation_available_at=CASE WHEN final_status='REVOKING'
      THEN p_at+make_interval(secs=>safe_retry) ELSE revocation_available_at END,
    revocation_leased_by=NULL,revocation_lease_token=NULL,
    revocation_lease_expires_at=NULL,
    revocation_error_category=CASE
      WHEN p_succeeded THEN NULL
      WHEN final_status='REVOKED' THEN 'REVOCATION_DEAD'
      ELSE p_error_category END,
    access_token_ciphertext=CASE WHEN final_status='REVOKED'
      THEN NULL ELSE access_token_ciphertext END,
    refresh_token_ciphertext=CASE WHEN final_status='REVOKED'
      THEN NULL ELSE refresh_token_ciphertext END,
    access_token_expires_at=CASE WHEN final_status='REVOKED'
      THEN NULL ELSE access_token_expires_at END,
    updated_at=p_at
  WHERE id=installation.id;
  RETURN final_status;
END
$$;
REVOKE ALL ON FUNCTION public.axora_complete_slack_revocation(
  text,uuid,uuid,boolean,text,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_revoke_connection_slack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF OLD.status='ACTIVE' AND NEW.status='REVOKED' THEN
    UPDATE public.integration_slack_installations
    SET status='REVOKING',pause_reason=NULL,
      selected_channel_id=NULL,selected_channel_name=NULL,
      revocation_requested_at=COALESCE(revocation_requested_at,NEW.revoked_at,now()),
      revoked_by=COALESCE(revoked_by,NEW.revoked_by),
      revoke_reason=COALESCE(revoke_reason,'Slack connection revoked'),
      revocation_available_at=now(),updated_at=now()
    WHERE connection_id=NEW.id AND status IN ('ACTIVE','PAUSED');
    UPDATE public.integration_slack_deliveries delivery
    SET status='FAILED',completed_at=now(),
      error_category='INSTALLATION_INACTIVE',response_status=NULL,
      leased_by=NULL,lease_token=NULL,lease_token_version=NULL,
      lease_expires_at=NULL,updated_at=now()
    FROM public.integration_slack_installations installation
    WHERE installation.connection_id=NEW.id
      AND delivery.installation_id=installation.id
      AND delivery.status IN ('PENDING','RETRY','DELIVERING');
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.axora_revoke_connection_slack() FROM PUBLIC;
CREATE TRIGGER integration_connections_revoke_slack
AFTER UPDATE OF status ON public.integration_connections
FOR EACH ROW EXECUTE FUNCTION public.axora_revoke_connection_slack();

CREATE FUNCTION public.axora_cleanup_slack_runtime(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE states_removed integer; attempts_removed integer;
  deliveries_removed integer; inbound_removed integer; installations_removed integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed() OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid Slack cleanup timestamp'
    USING ERRCODE='22023'; END IF;
  WITH candidates AS (
    SELECT id FROM public.integration_slack_oauth_states
    WHERE expires_at<p_at-interval '1 day'
    ORDER BY expires_at,id LIMIT 10000
  ) DELETE FROM public.integration_slack_oauth_states state
    USING candidates WHERE state.id=candidates.id;
  GET DIAGNOSTICS states_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT id FROM public.integration_slack_attempts
    WHERE completed_at<p_at-interval '90 days'
    ORDER BY completed_at,id LIMIT 10000
  ) DELETE FROM public.integration_slack_attempts attempt
    USING candidates WHERE attempt.id=candidates.id;
  GET DIAGNOSTICS attempts_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT id FROM public.integration_slack_deliveries
    WHERE completed_at<p_at-interval '90 days'
      AND status IN ('SUCCEEDED','FAILED','DEAD')
    ORDER BY completed_at,id LIMIT 10000
  ) DELETE FROM public.integration_slack_deliveries delivery
    USING candidates WHERE delivery.id=candidates.id;
  GET DIAGNOSTICS deliveries_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT event_id FROM public.integration_slack_inbound_events
    WHERE received_at<p_at-interval '90 days'
    ORDER BY received_at,event_id LIMIT 10000
  ) DELETE FROM public.integration_slack_inbound_events event
    USING candidates WHERE event.event_id=candidates.event_id;
  GET DIAGNOSTICS inbound_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT id FROM public.integration_slack_installations
    WHERE status='REVOKED' AND revoked_at<p_at-interval '180 days'
    ORDER BY revoked_at,id LIMIT 1000
  ) DELETE FROM public.integration_slack_installations installation
    USING candidates WHERE installation.id=candidates.id;
  GET DIAGNOSTICS installations_removed=ROW_COUNT;
  RETURN jsonb_build_object(
    'statesRemoved',states_removed,'attemptsRemoved',attempts_removed,
    'deliveriesRemoved',deliveries_removed,'inboundRemoved',inbound_removed,
    'installationsRemoved',installations_removed
  );
END
$$;
REVOKE ALL ON FUNCTION public.axora_cleanup_slack_runtime(timestamptz)
  FROM PUBLIC;

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('integration_slack_oauth_states','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Short-lived Slack OAuth CSRF state contains no durable business evidence.'),
  ('integration_slack_installations','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Encrypted provider credentials are tenant-owned integration authorization state.'),
  ('integration_slack_channels','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Cached public Slack channel identifiers are disposable provider metadata.'),
  ('integration_slack_deliveries','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Slack queue entries are isolated operational metadata, not business records.'),
  ('integration_slack_attempts','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Slack attempt rows contain safe categories and no provider response body.'),
  ('integration_slack_inbound_events','RETAIN_WITH_ACCESS_REVOKED','RETAIN_WITH_ACCESS_REVOKED',
    'Signed provider revocation evidence is retained without payload bodies.')
ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT maximum.delete_order+ordered.ordinality::integer,ordered.table_name,
  'Reviewed Slack operational state; child records precede installations and retained inbound evidence remains classified.'
FROM unnest(ARRAY[
  'integration_slack_attempts','integration_slack_deliveries',
  'integration_slack_channels','integration_slack_oauth_states',
  'integration_slack_installations','integration_slack_inbound_events'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
CROSS JOIN (
  SELECT COALESCE(max(existing.delete_order),0) AS delete_order
  FROM public.company_deletion_ownership_dag existing
) maximum
ON CONFLICT(table_name) DO NOTHING;

DO $tables$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'integration_slack_oauth_states','integration_slack_installations',
    'integration_slack_channels','integration_slack_deliveries',
    'integration_slack_attempts','integration_slack_inbound_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.axora_integration_context_allowed()) WITH CHECK (public.axora_integration_context_allowed())',
      table_name||'_integration_context',table_name
    );
  END LOOP;
END
$tables$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE
      public.integration_slack_oauth_states,
      public.integration_slack_installations,
      public.integration_slack_channels,
      public.integration_slack_inbound_events
    TO axora_app;
    GRANT SELECT,UPDATE ON TABLE public.integration_slack_deliveries TO axora_app;
    GRANT SELECT ON TABLE public.integration_slack_attempts TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_slack_installation_is_authorized(
      uuid,timestamptz
    ) TO axora_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_integration_worker') THEN
    REVOKE EXECUTE ON FUNCTION
      public.axora_project_integration_events(integer,timestamptz)
    FROM axora_integration_worker;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM axora_integration_worker;
    GRANT EXECUTE ON FUNCTION
      public.axora_project_integration_events_with_capabilities(
        integer,timestamptz,boolean,boolean
      ),
      public.axora_claim_integration_webhook_deliveries(
        text,integer,integer,timestamptz
      ),
      public.axora_claimed_webhook_delivery_is_authorized(
        text,uuid,uuid,timestamptz
      ),
      public.axora_complete_integration_webhook_delivery(
        text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz
      ),
      public.axora_claim_integration_slack_deliveries(
        text,integer,integer,timestamptz
      ),
      public.axora_claimed_slack_delivery_is_authorized(
        text,uuid,uuid,timestamptz
      ),
      public.axora_rotate_claimed_slack_token(
        text,uuid,uuid,integer,jsonb,jsonb,timestamptz,timestamptz
      ),
      public.axora_complete_integration_slack_delivery(
        text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz
      ),
      public.axora_claim_slack_revocations(text,integer,integer,timestamptz),
      public.axora_complete_slack_revocation(
        text,uuid,uuid,boolean,text,integer,timestamptz
      ),
      public.axora_cleanup_integration_runtime(timestamptz),
      public.axora_cleanup_slack_runtime(timestamptz)
    TO axora_integration_worker;
  END IF;
END
$grants$;

COMMENT ON TABLE public.integration_slack_installations IS
  'Company-scoped Slack installations. Provider tokens are AES-256-GCM ciphertext under dedicated integration key material and are never displayed.';
COMMENT ON TABLE public.integration_slack_deliveries IS
  'Asynchronous Slack message jobs derived from committed integration events; no business transaction depends on this queue.';
COMMENT ON TABLE public.integration_slack_attempts IS
  'Bounded Slack attempt metadata with safe categories only; request and response bodies and provider tokens are never stored.';

DO $assertions$
BEGIN
  IF to_regclass('public.transactional_email_outbox') IS NULL
    OR to_regclass('public.workflow_email_outbox') IS NULL
  THEN RAISE EXCEPTION 'Existing email boundaries are unavailable'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='public'
      AND table_name LIKE 'integration_slack_%'
      AND constraint_name ILIKE '%email%'
  ) THEN RAISE EXCEPTION 'Slack integration was coupled to email storage'; END IF;
END
$assertions$;

COMMIT;
