BEGIN;

-- P0-07: budgets are authorization ledgers, never mutable cash balances.
-- Existing monthly branch values are retained only as a compatibility input
-- and projection while current production data is migrated forward.
ALTER TABLE public.companies
  ADD COLUMN contractual_ceiling numeric(18,2),
  ADD COLUMN ceiling_currency text NOT NULL DEFAULT 'MYR',
  ADD CONSTRAINT companies_contractual_ceiling_check CHECK (
    contractual_ceiling IS NULL OR contractual_ceiling>=0
  ),
  ADD CONSTRAINT companies_ceiling_currency_check CHECK (
    ceiling_currency ~ '^[A-Z]{3}$'
  );

WITH active_commitments AS (
  SELECT request.branch_id,
    COALESCE(sum(
      COALESCE((
        SELECT sum(round(line.quantity*line.unit_sell_price,2))
        FROM public.request_lines line
        WHERE line.request_id=request.id
      ),0)+request.estimated_delivery_fee+request.tax_amount
    ),0)::numeric(18,2) AS amount
  FROM public.requests request
  JOIN public.lookup_values status ON status.id=request.status_id
  WHERE status.label NOT IN ('Cancelled','Completed')
    AND EXISTS (
      SELECT 1 FROM public.approvals approval
      WHERE approval.request_id=request.id
        AND approval.approval_type='Company approval'
        AND approval.status='Approved'
    )
  GROUP BY request.branch_id
), company_requirements AS (
  SELECT branch.company_id,
    COALESCE(sum(greatest(
      COALESCE(branch.monthly_budget,0),
      COALESCE(commitment.amount,0)
    )),0)::numeric(18,2) AS amount
  FROM public.branches branch
  LEFT JOIN active_commitments commitment ON commitment.branch_id=branch.id
  GROUP BY branch.company_id
)
UPDATE public.companies company
SET contractual_ceiling=COALESCE(requirement.amount,0)
FROM company_requirements requirement
WHERE requirement.company_id=company.id;
UPDATE public.companies
SET contractual_ceiling=0
WHERE contractual_ceiling IS NULL;
ALTER TABLE public.companies
  ALTER COLUMN contractual_ceiling SET NOT NULL,
  ALTER COLUMN contractual_ceiling SET DEFAULT 0;

CREATE TABLE public.company_ceiling_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  previous_amount numeric(18,2) NOT NULL CHECK (previous_amount>=0),
  new_amount numeric(18,2) NOT NULL CHECK (new_amount>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) BETWEEN 3 AND 1000),
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_by_role_assignment_id uuid REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,idempotency_key)
);
INSERT INTO public.company_ceiling_history(
  company_id,previous_amount,new_amount,currency,reason_code,explanation,
  correlation_id,idempotency_key
)
SELECT company.id,0,company.contractual_ceiling,company.ceiling_currency,
  'MIGRATION_OPENING','Opening contractual ceiling derived from current branch authorizations and active commitments.',
  gen_random_uuid(),'migration-056-opening-'||company.id::text
FROM public.companies company;

CREATE TABLE public.budget_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  parent_account_id uuid,
  level_type text NOT NULL CHECK (
    level_type IN ('COMPANY','BRANCH','DEPARTMENT','COST_CENTRE')
  ),
  branch_id uuid,
  department_id uuid,
  cost_centre_id uuid,
  account_code text NOT NULL CHECK (
    account_code ~ '^[A-Z0-9][A-Z0-9_-]{1,79}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  currency text NOT NULL DEFAULT 'MYR' CHECK (currency ~ '^[A-Z]{3}$'),
  recurring_allocation numeric(18,2) NOT NULL DEFAULT 0 CHECK (recurring_allocation>=0),
  refresh_interval text NOT NULL DEFAULT 'MONTHLY' CHECK (
    refresh_interval IN ('MONTHLY','QUARTERLY','ANNUAL','MANUAL')
  ),
  period_timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur' CHECK (
    period_timezone='UTC'
    OR period_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  rollover_policy text NOT NULL DEFAULT 'NONE' CHECK (
    rollover_policy IN ('NONE','FULL','CAPPED')
  ),
  rollover_cap numeric(18,2) CHECK (rollover_cap IS NULL OR rollover_cap>=0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),
  UNIQUE(company_id,account_code),
  FOREIGN KEY(parent_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(cost_centre_id,company_id)
    REFERENCES public.cost_centres(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (level_type='COMPANY' AND branch_id IS NULL AND department_id IS NULL AND cost_centre_id IS NULL)
    OR (level_type='BRANCH' AND branch_id IS NOT NULL AND department_id IS NULL AND cost_centre_id IS NULL)
    OR (level_type='DEPARTMENT' AND department_id IS NOT NULL AND cost_centre_id IS NULL)
    OR (level_type='COST_CENTRE' AND cost_centre_id IS NOT NULL)
  ),
  CHECK (
    (rollover_policy='CAPPED' AND rollover_cap IS NOT NULL)
    OR (rollover_policy<>'CAPPED' AND rollover_cap IS NULL)
  )
);
CREATE INDEX budget_accounts_scope_idx
  ON public.budget_accounts(company_id,level_type,branch_id,department_id,cost_centre_id,active);

CREATE OR REPLACE FUNCTION public.axora_validate_budget_account_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_branch uuid;
  linked_department uuid;
BEGIN
  IF NEW.level_type='DEPARTMENT' THEN
    SELECT department.branch_id INTO linked_branch
    FROM public.departments department
    WHERE department.id=NEW.department_id
      AND department.company_id=NEW.company_id;
    IF NOT FOUND OR (NEW.branch_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM linked_branch) THEN
      RAISE EXCEPTION 'The budget account scope is invalid';
    END IF;
    NEW.branch_id:=linked_branch;
  ELSIF NEW.level_type='COST_CENTRE' THEN
    SELECT centre.branch_id,centre.department_id
      INTO linked_branch,linked_department
    FROM public.cost_centres centre
    WHERE centre.id=NEW.cost_centre_id
      AND centre.company_id=NEW.company_id;
    IF NOT FOUND
      OR (NEW.branch_id IS NOT NULL AND linked_branch IS NOT NULL AND NEW.branch_id<>linked_branch)
      OR (NEW.department_id IS NOT NULL AND linked_department IS NOT NULL AND NEW.department_id<>linked_department) THEN
      RAISE EXCEPTION 'The budget account scope is invalid';
    END IF;
    NEW.branch_id:=COALESCE(linked_branch,NEW.branch_id);
    NEW.department_id:=COALESCE(linked_department,NEW.department_id);
  END IF;

  IF NEW.parent_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_accounts parent
    WHERE parent.id=NEW.parent_account_id
      AND parent.company_id=NEW.company_id
      AND parent.currency=NEW.currency
      AND parent.active
  ) THEN
    RAISE EXCEPTION 'The parent budget account is unavailable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_budget_account_scope
BEFORE INSERT OR UPDATE OF company_id,parent_account_id,level_type,branch_id,
  department_id,cost_centre_id,currency
ON public.budget_accounts
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_budget_account_scope();

CREATE TABLE public.budget_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  previous_period_id uuid,
  period_name text NOT NULL CHECK (char_length(btrim(period_name)) BETWEEN 2 AND 160),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  allocation_method text NOT NULL CHECK (
    allocation_method IN ('MIGRATION','MANUAL','REFRESH','TOP_UP','CORRECTION')
  ),
  rollover_policy text NOT NULL CHECK (rollover_policy IN ('NONE','FULL','CAPPED')),
  rollover_cap numeric(18,2) CHECK (rollover_cap IS NULL OR rollover_cap>=0),
  status text NOT NULL CHECK (
    status IN ('SCHEDULED','ACTIVE','CLOSED','FAILED','CORRECTED')
  ),
  refresh_due_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,budget_account_id),
  UNIQUE(budget_account_id,starts_at),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(previous_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT,
  CHECK (ends_at>starts_at),
  CHECK (refresh_due_at=ends_at),
  CHECK ((status='CLOSED' AND closed_at IS NOT NULL) OR status<>'CLOSED'),
  CHECK (
    (rollover_policy='CAPPED' AND rollover_cap IS NOT NULL)
    OR (rollover_policy<>'CAPPED' AND rollover_cap IS NULL)
  )
);
CREATE UNIQUE INDEX budget_periods_one_active_uq
  ON public.budget_periods(budget_account_id) WHERE status='ACTIVE';
