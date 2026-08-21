BEGIN;

INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES
  ('finance.wallet.view','Finance','View Company Wallet',
    'View actual credited company funds and immutable wallet evidence in scope.',true),
  ('finance.wallet.top_up.request','Finance','Request Company Wallet top-up',
    'Request an operational review of funds to be added after external receipt.',true),
  ('finance.wallet.top_up.record','Finance','Record received Company Wallet funds',
    'Record externally confirmed funds as an immutable Company Wallet credit.',true)
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,label=EXCLUDED.label,
  description=EXCLUDED.description,high_risk=EXCLUDED.high_risk,
  active=true,updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'finance.wallet.view','finance.wallet.top_up.request','finance.wallet.top_up.record'
)
WHERE role.role_key='PLATFORM_OWNER'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'finance.wallet.view','finance.wallet.top_up.request'
)
WHERE role.role_key='COMPANY_ADMIN'
ON CONFLICT DO NOTHING;

-- The actor completing Approve & Pay must be able to open the resulting
-- invoice in the same authorized request scope. This remains a capability
-- preset only; axora_final_invoice_summary revalidates the exact request and
-- tenant/branch/department scope on every read.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission
  ON permission.permission_code='finance.invoice.view'
WHERE role.role_key IN (
  'COMPANY_APPROVER','BRANCH_APPROVER','DEPARTMENT_ADMIN'
)
ON CONFLICT DO NOTHING;

-- Canonical Delivery Guys keep DELIVERY scope and receive only the granular
-- capabilities exercised by their own claimed-job lifecycle. Role defaults
-- apply to existing users, while effective-access DENY overrides remain final.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code IN (
  'delivery.claim','delivery.accept','delivery.shop','delivery.track',
  'delivery.receipt.upload','delivery.complete'
)
WHERE role.role_key='DELIVERY_GUY'
ON CONFLICT DO NOTHING;

-- Account kind is a security boundary, not a presentation filter. Enforce it
-- on the persisted override table so every permission-management entry point
-- (including older single-override capabilities) shares the same fail-closed
-- policy.
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
        'delivery.portal.view','delivery.assignment.update'
      )
    )
    WHEN 'DELIVERY' THEN p_permission_code IN (
      'dashboard.view','delivery.view','delivery.claim','delivery.accept',
      'delivery.shop','delivery.receipt.upload','delivery.track',
      'delivery.complete','delivery.portal.view','delivery.assignment.update',
      'document.view','document.download'
    )
    WHEN 'SUPPLIER' THEN p_permission_code='dashboard.view'
      OR position('supplier.' IN p_permission_code)=1
      OR p_permission_code IN ('document.view','document.download')
    WHEN 'PLATFORM' THEN position('supplier.' IN p_permission_code)<>1
      AND p_permission_code NOT IN (
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update'
      )
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_enforce_permission_account_kind()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE account_kind_value text; permission_code_value text;
BEGIN
  IF NOT NEW.active OR NEW.effect<>'GRANT' THEN RETURN NEW; END IF;
  SELECT account.account_kind,permission.permission_code
  INTO account_kind_value,permission_code_value
  FROM public.users account
  CROSS JOIN public.permissions permission
  WHERE account.id=NEW.user_id AND permission.id=NEW.permission_id
    AND permission.active;
  IF account_kind_value IS NULL OR NOT public.axora_permission_allowed_for_account_kind(
    account_kind_value,permission_code_value
  ) THEN
    RAISE EXCEPTION 'The permission is incompatible with the target account kind'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_permission_account_kind
  ON public.user_permission_overrides;
CREATE TRIGGER enforce_permission_account_kind
BEFORE INSERT OR UPDATE ON public.user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION public.axora_enforce_permission_account_kind();

-- Preserve historical override evidence rather than rewriting it without a
-- human actor or a permission_change_history event. Resolution filters every
-- role/default, explicit GRANT and delegated permission through the account-
-- kind boundary, while DENY evidence remains present and effective. The
-- trigger above prevents any new incompatible active GRANT.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_effective_access_snapshot(uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'FUNCTION public.axora_effective_access_snapshot(',
    'FUNCTION public.axora_effective_access_snapshot_unfiltered_internal('
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('FUNCTION public.axora_effective_access_snapshot_unfiltered_internal('
      IN patched_definition)=0
  THEN RAISE EXCEPTION 'Effective-access account-kind boundary was not installed'; END IF;
  EXECUTE patched_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_effective_access_snapshot(
  p_user_id uuid,p_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; account_kind_value text;
  role_permissions_value jsonb; overrides_value jsonb; delegations_value jsonb;
BEGIN
  snapshot:=public.axora_effective_access_snapshot_unfiltered_internal(
    p_user_id,p_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  account_kind_value:=snapshot->>'accountKind';

  SELECT COALESCE(jsonb_agg(to_jsonb(item.permission_code)
    ORDER BY item.permission_code),'[]'::jsonb)
  INTO role_permissions_value
  FROM jsonb_array_elements_text(
    COALESCE(snapshot->'rolePermissions','[]'::jsonb)
  ) item(permission_code)
  WHERE public.axora_permission_allowed_for_account_kind(
    account_kind_value,item.permission_code
  );

  SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality),'[]'::jsonb)
  INTO overrides_value
  FROM jsonb_array_elements(
    COALESCE(snapshot->'permissionOverrides','[]'::jsonb)
  ) WITH ORDINALITY item(value,ordinality)
  WHERE item.value->>'effect'<>'GRANT'
    OR public.axora_permission_allowed_for_account_kind(
      account_kind_value,item.value->>'permission'
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_set(item.value,'{permissions}',COALESCE((
      SELECT jsonb_agg(to_jsonb(permission.permission_code)
        ORDER BY permission.permission_code)
      FROM jsonb_array_elements_text(
        COALESCE(item.value->'permissions','[]'::jsonb)
      ) permission(permission_code)
      WHERE public.axora_permission_allowed_for_account_kind(
        account_kind_value,permission.permission_code
      )
    ),'[]'::jsonb),true
  ) ORDER BY item.ordinality),'[]'::jsonb)
  INTO delegations_value
  FROM jsonb_array_elements(
    COALESCE(snapshot->'delegations','[]'::jsonb)
  ) WITH ORDINALITY item(value,ordinality);

  RETURN jsonb_set(jsonb_set(jsonb_set(
    snapshot,'{rolePermissions}',role_permissions_value,true
  ),'{permissionOverrides}',overrides_value,true),
    '{delegations}',delegations_value,true);
END $$;

CREATE TABLE public.company_wallets (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'MYR' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT
);

INSERT INTO public.company_wallets(company_id,currency,created_at,created_by)
SELECT company.id,'MYR',company.created_at,company.created_by
FROM public.companies company
ON CONFLICT(company_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.axora_create_company_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.company_wallets(company_id,currency,created_at,created_by)
  VALUES (NEW.id,'MYR',COALESCE(NEW.created_at,now()),NEW.created_by)
  ON CONFLICT(company_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER create_company_wallet
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_create_company_wallet();

CREATE TABLE public.company_wallet_top_up_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  requested_amount numeric(18,2) NOT NULL CHECK (
    requested_amount>0 AND requested_amount=round(requested_amount,2)
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  requester_reference text CHECK (
    char_length(btrim(COALESCE(requester_reference,'')))<=200
      AND COALESCE(requester_reference,'') !~ '[[:cntrl:]]'
  ),
  requester_note text CHECK (
    char_length(btrim(COALESCE(requester_note,'')))<=1000
      AND COALESCE(requester_note,'') !~ '[[:cntrl:]]'
  ),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED','ACKNOWLEDGED','RECEIVED','REJECTED','CANCELLED'
  )),
  status_version integer NOT NULL DEFAULT 1 CHECK (status_version>0),
  command_id uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  processed_at timestamptz,
  processing_reason text CHECK (
    char_length(btrim(COALESCE(processing_reason,'')))<=1000
  ),
  CHECK (
    (status='REQUESTED' AND processed_by IS NULL AND processed_at IS NULL)
    OR (status<>'REQUESTED' AND processed_by IS NOT NULL AND processed_at IS NOT NULL)
  )
);
CREATE INDEX company_wallet_top_up_requests_queue_idx
  ON public.company_wallet_top_up_requests(status,requested_at,id);
CREATE INDEX company_wallet_top_up_requests_company_idx
  ON public.company_wallet_top_up_requests(company_id,requested_at DESC,id DESC);

CREATE TABLE public.company_wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN (
    'TOP_UP','PAYMENT','REFUND','ADJUSTMENT'
  )),
  amount_delta numeric(18,2) NOT NULL CHECK (
    amount_delta<>0 AND amount_delta=round(amount_delta,2)
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  top_up_request_id uuid REFERENCES public.company_wallet_top_up_requests(id)
    ON DELETE RESTRICT,
  request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  business_reference text NOT NULL CHECK (
    char_length(btrim(business_reference)) BETWEEN 3 AND 200
      AND business_reference !~ '[[:cntrl:]]'
  ),
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 1000
      AND reason !~ '[[:cntrl:]]'
  ),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
      AND idempotency_key !~ '[[:cntrl:]]'
  ),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,idempotency_key),
  CHECK (
    (entry_type IN ('TOP_UP','REFUND') AND amount_delta>0)
    OR (entry_type='PAYMENT' AND amount_delta<0)
    OR entry_type='ADJUSTMENT'
  ),
  CHECK (entry_type<>'TOP_UP' OR request_id IS NULL),
  CHECK (entry_type<>'PAYMENT' OR (
    request_id IS NOT NULL AND invoice_id IS NOT NULL AND payment_id IS NOT NULL
  ))
);
CREATE UNIQUE INDEX company_wallet_one_payment_per_request_uq
  ON public.company_wallet_ledger_entries(request_id)
  WHERE entry_type='PAYMENT';
