BEGIN;

-- Migration 113 renamed the refresh result variable to refresh_result while
-- preserving one success-event expression that still referenced `result`.
-- That reference is evaluated after the period refresh, so the exception
-- handler rolled the whole refresh back and reported a generic retryable
-- failure.  Patch only that stale expression; all financial work remains in
-- the existing idempotent refresh procedure.
DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  stale_expression text := $$jsonb_build_object('periodId',result->>'periodId')$$;
  corrected_expression text := $$jsonb_build_object('periodId',refresh_result->>'periodId')$$;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_process_budget_refresh_job(text,uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;

  IF original_definition !~ 'refresh_result[[:space:]]+jsonb' THEN
    RAISE EXCEPTION 'Budget refresh result variable is not in the expected form';
  END IF;
  IF position(stale_expression IN original_definition)=0 THEN
    RAISE EXCEPTION 'Budget refresh success-event stale result reference was not found';
  END IF;
  patched_definition:=replace(original_definition,stale_expression,corrected_expression);
  IF patched_definition=original_definition
    OR position(stale_expression IN patched_definition)>0
  THEN
    RAISE EXCEPTION 'Budget refresh result reference patch was not applied';
  END IF;
  EXECUTE patched_definition;
END $patch$;

-- Branch allocations are authorization ceilings. The purchase path checks the
-- Company Wallet at reservation/finalization time; increasing an
-- authorization must not treat every other branch allocation as cash already
-- reserved in that Wallet. The existing adjustment procedure still enforces
-- the company contractual ceiling and serializes the account/ceiling rows.
CREATE OR REPLACE FUNCTION public.axora_add_branch_budget(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,p_amount numeric,
  p_command_id uuid,p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE; existing public.branch_budget_add_commands%ROWTYPE;
  payload_hash_value text; result_value jsonb;
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
  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.branch_id=branch_row.id AND account.level_type='BRANCH' AND account.active FOR UPDATE;
  SELECT * INTO period_row FROM public.budget_periods period
  WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE' FOR UPDATE;
  IF account_row.id IS NULL OR period_row.id IS NULL THEN RAISE EXCEPTION 'The branch budget is unavailable'; END IF;
  PERFORM public.axora_adjust_budget_allocation(p_actor_user_id,p_actor_role_assignment_id,account_row.id,'INCREASE',p_amount,false,
    'COMPANY_ADMIN_BRANCH_BUDGET_ADD','branch-budget-add-'||p_command_id::text,p_at);
  result_value:=jsonb_build_object('branchId',branch_row.id,'amount',p_amount::text,'changed',true);
  INSERT INTO public.branch_budget_add_commands(actor_user_id,command_id,company_id,branch_id,amount,payload_hash,result,created_at)
  VALUES(p_actor_user_id,p_command_id,branch_row.company_id,branch_row.id,p_amount,payload_hash_value,result_value,p_at);
  RETURN result_value;
END $$;

COMMIT;
