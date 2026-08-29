BEGIN;

-- The webhook platform is deliberately independent from both Axora email
-- outboxes and every synchronous procurement transaction. Canonical business
-- state is projected later by a least-privilege worker.

CREATE OR REPLACE FUNCTION public.axora_integration_ciphertext_is_valid(
  p_value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT p_value IS NOT NULL
    AND jsonb_typeof(p_value)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_value) key)
      = ARRAY['ciphertext','nonce','tag','version']::text[]
    AND jsonb_typeof(p_value->'version')='number'
    AND p_value->'version'='1'::jsonb
    AND jsonb_typeof(p_value->'nonce')='string'
    AND p_value->>'nonce' ~ '^[A-Za-z0-9_-]{16}$'
    AND jsonb_typeof(p_value->'ciphertext')='string'
    AND char_length(p_value->>'ciphertext') BETWEEN 1 AND 4096
    AND p_value->>'ciphertext' ~ '^[A-Za-z0-9_-]+$'
    AND jsonb_typeof(p_value->'tag')='string'
    AND p_value->>'tag' ~ '^[A-Za-z0-9_-]{22}$'
$$;
REVOKE ALL ON FUNCTION public.axora_integration_ciphertext_is_valid(jsonb)
  FROM PUBLIC;

CREATE TABLE public.integration_projection_checkpoints (
  source_name text PRIMARY KEY CHECK (source_name IN (
    'COMPANIES','REQUESTS','REQUEST_DECISIONS','INVOICES','WORKFLOW_EVENTS'
  )),
  cursor_at timestamptz NOT NULL,
  cursor_id uuid NOT NULL,
  projected_count bigint NOT NULL DEFAULT 0 CHECK (projected_count>=0),
  last_projected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'company.created',
    'request.created','request.submitted','request.approved','request.rejected',
    'invoice.finalized',
    'delivery.out_for_delivery','delivery.arrived','delivery.delivered',
    'delivery.completed'
  )),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  company_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (
    resource_type IN ('company','request','invoice','delivery')
  ),
  resource_id uuid NOT NULL,
  resource_url text NOT NULL CHECK (
    char_length(resource_url) BETWEEN 1 AND 500
    AND resource_url ~ '^/[^/].*'
    AND resource_url !~ '://'
    AND resource_url !~ '[[:cntrl:]]'
  ),
  source_name text NOT NULL CHECK (source_name IN (
    'COMPANIES','REQUESTS','REQUEST_DECISIONS','INVOICES','WORKFLOW_EVENTS'
  )),
  source_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version>0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(summary)='object'
    AND octet_length(summary::text)<=4096
    AND public.workflow_metadata_is_safe(summary)
  ),
  UNIQUE(source_name,source_id,event_type,schema_version),
  UNIQUE(id,company_id),
  CHECK (occurred_at<=recorded_at+interval '5 minutes')
);
CREATE INDEX integration_events_company_time_idx
  ON public.integration_events(company_id,recorded_at DESC,id DESC);
CREATE INDEX integration_events_resource_idx
  ON public.integration_events(company_id,resource_type,resource_id,occurred_at DESC);

-- Integration events are immutable while operationally relevant. The worker
-- may prune only events older than the documented retention window and only
-- after all delivery metadata has already been removed.
CREATE FUNCTION public.axora_protect_integration_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='DELETE'
    AND session_user IN ('postgres','axora_integration_worker')
    AND OLD.recorded_at<clock_timestamp()-interval '180 days'
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'integration_events is immutable; % is not permitted',TG_OP
    USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.axora_protect_integration_event() FROM PUBLIC;
CREATE TRIGGER integration_events_immutable
BEFORE UPDATE OR DELETE ON public.integration_events
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_integration_event();