CREATE UNIQUE INDEX company_wallet_one_top_up_per_request_uq
  ON public.company_wallet_ledger_entries(top_up_request_id)
  WHERE entry_type='TOP_UP' AND top_up_request_id IS NOT NULL;
CREATE INDEX company_wallet_ledger_company_idx
  ON public.company_wallet_ledger_entries(company_id,posted_at DESC,id DESC);

CREATE VIEW public.v_company_wallet_balances AS
SELECT wallet.company_id,wallet.currency,
  COALESCE(sum(entry.amount_delta),0)::numeric(18,2) AS available_balance,
  max(entry.posted_at) AS last_posted_at
FROM public.company_wallets wallet
LEFT JOIN public.company_wallet_ledger_entries entry
  ON entry.company_id=wallet.company_id AND entry.currency=wallet.currency
GROUP BY wallet.company_id,wallet.currency;

CREATE TABLE public.company_wallet_top_up_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  top_up_request_id uuid REFERENCES public.company_wallet_top_up_requests(id)
    ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'REQUESTED','RECORDED','ALREADY_RECORDED','ACKNOWLEDGED','REJECTED','CANCELLED'
  )),
  command_id uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  amount numeric(18,2) NOT NULL CHECK (amount>0 AND amount=round(amount,2)),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  result jsonb NOT NULL CHECK (
    jsonb_typeof(result)='object' AND public.workflow_metadata_is_safe(result)
  ),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_wallet_top_up_events_company_idx
  ON public.company_wallet_top_up_events(company_id,occurred_at DESC,id DESC);

