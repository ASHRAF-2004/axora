BEGIN;

-- P0-08: approval decisions are immutable, versioned authorization facts.
-- P0-07 reservations are posted in the same transaction as final approval.

CREATE TABLE public.request_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version>0),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 160),
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules)='object'),
  effective_at timestamptz NOT NULL,
  retired_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,policy_version),
  CHECK (
    (status='ACTIVE' AND retired_at IS NULL)
    OR (status='RETIRED' AND retired_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX request_approval_policies_active_uq
  ON public.request_approval_policies(company_id) WHERE status='ACTIVE';

INSERT INTO public.request_approval_policies(
  company_id,policy_version,name,status,rules,effective_at
)
SELECT company.id,1,'Default procurement approval policy','ACTIVE',
  jsonb_build_object(
    'departmentApproval',true,
    'companyEscalationWhenLimitExceeded',true,
    'companyEscalationWhenBudgetExceeded',true,
    'axoraEscalationWhenCeilingExceeded',true,
    'selfApprovalRequiresExplicitPermissionAndLimit',true,
    'reservationMode','ATOMIC_ON_FINAL_APPROVAL'
  ),now()
FROM public.companies company;

ALTER TABLE public.requests
  ADD COLUMN cost_centre_id uuid,
  ADD COLUMN delivery_location_id uuid,
  ADD COLUMN approval_state text NOT NULL DEFAULT 'DRAFT' CHECK (
    approval_state IN (
      'DRAFT','SUBMITTED','PENDING_DEPARTMENT','PENDING_COMPANY',
      'PENDING_AXORA','APPROVED','AWAITING_FULFILMENT','REJECTED',
      'RETURNED','CANCELLED'
    )
  ),
  ADD COLUMN approval_revision integer NOT NULL DEFAULT 1 CHECK (approval_revision>0),
  ADD COLUMN approval_policy_id uuid,
  ADD COLUMN approval_submitted_at timestamptz,
  ADD COLUMN approval_decided_at timestamptz,
  ADD COLUMN approval_last_correlation_id uuid,
  ADD CONSTRAINT requests_cost_centre_company_fk
    FOREIGN KEY(cost_centre_id,company_id)
    REFERENCES public.cost_centres(id,company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT requests_delivery_location_company_fk
    FOREIGN KEY(delivery_location_id,company_id)
    REFERENCES public.delivery_locations(id,company_id) ON DELETE RESTRICT;

UPDATE public.requests request
SET approval_policy_id=policy.id,
    approval_submitted_at=request.created_at,
    approval_decided_at=CASE
      WHEN EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status IN ('Approved','Rejected')
      ) THEN request.updated_at
      ELSE NULL
    END,
    approval_state=CASE
      WHEN status.label='Cancelled' THEN 'CANCELLED'
      WHEN EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status='Rejected'
      ) THEN 'REJECTED'
      WHEN EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status='Approved'
      ) THEN 'APPROVED'
      WHEN status.label<>'New Request' THEN 'AWAITING_FULFILMENT'
      WHEN request.department_id IS NOT NULL THEN 'PENDING_DEPARTMENT'
      ELSE 'PENDING_COMPANY'
    END
FROM public.request_approval_policies policy,public.lookup_values status
WHERE policy.company_id=request.company_id
  AND policy.status='ACTIVE'
  AND status.id=request.status_id;

ALTER TABLE public.requests
  ALTER COLUMN approval_policy_id SET NOT NULL,
  ADD CONSTRAINT requests_approval_policy_fk
    FOREIGN KEY(approval_policy_id)
    REFERENCES public.request_approval_policies(id) ON DELETE RESTRICT;

CREATE TABLE public.request_approval_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES public.request_approval_policies(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version>0),
  amount numeric(18,2) NOT NULL CHECK (amount>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,request_version)
);
CREATE INDEX request_approval_snapshots_company_idx
  ON public.request_approval_snapshots(company_id,created_at DESC);

CREATE TABLE public.request_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  approval_revision_before integer NOT NULL CHECK (approval_revision_before>0),
  approval_revision_after integer NOT NULL CHECK (approval_revision_after>=approval_revision_before),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES public.request_approval_policies(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  system_job text,
  action text NOT NULL CHECK (action IN (
    'BACKFILL','SUBMIT','APPROVE','REJECT','RETURN','CANCEL','ESCALATE',
    'FINALIZE','ADDITIONAL_ACTUAL_REQUIRED'
  )),
  state_before text NOT NULL,
  state_after text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  approval_limit numeric(18,2),
  self_approval boolean NOT NULL DEFAULT false,
  option_code text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,idempotency_key),
  CHECK (actor_user_id IS NOT NULL OR system_job IS NOT NULL)
);
CREATE INDEX request_approval_decisions_timeline_idx
  ON public.request_approval_decisions(request_id,decided_at,id);
CREATE INDEX request_approval_decisions_correlation_idx
  ON public.request_approval_decisions(correlation_id);

CREATE TABLE public.request_approval_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  decision_id uuid NOT NULL REFERENCES public.request_approval_decisions(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  escalation_type text NOT NULL CHECK (escalation_type IN (
    'APPROVAL_LIMIT','BUDGET_AVAILABLE','COMPANY_CEILING','ADDITIONAL_ACTUAL'
  )),
  target_state text NOT NULL CHECK (target_state IN ('PENDING_COMPANY','PENDING_AXORA')),
  amount numeric(18,2) NOT NULL CHECK (amount>=0),
  available_amount numeric(18,2),
  threshold_amount numeric(18,2),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_approval_escalations_queue_idx
  ON public.request_approval_escalations(company_id,target_state,created_at DESC);

CREATE TABLE public.request_approval_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  approval_revision integer NOT NULL CHECK (approval_revision>0),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN (
    'APPROVAL_NOTIFICATION','ESCALATION_NOTIFICATION','FULFILMENT_CREATE',
    'REQUEST_PDF','DECISION_NOTIFICATION'
  )),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','PROCESSING','COMPLETED','FAILED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_type,idempotency_key)
);
CREATE INDEX request_approval_outbox_claim_idx
  ON public.request_approval_outbox(status,available_at,created_at);

