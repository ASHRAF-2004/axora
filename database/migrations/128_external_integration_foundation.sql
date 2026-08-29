BEGIN;

-- Axora integrations are an additive security boundary. They deliberately do
-- not depend on either transactional email outbox and cannot write Axora's
-- financial or fulfilment records.

INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk,delegatable
) VALUES
  (
    'integration.application.manage','Integrations',
    'Manage integration applications',
    'Register, rotate, deactivate, and inspect platform integration applications.',
    true,false
  ),
  (
    'integration.connection.manage','Integrations',
    'Manage company integrations',
    'Connect, inspect, and revoke supported integrations for an authorized company.',
    true,false
  ),
  (
    'integration.operations.view','Integrations',
    'View integration operations',
    'View platform-wide integration security and operational health without exposing credentials.',
    true,false
  )
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  high_risk=EXCLUDED.high_risk,
  delegatable=EXCLUDED.delegatable,
  active=true,
  updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'integration.application.manage',
  'integration.connection.manage',
  'integration.operations.view'
)
WHERE role.role_key='PLATFORM_OWNER'
ON CONFLICT(role_id,permission_id) DO NOTHING;

-- Account-kind ceilings remain a second independent boundary. A customer
-- account can manage its own connection but can never become an application
-- registrar or platform operations viewer through a mistaken explicit grant.
CREATE OR REPLACE FUNCTION public.axora_permission_allowed_for_account_kind(
  p_account_kind text,p_permission_code text
)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE p_account_kind
    WHEN 'COMPANY' THEN NOT (
      position('platform.' IN p_permission_code)=1
      OR position('platform_user.' IN p_permission_code)=1
      OR position('delivery_user.' IN p_permission_code)=1
      OR position('supplier.' IN p_permission_code)=1
      OR position('email.operations.' IN p_permission_code)=1
      OR position('system.diagnostics.' IN p_permission_code)=1
      OR position('commercial.cost.' IN p_permission_code)=1
      OR position('commercial.markup.' IN p_permission_code)=1
      OR position('commercial.platform_margin.' IN p_permission_code)=1
      OR position('commercial.pricing.' IN p_permission_code)=1
      OR position('analytics.platform.' IN p_permission_code)=1
      OR p_permission_code IN (
        'company.create','company.view.all','company.lead.view',
        'company.lead.create','company.lead.assign','company.lead.reassign',
        'company.activate','company.suspend','company.portal.publish',
        'catalog.manage','product.manage','product.archive','category.manage',
        'analytics.revenue.view','finance.manage','finance.match.review',
        'finance.wallet.top_up.record','commercial.company_ceiling.override',
        'delivery.manage','delivery.assign',
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update',
        'integration.application.manage','integration.operations.view'
      )
    )
    WHEN 'DELIVERY' THEN p_permission_code IN (
      'delivery.view','delivery.claim','delivery.accept',
      'delivery.shop','delivery.receipt.upload','delivery.track',
      'delivery.complete','delivery.portal.view','delivery.assignment.update',
      'document.view','document.download'
    )
    WHEN 'SUPPLIER' THEN p_permission_code='dashboard.view'
      OR position('supplier.' IN p_permission_code)=1
      OR p_permission_code IN ('document.view','document.download')
    WHEN 'PLATFORM' THEN position('supplier.' IN p_permission_code)<>1
      AND p_permission_code<>'procurement.direct_purchase'
      AND p_permission_code NOT IN (
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update'
      )
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.axora_permission_allowed_for_account_kind(
  text,text
) FROM PUBLIC;

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission
  ON permission.permission_code='integration.connection.manage'
WHERE role.role_key='COMPANY_ADMIN'
ON CONFLICT(role_id,permission_id) DO NOTHING;