CREATE TABLE public.approve_and_pay_commands (
  command_id uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (
    jsonb_typeof(result)='object' AND public.workflow_metadata_is_safe(result)
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approve_and_pay_commands_request_idx
  ON public.approve_and_pay_commands(request_id,created_at,command_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'company_wallets','company_wallet_ledger_entries',
    'company_wallet_top_up_requests','company_wallet_top_up_events',
    'approve_and_pay_commands'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
  END LOOP;
END $$;
REVOKE ALL ON public.v_company_wallet_balances FROM PUBLIC;

CREATE TRIGGER company_wallets_append_only
BEFORE UPDATE OR DELETE ON public.company_wallets
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER company_wallet_ledger_append_only
BEFORE UPDATE OR DELETE ON public.company_wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER company_wallet_top_up_events_append_only
BEFORE UPDATE OR DELETE ON public.company_wallet_top_up_events
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER approve_and_pay_commands_append_only
BEFORE UPDATE OR DELETE ON public.approve_and_pay_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION public.axora_protect_top_up_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Company Wallet top-up evidence is immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.requested_amount IS DISTINCT FROM OLD.requested_amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.requester_reference IS DISTINCT FROM OLD.requester_reference
    OR NEW.requester_note IS DISTINCT FROM OLD.requester_note
    OR NEW.command_id IS DISTINCT FROM OLD.command_id
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_by_role_assignment_id IS DISTINCT FROM OLD.requested_by_role_assignment_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR OLD.status<>'REQUESTED'
    OR NEW.status NOT IN ('ACKNOWLEDGED','RECEIVED','REJECTED','CANCELLED')
    OR NEW.status_version<>OLD.status_version+1
  THEN RAISE EXCEPTION 'Company Wallet top-up evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_company_wallet_top_up_request
BEFORE UPDATE OR DELETE ON public.company_wallet_top_up_requests
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_top_up_request();

-- An empty wallet is tenant-owned infrastructure and may be removed only by
-- the guarded company-deletion command. Every financial command/evidence row
-- makes the tenant retention-protected instead of allowing a late FK failure.
CREATE OR REPLACE FUNCTION public.axora_protect_company_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Company Wallet evidence is append-only';
END $$;
DROP TRIGGER company_wallets_append_only ON public.company_wallets;
CREATE TRIGGER company_wallets_append_only
BEFORE UPDATE OR DELETE ON public.company_wallets
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_company_wallet();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('company_wallets','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'An empty Company Wallet is tenant-owned infrastructure; financial evidence makes the tenant retention-protected.'),
  ('company_wallet_top_up_requests','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Company Wallet top-up requests are immutable operational and financial evidence.'),
  ('company_wallet_ledger_entries','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Company Wallet ledger entries are immutable financial evidence.'),
  ('company_wallet_top_up_events','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Company Wallet top-up events are immutable idempotency and audit evidence.'),
  ('approve_and_pay_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Approve and Pay commands are immutable payment idempotency evidence.')
ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(
  delete_order,table_name,rationale
)
SELECT
  (SELECT COALESCE(max(existing.delete_order),0)
   FROM public.company_deletion_ownership_dag existing)+ordered.ordinality,
  ordered.table_name,
  'Prompt 7 immutable command and Company Wallet ownership; retained evidence blocks hard deletion, so this order is reached only for empty evidence tables.'
FROM unnest(ARRAY[
  'branch_delivery_location_commands','approve_and_pay_commands',
  'company_wallet_top_up_events',
  'company_wallet_ledger_entries','company_wallet_top_up_requests',
  'company_wallets'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
ON CONFLICT(table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.axora_company_deletion_impact_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base jsonb; owned_counts jsonb:='{}'::jsonb;
  rule record; row_count bigint; file_count bigint;
  wallet_count bigint; top_up_request_count bigint; ledger_count bigint;
  top_up_event_count bigint; approve_pay_count bigint;
  location_command_count bigint; wallet_protected_count bigint;
  protected_count bigint;
BEGIN
  base:=public.axora_company_deletion_impact(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
  SELECT
    (SELECT count(*) FROM public.company_wallets wallet
      WHERE wallet.company_id=p_company_id),
    (SELECT count(*) FROM public.company_wallet_top_up_requests request
      WHERE request.company_id=p_company_id),
    (SELECT count(*) FROM public.company_wallet_ledger_entries entry
      WHERE entry.company_id=p_company_id),
    (SELECT count(*) FROM public.company_wallet_top_up_events event
      WHERE event.company_id=p_company_id),
    (SELECT count(*) FROM public.approve_and_pay_commands command
      WHERE command.company_id=p_company_id),
    (SELECT count(*) FROM public.branch_delivery_location_commands command
      WHERE command.company_id=p_company_id)
  INTO wallet_count,top_up_request_count,ledger_count,
    top_up_event_count,approve_pay_count,location_command_count;
  wallet_protected_count:=top_up_request_count+ledger_count
    +top_up_event_count+approve_pay_count;
  protected_count:=(base->>'protectedEvidence')::bigint
    +wallet_protected_count+location_command_count;
  FOR rule IN SELECT table_name,unprotected_action,protected_action
    FROM public.company_deletion_ownership_rules
    WHERE table_name NOT IN ('companies','company_deletion_tombstones')
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id=$1',rule.table_name)
      INTO row_count USING p_company_id;
    owned_counts:=owned_counts||jsonb_build_object(rule.table_name,jsonb_build_object(
      'count',row_count,'unprotectedAction',rule.unprotected_action,
      'protectedAction',rule.protected_action
    ));
  END LOOP;
  SELECT
    (SELECT count(*) FROM public.attachments WHERE company_id=p_company_id)
    +(SELECT count(*) FROM public.generated_documents WHERE company_id=p_company_id)
    +(SELECT count(*)*3 FROM public.profile_image_versions image
      JOIN public.users account ON account.id=image.user_id
      WHERE account.company_id=p_company_id)
  INTO file_count;
  RETURN base||jsonb_build_object(
    'wallets',wallet_count,'walletTopUpRequests',top_up_request_count,
    'walletLedgerEntries',ledger_count,'walletTopUpEvents',top_up_event_count,
    'approveAndPayCommands',approve_pay_count,
    'branchDeliveryLocationCommands',location_command_count,
    'walletProtectedEvidence',wallet_protected_count,
    'protectedEvidence',protected_count,
    'confirmation',CASE WHEN protected_count>0
      THEN 'ARCHIVE AND REVOKE '||(base->>'companyCode')
      ELSE 'PERMANENTLY DELETE '||(base->>'companyCode') END,
    'hardDeleteEligible',(protected_count=0
      AND (base->>'inFlightWork')::bigint=0),
    'recommendedMode',CASE
      WHEN (base->>'inFlightWork')::bigint>0 THEN 'BLOCK'
      WHEN protected_count=0 THEN 'HARD_DELETE'
      ELSE 'ARCHIVE_RETAIN' END,
    'ownership',owned_counts,'externalFileCount',file_count,
    'externalCleanupRequired',(file_count>0),
    'retentionPolicy','Protected wallet, payment, financial, delivery, receipt and immutable audit evidence is retained with normal access revoked; no broader anonymization is performed without an approved retention policy.'
  );
END $$;

INSERT INTO public.notification_event_policies(
  event_key,category,email_mandatory,default_reminder_hours,company_configurable
) VALUES
  ('wallet.top_up.requested','FINANCE',true,24,true),
  ('wallet.top_up.recorded','FINANCE',false,NULL,true),
  ('wallet.payment.recorded','FINANCE',false,NULL,true)
ON CONFLICT(event_key) DO UPDATE SET
  category=EXCLUDED.category,email_mandatory=EXCLUDED.email_mandatory,
  default_reminder_hours=EXCLUDED.default_reminder_hours,
  company_configurable=EXCLUDED.company_configurable;

-- Preserve the existing broad source rules as an internal primitive, then add
-- exact resource-permission revalidation for events emitted by Prompt 7.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'FUNCTION public.axora_workflow_notification_recipient_is_valid(',
    'FUNCTION public.axora_workflow_notification_recipient_is_valid_base('
  );
  IF original_definition IS NULL OR patched_definition=original_definition THEN
    RAISE EXCEPTION 'Workflow recipient base could not be preserved';
  END IF;
  EXECUTE patched_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_delivery_actor_notification_is_valid(
  p_company_id uuid,p_workflow_event_id uuid,p_recipient_user_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workflow_events workflow_event
    JOIN public.delivery_job_events delivery_event
      ON delivery_event.delivery_job_id=workflow_event.aggregate_id
     AND delivery_event.command_id=workflow_event.correlation_id
     AND delivery_event.driver_user_id=p_recipient_user_id
    JOIN public.delivery_job_assignments job_assignment
      ON job_assignment.id=delivery_event.assignment_id
     AND job_assignment.delivery_job_id=workflow_event.aggregate_id
     AND job_assignment.company_id=workflow_event.company_id
     AND job_assignment.driver_user_id=p_recipient_user_id
    JOIN public.role_assignments role_assignment
      ON role_assignment.id=job_assignment.driver_role_assignment_id
     AND role_assignment.user_id=p_recipient_user_id
     AND role_assignment.active AND role_assignment.revoked_at IS NULL
     AND role_assignment.scope_type='DELIVERY'
    JOIN public.users account ON account.id=p_recipient_user_id
     AND account.active AND account.account_status='ACTIVE'
     AND account.account_kind='DELIVERY'
    CROSS JOIN LATERAL (
      SELECT public.axora_live_authorization_snapshot(
        role_assignment.user_id,role_assignment.id,now()
      ) AS value
    ) snapshot
    WHERE workflow_event.id=p_workflow_event_id
      AND workflow_event.company_id=p_company_id
      AND workflow_event.aggregate_type='delivery-job'
      AND workflow_event.actor_user_id=p_recipient_user_id
      AND workflow_event.metadata->>'deliveryActorConfirmation'='true'
      AND workflow_event.event_key IN (
        'delivery.accepted','delivery.shopping_started','delivery.items_acquired',
        'delivery.out_for_delivery','delivery.en_route','delivery.arrived',
        'delivery.partially_delivered','delivery.delivered','delivery.completed',
        'delivery.delivery_attempted','delivery.issue_reported','delivery.note_added'
      )
      AND (
        job_assignment.status='COMPLETED'
        OR (job_assignment.status IN ('ASSIGNED','ACCEPTED')
          AND job_assignment.ended_at IS NULL)
      )
      AND NULLIF(workflow_event.metadata->>'actorPermission','') IS NOT NULL
      AND public.axora_snapshot_has_permission(
        snapshot.value,workflow_event.metadata->>'actorPermission',
        'DELIVERY',NULL,NULL,NULL,NULL
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_workflow_notification_recipient_is_valid(
  p_company_id uuid,p_workflow_event_id uuid,p_recipient_user_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE event_row public.workflow_events%ROWTYPE; required_permission text;
  actor_permission text; branch_value uuid; department_value uuid;
BEGIN
  SELECT * INTO event_row FROM public.workflow_events event
  WHERE event.id=p_workflow_event_id AND event.company_id=p_company_id;
  IF event_row.id IS NULL THEN RETURN false; END IF;
  -- A delivery actor receives only confirmations for an event they produced
  -- against their exact claimed assignment. This is deliberately independent
  -- of customer branch visibility and remains valid for the completion event
  -- after the assignment is atomically closed.
  IF public.axora_delivery_actor_notification_is_valid(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN RETURN true; END IF;
  IF NOT public.axora_workflow_notification_recipient_is_valid_base(
    p_company_id,p_workflow_event_id,p_recipient_user_id
  ) THEN RETURN false; END IF;
  required_permission:=NULLIF(event_row.metadata->>'requiredPermission','');
  actor_permission:=NULLIF(event_row.metadata->>'actorPermission','');
  BEGIN branch_value:=NULLIF(event_row.metadata->>'branchId','')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN false; END;
  BEGIN department_value:=NULLIF(event_row.metadata->>'departmentId','')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN false; END;
  -- Actor confirmation is a separate recipient policy, never an authorization
  -- bypass. The private emitter names the initiating capability and the actor
  -- must still have an active assignment with that exact event-resource scope.
  IF p_recipient_user_id=event_row.actor_user_id
    AND event_row.metadata->>'actorConfirmation'='true'
    AND actor_permission IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      WHERE assignment.user_id=p_recipient_user_id AND assignment.active
        AND assignment.revoked_at IS NULL
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            assignment.user_id,assignment.id,now()
          ),actor_permission,
          CASE WHEN department_value IS NOT NULL THEN 'DEPARTMENT'
            WHEN branch_value IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END,
          p_company_id,branch_value,department_value,NULL
        )
    );
  END IF;
  IF required_permission IS NULL THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.role_assignments assignment
    WHERE assignment.user_id=p_recipient_user_id AND assignment.active
      AND assignment.revoked_at IS NULL
      AND public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot(
          assignment.user_id,assignment.id,now()
        ),required_permission,
        CASE WHEN department_value IS NOT NULL THEN 'DEPARTMENT'
          WHEN branch_value IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END,
        p_company_id,branch_value,department_value,NULL
      )
  );
END $$;

-- The driver's own notification may link to the delivery/receiving workspace
-- through the same exact event-assignment binding. It does not grant route or
-- source visibility for any other delivery.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_notification_route_is_authorized(jsonb,uuid,uuid,timestamptz)'
      ::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $$  ELSIF notification_row.route_path LIKE '/receiving%' THEN$$,
    $$  ELSIF notification_row.route_path IN ('/deliveries','/receiving')
    AND public.axora_delivery_actor_notification_is_valid(
      notification_row.company_id,notification_row.workflow_event_id,p_actor_user_id
    ) THEN
    RETURN true;
  ELSIF notification_row.route_path LIKE '/receiving%' THEN$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('axora_delivery_actor_notification_is_valid' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery actor notification route was not installed'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Wallet notification links are authorized from the immutable workflow-event
-- company, never from a caller-supplied query parameter. Preserve every
-- existing route rule and extend only the new purpose-specific workspace.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_notification_route_is_authorized(jsonb,uuid,uuid,timestamptz)'
      ::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    $$  ELSIF notification_row.route_path LIKE '/finance%' THEN$$,
    $$  ELSIF notification_row.route_path='/wallet'
    OR notification_row.route_path='/wallet?company='||event_row.company_id::text THEN
    RETURN event_row.id IS NOT NULL AND event_row.company_id IS NOT NULL
      AND public.axora_company_actor_has_permission(
        p_snapshot,p_actor_user_id,event_row.company_id,
        'finance.wallet.view',p_at
      );
  ELSIF notification_row.route_path LIKE '/finance%' THEN$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position($$notification_row.route_path='/wallet'$$ IN patched_definition)=0
  THEN RAISE EXCEPTION 'Wallet notification route authorization was not installed'; END IF;
  EXECUTE patched_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_finance_event_copy(
  p_event_key text,p_locale text,p_reference text
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_locale='ar' THEN
    RETURN CASE p_event_key
      WHEN 'wallet.top_up.requested' THEN jsonb_build_object(
        'title','طُلبت إضافة رصيد','body','يتطلب طلب إضافة الرصيد '||p_reference||' مراجعة أكسورا.')
      WHEN 'wallet.top_up.recorded' THEN jsonb_build_object(
        'title','سُجلت إضافة رصيد','body','سُجلت الأموال المستلمة في محفظة الشركة: '||p_reference||'.')
      ELSE jsonb_build_object(
        'title','تم الاعتماد والدفع','body','تم اعتماد الطلب ودفعه مرة واحدة: '||p_reference||'.') END;
  ELSIF p_locale='ms' THEN
    RETURN CASE p_event_key
      WHEN 'wallet.top_up.requested' THEN jsonb_build_object(
        'title','Tambah nilai dimohon','body','Permohonan tambah nilai '||p_reference||' memerlukan semakan Axora.')
      WHEN 'wallet.top_up.recorded' THEN jsonb_build_object(
        'title','Tambah nilai direkodkan','body','Dana diterima direkodkan dalam Dompet Syarikat: '||p_reference||'.')
      ELSE jsonb_build_object(
        'title','Diluluskan dan dibayar','body','Permintaan diluluskan dan dibayar sekali: '||p_reference||'.') END;
  END IF;
  RETURN CASE p_event_key
    WHEN 'wallet.top_up.requested' THEN jsonb_build_object(
      'title','Top-up requested','body','Top-up request '||p_reference||' is ready for Axora review.')
    WHEN 'wallet.top_up.recorded' THEN jsonb_build_object(
      'title','Top-up recorded','body','Received funds were recorded in the Company Wallet: '||p_reference||'.')
    ELSE jsonb_build_object(
      'title','Approved and paid','body','The request was approved and paid exactly once: '||p_reference||'.') END;
END $$;

CREATE OR REPLACE FUNCTION public.axora_emit_company_finance_event(
  p_company_id uuid,p_branch_id uuid,p_request_id uuid,p_aggregate_type text,
  p_aggregate_id uuid,p_event_key text,p_required_permission text,
  p_actor_user_id uuid,p_correlation_id uuid,p_idempotency_key text,
  p_reference text,p_route_path text,p_metadata jsonb,p_at timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE event_id_value uuid; next_version integer; actor_kind_value text;
  recipient_id uuid; recipient_locale text; copy_value jsonb; dedupe_value text;
  previous_context_user text:=current_setting('axora.user_id',true);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::text||':'||p_aggregate_type||':'||p_aggregate_id::text,0
  ));
  SELECT event.id INTO event_id_value FROM public.workflow_events event
  WHERE event.company_id=p_company_id AND event.idempotency_key=p_idempotency_key;
  IF event_id_value IS NOT NULL THEN RETURN event_id_value; END IF;
  SELECT account.account_kind INTO actor_kind_value FROM public.users account
  WHERE account.id=p_actor_user_id AND account.active AND account.account_status='ACTIVE';
  IF actor_kind_value IS NULL THEN RAISE EXCEPTION 'Finance event actor is unavailable'; END IF;
  -- This private emitter is reached only after its owning command reauthorizes
  -- p_actor_user_id. Bind the durable-email boundary to that validated actor
  -- and restore the caller's transaction context before returning.
  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  SELECT COALESCE(max(event.event_version),0)+1 INTO next_version
  FROM public.workflow_events event
  WHERE event.company_id=p_company_id AND event.aggregate_type=p_aggregate_type
    AND event.aggregate_id=p_aggregate_id;
  event_id_value:=gen_random_uuid();
  INSERT INTO public.workflow_events(
    id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
    event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
    occurred_at,metadata
  ) VALUES (
    event_id_value,p_company_id,p_branch_id,p_request_id,p_aggregate_type,
    p_aggregate_id,p_event_key,next_version,p_actor_user_id,actor_kind_value,
    p_correlation_id,p_idempotency_key,p_at,
    COALESCE(p_metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'requiredPermission',p_required_permission,'branchId',p_branch_id
    ))
  );

  FOR recipient_id IN
    SELECT DISTINCT candidate.user_id FROM (
      SELECT p_actor_user_id AS user_id
      UNION ALL
      SELECT assignment.user_id FROM public.role_assignments assignment
      JOIN public.users account ON account.id=assignment.user_id
        AND account.active AND account.account_status='ACTIVE'
      WHERE assignment.active AND assignment.revoked_at IS NULL
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            assignment.user_id,assignment.id,p_at
          ),p_required_permission,
          CASE WHEN p_branch_id IS NULL THEN 'COMPANY' ELSE 'BRANCH' END,
          p_company_id,p_branch_id,NULL,NULL
        )
    ) candidate
  LOOP
    IF NOT public.axora_workflow_notification_recipient_is_valid(
      p_company_id,event_id_value,recipient_id
    ) THEN CONTINUE; END IF;
    SELECT COALESCE(profile.preferred_locale,'en') INTO recipient_locale
    FROM public.user_profiles profile WHERE profile.user_id=recipient_id;
    IF recipient_locale NOT IN ('en','ar','ms') THEN recipient_locale:='en'; END IF;
    copy_value:=public.axora_finance_event_copy(
      p_event_key,recipient_locale,p_reference
    );
    dedupe_value:=p_idempotency_key||':'||recipient_id::text;
    INSERT INTO public.in_app_notifications(
      company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
      title,body,priority,route_path,created_at
    ) VALUES (
      p_company_id,recipient_id,event_id_value,p_event_key,dedupe_value,
      copy_value->>'title',copy_value->>'body','NORMAL',p_route_path,p_at
    ) ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING;
    PERFORM public.axora_enqueue_workflow_email(
      p_company_id,event_id_value,recipient_id,p_event_key,dedupe_value,
      copy_value->>'title',copy_value->>'body',p_route_path
    );
  END LOOP;
  PERFORM set_config('axora.user_id',COALESCE(previous_context_user,''),true);
  RETURN event_id_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_wallet_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'wallets',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'companyId',company.id,'companyName',company.name,
      'currency',wallet.currency,'availableBalance',balance.available_balance::text,
      'canRequestTopUp',snapshot->>'accountKind'='COMPANY'
        AND public.axora_company_actor_has_permission(
          snapshot,p_actor_user_id,company.id,'finance.wallet.top_up.request',p_at
        ),
      'canRecordTopUp',public.axora_company_actor_is_owner(snapshot)
        AND public.axora_snapshot_has_permission(
          snapshot,'finance.wallet.top_up.record','COMPANY',company.id,NULL,NULL,NULL
        ),
      'topUpRequests',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',request.id,'amount',request.requested_amount::text,
        'currency',request.currency,'reference',request.requester_reference,
        'note',request.requester_note,'status',request.status,
        'requestedBy',request.requested_by,'requestedAt',request.requested_at,
        'processedAt',request.processed_at
      ) ORDER BY request.requested_at DESC,request.id DESC)
        FROM public.company_wallet_top_up_requests request
        WHERE request.company_id=company.id),'[]'::jsonb),
      'ledger',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',entry.id,'type',entry.entry_type,'amountDelta',entry.amount_delta::text,
        'currency',entry.currency,'effectiveDate',entry.effective_date,
        'reference',entry.business_reference,'reason',entry.reason,
        'requestId',entry.request_id,'invoiceId',entry.invoice_id,
        'postedAt',entry.posted_at,'actorUserId',entry.actor_user_id
      ) ORDER BY entry.posted_at DESC,entry.id DESC)
        FROM (SELECT * FROM public.company_wallet_ledger_entries item
          WHERE item.company_id=company.id ORDER BY item.posted_at DESC,item.id DESC
          LIMIT 100) entry),'[]'::jsonb)
    ) ORDER BY company.name,company.id)
    FROM public.companies company
    JOIN public.company_wallets wallet ON wallet.company_id=company.id
    JOIN public.v_company_wallet_balances balance ON balance.company_id=company.id
    WHERE (p_company_id IS NULL OR company.id=p_company_id)
      AND public.axora_company_actor_has_permission(
        snapshot,p_actor_user_id,company.id,'finance.wallet.view',p_at
      )),'[]'::jsonb)
  );