CREATE INDEX budget_periods_company_range_idx
  ON public.budget_periods(company_id,starts_at DESC,ends_at DESC);

CREATE TABLE public.budget_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  budget_period_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN (
    'INITIAL_ALLOCATION','ALLOCATION_INCREASE','ALLOCATION_DECREASE',
    'PERIOD_REFRESH','ROLLOVER_IN','EXPIRY_ADJUSTMENT',
    'PENDING_EXPOSURE_ADD','PENDING_EXPOSURE_REMOVE',
    'RESERVATION','RESERVATION_INCREASE','RESERVATION_REDUCTION',
    'FINAL_SPEND','DIRECT_SPEND','RELEASE','MANUAL_CORRECTION',
    'TRANSFER_IN','TRANSFER_OUT'
  )),
  amount numeric(18,2) NOT NULL CHECK (amount>0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  allocation_delta numeric(18,2) NOT NULL DEFAULT 0,
  available_delta numeric(18,2) NOT NULL DEFAULT 0,
  reserved_delta numeric(18,2) NOT NULL DEFAULT 0,
  spent_delta numeric(18,2) NOT NULL DEFAULT 0,
  pending_delta numeric(18,2) NOT NULL DEFAULT 0,
  rollover_delta numeric(18,2) NOT NULL DEFAULT 0,
  expired_delta numeric(18,2) NOT NULL DEFAULT 0,
  allocated_before numeric(18,2) NOT NULL,
  allocated_after numeric(18,2) NOT NULL,
  available_before numeric(18,2) NOT NULL,
  available_after numeric(18,2) NOT NULL,
  reserved_before numeric(18,2) NOT NULL,
  reserved_after numeric(18,2) NOT NULL,
  spent_before numeric(18,2) NOT NULL,
  spent_after numeric(18,2) NOT NULL,
  pending_before numeric(18,2) NOT NULL,
  pending_after numeric(18,2) NOT NULL,
  request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer,
  reservation_id uuid,
  transfer_group_id uuid,
  reference_type text,
  reference_id uuid,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  system_job text,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  posted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(budget_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT,
  UNIQUE(budget_period_id,idempotency_key),
  CHECK (request_version IS NULL OR request_version>0),
  CHECK (actor_user_id IS NOT NULL OR system_job IS NOT NULL),
  CHECK (
    allocation_delta<>0 OR available_delta<>0 OR reserved_delta<>0
    OR spent_delta<>0 OR pending_delta<>0 OR rollover_delta<>0
    OR expired_delta<>0
  )
);
CREATE INDEX budget_ledger_period_posted_idx
  ON public.budget_ledger_entries(budget_period_id,posted_at,id);
CREATE INDEX budget_ledger_request_idx
  ON public.budget_ledger_entries(request_id,request_version,posted_at);
CREATE INDEX budget_ledger_correlation_idx
  ON public.budget_ledger_entries(correlation_id);

CREATE OR REPLACE VIEW public.v_budget_period_balances AS
SELECT period.id AS budget_period_id,period.company_id,period.budget_account_id,
  period.period_name,period.starts_at,period.ends_at,period.timezone,
  period.status,period.refresh_due_at,
  COALESCE(sum(entry.allocation_delta),0)::numeric(18,2) AS allocated,
  COALESCE(sum(entry.reserved_delta),0)::numeric(18,2) AS reserved,
  COALESCE(sum(entry.spent_delta),0)::numeric(18,2) AS spent,
  COALESCE(sum(entry.pending_delta),0)::numeric(18,2) AS pending_approval,
  COALESCE(sum(entry.available_delta),0)::numeric(18,2) AS available,
  COALESCE(sum(entry.rollover_delta),0)::numeric(18,2) AS rollover_brought_forward,
  COALESCE(sum(entry.expired_delta),0)::numeric(18,2) AS expired_amount
FROM public.budget_periods period
LEFT JOIN public.budget_ledger_entries entry
  ON entry.budget_period_id=period.id
GROUP BY period.id;

CREATE TABLE public.budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  budget_period_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reserved_amount numeric(18,2) NOT NULL CHECK (reserved_amount>=0),
  remaining_reserved numeric(18,2) NOT NULL CHECK (remaining_reserved>=0),
  spent_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (spent_amount>=0),
  released_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (released_amount>=0),
  status text NOT NULL CHECK (status IN (
    'RESERVED','PARTIALLY_SPENT','SPENT','PARTIALLY_RELEASED','RELEASED',
    'ADDITIONAL_APPROVAL_REQUIRED'
  )),
  approval_decision_id uuid,
  correlation_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(budget_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT,
  UNIQUE(request_id,request_version),
  CHECK (reserved_amount=remaining_reserved+spent_amount+released_amount)
);
ALTER TABLE public.budget_ledger_entries
  ADD CONSTRAINT budget_ledger_reservation_fk
  FOREIGN KEY(reservation_id) REFERENCES public.budget_reservations(id) ON DELETE RESTRICT;

CREATE TABLE public.budget_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.budget_reservations(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED','INCREASED','REDUCED','FINALIZED','RELEASED',
    'ADDITIONAL_APPROVAL_REQUIRED'
  )),
  amount numeric(18,2) NOT NULL CHECK (amount>=0),
  previous_status text,
  new_status text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  system_job text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reservation_id,idempotency_key),
  CHECK (actor_user_id IS NOT NULL OR system_job IS NOT NULL)
);

ALTER TABLE public.requests
  ADD COLUMN request_version integer NOT NULL DEFAULT 1 CHECK (request_version>0),
  ADD COLUMN currency text NOT NULL DEFAULT 'MYR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN budget_account_id uuid,
  ADD COLUMN budget_period_id uuid;