ALTER TABLE public.budget_reservations
  ADD CONSTRAINT budget_reservations_approval_decision_fk
  FOREIGN KEY(approval_decision_id)
  REFERENCES public.request_approval_decisions(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.axora_request_total_internal(p_request_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT round((
    COALESCE((SELECT sum(round(line.quantity*line.unit_sell_price,2))
      FROM public.request_lines line WHERE line.request_id=p_request_id),0)
    +request.estimated_delivery_fee+request.tax_amount
  )::numeric,2)
  FROM public.requests request
  WHERE request.id=p_request_id
$$;

CREATE OR REPLACE FUNCTION public.axora_seed_company_approval_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  INSERT INTO public.request_approval_policies(
    company_id,policy_version,name,status,rules,effective_at
  ) VALUES (
    NEW.id,1,'Default procurement approval policy','ACTIVE',
    jsonb_build_object(
      'departmentApproval',true,
      'companyEscalationWhenLimitExceeded',true,
      'companyEscalationWhenBudgetExceeded',true,
      'axoraEscalationWhenCeilingExceeded',true,
      'selfApprovalRequiresExplicitPermissionAndLimit',true,
      'reservationMode','ATOMIC_ON_FINAL_APPROVAL'
    ),now()
  ) ON CONFLICT(company_id,policy_version) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER seed_company_approval_policy
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_company_approval_policy();

CREATE OR REPLACE FUNCTION public.axora_resolve_request_budget_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  account_row record;
BEGIN
  IF NEW.approval_policy_id IS NULL THEN
    SELECT policy.id INTO NEW.approval_policy_id
    FROM public.request_approval_policies policy
    WHERE policy.company_id=NEW.company_id AND policy.status='ACTIVE'
      AND policy.effective_at<=now()
    ORDER BY policy.policy_version DESC LIMIT 1;
  END IF;
  IF NEW.budget_account_id IS NULL OR NEW.budget_period_id IS NULL THEN
    SELECT account.id,account.currency,period.id AS period_id
    INTO account_row
    FROM public.budget_accounts account
    JOIN public.budget_periods period ON period.budget_account_id=account.id
      AND period.status='ACTIVE' AND period.starts_at<=now() AND period.ends_at>now()
    WHERE account.company_id=NEW.company_id AND account.active
      AND (
        (NEW.cost_centre_id IS NOT NULL AND account.level_type='COST_CENTRE'
          AND account.cost_centre_id=NEW.cost_centre_id)
        OR (NEW.department_id IS NOT NULL AND account.level_type='DEPARTMENT'
          AND account.department_id=NEW.department_id)
        OR (account.level_type='BRANCH' AND account.branch_id=NEW.branch_id)
      )
    ORDER BY CASE account.level_type
      WHEN 'COST_CENTRE' THEN 1 WHEN 'DEPARTMENT' THEN 2 ELSE 3 END
    LIMIT 1;
    NEW.budget_account_id:=account_row.id;
    NEW.budget_period_id:=account_row.period_id;
    NEW.currency:=account_row.currency;
  END IF;
  IF NEW.approval_policy_id IS NULL OR NEW.budget_account_id IS NULL
    OR NEW.budget_period_id IS NULL THEN
    RAISE EXCEPTION 'The request authorization context is unavailable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER resolve_request_budget_defaults
BEFORE INSERT ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.axora_resolve_request_budget_defaults();

CREATE OR REPLACE FUNCTION public.axora_request_snapshot_payload_internal(
  p_request_id uuid,p_policy_version integer,p_amount numeric,p_currency text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'request',to_jsonb(request)
      -'client_submission_key'-'approval_last_correlation_id',
    'lines',COALESCE((SELECT jsonb_agg(
      to_jsonb(line)-'unit_cost'-'buying_cost'-'margin'-'supplier_id'
      ORDER BY line.id
    ) FROM public.request_lines line WHERE line.request_id=request.id),'[]'::jsonb),
    'amount',p_amount::text,
    'currency',p_currency,
    'policyVersion',p_policy_version
  )
  FROM public.requests request WHERE request.id=p_request_id
$$;

CREATE OR REPLACE FUNCTION public.axora_approval_limit_for_request(
  p_snapshot jsonb,p_permission text,p_company_id uuid,p_branch_id uuid,
  p_department_id uuid,p_currency text,p_require_self boolean
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT max((limit_row->>'maximumAmount')::numeric)
  FROM jsonb_array_elements(COALESCE(p_snapshot->'approvalLimits','[]'::jsonb)) limit_row
  WHERE limit_row->>'permission'=p_permission
    AND limit_row->>'currency'=p_currency
    AND (NOT p_require_self OR COALESCE((limit_row->>'allowSelfApproval')::boolean,false))
    AND (
      (limit_row#>>'{scope,type}')='COMPANY'
        AND (limit_row#>>'{scope,companyId}')::uuid=p_company_id
      OR (limit_row#>>'{scope,type}')='BRANCH'
        AND (limit_row#>>'{scope,companyId}')::uuid=p_company_id
        AND (limit_row#>>'{scope,branchId}')::uuid=p_branch_id
      OR (limit_row#>>'{scope,type}')='DEPARTMENT'
        AND (limit_row#>>'{scope,companyId}')::uuid=p_company_id
        AND (limit_row#>>'{scope,departmentId}')::uuid=p_department_id
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_request_budget_choices(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'accounts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',account.id,'companyId',account.company_id,'levelType',account.level_type,
        'branchId',account.branch_id,'departmentId',account.department_id,
        'costCentreId',account.cost_centre_id,'name',account.name,
        'currency',account.currency,'periodId',period.id,'periodName',period.period_name,
        'available',COALESCE(balance.available,0)::text,
        'allocated',COALESCE(balance.allocated,0)::text,
        'nextRefreshAt',period.refresh_due_at,
        'approvalPolicyId',policy.id
      ) ORDER BY account.level_type,account.account_code)
      FROM public.budget_accounts account
      JOIN public.companies company ON company.id=account.company_id AND company.active
      JOIN public.request_approval_policies policy
        ON policy.company_id=account.company_id AND policy.status='ACTIVE'
       AND policy.effective_at<=p_at
      JOIN public.budget_periods period
        ON period.budget_account_id=account.id AND period.status='ACTIVE'
       AND period.starts_at<=p_at AND period.ends_at>p_at
      LEFT JOIN public.v_budget_period_balances balance
        ON balance.budget_period_id=period.id
      WHERE account.active
        AND account.level_type<>'COMPANY'
        AND public.axora_budget_account_permission(
          snapshot,'request.create',account.level_type,account.company_id,
          account.branch_id,account.department_id
        )
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_initialize_request_approval(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_idempotency_key text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  request_row public.requests%ROWTYPE;
  account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE;
  policy_row public.request_approval_policies%ROWTYPE;
  amount numeric(18,2);
  payload jsonb;
  correlation uuid:=gen_random_uuid();
  decision_id uuid:=gen_random_uuid();
  next_state text;
BEGIN
  IF char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The submission key is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RAISE EXCEPTION 'The request is unavailable'; END IF;

  SELECT * INTO request_row FROM public.requests
  WHERE id=p_request_id FOR UPDATE;
  IF request_row.id IS NULL
    OR request_row.created_by<>p_actor_user_id
    OR request_row.approval_state<>'DRAFT'
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'request.create',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    ) THEN
    RAISE EXCEPTION 'The request is unavailable';
  END IF;

  SELECT * INTO account_row FROM public.budget_accounts
  WHERE id=request_row.budget_account_id AND company_id=request_row.company_id
    AND active
    AND (
      (level_type='BRANCH' AND branch_id=request_row.branch_id)
      OR (level_type='DEPARTMENT' AND department_id=request_row.department_id)
      OR (level_type='COST_CENTRE' AND cost_centre_id=request_row.cost_centre_id)
    )
  FOR KEY SHARE;
  SELECT * INTO period_row FROM public.budget_periods
  WHERE id=request_row.budget_period_id
    AND budget_account_id=request_row.budget_account_id
    AND status='ACTIVE' AND starts_at<=p_at AND ends_at>p_at
  FOR UPDATE;
  IF account_row.id IS NULL OR period_row.id IS NULL
    OR account_row.currency<>request_row.currency THEN
    RAISE EXCEPTION 'The selected budget period is unavailable';
  END IF;

  SELECT * INTO policy_row FROM public.request_approval_policies
  WHERE id=request_row.approval_policy_id AND company_id=request_row.company_id
    AND status='ACTIVE' AND effective_at<=p_at
  FOR KEY SHARE;
  IF policy_row.id IS NULL THEN RAISE EXCEPTION 'The approval policy is unavailable'; END IF;

  amount:=public.axora_request_total_internal(request_row.id);
  payload:=public.axora_request_snapshot_payload_internal(
    request_row.id,policy_row.policy_version,amount,request_row.currency
  );
  next_state:=CASE WHEN request_row.department_id IS NULL
    THEN 'PENDING_COMPANY' ELSE 'PENDING_DEPARTMENT' END;

  INSERT INTO public.request_approval_snapshots(
    request_id,request_version,company_id,policy_id,policy_version,amount,currency,
    snapshot,snapshot_hash,created_by,created_at
  ) VALUES (
    request_row.id,request_row.request_version,request_row.company_id,policy_row.id,
    policy_row.policy_version,amount,request_row.currency,payload,
    encode(sha256(convert_to(payload::text,'UTF8')),'hex'),p_actor_user_id,p_at
  );

  IF amount>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
      'PENDING_EXPOSURE_ADD',amount,0,0,0,0,amount,0,0,
      request_row.id,request_row.request_version,NULL,NULL,'REQUEST',request_row.id,
      p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_SUBMITTED',
      'Request submitted for approval.',correlation,
      'request-submit-'||request_row.id::text||'-v'||request_row.request_version::text,p_at
    );
  END IF;

  UPDATE public.requests SET approval_state=next_state,
    approval_submitted_at=p_at,approval_last_correlation_id=correlation
  WHERE id=request_row.id;
  payload:=jsonb_build_object(
    'decisionId',decision_id,'requestId',request_row.id,
    'requestVersion',request_row.request_version,'approvalRevision',request_row.approval_revision,
    'state',next_state,'amount',amount::text,'currency',request_row.currency
  );
  INSERT INTO public.request_approval_decisions(
    id,request_id,request_version,approval_revision_before,approval_revision_after,
    company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
    state_before,state_after,amount,currency,self_approval,reason,correlation_id,
    idempotency_key,result,decided_at
  ) VALUES (
    decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
    request_row.approval_revision,request_row.company_id,policy_row.id,p_actor_user_id,
    p_actor_role_assignment_id,'SUBMIT','DRAFT',next_state,amount,request_row.currency,
    false,'Request submitted for approval.',correlation,p_idempotency_key,payload,p_at
  );
  INSERT INTO public.request_approval_outbox(
    request_id,request_version,approval_revision,company_id,job_type,payload,
    idempotency_key,available_at
  ) VALUES (
    request_row.id,request_row.request_version,request_row.approval_revision,
    request_row.company_id,'APPROVAL_NOTIFICATION',payload,
    p_idempotency_key||'-notify',p_at
  );
  RETURN payload;
END $$;

CREATE OR REPLACE FUNCTION public.axora_request_approval_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
#variable_conflict use_variable
DECLARE
  snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'requests',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',request.id,'requestNumber',request.order_code,
        'budgetAccountId',request.budget_account_id,
        'requestVersion',request.request_version,'approvalRevision',request.approval_revision,
        'state',request.approval_state,'companyId',request.company_id,
        'companyName',company.name,'branchId',request.branch_id,'branchName',branch.name,
        'departmentId',request.department_id,'departmentName',department.name,
        'requesterId',request.created_by,
        'requesterName',COALESCE(
          NULLIF(btrim(concat_ws(' ',to_jsonb(requester)->>'first_name',to_jsonb(requester)->>'last_name')),''),
          to_jsonb(requester)->>'name',requester.email
        ),
        'amount',approval_snapshot.amount::text,'currency',approval_snapshot.currency,
        'approvalLimit',public.axora_approval_limit_for_request(
          snapshot,CASE WHEN request.created_by=p_actor_user_id
            THEN 'request.approve.self' ELSE 'request.approve.other' END,
          request.company_id,request.branch_id,request.department_id,
          approval_snapshot.currency,request.created_by=p_actor_user_id
        )::text,
        'available',COALESCE(balance.available,0)::text,
        'exceededBy',greatest(approval_snapshot.amount-COALESCE(balance.available,0),0)::text,
        'companyCeiling',CASE WHEN public.axora_snapshot_has_permission(
          snapshot,'commercial.company_ceiling.view','COMPANY',request.company_id,NULL,NULL,NULL
        ) THEN company.contractual_ceiling::text ELSE NULL END,
        'ceilingUtilized',CASE WHEN public.axora_snapshot_has_permission(
          snapshot,'commercial.company_ceiling.view','COMPANY',request.company_id,NULL,NULL,NULL
        ) THEN COALESCE(exposure.amount,0)::text ELSE NULL END,
        'submittedAt',request.approval_submitted_at,
        'deliveryDate',request.needed_by_date,
        'notes',request.notes,
        'lines',approval_snapshot.snapshot->'lines',
        'canResolveOverBudget',public.axora_snapshot_has_permission(
          snapshot,'request.approve.over_budget',
          CASE WHEN request.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
          request.company_id,request.branch_id,request.department_id,NULL
        ),
        'canOverrideCeiling',public.axora_snapshot_has_permission(
          snapshot,'commercial.company_ceiling.override','COMPANY',request.company_id,NULL,NULL,NULL
        )
      )) ORDER BY request.approval_submitted_at,request.id)
      FROM public.requests request
      JOIN public.request_approval_snapshots approval_snapshot
        ON approval_snapshot.request_id=request.id
       AND approval_snapshot.request_version=request.request_version
      JOIN public.companies company ON company.id=request.company_id
      JOIN public.branches branch ON branch.id=request.branch_id
      LEFT JOIN public.departments department ON department.id=request.department_id
      JOIN public.users requester ON requester.id=request.created_by
      LEFT JOIN public.v_budget_period_balances balance
        ON balance.budget_period_id=request.budget_period_id
      LEFT JOIN LATERAL (
        SELECT sum(company_balance.reserved+company_balance.spent)::numeric(18,2) AS amount
        FROM public.v_budget_period_balances company_balance
        JOIN public.budget_periods company_period
          ON company_period.id=company_balance.budget_period_id
         AND company_period.status='ACTIVE'
        WHERE company_balance.company_id=request.company_id
      ) exposure ON true
      WHERE request.approval_state IN (
        'PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA'
      )
        AND (
          (request.created_by<>p_actor_user_id
            AND public.axora_snapshot_has_permission(
              snapshot,'request.approve.other',
              CASE WHEN request.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
              request.company_id,request.branch_id,request.department_id,NULL
            )
            AND public.axora_approval_limit_for_request(
              snapshot,'request.approve.other',request.company_id,request.branch_id,
              request.department_id,approval_snapshot.currency,false
            ) IS NOT NULL)
          OR
          (request.created_by=p_actor_user_id
            AND public.axora_snapshot_has_permission(
              snapshot,'request.approve.self',
              CASE WHEN request.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
              request.company_id,request.branch_id,request.department_id,NULL
            )
            AND public.axora_approval_limit_for_request(
              snapshot,'request.approve.self',request.company_id,request.branch_id,
              request.department_id,approval_snapshot.currency,true
            ) IS NOT NULL)
        )
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_decide_request_approval(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_expected_approval_revision integer,p_action text,p_option_code text,
  p_source_budget_account_id uuid,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  request_row public.requests%ROWTYPE;
  approval_snapshot public.request_approval_snapshots%ROWTYPE;
  period_row public.budget_periods%ROWTYPE;
  balance_row record;
  existing_result jsonb;
  amount numeric(18,2);
  limit_amount numeric(18,2);
  pending_amount numeric(18,2);
  company_exposure numeric(18,2);
  company_ceiling numeric(18,2);
  shortfall numeric(18,2);
  release_value numeric(18,2):=0;
  is_self boolean;
  permission_code text;
  next_state text;
  clean_action text:=upper(btrim(COALESCE(p_action,'')));
  clean_option text:=upper(btrim(COALESCE(p_option_code,'')));
  clean_reason text:=btrim(COALESCE(p_reason,''));
  correlation uuid:=gen_random_uuid();
  decision_id uuid:=gen_random_uuid();
  reservation_id uuid:=gen_random_uuid();
  result_payload jsonb;
  escalation_type text;
  can_approve boolean:=false;
  can_override_ceiling boolean:=false;
  can_resolve_budget boolean:=false;
BEGIN
  IF clean_action NOT IN ('APPROVE','REJECT','RETURN','CANCEL')
    OR char_length(clean_reason) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The approval decision is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
  SELECT * INTO request_row FROM public.requests WHERE id=p_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'The request is unavailable'; END IF;

  is_self:=request_row.created_by=p_actor_user_id;
  permission_code:=CASE WHEN is_self THEN 'request.approve.self' ELSE 'request.approve.other' END;
  can_approve:=public.axora_snapshot_has_permission(
    snapshot,permission_code,
    CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
    request_row.company_id,request_row.branch_id,request_row.department_id,NULL
  );
  IF clean_action='CANCEL' AND is_self THEN can_approve:=true; END IF;
  IF NOT can_approve THEN RAISE EXCEPTION 'The request is unavailable'; END IF;

  SELECT decision.result INTO existing_result
  FROM public.request_approval_decisions decision
  WHERE decision.request_id=request_row.id
    AND decision.idempotency_key=p_idempotency_key;
  IF existing_result IS NOT NULL THEN RETURN existing_result; END IF;
  IF request_row.approval_revision<>p_expected_approval_revision THEN
    RAISE EXCEPTION 'The request changed before this decision was recorded';
  END IF;
  IF clean_action<>'CANCEL' AND request_row.approval_state NOT IN (
    'PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA'
  ) THEN RAISE EXCEPTION 'The request is no longer awaiting approval'; END IF;
  IF clean_action='CANCEL' AND request_row.approval_state IN (
    'REJECTED','CANCELLED','AWAITING_FULFILMENT'
  ) THEN RAISE EXCEPTION 'The request can no longer be cancelled'; END IF;

  SELECT * INTO approval_snapshot FROM public.request_approval_snapshots
  WHERE request_id=request_row.id AND request_version=request_row.request_version
  FOR KEY SHARE;
  IF approval_snapshot.id IS NULL THEN RAISE EXCEPTION 'The request snapshot is unavailable'; END IF;
  amount:=approval_snapshot.amount;
  limit_amount:=public.axora_approval_limit_for_request(
    snapshot,permission_code,request_row.company_id,request_row.branch_id,
    request_row.department_id,approval_snapshot.currency,is_self
  );
  IF clean_action<>'CANCEL' AND limit_amount IS NULL THEN
    RAISE EXCEPTION 'The approval authority is unavailable';
  END IF;

  SELECT COALESCE(sum(entry.pending_delta),0)::numeric(18,2)
  INTO pending_amount FROM public.budget_ledger_entries entry
  WHERE entry.request_id=request_row.id
    AND entry.request_version=request_row.request_version;

  IF clean_action IN ('REJECT','RETURN','CANCEL') THEN
    IF pending_amount>0 THEN
      PERFORM public.axora_post_budget_entry_internal(
        request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
        'PENDING_EXPOSURE_REMOVE',pending_amount,0,0,0,0,-pending_amount,0,0,
        request_row.id,request_row.request_version,NULL,NULL,'REQUEST',request_row.id,
        p_actor_user_id,p_actor_role_assignment_id,NULL,'APPROVAL_CLOSED',clean_reason,
        correlation,p_idempotency_key||'-pending-release',p_at
      );
    END IF;
    SELECT reservation.id INTO reservation_id
    FROM public.budget_reservations reservation
    WHERE reservation.request_id=request_row.id
      AND reservation.remaining_reserved>0
    FOR UPDATE;
    IF reservation_id IS NOT NULL THEN
      SELECT reservation.remaining_reserved INTO release_value
      FROM public.budget_reservations reservation WHERE reservation.id=reservation_id;
      PERFORM public.axora_post_budget_entry_internal(
        request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
        'RELEASE',release_value,0,release_value,-release_value,0,0,0,0,request_row.id,
        request_row.request_version,reservation_id,NULL,'REQUEST',request_row.id,
        p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_RELEASED',clean_reason,
        correlation,p_idempotency_key||'-reservation-release',p_at
      );
      UPDATE public.budget_reservations AS reservation SET remaining_reserved=0,
        released_amount=reservation.released_amount+release_value,
        status='RELEASED',updated_at=p_at
      WHERE reservation.id=reservation_id;
      INSERT INTO public.budget_reservation_events(
        reservation_id,company_id,event_type,amount,previous_status,new_status,
        actor_user_id,reason,correlation_id,idempotency_key,occurred_at
      ) VALUES (
        reservation_id,request_row.company_id,'RELEASED',release_value,'RESERVED','RELEASED',
        p_actor_user_id,clean_reason,correlation,p_idempotency_key||'-release-event',p_at
      );
    END IF;
    next_state:=CASE clean_action WHEN 'REJECT' THEN 'REJECTED'
      WHEN 'RETURN' THEN 'RETURNED' ELSE 'CANCELLED' END;
    result_payload:=jsonb_build_object(
      'decisionId',decision_id,'requestId',request_row.id,
      'requestVersion',request_row.request_version,
      'approvalRevision',request_row.approval_revision+1,'state',next_state,
      'action',clean_action,'releasedAmount',release_value::text,
      'correlationId',correlation
    );
    INSERT INTO public.request_approval_decisions(
      id,request_id,request_version,approval_revision_before,approval_revision_after,
      company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
      state_before,state_after,amount,currency,approval_limit,self_approval,option_code,
      reason,correlation_id,idempotency_key,result,decided_at
    ) VALUES (
      decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
      request_row.approval_revision+1,request_row.company_id,request_row.approval_policy_id,
      p_actor_user_id,p_actor_role_assignment_id,clean_action,request_row.approval_state,
      next_state,approval_snapshot.amount,approval_snapshot.currency,limit_amount,is_self,
      NULL,clean_reason,correlation,p_idempotency_key,result_payload,p_at
    );
    UPDATE public.requests SET approval_state=next_state,
      approval_revision=approval_revision+1,approval_decided_at=p_at,
      approval_last_correlation_id=correlation WHERE id=request_row.id;
    IF clean_action='REJECT' THEN
      INSERT INTO public.approvals(
        request_id,reviewer_id,approval_type,status,reason,decided_at
      ) SELECT request_row.id,p_actor_user_id,'Company approval','Rejected',clean_reason,p_at
      WHERE NOT EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request_row.id
          AND approval.approval_type='Company approval' AND approval.status='Rejected'
      );
    END IF;
    INSERT INTO public.request_approval_outbox(
      request_id,request_version,approval_revision,company_id,job_type,payload,
      idempotency_key,available_at
    ) VALUES (
      request_row.id,request_row.request_version,request_row.approval_revision+1,
      request_row.company_id,'DECISION_NOTIFICATION',result_payload,
      p_idempotency_key||'-notify',p_at
    );
    RETURN result_payload;
  END IF;

  IF amount>limit_amount THEN
    IF request_row.approval_state='PENDING_DEPARTMENT' THEN
      next_state:='PENDING_COMPANY';escalation_type:='APPROVAL_LIMIT';
    ELSE
      RAISE EXCEPTION 'The request exceeds the active approval limit';
    END IF;
  END IF;

  SELECT * INTO period_row FROM public.budget_periods
  WHERE id=request_row.budget_period_id AND budget_account_id=request_row.budget_account_id
    AND status='ACTIVE' AND starts_at<=p_at AND ends_at>p_at
  FOR UPDATE;
  IF period_row.id IS NULL THEN RAISE EXCEPTION 'The budget period is unavailable'; END IF;
  SELECT * INTO balance_row FROM public.v_budget_period_balances
  WHERE budget_period_id=period_row.id;
  SELECT company.contractual_ceiling INTO company_ceiling
  FROM public.companies company WHERE company.id=request_row.company_id FOR KEY SHARE;
  SELECT COALESCE(sum(company_balance.reserved+company_balance.spent),0)::numeric(18,2)
  INTO company_exposure
  FROM public.v_budget_period_balances company_balance
  JOIN public.budget_periods company_period ON company_period.id=company_balance.budget_period_id
  WHERE company_balance.company_id=request_row.company_id AND company_period.status='ACTIVE';
  can_override_ceiling:=public.axora_snapshot_has_permission(
    snapshot,'commercial.company_ceiling.override','COMPANY',request_row.company_id,NULL,NULL,NULL
  );
  can_resolve_budget:=public.axora_snapshot_has_permission(
    snapshot,'request.approve.over_budget',
    CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
    request_row.company_id,request_row.branch_id,request_row.department_id,NULL
  );

  IF next_state IS NULL AND company_exposure+amount>company_ceiling
    AND NOT can_override_ceiling THEN
    next_state:='PENDING_AXORA';escalation_type:='COMPANY_CEILING';
  END IF;
  shortfall:=greatest(amount-COALESCE(balance_row.available,0),0);
  IF next_state IS NULL AND shortfall>0 THEN
    IF can_resolve_budget AND clean_option IN ('ONE_TIME_EXCEPTION','TEMPORARY_PERIOD_INCREASE') THEN
      PERFORM public.axora_adjust_budget_allocation(
        p_actor_user_id,p_actor_role_assignment_id,request_row.budget_account_id,
        'INCREASE',shortfall,false,clean_reason,
        p_idempotency_key||'-budget-increase',p_at
      );
    ELSIF can_resolve_budget AND clean_option='TRANSFER_RESERVE'
      AND p_source_budget_account_id IS NOT NULL THEN
      PERFORM public.axora_transfer_budget_allocation(
        p_actor_user_id,p_actor_role_assignment_id,p_source_budget_account_id,
        request_row.budget_account_id,shortfall,false,clean_reason,
        p_idempotency_key||'-budget-transfer',p_at
      );
    ELSE
      next_state:=CASE WHEN request_row.approval_state='PENDING_AXORA'
        THEN 'PENDING_AXORA' ELSE 'PENDING_COMPANY' END;
      escalation_type:='BUDGET_AVAILABLE';
    END IF;
  END IF;

  IF next_state IS NOT NULL THEN
    result_payload:=jsonb_build_object(
      'decisionId',decision_id,'requestId',request_row.id,
      'requestVersion',request_row.request_version,
      'approvalRevision',request_row.approval_revision+1,'state',next_state,
      'action','ESCALATE','escalationType',escalation_type,
      'amount',amount::text,'available',COALESCE(balance_row.available,0)::text,
      'approvalLimit',limit_amount::text,'companyCeiling',company_ceiling::text,
      'correlationId',correlation
    );
    INSERT INTO public.request_approval_decisions(
      id,request_id,request_version,approval_revision_before,approval_revision_after,
      company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
      state_before,state_after,amount,currency,approval_limit,self_approval,option_code,
      reason,correlation_id,idempotency_key,result,decided_at
    ) VALUES (
      decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
      request_row.approval_revision+1,request_row.company_id,request_row.approval_policy_id,
      p_actor_user_id,p_actor_role_assignment_id,'ESCALATE',request_row.approval_state,
      next_state,amount,approval_snapshot.currency,limit_amount,is_self,NULL,clean_reason,
      correlation,p_idempotency_key,result_payload,p_at
    );
    INSERT INTO public.request_approval_escalations(
      request_id,request_version,decision_id,company_id,escalation_type,target_state,
      amount,available_amount,threshold_amount,reason,correlation_id,created_at
    ) VALUES (
      request_row.id,request_row.request_version,decision_id,request_row.company_id,
      escalation_type,next_state,amount,COALESCE(balance_row.available,0),
      CASE escalation_type WHEN 'APPROVAL_LIMIT' THEN limit_amount
        WHEN 'COMPANY_CEILING' THEN company_ceiling ELSE COALESCE(balance_row.available,0) END,
      clean_reason,correlation,p_at
    );
    UPDATE public.requests SET approval_state=next_state,
      approval_revision=approval_revision+1,approval_last_correlation_id=correlation
    WHERE id=request_row.id;
    INSERT INTO public.request_approval_outbox(
      request_id,request_version,approval_revision,company_id,job_type,payload,
      idempotency_key,available_at
    ) VALUES (
      request_row.id,request_row.request_version,request_row.approval_revision+1,
      request_row.company_id,'ESCALATION_NOTIFICATION',result_payload,
      p_idempotency_key||'-notify',p_at
    );
    RETURN result_payload;
  END IF;

  SELECT COALESCE(balance.available,0)::numeric(18,2) INTO shortfall
  FROM public.v_budget_period_balances balance
  WHERE balance.budget_period_id=request_row.budget_period_id;
  IF shortfall<amount THEN RAISE EXCEPTION 'The budget changed before approval completed'; END IF;

  result_payload:=jsonb_build_object(
    'decisionId',decision_id,'reservationId',reservation_id,'requestId',request_row.id,
    'requestVersion',request_row.request_version,
    'approvalRevision',request_row.approval_revision+1,'state','APPROVED',
    'action','APPROVE','amount',amount::text,'currency',approval_snapshot.currency,
    'correlationId',correlation
  );
  INSERT INTO public.request_approval_decisions(
    id,request_id,request_version,approval_revision_before,approval_revision_after,
    company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
    state_before,state_after,amount,currency,approval_limit,self_approval,option_code,
    reason,correlation_id,idempotency_key,result,decided_at
  ) VALUES (
    decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
    request_row.approval_revision+1,request_row.company_id,request_row.approval_policy_id,
    p_actor_user_id,p_actor_role_assignment_id,'APPROVE',request_row.approval_state,
    'APPROVED',amount,approval_snapshot.currency,limit_amount,is_self,
    NULLIF(clean_option,''),clean_reason,correlation,p_idempotency_key,result_payload,p_at
  );
  INSERT INTO public.budget_reservations(
    id,company_id,budget_account_id,budget_period_id,request_id,request_version,
    currency,reserved_amount,remaining_reserved,status,approval_decision_id,
    correlation_id,created_by,created_at,updated_at
  ) VALUES (
    reservation_id,request_row.company_id,request_row.budget_account_id,
    request_row.budget_period_id,request_row.id,request_row.request_version,
    approval_snapshot.currency,amount,amount,'RESERVED',decision_id,correlation,
    p_actor_user_id,p_at,p_at
  );
  INSERT INTO public.budget_reservation_events(
    reservation_id,company_id,event_type,amount,new_status,actor_user_id,reason,
    correlation_id,idempotency_key,occurred_at
  ) VALUES (
    reservation_id,request_row.company_id,'CREATED',amount,'RESERVED',p_actor_user_id,
    clean_reason,correlation,p_idempotency_key||'-reservation-event',p_at
  );
  PERFORM public.axora_post_budget_entry_internal(
    request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
    'RESERVATION',amount,0,-amount,amount,0,0,0,0,request_row.id,
    request_row.request_version,reservation_id,NULL,'REQUEST',request_row.id,
    p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_APPROVED',clean_reason,
    correlation,p_idempotency_key||'-reservation',p_at
  );
  IF pending_amount>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
      'PENDING_EXPOSURE_REMOVE',pending_amount,0,0,0,0,-pending_amount,0,0,
      request_row.id,request_row.request_version,reservation_id,NULL,'REQUEST',request_row.id,
      p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_APPROVED',clean_reason,
      correlation,p_idempotency_key||'-pending-release',p_at
    );
  END IF;
  UPDATE public.requests SET approval_state='APPROVED',
    approval_revision=approval_revision+1,approval_decided_at=p_at,
    approval_last_correlation_id=correlation WHERE id=request_row.id;
  INSERT INTO public.approvals(
    request_id,reviewer_id,approval_type,status,reason,decided_at
  ) SELECT request_row.id,p_actor_user_id,'Company approval','Approved',clean_reason,p_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.approvals approval
    WHERE approval.request_id=request_row.id
      AND approval.approval_type='Company approval' AND approval.status='Approved'
  );
  INSERT INTO public.request_approval_outbox(
    request_id,request_version,approval_revision,company_id,job_type,payload,
    idempotency_key,available_at
  )
  SELECT request_row.id,request_row.request_version,request_row.approval_revision+1,
    request_row.company_id,job.job_type,result_payload,
    p_idempotency_key||job.suffix,p_at
  FROM (VALUES
    ('FULFILMENT_CREATE','-fulfilment'),
    ('APPROVAL_NOTIFICATION','-notify'),
    ('REQUEST_PDF','-pdf')
  ) AS job(job_type,suffix);
  RETURN result_payload;
END $$;

CREATE OR REPLACE FUNCTION public.axora_finalize_request_budget(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_actual_amount numeric,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  request_row public.requests%ROWTYPE;
  reservation_row public.budget_reservations%ROWTYPE;
  balance_row record;
  extra_amount numeric(18,2);
  release_amount numeric(18,2);
  approval_limit numeric(18,2);
  company_exposure numeric(18,2);
  company_ceiling numeric(18,2);
  correlation uuid:=gen_random_uuid();
  decision_id uuid:=gen_random_uuid();
  clean_reason text:=btrim(COALESCE(p_reason,''));
  result_payload jsonb;
BEGIN
  IF p_actual_amount<0 OR char_length(clean_reason) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The final amount is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request_row FROM public.requests WHERE id=p_request_id FOR UPDATE;
  IF snapshot IS NULL OR request_row.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'request.approve.other',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    ) THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
  SELECT decision.result INTO result_payload
  FROM public.request_approval_decisions decision
  WHERE decision.request_id=request_row.id AND decision.idempotency_key=p_idempotency_key;
  IF result_payload IS NOT NULL THEN RETURN result_payload; END IF;
  SELECT * INTO reservation_row FROM public.budget_reservations
  WHERE request_id=request_row.id AND status IN ('RESERVED','PARTIALLY_SPENT')
  FOR UPDATE;
  IF reservation_row.id IS NULL THEN RAISE EXCEPTION 'The active reservation is unavailable'; END IF;
  PERFORM 1 FROM public.budget_periods
  WHERE id=reservation_row.budget_period_id FOR UPDATE;
  extra_amount:=greatest(p_actual_amount-reservation_row.remaining_reserved,0);
  release_amount:=greatest(reservation_row.remaining_reserved-p_actual_amount,0);
  IF extra_amount>0 THEN
    approval_limit:=public.axora_approval_limit_for_request(
      snapshot,'request.approve.additional_actual',request_row.company_id,
      request_row.branch_id,request_row.department_id,reservation_row.currency,false
    );
    SELECT * INTO balance_row FROM public.v_budget_period_balances
    WHERE budget_period_id=reservation_row.budget_period_id;
    SELECT company.contractual_ceiling INTO company_ceiling
    FROM public.companies company WHERE company.id=request_row.company_id FOR KEY SHARE;
    SELECT COALESCE(sum(company_balance.reserved+company_balance.spent),0)::numeric(18,2)
    INTO company_exposure
    FROM public.v_budget_period_balances company_balance
    JOIN public.budget_periods company_period
      ON company_period.id=company_balance.budget_period_id
     AND company_period.status='ACTIVE'
    WHERE company_balance.company_id=request_row.company_id;
    IF approval_limit IS NULL OR approval_limit<p_actual_amount
      OR COALESCE(balance_row.available,0)<extra_amount
      OR company_exposure+extra_amount>company_ceiling
      OR NOT public.axora_snapshot_has_permission(
        snapshot,'request.approve.additional_actual',
        CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
        request_row.company_id,request_row.branch_id,request_row.department_id,NULL
      ) THEN
      result_payload:=jsonb_build_object(
        'decisionId',decision_id,'requestId',request_row.id,
        'requestVersion',request_row.request_version,
        'approvalRevision',request_row.approval_revision+1,
        'state','PENDING_COMPANY','action','ADDITIONAL_ACTUAL_REQUIRED',
        'actualAmount',p_actual_amount::text,'additionalAmount',extra_amount::text,
        'correlationId',correlation
      );
      INSERT INTO public.request_approval_decisions(
        id,request_id,request_version,approval_revision_before,approval_revision_after,
        company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
        state_before,state_after,amount,currency,approval_limit,self_approval,
        reason,correlation_id,idempotency_key,result,decided_at
      ) VALUES (
        decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
        request_row.approval_revision+1,request_row.company_id,request_row.approval_policy_id,
        p_actor_user_id,p_actor_role_assignment_id,'ADDITIONAL_ACTUAL_REQUIRED',
        request_row.approval_state,'PENDING_COMPANY',p_actual_amount,
        reservation_row.currency,approval_limit,false,clean_reason,correlation,
        p_idempotency_key,result_payload,p_at
      );
      INSERT INTO public.request_approval_escalations(
        request_id,request_version,decision_id,company_id,escalation_type,target_state,
        amount,available_amount,threshold_amount,reason,correlation_id,created_at
      ) VALUES (
        request_row.id,request_row.request_version,decision_id,request_row.company_id,
        'ADDITIONAL_ACTUAL','PENDING_COMPANY',p_actual_amount,
        COALESCE(balance_row.available,0),approval_limit,clean_reason,correlation,p_at
      );
      UPDATE public.budget_reservations SET status='ADDITIONAL_APPROVAL_REQUIRED',
        updated_at=p_at WHERE id=reservation_row.id;
      UPDATE public.requests SET approval_state='PENDING_COMPANY',
        approval_revision=approval_revision+1,approval_last_correlation_id=correlation
      WHERE id=request_row.id;
      RETURN result_payload;
    END IF;
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,reservation_row.budget_account_id,
      reservation_row.budget_period_id,'RESERVATION_INCREASE',extra_amount,
      0,-extra_amount,extra_amount,0,0,0,0,request_row.id,request_row.request_version,
      reservation_row.id,NULL,'REQUEST',request_row.id,p_actor_user_id,
      p_actor_role_assignment_id,NULL,'ADDITIONAL_ACTUAL_APPROVED',clean_reason,
      correlation,p_idempotency_key||'-increase',p_at
    );
    UPDATE public.budget_reservations SET reserved_amount=reserved_amount+extra_amount,
      remaining_reserved=remaining_reserved+extra_amount,updated_at=p_at
    WHERE id=reservation_row.id;
  END IF;
  IF p_actual_amount>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,reservation_row.budget_account_id,
      reservation_row.budget_period_id,'FINAL_SPEND',p_actual_amount,
      0,0,-p_actual_amount,p_actual_amount,0,0,0,request_row.id,
      request_row.request_version,reservation_row.id,NULL,'REQUEST',request_row.id,
      p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_FINAL_SPEND',clean_reason,
      correlation,p_idempotency_key||'-spend',p_at
    );
  END IF;
  IF release_amount>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,reservation_row.budget_account_id,
      reservation_row.budget_period_id,'RELEASE',release_amount,
      0,release_amount,-release_amount,0,0,0,0,request_row.id,
      request_row.request_version,reservation_row.id,NULL,'REQUEST',request_row.id,
      p_actor_user_id,p_actor_role_assignment_id,NULL,'LOWER_ACTUAL_RELEASE',clean_reason,
      correlation,p_idempotency_key||'-release',p_at
    );
  END IF;
  UPDATE public.budget_reservations SET
    remaining_reserved=0,spent_amount=spent_amount+p_actual_amount,
    released_amount=released_amount+release_amount,
    status=CASE WHEN release_amount>0 THEN 'PARTIALLY_RELEASED' ELSE 'SPENT' END,
    updated_at=p_at
  WHERE id=reservation_row.id;
  INSERT INTO public.budget_reservation_events(
    reservation_id,company_id,event_type,amount,previous_status,new_status,
    actor_user_id,reason,correlation_id,idempotency_key,occurred_at
  ) VALUES (
    reservation_row.id,request_row.company_id,'FINALIZED',p_actual_amount,
    reservation_row.status,CASE WHEN release_amount>0 THEN 'PARTIALLY_RELEASED' ELSE 'SPENT' END,
    p_actor_user_id,clean_reason,correlation,p_idempotency_key||'-event',p_at
  );
  result_payload:=jsonb_build_object(
    'decisionId',decision_id,'requestId',request_row.id,
    'requestVersion',request_row.request_version,
    'approvalRevision',request_row.approval_revision+1,
    'state','AWAITING_FULFILMENT','action','FINALIZE',
    'actualAmount',p_actual_amount::text,'releasedAmount',release_amount::text,
    'additionalAmount',extra_amount::text,'correlationId',correlation
  );
  INSERT INTO public.request_approval_decisions(
    id,request_id,request_version,approval_revision_before,approval_revision_after,
    company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
    state_before,state_after,amount,currency,approval_limit,self_approval,
    reason,correlation_id,idempotency_key,result,decided_at
  ) VALUES (
    decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
    request_row.approval_revision+1,request_row.company_id,request_row.approval_policy_id,
    p_actor_user_id,p_actor_role_assignment_id,'FINALIZE',request_row.approval_state,
    'AWAITING_FULFILMENT',p_actual_amount,reservation_row.currency,approval_limit,false,
    clean_reason,correlation,p_idempotency_key,result_payload,p_at
  );
  UPDATE public.requests SET approval_state='AWAITING_FULFILMENT',
    approval_revision=approval_revision+1,approval_last_correlation_id=correlation
  WHERE id=request_row.id;
  RETURN result_payload;
END $$;

CREATE OR REPLACE FUNCTION public.axora_request_approval_timeline(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  access_row record;
BEGIN
  SELECT * INTO access_row FROM public.axora_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,'request.view',p_request_id,p_at
  );
  IF access_row IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'requestId',p_request_id,
    'events',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',decision.id,'action',decision.action,'stateBefore',decision.state_before,
      'stateAfter',decision.state_after,'amount',decision.amount::text,
      'currency',decision.currency,'reason',decision.reason,
      'actorUserId',decision.actor_user_id,'selfApproval',decision.self_approval,
      'optionCode',decision.option_code,'correlationId',decision.correlation_id,
      'decidedAt',decision.decided_at
    )) ORDER BY decision.decided_at,decision.id)
      FROM public.request_approval_decisions decision
      WHERE decision.request_id=p_request_id),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_protect_request_approval_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approval evidence is append-only'; END IF;
  IF TG_TABLE_NAME='request_approval_policies'
    AND to_jsonb(OLD)-'status'-'retired_at' = to_jsonb(NEW)-'status'-'retired_at'
    AND OLD.status='ACTIVE' AND NEW.status='RETIRED' AND NEW.retired_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Approval evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_require_versioned_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.approval_type='Company approval'
    AND NEW.status IN ('Approved','Rejected')
    AND session_user='axora_app'
    AND NOT EXISTS (
      SELECT 1 FROM public.request_approval_decisions decision
      WHERE decision.request_id=NEW.request_id
        AND decision.actor_user_id=NEW.reviewer_id
        AND decision.decided_at=NEW.decided_at
        AND decision.action=CASE NEW.status
          WHEN 'Approved' THEN 'APPROVE' ELSE 'REJECT' END
    ) THEN
    RAISE EXCEPTION 'A versioned approval decision is required';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER require_versioned_company_approval