END $$;

-- Read-only finality hint for the approval workspace. This mirrors the
-- canonical state-machine prerequisites for a standard final approval; the
-- mutation below repeats every check under transaction locks.
CREATE OR REPLACE FUNCTION public.axora_request_can_approve_and_pay_internal(
  p_snapshot jsonb,p_actor_user_id uuid,p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_row public.requests%ROWTYPE;
  approval_snapshot public.request_approval_snapshots%ROWTYPE;
  approval_limit_value numeric(18,2); available_value numeric(18,2);
  company_exposure_value numeric(18,2); company_ceiling_value numeric(18,2);
  can_override_ceiling boolean;
BEGIN
  SELECT * INTO request_row FROM public.requests request
  WHERE request.id=p_request_id AND request.approval_state IN (
    'PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA'
  );
  IF p_snapshot IS NULL OR request_row.id IS NULL
    OR request_row.created_by=p_actor_user_id
    OR NOT public.axora_snapshot_has_permission(
      p_snapshot,'request.approve.other',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      p_snapshot,'finance.invoice.view',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    )
  THEN RETURN false; END IF;
  SELECT * INTO approval_snapshot FROM public.request_approval_snapshots item
  WHERE item.request_id=request_row.id
    AND item.request_version=request_row.request_version;
  IF approval_snapshot.id IS NULL THEN RETURN false; END IF;
  approval_limit_value:=public.axora_approval_limit_for_request(
    p_snapshot,'request.approve.other',request_row.company_id,
    request_row.branch_id,request_row.department_id,
    approval_snapshot.currency,false
  );
  SELECT COALESCE(balance.available,0)::numeric(18,2)
  INTO available_value
  FROM public.budget_periods period
  LEFT JOIN public.v_budget_period_balances balance
    ON balance.budget_period_id=period.id
  WHERE period.id=request_row.budget_period_id
    AND period.budget_account_id=request_row.budget_account_id
    AND period.status='ACTIVE' AND period.starts_at<=p_at AND period.ends_at>p_at;
  SELECT company.contractual_ceiling INTO company_ceiling_value
  FROM public.companies company WHERE company.id=request_row.company_id
    AND company.active;
  SELECT COALESCE(sum(balance.reserved+balance.spent),0)::numeric(18,2)
  INTO company_exposure_value
  FROM public.v_budget_period_balances balance
  JOIN public.budget_periods period ON period.id=balance.budget_period_id
    AND period.status='ACTIVE'
  WHERE balance.company_id=request_row.company_id;
  can_override_ceiling:=public.axora_snapshot_has_permission(
    p_snapshot,'commercial.company_ceiling.override','COMPANY',
    request_row.company_id,NULL,NULL,NULL
  );
  RETURN approval_limit_value IS NOT NULL
    AND approval_limit_value>=approval_snapshot.amount
    AND COALESCE(available_value,0)>=approval_snapshot.amount
    AND (COALESCE(company_exposure_value,0)+approval_snapshot.amount
      <=company_ceiling_value OR can_override_ceiling);
END $$;

CREATE OR REPLACE FUNCTION public.axora_request_approval_workspace_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace jsonb; snapshot jsonb; requests_value jsonb;
BEGIN
  workspace:=public.axora_request_approval_workspace(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF workspace IS NULL OR snapshot IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(item||jsonb_build_object(
    'canApproveAndPay',public.axora_request_can_approve_and_pay_internal(
      snapshot,p_actor_user_id,(item->>'id')::uuid,p_at
    )
  )),'[]'::jsonb) INTO requests_value
  FROM jsonb_array_elements(COALESCE(workspace->'requests','[]'::jsonb)) item;
  RETURN jsonb_set(workspace,'{requests}',requests_value,true);
END $$;

-- Budget threshold alerts are system-authored for scheduled jobs, but an
-- actor-authored ledger entry must carry that transaction actor into the
-- workflow event. Otherwise the durable email boundary correctly rejects the
-- source mismatch and the first approval attempt rolls back at an alert edge.
CREATE OR REPLACE FUNCTION public.axora_emit_budget_notification(
  p_budget_account_id uuid,p_event_key text,p_dedupe_key text,
  p_extra_recipient uuid,p_actor_user_id uuid,p_correlation_id uuid,
  p_at timestamptz,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE account public.budget_accounts%ROWTYPE;
  effective_actor_user_id uuid:=COALESCE(
    p_actor_user_id,public.axora_context_user_id()
  );
BEGIN
  SELECT * INTO account FROM public.budget_accounts WHERE id=p_budget_account_id;
  IF account.id IS NULL THEN RETURN; END IF;
  PERFORM public.axora_emit_p1_notification(
    account.company_id,account.branch_id,NULL,'budget.account',account.id,
    p_event_key,p_dedupe_key,account.name,'/budgets',
    public.axora_budget_notification_recipients(
      account.id,
      CASE WHEN p_event_key='budget.refresh_failed'
        THEN 'budget.refresh' ELSE 'budget.view' END,
      p_extra_recipient,p_at
    ),
    effective_actor_user_id,p_correlation_id,p_at,p_metadata
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_request_company_wallet_top_up(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_amount numeric,p_reference text,p_note text,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; wallet_row public.company_wallets%ROWTYPE;
  request_row public.company_wallet_top_up_requests%ROWTYPE; result_value jsonb;
  event_id_value uuid; correlation_value uuid:=gen_random_uuid();
  payload_hash_value text;
BEGIN
  IF p_command_id IS NULL THEN RAISE EXCEPTION 'The top-up request is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wallet-top-up-request:'||p_command_id::text,0
  ));
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
    OR char_length(btrim(COALESCE(p_reference,'')))>200
    OR char_length(btrim(COALESCE(p_note,'')))>1000
  THEN RAISE EXCEPTION 'The top-up request is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation','REQUEST_COMPANY_WALLET_TOP_UP',
    'actorUserId',p_actor_user_id::text,
    'actorRoleAssignmentId',p_actor_role_assignment_id::text,
    'companyId',p_company_id::text,
    'amount',p_amount::numeric(18,2)::text,
    'reference',NULLIF(btrim(COALESCE(p_reference,'')),''),
    'note',NULLIF(btrim(COALESCE(p_note,'')),'')
  )::text,'UTF8')),'hex');
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR snapshot->>'accountKind'<>'COMPANY'
    OR NOT public.axora_company_actor_has_permission(
      snapshot,p_actor_user_id,p_company_id,'finance.wallet.top_up.request',p_at
    )
  THEN RAISE EXCEPTION 'The top-up request is unavailable'; END IF;
  SELECT * INTO request_row FROM public.company_wallet_top_up_requests request
  WHERE request.command_id=p_command_id;
  IF request_row.id IS NOT NULL THEN
    IF request_row.company_id<>p_company_id OR request_row.requested_by<>p_actor_user_id
      OR request_row.requested_by_role_assignment_id<>p_actor_role_assignment_id
      OR request_row.payload_hash<>payload_hash_value
    THEN RAISE EXCEPTION 'The top-up request is unavailable'; END IF;
    RETURN jsonb_build_object(
      'created',false,'requestId',request_row.id,'status',request_row.status,
      'amount',request_row.requested_amount::text,'currency',request_row.currency
    );
  END IF;
  SELECT * INTO wallet_row FROM public.company_wallets wallet
  WHERE wallet.company_id=p_company_id FOR KEY SHARE;
  IF wallet_row.company_id IS NULL THEN RAISE EXCEPTION 'The top-up request is unavailable'; END IF;
  INSERT INTO public.company_wallet_top_up_requests(
    company_id,requested_amount,currency,requester_reference,requester_note,
    command_id,payload_hash,requested_by,requested_by_role_assignment_id,requested_at
  ) VALUES (
    p_company_id,p_amount,wallet_row.currency,
    NULLIF(btrim(COALESCE(p_reference,'')),''),
    NULLIF(btrim(COALESCE(p_note,'')),''),p_command_id,payload_hash_value,p_actor_user_id,
    p_actor_role_assignment_id,p_at
  ) RETURNING * INTO request_row;
  result_value:=jsonb_build_object(
    'created',true,'requestId',request_row.id,'status','REQUESTED',
    'amount',request_row.requested_amount::text,'currency',request_row.currency
  );
  INSERT INTO public.company_wallet_top_up_events(
    company_id,top_up_request_id,event_type,command_id,payload_hash,amount,currency,
    actor_user_id,actor_role_assignment_id,reason,result,occurred_at
  ) VALUES (
    p_company_id,request_row.id,'REQUESTED',p_command_id,payload_hash_value,p_amount,
    wallet_row.currency,p_actor_user_id,p_actor_role_assignment_id,
    'Company Wallet top-up requested',result_value,p_at
  );
  event_id_value:=public.axora_emit_company_finance_event(
    p_company_id,NULL,NULL,'company-wallet-top-up',request_row.id,
    'wallet.top_up.requested','finance.wallet.top_up.record',p_actor_user_id,
    correlation_value,'wallet-top-up-requested:'||p_command_id::text,
    request_row.id::text,'/wallet?company='||p_company_id::text,
    jsonb_build_object(
      'topUpRequestId',request_row.id,'actorConfirmation',true,
      'actorPermission','finance.wallet.top_up.request'
    ),p_at
  );
  RETURN result_value||jsonb_build_object('workflowEventId',event_id_value);