CREATE OR REPLACE FUNCTION public.axora_budget_scope_type(
  p_level_type text,p_department_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_level_type='COMPANY' THEN 'COMPANY'::text
    WHEN p_department_id IS NOT NULL THEN 'DEPARTMENT'::text
    ELSE 'BRANCH'::text
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_budget_account_permission(
  p_snapshot jsonb,p_permission text,p_level_type text,p_company_id uuid,
  p_branch_id uuid,p_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.axora_snapshot_has_permission(
    p_snapshot,p_permission,
    public.axora_budget_scope_type(p_level_type,p_department_id),
    p_company_id,p_branch_id,p_department_id,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_post_budget_entry_internal(
  p_company_id uuid,
  p_budget_account_id uuid,
  p_budget_period_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_allocation_delta numeric,
  p_available_delta numeric,
  p_reserved_delta numeric,
  p_spent_delta numeric,
  p_pending_delta numeric,
  p_rollover_delta numeric,
  p_expired_delta numeric,
  p_request_id uuid,
  p_request_version integer,
  p_reservation_id uuid,
  p_transfer_group_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_system_job text,
  p_reason_code text,
  p_explanation text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_posted_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  period_row record;
  balance record;
  existing_id uuid;
  next_allocated numeric(18,2);
  next_available numeric(18,2);
  next_reserved numeric(18,2);
  next_spent numeric(18,2);
  next_pending numeric(18,2);
  created_id uuid:=gen_random_uuid();
BEGIN
  IF p_entry_type NOT IN (
    'INITIAL_ALLOCATION','ALLOCATION_INCREASE','ALLOCATION_DECREASE',
    'PERIOD_REFRESH','ROLLOVER_IN','EXPIRY_ADJUSTMENT',
    'PENDING_EXPOSURE_ADD','PENDING_EXPOSURE_REMOVE','RESERVATION',
    'RESERVATION_INCREASE','RESERVATION_REDUCTION','FINAL_SPEND',
    'DIRECT_SPEND','RELEASE','MANUAL_CORRECTION','TRANSFER_IN','TRANSFER_OUT'
  ) OR p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
    OR p_posted_at IS NULL OR p_correlation_id IS NULL
    OR char_length(btrim(COALESCE(p_explanation,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200
    OR COALESCE(p_allocation_delta,0)<>round(COALESCE(p_allocation_delta,0),2)
    OR COALESCE(p_available_delta,0)<>round(COALESCE(p_available_delta,0),2)
    OR COALESCE(p_reserved_delta,0)<>round(COALESCE(p_reserved_delta,0),2)
    OR COALESCE(p_spent_delta,0)<>round(COALESCE(p_spent_delta,0),2)
    OR COALESCE(p_pending_delta,0)<>round(COALESCE(p_pending_delta,0),2)
    OR COALESCE(p_rollover_delta,0)<>round(COALESCE(p_rollover_delta,0),2)
    OR COALESCE(p_expired_delta,0)<>round(COALESCE(p_expired_delta,0),2) THEN
    RAISE EXCEPTION 'The budget ledger command is invalid';
  END IF;
  IF p_actor_user_id IS NULL AND NULLIF(btrim(COALESCE(p_system_job,'')),'') IS NULL THEN
    RAISE EXCEPTION 'The budget ledger actor is required';
  END IF;

  SELECT period.id,period.company_id,period.budget_account_id,account.currency,
    period.status
  INTO period_row
  FROM public.budget_periods period
  JOIN public.budget_accounts account ON account.id=period.budget_account_id
  WHERE period.id=p_budget_period_id
    AND period.budget_account_id=p_budget_account_id
    AND period.company_id=p_company_id
  FOR UPDATE OF period;
  IF period_row.id IS NULL THEN RAISE EXCEPTION 'The budget period is unavailable'; END IF;

  SELECT entry.id INTO existing_id
  FROM public.budget_ledger_entries entry
  WHERE entry.budget_period_id=p_budget_period_id
    AND entry.idempotency_key=p_idempotency_key;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT COALESCE(sum(entry.allocation_delta),0)::numeric(18,2) AS allocated,
    COALESCE(sum(entry.available_delta),0)::numeric(18,2) AS available,
    COALESCE(sum(entry.reserved_delta),0)::numeric(18,2) AS reserved,
    COALESCE(sum(entry.spent_delta),0)::numeric(18,2) AS spent,
    COALESCE(sum(entry.pending_delta),0)::numeric(18,2) AS pending,
    COALESCE(sum(entry.expired_delta),0)::numeric(18,2) AS expired
  INTO balance
  FROM public.budget_ledger_entries entry
  WHERE entry.budget_period_id=p_budget_period_id;

  next_allocated:=balance.allocated+COALESCE(p_allocation_delta,0);
  next_available:=balance.available+COALESCE(p_available_delta,0);
  next_reserved:=balance.reserved+COALESCE(p_reserved_delta,0);
  next_spent:=balance.spent+COALESCE(p_spent_delta,0);
  next_pending:=balance.pending+COALESCE(p_pending_delta,0);
  IF next_allocated<0 OR next_available<0 OR next_reserved<0
    OR next_spent<0 OR next_pending<0
    OR balance.expired+COALESCE(p_expired_delta,0)<0
    OR next_allocated<>(
      next_available+next_reserved+next_spent
      +balance.expired+COALESCE(p_expired_delta,0)
    ) THEN
    RAISE EXCEPTION 'The budget ledger entry would create an invalid balance';
  END IF;

  INSERT INTO public.budget_ledger_entries(
    id,company_id,budget_account_id,budget_period_id,entry_type,amount,currency,
    allocation_delta,available_delta,reserved_delta,spent_delta,pending_delta,
    rollover_delta,expired_delta,allocated_before,allocated_after,
    available_before,available_after,reserved_before,reserved_after,
    spent_before,spent_after,pending_before,pending_after,request_id,
    request_version,reservation_id,transfer_group_id,reference_type,reference_id,
    actor_user_id,actor_role_assignment_id,system_job,reason_code,explanation,
    correlation_id,idempotency_key,posted_at
  ) VALUES (
    created_id,p_company_id,p_budget_account_id,p_budget_period_id,p_entry_type,
    p_amount,period_row.currency,COALESCE(p_allocation_delta,0),
    COALESCE(p_available_delta,0),COALESCE(p_reserved_delta,0),
    COALESCE(p_spent_delta,0),COALESCE(p_pending_delta,0),
    COALESCE(p_rollover_delta,0),COALESCE(p_expired_delta,0),
    balance.allocated,next_allocated,balance.available,next_available,
    balance.reserved,next_reserved,balance.spent,next_spent,
    balance.pending,next_pending,p_request_id,p_request_version,p_reservation_id,
    p_transfer_group_id,p_reference_type,p_reference_id,p_actor_user_id,
    p_actor_role_assignment_id,p_system_job,p_reason_code,p_explanation,
    p_correlation_id,p_idempotency_key,p_posted_at
  );
  RETURN created_id;
END $$;

-- Create the complete current organization budget hierarchy before posting
-- opening balances. Codes are stable and tenant-local.
INSERT INTO public.budget_accounts(
  company_id,level_type,account_code,name,currency,recurring_allocation,
  period_timezone,rollover_policy
)
SELECT company.id,'COMPANY','COMPANY','Company reserve',company.ceiling_currency,
  0,company.timezone,'NONE'
FROM public.companies company;

INSERT INTO public.budget_accounts(
  company_id,parent_account_id,level_type,branch_id,account_code,name,currency,
  recurring_allocation,period_timezone,rollover_policy
)
SELECT branch.company_id,parent.id,'BRANCH',branch.id,
  left('BRANCH-'||upper(regexp_replace(branch.branch_code,'[^A-Za-z0-9_-]','','g')),80),
  branch.name||' budget',company.ceiling_currency,
  COALESCE(branch.monthly_budget,0),branch.timezone,'NONE'
FROM public.branches branch
JOIN public.companies company ON company.id=branch.company_id
JOIN public.budget_accounts parent
  ON parent.company_id=branch.company_id AND parent.level_type='COMPANY';

INSERT INTO public.budget_accounts(
  company_id,parent_account_id,level_type,branch_id,department_id,account_code,
  name,currency,recurring_allocation,period_timezone,rollover_policy
)
SELECT department.company_id,COALESCE(branch_account.id,company_account.id),
  'DEPARTMENT',department.branch_id,department.id,
  left('DEPT-'||upper(regexp_replace(department.department_code,'[^A-Za-z0-9_-]','','g')),80),
  department.name||' budget',company.ceiling_currency,0,department.timezone,'NONE'
FROM public.departments department
JOIN public.companies company ON company.id=department.company_id
JOIN public.budget_accounts company_account
  ON company_account.company_id=department.company_id
 AND company_account.level_type='COMPANY'
LEFT JOIN public.budget_accounts branch_account
  ON branch_account.branch_id=department.branch_id
 AND branch_account.level_type='BRANCH';

INSERT INTO public.budget_accounts(
  company_id,parent_account_id,level_type,branch_id,department_id,cost_centre_id,
  account_code,name,currency,recurring_allocation,period_timezone,rollover_policy
)
SELECT centre.company_id,COALESCE(department_account.id,branch_account.id,company_account.id),
  'COST_CENTRE',centre.branch_id,centre.department_id,centre.id,
  left('COST-'||upper(regexp_replace(centre.cost_centre_code,'[^A-Za-z0-9_-]','','g')),80),
  centre.name||' budget',centre.currency,0,
  COALESCE(department.timezone,branch.timezone,company.timezone),'NONE'
FROM public.cost_centres centre
JOIN public.companies company ON company.id=centre.company_id
LEFT JOIN public.departments department ON department.id=centre.department_id
LEFT JOIN public.branches branch ON branch.id=centre.branch_id
JOIN public.budget_accounts company_account
  ON company_account.company_id=centre.company_id
 AND company_account.level_type='COMPANY'
LEFT JOIN public.budget_accounts branch_account
  ON branch_account.branch_id=centre.branch_id
 AND branch_account.level_type='BRANCH'
LEFT JOIN public.budget_accounts department_account
  ON department_account.department_id=centre.department_id
 AND department_account.level_type='DEPARTMENT';

INSERT INTO public.budget_periods(
  company_id,budget_account_id,period_name,starts_at,ends_at,timezone,
  allocation_method,rollover_policy,rollover_cap,status,refresh_due_at
)
SELECT account.company_id,account.id,
  to_char(now() AT TIME ZONE account.period_timezone,'YYYY-MM'),
  date_trunc('month',now() AT TIME ZONE account.period_timezone)
    AT TIME ZONE account.period_timezone,
  (date_trunc('month',now() AT TIME ZONE account.period_timezone)+interval '1 month')
    AT TIME ZONE account.period_timezone,
  account.period_timezone,'MIGRATION',account.rollover_policy,account.rollover_cap,
  'ACTIVE',
  (date_trunc('month',now() AT TIME ZONE account.period_timezone)+interval '1 month')
    AT TIME ZONE account.period_timezone
FROM public.budget_accounts account;

DO $$
DECLARE
  item record;
  opening numeric(18,2);
  correlation uuid;
BEGIN
  FOR item IN
    WITH commitments AS (
      SELECT request.branch_id,
        COALESCE(sum(
          COALESCE((SELECT sum(round(line.quantity*line.unit_sell_price,2))
            FROM public.request_lines line WHERE line.request_id=request.id),0)
          +request.estimated_delivery_fee+request.tax_amount
        ),0)::numeric(18,2) AS amount
      FROM public.requests request
      JOIN public.lookup_values status ON status.id=request.status_id
      WHERE status.label NOT IN ('Cancelled','Completed')
        AND EXISTS (
          SELECT 1 FROM public.approvals approval
          WHERE approval.request_id=request.id
            AND approval.approval_type='Company approval'
            AND approval.status='Approved'
        )
      GROUP BY request.branch_id
    ), branch_openings AS (
      SELECT account.id AS account_id,account.company_id,period.id AS period_id,
        greatest(account.recurring_allocation,COALESCE(commitment.amount,0))::numeric(18,2) AS amount
      FROM public.budget_accounts account
      JOIN public.budget_periods period ON period.budget_account_id=account.id
        AND period.status='ACTIVE'
      LEFT JOIN commitments commitment ON commitment.branch_id=account.branch_id
      WHERE account.level_type='BRANCH'
    ), company_openings AS (
      SELECT account.id AS account_id,account.company_id,period.id AS period_id,
        greatest(company.contractual_ceiling-COALESCE(sum(branch.amount),0),0)::numeric(18,2) AS amount
      FROM public.budget_accounts account
      JOIN public.companies company ON company.id=account.company_id
      JOIN public.budget_periods period ON period.budget_account_id=account.id
        AND period.status='ACTIVE'
      LEFT JOIN branch_openings branch ON branch.company_id=account.company_id
      WHERE account.level_type='COMPANY'
      GROUP BY account.id,account.company_id,period.id,company.contractual_ceiling
    )
    SELECT * FROM branch_openings
    UNION ALL SELECT * FROM company_openings
  LOOP
    opening:=item.amount;
    IF opening>0 THEN
      correlation:=gen_random_uuid();
      PERFORM public.axora_post_budget_entry_internal(
        item.company_id,item.account_id,item.period_id,'INITIAL_ALLOCATION',opening,
        opening,opening,0,0,0,0,0,NULL,NULL,NULL,NULL,'MIGRATION',NULL,
        NULL,NULL,'MIGRATION_056','MIGRATION_OPENING',
        'Opening allocation migrated from the current authorization model.',
        correlation,'migration-056-opening-'||item.account_id::text,now()
      );
    END IF;
  END LOOP;
END $$;

UPDATE public.requests request
SET budget_account_id=account.id,budget_period_id=period.id,
  currency=account.currency
FROM public.budget_accounts account
JOIN public.budget_periods period
  ON period.budget_account_id=account.id AND period.status='ACTIVE'
WHERE account.level_type='BRANCH'
  AND account.branch_id=request.branch_id
  AND account.company_id=request.company_id;

ALTER TABLE public.requests
  ALTER COLUMN budget_account_id SET NOT NULL,
  ALTER COLUMN budget_period_id SET NOT NULL,
  ADD CONSTRAINT requests_budget_account_company_fk
    FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT requests_budget_period_account_fk
    FOREIGN KEY(budget_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT;

DO $$
DECLARE
  item record;
  reservation_id uuid;
  correlation uuid;
BEGIN
  FOR item IN
    SELECT request.id AS request_id,request.request_version,
      request.company_id,request.budget_account_id,request.budget_period_id,
      request.currency,
      (COALESCE((SELECT sum(round(line.quantity*line.unit_sell_price,2))
        FROM public.request_lines line WHERE line.request_id=request.id),0)
        +request.estimated_delivery_fee+request.tax_amount)::numeric(18,2) AS amount
    FROM public.requests request
    JOIN public.lookup_values status ON status.id=request.status_id
    WHERE status.label NOT IN ('Cancelled','Completed')
      AND EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status='Approved'
      )
    ORDER BY request.company_id,request.branch_id,request.created_at,request.id
  LOOP
    correlation:=gen_random_uuid();
    INSERT INTO public.budget_reservations(
      company_id,budget_account_id,budget_period_id,request_id,request_version,
      currency,reserved_amount,remaining_reserved,status,correlation_id,created_at,updated_at
    ) VALUES (
      item.company_id,item.budget_account_id,item.budget_period_id,item.request_id,
      item.request_version,item.currency,item.amount,item.amount,'RESERVED',
      correlation,now(),now()
    ) RETURNING id INTO reservation_id;
    INSERT INTO public.budget_reservation_events(
      reservation_id,company_id,event_type,amount,new_status,system_job,reason,
      correlation_id,idempotency_key
    ) VALUES (
      reservation_id,item.company_id,'CREATED',item.amount,'RESERVED','MIGRATION_056',
      'Opening reservation migrated from an active approved request.',correlation,
      'migration-056-reservation-'||item.request_id::text
    );
    IF item.amount>0 THEN
      PERFORM public.axora_post_budget_entry_internal(
        item.company_id,item.budget_account_id,item.budget_period_id,'RESERVATION',item.amount,
        0,-item.amount,item.amount,0,0,0,0,item.request_id,item.request_version,
        reservation_id,NULL,'REQUEST',item.request_id,NULL,NULL,'MIGRATION_056',
        'REQUEST_RESERVATION','Opening reservation migrated from an active approved request.',
        correlation,'migration-056-reservation-'||item.request_id::text,now()
      );
    END IF;
  END LOOP;

  FOR item IN
    SELECT request.id AS request_id,request.request_version,
      request.company_id,request.budget_account_id,request.budget_period_id,
      (COALESCE((SELECT sum(round(line.quantity*line.unit_sell_price,2))
        FROM public.request_lines line WHERE line.request_id=request.id),0)
        +request.estimated_delivery_fee+request.tax_amount)::numeric(18,2) AS amount
    FROM public.requests request
    JOIN public.lookup_values status ON status.id=request.status_id
    WHERE status.label='New Request'
      AND NOT EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status IN ('Approved','Rejected')
      )
    ORDER BY request.company_id,request.created_at,request.id
  LOOP
    IF item.amount>0 THEN
      correlation:=gen_random_uuid();
      PERFORM public.axora_post_budget_entry_internal(
        item.company_id,item.budget_account_id,item.budget_period_id,
        'PENDING_EXPOSURE_ADD',item.amount,0,0,0,0,item.amount,0,0,
        item.request_id,item.request_version,NULL,NULL,'REQUEST',item.request_id,
        NULL,NULL,'MIGRATION_056','REQUEST_SUBMITTED',
        'Pending approval exposure migrated from an open request.',correlation,
        'migration-056-pending-'||item.request_id::text,now()
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.v_branch_budget_usage AS
SELECT branch.id AS branch_id,branch.company_id,branch.monthly_budget,
  (COALESCE(balance.reserved+balance.spent,0)
    +COALESCE(legacy.committed,0))::numeric(14,2) AS committed_amount,
  CASE WHEN branch.monthly_budget IS NULL THEN NULL
    ELSE greatest(COALESCE(balance.available,0)-COALESCE(legacy.committed,0),0)::numeric(14,2)
  END AS remaining_amount
FROM public.branches branch
LEFT JOIN public.budget_accounts account
  ON account.branch_id=branch.id AND account.level_type='BRANCH'
 AND account.active AND account.currency='MYR'
LEFT JOIN public.budget_periods period
  ON period.budget_account_id=account.id AND period.status='ACTIVE'
LEFT JOIN public.v_budget_period_balances balance
  ON balance.budget_period_id=period.id
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(
    COALESCE((SELECT sum(round(line.quantity*line.unit_sell_price,2))
      FROM public.request_lines line WHERE line.request_id=request.id),0)
    +request.estimated_delivery_fee+request.tax_amount
  ),0)::numeric(18,2) AS committed
  FROM public.requests request
  WHERE request.branch_id=branch.id
    AND NOT EXISTS (
      SELECT 1 FROM public.budget_reservations reservation
      WHERE reservation.request_id=request.id
    )
    AND EXISTS (
      SELECT 1 FROM public.approvals approval
      WHERE approval.request_id=request.id
        AND approval.approval_type='Company approval'
        AND approval.status='Approved'
        AND (period.id IS NULL OR (
          approval.decided_at>=period.starts_at
          AND approval.decided_at<period.ends_at
        ))
    )
) legacy ON true;

CREATE OR REPLACE FUNCTION public.axora_reject_budget_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Budget evidence is append-only';
END $$;
CREATE TRIGGER budget_ledger_append_only
BEFORE UPDATE OR DELETE ON public.budget_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_budget_evidence_change();
CREATE TRIGGER budget_reservation_events_append_only
BEFORE UPDATE OR DELETE ON public.budget_reservation_events
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_budget_evidence_change();
CREATE TRIGGER company_ceiling_history_append_only
BEFORE UPDATE OR DELETE ON public.company_ceiling_history
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_budget_evidence_change();

CREATE OR REPLACE FUNCTION public.axora_budget_workspace(
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
  payload jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;

  WITH visible_accounts AS (
    SELECT account.*
    FROM public.budget_accounts account
    JOIN public.companies company ON company.id=account.company_id
    LEFT JOIN public.branches branch ON branch.id=account.branch_id
    LEFT JOIN public.departments department ON department.id=account.department_id
    LEFT JOIN public.cost_centres centre ON centre.id=account.cost_centre_id
    WHERE public.axora_budget_account_permission(
      snapshot,'budget.view',account.level_type,account.company_id,
      account.branch_id,account.department_id
    )
  ), current_periods AS (
    SELECT period.*,balance.allocated,balance.reserved,balance.spent,
      balance.pending_approval,balance.available,balance.rollover_brought_forward,
      balance.expired_amount
    FROM public.budget_periods period
    JOIN visible_accounts account ON account.id=period.budget_account_id
    LEFT JOIN public.v_budget_period_balances balance
      ON balance.budget_period_id=period.id
    WHERE period.status='ACTIVE'
  )
  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',account.id,'companyId',account.company_id,'parentAccountId',account.parent_account_id,
      'levelType',account.level_type,'branchId',account.branch_id,
      'departmentId',account.department_id,'costCentreId',account.cost_centre_id,
      'code',account.account_code,'name',account.name,'currency',account.currency,
      'recurringAllocation',account.recurring_allocation::text,
      'refreshInterval',account.refresh_interval,'timezone',account.period_timezone,
      'rolloverPolicy',account.rollover_policy,'rolloverCap',account.rollover_cap::text,
      'active',account.active,'canAssign',account.level_type<>'COMPANY' AND public.axora_budget_account_permission(snapshot,'budget.assign',account.level_type,account.company_id,account.branch_id,account.department_id),
      'canIncrease',account.level_type<>'COMPANY' AND public.axora_budget_account_permission(snapshot,'budget.increase',account.level_type,account.company_id,account.branch_id,account.department_id),
      'canReduce',account.level_type<>'COMPANY' AND public.axora_budget_account_permission(snapshot,'budget.reduce',account.level_type,account.company_id,account.branch_id,account.department_id),
      'canRefresh',public.axora_budget_account_permission(snapshot,'budget.refresh',account.level_type,account.company_id,account.branch_id,account.department_id),
      'period',CASE WHEN period.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id',period.id,'name',period.period_name,'startsAt',period.starts_at,
        'endsAt',period.ends_at,'status',period.status,'nextRefreshAt',period.refresh_due_at,
        'allocated',COALESCE(period.allocated,0)::text,'reserved',COALESCE(period.reserved,0)::text,
        'spent',COALESCE(period.spent,0)::text,'pendingApproval',COALESCE(period.pending_approval,0)::text,
        'available',COALESCE(period.available,0)::text,
        'rolloverBroughtForward',COALESCE(period.rollover_brought_forward,0)::text,
        'expiredAmount',COALESCE(period.expired_amount,0)::text
      ) END
    )) ORDER BY account.company_id,account.level_type,account.account_code)
      FROM visible_accounts account
      LEFT JOIN current_periods period ON period.budget_account_id=account.id),'[]'::jsonb),
    'periods',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',period.id,'accountId',period.budget_account_id,'name',period.period_name,
      'startsAt',period.starts_at,'endsAt',period.ends_at,'timezone',period.timezone,
      'status',period.status,'allocationMethod',period.allocation_method,
      'rolloverPolicy',period.rollover_policy,'nextRefreshAt',period.refresh_due_at,
      'allocated',COALESCE(balance.allocated,0)::text,'reserved',COALESCE(balance.reserved,0)::text,
      'spent',COALESCE(balance.spent,0)::text,'pendingApproval',COALESCE(balance.pending_approval,0)::text,
      'available',COALESCE(balance.available,0)::text
    ) ORDER BY period.starts_at DESC,period.id)
      FROM public.budget_periods period
      JOIN visible_accounts account ON account.id=period.budget_account_id
      LEFT JOIN public.v_budget_period_balances balance ON balance.budget_period_id=period.id),'[]'::jsonb),
    'entries',COALESCE((SELECT jsonb_agg(entry.payload ORDER BY entry.posted_at DESC,entry.id DESC)
      FROM (SELECT ledger.id,ledger.posted_at,jsonb_strip_nulls(jsonb_build_object(
        'id',ledger.id,'accountId',ledger.budget_account_id,'periodId',ledger.budget_period_id,
        'entryType',ledger.entry_type,'amount',ledger.amount::text,'currency',ledger.currency,
        'requestId',ledger.request_id,'requestVersion',ledger.request_version,
        'reasonCode',ledger.reason_code,'explanation',ledger.explanation,
        'availableBefore',ledger.available_before::text,'availableAfter',ledger.available_after::text,
        'reservedBefore',ledger.reserved_before::text,'reservedAfter',ledger.reserved_after::text,
        'spentBefore',ledger.spent_before::text,'spentAfter',ledger.spent_after::text,
        'pendingBefore',ledger.pending_before::text,'pendingAfter',ledger.pending_after::text,
        'correlationId',ledger.correlation_id,'postedAt',ledger.posted_at
      )) AS payload
      FROM public.budget_ledger_entries ledger
      JOIN visible_accounts account ON account.id=ledger.budget_account_id
      ORDER BY ledger.posted_at DESC,ledger.id DESC LIMIT 250) entry),'[]'::jsonb),
    'ceilings',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'companyId',company.id,'companyName',company.name,
      'amount',company.contractual_ceiling::text,'currency',company.ceiling_currency,
      'utilized',COALESCE(exposure.amount,0)::text,
      'canOverride',public.axora_snapshot_has_permission(snapshot,'commercial.company_ceiling.override','COMPANY',company.id,NULL,NULL,NULL)
    ) ORDER BY company.name)
      FROM public.companies company
      LEFT JOIN LATERAL (
        SELECT sum(balance.reserved+balance.spent)::numeric(18,2) AS amount
        FROM public.v_budget_period_balances balance
        JOIN public.budget_periods period ON period.id=balance.budget_period_id
        WHERE balance.company_id=company.id AND period.status='ACTIVE'
      ) exposure ON true
      WHERE public.axora_snapshot_has_permission(snapshot,'commercial.company_ceiling.view','COMPANY',company.id,NULL,NULL,NULL)
    ),'[]'::jsonb)
  ) INTO payload;
  RETURN payload;
