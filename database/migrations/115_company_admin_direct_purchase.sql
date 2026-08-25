BEGIN;

-- Company Administrator direct purchase is a distinct financial capability.
-- It does not grant, imply, or call request.approve.self.
INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES (
  'procurement.direct_purchase','Procurement',
  'Place direct company orders',
  'Place a paid company order from an exact reviewed Cart version when the branch budget and Company Wallet are sufficient.',
  true
) ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,label=EXCLUDED.label,
  description=EXCLUDED.description,high_risk=EXCLUDED.high_risk,
  active=true,updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission
  ON permission.permission_code='procurement.direct_purchase'
WHERE role.role_key='COMPANY_ADMIN'
ON CONFLICT(role_id,permission_id) DO NOTHING;

-- Direct orders have their own customer-facing notification copy. Existing
-- subordinate approval/payment events retain their established terminology.
INSERT INTO public.notification_event_policies(
  event_key,category,email_mandatory,default_reminder_hours,company_configurable
) VALUES ('direct_purchase.completed','FINANCE',false,NULL,true)
ON CONFLICT(event_key) DO UPDATE SET
  category=EXCLUDED.category,email_mandatory=EXCLUDED.email_mandatory,
  default_reminder_hours=EXCLUDED.default_reminder_hours,
  company_configurable=EXCLUDED.company_configurable;

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
      WHEN 'direct_purchase.completed' THEN jsonb_build_object(
        'title','تم تقديم الطلب','body','تم دفع قيمة الطلب '||p_reference||' من محفظة الشركة.')
      ELSE jsonb_build_object(
        'title','تم الاعتماد والدفع','body','تم اعتماد الطلب ودفعه مرة واحدة: '||p_reference||'.') END;
  ELSIF p_locale='ms' THEN
    RETURN CASE p_event_key
      WHEN 'wallet.top_up.requested' THEN jsonb_build_object(
        'title','Tambah nilai dimohon','body','Permohonan tambah nilai '||p_reference||' memerlukan semakan Axora.')
      WHEN 'wallet.top_up.recorded' THEN jsonb_build_object(
        'title','Tambah nilai direkodkan','body','Dana diterima direkodkan dalam Dompet Syarikat: '||p_reference||'.')
      WHEN 'direct_purchase.completed' THEN jsonb_build_object(
        'title','Pesanan dibuat','body','Pesanan '||p_reference||' telah dibayar daripada Dompet Syarikat.')
      ELSE jsonb_build_object(
        'title','Diluluskan dan dibayar','body','Permintaan diluluskan dan dibayar sekali: '||p_reference||'.') END;
  END IF;
  RETURN CASE p_event_key
    WHEN 'wallet.top_up.requested' THEN jsonb_build_object(
      'title','Top-up requested','body','Top-up request '||p_reference||' is ready for Axora review.')
    WHEN 'wallet.top_up.recorded' THEN jsonb_build_object(
      'title','Top-up recorded','body','Received funds were recorded in the Company Wallet: '||p_reference||'.')
    WHEN 'direct_purchase.completed' THEN jsonb_build_object(
      'title','Order placed','body','Order '||p_reference||' was paid from the Company Wallet.')
    ELSE jsonb_build_object(
      'title','Approved and paid','body','The request was approved and paid exactly once: '||p_reference||'.') END;
END $$;

-- Account kind is a database security boundary. Platform operators are not
-- customer-company purchasers even if a broad platform role exists.
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
      AND p_permission_code<>'procurement.direct_purchase'
      AND p_permission_code NOT IN (
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update'
      )
    ELSE false
  END
$$;

-- Direct purchase is role-derived only. Explicit DENY remains available and
-- final, but a generic per-user GRANT cannot promote a lower company role into
-- this financial authority.
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
  IF permission_code_value='procurement.direct_purchase' THEN
    RAISE EXCEPTION 'Direct purchase authority is assigned by role only'
      USING ERRCODE='42501';
  END IF;
  IF account_kind_value IS NULL OR NOT public.axora_permission_allowed_for_account_kind(
    account_kind_value,permission_code_value
  ) THEN
    RAISE EXCEPTION 'The permission is incompatible with the target account kind'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

-- Existing request/order, invoice, payment, and fulfilment readers continue to
-- use the canonical request relationship. The mode only changes customer-facing
-- terminology and proves that no subordinate approval workflow was entered.
ALTER TABLE public.requests
  ADD COLUMN purchase_mode text NOT NULL DEFAULT 'REQUEST'
    CHECK (purchase_mode IN ('REQUEST','COMPANY_ADMIN_DIRECT'));
CREATE INDEX requests_purchase_mode_company_idx
  ON public.requests(company_id,purchase_mode,created_at DESC,id DESC);

ALTER TABLE public.request_approval_decisions
  DROP CONSTRAINT request_approval_decisions_action_check;
ALTER TABLE public.request_approval_decisions
  ADD CONSTRAINT request_approval_decisions_action_check CHECK (action IN (
    'BACKFILL','SUBMIT','APPROVE','REJECT','RETURN','CANCEL','ESCALATE',
    'FINALIZE','ADDITIONAL_ACTUAL_REQUIRED','DIRECT_PURCHASE'
  ));