END $$;

CREATE OR REPLACE FUNCTION public.axora_record_company_wallet_top_up(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_top_up_request_id uuid,p_amount numeric,p_effective_date date,
  p_reference text,p_reason text,p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; wallet_row public.company_wallets%ROWTYPE;
  request_row public.company_wallet_top_up_requests%ROWTYPE;
  existing_event public.company_wallet_top_up_events%ROWTYPE;
  ledger_id_value uuid; result_value jsonb; correlation_value uuid:=gen_random_uuid();
  event_type_value text; event_id_value uuid; payload_hash_value text;
BEGIN
  IF p_command_id IS NULL THEN RAISE EXCEPTION 'The received top-up is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wallet-top-up-record:'||p_command_id::text,0
  ));
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
    OR p_effective_date IS NULL OR p_effective_date>p_at::date
    OR char_length(btrim(COALESCE(p_reference,''))) NOT BETWEEN 3 AND 200
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'The received top-up is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation','RECORD_COMPANY_WALLET_TOP_UP',
    'actorUserId',p_actor_user_id::text,
    'actorRoleAssignmentId',p_actor_role_assignment_id::text,
    'companyId',p_company_id::text,
    'topUpRequestId',p_top_up_request_id::text,
    'amount',p_amount::numeric(18,2)::text,
    'effectiveDate',p_effective_date::text,
    'reference',btrim(p_reference),
    'reason',btrim(p_reason)
  )::text,'UTF8')),'hex');
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_company_actor_is_owner(snapshot)
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'finance.wallet.top_up.record','COMPANY',p_company_id,NULL,NULL,NULL
    )
  THEN RAISE EXCEPTION 'The received top-up is unavailable'; END IF;
  SELECT * INTO existing_event FROM public.company_wallet_top_up_events event
  WHERE event.command_id=p_command_id;
  IF existing_event.id IS NOT NULL THEN
    IF existing_event.company_id<>p_company_id OR existing_event.actor_user_id<>p_actor_user_id
      OR existing_event.actor_role_assignment_id<>p_actor_role_assignment_id
      OR existing_event.payload_hash<>payload_hash_value
    THEN RAISE EXCEPTION 'The received top-up is unavailable'; END IF;
    RETURN existing_event.result;
  END IF;
  IF p_top_up_request_id IS NOT NULL THEN
    SELECT * INTO request_row FROM public.company_wallet_top_up_requests request
    WHERE request.id=p_top_up_request_id AND request.company_id=p_company_id FOR UPDATE;
    IF request_row.id IS NULL THEN RAISE EXCEPTION 'The received top-up is unavailable'; END IF;
  END IF;
  SELECT * INTO wallet_row FROM public.company_wallets wallet
  WHERE wallet.company_id=p_company_id FOR UPDATE;
  IF wallet_row.company_id IS NULL OR wallet_row.currency IS NULL
    OR (request_row.id IS NOT NULL AND request_row.currency<>wallet_row.currency)
  THEN RAISE EXCEPTION 'The received top-up is unavailable'; END IF;

  IF request_row.id IS NOT NULL AND request_row.status='RECEIVED' THEN
    SELECT entry.id,entry.amount_delta INTO ledger_id_value,p_amount
    FROM public.company_wallet_ledger_entries entry
    WHERE entry.top_up_request_id=request_row.id AND entry.entry_type='TOP_UP';
    result_value:=jsonb_build_object(
      'created',false,'status','RECEIVED','topUpRequestId',request_row.id,
      'ledgerEntryId',ledger_id_value,'amount',p_amount::text,
      'currency',request_row.currency
    );
    event_type_value:='ALREADY_RECORDED';
  ELSE
    INSERT INTO public.company_wallet_ledger_entries(
      company_id,entry_type,amount_delta,currency,top_up_request_id,
      effective_date,business_reference,reason,correlation_id,idempotency_key,
      actor_user_id,actor_role_assignment_id,posted_at
    ) VALUES (
      p_company_id,'TOP_UP',p_amount,wallet_row.currency,p_top_up_request_id,
      p_effective_date,btrim(p_reference),btrim(p_reason),correlation_value,
      'top-up:'||p_command_id::text,p_actor_user_id,p_actor_role_assignment_id,p_at
    ) RETURNING id INTO ledger_id_value;
    IF request_row.id IS NOT NULL THEN
      UPDATE public.company_wallet_top_up_requests SET status='RECEIVED',
        status_version=status_version+1,processed_by=p_actor_user_id,
        processed_at=p_at,processing_reason=btrim(p_reason)
      WHERE id=request_row.id;
    END IF;
    result_value:=jsonb_build_object(
      'created',true,'status','RECEIVED','topUpRequestId',p_top_up_request_id,
      'ledgerEntryId',ledger_id_value,'amount',p_amount::text,
      'currency',wallet_row.currency
    );
    event_type_value:='RECORDED';
  END IF;
  INSERT INTO public.company_wallet_top_up_events(
    company_id,top_up_request_id,event_type,command_id,payload_hash,amount,currency,
    actor_user_id,actor_role_assignment_id,reason,result,occurred_at
  ) VALUES (
    p_company_id,p_top_up_request_id,event_type_value,p_command_id,
    payload_hash_value,p_amount,
    wallet_row.currency,p_actor_user_id,p_actor_role_assignment_id,
    btrim(p_reason),result_value,p_at
  );
  IF event_type_value='RECORDED' THEN
    event_id_value:=public.axora_emit_company_finance_event(
      p_company_id,NULL,NULL,'company-wallet-top-up',
      COALESCE(p_top_up_request_id,ledger_id_value),'wallet.top_up.recorded',
      'finance.wallet.view',p_actor_user_id,correlation_value,
      'wallet-top-up-recorded:'||p_command_id::text,btrim(p_reference),
      '/wallet?company='||p_company_id::text,
      jsonb_build_object(
        'ledgerEntryId',ledger_id_value,'actorConfirmation',true
      ),p_at
    );
  END IF;
  RETURN result_value||jsonb_strip_nulls(jsonb_build_object(
    'workflowEventId',event_id_value
  ));