END $$;

CREATE OR REPLACE FUNCTION public.axora_adjust_budget_allocation(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_action text,p_amount numeric,p_apply_to_recurring boolean,p_reason text,
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
  account public.budget_accounts%ROWTYPE;
  period public.budget_periods%ROWTYPE;
  balance record;
  permission text;
  signed_amount numeric(18,2);
  correlation uuid:=gen_random_uuid();
  entry_type text;
  total_allocated numeric(18,2);
  ceiling numeric(18,2);
  existing_id uuid;
BEGIN
  IF p_action NOT IN ('INCREASE','REDUCE','CORRECTION_INCREASE','CORRECTION_REDUCE')
    OR p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The budget adjustment is invalid';
  END IF;
  permission:=CASE WHEN p_action IN ('INCREASE','CORRECTION_INCREASE')
    THEN 'budget.increase' ELSE 'budget.reduce' END;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active FOR UPDATE;
  IF snapshot IS NULL OR account.id IS NULL OR NOT public.axora_budget_account_permission(
    snapshot,permission,account.level_type,account.company_id,account.branch_id,account.department_id
  ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  IF account.level_type='COMPANY' THEN
    RAISE EXCEPTION 'Use the contractual ceiling command for the company account';
  END IF;
  SELECT * INTO period FROM public.budget_periods
  WHERE budget_account_id=account.id AND status='ACTIVE' FOR UPDATE;
  IF period.id IS NULL THEN RAISE EXCEPTION 'The active budget period is unavailable'; END IF;
  SELECT entry.id INTO existing_id FROM public.budget_ledger_entries entry
  WHERE entry.budget_period_id=period.id AND entry.idempotency_key=p_idempotency_key;
  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('accountId',account.id,'periodId',period.id,
      'action',p_action,'amount',p_amount::text,'changed',false);
  END IF;
  SELECT * INTO balance FROM public.v_budget_period_balances
  WHERE budget_period_id=period.id;
  signed_amount:=CASE WHEN p_action IN ('INCREASE','CORRECTION_INCREASE') THEN p_amount ELSE -p_amount END;
  IF signed_amount<0 AND COALESCE(balance.available,0)<p_amount THEN
    RAISE EXCEPTION 'The budget reduction exceeds available authorization';
  END IF;
  IF signed_amount>0 THEN
    SELECT company.contractual_ceiling INTO ceiling FROM public.companies company
    WHERE company.id=account.company_id FOR UPDATE;
    SELECT COALESCE(sum(active_balance.allocated),0) INTO total_allocated
    FROM public.v_budget_period_balances active_balance
    JOIN public.budget_periods active_period ON active_period.id=active_balance.budget_period_id
    JOIN public.budget_accounts active_account
      ON active_account.id=active_balance.budget_account_id
    WHERE active_balance.company_id=account.company_id
      AND active_period.status='ACTIVE' AND active_account.level_type<>'COMPANY';
    IF total_allocated+p_amount>ceiling THEN
      RAISE EXCEPTION 'The allocation exceeds the company ceiling';
    END IF;
  END IF;
  entry_type:=CASE
    WHEN p_action='INCREASE' THEN 'ALLOCATION_INCREASE'
    WHEN p_action='REDUCE' THEN 'ALLOCATION_DECREASE'
    ELSE 'MANUAL_CORRECTION' END;
  PERFORM public.axora_post_budget_entry_internal(
    account.company_id,account.id,period.id,entry_type,p_amount,
    signed_amount,signed_amount,0,0,0,0,0,NULL,NULL,NULL,NULL,
    'BUDGET_ACCOUNT',account.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
    CASE WHEN p_action LIKE 'CORRECTION_%' THEN 'MANUAL_CORRECTION' ELSE p_action END,
    p_reason,correlation,p_idempotency_key,p_at
  );
  IF p_apply_to_recurring THEN
    UPDATE public.budget_accounts SET recurring_allocation=recurring_allocation+signed_amount,
      updated_at=p_at WHERE id=account.id AND recurring_allocation+signed_amount>=0;
    IF NOT FOUND THEN RAISE EXCEPTION 'The recurring allocation would be invalid'; END IF;
  END IF;
  RETURN jsonb_build_object('accountId',account.id,'periodId',period.id,
    'action',p_action,'amount',p_amount::text,'changed',true,'correlationId',correlation);
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_budget_allocation(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_target_amount numeric,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  account public.budget_accounts%ROWTYPE;
  difference numeric(18,2);
  result jsonb;
BEGIN
  IF p_target_amount IS NULL OR p_target_amount<0
    OR p_target_amount<>round(p_target_amount,2)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'The budget allocation command is invalid';
  END IF;
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active FOR UPDATE;
  IF account.id IS NULL OR account.level_type<>'BRANCH' THEN
    RAISE EXCEPTION 'The budget allocation command is unavailable';
  END IF;
  difference:=p_target_amount-account.recurring_allocation;
  IF difference=0 THEN
    UPDATE public.branches SET monthly_budget=p_target_amount,budget_updated_at=p_at
    WHERE id=account.branch_id AND company_id=account.company_id;
    RETURN jsonb_build_object('accountId',account.id,'amount',p_target_amount::text,'changed',false);
  END IF;
  result:=public.axora_adjust_budget_allocation(
    p_actor_user_id,p_actor_role_assignment_id,account.id,
    CASE WHEN difference>0 THEN 'INCREASE' ELSE 'REDUCE' END,
    abs(difference),true,p_reason,p_idempotency_key,p_at
  );
  IF COALESCE((result->>'changed')::boolean,false)=false THEN
    RAISE EXCEPTION 'The budget command key was already used for another allocation';
  END IF;
  UPDATE public.branches SET monthly_budget=p_target_amount,budget_updated_at=p_at
  WHERE id=account.branch_id AND company_id=account.company_id;
  RETURN result||jsonb_build_object('targetAmount',p_target_amount::text);
END $$;

CREATE OR REPLACE FUNCTION public.axora_transfer_budget_allocation(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_source_account_id uuid,
  p_target_account_id uuid,p_amount numeric,p_apply_to_recurring boolean,
  p_reason text,p_idempotency_key text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  source_account public.budget_accounts%ROWTYPE;
  target_account public.budget_accounts%ROWTYPE;
  source_period public.budget_periods%ROWTYPE;
  target_period public.budget_periods%ROWTYPE;
  source_balance record;
  transfer_group uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
BEGIN
  IF p_source_account_id=p_target_account_id OR p_amount IS NULL OR p_amount<=0
    OR p_amount<>round(p_amount,2)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The budget transfer is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  PERFORM 1 FROM public.budget_accounts account
    WHERE account.id IN (p_source_account_id,p_target_account_id)
    ORDER BY account.id FOR UPDATE;
  SELECT * INTO source_account FROM public.budget_accounts WHERE id=p_source_account_id AND active;
  SELECT * INTO target_account FROM public.budget_accounts WHERE id=p_target_account_id AND active;
  IF snapshot IS NULL OR source_account.id IS NULL OR target_account.id IS NULL
    OR source_account.company_id<>target_account.company_id
    OR source_account.currency<>target_account.currency
    OR NOT public.axora_budget_account_permission(snapshot,'budget.assign',source_account.level_type,source_account.company_id,source_account.branch_id,source_account.department_id)
    OR NOT public.axora_budget_account_permission(snapshot,'budget.assign',target_account.level_type,target_account.company_id,target_account.branch_id,target_account.department_id) THEN
    RAISE EXCEPTION 'The budget transfer is unavailable';
  END IF;
  SELECT * INTO source_period FROM public.budget_periods
    WHERE budget_account_id=source_account.id AND status='ACTIVE' FOR UPDATE;
  SELECT * INTO target_period FROM public.budget_periods
    WHERE budget_account_id=target_account.id AND status='ACTIVE' FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.budget_ledger_entries entry
    WHERE entry.budget_period_id=source_period.id
      AND entry.idempotency_key=p_idempotency_key||'-out'
  ) THEN
    RETURN jsonb_build_object('sourceAccountId',source_account.id,
      'targetAccountId',target_account.id,'amount',p_amount::text,'changed',false);
  END IF;
  SELECT * INTO source_balance FROM public.v_budget_period_balances
    WHERE budget_period_id=source_period.id;
  IF source_period.id IS NULL OR target_period.id IS NULL
    OR COALESCE(source_balance.available,0)<p_amount THEN
    RAISE EXCEPTION 'The source budget has insufficient available authorization';
  END IF;
  PERFORM public.axora_post_budget_entry_internal(
    source_account.company_id,source_account.id,source_period.id,'TRANSFER_OUT',p_amount,
    -p_amount,-p_amount,0,0,0,0,0,NULL,NULL,NULL,transfer_group,
    'BUDGET_ACCOUNT',target_account.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
    'TRANSFER_OUT',p_reason,correlation,p_idempotency_key||'-out',p_at
  );
  PERFORM public.axora_post_budget_entry_internal(
    target_account.company_id,target_account.id,target_period.id,'TRANSFER_IN',p_amount,
    p_amount,p_amount,0,0,0,0,0,NULL,NULL,NULL,transfer_group,
    'BUDGET_ACCOUNT',source_account.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
    'TRANSFER_IN',p_reason,correlation,p_idempotency_key||'-in',p_at
  );
  IF p_apply_to_recurring THEN
    UPDATE public.budget_accounts SET recurring_allocation=recurring_allocation-p_amount,
      updated_at=p_at WHERE id=source_account.id AND recurring_allocation>=p_amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'The recurring source allocation is insufficient'; END IF;
    UPDATE public.budget_accounts SET recurring_allocation=recurring_allocation+p_amount,
      updated_at=p_at WHERE id=target_account.id;
  END IF;
  RETURN jsonb_build_object('sourceAccountId',source_account.id,
    'targetAccountId',target_account.id,'amount',p_amount::text,
    'changed',true,'transferGroupId',transfer_group,'correlationId',correlation);
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_company_ceiling(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_amount numeric,p_currency text,p_reason text,p_idempotency_key text,
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
  company public.companies%ROWTYPE;
  company_account public.budget_accounts%ROWTYPE;
  period public.budget_periods%ROWTYPE;
  balance record;
  exposure numeric(18,2);
  child_allocated numeric(18,2);
  difference numeric(18,2);
  correlation uuid:=gen_random_uuid();
  history_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2)
    OR p_currency !~ '^[A-Z]{3}$'
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The company ceiling command is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO company FROM public.companies WHERE id=p_company_id AND active FOR UPDATE;
  IF snapshot IS NULL OR company.id IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'commercial.company_ceiling.override','COMPANY',p_company_id,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'The company ceiling command is unavailable'; END IF;
  SELECT history.id INTO history_id FROM public.company_ceiling_history history
    WHERE history.company_id=p_company_id AND history.idempotency_key=p_idempotency_key;
  IF history_id IS NOT NULL THEN
    RETURN jsonb_build_object('companyId',p_company_id,'historyId',history_id,'changed',false);
  END IF;
  IF p_currency<>company.ceiling_currency THEN
    RAISE EXCEPTION 'Company ceiling currency changes require a controlled conversion';
  END IF;
  SELECT COALESCE(sum(active_balance.reserved+active_balance.spent),0)
    INTO exposure
  FROM public.v_budget_period_balances active_balance
  JOIN public.budget_periods active_period ON active_period.id=active_balance.budget_period_id
  WHERE active_balance.company_id=p_company_id AND active_period.status='ACTIVE';
  IF p_amount<exposure THEN RAISE EXCEPTION 'The ceiling cannot be lower than current commitments'; END IF;
  SELECT COALESCE(sum(active_balance.allocated),0)::numeric(18,2)
  INTO child_allocated
  FROM public.v_budget_period_balances active_balance
  JOIN public.budget_periods active_period ON active_period.id=active_balance.budget_period_id
    AND active_period.status='ACTIVE'
  JOIN public.budget_accounts active_account
    ON active_account.id=active_balance.budget_account_id
   AND active_account.level_type<>'COMPANY'
  WHERE active_balance.company_id=p_company_id;
  IF p_amount<child_allocated THEN
    RAISE EXCEPTION 'Reduce child allocations before lowering the company ceiling';
  END IF;
  SELECT * INTO company_account FROM public.budget_accounts
    WHERE company_id=p_company_id AND level_type='COMPANY' AND active FOR UPDATE;
  SELECT * INTO period FROM public.budget_periods
    WHERE budget_account_id=company_account.id AND status='ACTIVE' FOR UPDATE;
  SELECT * INTO balance FROM public.v_budget_period_balances WHERE budget_period_id=period.id;
  difference:=p_amount-company.contractual_ceiling;
  IF difference<0 AND COALESCE(balance.available,0)<abs(difference) THEN
    RAISE EXCEPTION 'Reduce child allocations before lowering the company ceiling';
  END IF;
  IF difference<>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      p_company_id,company_account.id,period.id,
      CASE WHEN difference>0 THEN 'ALLOCATION_INCREASE' ELSE 'ALLOCATION_DECREASE' END,
      abs(difference),difference,difference,0,0,0,0,0,NULL,NULL,NULL,NULL,
      'COMPANY',p_company_id,p_actor_user_id,p_actor_role_assignment_id,NULL,
      'COMPANY_CEILING_CHANGE',p_reason,correlation,p_idempotency_key||'-ledger',p_at
    );
    UPDATE public.budget_accounts SET recurring_allocation=recurring_allocation+difference,
      updated_at=p_at WHERE id=company_account.id;
  END IF;
  UPDATE public.companies SET contractual_ceiling=p_amount,updated_at=p_at
    WHERE id=p_company_id;
  INSERT INTO public.company_ceiling_history(
    company_id,previous_amount,new_amount,currency,reason_code,explanation,
    changed_by,changed_by_role_assignment_id,correlation_id,idempotency_key,changed_at
  ) VALUES (
    p_company_id,company.contractual_ceiling,p_amount,p_currency,
    'AUTHORIZED_CHANGE',p_reason,p_actor_user_id,p_actor_role_assignment_id,
    correlation,p_idempotency_key,p_at
  ) RETURNING id INTO history_id;
  RETURN jsonb_build_object('companyId',p_company_id,'historyId',history_id,
    'changed',difference<>0,'amount',p_amount::text,'correlationId',correlation);
END $$;

CREATE OR REPLACE FUNCTION public.axora_refresh_budget_period(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_reason text,p_idempotency_key text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  account public.budget_accounts%ROWTYPE;
  current_period public.budget_periods%ROWTYPE;
  balance record;
  rollover numeric(18,2):=0;
  next_start timestamptz;
  next_end timestamptz;
  next_id uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
BEGIN
  IF char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'The budget refresh command is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO account FROM public.budget_accounts WHERE id=p_budget_account_id AND active FOR UPDATE;
  IF snapshot IS NULL OR account.id IS NULL OR NOT public.axora_budget_account_permission(
    snapshot,'budget.refresh',account.level_type,account.company_id,account.branch_id,account.department_id
  ) THEN RAISE EXCEPTION 'The budget refresh is unavailable'; END IF;
  SELECT * INTO current_period FROM public.budget_periods
    WHERE budget_account_id=account.id AND status='ACTIVE' FOR UPDATE;
  IF current_period.id IS NULL OR p_at<current_period.ends_at THEN
    RAISE EXCEPTION 'The current budget period is not ready to refresh';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_periods period
    WHERE period.budget_account_id=account.id
      AND period.previous_period_id=current_period.id) THEN
    RETURN jsonb_build_object('accountId',account.id,'changed',false);
  END IF;
  SELECT * INTO balance FROM public.v_budget_period_balances
    WHERE budget_period_id=current_period.id;
  rollover:=CASE account.rollover_policy
    WHEN 'FULL' THEN balance.available
    WHEN 'CAPPED' THEN least(balance.available,account.rollover_cap)
    ELSE 0 END;
  IF balance.available>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,current_period.id,'EXPIRY_ADJUSTMENT',balance.available,
      0,-balance.available,0,0,0,0,balance.available,NULL,NULL,NULL,NULL,
      'BUDGET_PERIOD',current_period.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
      CASE WHEN rollover>0 THEN 'ROLLOVER_OUT' ELSE 'NO_ROLLOVER_EXPIRY' END,
      p_reason,correlation,p_idempotency_key||'-close',p_at
    );
  END IF;
  UPDATE public.budget_periods SET status='CLOSED',closed_at=p_at
    WHERE id=current_period.id;
  next_start:=current_period.ends_at;
  next_end:=CASE account.refresh_interval
    WHEN 'MONTHLY' THEN current_period.ends_at+interval '1 month'
    WHEN 'QUARTERLY' THEN current_period.ends_at+interval '3 months'
    WHEN 'ANNUAL' THEN current_period.ends_at+interval '1 year'
    ELSE current_period.ends_at+interval '1 month' END;
  INSERT INTO public.budget_periods(
    id,company_id,budget_account_id,previous_period_id,period_name,starts_at,
    ends_at,timezone,allocation_method,rollover_policy,rollover_cap,status,
    refresh_due_at,created_by
  ) VALUES (
    next_id,account.company_id,account.id,current_period.id,
    to_char(next_start AT TIME ZONE account.period_timezone,'YYYY-MM'),
    next_start,next_end,account.period_timezone,'REFRESH',account.rollover_policy,
    account.rollover_cap,'ACTIVE',next_end,p_actor_user_id
  );
  IF account.recurring_allocation>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,next_id,'PERIOD_REFRESH',account.recurring_allocation,
      account.recurring_allocation,account.recurring_allocation,0,0,0,0,0,
      NULL,NULL,NULL,NULL,'BUDGET_PERIOD',current_period.id,p_actor_user_id,
      p_actor_role_assignment_id,NULL,'PERIOD_REFRESH',p_reason,correlation,
      p_idempotency_key||'-allocation',p_at
    );
  END IF;
  IF rollover>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,next_id,'ROLLOVER_IN',rollover,
      rollover,rollover,0,0,0,rollover,0,NULL,NULL,NULL,NULL,
      'BUDGET_PERIOD',current_period.id,p_actor_user_id,p_actor_role_assignment_id,
      NULL,'ROLLOVER_IN',p_reason,correlation,p_idempotency_key||'-rollover',p_at
    );
  END IF;
  RETURN jsonb_build_object('accountId',account.id,'previousPeriodId',current_period.id,
    'periodId',next_id,'rollover',rollover::text,'changed',true,
    'correlationId',correlation);