CREATE TABLE public.integration_webhook_subscriptions (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  endpoint_ciphertext jsonb NOT NULL CHECK (
    public.axora_integration_ciphertext_is_valid(endpoint_ciphertext)
  ),
  endpoint_hash text NOT NULL CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  endpoint_origin text NOT NULL CHECK (
    char_length(endpoint_origin) BETWEEN 9 AND 300
    AND endpoint_origin ~ '^https://'
    AND endpoint_origin !~ '[[:cntrl:]@]'
  ),
  event_types text[] NOT NULL CHECK (
    cardinality(event_types) BETWEEN 1 AND 10
    AND array_position(event_types,NULL) IS NULL
    AND event_types <@ ARRAY[
      'company.created',
      'request.created','request.submitted','request.approved','request.rejected',
      'invoice.finalized',
      'delivery.out_for_delivery','delivery.arrived','delivery.delivered',
      'delivery.completed'
    ]::text[]
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','PAUSED','REVOKED')
  ),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version>0),
  current_credential_ciphertext jsonb NOT NULL CHECK (
    public.axora_integration_ciphertext_is_valid(current_credential_ciphertext)
  ),
  previous_credential_ciphertext jsonb CHECK (
    previous_credential_ciphertext IS NULL
    OR public.axora_integration_ciphertext_is_valid(previous_credential_ciphertext)
  ),
  previous_credential_valid_until timestamptz,
  authorized_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  authorized_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  auth_version_at_authorization integer NOT NULL CHECK (
    auth_version_at_authorization>0
  ),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  pause_reason text CHECK (
    pause_reason IS NULL OR pause_reason IN ('AUTHORIZATION_REVOKED','OPERATOR_PAUSED')
  ),
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
  ),
  FOREIGN KEY(connection_id,application_id,company_id)
    REFERENCES public.integration_connections(id,application_id,company_id)
    ON DELETE CASCADE,
  UNIQUE(id,company_id),
  UNIQUE(id,connection_id,company_id),
  CHECK (
    (previous_credential_ciphertext IS NULL
      AND previous_credential_valid_until IS NULL)
    OR (previous_credential_ciphertext IS NOT NULL
      AND previous_credential_valid_until IS NOT NULL)
  ),
  CHECK (
    (status='ACTIVE' AND paused_at IS NULL AND pause_reason IS NULL
      AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='PAUSED' AND paused_at IS NOT NULL AND pause_reason IS NOT NULL
      AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX integration_webhook_subscriptions_active_endpoint_uq
  ON public.integration_webhook_subscriptions(connection_id,endpoint_hash)
  WHERE status<>'REVOKED';
CREATE INDEX integration_webhook_subscriptions_company_idx
  ON public.integration_webhook_subscriptions(company_id,status,created_at DESC,id DESC);
CREATE INDEX integration_webhook_subscriptions_active_scan_idx
  ON public.integration_webhook_subscriptions(id)
  WHERE status='ACTIVE';
CREATE INDEX integration_webhook_subscriptions_previous_secret_expiry_idx
  ON public.integration_webhook_subscriptions(previous_credential_valid_until,id)
  WHERE previous_credential_valid_until IS NOT NULL;
CREATE INDEX integration_webhook_subscriptions_revoked_retention_idx
  ON public.integration_webhook_subscriptions(revoked_at,id)
  WHERE status='REVOKED';

CREATE TABLE public.integration_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','DELIVERING','SUCCEEDED','RETRY','FAILED','DEAD')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
  cycle_attempt_count integer NOT NULL DEFAULT 0 CHECK (
    cycle_attempt_count BETWEEN 0 AND 20
  ),
  manual_retry_count integer NOT NULL DEFAULT 0 CHECK (
    manual_retry_count BETWEEN 0 AND 3
  ),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_by text CHECK (
    leased_by IS NULL OR leased_by ~ '^integration-[A-Za-z0-9_-]{8,120}$'
  ),
  lease_token uuid,
  lease_credential_version integer CHECK (
    lease_credential_version IS NULL OR lease_credential_version>0
  ),
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  error_category text CHECK (error_category IS NULL OR error_category IN (
    'HTTP_CLIENT_ERROR','HTTP_SERVER_ERROR','RATE_LIMITED','NETWORK_TIMEOUT',
    'CONNECTION_ERROR','DNS_ERROR','TLS_ERROR','SSRF_BLOCKED',
    'REDIRECT_REJECTED','RESPONSE_TOO_LARGE','SUBSCRIPTION_INACTIVE',
    'AUTHORIZATION_REVOKED','CONFIGURATION_ERROR','LEASE_EXPIRED','UNKNOWN'
  )),
  last_duration_ms integer CHECK (
    last_duration_ms IS NULL OR last_duration_ms BETWEEN 0 AND 120000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,company_id)
    REFERENCES public.integration_events(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,company_id)
    REFERENCES public.integration_webhook_subscriptions(id,company_id)
    ON DELETE CASCADE,
  UNIQUE(event_id,subscription_id),
  UNIQUE(id,event_id,subscription_id,company_id),
  CHECK (
    (status='DELIVERING' AND leased_by IS NOT NULL AND lease_token IS NOT NULL
      AND lease_credential_version IS NOT NULL
      AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status<>'DELIVERING' AND leased_by IS NULL AND lease_token IS NULL
      AND lease_credential_version IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status IN ('PENDING','RETRY','DELIVERING') AND completed_at IS NULL)
    OR (status IN ('SUCCEEDED','FAILED','DEAD') AND completed_at IS NOT NULL)
  ),
  CHECK (status<>'SUCCEEDED' OR error_category IS NULL)
);
CREATE INDEX integration_webhook_deliveries_claim_idx
  ON public.integration_webhook_deliveries(status,available_at,created_at,id)
  WHERE status IN ('PENDING','RETRY','DELIVERING');
CREATE INDEX integration_webhook_deliveries_company_idx
  ON public.integration_webhook_deliveries(company_id,created_at DESC,id DESC);
CREATE INDEX integration_webhook_deliveries_retention_idx
  ON public.integration_webhook_deliveries(completed_at,id)
  WHERE status IN ('SUCCEEDED','FAILED','DEAD');

CREATE TABLE public.integration_webhook_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL,
  event_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number>0),
  credential_version integer NOT NULL CHECK (credential_version>0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED','RETRY','FAILED','DEAD')),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  error_category text CHECK (error_category IS NULL OR error_category IN (
    'HTTP_CLIENT_ERROR','HTTP_SERVER_ERROR','RATE_LIMITED','NETWORK_TIMEOUT',
    'CONNECTION_ERROR','DNS_ERROR','TLS_ERROR','SSRF_BLOCKED',
    'REDIRECT_REJECTED','RESPONSE_TOO_LARGE','SUBSCRIPTION_INACTIVE',
    'AUTHORIZATION_REVOKED','CONFIGURATION_ERROR','LEASE_EXPIRED','UNKNOWN'
  )),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 0 AND 120000),
  retry_after_seconds integer CHECK (
    retry_after_seconds IS NULL OR retry_after_seconds BETWEEN 1 AND 86400
  ),
  FOREIGN KEY(delivery_id,event_id,subscription_id,company_id)
    REFERENCES public.integration_webhook_deliveries(
      id,event_id,subscription_id,company_id
    ) ON DELETE CASCADE,
  CONSTRAINT integration_webhook_attempt_unique
    UNIQUE(delivery_id,attempt_number),
  CHECK (completed_at>=started_at),
  CHECK ((outcome='SUCCEEDED')=(error_category IS NULL))
);
CREATE INDEX integration_webhook_attempts_delivery_idx
  ON public.integration_webhook_attempts(delivery_id,attempt_number DESC);
CREATE INDEX integration_webhook_attempts_retention_idx
  ON public.integration_webhook_attempts(completed_at,id);

-- Retention indexes for Phase I runtime records. The original lookup indexes
-- remain unchanged; these support the worker's bounded cleanup scans without
-- coupling request latency to table growth.
CREATE INDEX integration_oauth_authorization_requests_retention_idx
  ON public.integration_oauth_authorization_requests(expires_at,id);
CREATE INDEX integration_oauth_authorization_codes_retention_idx
  ON public.integration_oauth_authorization_codes(expires_at,id);