END $$;

-- Preserve the invoice/payment implementation as a private primitive for both
-- the current atomic command and the immediately previous checkout contract.
-- Both public entry points perform their own current authorization before this
-- revoked primitive is reached.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'FUNCTION public.axora_complete_payment(',
    'FUNCTION public.axora_complete_payment_internal('
  );
  patched_definition:=replace(patched_definition,
    $$  SELECT public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,'request.submit',p_request_id,p_at
  ) INTO access_snapshot;
  IF access_snapshot IS NULL THEN
    RAISE EXCEPTION 'The request is unavailable' USING ERRCODE='42501';
  END IF;
$$,
    $$  access_snapshot:='{}'::jsonb;
$$
  );
  patched_definition:=replace(
    patched_definition,
    $$AND account.account_status='ACTIVE' AND account.account_kind='COMPANY'$$,
    $$AND account.account_status='ACTIVE'$$
  );
  patched_definition:=replace(
    patched_definition,
    $$    'registrationNumber',COALESCE(request_row.company_json->>'registration_number',''),
$$,
    ''
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('FUNCTION public.axora_complete_payment_internal(' IN patched_definition)=0
    OR position('axora_lock_request_resource_access' IN patched_definition)>0
    OR position('registrationNumber' IN patched_definition)>0
  THEN RAISE EXCEPTION 'Payment authority was not consolidated'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Keep the established budget-finalization implementation private as well.
-- The enclosing wallet-aware command owns current authorization and the
-- request/budget/wallet lock order; this primitive cannot be called by the app.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_finalize_request_budget(uuid,uuid,uuid,numeric,text,text,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(
    original_definition,
    'FUNCTION public.axora_finalize_request_budget(',
    'FUNCTION public.axora_finalize_request_budget_internal('
  );
  patched_definition:=replace(patched_definition,
    $$  IF snapshot IS NULL OR request_row.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'request.approve.other',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    ) THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
$$,
    $$  IF snapshot IS NULL OR request_row.id IS NULL THEN
    RAISE EXCEPTION 'The request is unavailable';
  END IF;
$$
  );
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('FUNCTION public.axora_finalize_request_budget_internal(' IN patched_definition)=0
    OR position($$IF snapshot IS NULL OR request_row.id IS NULL
    OR NOT public.axora_snapshot_has_permission($$ IN patched_definition)>0
  THEN RAISE EXCEPTION 'Budget finalization authority was not consolidated'; END IF;
  EXECUTE patched_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_approve_and_pay_internal(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_expected_approval_revision integer,p_reason text,p_command_id uuid,
  p_at timestamptz DEFAULT now(),p_legacy_checkout boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; request_row public.requests%ROWTYPE;
  approval_snapshot public.request_approval_snapshots%ROWTYPE;
  wallet_row public.company_wallets%ROWTYPE; balance_value numeric(18,2);
  budget_available numeric(18,2); approval_result jsonb; invoice_result jsonb;
  finalization_result jsonb; existing_command public.approve_and_pay_commands%ROWTYPE;
  existing_invoice public.invoices%ROWTYPE; payment_id_value uuid;
  result_value jsonb; correlation_value uuid:=gen_random_uuid();
  location_id_value uuid; branch_ready boolean; location_ready boolean;
  current_state text;
  is_pending boolean; location_failure boolean:=false;
  approval_limit_value numeric(18,2); company_exposure_value numeric(18,2);
  company_ceiling_value numeric(18,2); period_available numeric(18,2);
  can_override_ceiling boolean; payload_hash_value text;
BEGIN
  IF p_command_id IS NULL THEN RAISE EXCEPTION 'Approve & Pay is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'approve-and-pay-command:'||p_command_id::text,0
  ));
  IF p_expected_approval_revision<1
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Approve & Pay is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation',CASE WHEN p_legacy_checkout THEN 'LEGACY_COMPLETE_PAYMENT'
      ELSE 'APPROVE_AND_PAY' END,
    'actorUserId',p_actor_user_id::text,
    'actorRoleAssignmentId',p_actor_role_assignment_id::text,
    'requestId',p_request_id::text,
    'expectedApprovalRevision',CASE WHEN p_legacy_checkout THEN NULL
      ELSE p_expected_approval_revision END,
    'reason',btrim(p_reason)
  )::text,'UTF8')),'hex');
  SELECT public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,
    CASE WHEN p_legacy_checkout THEN 'request.submit' ELSE 'request.approve.other' END,
    p_request_id,p_at
  ) INTO snapshot;
  IF snapshot IS NULL THEN
    RAISE EXCEPTION 'The request is unavailable' USING ERRCODE='42501';
  END IF;
  -- The lock capability returns a resource snapshot. Amount limits and
  -- override permissions belong to the actor's live authorization snapshot,
  -- so recapture that distinct authority under the same transaction locks.
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN
    RAISE EXCEPTION 'The request is unavailable' USING ERRCODE='42501';
  END IF;
  -- A command UUID is duplicate protection, not a bearer token. Replays return
  -- the durable result only after current exact-request authorization succeeds.
  SELECT * INTO request_row FROM public.requests request
  WHERE request.id=p_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
  IF p_legacy_checkout AND request_row.created_by<>p_actor_user_id THEN
    RAISE EXCEPTION 'The request is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing_command FROM public.approve_and_pay_commands command
  WHERE command.command_id=p_command_id;
  IF existing_command.command_id IS NOT NULL THEN
    IF existing_command.actor_user_id<>p_actor_user_id
      OR existing_command.request_id<>p_request_id
      OR existing_command.actor_role_assignment_id<>p_actor_role_assignment_id
      OR existing_command.payload_hash<>payload_hash_value
    THEN RAISE EXCEPTION 'Approve & Pay is unavailable'; END IF;
    RETURN existing_command.result;
  END IF;
  SELECT * INTO approval_snapshot FROM public.request_approval_snapshots item
  WHERE item.request_id=request_row.id
    AND item.request_version=request_row.request_version FOR KEY SHARE;
  IF approval_snapshot.id IS NULL THEN RAISE EXCEPTION 'The request snapshot is unavailable'; END IF;

  -- Revalidate final payment authority at commit time even when another actor
  -- recorded the earlier approval. Scope permission alone is not an amount
  -- authority, and an approver can never pay their own request.
  IF NOT p_legacy_checkout THEN
    approval_limit_value:=public.axora_approval_limit_for_request(
      snapshot,'request.approve.other',request_row.company_id,
      request_row.branch_id,request_row.department_id,
      approval_snapshot.currency,false
    );
  END IF;
  IF NOT p_legacy_checkout AND (request_row.created_by=p_actor_user_id
    OR approval_limit_value IS NULL OR approval_limit_value<approval_snapshot.amount) THEN
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState','FINAL_PAYMENT_AUTHORITY_REQUIRED'
    );
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;
  IF NOT p_legacy_checkout AND NOT public.axora_snapshot_has_permission(
    snapshot,'finance.invoice.view',
    CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
    request_row.company_id,request_row.branch_id,request_row.department_id,NULL
  ) THEN
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState','FINAL_PAYMENT_AUTHORITY_REQUIRED'
    );
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;

  SELECT * INTO existing_invoice FROM public.invoices invoice
  WHERE invoice.request_id=request_row.id AND invoice.direction='CUSTOMER'
    AND invoice.checkout_idempotency_key IS NOT NULL FOR UPDATE;
  IF existing_invoice.id IS NOT NULL THEN
    result_value:=jsonb_build_object(
      'status','ALREADY_PROCESSED','commandId',p_command_id,
      'requestId',request_row.id,'invoiceId',existing_invoice.id,
      'amount',existing_invoice.amount::text,'currency',existing_invoice.currency,
      'created',false,'correlationId',correlation_value
    );
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;
  IF request_row.approval_revision<>p_expected_approval_revision THEN
    result_value:=jsonb_build_object(
      'status','STALE_REQUEST','commandId',p_command_id,
      'requestId',request_row.id,'expectedRevision',p_expected_approval_revision,
      'currentRevision',request_row.approval_revision
    );
  ELSIF (p_legacy_checkout AND request_row.approval_state<>'APPROVED')
    OR (NOT p_legacy_checkout AND request_row.approval_state NOT IN (
      'PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA','APPROVED'
    )) THEN
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState',request_row.approval_state
    );
  END IF;
  IF result_value IS NOT NULL THEN
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;

  is_pending:=request_row.approval_state<>'APPROVED';
  -- Match the canonical location-save/job order: branch -> location. Hold both
  -- share locks through approval, payment, and immutable job creation so an
  -- update waits without forming a location -> branch deadlock cycle.
  PERFORM 1 FROM public.branches branch
  WHERE branch.id=request_row.branch_id
    AND branch.company_id=request_row.company_id AND branch.active
  FOR SHARE;
  branch_ready:=FOUND;
  IF branch_ready THEN
    SELECT location.id INTO location_id_value
    FROM public.delivery_locations location
    WHERE location.branch_id=request_row.branch_id AND location.active
      AND location.is_primary
      AND location.latitude BETWEEN -90 AND 90
      AND location.longitude BETWEEN -180 AND 180
    FOR SHARE;
  END IF;
  location_ready:=branch_ready AND location_id_value IS NOT NULL;
  IF NOT location_ready THEN
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState','BRANCH_LOCATION_REQUIRED'
    );
  ELSE
    PERFORM 1 FROM public.budget_periods period
    WHERE period.id=request_row.budget_period_id
      AND period.budget_account_id=request_row.budget_account_id
      AND period.status='ACTIVE' AND period.starts_at<=p_at AND period.ends_at>p_at
    FOR UPDATE;
    IF NOT FOUND THEN
      result_value:=jsonb_build_object(
        'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
        'requestState','BUDGET_PERIOD_REQUIRED'
      );
    END IF;
    -- Match axora_decide_request_approval and the canonical budget mutation
    -- order: request -> budget period -> company. Locking the company before
    -- the shared period can deadlock two different requests when one follows
    -- the normal approval path and the other follows Approve & Pay.
    PERFORM 1 FROM public.companies company
    WHERE company.id=request_row.company_id FOR UPDATE;
    SELECT COALESCE(balance.available,0)::numeric(18,2)
    INTO period_available FROM public.v_budget_period_balances balance
    WHERE balance.budget_period_id=request_row.budget_period_id;
    SELECT company.contractual_ceiling INTO company_ceiling_value
    FROM public.companies company WHERE company.id=request_row.company_id;
    SELECT COALESCE(sum(balance.reserved+balance.spent),0)::numeric(18,2)
    INTO company_exposure_value
    FROM public.v_budget_period_balances balance
    JOIN public.budget_periods period ON period.id=balance.budget_period_id
      AND period.status='ACTIVE'
    WHERE balance.company_id=request_row.company_id;
    can_override_ceiling:=public.axora_snapshot_has_permission(
      snapshot,'commercial.company_ceiling.override','COMPANY',
      request_row.company_id,NULL,NULL,NULL
    );

    IF result_value IS NULL AND is_pending
      AND COALESCE(company_exposure_value,0)+approval_snapshot.amount
        >company_ceiling_value AND NOT can_override_ceiling THEN
      result_value:=jsonb_build_object(
        'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
        'requestState','NON_FINAL_APPROVAL_REQUIRED'
      );
    ELSIF result_value IS NULL AND NOT is_pending
      AND COALESCE(company_exposure_value,0)>company_ceiling_value
      AND NOT can_override_ceiling THEN
      result_value:=jsonb_build_object(
        'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
        'requestState','COMPANY_CEILING_REVIEW_REQUIRED'
      );
    END IF;

    IF result_value IS NULL AND is_pending THEN
      budget_available:=COALESCE(period_available,0);
    ELSIF result_value IS NULL THEN
      -- An already-approved request must carry its still-live reservation.
      -- The unallocated period balance is not spend authority for this command.
      SELECT reservation.remaining_reserved INTO budget_available
      FROM public.budget_reservations reservation
      WHERE reservation.request_id=request_row.id
        AND reservation.request_version=request_row.request_version
        AND reservation.budget_account_id=request_row.budget_account_id
        AND reservation.budget_period_id=request_row.budget_period_id
        AND reservation.status IN ('RESERVED','PARTIALLY_SPENT')
      FOR UPDATE;
    END IF;
    IF result_value IS NULL
      AND COALESCE(budget_available,0)<approval_snapshot.amount THEN
      result_value:=jsonb_build_object(
        'status','INSUFFICIENT_BUDGET','commandId',p_command_id,
        'requestId',request_row.id,'requiredAmount',approval_snapshot.amount::text,
        'availableAmount',COALESCE(budget_available,0)::text,
        'currency',approval_snapshot.currency
      );
    ELSIF result_value IS NULL THEN
      SELECT * INTO wallet_row FROM public.company_wallets wallet
      WHERE wallet.company_id=request_row.company_id FOR UPDATE;
      SELECT COALESCE(balance.available_balance,0)::numeric(18,2)
      INTO balance_value FROM public.v_company_wallet_balances balance
      WHERE balance.company_id=request_row.company_id;
      IF wallet_row.company_id IS NULL
        OR wallet_row.currency<>approval_snapshot.currency
        OR COALESCE(balance_value,0)<approval_snapshot.amount THEN
        result_value:=jsonb_build_object(
          'status','INSUFFICIENT_WALLET','commandId',p_command_id,
          'requestId',request_row.id,'requiredAmount',approval_snapshot.amount::text,
          'availableAmount',COALESCE(balance_value,0)::text,
          'currency',approval_snapshot.currency
        );
      END IF;
    END IF;
  END IF;
  IF result_value IS NOT NULL THEN
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;

  -- Approval through delivery-job creation is one exception-backed
  -- subtransaction. Migration 103 raises only P7301 when its locked,
  -- defense-in-depth destination check cannot create the immutable job. The
  -- handler rolls back the approval, reservation, invoice/payment, budget,
  -- wallet ledger and outbox work before returning a controlled local result.
  BEGIN
  IF is_pending THEN
    -- If an unmodelled policy rule makes this non-final, roll the partial
    -- approval/escalation subtransaction back before returning a local result.
    BEGIN
      approval_result:=public.axora_decide_request_approval(
        p_actor_user_id,p_actor_role_assignment_id,p_request_id,
        p_expected_approval_revision,'APPROVE','',NULL,btrim(p_reason),
        'approve-pay:'||p_command_id::text||':approval',p_at
      );
      current_state:=approval_result->>'state';
      IF current_state<>'APPROVED' THEN
        RAISE EXCEPTION 'Approval is not final' USING ERRCODE='P7401';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P7401' THEN
      result_value:=jsonb_build_object(
        'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
        'requestState','NON_FINAL_APPROVAL_REQUIRED'
      );
    END;
    IF result_value IS NOT NULL THEN
      INSERT INTO public.approve_and_pay_commands(
        command_id,payload_hash,request_id,company_id,actor_user_id,
        actor_role_assignment_id,result,created_at
      ) VALUES (
        p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
        p_actor_role_assignment_id,result_value,p_at
      );
      RETURN result_value;
    END IF;
    SELECT reservation.remaining_reserved INTO budget_available
    FROM public.budget_reservations reservation
    WHERE reservation.request_id=request_row.id
      AND reservation.request_version=request_row.request_version
      AND reservation.budget_account_id=request_row.budget_account_id
      AND reservation.budget_period_id=request_row.budget_period_id
      AND reservation.status='RESERVED'
    FOR UPDATE;
    IF COALESCE(budget_available,0)<approval_snapshot.amount THEN
      RAISE EXCEPTION 'Approve & Pay reservation invariant failed';
    END IF;
  END IF;

  invoice_result:=public.axora_complete_payment_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_request_id,'OFFLINE',
    'approve-pay:'||p_command_id::text||':payment',p_at
  );
  finalization_result:=public.axora_finalize_request_budget_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_request_id,
    approval_snapshot.amount,btrim(p_reason),
    'approve-pay:'||p_command_id::text||':budget',p_at
  );
  IF finalization_result->>'state'<>'AWAITING_FULFILMENT' THEN
    RAISE EXCEPTION 'Approve & Pay budget finalization failed';
  END IF;
  SELECT payment.id INTO payment_id_value FROM public.payments payment
  WHERE payment.invoice_id=(invoice_result->>'invoiceId')::uuid
    AND payment.payment_status='PAID' FOR KEY SHARE;
  INSERT INTO public.company_wallet_ledger_entries(
    company_id,entry_type,amount_delta,currency,request_id,invoice_id,payment_id,
    effective_date,business_reference,reason,correlation_id,idempotency_key,
    actor_user_id,actor_role_assignment_id,posted_at
  ) VALUES (
    request_row.company_id,'PAYMENT',-approval_snapshot.amount,
    approval_snapshot.currency,request_row.id,(invoice_result->>'invoiceId')::uuid,
    payment_id_value,(p_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
    COALESCE(invoice_result->>'invoiceNumber',request_row.order_code),
    btrim(p_reason),correlation_value,
    'approve-pay:'||p_command_id::text||':wallet',p_actor_user_id,
    p_actor_role_assignment_id,p_at
  );
  result_value:=jsonb_build_object(
    'status','SUCCESS','commandId',p_command_id,'requestId',request_row.id,
    'invoiceId',invoice_result->>'invoiceId','amount',approval_snapshot.amount::text,
    'currency',approval_snapshot.currency,'created',true,
    'correlationId',correlation_value,
    'approvalDecisionId',approval_result->>'decisionId',
    'budgetDecisionId',finalization_result->>'decisionId'
  );
  INSERT INTO public.approve_and_pay_commands(
    command_id,payload_hash,request_id,company_id,actor_user_id,
    actor_role_assignment_id,result,created_at
  ) VALUES (
    p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
    p_actor_role_assignment_id,result_value,p_at
  );
  PERFORM public.axora_emit_company_finance_event(
    request_row.company_id,request_row.branch_id,request_row.id,
    'request-payment',request_row.id,'wallet.payment.recorded',
    'finance.invoice.view',p_actor_user_id,correlation_value,
    'wallet-payment-recorded:'||p_command_id::text,request_row.order_code,
    '/requests/'||request_row.id::text,
    jsonb_build_object(
      'invoiceId',invoice_result->>'invoiceId',
      'amount',approval_snapshot.amount::text,
      'currency',approval_snapshot.currency,
      'actorConfirmation',true
    ),p_at
  );
  EXCEPTION WHEN SQLSTATE 'P7301' THEN
    location_failure:=true;
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState','BRANCH_LOCATION_REQUIRED'
    );
  END;
  IF location_failure THEN
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,p_actor_user_id,
      p_actor_role_assignment_id,result_value,p_at
    );
  END IF;
  RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_approve_and_pay(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_expected_approval_revision integer,p_reason text,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_approve_and_pay_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_request_id,
    p_expected_approval_revision,p_reason,p_command_id,p_at,false
  )