END $$;

-- New organization nodes receive zero-allocation accounts and an explicit
-- current period. Allocation still requires the audited management commands.
CREATE OR REPLACE FUNCTION public.axora_seed_budget_account_for_node()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  company_row public.companies%ROWTYPE;
  parent_id uuid;
  account_id uuid:=gen_random_uuid();
  period_id uuid;
  code text;
  account_name text;
  level text;
  linked_branch uuid;
  linked_department uuid;
  linked_cost uuid;
  target_company_id uuid;
  opening_allocation numeric(18,2):=0;
  zone text;
  currency text;
BEGIN
  IF TG_TABLE_NAME='companies' THEN
    company_row:=NEW;
    target_company_id:=NEW.id;
    level:='COMPANY';code:='COMPANY';account_name:='Company reserve';
    zone:=NEW.timezone;currency:=NEW.ceiling_currency;
  ELSE
    target_company_id:=NEW.company_id;
    SELECT * INTO company_row FROM public.companies WHERE id=NEW.company_id;
    currency:=company_row.ceiling_currency;
    IF TG_TABLE_NAME='branches' THEN
      level:='BRANCH';linked_branch:=NEW.id;zone:=NEW.timezone;
      opening_allocation:=COALESCE(NEW.monthly_budget,0);
      code:=left('BRANCH-'||upper(regexp_replace(NEW.branch_code,'[^A-Za-z0-9_-]','','g')),80);
      account_name:=NEW.name||' budget';
      SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='COMPANY';
    ELSIF TG_TABLE_NAME='departments' THEN
      level:='DEPARTMENT';linked_branch:=NEW.branch_id;linked_department:=NEW.id;
      zone:=NEW.timezone;
      code:=left('DEPT-'||upper(regexp_replace(NEW.department_code,'[^A-Za-z0-9_-]','','g')),80);
      account_name:=NEW.name||' budget';
      SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='BRANCH' AND branch_id=NEW.branch_id;
      IF parent_id IS NULL THEN SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='COMPANY'; END IF;
    ELSE
      level:='COST_CENTRE';linked_branch:=NEW.branch_id;
      linked_department:=NEW.department_id;linked_cost:=NEW.id;currency:=NEW.currency;
      code:=left('COST-'||upper(regexp_replace(NEW.cost_centre_code,'[^A-Za-z0-9_-]','','g')),80);
      account_name:=NEW.name||' budget';
      SELECT COALESCE(department.timezone,branch.timezone,company_row.timezone)
        INTO zone FROM (SELECT 1) seed
        LEFT JOIN public.departments department ON department.id=NEW.department_id
        LEFT JOIN public.branches branch ON branch.id=NEW.branch_id;
      SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='DEPARTMENT'
          AND department_id=NEW.department_id;
      IF parent_id IS NULL THEN SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='BRANCH' AND branch_id=NEW.branch_id; END IF;
      IF parent_id IS NULL THEN SELECT id INTO parent_id FROM public.budget_accounts
        WHERE company_id=NEW.company_id AND level_type='COMPANY'; END IF;
    END IF;
  END IF;
  INSERT INTO public.budget_accounts(
    id,company_id,parent_account_id,level_type,branch_id,department_id,
    cost_centre_id,account_code,name,currency,recurring_allocation,
    period_timezone,rollover_policy
  ) VALUES (
    account_id,target_company_id,parent_id,level,linked_branch,linked_department,linked_cost,
    code,account_name,currency,
    opening_allocation,
    zone,'NONE'
  ) ON CONFLICT(company_id,account_code) DO NOTHING RETURNING id INTO account_id;
  IF account_id IS NOT NULL THEN
    INSERT INTO public.budget_periods(
      company_id,budget_account_id,period_name,starts_at,ends_at,timezone,
      allocation_method,rollover_policy,status,refresh_due_at
    ) VALUES (
      target_company_id,
      account_id,to_char(now() AT TIME ZONE zone,'YYYY-MM'),
      date_trunc('month',now() AT TIME ZONE zone) AT TIME ZONE zone,
      (date_trunc('month',now() AT TIME ZONE zone)+interval '1 month') AT TIME ZONE zone,
      zone,'MANUAL','NONE','ACTIVE',
      (date_trunc('month',now() AT TIME ZONE zone)+interval '1 month') AT TIME ZONE zone
    ) RETURNING id INTO period_id;
    IF opening_allocation>0 THEN
      PERFORM public.axora_post_budget_entry_internal(
        target_company_id,account_id,period_id,'INITIAL_ALLOCATION',
        opening_allocation,opening_allocation,opening_allocation,0,0,0,0,0,
        NULL,NULL,NULL,NULL,'BRANCH',NEW.id,NULL,NULL,'ACCOUNT_SEED',
        'OPENING_BRANCH_ALLOCATION','Opening allocation from the configured branch budget.',
        gen_random_uuid(),'account-seed-'||account_id::text,now()
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The company trigger needs a separate assignment because NEW.company_id does
-- not exist for companies; the function branches before using it.
CREATE TRIGGER seed_company_budget_account
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_budget_account_for_node();
CREATE TRIGGER seed_branch_budget_account
AFTER INSERT ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_budget_account_for_node();
CREATE TRIGGER seed_department_budget_account
AFTER INSERT ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_budget_account_for_node();
CREATE TRIGGER seed_cost_centre_budget_account
AFTER INSERT ON public.cost_centres
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_budget_account_for_node();

REVOKE ALL ON TABLE public.company_ceiling_history,public.budget_accounts,
  public.budget_periods,public.budget_ledger_entries,public.budget_reservations,
  public.budget_reservation_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_validate_budget_account_scope(),
  public.axora_budget_scope_type(text,uuid),
  public.axora_budget_account_permission(jsonb,text,text,uuid,uuid,uuid),
  public.axora_post_budget_entry_internal(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,uuid,integer,uuid,uuid,text,uuid,uuid,uuid,text,text,text,uuid,text,timestamptz),
  public.axora_reject_budget_evidence_change(),
  public.axora_seed_budget_account_for_node()
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_budget_workspace(uuid,uuid,timestamptz),
  public.axora_adjust_budget_allocation(uuid,uuid,uuid,text,numeric,boolean,text,text,timestamptz),
  public.axora_set_budget_allocation(uuid,uuid,uuid,numeric,text,text,timestamptz),
  public.axora_transfer_budget_allocation(uuid,uuid,uuid,uuid,numeric,boolean,text,text,timestamptz),
  public.axora_set_company_ceiling(uuid,uuid,uuid,numeric,text,text,text,timestamptz),
  public.axora_refresh_budget_period(uuid,uuid,uuid,text,text,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.company_ceiling_history,public.budget_accounts,
      public.budget_periods,public.budget_ledger_entries,public.budget_reservations,
      public.budget_reservation_events FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_budget_workspace(uuid,uuid,timestamptz),
      public.axora_adjust_budget_allocation(uuid,uuid,uuid,text,numeric,boolean,text,text,timestamptz),
      public.axora_set_budget_allocation(uuid,uuid,uuid,numeric,text,text,timestamptz),
      public.axora_transfer_budget_allocation(uuid,uuid,uuid,uuid,numeric,boolean,text,text,timestamptz),
      public.axora_set_company_ceiling(uuid,uuid,uuid,numeric,text,text,text,timestamptz),
      public.axora_refresh_budget_period(uuid,uuid,uuid,text,text,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