CREATE TABLE public.integration_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE CHECK (
    client_id ~ '^axora_client_[A-Za-z0-9_-]{24,96}$'
  ),
  client_secret_hash text CHECK (
    client_secret_hash IS NULL OR client_secret_hash ~ '^[0-9a-f]{64}$'
  ),
  client_type text NOT NULL CHECK (client_type IN ('CONFIDENTIAL','PUBLIC')),
  token_endpoint_auth_method text NOT NULL CHECK (
    token_endpoint_auth_method IN ('client_secret_basic','client_secret_post','none')
  ),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description)<=1000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  redirect_uris text[] NOT NULL CHECK (
    cardinality(redirect_uris) BETWEEN 1 AND 20
    AND array_position(redirect_uris,NULL) IS NULL
  ),
  allowed_scopes text[] NOT NULL CHECK (
    cardinality(allowed_scopes) BETWEEN 1 AND 6
    AND allowed_scopes <@ ARRAY[
      'companies:read','requests:read','requests:draft',
      'deliveries:read','invoices:read','webhooks:manage'
    ]::text[]
  ),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  secret_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (client_type='CONFIDENTIAL'
      AND token_endpoint_auth_method IN ('client_secret_basic','client_secret_post')
      AND client_secret_hash IS NOT NULL)
    OR (client_type='PUBLIC' AND token_endpoint_auth_method='none'
      AND client_secret_hash IS NULL)
  )
);

CREATE TABLE public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  connected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),
  UNIQUE(id,application_id,company_id),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX integration_connections_one_active_application_company_uq
  ON public.integration_connections(application_id,company_id)
  WHERE status='ACTIVE';
CREATE INDEX integration_connections_company_idx
  ON public.integration_connections(company_id,status,connected_at DESC,id DESC);