-- Private durable replay evidence. The application role never reads or writes
-- this table directly; the purpose-specific capabilities below are the only
-- access path and reauthorize the current actor on every call and replay.
CREATE TABLE public.company_admin_direct_purchase_commands (
  command_id uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  cart_id uuid NOT NULL REFERENCES public.procurement_carts(id) ON DELETE RESTRICT,
  reviewed_cart_version integer NOT NULL CHECK (reviewed_cart_version>0),
  result_status text NOT NULL CHECK (result_status IN (
    'SUCCESS','PRICE_CHANGED','STALE_CART','CART_ALREADY_PURCHASED',
    'INSUFFICIENT_BUDGET','INSUFFICIENT_WALLET',
    'BRANCH_LOCATION_REQUIRED','PRODUCT_UNAVAILABLE','BUDGET_UNAVAILABLE'
  )),
  request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  delivery_job_id uuid REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (
    jsonb_typeof(result)='object' AND public.workflow_metadata_is_safe(result)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  CHECK (
    result_status<>'SUCCESS' OR (
      request_id IS NOT NULL AND invoice_id IS NOT NULL
      AND payment_id IS NOT NULL AND delivery_job_id IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX company_admin_direct_purchase_one_success_per_cart_uq
  ON public.company_admin_direct_purchase_commands(cart_id)
  WHERE result_status='SUCCESS';
CREATE INDEX company_admin_direct_purchase_company_idx
  ON public.company_admin_direct_purchase_commands(
    company_id,created_at DESC,command_id
  );
CREATE INDEX company_admin_direct_purchase_request_idx
  ON public.company_admin_direct_purchase_commands(request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.company_admin_direct_purchase_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_admin_direct_purchase_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_admin_direct_purchase_commands FROM PUBLIC;
CREATE TRIGGER company_admin_direct_purchase_commands_append_only
BEFORE UPDATE OR DELETE ON public.company_admin_direct_purchase_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES (
  'company_admin_direct_purchase_commands','CASCADE_DELETE',
  'RETAIN_WITH_ACCESS_REVOKED',
  'Immutable direct-purchase command and replay evidence is tenant financial evidence.'
) ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT COALESCE(maximum.delete_order,0)+1,
  'company_admin_direct_purchase_commands',
  'Direct-purchase command evidence blocks hard deletion, so this late dependency order is reached only when the table is empty.'
FROM (SELECT max(delete_order) AS delete_order
  FROM public.company_deletion_ownership_dag) maximum
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
  location_command_count bigint; direct_purchase_command_count bigint;
  wallet_protected_count bigint; protected_count bigint;
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
      WHERE command.company_id=p_company_id),
    (SELECT count(*) FROM public.company_admin_direct_purchase_commands command
      WHERE command.company_id=p_company_id)
  INTO wallet_count,top_up_request_count,ledger_count,
    top_up_event_count,approve_pay_count,location_command_count,
    direct_purchase_command_count;
  wallet_protected_count:=top_up_request_count+ledger_count
    +top_up_event_count+approve_pay_count;
  protected_count:=(base->>'protectedEvidence')::bigint
    +wallet_protected_count+location_command_count+direct_purchase_command_count;
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
    'companyAdminDirectPurchaseCommands',direct_purchase_command_count,
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

CREATE OR REPLACE FUNCTION public.axora_company_admin_direct_purchase_authorized(
  p_snapshot jsonb,p_company_id uuid,p_branch_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT p_snapshot IS NOT NULL
    AND p_snapshot->>'accountKind'='COMPANY'
    AND p_snapshot->>'roleKey'='COMPANY_ADMIN'
    AND p_snapshot->>'scopeType'='COMPANY'
    AND p_snapshot->>'companyId'=p_company_id::text
    AND COALESCE((p_snapshot->>'isOwner')::boolean,false)=false
    AND public.axora_snapshot_has_permission(
      p_snapshot,'procurement.direct_purchase','BRANCH',
      p_company_id,p_branch_id,NULL,NULL
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_admin_direct_purchase_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_expected_cart_version integer,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; cart_row public.procurement_carts%ROWTYPE;
  company_row public.companies%ROWTYPE; branch_row public.branches%ROWTYPE;
  account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE;
  subtotal_value numeric(18,2); tax_value numeric(18,2);
  total_value numeric(18,2); budget_available numeric(18,2);
  wallet_available numeric(18,2); price_change_count integer;
  location_ready boolean;
BEGIN
  IF p_cart_id IS NULL OR p_expected_cart_version<1 OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO cart_row FROM public.procurement_carts cart
  WHERE cart.id=p_cart_id AND cart.user_id=p_actor_user_id
    AND cart.status='ACTIVE' AND cart.cart_version=p_expected_cart_version;
  IF cart_row.id IS NULL OR cart_row.department_id IS NOT NULL
    OR NOT public.axora_company_admin_direct_purchase_authorized(
      snapshot,cart_row.company_id,cart_row.branch_id
    )
  THEN RETURN NULL; END IF;
  SELECT * INTO company_row FROM public.companies company
  WHERE company.id=cart_row.company_id AND company.active;
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=cart_row.branch_id AND branch.company_id=cart_row.company_id
    AND branch.active;
  IF company_row.id IS NULL OR branch_row.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(round(item.quantity*offer.selling_price,2)),0)::numeric(18,2),
    count(*) FILTER (WHERE offer.pricing_rule_id IS NULL
      OR item.displayed_unit_price<>offer.selling_price
      OR item.displayed_price_rule_version<>offer.pricing_rule_version
      OR item.currency<>offer.price_currency)::int
  INTO subtotal_value,price_change_count
  FROM public.procurement_cart_items item
  JOIN public.products product ON product.id=item.product_id
  LEFT JOIN LATERAL public.axora_current_product_offer_internal(
    product.id,p_at
  ) offer ON true
  WHERE item.cart_id=cart_row.id;
  tax_value:=round(subtotal_value*(company_row.tax_rate/100),2);
  total_value:=round(
    subtotal_value+company_row.estimated_delivery_fee+tax_value,2
  );

  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.company_id=cart_row.company_id AND account.branch_id=cart_row.branch_id
    AND account.level_type='BRANCH' AND account.active
  ORDER BY account.created_at,account.id LIMIT 1;
  IF account_row.id IS NOT NULL THEN
    SELECT * INTO period_row FROM public.budget_periods period
    WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE'
      AND period.starts_at<=p_at AND period.ends_at>p_at
    ORDER BY period.starts_at DESC,period.id DESC LIMIT 1;
  END IF;
  SELECT COALESCE(balance.available,0)::numeric(18,2)
  INTO budget_available FROM public.v_budget_period_balances balance
  WHERE balance.budget_period_id=period_row.id;
  SELECT COALESCE(balance.available_balance,0)::numeric(18,2)
  INTO wallet_available FROM public.v_company_wallet_balances balance
  WHERE balance.company_id=cart_row.company_id;
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_locations location
    WHERE location.branch_id=cart_row.branch_id AND location.active
      AND location.is_primary AND location.latitude BETWEEN -90 AND 90
      AND location.longitude BETWEEN -180 AND 180
  ) INTO location_ready;

  RETURN jsonb_build_object(
    'capturedAt',p_at,'companyId',cart_row.company_id,
    'branchId',cart_row.branch_id,'branchCode',branch_row.branch_code,
    'branchName',branch_row.name,'cartId',cart_row.id,
    'cartVersion',cart_row.cart_version,
    'cart',public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at),
    'subtotal',subtotal_value::text,
    'deliveryFee',company_row.estimated_delivery_fee::numeric(18,2)::text,
    'taxAmount',tax_value::text,'orderTotal',total_value::text,
    'currency',COALESCE(account_row.currency,'MYR'),
    'budgetAvailable',COALESCE(budget_available,0)::text,
    'walletAvailable',COALESCE(wallet_available,0)::text,
    'budgetReady',(period_row.id IS NOT NULL),
    'locationReady',location_ready,
    'priceChanged',(price_change_count>0)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_store_company_admin_direct_purchase_result(
  p_command_id uuid,p_payload_hash text,p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,p_company_id uuid,p_branch_id uuid,
  p_cart_id uuid,p_reviewed_cart_version integer,p_result_status text,
  p_result jsonb,p_request_id uuid,p_invoice_id uuid,p_payment_id uuid,
  p_delivery_job_id uuid,p_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.company_admin_direct_purchase_commands(
    command_id,payload_hash,actor_user_id,actor_role_assignment_id,
    company_id,branch_id,cart_id,reviewed_cart_version,result_status,
    request_id,invoice_id,payment_id,delivery_job_id,result,created_at
  ) VALUES (
    p_command_id,p_payload_hash,p_actor_user_id,p_actor_role_assignment_id,
    p_company_id,p_branch_id,p_cart_id,p_reviewed_cart_version,p_result_status,
    p_request_id,p_invoice_id,p_payment_id,p_delivery_job_id,p_result,p_at
  );
  RETURN p_result;
END $$;

-- The internal signature exists so native PostgreSQL tests can raise at major
-- business boundaries. The public application wrapper always passes NULL.
CREATE OR REPLACE FUNCTION public.axora_company_admin_direct_purchase_internal(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_expected_cart_version integer,p_command_id uuid,p_at timestamptz,
  p_failure_point text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; cart_row public.procurement_carts%ROWTYPE;
  company_row public.companies%ROWTYPE; branch_row public.branches%ROWTYPE;
  location_row public.delivery_locations%ROWTYPE;
  account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE;
  policy_row public.request_approval_policies%ROWTYPE;
  wallet_row public.company_wallets%ROWTYPE;
  existing_command public.company_admin_direct_purchase_commands%ROWTYPE;
  purchased_command public.company_admin_direct_purchase_commands%ROWTYPE;
  request_id_value uuid:=gen_random_uuid(); decision_id_value uuid:=gen_random_uuid();
  reservation_id_value uuid:=gen_random_uuid(); correlation_value uuid:=gen_random_uuid();
  payment_id_value uuid; invoice_id_value uuid; delivery_job_id_value uuid;
  order_code_value text; invoice_number_value text;
  subtotal_value numeric(18,2); tax_value numeric(18,2); total_value numeric(18,2);
  budget_available numeric(18,2); wallet_available numeric(18,2);
  line_count integer; invalid_count integer; repriced_count integer;
  inserted_line_count integer; delivery_sla_days integer;
  payload_hash_value text; approval_payload jsonb; decision_result jsonb;
  invoice_result jsonb; finalization_result jsonb; result_value jsonb;
  price_failure boolean:=false; product_failure boolean:=false;
  location_failure boolean:=false;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_cart_id IS NULL OR p_expected_cart_version<1 OR p_command_id IS NULL
    OR p_at IS NULL OR (p_failure_point IS NOT NULL AND p_failure_point NOT IN (
      'AFTER_DIRECT_ORDER','AFTER_BUDGET_RESERVATION','BEFORE_INVOICE',
      'AFTER_DELIVERY_JOB','AFTER_BUDGET_FINALIZATION','AFTER_WALLET_DEBIT',
      'BEFORE_CART_CONSUMPTION','AFTER_CART_CONSUMPTION'
    ))
  THEN RAISE EXCEPTION 'The direct purchase command is invalid'; END IF;

  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'operation','COMPANY_ADMIN_DIRECT_PURCHASE',
    'actorUserId',p_actor_user_id::text,
    'actorRoleAssignmentId',p_actor_role_assignment_id::text,
    'cartId',p_cart_id::text,
    'expectedCartVersion',p_expected_cart_version
  )::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'company-admin-direct-purchase:'||p_command_id::text,0
  ));
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR snapshot->>'accountKind'<>'COMPANY'
    OR snapshot->>'roleKey'<>'COMPANY_ADMIN'
    OR snapshot->>'scopeType'<>'COMPANY'
    OR COALESCE((snapshot->>'isOwner')::boolean,false)
  THEN RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO existing_command
  FROM public.company_admin_direct_purchase_commands command
  WHERE command.command_id=p_command_id FOR KEY SHARE;
  IF existing_command.command_id IS NOT NULL THEN
    IF existing_command.actor_user_id<>p_actor_user_id
      OR existing_command.actor_role_assignment_id<>p_actor_role_assignment_id
      OR existing_command.cart_id<>p_cart_id
      OR existing_command.reviewed_cart_version<>p_expected_cart_version
      OR existing_command.payload_hash<>payload_hash_value
      OR NOT public.axora_company_admin_direct_purchase_authorized(
        snapshot,existing_command.company_id,existing_command.branch_id
      )
    THEN RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501'; END IF;
    IF existing_command.result_status='SUCCESS' THEN
      RETURN existing_command.result||jsonb_build_object(
        'status','ALREADY_PROCESSED','created',false
      );
    END IF;
    RETURN existing_command.result;
  END IF;

  SELECT * INTO cart_row FROM public.procurement_carts cart
  WHERE cart.id=p_cart_id FOR UPDATE;
  IF cart_row.id IS NULL OR cart_row.user_id<>p_actor_user_id
    OR cart_row.department_id IS NOT NULL
    OR snapshot->>'companyId'<>cart_row.company_id::text
    OR NOT public.axora_company_admin_direct_purchase_authorized(
      snapshot,cart_row.company_id,cart_row.branch_id
    )
  THEN RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501'; END IF;

  IF cart_row.status='SUBMITTED' THEN
    SELECT * INTO purchased_command
    FROM public.company_admin_direct_purchase_commands command
    WHERE command.cart_id=cart_row.id AND command.result_status='SUCCESS';
    result_value:=CASE WHEN purchased_command.command_id IS NULL THEN
      jsonb_build_object(
        'status','STALE_CART','commandId',p_command_id,'cartId',cart_row.id,
        'expectedCartVersion',p_expected_cart_version,
        'currentCartVersion',cart_row.cart_version,'created',false
      ) ELSE purchased_command.result||jsonb_build_object(
        'status','CART_ALREADY_PURCHASED','commandId',p_command_id,'created',false
      ) END;
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      result_value->>'status',result_value,
      purchased_command.request_id,purchased_command.invoice_id,
      purchased_command.payment_id,purchased_command.delivery_job_id,p_at
    );
  END IF;
  IF cart_row.status<>'ACTIVE' OR cart_row.cart_version<>p_expected_cart_version THEN
    result_value:=jsonb_build_object(
      'status','STALE_CART','commandId',p_command_id,'cartId',cart_row.id,
      'expectedCartVersion',p_expected_cart_version,
      'currentCartVersion',cart_row.cart_version,
      'cart',public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at),
      'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'STALE_CART',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;

  -- Location updates lock branch then location. Holding the same order through
  -- payment guarantees the delivery trigger snapshots this exact destination.
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=cart_row.branch_id AND branch.company_id=cart_row.company_id
    AND branch.active FOR SHARE;
  IF branch_row.id IS NULL THEN
    RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO location_row FROM public.delivery_locations location
  WHERE location.branch_id=branch_row.id AND location.active AND location.is_primary
    AND location.latitude BETWEEN -90 AND 90
    AND location.longitude BETWEEN -180 AND 180
  ORDER BY location.created_at,location.id LIMIT 1 FOR SHARE;
  IF location_row.id IS NULL THEN
    result_value:=jsonb_build_object(
      'status','BRANCH_LOCATION_REQUIRED','commandId',p_command_id,
      'cartId',cart_row.id,'branchId',branch_row.id,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'BRANCH_LOCATION_REQUIRED',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||cart_row.company_id::text,0
  ));
  SELECT count(*)::int,
    count(*) FILTER (WHERE NOT product.active OR product.needs_review
      OR item.quantity<1 OR item.quantity>1000000
      OR (product.company_id IS NOT NULL AND product.company_id<>cart_row.company_id)
      OR offer.pricing_rule_id IS NULL OR offer.price_currency<>'MYR'
      OR NOT public.axora_quantity_is_valid(
        item.quantity,offer.minimum_quantity,offer.maximum_quantity,
        offer.order_increment
      )
      OR NOT public.axora_category_allowed_for_scope(
        cart_row.company_id,cart_row.branch_id,NULL,product.category
      ))::int,
    count(*) FILTER (WHERE item.displayed_unit_price<>offer.selling_price
      OR item.displayed_price_rule_version<>offer.pricing_rule_version
      OR item.currency<>offer.price_currency)::int,
    COALESCE(sum(round(item.quantity*offer.selling_price,2)),0)::numeric(18,2),
    COALESCE(max(product.delivery_sla_days),0)::int
  INTO line_count,invalid_count,repriced_count,subtotal_value,delivery_sla_days
  FROM public.procurement_cart_items item
  JOIN public.products product ON product.id=item.product_id
  LEFT JOIN LATERAL public.axora_current_product_offer_internal(
    product.id,p_at
  ) offer ON true
  WHERE item.cart_id=cart_row.id;
  IF line_count=0 THEN
    result_value:=jsonb_build_object(
      'status','STALE_CART','commandId',p_command_id,'cartId',cart_row.id,
      'expectedCartVersion',p_expected_cart_version,
      'currentCartVersion',cart_row.cart_version,
      'cart',public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at),
      'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'STALE_CART',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;
  IF invalid_count>0 THEN
    result_value:=jsonb_build_object(
      'status','PRODUCT_UNAVAILABLE','commandId',p_command_id,
      'cartId',cart_row.id,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'PRODUCT_UNAVAILABLE',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;
  IF repriced_count>0 THEN
    UPDATE public.procurement_cart_items item SET
      displayed_unit_price=offer.selling_price,
      displayed_price_rule_version=offer.pricing_rule_version,
      currency=offer.price_currency,updated_at=p_at
    FROM public.products product
    CROSS JOIN LATERAL public.axora_current_product_offer_internal(
      product.id,p_at
    ) offer
    WHERE item.cart_id=cart_row.id AND product.id=item.product_id;
    UPDATE public.procurement_carts SET cart_version=cart_version+1,updated_at=p_at
    WHERE id=cart_row.id RETURNING * INTO cart_row;
    INSERT INTO public.procurement_cart_events(
      cart_id,company_id,event_type,actor_user_id,actor_role_assignment_id,
      command_id,payload_hash,metadata,occurred_at
    ) VALUES (
      cart_row.id,cart_row.company_id,'PRICES_ACKNOWLEDGED',p_actor_user_id,
      p_actor_role_assignment_id,p_command_id,payload_hash_value,
      jsonb_build_object('changedCount',repriced_count,'source','DIRECT_PURCHASE'),p_at
    );
    result_value:=jsonb_build_object(
      'status','PRICE_CHANGED','commandId',p_command_id,'cartId',cart_row.id,
      'expectedCartVersion',p_expected_cart_version,
      'currentCartVersion',cart_row.cart_version,
      'cart',public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at),
      'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'PRICE_CHANGED',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;

  -- Match the canonical financial lock order: budget period, company, Wallet.
  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.company_id=cart_row.company_id AND account.branch_id=cart_row.branch_id
    AND account.level_type='BRANCH' AND account.active
  ORDER BY account.created_at,account.id LIMIT 1 FOR KEY SHARE;
  IF account_row.id IS NOT NULL THEN
    SELECT * INTO period_row FROM public.budget_periods period
    WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE'
      AND period.starts_at<=p_at AND period.ends_at>p_at
    ORDER BY period.starts_at DESC,period.id DESC LIMIT 1 FOR UPDATE;
  END IF;
  IF account_row.id IS NULL OR period_row.id IS NULL OR account_row.currency<>'MYR' THEN
    result_value:=jsonb_build_object(
      'status','BUDGET_UNAVAILABLE','commandId',p_command_id,
      'cartId',cart_row.id,'currency','MYR','created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'BUDGET_UNAVAILABLE',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;
  SELECT * INTO policy_row FROM public.request_approval_policies policy
  WHERE policy.company_id=cart_row.company_id AND policy.status='ACTIVE'
    AND policy.effective_at<=p_at
  ORDER BY policy.policy_version DESC LIMIT 1 FOR KEY SHARE;
  SELECT * INTO company_row FROM public.companies company
  WHERE company.id=cart_row.company_id AND company.active FOR UPDATE;
  IF policy_row.id IS NULL OR company_row.id IS NULL THEN
    RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501';
  END IF;
  -- Hold live identity and membership through commit, but only after the
  -- canonical company lock. This matches company archival lock order and
  -- lets a concurrent revocation win cleanly without a company/user deadlock.
  PERFORM 1
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.id=p_actor_role_assignment_id
   AND assignment.user_id=account.id
   AND assignment.active AND assignment.revoked_at IS NULL
  JOIN public.company_memberships membership
    ON membership.user_id=account.id
   AND membership.company_id=assignment.company_id
   AND membership.status='ACTIVE'
  WHERE account.id=p_actor_user_id AND account.active
    AND account.account_status='ACTIVE'
  FOR SHARE OF account,assignment,membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF NOT public.axora_company_admin_direct_purchase_authorized(
    snapshot,cart_row.company_id,cart_row.branch_id
  ) THEN
    RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501';
  END IF;
  tax_value:=round(subtotal_value*(company_row.tax_rate/100),2);
  total_value:=round(
    subtotal_value+company_row.estimated_delivery_fee+tax_value,2
  );
  IF total_value<=0 OR total_value<>round(total_value,2) THEN
    RAISE EXCEPTION 'The direct purchase total is invalid';
  END IF;
  SELECT COALESCE(balance.available,0)::numeric(18,2)
  INTO budget_available FROM public.v_budget_period_balances balance
  WHERE balance.budget_period_id=period_row.id;
  IF COALESCE(budget_available,0)<total_value THEN
    result_value:=jsonb_build_object(
      'status','INSUFFICIENT_BUDGET','commandId',p_command_id,
      'cartId',cart_row.id,'requiredAmount',total_value::text,
      'availableAmount',COALESCE(budget_available,0)::text,
      'currency',account_row.currency,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'INSUFFICIENT_BUDGET',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;
  SELECT * INTO wallet_row FROM public.company_wallets wallet
  WHERE wallet.company_id=cart_row.company_id FOR UPDATE;
  SELECT COALESCE(balance.available_balance,0)::numeric(18,2)
  INTO wallet_available FROM public.v_company_wallet_balances balance
  WHERE balance.company_id=cart_row.company_id;
  IF wallet_row.company_id IS NULL OR wallet_row.currency<>account_row.currency
    OR COALESCE(wallet_available,0)<total_value THEN
    result_value:=jsonb_build_object(
      'status','INSUFFICIENT_WALLET','commandId',p_command_id,
      'cartId',cart_row.id,'requiredAmount',total_value::text,
      'availableAmount',COALESCE(wallet_available,0)::text,
      'currency',account_row.currency,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'INSUFFICIENT_WALLET',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;

  -- Request/order creation and every financial mutation live inside this
  -- exception-backed subtransaction. Typed price/location outcomes retain the
  -- Cart but roll back all order and finance rows before they are recorded.
  BEGIN
    order_code_value:=public.next_order_code();
    INSERT INTO public.requests(
      id,order_code,request_date,request_type_id,company_id,branch_id,
      department_id,department,requested_by,requester_contact,
      needed_by_date,urgency_id,status_id,notes,created_by,
      estimated_delivery_fee,tax_rate,tax_amount,client_submission_key,
      budget_account_id,budget_period_id,currency,approval_policy_id,
      delivery_location_id,purchase_mode,approval_state,approval_submitted_at,
      approval_decided_at,approval_last_correlation_id,created_at,updated_at
    ) VALUES (
      request_id_value,order_code_value,
      (p_at AT TIME ZONE company_row.timezone)::date,
      public.lookup_id('request_type','Standard'),cart_row.company_id,cart_row.branch_id,
      NULL,'',COALESCE(NULLIF(snapshot->>'displayName',''),
        (SELECT account.display_name FROM public.users account WHERE account.id=p_actor_user_id)),
      (SELECT account.email FROM public.users account WHERE account.id=p_actor_user_id),
      (p_at AT TIME ZONE company_row.timezone)::date+delivery_sla_days,
      public.lookup_id('urgency','Normal'),
      public.lookup_id('request_status','New Request'),
      NULL,p_actor_user_id,company_row.estimated_delivery_fee,company_row.tax_rate,
      tax_value,p_command_id,account_row.id,period_row.id,account_row.currency,
      policy_row.id,location_row.id,'COMPANY_ADMIN_DIRECT','DRAFT',p_at,p_at,
      correlation_value,p_at,p_at
    );
    IF p_failure_point='AFTER_DIRECT_ORDER' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after order';
    END IF;

    INSERT INTO public.request_lines(
      request_line_code,request_id,product_id,product_name_snapshot,
      category_snapshot,subcategory_snapshot,specification,quantity,
      unit_of_measure,supplier_confirmation_status_id,unit_buy_price,
      unit_sell_price,created_at,updated_at
    )
    SELECT public.next_request_line_code(),request_id_value,product.id,product.name,
      product.category,product.subcategory,NULLIF(item.specification,''),item.quantity,
      product.unit_of_measure,public.lookup_id('supplier_confirmation','Pending'),
      0,offer.selling_price,p_at,p_at
    FROM public.procurement_cart_items item
    JOIN public.products product ON product.id=item.product_id
    CROSS JOIN LATERAL public.axora_current_product_offer_internal(
      product.id,p_at
    ) offer
    WHERE item.cart_id=cart_row.id
      AND product.active AND NOT product.needs_review
      AND (product.company_id IS NULL OR product.company_id=cart_row.company_id)
      AND public.axora_quantity_is_valid(
        item.quantity,offer.minimum_quantity,offer.maximum_quantity,
        offer.order_increment
      )
    ORDER BY item.added_at,item.product_id;
    GET DIAGNOSTICS inserted_line_count=ROW_COUNT;
    IF inserted_line_count<>line_count THEN
      RAISE EXCEPTION 'A product changed during direct purchase' USING ERRCODE='P8204';
    END IF;
    IF NOT public.axora_cart_matches_request_snapshot(
      p_actor_user_id,p_actor_role_assignment_id,cart_row.id,request_id_value,p_at
    ) OR public.axora_request_total_internal(request_id_value)<>total_value THEN
      RAISE EXCEPTION 'A Cart price changed during direct purchase' USING ERRCODE='P8202';
    END IF;

    approval_payload:=public.axora_request_snapshot_payload_internal(
      request_id_value,policy_row.policy_version,total_value,account_row.currency
    );
    INSERT INTO public.request_approval_snapshots(
      request_id,request_version,company_id,policy_id,policy_version,amount,
      currency,snapshot,snapshot_hash,created_by,created_at
    ) VALUES (
      request_id_value,1,cart_row.company_id,policy_row.id,
      policy_row.policy_version,total_value,account_row.currency,approval_payload,
      encode(pg_catalog.sha256(convert_to(approval_payload::text,'UTF8')),'hex'),
      p_actor_user_id,p_at
    );
    decision_result:=jsonb_build_object(
      'decisionId',decision_id_value,'reservationId',reservation_id_value,
      'requestId',request_id_value,'requestVersion',1,'approvalRevision',1,
      'state','APPROVED','action','DIRECT_PURCHASE','amount',total_value::text,
      'currency',account_row.currency,'correlationId',correlation_value
    );
    INSERT INTO public.request_approval_decisions(
      id,request_id,request_version,approval_revision_before,
      approval_revision_after,company_id,policy_id,actor_user_id,
      actor_role_assignment_id,action,state_before,state_after,amount,currency,
      self_approval,option_code,reason,correlation_id,idempotency_key,result,decided_at
    ) VALUES (
      decision_id_value,request_id_value,1,1,1,cart_row.company_id,policy_row.id,
      p_actor_user_id,p_actor_role_assignment_id,'DIRECT_PURCHASE','DRAFT','APPROVED',
      total_value,account_row.currency,false,'DIRECT_COMPANY_ORDER',
      'COMPANY_ADMIN_DIRECT_PURCHASE',correlation_value,
      'direct-purchase:'||p_command_id::text||':authorize',decision_result,p_at
    );
    INSERT INTO public.budget_reservations(
      id,company_id,budget_account_id,budget_period_id,request_id,request_version,
      currency,reserved_amount,remaining_reserved,status,approval_decision_id,
      correlation_id,created_by,created_at,updated_at
    ) VALUES (
      reservation_id_value,cart_row.company_id,account_row.id,period_row.id,
      request_id_value,1,account_row.currency,total_value,total_value,'RESERVED',
      decision_id_value,correlation_value,p_actor_user_id,p_at,p_at
    );
    INSERT INTO public.budget_reservation_events(
      reservation_id,company_id,event_type,amount,new_status,actor_user_id,
      reason,correlation_id,idempotency_key,occurred_at
    ) VALUES (
      reservation_id_value,cart_row.company_id,'CREATED',total_value,'RESERVED',
      p_actor_user_id,'COMPANY_ADMIN_DIRECT_PURCHASE',correlation_value,
      'direct-purchase:'||p_command_id::text||':reservation-event',p_at
    );
    PERFORM public.axora_post_budget_entry_internal(
      cart_row.company_id,account_row.id,period_row.id,'RESERVATION',total_value,
      0,-total_value,total_value,0,0,0,0,request_id_value,1,
      reservation_id_value,NULL,'REQUEST',request_id_value,p_actor_user_id,
      p_actor_role_assignment_id,NULL,'COMPANY_ADMIN_DIRECT_PURCHASE',
      'COMPANY_ADMIN_DIRECT_PURCHASE',correlation_value,
      'direct-purchase:'||p_command_id::text||':reservation',p_at
    );
    UPDATE public.requests SET approval_state='APPROVED'
    WHERE id=request_id_value;
    IF p_failure_point='AFTER_BUDGET_RESERVATION' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after budget reservation';
    END IF;
    IF p_failure_point='BEFORE_INVOICE' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure before invoice';
    END IF;

    invoice_result:=public.axora_complete_payment_internal(
      p_actor_user_id,p_actor_role_assignment_id,request_id_value,'OFFLINE',
      'direct-purchase:'||p_command_id::text||':payment',p_at
    );
    invoice_id_value:=(invoice_result->>'invoiceId')::uuid;
    invoice_number_value:=invoice_result->>'invoiceNumber';
    SELECT payment.id INTO payment_id_value FROM public.payments payment
    WHERE payment.invoice_id=invoice_id_value AND payment.payment_status='PAID'
    FOR KEY SHARE;
    SELECT job.id INTO delivery_job_id_value FROM public.delivery_jobs job
    WHERE job.request_id=request_id_value FOR KEY SHARE;
    IF payment_id_value IS NULL OR delivery_job_id_value IS NULL THEN
      RAISE EXCEPTION 'Direct purchase payment evidence is incomplete';
    END IF;
    IF p_failure_point='AFTER_DELIVERY_JOB' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after delivery job';
    END IF;

    finalization_result:=public.axora_finalize_request_budget_internal(
      p_actor_user_id,p_actor_role_assignment_id,request_id_value,total_value,
      'COMPANY_ADMIN_DIRECT_PURCHASE',
      'direct-purchase:'||p_command_id::text||':budget',p_at
    );
    IF finalization_result->>'state'<>'AWAITING_FULFILMENT' THEN
      RAISE EXCEPTION 'Direct purchase budget finalization failed';
    END IF;
    IF p_failure_point='AFTER_BUDGET_FINALIZATION' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after budget finalization';
    END IF;

    INSERT INTO public.company_wallet_ledger_entries(
      company_id,entry_type,amount_delta,currency,request_id,invoice_id,payment_id,
      effective_date,business_reference,reason,correlation_id,idempotency_key,
      actor_user_id,actor_role_assignment_id,posted_at
    ) VALUES (
      cart_row.company_id,'PAYMENT',-total_value,account_row.currency,
      request_id_value,invoice_id_value,payment_id_value,
      (p_at AT TIME ZONE company_row.timezone)::date,
      COALESCE(invoice_number_value,order_code_value),
      'COMPANY_ADMIN_DIRECT_PURCHASE',correlation_value,
      'direct-purchase:'||p_command_id::text||':wallet',p_actor_user_id,
      p_actor_role_assignment_id,p_at
    );
    IF p_failure_point='AFTER_WALLET_DEBIT' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after Wallet debit';
    END IF;
    IF p_failure_point='BEFORE_CART_CONSUMPTION' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure before Cart consumption';
    END IF;
    PERFORM public.axora_consume_procurement_cart(
      p_actor_user_id,p_actor_role_assignment_id,cart_row.id,
      p_expected_cart_version,request_id_value,p_command_id,p_at
    );
    IF p_failure_point='AFTER_CART_CONSUMPTION' THEN
      RAISE EXCEPTION 'Injected direct-purchase failure after Cart consumption';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P8202' THEN price_failure:=true;
    WHEN SQLSTATE 'P8204' THEN product_failure:=true;
    WHEN SQLSTATE 'P7301' THEN location_failure:=true;
  END;

  IF price_failure THEN
    UPDATE public.procurement_cart_items item SET
      displayed_unit_price=offer.selling_price,
      displayed_price_rule_version=offer.pricing_rule_version,
      currency=offer.price_currency,updated_at=p_at
    FROM public.products product
    CROSS JOIN LATERAL public.axora_current_product_offer_internal(
      product.id,p_at
    ) offer
    WHERE item.cart_id=cart_row.id AND product.id=item.product_id;
    UPDATE public.procurement_carts SET cart_version=cart_version+1,updated_at=p_at
    WHERE id=cart_row.id RETURNING * INTO cart_row;
    INSERT INTO public.procurement_cart_events(
      cart_id,company_id,event_type,actor_user_id,actor_role_assignment_id,
      command_id,payload_hash,metadata,occurred_at
    ) VALUES (
      cart_row.id,cart_row.company_id,'PRICES_ACKNOWLEDGED',p_actor_user_id,
      p_actor_role_assignment_id,p_command_id,payload_hash_value,
      jsonb_build_object('source','DIRECT_PURCHASE_RACE'),p_at
    );
    result_value:=jsonb_build_object(
      'status','PRICE_CHANGED','commandId',p_command_id,'cartId',cart_row.id,
      'expectedCartVersion',p_expected_cart_version,
      'currentCartVersion',cart_row.cart_version,
      'cart',public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at),
      'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'PRICE_CHANGED',result_value,NULL,NULL,NULL,NULL,p_at
    );
  ELSIF product_failure THEN
    result_value:=jsonb_build_object(
      'status','PRODUCT_UNAVAILABLE','commandId',p_command_id,
      'cartId',cart_row.id,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'PRODUCT_UNAVAILABLE',result_value,NULL,NULL,NULL,NULL,p_at
    );
  ELSIF location_failure THEN
    result_value:=jsonb_build_object(
      'status','BRANCH_LOCATION_REQUIRED','commandId',p_command_id,
      'cartId',cart_row.id,'branchId',cart_row.branch_id,'created',false
    );
    RETURN public.axora_store_company_admin_direct_purchase_result(
      p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
      cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
      'BRANCH_LOCATION_REQUIRED',result_value,NULL,NULL,NULL,NULL,p_at
    );
  END IF;

  result_value:=jsonb_build_object(
    'status','SUCCESS','commandId',p_command_id,'cartId',cart_row.id,
    'consumedCartVersion',p_expected_cart_version+1,
    'requestId',request_id_value,'orderReference',order_code_value,
    'invoiceId',invoice_id_value,'invoiceNumber',invoice_number_value,
    'paymentId',payment_id_value,'deliveryJobId',delivery_job_id_value,
    'deliveryStatus','AWAITING_ASSIGNMENT','branchId',branch_row.id,
    'branchCode',branch_row.branch_code,'branchName',branch_row.name,
    'amount',total_value::text,'currency',account_row.currency,
    'created',true,'correlationId',correlation_value
  );
  PERFORM public.axora_store_company_admin_direct_purchase_result(
    p_command_id,payload_hash_value,p_actor_user_id,p_actor_role_assignment_id,
    cart_row.company_id,cart_row.branch_id,cart_row.id,p_expected_cart_version,
    'SUCCESS',result_value,request_id_value,invoice_id_value,payment_id_value,
    delivery_job_id_value,p_at
  );
  PERFORM public.axora_emit_company_finance_event(
    cart_row.company_id,cart_row.branch_id,request_id_value,
    'request-payment',request_id_value,'direct_purchase.completed',
    'finance.invoice.view',p_actor_user_id,correlation_value,
    'direct-purchase-payment:'||p_command_id::text,order_code_value,
    '/requests/'||request_id_value::text,
    jsonb_build_object(
      'invoiceId',invoice_id_value,'amount',total_value::text,
      'currency',account_row.currency,'purchaseMode','COMPANY_ADMIN_DIRECT',
      'actorConfirmation',true
    ),p_at
  );
  RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_admin_direct_purchase(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_expected_cart_version integer,p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_admin_direct_purchase_internal(
    p_actor_user_id,p_actor_role_assignment_id,p_cart_id,
    p_expected_cart_version,p_command_id,p_at,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_admin_direct_purchase_result(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
  command_row public.company_admin_direct_purchase_commands%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO command_row
  FROM public.company_admin_direct_purchase_commands command
  WHERE command.command_id=p_command_id;
  IF command_row.command_id IS NULL
    OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RETURN jsonb_build_object('status','NOT_FOUND','commandId',p_command_id);
  END IF;
  IF NOT public.axora_company_admin_direct_purchase_authorized(
      snapshot,command_row.company_id,command_row.branch_id
    )
  THEN RAISE EXCEPTION 'The direct purchase is unavailable' USING ERRCODE='42501'; END IF;
  IF command_row.result_status='SUCCESS' THEN
    RETURN command_row.result||jsonb_build_object(
      'status','ALREADY_PROCESSED','created',false
    );
  END IF;
  RETURN command_row.result;
END $$;

REVOKE ALL ON FUNCTION public.axora_permission_allowed_for_account_kind(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_enforce_permission_account_kind() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_admin_direct_purchase_authorized(jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_admin_direct_purchase_workspace(uuid,uuid,uuid,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_store_company_admin_direct_purchase_result(uuid,text,uuid,uuid,uuid,uuid,uuid,integer,text,jsonb,uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_admin_direct_purchase_internal(uuid,uuid,uuid,integer,uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_admin_direct_purchase(uuid,uuid,uuid,integer,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_admin_direct_purchase_result(uuid,uuid,uuid,timestamptz) FROM PUBLIC;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  REVOKE ALL ON TABLE public.company_admin_direct_purchase_commands FROM axora_app;
  REVOKE ALL ON FUNCTION
    public.axora_permission_allowed_for_account_kind(text,text),
    public.axora_enforce_permission_account_kind(),
    public.axora_company_admin_direct_purchase_authorized(jsonb,uuid,uuid),
    public.axora_store_company_admin_direct_purchase_result(uuid,text,uuid,uuid,uuid,uuid,uuid,integer,text,jsonb,uuid,uuid,uuid,uuid,timestamptz),
    public.axora_company_admin_direct_purchase_internal(uuid,uuid,uuid,integer,uuid,timestamptz,text)
  FROM axora_app;
  GRANT EXECUTE ON FUNCTION
    public.axora_company_admin_direct_purchase_workspace(uuid,uuid,uuid,integer,timestamptz),
    public.axora_company_admin_direct_purchase(uuid,uuid,uuid,integer,uuid,timestamptz),
    public.axora_company_admin_direct_purchase_result(uuid,uuid,uuid,timestamptz)
  TO axora_app;
END IF; END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.role_permissions role_permission
      JOIN public.roles role ON role.id=role_permission.role_id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE permission.permission_code='procurement.direct_purchase'
        AND role.role_key='COMPANY_ADMIN')<>1
    OR EXISTS (
      SELECT 1 FROM public.role_permissions role_permission
      JOIN public.roles role ON role.id=role_permission.role_id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE permission.permission_code='procurement.direct_purchase'
        AND role.role_key<>'COMPANY_ADMIN'
    )
  THEN RAISE EXCEPTION 'Direct purchase permission is not narrowly assigned'; END IF;
  IF public.axora_permission_allowed_for_account_kind(
      'PLATFORM','procurement.direct_purchase'
    ) OR NOT public.axora_permission_allowed_for_account_kind(
      'COMPANY','procurement.direct_purchase'
    )
  THEN RAISE EXCEPTION 'Direct purchase account-kind boundary is invalid'; END IF;
END $$;

COMMIT;
