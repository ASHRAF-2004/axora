BEGIN;

-- These are trusted application capabilities, not raw SQL tenant endpoints.
-- Bind their actor parameters to the transaction's existing audit identity and
-- lock the same user row that permission/lifecycle management locks FOR UPDATE.
-- Capture current permission time after any lock wait, not at transaction start.
CREATE FUNCTION public.axora_branch_command_actor_snapshot(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_id uuid; assignment_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_actor_user_id IS DISTINCT FROM public.axora_try_uuid(nullif(current_setting('axora.user_id',true),''))
    OR p_actor_role_assignment_id IS DISTINCT FROM public.axora_try_uuid(nullif(current_setting('axora.role_assignment_id',true),''))
  THEN RETURN NULL; END IF;
  SELECT account.id INTO actor_id FROM public.users account
  WHERE account.id=p_actor_user_id AND account.active AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL FOR SHARE;
  IF actor_id IS NULL THEN RETURN NULL; END IF;
  SELECT assignment.id INTO assignment_id FROM public.role_assignments assignment
  WHERE assignment.id=p_actor_role_assignment_id AND assignment.user_id=actor_id
    AND assignment.active AND assignment.revoked_at IS NULL FOR SHARE;
  IF assignment_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.axora_live_authorization_snapshot(actor_id,assignment_id,clock_timestamp());
END $$;

CREATE FUNCTION public.axora_branch_lifecycle_actor_snapshot(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_branch_command_actor_snapshot(p_actor_user_id,p_actor_role_assignment_id);
  -- Operational/department management must never grant this role destructive
  -- branch lifecycle authority, including custom GRANT or delegated access.
  IF snapshot IS NULL OR snapshot->>'roleKey'='BRANCH_ADMIN' THEN RETURN NULL; END IF;
  RETURN snapshot;
END $$;

CREATE OR REPLACE FUNCTION public.axora_add_branch_budget(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,p_amount numeric,
  p_command_id uuid,p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE; existing public.branch_budget_add_commands%ROWTYPE;
  payload_hash_value text; result_value jsonb; ceiling numeric(18,2); total_allocated numeric(18,2);
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_command_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='AX001',MESSAGE='INVALID_AMOUNT';
  END IF;
  snapshot:=public.axora_branch_command_actor_snapshot(p_actor_user_id,p_actor_role_assignment_id);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id AND branch.active FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL OR NOT public.axora_budget_account_permission(
    snapshot,'budget.increase','BRANCH',branch_row.company_id,branch_row.id,NULL
  ) THEN RAISE EXCEPTION USING ERRCODE='AX002',MESSAGE='FORBIDDEN'; END IF;

  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('branchId',p_branch_id,'amount',p_amount)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('branch-budget-add:'||p_actor_user_id::text||':'||p_command_id::text,0));
  SELECT * INTO existing FROM public.branch_budget_add_commands WHERE actor_user_id=p_actor_user_id AND command_id=p_command_id;
  IF existing.command_id IS NOT NULL THEN
    IF existing.payload_hash IS DISTINCT FROM payload_hash_value THEN
      RAISE EXCEPTION USING ERRCODE='AX005',MESSAGE='COMMAND_MISMATCH';
    END IF;
    RETURN existing.result||jsonb_build_object('changed',false);
  END IF;
  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.branch_id=branch_row.id AND account.level_type='BRANCH' AND account.active FOR UPDATE;
  SELECT * INTO period_row FROM public.budget_periods period
  WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE' FOR UPDATE;
  IF account_row.id IS NULL OR period_row.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='AX003',MESSAGE='BUDGET_UNAVAILABLE';
  END IF;

  -- Exactly the existing allocation/ceiling calculation and company lock.
  -- This only reports its legitimate refusal precisely to this authorized
  -- actor. Wallet balances and recurring allocations are not funding inputs.
  SELECT company.contractual_ceiling INTO ceiling FROM public.companies company
  WHERE company.id=account_row.company_id FOR UPDATE;
  SELECT COALESCE(sum(active_balance.allocated),0) INTO total_allocated
  FROM public.v_budget_period_balances active_balance
  JOIN public.budget_periods active_period ON active_period.id=active_balance.budget_period_id
  JOIN public.budget_accounts active_account ON active_account.id=active_balance.budget_account_id
  WHERE active_balance.company_id=account_row.company_id
    AND active_period.status='ACTIVE' AND active_account.level_type<>'COMPANY';
  IF total_allocated+p_amount>ceiling THEN
    RAISE EXCEPTION USING ERRCODE='AX004',MESSAGE='CEILING_EXCEEDED',DETAIL=jsonb_build_object(
      'ceiling',ceiling::text,'allocated',total_allocated::text,
      'headroom',greatest(ceiling-total_allocated,0)::text
    )::text;
  END IF;
  PERFORM public.axora_adjust_budget_allocation(p_actor_user_id,p_actor_role_assignment_id,account_row.id,'INCREASE',p_amount,false,
    'COMPANY_ADMIN_BRANCH_BUDGET_ADD','branch-budget-add-'||p_command_id::text,p_at);
  result_value:=jsonb_build_object('branchId',branch_row.id,'amount',p_amount::text,'changed',true);
  INSERT INTO public.branch_budget_add_commands(actor_user_id,command_id,company_id,branch_id,amount,payload_hash,result,created_at)
  VALUES(p_actor_user_id,p_command_id,branch_row.company_id,branch_row.id,p_amount,payload_hash_value,result_value,p_at);
  RETURN result_value;
END $$;

-- Patch only the authority source/evidence omission in the existing lifecycle
-- routines. Their operational blockers, idempotent state handling, full FK
-- dependency scan and retained history remain intact.
DO $lifecycle$
DECLARE original text; patched text; signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.axora_set_branch_active(uuid,uuid,uuid,boolean,timestamptz)',
    'public.axora_delete_empty_branch(uuid,uuid,uuid,timestamptz)'
  ] LOOP
    SELECT pg_get_functiondef(signature::regprocedure) INTO original;
    patched:=replace(original,
      'snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);',
      'snapshot:=public.axora_branch_lifecycle_actor_snapshot(p_actor_user_id,p_actor_role_assignment_id);');
    IF patched=original THEN RAISE EXCEPTION 'Expected branch lifecycle authority source not found: %',signature; END IF;
    IF signature LIKE '%axora_set_branch_active%' THEN
      original:=patched;
      patched:=replace(patched,'UPDATE public.branches SET active=p_active,updated_at=p_at WHERE id=branch_row.id;',
        'UPDATE public.branches SET active=p_active,updated_at=p_at,
          deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
          deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
          deactivation_reason=CASE WHEN p_active THEN NULL ELSE ''BRANCH_DEACTIVATED'' END WHERE id=branch_row.id;');
      IF patched=original THEN RAISE EXCEPTION 'Expected branch deactivation evidence update not found'; END IF;
    END IF;
    EXECUTE patched;
  END LOOP;

  -- Preserve every non-branch organization operation and the legacy branch
  -- child/assignment guard. Branch calls acquire actor locks before node locks
  -- and gain the same operational blockers as the current branch workspace.
  SELECT pg_get_functiondef('public.axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure) INTO original;
  patched:=replace(original,'BEGIN
  IF p_node_type NOT IN',
    'BEGIN
  IF p_node_type=''BRANCH'' THEN
    actor_snapshot:=public.axora_branch_lifecycle_actor_snapshot(p_actor_user_id,p_actor_role_assignment_id);
    IF actor_snapshot IS NULL THEN RAISE EXCEPTION ''The organization status change is unavailable''; END IF;
  END IF;
  IF p_node_type NOT IN');
  IF patched=original THEN RAISE EXCEPTION 'Expected organization lifecycle entry not found'; END IF;
  original:=patched;
  patched:=replace(patched,'actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );','IF p_node_type<>''BRANCH'' THEN
    actor_snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  END IF;');
  IF patched=original THEN RAISE EXCEPTION 'Expected organization lifecycle authority source not found'; END IF;
  original:=patched;
  patched:=replace(patched,'IF NOT p_active AND (
    (p_node_type=''BRANCH'' AND (',
    'IF NOT p_active AND (
    (p_node_type=''BRANCH'' AND (
      EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.branch_id=p_node_id
        AND job.status NOT IN (''DELIVERED'',''COMPLETED'',''CANCELLED'',''FAILED''))
      OR EXISTS (SELECT 1 FROM public.procurement_carts cart WHERE cart.branch_id=p_node_id
        AND cart.status=''ACTIVE'' AND EXISTS (SELECT 1 FROM public.procurement_cart_items item WHERE item.cart_id=cart.id))
      OR EXISTS (SELECT 1 FROM public.requests request JOIN public.lookup_values status ON status.id=request.status_id
        WHERE request.branch_id=p_node_id AND status.label NOT IN (''Completed'',''Cancelled''))
      OR');
  IF patched=original THEN RAISE EXCEPTION 'Expected organization branch dependency guard not found'; END IF;
  EXECUTE patched;
END $lifecycle$;

REVOKE ALL ON FUNCTION public.axora_branch_command_actor_snapshot(uuid,uuid),
  public.axora_branch_lifecycle_actor_snapshot(uuid,uuid) FROM PUBLIC;

-- Table-level UPDATE would override a column-only REVOKE. Retain ordinary
-- metadata columns, but make active/evidence mutation capability-only. The
-- canonical deployment grant replay applies this same conditional boundary.
DO $grants$
DECLARE metadata_columns text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE UPDATE ON TABLE public.branches FROM axora_app;
    REVOKE UPDATE(active,deactivated_at,deactivated_by,deactivation_reason) ON public.branches FROM axora_app;
    SELECT string_agg(format('%I',column_row.attname),',' ORDER BY column_row.attnum) INTO metadata_columns
    FROM pg_attribute column_row WHERE column_row.attrelid='public.branches'::regclass
      AND column_row.attnum>0 AND NOT column_row.attisdropped
      AND column_row.attname NOT IN ('active','deactivated_at','deactivated_by','deactivation_reason');
    EXECUTE format('GRANT UPDATE(%s) ON TABLE public.branches TO axora_app',metadata_columns);
    REVOKE ALL ON FUNCTION public.axora_branch_command_actor_snapshot(uuid,uuid),
      public.axora_branch_lifecycle_actor_snapshot(uuid,uuid) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_add_branch_budget(uuid,uuid,uuid,numeric,uuid,timestamptz),
      public.axora_set_branch_active(uuid,uuid,uuid,boolean,timestamptz),
      public.axora_delete_empty_branch(uuid,uuid,uuid,timestamptz),
      public.axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz) TO axora_app;
  END IF;
END $grants$;

COMMIT;
