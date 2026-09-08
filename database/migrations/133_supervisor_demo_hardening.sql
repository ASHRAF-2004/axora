BEGIN;

-- Per-product customer markup is a current commercial setting. Existing rows
-- retain the historical ten-percent default; request and invoice snapshots are
-- deliberately not rewritten.
ALTER TABLE public.products
  ADD COLUMN customer_markup_percentage numeric(9,4) NOT NULL DEFAULT 10,
  ADD CONSTRAINT products_customer_markup_percentage_check
    CHECK (customer_markup_percentage>=0 AND customer_markup_percentage<=100);

CREATE OR REPLACE FUNCTION public.axora_current_product_offer_internal(
  p_product_id uuid,p_at timestamptz
)
RETURNS TABLE(
  base_cost numeric,selling_price_raw numeric,selling_price numeric,
  price_currency text,pricing_rule_id uuid,pricing_rule_version integer,
  markup_percentage numeric,rounding_scale integer,tax_treatment text,
  delivery_treatment text,pricing_source text,price_effective_from timestamptz,
  quantity_rule_id uuid,quantity_supplier_id uuid,minimum_quantity numeric,
  maximum_quantity numeric,order_increment numeric,pack_size numeric,
  pack_unit text,quantity_rule_version integer,
  quantity_rule_effective_from timestamptz,quantity_rule_reason text,
  price_changed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  WITH selected_product AS (
    SELECT product.* FROM public.products product WHERE product.id=p_product_id
  ), preferred_supplier AS (
    SELECT supplier_product.* FROM public.product_suppliers supplier_product
    JOIN public.suppliers supplier ON supplier.id=supplier_product.supplier_id
    WHERE supplier_product.product_id=p_product_id AND supplier_product.preferred
      AND supplier_product.active AND supplier.active AND supplier.company_id IS NULL
      AND supplier_product.quantity_rule_effective_from<=p_at
      AND (supplier_product.quantity_rule_effective_to IS NULL OR supplier_product.quantity_rule_effective_to>p_at)
    ORDER BY supplier_product.quantity_rule_version DESC,supplier_product.updated_at DESC LIMIT 1
  ), pricing AS (
    SELECT rule.* FROM public.commercial_pricing_rules rule
    WHERE rule.rule_key='STANDARD_MARKUP' AND rule.currency='MYR'
      AND rule.effective_from<=p_at AND (rule.effective_to IS NULL OR rule.effective_to>p_at)
    ORDER BY rule.version DESC,rule.effective_from DESC LIMIT 1
  )
  SELECT
    coalesce(supplier_product.indicative_buy_price,product.default_buy_price),
    (coalesce(supplier_product.indicative_buy_price,product.default_buy_price)
      *(1+product.customer_markup_percentage/100))::numeric(18,6),
    public.axora_round_commercial_price(
      coalesce(supplier_product.indicative_buy_price,product.default_buy_price),
      product.customer_markup_percentage,pricing.rounding_scale
    ),
    pricing.currency,pricing.id,pricing.version,product.customer_markup_percentage,
    pricing.rounding_scale,pricing.tax_treatment,pricing.delivery_treatment,
    CASE WHEN product.customer_markup_percentage=10 THEN pricing.source ELSE 'PLATFORM_RULE' END,
    pricing.effective_from,supplier_product.id,supplier_product.supplier_id,
    coalesce(supplier_product.supplier_moq,1),supplier_product.maximum_order_quantity,
    coalesce(supplier_product.order_increment,1),coalesce(supplier_product.pack_size,1),
    coalesce(nullif(btrim(supplier_product.pack_unit),''),product.unit_of_measure),
    coalesce(supplier_product.quantity_rule_version,1),
    coalesce(supplier_product.quantity_rule_effective_from,product.created_at),
    coalesce(supplier_product.quantity_rule_reason,'Default quantity of one'),
    greatest(product.updated_at,coalesce(supplier_product.updated_at,product.updated_at),
      pricing.created_at,pricing.effective_from)
  FROM selected_product product CROSS JOIN pricing
  LEFT JOIN preferred_supplier supplier_product ON true
$$;

DROP TRIGGER IF EXISTS capture_product_price_history ON public.products;
CREATE TRIGGER capture_product_price_history
AFTER INSERT OR UPDATE OF default_buy_price,customer_markup_percentage ON public.products
FOR EACH ROW EXECUTE FUNCTION public.axora_capture_product_price_history();

-- Preserve the existing authorization/audit implementation while extending
-- its platform-only payload with the editable product field.
DO $catalog$
DECLARE definition text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.axora_product_administration_catalog(uuid,uuid,timestamptz)'::regprocedure)
    INTO definition;
  patched:=replace(definition,
    $marker$'defaultSellPrice',offer.selling_price,$marker$,
    $replacement$'defaultSellPrice',offer.selling_price,'customerMarkupPercentage',product.customer_markup_percentage,$replacement$);
  IF patched=definition THEN RAISE EXCEPTION 'Product administration catalog markup patch was not applied'; END IF;
  EXECUTE patched;
END $catalog$;

-- Legacy branches occasionally pre-date the ledger account bootstrap. Repair
-- only a missing supporting account/period, and only seed the already-stored
-- intended allocation once. No request, invoice, payment or prior ledger row
-- is modified.
DO $repair$
DECLARE item record; account_id_value uuid; period_id_value uuid;
BEGIN
  FOR item IN SELECT branch.* FROM public.branches branch
    WHERE branch.monthly_budget IS NOT NULL AND branch.monthly_budget>0
      AND NOT EXISTS (SELECT 1 FROM public.budget_accounts account
        WHERE account.branch_id=branch.id AND account.level_type='BRANCH')
  LOOP
    INSERT INTO public.budget_accounts(
      company_id,parent_account_id,level_type,branch_id,account_code,name,currency,
      recurring_allocation,period_timezone,rollover_policy
    ) SELECT item.company_id,company_account.id,'BRANCH',item.id,
      left('BRANCH-'||upper(regexp_replace(item.branch_code,'[^A-Za-z0-9_-]','','g')),80),
      item.name||' budget',company.ceiling_currency,item.monthly_budget,item.timezone,'NONE'
    FROM public.companies company
    LEFT JOIN public.budget_accounts company_account
      ON company_account.company_id=item.company_id AND company_account.level_type='COMPANY'
    WHERE company.id=item.company_id
    RETURNING id INTO account_id_value;
    INSERT INTO public.budget_periods(
      company_id,budget_account_id,period_name,starts_at,ends_at,timezone,
      allocation_method,rollover_policy,status,refresh_due_at
    ) VALUES (
      item.company_id,account_id_value,to_char(now() AT TIME ZONE item.timezone,'YYYY-MM'),
      date_trunc('month',now() AT TIME ZONE item.timezone) AT TIME ZONE item.timezone,
      (date_trunc('month',now() AT TIME ZONE item.timezone)+interval '1 month') AT TIME ZONE item.timezone,
      item.timezone,'MANUAL','NONE','ACTIVE',
      (date_trunc('month',now() AT TIME ZONE item.timezone)+interval '1 month') AT TIME ZONE item.timezone
    ) RETURNING id INTO period_id_value;
    PERFORM public.axora_post_budget_entry_internal(
      item.company_id,account_id_value,period_id_value,'INITIAL_ALLOCATION',item.monthly_budget,
      item.monthly_budget,item.monthly_budget,0,0,0,0,0,NULL,NULL,NULL,NULL,
      'MIGRATION',item.id,NULL,NULL,'MIGRATION_133','LEGACY_BRANCH_BUDGET_REPAIR',
      'Canonical ledger account seeded from the pre-existing branch allocation.',gen_random_uuid(),
      'migration-133-branch-budget-'||item.id::text,now()
    );
  END LOOP;
  -- Earlier UI paths could write branches.monthly_budget after the account was
  -- created, leaving a valid stated allocation with an empty canonical period.
  -- Repair that specific absence once; any ledger evidence means hands off.
  FOR item IN SELECT branch.*,account.id AS account_id,period.id AS period_id
    FROM public.branches branch
    JOIN public.budget_accounts account ON account.branch_id=branch.id
      AND account.level_type='BRANCH' AND account.active
    JOIN public.budget_periods period ON period.budget_account_id=account.id
      AND period.status='ACTIVE'
    WHERE branch.monthly_budget IS NOT NULL AND branch.monthly_budget>0
      AND NOT EXISTS (SELECT 1 FROM public.budget_ledger_entries ledger
        WHERE ledger.budget_account_id=account.id)
  LOOP
    UPDATE public.budget_accounts SET recurring_allocation=item.monthly_budget,updated_at=now()
      WHERE id=item.account_id;
    PERFORM public.axora_post_budget_entry_internal(
      item.company_id,item.account_id,item.period_id,'INITIAL_ALLOCATION',item.monthly_budget,
      item.monthly_budget,item.monthly_budget,0,0,0,0,0,NULL,NULL,NULL,NULL,
      'MIGRATION',item.id,NULL,NULL,'MIGRATION_133','LEGACY_BRANCH_BUDGET_REPAIR',
      'Canonical ledger period seeded from the pre-existing branch allocation.',gen_random_uuid(),
      'migration-133-existing-branch-budget-'||item.id::text,now()
    );
  END LOOP;
END $repair$;

CREATE TABLE public.branch_budget_add_commands (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK(amount>0),payload_hash text NOT NULL,
  result jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(actor_user_id,command_id)
);
ALTER TABLE public.branch_budget_add_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_budget_add_commands FORCE ROW LEVEL SECURITY;
CREATE TRIGGER branch_budget_add_commands_append_only BEFORE UPDATE OR DELETE
  ON public.branch_budget_add_commands FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES (
  'branch_budget_add_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
  'Immutable branch-budget allocation command and replay evidence is tenant financial evidence.'
) ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT COALESCE(maximum.delete_order,0)+1,
  'branch_budget_add_commands',
  'Branch-budget command evidence blocks hard deletion when protected and is ordered after its dependent financial records.'
FROM (SELECT max(delete_order) AS delete_order
  FROM public.company_deletion_ownership_dag) maximum
ON CONFLICT(table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.axora_add_branch_budget(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,p_amount numeric,
  p_command_id uuid,p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE; existing public.branch_budget_add_commands%ROWTYPE;
  wallet_available numeric(18,2); allocated numeric(18,2); payload_hash_value text; result_value jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'The budget amount is invalid';
  END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('branchId',p_branch_id,'amount',p_amount)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('branch-budget-add:'||p_actor_user_id::text||':'||p_command_id::text,0));
  SELECT * INTO existing FROM public.branch_budget_add_commands WHERE actor_user_id=p_actor_user_id AND command_id=p_command_id;
  IF existing.command_id IS NOT NULL THEN
    IF existing.payload_hash IS DISTINCT FROM payload_hash_value THEN RAISE EXCEPTION 'The budget command is unavailable'; END IF;
    RETURN existing.result||jsonb_build_object('changed',false);
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id AND branch.active FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL OR NOT public.axora_budget_account_permission(snapshot,'budget.increase','BRANCH',branch_row.company_id,branch_row.id,NULL) THEN
    RAISE EXCEPTION 'The branch is unavailable';
  END IF;
  -- Serialize allocations against the company wallet. The wallet is the
  -- backing source; branch budgets are spending authorizations, not money.
  PERFORM 1 FROM public.company_wallets wallet WHERE wallet.company_id=branch_row.company_id FOR UPDATE;
  SELECT * INTO account_row FROM public.budget_accounts account WHERE account.branch_id=branch_row.id AND account.level_type='BRANCH' AND account.active FOR UPDATE;
  SELECT * INTO period_row FROM public.budget_periods period WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE' FOR UPDATE;
  IF account_row.id IS NULL OR period_row.id IS NULL THEN RAISE EXCEPTION 'The branch budget is unavailable'; END IF;
  SELECT coalesce(balance.available_balance,0) INTO wallet_available FROM public.v_company_wallet_balances balance WHERE balance.company_id=branch_row.company_id AND balance.currency=account_row.currency;
  SELECT coalesce(sum(balance.allocated),0) INTO allocated FROM public.v_budget_period_balances balance
    JOIN public.budget_periods period ON period.id=balance.budget_period_id AND period.status='ACTIVE'
    JOIN public.budget_accounts account ON account.id=period.budget_account_id AND account.level_type='BRANCH' AND account.active
    WHERE balance.company_id=branch_row.company_id AND account.currency=account_row.currency;
  IF coalesce(wallet_available,0)-coalesce(allocated,0)<p_amount THEN RAISE EXCEPTION 'The company has insufficient allocatable funds'; END IF;
  PERFORM public.axora_adjust_budget_allocation(p_actor_user_id,p_actor_role_assignment_id,account_row.id,'INCREASE',p_amount,false,
    'COMPANY_ADMIN_BRANCH_BUDGET_ADD','branch-budget-add-'||p_command_id::text,p_at);
  result_value:=jsonb_build_object('branchId',branch_row.id,'amount',p_amount::text,'changed',true);
  INSERT INTO public.branch_budget_add_commands(actor_user_id,command_id,company_id,branch_id,amount,payload_hash,result,created_at)
  VALUES(p_actor_user_id,p_command_id,branch_row.company_id,branch_row.id,p_amount,payload_hash_value,result_value,p_at);
  RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_branch_active(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_active boolean,p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; blocker text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL OR NOT public.axora_organization_permission_at(
    snapshot,'organization.branch.manage',branch_row.company_id,branch_row.id,NULL
  ) THEN RAISE EXCEPTION 'The branch is unavailable'; END IF;
  IF branch_row.active IS NOT DISTINCT FROM p_active THEN
    RETURN jsonb_build_object('branchId',branch_row.id,'active',p_active,'changed',false);
  END IF;
  IF NOT p_active THEN
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.branch_id=branch_row.id
        AND job.status NOT IN ('DELIVERED','COMPLETED','CANCELLED','FAILED'))
        THEN 'Finish or cancel the active delivery before deactivating this branch.'
      WHEN EXISTS (SELECT 1 FROM public.procurement_carts cart WHERE cart.branch_id=branch_row.id
        AND cart.status='ACTIVE' AND EXISTS (SELECT 1 FROM public.procurement_cart_items item WHERE item.cart_id=cart.id))
        THEN 'Finish or clear the active cart before deactivating this branch.'
      WHEN EXISTS (SELECT 1 FROM public.requests request WHERE request.branch_id=branch_row.id
        AND EXISTS (SELECT 1 FROM public.lookup_values status WHERE status.id=request.status_id
          AND status.label NOT IN ('Completed','Cancelled')))
        THEN 'Finish or cancel the active request before deactivating this branch.'
    END INTO blocker;
    IF blocker IS NOT NULL THEN RAISE EXCEPTION '%',blocker; END IF;
  END IF;
  UPDATE public.branches SET active=p_active,updated_at=p_at WHERE id=branch_row.id;
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,reason,changed_by,changed_at
  ) VALUES (
    branch_row.company_id,'BRANCH',branch_row.id,CASE WHEN p_active THEN 'REACTIVATED' ELSE 'DEACTIVATED' END,
    to_jsonb(branch_row),(SELECT to_jsonb(branch) FROM public.branches branch WHERE branch.id=branch_row.id),
    CASE WHEN p_active THEN 'BRANCH_REACTIVATED' ELSE 'BRANCH_DEACTIVATED' END,p_actor_user_id,p_at
  );
  RETURN jsonb_build_object('branchId',branch_row.id,'active',p_active,'changed',true);
END $$;

-- A branch is physically removable only before anything else has ever
-- referenced it.  Inspect every live FK rather than maintaining a fragile
-- hand-written list: this guarantees the DELETE below cannot cascade a
-- location, assignment, command, ledger, request, delivery, or audit-linked
-- record.  Used branches remain deactivation-only.
CREATE OR REPLACE FUNCTION public.axora_delete_empty_branch(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; dependency record; has_dependent boolean;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL OR NOT public.axora_organization_permission_at(
    snapshot,'organization.branch.manage',branch_row.company_id,branch_row.id,NULL
  ) THEN RAISE EXCEPTION 'The branch is unavailable'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_structure_history history
    WHERE history.node_type='BRANCH' AND history.node_id=branch_row.id
  ) THEN RAISE EXCEPTION 'Used branches can only be deactivated'; END IF;
  FOR dependency IN
    SELECT child_relation.oid::regclass AS relation_name,
      string_agg(format('%I = $%s',child_column.attname,
        CASE parent_column.attname WHEN 'id' THEN 1 WHEN 'company_id' THEN 2 ELSE 3 END),
        ' AND ' ORDER BY child_key.ordinality) AS predicate
    FROM pg_catalog.pg_constraint constraint_row
    JOIN pg_catalog.pg_class child_relation ON child_relation.oid=constraint_row.conrelid
    JOIN pg_catalog.pg_namespace child_namespace ON child_namespace.oid=child_relation.relnamespace
    JOIN unnest(constraint_row.conkey) WITH ORDINALITY child_key(attnum,ordinality) ON true
    JOIN unnest(constraint_row.confkey) WITH ORDINALITY parent_key(attnum,ordinality)
      ON parent_key.ordinality=child_key.ordinality
    JOIN pg_catalog.pg_attribute child_column
      ON child_column.attrelid=constraint_row.conrelid AND child_column.attnum=child_key.attnum
    JOIN pg_catalog.pg_attribute parent_column
      ON parent_column.attrelid=constraint_row.confrelid AND parent_column.attnum=parent_key.attnum
    WHERE constraint_row.contype='f' AND constraint_row.confrelid='public.branches'::regclass
      AND child_namespace.nspname='public'
    GROUP BY child_relation.oid
  LOOP
    IF dependency.predicate LIKE '%$3%' THEN
      RAISE EXCEPTION 'The branch cannot be deleted safely';
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %s)',dependency.relation_name,dependency.predicate)
      INTO has_dependent USING branch_row.id,branch_row.company_id;
    IF has_dependent THEN
      RAISE EXCEPTION 'Used branches can only be deactivated';
    END IF;
  END LOOP;
  DELETE FROM public.branches WHERE id=branch_row.id AND company_id=branch_row.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The branch is unavailable'; END IF;
  RETURN jsonb_build_object('branchId',p_branch_id,'deleted',true);
END $$;

REVOKE ALL ON TABLE public.branch_budget_add_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_add_branch_budget(uuid,uuid,uuid,numeric,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_branch_active(uuid,uuid,uuid,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delete_empty_branch(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
DO $grant$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.branch_budget_add_commands FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_add_branch_budget(uuid,uuid,uuid,numeric,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_set_branch_active(uuid,uuid,uuid,boolean,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_delete_empty_branch(uuid,uuid,uuid,timestamptz) TO axora_app;
  END IF;
END $grant$;

COMMIT;