CREATE TABLE public.integration_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  auth_version_at_grant integer NOT NULL CHECK (auth_version_at_grant>0),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 6
    AND scopes <@ ARRAY[
      'companies:read','requests:read','requests:draft',
      'deliveries:read','invoices:read','webhooks:manage'
    ]::text[]
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','REVOKED','EXPIRED')
  ),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(connection_id,application_id,company_id)
    REFERENCES public.integration_connections(id,application_id,company_id)
    ON DELETE CASCADE,
  UNIQUE(id,connection_id,company_id),
  UNIQUE(id,application_id,connection_id,company_id,user_id),
  UNIQUE(id,application_id,connection_id,company_id,user_id,role_assignment_id),
  CHECK (expires_at>granted_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status<>'ACTIVE' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX integration_oauth_grants_one_active_user_connection_uq
  ON public.integration_oauth_grants(connection_id,user_id)
  WHERE status='ACTIVE';
CREATE INDEX integration_oauth_grants_live_idx
  ON public.integration_oauth_grants(user_id,status,expires_at,id);

-- The opaque consent handle is hashed. State is client-provided CSRF binding
-- and is retained only for this short-lived authorization transaction.
CREATE TABLE public.integration_oauth_authorization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_handle_hash text NOT NULL UNIQUE CHECK (
    request_handle_hash ~ '^[0-9a-f]{64}$'
  ),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL CHECK (char_length(redirect_uri) BETWEEN 8 AND 2048),
  client_state text NOT NULL CHECK (char_length(client_state) BETWEEN 16 AND 1024),
  requested_scopes text[] NOT NULL CHECK (
    cardinality(requested_scopes) BETWEEN 1 AND 6
    AND requested_scopes <@ ARRAY[
      'companies:read','requests:read','requests:draft',
      'deliveries:read','invoices:read','webhooks:manage'
    ]::text[]
  ),
  code_challenge text NOT NULL CHECK (
    code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'
  ),
  code_challenge_method text NOT NULL CHECK (code_challenge_method='S256'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','APPROVED','DENIED','EXPIRED')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (expires_at>created_at),
  CHECK ((status='PENDING')=(decided_at IS NULL))
);
CREATE INDEX integration_oauth_authorization_requests_expiry_idx
  ON public.integration_oauth_authorization_requests(status,expires_at);

CREATE TABLE public.integration_oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL CHECK (char_length(redirect_uri) BETWEEN 8 AND 2048),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 6
    AND scopes <@ ARRAY[
      'companies:read','requests:read','requests:draft',
      'deliveries:read','invoices:read','webhooks:manage'
    ]::text[]
  ),
  code_challenge text NOT NULL CHECK (
    code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'
  ),
  code_challenge_method text NOT NULL CHECK (code_challenge_method='S256'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY(connection_id,company_id)
    REFERENCES public.integration_connections(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY(grant_id,application_id,connection_id,company_id,user_id)
    REFERENCES public.integration_oauth_grants(
      id,application_id,connection_id,company_id,user_id
    ) ON DELETE CASCADE,
  CHECK (expires_at>created_at)
);
CREATE INDEX integration_oauth_authorization_codes_expiry_idx
  ON public.integration_oauth_authorization_codes(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE public.integration_oauth_refresh_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','REVOKED','REUSE_DETECTED','EXPIRED')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  reuse_detected_at timestamptz,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
  ),
  FOREIGN KEY(connection_id,application_id,company_id)
    REFERENCES public.integration_connections(id,application_id,company_id)
    ON DELETE CASCADE,
  FOREIGN KEY(grant_id,application_id,connection_id,company_id,user_id)
    REFERENCES public.integration_oauth_grants(
      id,application_id,connection_id,company_id,user_id
    ) ON DELETE CASCADE,
  UNIQUE(id,grant_id),
  UNIQUE(id,grant_id,application_id,connection_id,company_id,user_id),
  CHECK (expires_at>created_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status<>'ACTIVE' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CHECK ((status='REUSE_DETECTED')=(reuse_detected_at IS NOT NULL))
);

CREATE TABLE public.integration_oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL
    REFERENCES public.integration_oauth_refresh_families(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  generation integer NOT NULL CHECK (generation>0),
  parent_token_id uuid REFERENCES public.integration_oauth_refresh_tokens(id)
    ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by_token_id uuid REFERENCES public.integration_oauth_refresh_tokens(id)
    ON DELETE SET NULL,
  FOREIGN KEY(family_id,grant_id)
    REFERENCES public.integration_oauth_refresh_families(id,grant_id)
    ON DELETE CASCADE,
  CHECK (expires_at>created_at),
  CHECK (replaced_by_token_id IS NULL OR consumed_at IS NOT NULL)
);
CREATE UNIQUE INDEX integration_oauth_refresh_tokens_family_generation_uq
  ON public.integration_oauth_refresh_tokens(family_id,generation);
CREATE INDEX integration_oauth_refresh_tokens_expiry_idx
  ON public.integration_oauth_refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE public.integration_oauth_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.integration_applications(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  refresh_family_id uuid
    REFERENCES public.integration_oauth_refresh_families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE CASCADE,
  auth_version_at_issue integer NOT NULL CHECK (auth_version_at_issue>0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  audience text NOT NULL CHECK (audience='https://axora.management/api/v1'),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 6
    AND scopes <@ ARRAY[
      'companies:read','requests:read','requests:draft',
      'deliveries:read','invoices:read','webhooks:manage'
    ]::text[]
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  FOREIGN KEY(connection_id,application_id,company_id)
    REFERENCES public.integration_connections(id,application_id,company_id)
    ON DELETE CASCADE,
  FOREIGN KEY(
    grant_id,application_id,connection_id,company_id,user_id,role_assignment_id
  ) REFERENCES public.integration_oauth_grants(
    id,application_id,connection_id,company_id,user_id,role_assignment_id
  ) ON DELETE CASCADE,
  FOREIGN KEY(
    refresh_family_id,grant_id,application_id,connection_id,company_id,user_id
  ) REFERENCES public.integration_oauth_refresh_families(
    id,grant_id,application_id,connection_id,company_id,user_id
  ) ON DELETE CASCADE,
  CHECK (expires_at>created_at)
);
CREATE INDEX integration_oauth_access_tokens_live_idx
  ON public.integration_oauth_access_tokens(token_hash,expires_at)
  WHERE revoked_at IS NULL;

-- Integration throttles are isolated from login, Contact, and visitor buckets.
-- scope_hash is a keyed digest of internal principal identifiers, never a raw
-- access token, client secret, IP address, or Authorization header.
CREATE TABLE public.integration_api_rate_buckets (
  route_class text NOT NULL CHECK (
    route_class IN ('OAUTH_AUTHORIZE','OAUTH_TOKEN','API_READ','API_WRITE')
  ),
  scope_kind text NOT NULL CHECK (
    scope_kind IN ('CLIENT','CONNECTION','TOKEN','NETWORK')
  ),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count BETWEEN 1 AND 100000),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(route_class,scope_kind,scope_hash,bucket_started_at),
  CHECK (expires_at>bucket_started_at)
);
CREATE INDEX integration_api_rate_buckets_expiry_idx
  ON public.integration_api_rate_buckets(expires_at);

CREATE TABLE public.integration_api_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  company_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  command text NOT NULL CHECK (command ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  idempotency_key_hash text NOT NULL CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (
    status IN ('PROCESSING','COMPLETED','FAILED')
  ),
  response_status integer CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb CHECK (
    response_body IS NULL OR (
      jsonb_typeof(response_body)='object'
      AND octet_length(response_body::text)<=65536
      AND public.workflow_metadata_is_safe(response_body)
    )
  ),
  resource_type text CHECK (
    resource_type IS NULL OR resource_type ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(connection_id,company_id)
    REFERENCES public.integration_connections(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY(grant_id,connection_id,company_id)
    REFERENCES public.integration_oauth_grants(id,connection_id,company_id)
    ON DELETE CASCADE,
  UNIQUE(connection_id,command,idempotency_key_hash),
  CHECK (expires_at>created_at),
  CHECK (
    (status='PROCESSING' AND response_status IS NULL AND response_body IS NULL
      AND completed_at IS NULL)
    OR (status<>'PROCESSING' AND response_status IS NOT NULL
      AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX integration_api_idempotency_expiry_idx
  ON public.integration_api_idempotency(expires_at);

CREATE TABLE public.integration_request_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_code text NOT NULL CHECK (draft_code ~ '^IDR-[A-Z0-9]{10,32}$'),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  application_id uuid REFERENCES public.integration_applications(id) ON DELETE SET NULL,
  connection_id uuid,
  grant_id uuid REFERENCES public.integration_oauth_grants(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('Standard','Ad-hoc','Recurring')),
  department text NOT NULL CHECK (char_length(btrim(department)) BETWEEN 2 AND 160),
  needed_by_date date NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('Low','Normal','High','Urgent')),
  notes text CHECK (notes IS NULL OR char_length(notes)<=2000),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (
    status IN ('PENDING_REVIEW','IN_REVIEW','CONSUMED','CANCELLED','EXPIRED')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_submission_key uuid,
  review_cart_id uuid REFERENCES public.procurement_carts(id) ON DELETE RESTRICT,
  review_cart_version integer CHECK (
    review_cart_version IS NULL OR review_cart_version>0
  ),
  submitted_request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id,company_id)
    REFERENCES public.integration_connections(id,company_id) ON DELETE CASCADE,
  UNIQUE(company_id,draft_code),
  UNIQUE(submitted_request_id),
  CHECK (expires_at>created_at),
  CHECK (
    (status='PENDING_REVIEW' AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND review_submission_key IS NULL AND review_cart_id IS NULL
      AND review_cart_version IS NULL AND submitted_request_id IS NULL
      AND consumed_at IS NULL)
    OR (status='IN_REVIEW' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND review_submission_key IS NOT NULL AND review_cart_id IS NOT NULL
      AND review_cart_version IS NOT NULL AND submitted_request_id IS NULL
      AND consumed_at IS NULL)
    OR (status='CONSUMED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND review_submission_key IS NOT NULL AND review_cart_id IS NOT NULL
      AND review_cart_version IS NOT NULL AND submitted_request_id IS NOT NULL
      AND consumed_at IS NOT NULL)
    OR status IN ('CANCELLED','EXPIRED')
  )
);
CREATE INDEX integration_request_drafts_review_idx
  ON public.integration_request_drafts(company_id,status,created_at DESC,id DESC);
CREATE UNIQUE INDEX integration_request_drafts_review_submission_uq
  ON public.integration_request_drafts(reviewed_by,review_submission_key)
  WHERE review_submission_key IS NOT NULL;

CREATE TABLE public.integration_request_draft_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL
    REFERENCES public.integration_request_drafts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  public_product_reference text NOT NULL CHECK (
    public_product_reference ~ '^item-[a-f0-9]{20}$'
  ),
  product_name_snapshot text NOT NULL CHECK (
    char_length(btrim(product_name_snapshot)) BETWEEN 2 AND 300
  ),
  unit_of_measure_snapshot text NOT NULL CHECK (
    char_length(btrim(unit_of_measure_snapshot)) BETWEEN 1 AND 80
  ),
  quantity integer NOT NULL CHECK (quantity>0 AND quantity<=1000000),
  specification text CHECK (specification IS NULL OR char_length(specification)<=1000),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 999),
  UNIQUE(draft_id,sort_order)
);

-- Security-safe evidence is append-only and survives connection/user removal.
-- Identifier columns are immutable historical snapshots rather than ownership
-- links, so they deliberately have no foreign keys. This matches audit_logs:
-- revoking or deleting a referenced principal must never rewrite or erase the
-- evidence, and a foreign-key SET NULL update would be rejected by the
-- append-only trigger.
CREATE TABLE public.integration_api_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  application_id uuid,
  connection_id uuid,
  company_id uuid,
  grant_id uuid,
  delegating_user_id uuid,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  route text NOT NULL CHECK (
    char_length(route) BETWEEN 1 AND 240 AND route !~ '[[:cntrl:]]'
  ),
  action text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_.-]{1,119}$'),
  resource_type text CHECK (
    resource_type IS NULL OR resource_type ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  resource_id uuid,
  result text NOT NULL CHECK (
    result IN ('SUCCESS','DENIED','INVALID','RATE_LIMITED','NOT_FOUND','ERROR')
  ),
  http_status integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  network_hash text CHECK (network_hash IS NULL OR network_hash ~ '^[0-9a-f]{64}$'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(details)='object' AND public.workflow_metadata_is_safe(details)
  )
);
CREATE INDEX integration_api_audit_company_time_idx
  ON public.integration_api_audit(company_id,occurred_at DESC,id DESC);
CREATE INDEX integration_api_audit_request_idx
  ON public.integration_api_audit(request_id);
CREATE TRIGGER integration_api_audit_append_only
BEFORE UPDATE OR DELETE ON public.integration_api_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

-- Register every directly company-scoped integration table with Axora's
-- guarded company-deletion contract. Operational rows are disposable only for
-- an otherwise unprotected tenant and are removed through the reviewed DAG.
-- API audit evidence remains detached and immutable, just like audit_logs.
INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('integration_connections','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Company integration connections are tenant-owned authorization state and are revoked or removed only through guarded lifecycle operations.'),
  ('integration_oauth_grants','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Delegated OAuth grants are company-scoped authorization state and must not outlive a disposable tenant.'),
  ('integration_oauth_authorization_requests','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Short-lived OAuth authorization requests are company-scoped and contain no durable business evidence.'),
  ('integration_oauth_authorization_codes','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Short-lived OAuth authorization codes are company-scoped and contain no durable business evidence.'),
  ('integration_oauth_refresh_families','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'OAuth refresh-token families are company-scoped revocation state and must not outlive a disposable tenant.'),
  ('integration_oauth_access_tokens','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Opaque OAuth access-token hashes are company-scoped authorization state and must not outlive a disposable tenant.'),
  ('integration_api_idempotency','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'External API mutation replay records are company-scoped and are removed only through the guarded tenant lifecycle.'),
  ('integration_request_drafts','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Review-required integration drafts are tenant-owned staging data and never constitute financial commitment.'),
  ('integration_api_audit','RETAIN_WITH_ACCESS_REVOKED','RETAIN_WITH_ACCESS_REVOKED',
    'Append-only external API audit snapshots remain immutable after tenant removal and intentionally have no ownership foreign keys.')
ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(
  delete_order,table_name,rationale
)
SELECT maximum.delete_order+ordered.ordinality::integer,ordered.table_name,
  'Reviewed integration authorization or staging state; delete children before parents while constraints and triggers remain active.'
FROM unnest(ARRAY[
  'integration_oauth_access_tokens',
  'integration_api_idempotency',
  'integration_request_drafts',
  'integration_oauth_authorization_codes',
  'integration_oauth_refresh_families',
  'integration_oauth_grants',
  'integration_oauth_authorization_requests',
  'integration_connections'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
CROSS JOIN (
  SELECT COALESCE(max(existing.delete_order),0) AS delete_order
  FROM public.company_deletion_ownership_dag existing
) maximum
ON CONFLICT(table_name) DO NOTHING;

-- Every integration table is unavailable to ordinary application queries.
-- Repository code must enter one of these named, audited system identities.
CREATE FUNCTION public.axora_integration_context_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(current_setting('axora.system_identity',true),'') IN (
    'integration-management','integration-oauth','integration-api',
    'integration-maintenance'
  )
$$;
REVOKE ALL ON FUNCTION public.axora_integration_context_allowed() FROM PUBLIC;

DO $tables$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'integration_applications','integration_connections',
    'integration_oauth_grants','integration_oauth_authorization_requests',
    'integration_oauth_authorization_codes','integration_oauth_refresh_families',
    'integration_oauth_refresh_tokens','integration_oauth_access_tokens',
    'integration_api_rate_buckets','integration_api_idempotency',
    'integration_request_drafts','integration_request_draft_items',
    'integration_api_audit'
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

-- Opaque-token lookup is the sole access-token authentication capability. It
-- requires every application/connection/grant/token row to be live and also
-- recomputes the current Axora identity snapshot. A deactivated account,
-- revoked/replaced role assignment, changed auth_version, revoked connection,
-- or revoked grant therefore invalidates an issued token immediately on its
-- next request regardless of the token expiry timestamp.
CREATE FUNCTION public.axora_integration_principal_by_token_hash(
  p_token_hash text,p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  access_token_id uuid,
  application_id uuid,
  client_id text,
  connection_id uuid,
  company_id uuid,
  grant_id uuid,
  user_id uuid,
  role_assignment_id uuid,
  auth_version integer,
  scopes text[],
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE principal record; actor_snapshot jsonb;
BEGIN
  IF p_at IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;

  SELECT
    access.id AS access_token_id,
    application.id AS application_id,
    application.client_id,
    connection.id AS connection_id,
    connection.company_id,
    grant_record.id AS grant_id,
    grant_record.user_id,
    grant_record.role_assignment_id,
    grant_record.auth_version_at_grant AS auth_version,
    access.scopes,
    access.expires_at
  INTO principal
  FROM public.integration_oauth_access_tokens access
  JOIN public.integration_applications application
    ON application.id=access.application_id AND application.status='ACTIVE'
  JOIN public.integration_connections connection
    ON connection.id=access.connection_id
   AND connection.company_id=access.company_id
   AND connection.status='ACTIVE'
  JOIN public.integration_oauth_grants grant_record
    ON grant_record.id=access.grant_id
   AND grant_record.application_id=access.application_id
   AND grant_record.connection_id=access.connection_id
   AND grant_record.company_id=access.company_id
   AND grant_record.user_id=access.user_id
   AND grant_record.role_assignment_id=access.role_assignment_id
   AND grant_record.status='ACTIVE'
   AND grant_record.expires_at>p_at
   AND access.scopes <@ grant_record.scopes
   AND grant_record.scopes <@ application.allowed_scopes
  JOIN public.users account
    ON account.id=grant_record.user_id
   AND account.active=true
   AND account.account_status='ACTIVE'
   AND account.account_setup_completed_at IS NOT NULL
   AND account.auth_version=grant_record.auth_version_at_grant
   AND account.auth_version=access.auth_version_at_issue
  JOIN public.role_assignments assignment
    ON assignment.id=grant_record.role_assignment_id
   AND assignment.user_id=grant_record.user_id
   AND assignment.active=true
   AND assignment.revoked_at IS NULL
  WHERE access.token_hash=p_token_hash
    AND access.revoked_at IS NULL
    AND access.expires_at>p_at
    AND access.audience='https://axora.management/api/v1';

  IF principal.access_token_id IS NULL THEN RETURN; END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    principal.user_id,principal.role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL
    OR (actor_snapshot->>'authVersion')::integer<>principal.auth_version
    OR NOT public.axora_snapshot_has_permission(
      actor_snapshot,'integration.connection.manage','COMPANY',
      principal.company_id,NULL,NULL,NULL
    )
  THEN RETURN; END IF;

  RETURN QUERY SELECT
    principal.access_token_id,principal.application_id,principal.client_id,
    principal.connection_id,principal.company_id,principal.grant_id,
    principal.user_id,principal.role_assignment_id,principal.auth_version,
    principal.scopes,principal.expires_at;
END
$$;
REVOKE ALL ON FUNCTION public.axora_integration_principal_by_token_hash(
  text,timestamptz
) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.axora_integration_context_allowed(),
      public.axora_integration_principal_by_token_hash(text,timestamptz)
    TO axora_app;

    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE
      public.integration_applications,
      public.integration_connections,
      public.integration_oauth_grants,
      public.integration_oauth_authorization_requests,
      public.integration_oauth_authorization_codes,
      public.integration_oauth_refresh_families,
      public.integration_oauth_refresh_tokens,
      public.integration_oauth_access_tokens,
      public.integration_api_rate_buckets,
      public.integration_api_idempotency,
      public.integration_request_drafts,
      public.integration_request_draft_items
    TO axora_app;
    REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
      ON TABLE public.integration_api_audit FROM axora_app;
    GRANT SELECT,INSERT ON TABLE public.integration_api_audit TO axora_app;
  END IF;
END
$grants$;

COMMENT ON TABLE public.integration_api_audit IS
  'Security-safe external integration evidence. Tokens, secrets, authorization headers, codes, and raw request bodies are prohibited.';
COMMENT ON TABLE public.integration_request_drafts IS
  'Review-required external draft staging. Rows cannot approve, spend budget, mutate a Wallet, create payment/invoice, or start delivery.';

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.role_permissions role_permission
    JOIN public.roles role ON role.id=role_permission.role_id
    JOIN public.permissions permission ON permission.id=role_permission.permission_id
    WHERE permission.permission_code IN (
      'integration.application.manage','integration.operations.view'
    ) AND role.role_key<>'PLATFORM_OWNER'
  ) THEN
    RAISE EXCEPTION 'Platform integration authority escaped the Owner role';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.role_permissions role_permission
    JOIN public.roles role ON role.id=role_permission.role_id
    JOIN public.permissions permission ON permission.id=role_permission.permission_id
    WHERE permission.permission_code='integration.connection.manage'
      AND role.role_key NOT IN ('PLATFORM_OWNER','COMPANY_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Company integration authority escaped approved roles';
  END IF;
  IF to_regclass('public.transactional_email_outbox') IS NULL
    OR to_regclass('public.workflow_email_outbox') IS NULL
  THEN
    RAISE EXCEPTION 'Existing transactional email boundaries are unavailable';
  END IF;
END
$assertions$;

COMMIT;