CREATE INDEX integration_oauth_access_tokens_expiry_retention_idx
  ON public.integration_oauth_access_tokens(expires_at,id);
CREATE INDEX integration_oauth_access_tokens_revoked_retention_idx
  ON public.integration_oauth_access_tokens(revoked_at,id)
  WHERE revoked_at IS NOT NULL;
CREATE INDEX integration_oauth_refresh_families_retention_idx
  ON public.integration_oauth_refresh_families(revoked_at,id)
  WHERE status<>'ACTIVE';
CREATE INDEX integration_oauth_refresh_families_expiry_idx
  ON public.integration_oauth_refresh_families(expires_at,id)
  WHERE status='ACTIVE';
CREATE INDEX integration_request_drafts_expiry_idx
  ON public.integration_request_drafts(expires_at,id)
  WHERE status='PENDING_REVIEW';
CREATE INDEX integration_events_retention_idx
  ON public.integration_events(recorded_at,id);

-- The asynchronous projector advances tuple cursors over immutable creation or
-- decision evidence. Dedicated indexes prevent its polling work from turning
-- into full scans of core tables as Axora grows; they do not alter core rows or
-- synchronous business functions.
CREATE INDEX integration_projector_companies_cursor_idx
  ON public.companies(created_at,id);
CREATE INDEX integration_projector_requests_cursor_idx
  ON public.requests(created_at,id);
CREATE INDEX integration_projector_request_decisions_cursor_idx
  ON public.request_approval_decisions(decided_at,id);
CREATE INDEX integration_projector_customer_invoices_cursor_idx
  ON public.invoices(finalized_at,id)
  WHERE direction='CUSTOMER' AND lifecycle_status='FINALIZED'
    AND finalized_at IS NOT NULL;
CREATE INDEX integration_projector_delivery_events_cursor_idx
  ON public.workflow_events(recorded_at,id)
  WHERE aggregate_type='delivery-job'
    AND event_key IN (
      'delivery.out_for_delivery','delivery.arrived',
      'delivery.delivered','delivery.completed'
    );