BEFORE INSERT ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.axora_require_versioned_approval_decision();

CREATE TRIGGER request_approval_policies_immutable
BEFORE UPDATE OR DELETE ON public.request_approval_policies
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_request_approval_evidence();
CREATE TRIGGER request_approval_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.request_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_request_approval_evidence();
CREATE TRIGGER request_approval_decisions_immutable
BEFORE UPDATE OR DELETE ON public.request_approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_request_approval_evidence();
CREATE TRIGGER request_approval_escalations_immutable
BEFORE UPDATE OR DELETE ON public.request_approval_escalations
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_request_approval_evidence();

INSERT INTO public.request_approval_snapshots(
  request_id,request_version,company_id,policy_id,policy_version,amount,currency,
  snapshot,snapshot_hash,created_at
)
SELECT request.id,request.request_version,request.company_id,policy.id,
  policy.policy_version,total.amount,request.currency,payload.snapshot,
  encode(sha256(convert_to(payload.snapshot::text,'UTF8')),'hex'),request.created_at
FROM public.requests request
JOIN public.request_approval_policies policy ON policy.id=request.approval_policy_id
CROSS JOIN LATERAL (
  SELECT public.axora_request_total_internal(request.id)::numeric(18,2) AS amount
) total
CROSS JOIN LATERAL (
  SELECT public.axora_request_snapshot_payload_internal(
    request.id,policy.policy_version,total.amount,request.currency
  ) AS snapshot
) payload;