$$;

-- Previous-image compatibility boundary. The signature and successful result
-- shape remain compatible with migration 076, but the mutation is routed into
-- the same wallet/budget/payment transaction used by the Prompt 7 image.
CREATE OR REPLACE FUNCTION public.axora_complete_payment(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_strategy text,p_idempotency_key text,p_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_revision integer; command_hash text; command_id_value uuid;
  payment_result jsonb; invoice_row public.invoices%ROWTYPE;
  command_existed boolean;
BEGIN
  IF p_strategy<>'OFFLINE'
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Payment completion is invalid';
  END IF;
  SELECT request.approval_revision INTO request_revision
  FROM public.requests request WHERE request.id=p_request_id;
  IF request_revision IS NULL THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
  command_hash:=encode(pg_catalog.sha256(convert_to(
    'legacy-complete-payment:'||p_request_id::text||':'||p_idempotency_key,'UTF8'
  )),'hex');
  command_id_value:=(substr(command_hash,1,8)||'-'||substr(command_hash,9,4)||'-'
    ||substr(command_hash,13,4)||'-'||substr(command_hash,17,4)||'-'
    ||substr(command_hash,21,12))::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'approve-and-pay-command:'||command_id_value::text,0
  ));
  SELECT EXISTS(
    SELECT 1 FROM public.approve_and_pay_commands command
    WHERE command.command_id=command_id_value
  ) INTO command_existed;
  payment_result:=public.axora_approve_and_pay_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_request_id,request_revision,
    'Checkout payment completed',command_id_value,p_at,true
  );
  IF payment_result->>'status' NOT IN ('SUCCESS','ALREADY_PROCESSED') THEN
    RAISE EXCEPTION 'Payment could not be completed: %',payment_result->>'status';
  END IF;
  SELECT * INTO invoice_row FROM public.invoices invoice
  WHERE invoice.id=(payment_result->>'invoiceId')::uuid;
  IF invoice_row.id IS NULL THEN RAISE EXCEPTION 'Payment could not be completed'; END IF;
  RETURN jsonb_build_object(
    'invoiceId',invoice_row.id,'invoiceNumber',invoice_row.invoice_number,
    'paymentStatus','PAID','invoiceStatus',invoice_row.lifecycle_status,
    'created',NOT command_existed AND (payment_result->>'status')='SUCCESS'
  );