-- Existing production rows form the dark-launch baseline. Only canonical rows
-- committed after migration 129 are projected automatically.
INSERT INTO public.integration_projection_checkpoints(source_name,cursor_at,cursor_id)
VALUES
  ('COMPANIES',
    COALESCE((SELECT created_at FROM public.companies ORDER BY created_at DESC,id DESC LIMIT 1),'epoch'::timestamptz),
    COALESCE((SELECT id FROM public.companies ORDER BY created_at DESC,id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid)),
  ('REQUESTS',
    COALESCE((SELECT created_at FROM public.requests ORDER BY created_at DESC,id DESC LIMIT 1),'epoch'::timestamptz),
    COALESCE((SELECT id FROM public.requests ORDER BY created_at DESC,id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid)),
  ('REQUEST_DECISIONS',
    COALESCE((SELECT decided_at FROM public.request_approval_decisions ORDER BY decided_at DESC,id DESC LIMIT 1),'epoch'::timestamptz),
    COALESCE((SELECT id FROM public.request_approval_decisions ORDER BY decided_at DESC,id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid)),
  ('INVOICES',
    COALESCE((SELECT finalized_at FROM public.invoices WHERE direction='CUSTOMER' AND lifecycle_status='FINALIZED' AND finalized_at IS NOT NULL ORDER BY finalized_at DESC,id DESC LIMIT 1),'epoch'::timestamptz),
    COALESCE((SELECT id FROM public.invoices WHERE direction='CUSTOMER' AND lifecycle_status='FINALIZED' AND finalized_at IS NOT NULL ORDER BY finalized_at DESC,id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid)),
  ('WORKFLOW_EVENTS',
    COALESCE((SELECT recorded_at FROM public.workflow_events ORDER BY recorded_at DESC,id DESC LIMIT 1),'epoch'::timestamptz),
    COALESCE((SELECT id FROM public.workflow_events ORDER BY recorded_at DESC,id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid));

CREATE FUNCTION public.axora_integration_worker_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT session_user IN ('postgres','axora_integration_worker')
$$;
REVOKE ALL ON FUNCTION public.axora_integration_worker_allowed() FROM PUBLIC;

CREATE FUNCTION public.axora_integration_subscription_is_authorized(
  p_subscription_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE subscription record; actor_snapshot jsonb;
BEGIN
  IF p_subscription_id IS NULL OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RETURN false; END IF;
  SELECT webhook.*,account.auth_version
  INTO subscription
  FROM public.integration_webhook_subscriptions webhook
  JOIN public.integration_applications application
    ON application.id=webhook.application_id AND application.status='ACTIVE'
  JOIN public.integration_connections connection
    ON connection.id=webhook.connection_id
   AND connection.application_id=webhook.application_id
   AND connection.company_id=webhook.company_id
   AND connection.status='ACTIVE'
  JOIN public.users account
    ON account.id=webhook.authorized_user_id
   AND account.active AND account.account_status='ACTIVE'
   AND account.account_setup_completed_at IS NOT NULL
   AND account.auth_version=webhook.auth_version_at_authorization
  JOIN public.role_assignments assignment
    ON assignment.id=webhook.authorized_role_assignment_id
   AND assignment.user_id=webhook.authorized_user_id
   AND assignment.active AND assignment.revoked_at IS NULL
  WHERE webhook.id=p_subscription_id AND webhook.status='ACTIVE';
  IF subscription.id IS NULL THEN RETURN false; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    subscription.authorized_user_id,
    subscription.authorized_role_assignment_id,p_at
  );
  RETURN actor_snapshot IS NOT NULL
    AND (actor_snapshot->>'authVersion')::integer
      = subscription.auth_version_at_authorization
    AND public.axora_snapshot_has_permission(
      actor_snapshot,'integration.connection.manage','COMPANY',
      subscription.company_id,NULL,NULL,NULL
    );
END
$$;
REVOKE ALL ON FUNCTION public.axora_integration_subscription_is_authorized(
  uuid,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_insert_projected_integration_event(
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
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.axora_insert_projected_integration_event(
  text,uuid,text,uuid,text,text,uuid,integer,timestamptz,jsonb
) FROM PUBLIC;

CREATE FUNCTION public.axora_project_integration_events(
  p_batch_size integer DEFAULT 100,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE checkpoint record; candidate record; source_scanned integer;
  total_scanned integer:=0; total_projected integer:=0; inserted boolean;
BEGIN
  IF NOT public.axora_integration_worker_allowed() THEN
    RAISE EXCEPTION 'Integration worker capability is unavailable'
      USING ERRCODE='42501';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>500 OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN
    RAISE EXCEPTION 'Invalid integration projection batch' USING ERRCODE='22023';
  END IF;

  FOR checkpoint IN
    SELECT * FROM public.integration_projection_checkpoints
    ORDER BY source_name FOR UPDATE SKIP LOCKED
  LOOP
    source_scanned:=0;
    IF checkpoint.source_name='COMPANIES' THEN
      FOR candidate IN
        SELECT company.id AS source_id,company.created_at AS cursor_at,
          company.id AS company_id,company.id AS resource_id,
          jsonb_build_object(
            'company_code',company.company_code,'company_name',company.name
          ) AS summary
        FROM public.companies company
        WHERE (company.created_at,company.id)>(checkpoint.cursor_at,checkpoint.cursor_id)
        ORDER BY company.created_at,company.id LIMIT p_batch_size
      LOOP
        source_scanned:=source_scanned+1;
        inserted:=public.axora_insert_projected_integration_event(
          'company.created',candidate.company_id,'company',candidate.resource_id,
          '/api/v1/companies/'||candidate.resource_id::text,'COMPANIES',
          candidate.source_id,1,candidate.cursor_at,candidate.summary
        );
        IF inserted THEN total_projected:=total_projected+1; END IF;
        checkpoint.cursor_at:=candidate.cursor_at; checkpoint.cursor_id:=candidate.source_id;
      END LOOP;
    ELSIF checkpoint.source_name='REQUESTS' THEN
      FOR candidate IN
        SELECT request.id AS source_id,request.created_at AS cursor_at,
          request.company_id,request.id AS resource_id,
          jsonb_build_object(
            'order_code',request.order_code,'branch_name',branch.name,
            'currency',request.currency,
            'total',(COALESCE(lines.subtotal,0)+request.estimated_delivery_fee+request.tax_amount)::text
          ) AS summary
        FROM public.requests request
        JOIN public.branches branch ON branch.id=request.branch_id
        LEFT JOIN LATERAL (
          SELECT sum(line.quantity*line.unit_sell_price) AS subtotal
          FROM public.request_lines line WHERE line.request_id=request.id
        ) lines ON true
        WHERE (request.created_at,request.id)>(checkpoint.cursor_at,checkpoint.cursor_id)
        ORDER BY request.created_at,request.id LIMIT p_batch_size
      LOOP
        source_scanned:=source_scanned+1;
        inserted:=public.axora_insert_projected_integration_event(
          'request.created',candidate.company_id,'request',candidate.resource_id,
          '/api/v1/requests/'||candidate.resource_id::text,'REQUESTS',
          candidate.source_id,1,candidate.cursor_at,candidate.summary
        );
        IF inserted THEN total_projected:=total_projected+1; END IF;
        checkpoint.cursor_at:=candidate.cursor_at; checkpoint.cursor_id:=candidate.source_id;
      END LOOP;
    ELSIF checkpoint.source_name='REQUEST_DECISIONS' THEN
      FOR candidate IN
        SELECT decision.id AS source_id,decision.decided_at AS cursor_at,
          decision.company_id,decision.request_id AS resource_id,
          decision.approval_revision_after AS source_version,
          CASE decision.action
            WHEN 'SUBMIT' THEN 'request.submitted'
            WHEN 'REJECT' THEN 'request.rejected'
            ELSE 'request.approved'
          END AS event_type,
          jsonb_build_object(
            'order_code',request.order_code,'branch_name',branch.name,
            'currency',decision.currency,'total',decision.amount::text
          ) AS summary
        FROM public.request_approval_decisions decision
        JOIN public.requests request ON request.id=decision.request_id
        JOIN public.branches branch ON branch.id=request.branch_id
        WHERE decision.action IN ('SUBMIT','APPROVE','REJECT','DIRECT_PURCHASE')
          AND (decision.decided_at,decision.id)>(checkpoint.cursor_at,checkpoint.cursor_id)
        ORDER BY decision.decided_at,decision.id LIMIT p_batch_size
      LOOP
        source_scanned:=source_scanned+1;
        inserted:=public.axora_insert_projected_integration_event(
          candidate.event_type,candidate.company_id,'request',candidate.resource_id,
          '/api/v1/requests/'||candidate.resource_id::text,'REQUEST_DECISIONS',
          candidate.source_id,candidate.source_version,candidate.cursor_at,
          candidate.summary
        );
        IF inserted THEN total_projected:=total_projected+1; END IF;
        checkpoint.cursor_at:=candidate.cursor_at; checkpoint.cursor_id:=candidate.source_id;
      END LOOP;
    ELSIF checkpoint.source_name='INVOICES' THEN
      FOR candidate IN
        SELECT invoice.id AS source_id,invoice.finalized_at AS cursor_at,
          invoice.company_id,invoice.id AS resource_id,
          jsonb_build_object(
            'invoice_number',invoice.invoice_number,'order_code',request.order_code,
            'branch_name',branch.name,'currency',invoice.currency,
            'total',invoice.amount::text
          ) AS summary
        FROM public.invoices invoice
        JOIN public.requests request ON request.id=invoice.request_id
        JOIN public.branches branch ON branch.id=request.branch_id
        WHERE invoice.direction='CUSTOMER' AND invoice.lifecycle_status='FINALIZED'
          AND invoice.finalized_at IS NOT NULL
          AND (invoice.finalized_at,invoice.id)>(checkpoint.cursor_at,checkpoint.cursor_id)
        ORDER BY invoice.finalized_at,invoice.id LIMIT p_batch_size
      LOOP
        source_scanned:=source_scanned+1;
        inserted:=public.axora_insert_projected_integration_event(
          'invoice.finalized',candidate.company_id,'invoice',candidate.resource_id,
          '/api/v1/invoices/'||candidate.resource_id::text,'INVOICES',
          candidate.source_id,1,candidate.cursor_at,candidate.summary
        );
        IF inserted THEN total_projected:=total_projected+1; END IF;
        checkpoint.cursor_at:=candidate.cursor_at; checkpoint.cursor_id:=candidate.source_id;
      END LOOP;
    ELSE
      FOR candidate IN
        SELECT event.id AS source_id,event.recorded_at AS cursor_at,
          event.company_id,event.aggregate_id AS resource_id,
          event.event_version AS source_version,event.event_key AS event_type,
          event.occurred_at,
          jsonb_build_object(
            'job_code',job.job_code,'order_code',request.order_code,
            'branch_name',branch.name
          ) AS summary
        FROM public.workflow_events event
        JOIN public.delivery_jobs job
          ON job.id=event.aggregate_id AND job.company_id=event.company_id
        JOIN public.requests request ON request.id=job.request_id
        JOIN public.branches branch ON branch.id=job.branch_id
        WHERE event.aggregate_type='delivery-job'
          AND event.event_key IN (
            'delivery.out_for_delivery','delivery.arrived',
            'delivery.delivered','delivery.completed'
          )
          AND (event.recorded_at,event.id)>(checkpoint.cursor_at,checkpoint.cursor_id)
        ORDER BY event.recorded_at,event.id LIMIT p_batch_size
      LOOP
        source_scanned:=source_scanned+1;
        inserted:=public.axora_insert_projected_integration_event(
          candidate.event_type,candidate.company_id,'delivery',candidate.resource_id,
          '/api/v1/deliveries/'||candidate.resource_id::text,'WORKFLOW_EVENTS',
          candidate.source_id,candidate.source_version,candidate.occurred_at,
          candidate.summary
        );
        IF inserted THEN total_projected:=total_projected+1; END IF;
        checkpoint.cursor_at:=candidate.cursor_at; checkpoint.cursor_id:=candidate.source_id;
      END LOOP;
    END IF;

    IF source_scanned>0 THEN
      UPDATE public.integration_projection_checkpoints
      SET cursor_at=checkpoint.cursor_at,cursor_id=checkpoint.cursor_id,
        projected_count=projected_count+source_scanned,
        last_projected_at=p_at,updated_at=p_at
      WHERE source_name=checkpoint.source_name;
      total_scanned:=total_scanned+source_scanned;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('scanned',total_scanned,'projected',total_projected);
END
$$;
REVOKE ALL ON FUNCTION public.axora_project_integration_events(integer,timestamptz)
  FROM PUBLIC;

CREATE FUNCTION public.axora_claim_integration_webhook_deliveries(
  p_worker_id text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 45,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  delivery_id uuid,event_id uuid,subscription_id uuid,company_id uuid,
  attempt_number integer,cycle_attempt_number integer,credential_version integer,
  endpoint_ciphertext jsonb,credential_ciphertext jsonb,event_type text,
  schema_version integer,occurred_at timestamptz,resource_type text,
  resource_id uuid,resource_url text,summary jsonb,lease_token uuid
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
  IF p_worker_id !~ '^integration-[A-Za-z0-9_-]{8,120}$'
    OR p_limit<1 OR p_limit>50 OR p_lease_seconds<10 OR p_lease_seconds>120
    OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid webhook claim' USING ERRCODE='22023'; END IF;

  WITH expired AS (
    SELECT delivery.*,
      LEAST(120000::numeric,GREATEST(
        0::numeric,
        EXTRACT(epoch FROM (p_at-COALESCE(delivery.last_attempt_at,p_at)))*1000
      ))::integer AS lease_duration_ms
    FROM public.integration_webhook_deliveries delivery
    WHERE delivery.status='DELIVERING' AND delivery.lease_expires_at<=p_at
    FOR UPDATE
  ), recorded AS (
    INSERT INTO public.integration_webhook_attempts(
      delivery_id,event_id,subscription_id,company_id,attempt_number,
      credential_version,started_at,completed_at,outcome,response_status,
      error_category,duration_ms,retry_after_seconds
    ) SELECT
      expired.id,expired.event_id,expired.subscription_id,expired.company_id,
      expired.attempt_count,expired.lease_credential_version,
      p_at-make_interval(secs=>expired.lease_duration_ms::double precision/1000),
      p_at,CASE WHEN expired.cycle_attempt_count>=8 THEN 'DEAD' ELSE 'RETRY' END,
      NULL,'LEASE_EXPIRED',expired.lease_duration_ms,
      CASE WHEN expired.cycle_attempt_count>=8 THEN NULL ELSE 1 END
    FROM expired
    ON CONFLICT ON CONSTRAINT integration_webhook_attempt_unique DO NOTHING
  )
  UPDATE public.integration_webhook_deliveries delivery
  SET status=CASE WHEN expired.cycle_attempt_count>=8 THEN 'DEAD' ELSE 'RETRY' END,
    leased_by=NULL,lease_token=NULL,lease_credential_version=NULL,
    lease_expires_at=NULL,
    available_at=CASE WHEN expired.cycle_attempt_count>=8
      THEN delivery.available_at ELSE p_at+interval '1 second' END,
    completed_at=CASE WHEN expired.cycle_attempt_count>=8 THEN p_at ELSE NULL END,
    response_status=NULL,error_category='LEASE_EXPIRED',
    last_duration_ms=expired.lease_duration_ms,updated_at=p_at
  FROM expired
  WHERE delivery.id=expired.id;

  UPDATE public.integration_webhook_subscriptions subscription
  SET status='PAUSED',paused_at=p_at,pause_reason='AUTHORIZATION_REVOKED',
    updated_at=p_at
  WHERE subscription.status='ACTIVE'
    AND NOT public.axora_integration_subscription_is_authorized(subscription.id,p_at);

  UPDATE public.integration_webhook_deliveries delivery
  SET status='FAILED',completed_at=p_at,updated_at=p_at,
    response_status=NULL,
    error_category=CASE WHEN subscription.status='PAUSED'
      THEN 'AUTHORIZATION_REVOKED' ELSE 'SUBSCRIPTION_INACTIVE' END
  FROM public.integration_webhook_subscriptions subscription
  WHERE subscription.id=delivery.subscription_id
    AND delivery.status IN ('PENDING','RETRY')
    AND subscription.status<>'ACTIVE';

  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id
    FROM public.integration_webhook_deliveries delivery
    JOIN public.integration_webhook_subscriptions subscription
      ON subscription.id=delivery.subscription_id AND subscription.status='ACTIVE'
    WHERE delivery.status IN ('PENDING','RETRY') AND delivery.available_at<=p_at
    ORDER BY delivery.available_at,delivery.created_at,delivery.id
    FOR UPDATE OF delivery SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.integration_webhook_deliveries delivery
    SET status='DELIVERING',attempt_count=delivery.attempt_count+1,
      cycle_attempt_count=delivery.cycle_attempt_count+1,
      leased_by=p_worker_id,lease_token=gen_random_uuid(),
      lease_credential_version=subscription.credential_version,
      lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
      first_attempt_at=COALESCE(delivery.first_attempt_at,p_at),
      last_attempt_at=p_at,response_status=NULL,error_category=NULL,
      last_duration_ms=NULL,updated_at=p_at
    FROM candidates,public.integration_webhook_subscriptions subscription
    WHERE delivery.id=candidates.id
      AND subscription.id=delivery.subscription_id
    RETURNING delivery.*
  )
  SELECT claimed.id,claimed.event_id,claimed.subscription_id,claimed.company_id,
    claimed.attempt_count,claimed.cycle_attempt_count,
    claimed.lease_credential_version,subscription.endpoint_ciphertext,
    subscription.current_credential_ciphertext,event.event_type,
    event.schema_version,event.occurred_at,event.resource_type,event.resource_id,
    event.resource_url,event.summary,claimed.lease_token
  FROM claimed
  JOIN public.integration_webhook_subscriptions subscription
    ON subscription.id=claimed.subscription_id
  JOIN public.integration_events event ON event.id=claimed.event_id;
END
$$;
REVOKE ALL ON FUNCTION public.axora_claim_integration_webhook_deliveries(
  text,integer,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_claimed_webhook_delivery_is_authorized(
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
      SELECT 1 FROM public.integration_webhook_deliveries delivery
      WHERE delivery.id=p_delivery_id AND delivery.status='DELIVERING'
        AND delivery.leased_by=p_worker_id AND delivery.lease_token=p_lease_token
        AND delivery.lease_expires_at>p_at
        AND public.axora_integration_subscription_is_authorized(
          delivery.subscription_id,p_at
        )
    )
$$;
REVOKE ALL ON FUNCTION public.axora_claimed_webhook_delivery_is_authorized(
  text,uuid,uuid,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_complete_integration_webhook_delivery(
  p_worker_id text,p_delivery_id uuid,p_lease_token uuid,p_outcome text,
  p_response_status integer,p_error_category text,p_duration_ms integer,
  p_retry_after_seconds integer,p_credential_version integer,
  p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE delivery record; final_status text; safe_retry integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed() THEN
    RAISE EXCEPTION 'Integration worker capability is unavailable'
      USING ERRCODE='42501';
  END IF;
  IF p_outcome NOT IN ('SUCCEEDED','RETRY','FAILED')
    OR p_duration_ms IS NULL OR p_duration_ms<0 OR p_duration_ms>120000
    OR p_credential_version IS NULL OR p_credential_version<1
    OR (p_response_status IS NOT NULL AND (p_response_status<100 OR p_response_status>599))
    OR (p_retry_after_seconds IS NOT NULL
      AND (p_retry_after_seconds<1 OR p_retry_after_seconds>86400))
    OR p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid webhook completion' USING ERRCODE='22023'; END IF;
  IF p_outcome='SUCCEEDED' AND (
    p_response_status IS NULL OR p_response_status<200 OR p_response_status>=300
    OR p_error_category IS NOT NULL
  ) THEN RAISE EXCEPTION 'Invalid successful webhook completion' USING ERRCODE='22023'; END IF;
  IF p_outcome<>'SUCCEEDED' AND p_error_category IS NULL THEN
    RAISE EXCEPTION 'Failed webhook completion requires a safe category'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO delivery FROM public.integration_webhook_deliveries
  WHERE id=p_delivery_id AND status='DELIVERING' AND leased_by=p_worker_id
    AND lease_token=p_lease_token FOR UPDATE;
  IF delivery.id IS NULL THEN
    RAISE EXCEPTION 'Webhook delivery lease is unavailable' USING ERRCODE='P8601';
  END IF;
  IF p_credential_version<>delivery.lease_credential_version THEN
    RAISE EXCEPTION 'Webhook delivery credential lease is unavailable'
      USING ERRCODE='P8601';
  END IF;
  safe_retry:=LEAST(86400,GREATEST(1,COALESCE(p_retry_after_seconds,30)));
  final_status:=CASE
    WHEN p_outcome='SUCCEEDED' THEN 'SUCCEEDED'
    WHEN p_outcome='FAILED' THEN 'FAILED'
    WHEN delivery.cycle_attempt_count>=8 THEN 'DEAD'
    ELSE 'RETRY' END;

  UPDATE public.integration_webhook_deliveries
  SET status=final_status,leased_by=NULL,lease_token=NULL,
    lease_credential_version=NULL,lease_expires_at=NULL,
    available_at=CASE WHEN final_status='RETRY'
      THEN p_at+make_interval(secs=>safe_retry) ELSE available_at END,
    completed_at=CASE WHEN final_status IN ('SUCCEEDED','FAILED','DEAD')
      THEN p_at ELSE NULL END,
    response_status=p_response_status,error_category=p_error_category,
    last_duration_ms=p_duration_ms,updated_at=p_at
  WHERE id=p_delivery_id;

  INSERT INTO public.integration_webhook_attempts(
    delivery_id,event_id,subscription_id,company_id,attempt_number,
    credential_version,started_at,completed_at,outcome,response_status,
    error_category,duration_ms,retry_after_seconds
  ) VALUES (
    delivery.id,delivery.event_id,delivery.subscription_id,delivery.company_id,
    delivery.attempt_count,p_credential_version,
    p_at-make_interval(secs=>p_duration_ms::double precision/1000),p_at,
    final_status,p_response_status,p_error_category,p_duration_ms,
    CASE WHEN final_status='RETRY' THEN safe_retry ELSE NULL END
  );
  RETURN final_status;
END
$$;
REVOKE ALL ON FUNCTION public.axora_complete_integration_webhook_delivery(
  text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.axora_cleanup_integration_runtime(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE attempts_removed integer; deliveries_removed integer; events_removed integer;
  oauth_removed integer; subscriptions_removed integer;
BEGIN
  IF NOT public.axora_integration_worker_allowed() THEN
    RAISE EXCEPTION 'Integration worker capability is unavailable'
      USING ERRCODE='42501';
  END IF;
  IF p_at IS NULL
    OR p_at<clock_timestamp()-interval '5 minutes'
    OR p_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid integration cleanup timestamp'
    USING ERRCODE='22023'; END IF;
  WITH candidates AS (
    SELECT id FROM public.integration_webhook_subscriptions
    WHERE previous_credential_valid_until<=p_at
    ORDER BY previous_credential_valid_until,id LIMIT 1000
  )
  UPDATE public.integration_webhook_subscriptions subscription
  SET previous_credential_ciphertext=NULL,previous_credential_valid_until=NULL,
    updated_at=p_at
  FROM candidates WHERE subscription.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_webhook_attempts
    WHERE completed_at<p_at-interval '90 days'
    ORDER BY completed_at,id LIMIT 10000
  )
  DELETE FROM public.integration_webhook_attempts attempt
  USING candidates WHERE attempt.id=candidates.id;
  GET DIAGNOSTICS attempts_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT id FROM public.integration_webhook_deliveries
    WHERE completed_at<p_at-interval '90 days'
      AND status IN ('SUCCEEDED','FAILED','DEAD')
    ORDER BY completed_at,id LIMIT 10000
  )
  DELETE FROM public.integration_webhook_deliveries delivery
  USING candidates WHERE delivery.id=candidates.id;
  GET DIAGNOSTICS deliveries_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT id FROM public.integration_webhook_subscriptions
    WHERE status='REVOKED' AND revoked_at<p_at-interval '180 days'
    ORDER BY revoked_at,id LIMIT 1000
  )
  DELETE FROM public.integration_webhook_subscriptions subscription
  USING candidates WHERE subscription.id=candidates.id;
  GET DIAGNOSTICS subscriptions_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT event.id FROM public.integration_events event
    WHERE event.recorded_at<LEAST(p_at,clock_timestamp())-interval '180 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.integration_webhook_deliveries delivery
        WHERE delivery.event_id=event.id
      )
    ORDER BY event.recorded_at,event.id LIMIT 10000
  )
  DELETE FROM public.integration_events event
  USING candidates WHERE event.id=candidates.id;
  GET DIAGNOSTICS events_removed=ROW_COUNT;

  WITH candidates AS (
    SELECT id FROM public.integration_oauth_authorization_requests
    WHERE expires_at<p_at-interval '1 day'
    ORDER BY expires_at,id LIMIT 10000
  )
  DELETE FROM public.integration_oauth_authorization_requests request
  USING candidates WHERE request.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_oauth_authorization_codes
    WHERE expires_at<p_at-interval '1 day'
    ORDER BY expires_at,id LIMIT 10000
  )
  DELETE FROM public.integration_oauth_authorization_codes code
  USING candidates WHERE code.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_oauth_access_tokens
    WHERE expires_at<p_at-interval '7 days'
      OR revoked_at<p_at-interval '7 days'
    ORDER BY LEAST(expires_at,COALESCE(revoked_at,expires_at)),id LIMIT 10000
  )
  DELETE FROM public.integration_oauth_access_tokens access
  USING candidates WHERE access.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_oauth_refresh_families
    WHERE status='ACTIVE' AND expires_at<=p_at
    ORDER BY expires_at,id LIMIT 10000
  )
  UPDATE public.integration_oauth_refresh_families family
  SET status='EXPIRED',revoked_at=p_at,
    revoke_reason='Refresh token family expired'
  FROM candidates WHERE family.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_oauth_refresh_families
    WHERE status<>'ACTIVE' AND revoked_at<p_at-interval '90 days'
    ORDER BY revoked_at,id LIMIT 10000
  )
  DELETE FROM public.integration_oauth_refresh_families family
  USING candidates WHERE family.id=candidates.id;
  GET DIAGNOSTICS oauth_removed=ROW_COUNT;
  WITH candidates AS (
    SELECT route_class,scope_kind,scope_hash,bucket_started_at
    FROM public.integration_api_rate_buckets
    WHERE expires_at<p_at ORDER BY expires_at LIMIT 10000
  )
  DELETE FROM public.integration_api_rate_buckets bucket
  USING candidates
  WHERE bucket.route_class=candidates.route_class
    AND bucket.scope_kind=candidates.scope_kind
    AND bucket.scope_hash=candidates.scope_hash
    AND bucket.bucket_started_at=candidates.bucket_started_at;
  WITH candidates AS (
    SELECT id FROM public.integration_api_idempotency
    WHERE expires_at<p_at ORDER BY expires_at,id LIMIT 10000
  )
  DELETE FROM public.integration_api_idempotency idempotency
  USING candidates WHERE idempotency.id=candidates.id;
  WITH candidates AS (
    SELECT id FROM public.integration_request_drafts
    WHERE status='PENDING_REVIEW' AND expires_at<=p_at
    ORDER BY expires_at,id LIMIT 10000
  )
  UPDATE public.integration_request_drafts draft
  SET status='EXPIRED',updated_at=p_at
  FROM candidates WHERE draft.id=candidates.id;

  RETURN jsonb_build_object(
    'attemptsRemoved',attempts_removed,'deliveriesRemoved',deliveries_removed,
    'subscriptionsRemoved',subscriptions_removed,'eventsRemoved',events_removed,
    'refreshFamiliesRemoved',oauth_removed
  );
END
$$;
REVOKE ALL ON FUNCTION public.axora_cleanup_integration_runtime(timestamptz)
  FROM PUBLIC;

-- Revoking a company connection immediately prevents new claims and safely
-- terminalizes queued webhook work. It never touches the source business event.
CREATE FUNCTION public.axora_revoke_connection_webhooks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF OLD.status='ACTIVE' AND NEW.status='REVOKED' THEN
    UPDATE public.integration_webhook_subscriptions
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,NEW.revoked_at,now()),
      revoked_by=COALESCE(revoked_by,NEW.revoked_by),
      revoke_reason=COALESCE(revoke_reason,'Integration connection revoked'),
      updated_at=now()
    WHERE connection_id=NEW.id AND status<>'REVOKED';
    UPDATE public.integration_webhook_deliveries delivery
    SET status='FAILED',completed_at=now(),error_category='SUBSCRIPTION_INACTIVE',
      response_status=NULL,
      leased_by=NULL,lease_token=NULL,lease_credential_version=NULL,
      lease_expires_at=NULL,updated_at=now()
    FROM public.integration_webhook_subscriptions subscription
    WHERE subscription.connection_id=NEW.id
      AND delivery.subscription_id=subscription.id
      AND delivery.status IN ('PENDING','RETRY','DELIVERING');
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.axora_revoke_connection_webhooks() FROM PUBLIC;
CREATE TRIGGER integration_connections_revoke_webhooks
AFTER UPDATE OF status ON public.integration_connections
FOR EACH ROW EXECUTE FUNCTION public.axora_revoke_connection_webhooks();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('integration_events','RETAIN_WITH_ACCESS_REVOKED','RETAIN_WITH_ACCESS_REVOKED',
    'Minimal immutable integration events are detached tenant snapshots and expire through the bounded integration retention capability.'),
  ('integration_webhook_subscriptions','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Encrypted webhook destinations and credentials are tenant-owned integration authorization state.'),
  ('integration_webhook_deliveries','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Webhook deliveries are disposable tenant-scoped operational metadata, not business or financial records.'),
  ('integration_webhook_attempts','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Webhook attempt metadata contains no payload or response body and follows the parent delivery lifecycle.')
ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT maximum.delete_order+ordered.ordinality::integer,ordered.table_name,
  'Reviewed integration webhook operational state; delete children before parents while constraints remain active.'
FROM unnest(ARRAY[
  'integration_webhook_attempts','integration_webhook_deliveries',
  'integration_webhook_subscriptions','integration_events'
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
    'integration_projection_checkpoints','integration_events',
    'integration_webhook_subscriptions','integration_webhook_deliveries',
    'integration_webhook_attempts'
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

-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- A role-specific REVOKE cannot override that inherited privilege, so close
-- the anonymous database-function surface before introducing the dedicated
-- worker. Axora's application and worker capabilities are explicitly granted
-- below (and re-applied by database/admin/apply-app-grants.sql).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.integration_projection_checkpoints,public.integration_events,
      public.integration_webhook_subscriptions,
      public.integration_webhook_deliveries,public.integration_webhook_attempts
    FROM axora_app;
    GRANT SELECT ON TABLE public.integration_events,
      public.integration_webhook_attempts TO axora_app;
    GRANT SELECT,INSERT,UPDATE ON TABLE
      public.integration_webhook_subscriptions TO axora_app;
    GRANT SELECT,UPDATE ON TABLE public.integration_webhook_deliveries TO axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_integration_ciphertext_is_valid(jsonb) TO axora_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_integration_worker') THEN
    EXECUTE format(
      'GRANT CONNECT ON DATABASE %I TO axora_integration_worker',current_database()
    );
    GRANT USAGE ON SCHEMA public TO axora_integration_worker;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM axora_integration_worker;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM axora_integration_worker;
    GRANT EXECUTE ON FUNCTION
      public.axora_project_integration_events(integer,timestamptz),
      public.axora_claim_integration_webhook_deliveries(text,integer,integer,timestamptz),
      public.axora_claimed_webhook_delivery_is_authorized(text,uuid,uuid,timestamptz),
      public.axora_complete_integration_webhook_delivery(text,uuid,uuid,text,integer,text,integer,integer,integer,timestamptz),
      public.axora_cleanup_integration_runtime(timestamptz)
    TO axora_integration_worker;
  END IF;
END
$grants$;

COMMENT ON TABLE public.integration_events IS
  'Minimal versioned projections of committed canonical Axora state. No email, phone, private supplier cost, proof path, coordinates, token, or credential is permitted.';
COMMENT ON TABLE public.integration_webhook_attempts IS
  'Bounded security-safe webhook attempt metadata. Request payloads and response bodies are never stored.';

DO $assertions$
BEGIN
  IF to_regclass('public.transactional_email_outbox') IS NULL
    OR to_regclass('public.workflow_email_outbox') IS NULL
  THEN RAISE EXCEPTION 'Existing email boundaries are unavailable'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='public'
      AND table_name IN (
        'integration_events','integration_webhook_subscriptions',
        'integration_webhook_deliveries','integration_webhook_attempts'
      )
      AND constraint_name ILIKE '%email%'
  ) THEN RAISE EXCEPTION 'Webhook platform was coupled to email storage'; END IF;
END
$assertions$;

COMMIT;