INSERT INTO public.request_approval_decisions(
  request_id,request_version,approval_revision_before,approval_revision_after,
  company_id,policy_id,system_job,action,state_before,state_after,amount,currency,
  self_approval,reason,correlation_id,idempotency_key,result,decided_at
)
SELECT request.id,request.request_version,request.approval_revision,
  request.approval_revision,request.company_id,request.approval_policy_id,
  'MIGRATION_057','BACKFILL',request.approval_state,request.approval_state,
  approval_snapshot.amount,approval_snapshot.currency,false,
  'Opening approval state migrated from the existing request workflow.',
  gen_random_uuid(),'migration-057-request-'||request.id::text,
  jsonb_build_object(
    'requestId',request.id,'requestVersion',request.request_version,
    'approvalRevision',request.approval_revision,'state',request.approval_state,
    'migrated',true
  ),COALESCE(request.approval_decided_at,request.approval_submitted_at,request.created_at)
FROM public.requests request
JOIN public.request_approval_snapshots approval_snapshot
  ON approval_snapshot.request_id=request.id
 AND approval_snapshot.request_version=request.request_version;

REVOKE ALL ON TABLE public.request_approval_policies,
  public.request_approval_snapshots,public.request_approval_decisions,
  public.request_approval_escalations,public.request_approval_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_total_internal(uuid),
  public.axora_request_snapshot_payload_internal(uuid,integer,numeric,text),
  public.axora_approval_limit_for_request(jsonb,text,uuid,uuid,uuid,text,boolean),
  public.axora_seed_company_approval_policy(),
  public.axora_resolve_request_budget_defaults(),
  public.axora_require_versioned_approval_decision(),
  public.axora_protect_request_approval_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_budget_choices(uuid,uuid,timestamptz),
  public.axora_initialize_request_approval(uuid,uuid,uuid,text,timestamptz),
  public.axora_request_approval_workspace(uuid,uuid,timestamptz),
  public.axora_decide_request_approval(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz),
  public.axora_finalize_request_budget(uuid,uuid,uuid,numeric,text,text,timestamptz),
  public.axora_request_approval_timeline(uuid,uuid,uuid,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.request_approval_policies,
      public.request_approval_snapshots,public.request_approval_decisions,
      public.request_approval_escalations,public.request_approval_outbox FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_request_budget_choices(uuid,uuid,timestamptz),
      public.axora_initialize_request_approval(uuid,uuid,uuid,text,timestamptz),
      public.axora_request_approval_workspace(uuid,uuid,timestamptz),
      public.axora_decide_request_approval(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz),
      public.axora_finalize_request_budget(uuid,uuid,uuid,numeric,text,text,timestamptz),
      public.axora_request_approval_timeline(uuid,uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