END $$;

-- Invoice reads now serve both scoped finance viewers (including the actor
-- who completed Approve & Pay) and the original requester compatibility path.
-- request.submit is deliberately restricted to the request owner here: that
-- permission alone must not expose another requester's invoice in the same
-- branch or department.
CREATE OR REPLACE FUNCTION public.axora_final_invoice_summary(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,
    'status',invoice.lifecycle_status,'paymentStatus',payment.payment_status,
    'amount',invoice.amount::text,'currency',invoice.currency,
    'issuedAt',invoice.finalized_at,'paidAt',payment.paid_at,
    'documentId',document.id,
    'downloadUrl',CASE WHEN document.id IS NOT NULL
      THEN '/api/generated-documents/'||document.id END,
    'emailStatus',outbox.delivery_status
  )
  FROM public.invoices invoice
  JOIN public.payments payment ON payment.invoice_id=invoice.id
    AND payment.payment_status='PAID'
  LEFT JOIN public.generated_documents document
    ON document.request_id=invoice.request_id
    AND document.document_type='FINAL_INVOICE'
    AND document.lifecycle_status='CURRENT'
    AND public.axora_generated_document_access_allowed(
      p_actor_user_id,p_actor_role_assignment_id,document.id,p_at
    )
  LEFT JOIN public.transactional_email_outbox outbox
    ON outbox.invoice_id=invoice.id
  WHERE invoice.request_id=p_request_id AND invoice.direction='CUSTOMER'
    AND invoice.lifecycle_status='FINALIZED'
    AND (
      public.axora_request_resource_access(
        p_actor_user_id,p_actor_role_assignment_id,
        'finance.invoice.view',p_request_id,p_at
      ) IS NOT NULL
      OR public.axora_request_resource_access(
        p_actor_user_id,p_actor_role_assignment_id,
        'request.submit',p_request_id,p_at
      )->>'ownerUserId'=p_actor_user_id::text
    )
  ORDER BY payment.paid_at
  LIMIT 1
$$;

-- Evidence metadata is a capability, not a raw-table read. Revalidate the
-- exact job company/branch on every request so a forged evidence UUID cannot
-- turn a platform CAM assignment or company membership into cross-tenant
-- access. The HTTP storage signature remains defense in depth after this DB
-- authorization decision.
CREATE OR REPLACE FUNCTION public.axora_delivery_evidence_file(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_evidence_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  evidence_id uuid,file_name text,content_type text,storage_path text,
  sha256 text,delivery_job_id uuid,evidence_version integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; evidence public.delivery_evidence%ROWTYPE;
  job public.delivery_jobs%ROWTYPE; authorized boolean:=false;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO evidence FROM public.delivery_evidence item
  WHERE item.id=p_evidence_id;
  SELECT * INTO job FROM public.delivery_jobs item
  WHERE item.id=evidence.delivery_job_id;
  IF snapshot IS NULL OR evidence.id IS NULL OR job.id IS NULL
    OR evidence.company_id<>job.company_id
    OR evidence.validation_status<>'ACCEPTED'
    OR (evidence.retention_until<=p_at AND NOT evidence.legal_hold)
  THEN RETURN; END IF;

  IF snapshot->>'accountKind'='PLATFORM' THEN
    IF COALESCE((snapshot->>'isOwner')::boolean,false) THEN
      authorized:=public.axora_snapshot_has_permission(
        snapshot,'delivery.view','PLATFORM',NULL,NULL,NULL,NULL
      );
    ELSIF snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER' THEN
      authorized:=public.axora_company_assignment_is_active(
        p_actor_user_id,job.company_id,p_at
      ) AND public.axora_snapshot_has_permission(
        snapshot,'delivery.view','BRANCH',job.company_id,job.branch_id,NULL,NULL
      );
    END IF;
  ELSIF snapshot->>'accountKind'='COMPANY' THEN
    authorized:=public.axora_snapshot_has_permission(
      snapshot,'delivery.view','BRANCH',job.company_id,job.branch_id,NULL,NULL
    );
  ELSIF snapshot->>'accountKind'='DELIVERY' THEN
    authorized:=EXISTS (
      SELECT 1 FROM public.delivery_job_assignments assignment
      WHERE assignment.delivery_job_id=job.id
        AND assignment.company_id=job.company_id
        AND assignment.driver_user_id=p_actor_user_id
        AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
    );
  END IF;
  IF NOT authorized THEN RETURN; END IF;
  RETURN QUERY SELECT evidence.id,evidence.file_name,evidence.content_type,
    evidence.storage_path,evidence.sha256,evidence.delivery_job_id,
    evidence.evidence_version;
END
$$;

-- Expand/contract rollback boundary: keep the migration-076 public signature
-- and grant while a previous image remains deployable, but never its pre-wallet
-- implementation. A later contract migration may retire this wrapper.

REVOKE ALL ON FUNCTION public.axora_create_company_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_permission_allowed_for_account_kind(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_enforce_permission_account_kind() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_effective_access_snapshot_unfiltered_internal(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_top_up_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_company_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_workflow_notification_recipient_is_valid_base(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_actor_notification_is_valid(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_finance_event_copy(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_emit_company_finance_event(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,text,text,text,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_wallet_workspace(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_can_approve_and_pay_internal(jsonb,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_approval_workspace_v2(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_emit_budget_notification(uuid,text,text,uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_company_wallet_top_up(uuid,uuid,uuid,numeric,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_record_company_wallet_top_up(uuid,uuid,uuid,uuid,numeric,date,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_approve_and_pay(uuid,uuid,uuid,integer,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_final_invoice_summary(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_complete_payment_internal(uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_finalize_request_budget_internal(uuid,uuid,uuid,numeric,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_approve_and_pay_internal(uuid,uuid,uuid,integer,text,uuid,timestamptz,boolean) FROM PUBLIC;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  REVOKE ALL ON TABLE
    public.company_wallets,public.company_wallet_top_up_requests,
    public.company_wallet_ledger_entries,public.company_wallet_top_up_events,
    public.approve_and_pay_commands,public.v_company_wallet_balances
  FROM axora_app;
  REVOKE ALL ON FUNCTION
    public.axora_create_company_wallet(),
    public.axora_permission_allowed_for_account_kind(text,text),
    public.axora_enforce_permission_account_kind(),
    public.axora_effective_access_snapshot_unfiltered_internal(uuid,uuid,timestamptz),
    public.axora_protect_top_up_request(),
    public.axora_protect_company_wallet(),
    public.axora_workflow_notification_recipient_is_valid_base(uuid,uuid,uuid),
    public.axora_delivery_actor_notification_is_valid(uuid,uuid,uuid),
    public.axora_finance_event_copy(text,text,text),
    public.axora_emit_company_finance_event(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,text,text,text,jsonb,timestamptz),
    public.axora_request_can_approve_and_pay_internal(jsonb,uuid,uuid,timestamptz),
    public.axora_emit_budget_notification(uuid,text,text,uuid,uuid,uuid,timestamptz,jsonb),
    public.axora_complete_payment_internal(uuid,uuid,uuid,text,text,timestamptz),
    public.axora_finalize_request_budget_internal(uuid,uuid,uuid,numeric,text,text,timestamptz),
    public.axora_approve_and_pay_internal(uuid,uuid,uuid,integer,text,uuid,timestamptz,boolean)
  FROM axora_app;
  REVOKE EXECUTE ON FUNCTION
    public.axora_finalize_request_budget(uuid,uuid,uuid,numeric,text,text,timestamptz)
  FROM axora_app;
  GRANT EXECUTE ON FUNCTION
    public.axora_company_wallet_workspace(uuid,uuid,uuid,timestamptz),
    public.axora_request_approval_workspace_v2(uuid,uuid,timestamptz),
    public.axora_request_company_wallet_top_up(uuid,uuid,uuid,numeric,text,text,uuid,timestamptz),
    public.axora_record_company_wallet_top_up(uuid,uuid,uuid,uuid,numeric,date,text,text,uuid,timestamptz),
    public.axora_approve_and_pay(uuid,uuid,uuid,integer,text,uuid,timestamptz),
    public.axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz),
    public.axora_final_invoice_summary(uuid,uuid,uuid,timestamptz),
    public.axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz),
    public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz)
  TO axora_app;
END IF; END $$;

COMMIT;
