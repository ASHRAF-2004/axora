BEGIN;

-- P1-06/P1-07 keep budget-cycle configuration, job execution, actual purchase
-- evidence, and variance decisions inside PostgreSQL authorization boundaries.
-- Existing estimates, approval snapshots, commercial snapshots, and ledger rows
-- remain immutable.

ALTER TABLE public.budget_accounts
  DROP CONSTRAINT budget_accounts_refresh_interval_check,
  ADD CONSTRAINT budget_accounts_refresh_interval_check CHECK (
    refresh_interval IN (
      'WEEKLY','MONTHLY','QUARTERLY','ANNUAL','YEARLY','CUSTOM','MANUAL'
    )
  );

CREATE TABLE public.budget_cycle_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  schedule_version integer NOT NULL CHECK (schedule_version>0),
  frequency text NOT NULL CHECK (
    frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY','CUSTOM','MANUAL')
  ),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 52),
  custom_interval_days integer CHECK (
    custom_interval_days IS NULL OR custom_interval_days BETWEEN 1 AND 3660
  ),
  timezone text NOT NULL CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  anchor_local timestamp without time zone NOT NULL,
  dst_resolution text NOT NULL DEFAULT 'EARLIER' CHECK (
    dst_resolution IN ('EARLIER','LATER')
  ),
  fixed_allocation numeric(18,2) NOT NULL CHECK (fixed_allocation>=0),
  rollover_mode text NOT NULL CHECK (
    rollover_mode IN (
      'RESET_FIXED','FULL','NONE','PARTIAL_PERCENT','CUSTOM_AMOUNT'
    )
  ),
  rollover_percentage numeric(7,4),
  custom_rollover_amount numeric(18,2),
  low_threshold_percentage numeric(7,4) NOT NULL DEFAULT 25,
  critical_threshold_percentage numeric(7,4) NOT NULL DEFAULT 10,
  hysteresis_percentage numeric(7,4) NOT NULL DEFAULT 5,
  effective_at timestamptz NOT NULL,
  source_change_request_id uuid,
  approved_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  approval_reason text NOT NULL CHECK (
    char_length(btrim(approval_reason)) BETWEEN 3 AND 1000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,budget_account_id),
  UNIQUE(budget_account_id,schedule_version),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (frequency='CUSTOM' AND custom_interval_days IS NOT NULL)
    OR (frequency<>'CUSTOM' AND custom_interval_days IS NULL)
  ),
  CHECK (
    (rollover_mode='PARTIAL_PERCENT'
      AND rollover_percentage>0 AND rollover_percentage<100)
    OR (rollover_mode<>'PARTIAL_PERCENT' AND rollover_percentage IS NULL)
  ),
  CHECK (
    (rollover_mode='CUSTOM_AMOUNT' AND custom_rollover_amount>=0)
    OR (rollover_mode<>'CUSTOM_AMOUNT' AND custom_rollover_amount IS NULL)
  ),
  CHECK (
    critical_threshold_percentage>0
    AND low_threshold_percentage>critical_threshold_percentage
    AND low_threshold_percentage<100
    AND hysteresis_percentage>0
    AND hysteresis_percentage<=25
  )
);
CREATE INDEX budget_cycle_schedules_effective_idx
  ON public.budget_cycle_schedules(
    budget_account_id,effective_at DESC,schedule_version DESC
  );

ALTER TABLE public.budget_periods
  ADD COLUMN schedule_id uuid,
  ADD COLUMN schedule_version integer,
  ADD COLUMN cycle_number integer NOT NULL DEFAULT 0 CHECK (cycle_number>=0),
  ADD COLUMN refresh_idempotency_key text;

INSERT INTO public.budget_cycle_schedules(
  company_id,budget_account_id,schedule_version,frequency,interval_count,
  custom_interval_days,timezone,anchor_local,dst_resolution,fixed_allocation,
  rollover_mode,rollover_percentage,custom_rollover_amount,effective_at,
  approval_reason
)
SELECT account.company_id,account.id,1,
  CASE account.refresh_interval
    WHEN 'ANNUAL' THEN 'YEARLY'
    WHEN 'MANUAL' THEN 'MANUAL'
    ELSE account.refresh_interval
  END,
  1,NULL,account.period_timezone,
  period.ends_at AT TIME ZONE account.period_timezone,'EARLIER',
  account.recurring_allocation,
  CASE account.rollover_policy
    WHEN 'FULL' THEN 'FULL'
    WHEN 'CAPPED' THEN 'CUSTOM_AMOUNT'
    ELSE 'RESET_FIXED'
  END,
  NULL,
  CASE WHEN account.rollover_policy='CAPPED' THEN account.rollover_cap END,
  period.starts_at,
  'Opening cycle schedule migrated without changing the active period'
FROM public.budget_accounts account
JOIN public.budget_periods period
  ON period.budget_account_id=account.id AND period.status='ACTIVE';

UPDATE public.budget_periods period
SET schedule_id=schedule.id,schedule_version=schedule.schedule_version
FROM public.budget_cycle_schedules schedule
WHERE schedule.budget_account_id=period.budget_account_id
  AND schedule.schedule_version=1;

ALTER TABLE public.budget_periods
  ADD CONSTRAINT budget_periods_schedule_fk
    FOREIGN KEY(schedule_id,budget_account_id)
    REFERENCES public.budget_cycle_schedules(id,budget_account_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT budget_periods_schedule_version_check CHECK (
    (schedule_id IS NULL AND schedule_version IS NULL)
    OR (schedule_id IS NOT NULL AND schedule_version>0)
  ),
  ADD CONSTRAINT budget_periods_refresh_idempotency_key_check CHECK (
    refresh_idempotency_key IS NULL
    OR char_length(refresh_idempotency_key) BETWEEN 8 AND 200
  );
CREATE UNIQUE INDEX budget_periods_refresh_idempotency_uq
  ON public.budget_periods(budget_account_id,refresh_idempotency_key)
  WHERE refresh_idempotency_key IS NOT NULL;

CREATE TABLE public.budget_cycle_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  expected_schedule_version integer NOT NULL CHECK (expected_schedule_version>0),
  proposed_config jsonb NOT NULL CHECK (jsonb_typeof(proposed_config)='object'),
  proposed_effective_at timestamptz NOT NULL,
  state text NOT NULL CHECK (
    state IN ('PENDING_COMPANY','PENDING_AXORA','APPROVED','REJECTED')
  ),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  request_reason text NOT NULL CHECK (
    char_length(btrim(request_reason)) BETWEEN 3 AND 1000
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  result_schedule_id uuid REFERENCES public.budget_cycle_schedules(id)
    ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(budget_account_id,idempotency_key),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (state='APPROVED' AND result_schedule_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (state='REJECTED' AND result_schedule_id IS NULL AND decided_at IS NOT NULL)
    OR (state IN ('PENDING_COMPANY','PENDING_AXORA')
      AND result_schedule_id IS NULL AND decided_at IS NULL)
  )
);
CREATE INDEX budget_cycle_change_queue_idx
  ON public.budget_cycle_change_requests(company_id,state,created_at);

ALTER TABLE public.budget_cycle_schedules
  ADD CONSTRAINT budget_cycle_schedule_change_fk
  FOREIGN KEY(source_change_request_id)
  REFERENCES public.budget_cycle_change_requests(id) ON DELETE RESTRICT;

CREATE TABLE public.budget_cycle_change_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL
    REFERENCES public.budget_cycle_change_requests(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  state_before text NOT NULL,
  state_after text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT','ESCALATE')),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  decided_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  UNIQUE(change_request_id,idempotency_key)
);

CREATE TABLE public.budget_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  budget_period_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (
    state IN ('PENDING','LEASED','RETRY','SUCCEEDED','DEAD_LETTER','CANCELLED')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{2,64}$'
  ),
  result jsonb,
  completed_at timestamptz,
  manual_rerun_count integer NOT NULL DEFAULT 0 CHECK (manual_rerun_count>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(budget_account_id,due_at),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(budget_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT,
  FOREIGN KEY(schedule_id,budget_account_id)
    REFERENCES public.budget_cycle_schedules(id,budget_account_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='LEASED' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (state<>'LEASED' AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (
    (state='SUCCEEDED' AND completed_at IS NOT NULL AND result IS NOT NULL)
    OR (state<>'SUCCEEDED' AND completed_at IS NULL)
  )
);
CREATE INDEX budget_refresh_jobs_claim_idx
  ON public.budget_refresh_jobs(state,next_attempt_at,due_at)
  WHERE state IN ('PENDING','RETRY','LEASED');

CREATE TABLE public.budget_refresh_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.budget_refresh_jobs(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN (
      'ENQUEUED','LEASED','SUCCEEDED','RETRY_SCHEDULED','DEAD_LETTERED',
      'MANUAL_RERUN','RECONCILED'
    )
  ),
  attempt_count integer NOT NULL CHECK (attempt_count>=0),
  worker_id text,
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object')
);
CREATE INDEX budget_refresh_job_events_job_idx
  ON public.budget_refresh_job_events(job_id,occurred_at,id);

CREATE TABLE public.budget_alert_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  budget_account_id uuid NOT NULL,
  budget_period_id uuid NOT NULL,
  threshold_code text NOT NULL CHECK (
    threshold_code IN ('LOW','CRITICAL','ZERO','NEGATIVE')
  ),
  threshold_percentage numeric(7,4),
  active boolean NOT NULL DEFAULT false,
  notification_count integer NOT NULL DEFAULT 0 CHECK (notification_count>=0),
  last_percentage numeric(12,6),
  last_available numeric(18,2) NOT NULL,
  first_crossed_at timestamptz,
  last_notified_at timestamptz,
  rearmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(budget_period_id,threshold_code),
  FOREIGN KEY(budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(budget_period_id,budget_account_id)
    REFERENCES public.budget_periods(id,budget_account_id) ON DELETE RESTRICT
);

CREATE TABLE public.budget_reservation_rollovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL
    REFERENCES public.budget_reservations(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  from_period_id uuid NOT NULL REFERENCES public.budget_periods(id) ON DELETE RESTRICT,
  to_period_id uuid NOT NULL REFERENCES public.budget_periods(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount>0),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reservation_id,from_period_id,to_period_id)
);

ALTER TABLE public.budget_reservation_events
  DROP CONSTRAINT budget_reservation_events_event_type_check,
  ADD CONSTRAINT budget_reservation_events_event_type_check CHECK (
    event_type IN (
      'CREATED','INCREASED','REDUCED','FINALIZED','RELEASED',
      'ADDITIONAL_APPROVAL_REQUIRED','ROLLED_FORWARD','REFUNDED'
    )
  );

CREATE TABLE public.procurement_variance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version>0),
  tolerance_mode text NOT NULL CHECK (
    tolerance_mode IN ('NONE','FIXED','PERCENTAGE','LOWER_ONLY')
  ),
  fixed_tolerance numeric(18,2),
  percentage_tolerance numeric(7,4),
  effective_at timestamptz NOT NULL,
  source_change_request_id uuid,
  approved_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  approval_reason text NOT NULL CHECK (
    char_length(btrim(approval_reason)) BETWEEN 3 AND 1000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,policy_version),
  CHECK (
    (tolerance_mode='FIXED' AND fixed_tolerance>=0)
    OR (tolerance_mode<>'FIXED' AND fixed_tolerance IS NULL)
  ),
  CHECK (
    (tolerance_mode='PERCENTAGE'
      AND percentage_tolerance>=0 AND percentage_tolerance<=100)
    OR (tolerance_mode<>'PERCENTAGE' AND percentage_tolerance IS NULL)
  )
);

INSERT INTO public.procurement_variance_policies(
  company_id,policy_version,tolerance_mode,effective_at,approval_reason
)
SELECT company.id,1,'NONE',now(),
  'Opening strict variance policy preserves existing additional-actual approval behavior'
FROM public.companies company;

CREATE OR REPLACE FUNCTION public.axora_seed_variance_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  INSERT INTO public.procurement_variance_policies(
    company_id,policy_version,tolerance_mode,effective_at,approval_reason
  ) VALUES (
    NEW.id,1,'NONE',now(),
    'Opening strict variance policy for a new company'
  ) ON CONFLICT(company_id,policy_version) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER seed_variance_policy
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_variance_policy();

CREATE TABLE public.procurement_variance_policy_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  expected_policy_version integer NOT NULL CHECK (expected_policy_version>0),
  proposed_policy jsonb NOT NULL CHECK (jsonb_typeof(proposed_policy)='object'),
  proposed_effective_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING_COMPANY','APPROVED','REJECTED')),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  request_reason text NOT NULL CHECK (
    char_length(btrim(request_reason)) BETWEEN 3 AND 1000
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  result_policy_id uuid REFERENCES public.procurement_variance_policies(id)
    ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,idempotency_key)
);

ALTER TABLE public.procurement_variance_policies
  ADD CONSTRAINT procurement_variance_policy_change_fk
  FOREIGN KEY(source_change_request_id)
  REFERENCES public.procurement_variance_policy_changes(id) ON DELETE RESTRICT;

CREATE TABLE public.procurement_variance_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL
    REFERENCES public.procurement_variance_policy_changes(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(change_request_id,idempotency_key)
);

CREATE TABLE public.fulfilment_purchase_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  assigned_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('ASSIGNED','COMPLETED','CANCELLED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,request_version,idempotency_key),
  CHECK (
    (status='COMPLETED' AND completed_at IS NOT NULL)
    OR (status<>'COMPLETED' AND completed_at IS NULL)
  )
);
CREATE UNIQUE INDEX fulfilment_purchase_assignment_active_uq
  ON public.fulfilment_purchase_assignments(request_id,request_version)
  WHERE status='ASSIGNED';

CREATE TABLE public.request_actual_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_version integer NOT NULL CHECK (request_version>0),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL
    REFERENCES public.fulfilment_purchase_assignments(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL
    REFERENCES public.budget_reservations(id) ON DELETE RESTRICT,
  variance_policy_id uuid NOT NULL
    REFERENCES public.procurement_variance_policies(id) ON DELETE RESTRICT,
  variance_policy_version integer NOT NULL CHECK (variance_policy_version>0),
  purchase_mode text NOT NULL CHECK (
    purchase_mode IN ('PARTIAL','FINAL','REFUND')
  ),
  estimate_amount numeric(18,2) NOT NULL CHECK (estimate_amount>=0),
  previous_actual_amount numeric(18,2) NOT NULL CHECK (previous_actual_amount>=0),
  submission_amount numeric(18,2) NOT NULL CHECK (submission_amount>=0),
  cumulative_actual_amount numeric(18,2) NOT NULL CHECK (cumulative_actual_amount>=0),
  difference_amount numeric(18,2) NOT NULL,
  within_tolerance boolean NOT NULL,
  substitute_present boolean NOT NULL DEFAULT false,
  receipt_attachment_id uuid NOT NULL
    REFERENCES public.attachments(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (
    state IN (
      'PENDING_COMPANY','PENDING_AXORA','FINALIZED','RETURNED','REJECTED'
    )
  ),
  approval_revision integer NOT NULL DEFAULT 1 CHECK (approval_revision>0),
  approved_funding_option text CHECK (
    approved_funding_option IS NULL OR approved_funding_option IN (
      'APPROVE_ADDITIONAL','TRANSFER_RESERVE','TEMPORARY_INCREASE'
    )
  ),
  approved_source_budget_account_id uuid
    REFERENCES public.budget_accounts(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  submitted_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  notes text NOT NULL CHECK (char_length(btrim(notes)) BETWEEN 3 AND 2000),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  correlation_id uuid NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result)='object'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,idempotency_key),
  CHECK (
    (state='FINALIZED' AND finalized_at IS NOT NULL)
    OR (state<>'FINALIZED' AND finalized_at IS NULL)
  )
);
CREATE UNIQUE INDEX request_actual_one_pending_uq
  ON public.request_actual_submissions(request_id)
  WHERE state IN ('PENDING_COMPANY','PENDING_AXORA');

CREATE TABLE public.request_actual_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.request_actual_submissions(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL REFERENCES public.request_lines(id) ON DELETE RESTRICT,
  estimated_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  actual_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity>0),
  unit_of_measure text NOT NULL,
  actual_buy_unit_price numeric(18,6) NOT NULL CHECK (actual_buy_unit_price>=0),
  markup_percentage_snapshot numeric(9,4) NOT NULL CHECK (markup_percentage_snapshot>=0),
  rounding_scale_snapshot integer NOT NULL CHECK (rounding_scale_snapshot BETWEEN 0 AND 4),
  customer_unit_price numeric(18,4) NOT NULL CHECK (customer_unit_price>=0),
  tax_rate numeric(7,4) NOT NULL CHECK (tax_rate>=0 AND tax_rate<=100),
  tax_amount numeric(18,2) NOT NULL CHECK (tax_amount>=0),
  delivery_charge numeric(18,2) NOT NULL CHECK (delivery_charge>=0),
  other_charge numeric(18,2) NOT NULL CHECK (other_charge>=0),
  line_total numeric(18,2) NOT NULL CHECK (line_total>=0),
  substitute_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (actual_product_id=estimated_product_id AND substitute_reason IS NULL)
    OR (actual_product_id<>estimated_product_id
      AND char_length(btrim(substitute_reason)) BETWEEN 3 AND 1000)
  )
);
CREATE INDEX request_actual_lines_submission_idx
  ON public.request_actual_lines(submission_id,request_line_id,id);

CREATE TABLE public.request_actual_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.request_actual_submissions(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  approval_revision_before integer NOT NULL CHECK (approval_revision_before>0),
  approval_revision_after integer NOT NULL CHECK (
    approval_revision_after>approval_revision_before
  ),
  state_before text NOT NULL,
  state_after text NOT NULL,
  decision text NOT NULL CHECK (
    decision IN ('APPROVE','RETURN','REJECT','ESCALATE','AUTO_FINALIZE')
  ),
  funding_option text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  system_job text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(submission_id,idempotency_key),
  CHECK (actor_user_id IS NOT NULL OR system_job IS NOT NULL)
);

CREATE TABLE public.budget_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  target_budget_account_id uuid NOT NULL,
  source_budget_account_id uuid,
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN ('ONE_TIME','TEMPORARY','PERMANENT','TRANSFER')
  ),
  amount numeric(18,2) NOT NULL CHECK (amount>0),
  effective_until timestamptz,
  state text NOT NULL CHECK (
    state IN ('PENDING_COMPANY','PENDING_AXORA','APPROVED','REJECTED','RETURNED')
  ),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  request_reason text NOT NULL CHECK (
    char_length(btrim(request_reason)) BETWEEN 3 AND 1000
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  correlation_id uuid NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result)='object'),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(target_budget_account_id,idempotency_key),
  FOREIGN KEY(target_budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_budget_account_id,company_id)
    REFERENCES public.budget_accounts(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (adjustment_type='TRANSFER' AND source_budget_account_id IS NOT NULL
      AND source_budget_account_id<>target_budget_account_id)
    OR (adjustment_type<>'TRANSFER' AND source_budget_account_id IS NULL)
  ),
  CHECK (
    (adjustment_type='TEMPORARY' AND effective_until IS NOT NULL)
    OR (adjustment_type<>'TEMPORARY' AND effective_until IS NULL)
  )
);
CREATE INDEX budget_adjustment_queue_idx
  ON public.budget_adjustment_requests(company_id,state,created_at);

CREATE TABLE public.budget_adjustment_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_request_id uuid NOT NULL
    REFERENCES public.budget_adjustment_requests(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  state_before text NOT NULL,
  state_after text NOT NULL,
  decision text NOT NULL CHECK (
    decision IN ('APPROVE','REJECT','RETURN','ESCALATE')
  ),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(adjustment_request_id,idempotency_key)
);

CREATE OR REPLACE FUNCTION public.axora_reject_p1_procurement_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Procurement configuration and decision evidence is append-only';
END $$;

CREATE TRIGGER budget_cycle_schedules_append_only
BEFORE UPDATE OR DELETE ON public.budget_cycle_schedules
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER budget_cycle_change_decisions_append_only
BEFORE UPDATE OR DELETE ON public.budget_cycle_change_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER budget_refresh_job_events_append_only
BEFORE UPDATE OR DELETE ON public.budget_refresh_job_events
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER budget_reservation_rollovers_append_only
BEFORE UPDATE OR DELETE ON public.budget_reservation_rollovers
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER procurement_variance_policies_append_only
BEFORE UPDATE OR DELETE ON public.procurement_variance_policies
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER procurement_variance_policy_decisions_append_only
BEFORE UPDATE OR DELETE ON public.procurement_variance_policy_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER request_actual_lines_append_only
BEFORE UPDATE OR DELETE ON public.request_actual_lines
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER request_actual_decisions_append_only
BEFORE UPDATE OR DELETE ON public.request_actual_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();
CREATE TRIGGER budget_adjustment_decisions_append_only
BEFORE UPDATE OR DELETE ON public.budget_adjustment_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_p1_procurement_evidence_change();

CREATE OR REPLACE FUNCTION public.axora_record_p1_procurement_audit(
  p_entity_type text,p_record_id uuid,p_action text,p_actor_user_id uuid,
  p_company_id uuid,p_request_id uuid,p_reason text,p_summary jsonb
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,actor_id,company_id,reason,new_values,
    related_request_id
  ) VALUES (
    left(p_entity_type,100),p_record_id,left(p_action,40),p_actor_user_id,
    p_company_id,left(btrim(p_reason),1000),
    COALESCE(p_summary,'{}'::jsonb),p_request_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_resolve_budget_local_boundary(
  p_local timestamp without time zone,p_timezone text,p_resolution text
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
STRICT
AS $$
DECLARE
  default_candidate timestamptz;
  earlier_candidate timestamptz;
  later_candidate timestamptz;
BEGIN
  IF p_resolution NOT IN ('EARLIER','LATER') THEN
    RAISE EXCEPTION 'The DST boundary policy is invalid';
  END IF;
  BEGIN
    default_candidate:=p_local AT TIME ZONE p_timezone;
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'The IANA timezone is invalid';
  END;
  SELECT min(candidate),max(candidate)
  INTO earlier_candidate,later_candidate
  FROM (
    SELECT default_candidate+make_interval(mins=>offset_minute) AS candidate
    FROM generate_series(-180,180) AS offset_minute
  ) candidates
  WHERE candidate AT TIME ZONE p_timezone=p_local;
  -- PostgreSQL shifts a nonexistent wall time through the DST gap. Retain that
  -- deterministic forward resolution; ambiguous times use the explicit policy.
  IF earlier_candidate IS NULL THEN RETURN default_candidate; END IF;
  RETURN CASE WHEN p_resolution='LATER'
    THEN later_candidate ELSE earlier_candidate END;
END $$;

CREATE OR REPLACE FUNCTION public.axora_next_budget_boundary(
  p_schedule_id uuid,p_after timestamptz
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
STRICT
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  schedule public.budget_cycle_schedules%ROWTYPE;
  candidate_local timestamp without time zone;
  candidate timestamptz;
  sequence_number integer:=1;
BEGIN
  SELECT * INTO schedule
  FROM public.budget_cycle_schedules WHERE id=p_schedule_id;
  IF schedule.id IS NULL THEN RAISE EXCEPTION 'The budget schedule is unavailable'; END IF;
  LOOP
    candidate_local:=CASE schedule.frequency
      WHEN 'WEEKLY' THEN schedule.anchor_local
        +make_interval(days=>7*schedule.interval_count*sequence_number)
      WHEN 'MONTHLY' THEN schedule.anchor_local
        +make_interval(months=>schedule.interval_count*sequence_number)
      WHEN 'QUARTERLY' THEN schedule.anchor_local
        +make_interval(months=>3*schedule.interval_count*sequence_number)
      WHEN 'YEARLY' THEN schedule.anchor_local
        +make_interval(years=>schedule.interval_count*sequence_number)
      ELSE schedule.anchor_local+make_interval(
        days=>COALESCE(schedule.custom_interval_days,30)*sequence_number
      )
    END;
    candidate:=public.axora_resolve_budget_local_boundary(
      candidate_local,schedule.timezone,schedule.dst_resolution
    );
    IF candidate>p_after THEN RETURN candidate; END IF;
    sequence_number:=sequence_number+1;
    IF sequence_number>100000 THEN
      RAISE EXCEPTION 'The next budget boundary cannot be resolved';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_p1_notification_copy(
  p_event_key text,p_locale text,p_subject text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE subject text:=left(p_subject,120);
BEGIN
  IF p_locale='ar' THEN
    RETURN CASE p_event_key
      WHEN 'budget.low' THEN jsonb_build_object('title','تنبيه انخفاض الميزانية','body','انخفض الرصيد المتاح لـ '||subject||'.')
      WHEN 'budget.zero' THEN jsonb_build_object('title','نفاد الميزانية','body','بلغ الرصيد المتاح لـ '||subject||' صفراً.')
      WHEN 'budget.refreshed' THEN jsonb_build_object('title','تم تجديد الميزانية','body','تم فتح فترة ميزانية جديدة لـ '||subject||'.')
      WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','فشل تجديد الميزانية','body','تحتاج مهمة تجديد '||subject||' إلى مراجعة.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','موافقة مبلغ إضافي مطلوبة','body','تحتاج التكلفة الفعلية لـ '||subject||' إلى موافقة.')
      WHEN 'approval.substitute_required' THEN jsonb_build_object('title','موافقة بديل مطلوبة','body','يتضمن الشراء الفعلي لـ '||subject||' منتجاً بديلاً.')
      WHEN 'request.approved' THEN jsonb_build_object('title','تم اعتماد التكلفة الفعلية','body','تم تسجيل التكلفة الفعلية لـ '||subject||'.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','تم رفض التكلفة الفعلية','body','تم رفض التكلفة الفعلية لـ '||subject||'.')
      WHEN 'request.returned' THEN jsonb_build_object('title','أعيدت التكلفة الفعلية','body','أعيدت التكلفة الفعلية لـ '||subject||' للتعديل.')
      ELSE jsonb_build_object('title','تحديث الميزانية','body','تم تحديث سير عمل الميزانية لـ '||subject||'.') END;
  ELSIF p_locale='ms' THEN
    RETURN CASE p_event_key
      WHEN 'budget.low' THEN jsonb_build_object('title','Amaran bajet rendah','body','Baki tersedia untuk '||subject||' telah menurun.')
      WHEN 'budget.zero' THEN jsonb_build_object('title','Bajet sifar','body','Baki tersedia untuk '||subject||' kini sifar.')
      WHEN 'budget.refreshed' THEN jsonb_build_object('title','Bajet diperbaharui','body','Tempoh bajet baharu dibuka untuk '||subject||'.')
      WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','Pembaharuan bajet gagal','body','Tugas pembaharuan '||subject||' perlu disemak.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Kelulusan amaun tambahan diperlukan','body','Kos sebenar untuk '||subject||' memerlukan kelulusan.')
      WHEN 'approval.substitute_required' THEN jsonb_build_object('title','Kelulusan pengganti diperlukan','body','Pembelian sebenar untuk '||subject||' mengandungi produk pengganti.')
      WHEN 'request.approved' THEN jsonb_build_object('title','Kos sebenar diluluskan','body','Kos sebenar untuk '||subject||' telah direkodkan.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','Kos sebenar ditolak','body','Kos sebenar untuk '||subject||' telah ditolak.')
      WHEN 'request.returned' THEN jsonb_build_object('title','Kos sebenar dikembalikan','body','Kos sebenar untuk '||subject||' dikembalikan untuk perubahan.')
      ELSE jsonb_build_object('title','Kemas kini bajet','body','Aliran kerja bajet untuk '||subject||' telah dikemas kini.') END;
  END IF;
  RETURN CASE p_event_key
    WHEN 'budget.low' THEN jsonb_build_object('title','Low budget alert','body','Available balance for '||subject||' has crossed a configured threshold.')
    WHEN 'budget.zero' THEN jsonb_build_object('title','Budget at zero','body','Available balance for '||subject||' is now zero.')
    WHEN 'budget.refreshed' THEN jsonb_build_object('title','Budget refreshed','body','A new budget period was opened for '||subject||'.')
    WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','Budget refresh failed','body','The refresh job for '||subject||' needs review.')
    WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Additional amount approval required','body','Actual cost for '||subject||' requires approval.')
    WHEN 'approval.substitute_required' THEN jsonb_build_object('title','Substitute approval required','body','The actual purchase for '||subject||' contains a substitute product.')
    WHEN 'request.approved' THEN jsonb_build_object('title','Actual cost approved','body','Actual cost for '||subject||' was recorded.')
    WHEN 'request.rejected' THEN jsonb_build_object('title','Actual cost rejected','body','Actual cost for '||subject||' was rejected.')
    WHEN 'request.returned' THEN jsonb_build_object('title','Actual cost returned','body','Actual cost for '||subject||' was returned for changes.')
    ELSE jsonb_build_object('title','Budget workflow update','body','The budget workflow for '||subject||' was updated.') END;
END $$;

CREATE OR REPLACE FUNCTION public.axora_emit_p1_notification(
  p_company_id uuid,p_branch_id uuid,p_request_id uuid,p_aggregate_type text,
  p_aggregate_id uuid,p_event_key text,p_dedupe_key text,p_subject text,
  p_route_path text,p_recipient_ids uuid[],p_actor_user_id uuid,
  p_correlation_id uuid,p_at timestamptz,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  event_id uuid;
  next_version integer;
  recipient_id uuid;
  selected_locale text;
  copy jsonb;
  actor_kind_value text;
  recipient_dedupe text;
BEGIN
  IF p_company_id IS NULL OR p_aggregate_id IS NULL
    OR p_event_key !~ '^[a-z][a-z0-9_.-]{1,119}$'
    OR char_length(p_dedupe_key) NOT BETWEEN 8 AND 160
    OR jsonb_typeof(COALESCE(p_metadata,'{}'::jsonb))<>'object' THEN
    RAISE EXCEPTION 'The workflow notification is invalid';
  END IF;
  IF p_actor_user_id IS NOT NULL THEN
    PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::text||':'||p_aggregate_type||':'||p_aggregate_id::text,0
  ));
  SELECT id INTO event_id FROM public.workflow_events
  WHERE company_id=p_company_id AND idempotency_key=p_dedupe_key;
  IF event_id IS NULL THEN
    SELECT COALESCE(max(event_version),0)+1 INTO next_version
    FROM public.workflow_events
    WHERE company_id=p_company_id AND aggregate_type=p_aggregate_type
      AND aggregate_id=p_aggregate_id;
    SELECT account_kind INTO actor_kind_value FROM public.users
    WHERE id=p_actor_user_id AND active AND account_status='ACTIVE';
    event_id:=gen_random_uuid();
    INSERT INTO public.workflow_events(
      id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
      event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
      occurred_at,metadata
    ) VALUES (
      event_id,p_company_id,p_branch_id,p_request_id,p_aggregate_type,
      p_aggregate_id,p_event_key,next_version,
      CASE WHEN actor_kind_value IS NULL THEN NULL ELSE p_actor_user_id END,
      COALESCE(actor_kind_value,'SYSTEM'),p_correlation_id,p_dedupe_key,
      least(p_at,clock_timestamp()),
      COALESCE(p_metadata,'{}'::jsonb)
    );
  END IF;
  FOREACH recipient_id IN ARRAY COALESCE(p_recipient_ids,ARRAY[]::uuid[]) LOOP
    IF recipient_id IS NULL THEN CONTINUE; END IF;
    SELECT COALESCE(profile.preferred_locale,'en') INTO selected_locale
    FROM public.user_profiles profile WHERE profile.user_id=recipient_id;
    selected_locale:=CASE WHEN selected_locale IN ('en','ar','ms')
      THEN selected_locale ELSE 'en' END;
    copy:=public.axora_p1_notification_copy(
      p_event_key,selected_locale,p_subject
    );
    recipient_dedupe:=p_dedupe_key||':'||recipient_id::text;
    INSERT INTO public.in_app_notifications(
      company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
      title,body,priority,route_path,created_at
    ) VALUES (
      p_company_id,recipient_id,event_id,p_event_key,recipient_dedupe,
      copy->>'title',copy->>'body',public.axora_email_priority(p_event_key),
      p_route_path,least(p_at,clock_timestamp())
    ) ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING;
    PERFORM public.axora_enqueue_workflow_email(
      p_company_id,event_id,recipient_id,p_event_key,recipient_dedupe,
      copy->>'title',copy->>'body',p_route_path
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_budget_notification_recipients(
  p_budget_account_id uuid,p_permission text,p_extra_recipient uuid,
  p_at timestamptz
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT recipients.user_id ORDER BY recipients.user_id),
    ARRAY[]::uuid[])
  FROM (
    SELECT assignment.user_id
    FROM public.budget_accounts account
    JOIN public.role_assignments assignment
      ON assignment.active AND assignment.revoked_at IS NULL
    JOIN public.users user_account ON user_account.id=assignment.user_id
      AND user_account.active AND user_account.account_status='ACTIVE'
    WHERE account.id=p_budget_account_id
      AND public.axora_budget_account_permission(
        public.axora_live_authorization_snapshot(
          assignment.user_id,assignment.id,p_at
        ),
        p_permission,account.level_type,account.company_id,
        account.branch_id,account.department_id
      )
    UNION ALL
    SELECT p_extra_recipient WHERE p_extra_recipient IS NOT NULL
  ) recipients
$$;

CREATE OR REPLACE FUNCTION public.axora_emit_budget_notification(
  p_budget_account_id uuid,p_event_key text,p_dedupe_key text,
  p_extra_recipient uuid,p_actor_user_id uuid,p_correlation_id uuid,
  p_at timestamptz,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE account public.budget_accounts%ROWTYPE;
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
    p_actor_user_id,p_correlation_id,p_at,p_metadata
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_seed_budget_period_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE account public.budget_accounts%ROWTYPE; selected_schedule_id uuid;
BEGIN
  IF NEW.schedule_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO account FROM public.budget_accounts WHERE id=NEW.budget_account_id;
  SELECT id INTO selected_schedule_id FROM public.budget_cycle_schedules
  WHERE budget_account_id=NEW.budget_account_id
  ORDER BY schedule_version DESC LIMIT 1;
  IF selected_schedule_id IS NULL THEN
    INSERT INTO public.budget_cycle_schedules(
      company_id,budget_account_id,schedule_version,frequency,interval_count,
      custom_interval_days,timezone,anchor_local,dst_resolution,
      fixed_allocation,rollover_mode,rollover_percentage,
      custom_rollover_amount,effective_at,approval_reason
    ) VALUES (
      account.company_id,account.id,1,
      CASE account.refresh_interval
        WHEN 'ANNUAL' THEN 'YEARLY'
        WHEN 'MANUAL' THEN 'MANUAL'
        ELSE account.refresh_interval END,
      1,NULL,account.period_timezone,
      NEW.ends_at AT TIME ZONE account.period_timezone,'EARLIER',
      account.recurring_allocation,
      CASE account.rollover_policy WHEN 'FULL' THEN 'FULL'
        WHEN 'CAPPED' THEN 'CUSTOM_AMOUNT' ELSE 'RESET_FIXED' END,
      NULL,CASE WHEN account.rollover_policy='CAPPED'
        THEN account.rollover_cap END,
      NEW.starts_at,'Opening cycle schedule for a new budget account'
    ) RETURNING id INTO selected_schedule_id;
  END IF;
  UPDATE public.budget_periods period
  SET schedule_id=schedule.id,schedule_version=schedule.schedule_version
  FROM public.budget_cycle_schedules schedule
  WHERE period.id=NEW.id AND schedule.id=selected_schedule_id;
  RETURN NEW;
END $$;
CREATE TRIGGER seed_budget_period_schedule
AFTER INSERT ON public.budget_periods
FOR EACH ROW EXECUTE FUNCTION public.axora_seed_budget_period_schedule();

CREATE OR REPLACE FUNCTION public.axora_request_budget_cycle_change(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_config jsonb,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  account public.budget_accounts%ROWTYPE;
  period public.budget_periods%ROWTYPE;
  current_schedule public.budget_cycle_schedules%ROWTYPE;
  existing public.budget_cycle_change_requests%ROWTYPE;
  frequency_value text;
  interval_value integer;
  custom_days integer;
  timezone_value text;
  anchor_value timestamp without time zone;
  dst_value text;
  fixed_value numeric(18,2);
  rollover_value text;
  rollover_percentage_value numeric(7,4);
  custom_rollover_value numeric(18,2);
  low_value numeric(7,4);
  critical_value numeric(7,4);
  hysteresis_value numeric(7,4);
  effective_value timestamptz;
  change_id uuid:=gen_random_uuid();
  result jsonb;
BEGIN
  IF jsonb_typeof(p_config)<>'object'
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget cycle change is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active FOR UPDATE;
  IF snapshot IS NULL OR account.id IS NULL
    OR NOT public.axora_budget_account_permission(
      snapshot,'budget.refresh',account.level_type,account.company_id,
      account.branch_id,account.department_id
    ) THEN RAISE EXCEPTION 'The budget cycle is unavailable'; END IF;
  SELECT * INTO existing FROM public.budget_cycle_change_requests
  WHERE budget_account_id=account.id AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.requested_by<>p_actor_user_id
      OR existing.requested_by_role_assignment_id<>p_actor_role_assignment_id THEN
      RAISE EXCEPTION 'The budget cycle is unavailable';
    END IF;
    RETURN jsonb_build_object('changeRequestId',existing.id,'state',existing.state);
  END IF;
  SELECT * INTO current_schedule FROM public.budget_cycle_schedules
  WHERE budget_account_id=account.id AND effective_at<=p_at
  ORDER BY effective_at DESC,schedule_version DESC LIMIT 1;
  SELECT * INTO period FROM public.budget_periods
  WHERE budget_account_id=account.id AND status='ACTIVE' FOR UPDATE;
  frequency_value:=upper(COALESCE(p_config->>'frequency',''));
  interval_value:=COALESCE((p_config->>'intervalCount')::integer,1);
  custom_days:=NULLIF(p_config->>'customIntervalDays','')::integer;
  timezone_value:=btrim(COALESCE(p_config->>'timezone',''));
  anchor_value:=COALESCE(
    NULLIF(p_config->>'anchorLocal','')::timestamp,
    period.ends_at AT TIME ZONE timezone_value
  );
  dst_value:=upper(COALESCE(p_config->>'dstResolution','EARLIER'));
  fixed_value:=COALESCE((p_config->>'fixedAllocation')::numeric,0);
  rollover_value:=upper(COALESCE(p_config->>'rolloverMode',''));
  rollover_percentage_value:=NULLIF(
    p_config->>'rolloverPercentage',''
  )::numeric;
  custom_rollover_value:=NULLIF(
    p_config->>'customRolloverAmount',''
  )::numeric;
  low_value:=COALESCE((p_config->>'lowThresholdPercentage')::numeric,25);
  critical_value:=COALESCE(
    (p_config->>'criticalThresholdPercentage')::numeric,10
  );
  hysteresis_value:=COALESCE(
    (p_config->>'hysteresisPercentage')::numeric,5
  );
  PERFORM public.axora_resolve_budget_local_boundary(
    anchor_value,timezone_value,dst_value
  );
  effective_value:=CASE
    WHEN NULLIF(p_config->>'effectiveLocal','') IS NULL THEN period.ends_at
    ELSE public.axora_resolve_budget_local_boundary(
      (p_config->>'effectiveLocal')::timestamp,timezone_value,dst_value
    ) END;
  IF frequency_value NOT IN (
      'WEEKLY','MONTHLY','QUARTERLY','YEARLY','CUSTOM','MANUAL'
    )
    OR interval_value NOT BETWEEN 1 AND 52
    OR (frequency_value='CUSTOM' AND custom_days NOT BETWEEN 1 AND 3660)
    OR (frequency_value<>'CUSTOM' AND custom_days IS NOT NULL)
    OR fixed_value<0 OR fixed_value<>round(fixed_value,2)
    OR rollover_value NOT IN (
      'RESET_FIXED','FULL','NONE','PARTIAL_PERCENT','CUSTOM_AMOUNT'
    )
    OR (rollover_value='PARTIAL_PERCENT'
      AND (rollover_percentage_value<=0 OR rollover_percentage_value>=100))
    OR (rollover_value<>'PARTIAL_PERCENT'
      AND rollover_percentage_value IS NOT NULL)
    OR (rollover_value='CUSTOM_AMOUNT' AND custom_rollover_value<0)
    OR (rollover_value<>'CUSTOM_AMOUNT' AND custom_rollover_value IS NOT NULL)
    OR critical_value<=0 OR low_value<=critical_value OR low_value>=100
    OR hysteresis_value<=0 OR hysteresis_value>25
    OR effective_value<p_at-interval '5 minutes' THEN
    RAISE EXCEPTION 'The budget cycle configuration is invalid';
  END IF;
  INSERT INTO public.budget_cycle_change_requests(
    id,company_id,budget_account_id,expected_schedule_version,proposed_config,
    proposed_effective_at,state,requested_by,requested_by_role_assignment_id,
    request_reason,idempotency_key
  ) VALUES (
    change_id,account.company_id,account.id,current_schedule.schedule_version,
    jsonb_build_object(
      'frequency',frequency_value,'intervalCount',interval_value,
      'customIntervalDays',custom_days,'timezone',timezone_value,
      'anchorLocal',anchor_value,'dstResolution',dst_value,
      'fixedAllocation',fixed_value,'rolloverMode',rollover_value,
      'rolloverPercentage',rollover_percentage_value,
      'customRolloverAmount',custom_rollover_value,
      'lowThresholdPercentage',low_value,
      'criticalThresholdPercentage',critical_value,
      'hysteresisPercentage',hysteresis_value
    ),
    effective_value,'PENDING_COMPANY',p_actor_user_id,
    p_actor_role_assignment_id,btrim(p_reason),p_idempotency_key
  );
  result:=jsonb_build_object(
    'changeRequestId',change_id,'state','PENDING_COMPANY',
    'effectiveAt',effective_value
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'budget_cycle_change_requests',change_id,'REQUEST',p_actor_user_id,
    account.company_id,NULL,p_reason,
    jsonb_build_object('budgetAccountId',account.id,'state','PENDING_COMPANY')
  );
  PERFORM public.axora_emit_budget_notification(
    account.id,'budget.schedule_change_requested',
    'budget-cycle-request:'||change_id::text,p_actor_user_id,p_actor_user_id,
    gen_random_uuid(),p_at,jsonb_build_object('changeRequestId',change_id)
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_decide_budget_cycle_change(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_change_request_id uuid,
  p_decision text,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  change_request public.budget_cycle_change_requests%ROWTYPE;
  account public.budget_accounts%ROWTYPE;
  company_ceiling numeric(18,2);
  next_state text;
  action_value text;
  next_version integer;
  schedule_id uuid;
  correlation uuid:=gen_random_uuid();
  existing_decision public.budget_cycle_change_decisions%ROWTYPE;
  authorization_state text;
  result jsonb;
  config jsonb;
BEGIN
  IF upper(p_decision) NOT IN ('APPROVE','REJECT')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget cycle decision is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO change_request FROM public.budget_cycle_change_requests
  WHERE id=p_change_request_id FOR UPDATE;
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=change_request.budget_account_id FOR UPDATE;
  IF snapshot IS NULL OR change_request.id IS NULL OR account.id IS NULL
    OR change_request.requested_by=p_actor_user_id THEN
    RAISE EXCEPTION 'The budget cycle change is unavailable';
  END IF;
  SELECT * INTO existing_decision
  FROM public.budget_cycle_change_decisions decision
  WHERE decision.change_request_id=change_request.id
    AND decision.idempotency_key=p_idempotency_key;
  IF existing_decision.id IS NOT NULL AND (
    existing_decision.actor_user_id<>p_actor_user_id
    OR existing_decision.actor_role_assignment_id<>p_actor_role_assignment_id
  ) THEN RAISE EXCEPTION 'The budget cycle change is unavailable'; END IF;
  authorization_state:=COALESCE(existing_decision.state_before,change_request.state);
  IF authorization_state NOT IN ('PENDING_COMPANY','PENDING_AXORA') THEN
    RAISE EXCEPTION 'The budget cycle change is unavailable';
  END IF;
  IF authorization_state='PENDING_COMPANY' THEN
    IF NOT public.axora_budget_account_permission(
      snapshot,'budget.assign',account.level_type,account.company_id,
      account.branch_id,account.department_id
    ) THEN RAISE EXCEPTION 'The budget cycle change is unavailable'; END IF;
  ELSIF NOT public.axora_snapshot_has_permission(
    snapshot,'commercial.company_ceiling.override','PLATFORM',
    NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'The budget cycle change is unavailable'; END IF;
  IF existing_decision.id IS NOT NULL THEN RETURN existing_decision.result; END IF;
  config:=change_request.proposed_config;
  SELECT contractual_ceiling INTO company_ceiling
  FROM public.companies WHERE id=account.company_id FOR KEY SHARE;
  IF upper(p_decision)='REJECT' THEN
    next_state:='REJECTED';
    action_value:='REJECT';
  ELSIF change_request.state='PENDING_COMPANY'
    AND (
      (config->>'fixedAllocation')::numeric
      +COALESCE((config->>'customRolloverAmount')::numeric,0)
    )>company_ceiling THEN
    next_state:='PENDING_AXORA';
    action_value:='ESCALATE';
  ELSE
    SELECT COALESCE(max(schedule_version),0)+1 INTO next_version
    FROM public.budget_cycle_schedules
    WHERE budget_account_id=account.id;
    IF next_version<>change_request.expected_schedule_version+1 THEN
      RAISE EXCEPTION 'The budget schedule changed before this decision';
    END IF;
    schedule_id:=gen_random_uuid();
    INSERT INTO public.budget_cycle_schedules(
      id,company_id,budget_account_id,schedule_version,frequency,
      interval_count,custom_interval_days,timezone,anchor_local,
      dst_resolution,fixed_allocation,rollover_mode,rollover_percentage,
      custom_rollover_amount,low_threshold_percentage,
      critical_threshold_percentage,hysteresis_percentage,effective_at,
      source_change_request_id,approved_by,approved_by_role_assignment_id,
      approval_reason
    ) VALUES (
      schedule_id,account.company_id,account.id,next_version,
      config->>'frequency',(config->>'intervalCount')::integer,
      (config->>'customIntervalDays')::integer,config->>'timezone',
      (config->>'anchorLocal')::timestamp,config->>'dstResolution',
      (config->>'fixedAllocation')::numeric,config->>'rolloverMode',
      (config->>'rolloverPercentage')::numeric,
      (config->>'customRolloverAmount')::numeric,
      (config->>'lowThresholdPercentage')::numeric,
      (config->>'criticalThresholdPercentage')::numeric,
      (config->>'hysteresisPercentage')::numeric,
      change_request.proposed_effective_at,change_request.id,p_actor_user_id,
      p_actor_role_assignment_id,btrim(p_reason)
    );
    next_state:='APPROVED';
    action_value:='APPROVE';
  END IF;
  result:=jsonb_build_object(
    'changeRequestId',change_request.id,'state',next_state,
    'scheduleId',schedule_id,'correlationId',correlation
  );
  UPDATE public.budget_cycle_change_requests SET state=next_state,
    result_schedule_id=schedule_id,
    decided_at=CASE WHEN next_state IN ('APPROVED','REJECTED') THEN p_at END,
    updated_at=p_at
  WHERE id=change_request.id;
  INSERT INTO public.budget_cycle_change_decisions(
    change_request_id,company_id,state_before,state_after,decision,
    actor_user_id,actor_role_assignment_id,reason,correlation_id,
    idempotency_key,decided_at,result
  ) VALUES (
    change_request.id,account.company_id,change_request.state,next_state,
    action_value,p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
    correlation,p_idempotency_key,p_at,result
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'budget_cycle_change_requests',change_request.id,action_value,p_actor_user_id,
    account.company_id,NULL,p_reason,
    jsonb_build_object('budgetAccountId',account.id,'state',next_state)
  );
  PERFORM public.axora_emit_budget_notification(
    account.id,
    CASE WHEN next_state='REJECTED' THEN 'budget.schedule_change_rejected'
      WHEN next_state='PENDING_AXORA' THEN 'budget.schedule_change_blocked'
      ELSE 'budget.schedule_change_approved' END,
    'budget-cycle-decision:'||change_request.id::text||':'||
      change_request.state,
    change_request.requested_by,p_actor_user_id,correlation,p_at,
    jsonb_build_object('changeRequestId',change_request.id,'state',next_state)
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_current_variance_policy(
  p_company_id uuid,p_at timestamptz
) RETURNS public.procurement_variance_policies
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT policy FROM public.procurement_variance_policies policy
  WHERE policy.company_id=p_company_id AND policy.effective_at<=p_at
  ORDER BY policy.effective_at DESC,policy.policy_version DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.axora_request_variance_policy_change(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_policy jsonb,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  current_policy public.procurement_variance_policies%ROWTYPE;
  existing public.procurement_variance_policy_changes%ROWTYPE;
  mode_value text;
  fixed_value numeric(18,2);
  percentage_value numeric(7,4);
  effective_value timestamptz;
  change_id uuid:=gen_random_uuid();
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'budget.increase','COMPANY',p_company_id,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'The variance policy is unavailable'; END IF;
  SELECT * INTO existing FROM public.procurement_variance_policy_changes
  WHERE company_id=p_company_id AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.requested_by<>p_actor_user_id
      OR existing.requested_by_role_assignment_id<>p_actor_role_assignment_id THEN
      RAISE EXCEPTION 'The variance policy is unavailable';
    END IF;
    RETURN jsonb_build_object('changeRequestId',existing.id,'state',existing.state);
  END IF;
  SELECT * INTO current_policy
  FROM public.axora_current_variance_policy(p_company_id,p_at);
  mode_value:=upper(COALESCE(p_policy->>'toleranceMode',''));
  fixed_value:=NULLIF(p_policy->>'fixedTolerance','')::numeric;
  percentage_value:=NULLIF(p_policy->>'percentageTolerance','')::numeric;
  effective_value:=COALESCE(
    NULLIF(p_policy->>'effectiveAt','')::timestamptz,p_at
  );
  IF mode_value NOT IN ('NONE','FIXED','PERCENTAGE','LOWER_ONLY')
    OR (mode_value='FIXED' AND (fixed_value<0 OR fixed_value<>round(fixed_value,2)))
    OR (mode_value<>'FIXED' AND fixed_value IS NOT NULL)
    OR (mode_value='PERCENTAGE'
      AND (percentage_value<0 OR percentage_value>100))
    OR (mode_value<>'PERCENTAGE' AND percentage_value IS NOT NULL)
    OR effective_value<p_at-interval '5 minutes'
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The variance policy change is invalid';
  END IF;
  INSERT INTO public.procurement_variance_policy_changes(
    id,company_id,expected_policy_version,proposed_policy,
    proposed_effective_at,state,requested_by,requested_by_role_assignment_id,
    request_reason,idempotency_key
  ) VALUES (
    change_id,p_company_id,current_policy.policy_version,
    jsonb_build_object(
      'toleranceMode',mode_value,'fixedTolerance',fixed_value,
      'percentageTolerance',percentage_value
    ),
    effective_value,'PENDING_COMPANY',p_actor_user_id,
    p_actor_role_assignment_id,btrim(p_reason),p_idempotency_key
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'procurement_variance_policy_changes',change_id,'REQUEST',
    p_actor_user_id,p_company_id,NULL,p_reason,
    jsonb_build_object('state','PENDING_COMPANY','toleranceMode',mode_value)
  );
  RETURN jsonb_build_object('changeRequestId',change_id,'state','PENDING_COMPANY');
END $$;

CREATE OR REPLACE FUNCTION public.axora_decide_variance_policy_change(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_change_request_id uuid,
  p_decision text,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  change_request public.procurement_variance_policy_changes%ROWTYPE;
  existing_decision public.procurement_variance_policy_decisions%ROWTYPE;
  policy_id uuid;
  next_version integer;
  result jsonb;
  correlation uuid:=gen_random_uuid();
BEGIN
  IF upper(p_decision) NOT IN ('APPROVE','REJECT')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The variance policy change is unavailable';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO change_request FROM public.procurement_variance_policy_changes
  WHERE id=p_change_request_id FOR UPDATE;
  IF snapshot IS NULL OR change_request.id IS NULL
    OR change_request.requested_by=p_actor_user_id
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'request.approve.additional_actual','COMPANY',
      change_request.company_id,NULL,NULL,NULL
    )
    THEN
    RAISE EXCEPTION 'The variance policy change is unavailable';
  END IF;
  SELECT * INTO existing_decision
  FROM public.procurement_variance_policy_decisions decision
  WHERE decision.change_request_id=change_request.id
    AND decision.idempotency_key=p_idempotency_key;
  IF existing_decision.id IS NOT NULL THEN
    IF existing_decision.actor_user_id<>p_actor_user_id
      OR existing_decision.actor_role_assignment_id<>p_actor_role_assignment_id THEN
      RAISE EXCEPTION 'The variance policy change is unavailable';
    END IF;
    RETURN existing_decision.result;
  END IF;
  IF change_request.state<>'PENDING_COMPANY' THEN
    RAISE EXCEPTION 'The variance policy change is unavailable';
  END IF;
  IF upper(p_decision)='APPROVE' THEN
    SELECT COALESCE(max(policy_version),0)+1 INTO next_version
    FROM public.procurement_variance_policies
    WHERE company_id=change_request.company_id;
    IF next_version<>change_request.expected_policy_version+1 THEN
      RAISE EXCEPTION 'The variance policy changed before this decision';
    END IF;
    policy_id:=gen_random_uuid();
    INSERT INTO public.procurement_variance_policies(
      id,company_id,policy_version,tolerance_mode,fixed_tolerance,
      percentage_tolerance,effective_at,source_change_request_id,
      approved_by,approved_by_role_assignment_id,approval_reason
    ) VALUES (
      policy_id,change_request.company_id,next_version,
      change_request.proposed_policy->>'toleranceMode',
      (change_request.proposed_policy->>'fixedTolerance')::numeric,
      (change_request.proposed_policy->>'percentageTolerance')::numeric,
      change_request.proposed_effective_at,change_request.id,p_actor_user_id,
      p_actor_role_assignment_id,btrim(p_reason)
    );
  END IF;
  result:=jsonb_build_object(
    'changeRequestId',change_request.id,
    'state',CASE WHEN upper(p_decision)='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
    'policyId',policy_id,'correlationId',correlation
  );
  UPDATE public.procurement_variance_policy_changes
  SET state=CASE WHEN upper(p_decision)='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
    result_policy_id=policy_id,decided_at=p_at,updated_at=p_at
  WHERE id=change_request.id;
  INSERT INTO public.procurement_variance_policy_decisions(
    change_request_id,company_id,decision,actor_user_id,
    actor_role_assignment_id,reason,correlation_id,idempotency_key,
    result,decided_at
  ) VALUES (
    change_request.id,change_request.company_id,upper(p_decision),
    p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),correlation,
    p_idempotency_key,result,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'procurement_variance_policy_changes',change_request.id,
    upper(p_decision),p_actor_user_id,change_request.company_id,NULL,p_reason,
    jsonb_build_object('state',result->>'state','policyId',policy_id)
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_evaluate_budget_alerts_internal(
  p_budget_period_id uuid,p_at timestamptz
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  period public.budget_periods%ROWTYPE;
  schedule public.budget_cycle_schedules%ROWTYPE;
  balance record;
  threshold record;
  state_row public.budget_alert_states%ROWTYPE;
  percentage_value numeric(12,6);
  crossed boolean;
  should_rearm boolean;
  next_count integer;
  event_key text;
  correlation uuid;
BEGIN
  SELECT * INTO period FROM public.budget_periods
  WHERE id=p_budget_period_id;
  IF period.id IS NULL OR period.status<>'ACTIVE' THEN RETURN; END IF;
  SELECT * INTO schedule FROM public.budget_cycle_schedules
  WHERE id=period.schedule_id;
  SELECT * INTO balance FROM public.v_budget_period_balances
  WHERE budget_period_id=period.id;
  percentage_value:=CASE WHEN balance.allocated>0
    THEN round(balance.available*100/balance.allocated,6) END;
  FOR threshold IN
    SELECT * FROM (VALUES
      ('LOW'::text,schedule.low_threshold_percentage),
      ('CRITICAL'::text,schedule.critical_threshold_percentage),
      ('ZERO'::text,0::numeric),
      ('NEGATIVE'::text,NULL::numeric)
    ) configured(code,percentage)
  LOOP
    crossed:=CASE threshold.code
      WHEN 'NEGATIVE' THEN balance.available<0
      WHEN 'ZERO' THEN balance.available=0
      ELSE balance.available>0 AND percentage_value<=threshold.percentage
    END;
    SELECT * INTO state_row FROM public.budget_alert_states
    WHERE budget_period_id=period.id AND threshold_code=threshold.code
    FOR UPDATE;
    IF crossed AND (state_row.id IS NULL OR NOT state_row.active) THEN
      next_count:=COALESCE(state_row.notification_count,0)+1;
      INSERT INTO public.budget_alert_states(
        company_id,budget_account_id,budget_period_id,threshold_code,
        threshold_percentage,active,notification_count,last_percentage,
        last_available,first_crossed_at,last_notified_at,updated_at
      ) VALUES (
        period.company_id,period.budget_account_id,period.id,threshold.code,
        threshold.percentage,true,next_count,percentage_value,balance.available,
        p_at,p_at,p_at
      ) ON CONFLICT(budget_period_id,threshold_code) DO UPDATE SET
        active=true,notification_count=EXCLUDED.notification_count,
        last_percentage=EXCLUDED.last_percentage,
        last_available=EXCLUDED.last_available,
        first_crossed_at=COALESCE(
          public.budget_alert_states.first_crossed_at,EXCLUDED.first_crossed_at
        ),
        last_notified_at=EXCLUDED.last_notified_at,updated_at=EXCLUDED.updated_at;
      correlation:=gen_random_uuid();
      event_key:=CASE WHEN threshold.code IN ('ZERO','NEGATIVE')
        THEN 'budget.zero' ELSE 'budget.low' END;
      PERFORM public.axora_emit_budget_notification(
        period.budget_account_id,event_key,
        'budget-alert:'||period.id::text||':'||threshold.code||':'||next_count,
        NULL,NULL,correlation,p_at,
        jsonb_build_object(
          'budgetPeriodId',period.id,'threshold',threshold.code,
          'available',balance.available::text,
          'percentage',percentage_value
        )
      );
    ELSIF NOT crossed AND state_row.id IS NOT NULL AND state_row.active THEN
      should_rearm:=CASE threshold.code
        WHEN 'NEGATIVE' THEN balance.available>=0
        WHEN 'ZERO' THEN balance.available>0
        ELSE percentage_value>threshold.percentage+schedule.hysteresis_percentage
      END;
      IF should_rearm THEN
        UPDATE public.budget_alert_states SET active=false,
          last_percentage=percentage_value,last_available=balance.available,
          rearmed_at=p_at,updated_at=p_at WHERE id=state_row.id;
      END IF;
    ELSIF state_row.id IS NOT NULL THEN
      UPDATE public.budget_alert_states SET last_percentage=percentage_value,
        last_available=balance.available,updated_at=p_at WHERE id=state_row.id;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_evaluate_budget_alert_after_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.entry_type IN (
    'ALLOCATION_INCREASE','ALLOCATION_DECREASE','PENDING_EXPOSURE_ADD',
    'PENDING_EXPOSURE_REMOVE','RESERVATION','RESERVATION_INCREASE',
    'RESERVATION_REDUCTION','FINAL_SPEND','DIRECT_SPEND','RELEASE',
    'MANUAL_CORRECTION','TRANSFER_IN','TRANSFER_OUT'
  ) THEN
    PERFORM public.axora_evaluate_budget_alerts_internal(
      NEW.budget_period_id,NEW.posted_at
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evaluate_budget_alert_after_entry
AFTER INSERT ON public.budget_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.axora_evaluate_budget_alert_after_entry();

CREATE OR REPLACE FUNCTION public.axora_refresh_budget_period_internal(
  p_budget_account_id uuid,p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,p_system_job text,p_reason text,
  p_idempotency_key text,p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  account public.budget_accounts%ROWTYPE;
  current_period public.budget_periods%ROWTYPE;
  existing_period public.budget_periods%ROWTYPE;
  schedule public.budget_cycle_schedules%ROWTYPE;
  initial_balance record;
  reservation public.budget_reservations%ROWTYPE;
  available_to_expire numeric(18,2);
  rollover numeric(18,2):=0;
  carried_reservations numeric(18,2):=0;
  base_allocation numeric(18,2):=0;
  next_start timestamptz;
  next_end timestamptz;
  next_id uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
  result jsonb;
BEGIN
  IF char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget refresh idempotency key is invalid';
  END IF;
  SELECT * INTO existing_period FROM public.budget_periods
  WHERE budget_account_id=p_budget_account_id
    AND refresh_idempotency_key=p_idempotency_key;
  IF existing_period.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'accountId',p_budget_account_id,'periodId',existing_period.id,
      'changed',false
    );
  END IF;
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active FOR UPDATE;
  SELECT * INTO current_period FROM public.budget_periods
  WHERE budget_account_id=account.id AND status='ACTIVE' FOR UPDATE;
  IF account.id IS NULL OR current_period.id IS NULL
    OR p_at<current_period.ends_at THEN
    RAISE EXCEPTION 'The current budget period is not ready to refresh';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.budget_periods period
    WHERE period.budget_account_id=account.id
      AND period.previous_period_id=current_period.id
  ) THEN
    SELECT id INTO next_id FROM public.budget_periods
    WHERE budget_account_id=account.id
      AND previous_period_id=current_period.id;
    RETURN jsonb_build_object(
      'accountId',account.id,'periodId',next_id,'changed',false
    );
  END IF;
  SELECT * INTO schedule FROM public.budget_cycle_schedules
  WHERE budget_account_id=account.id
    AND effective_at<=current_period.ends_at
  ORDER BY effective_at DESC,schedule_version DESC LIMIT 1;
  IF schedule.id IS NULL THEN RAISE EXCEPTION 'The budget schedule is unavailable'; END IF;
  SELECT * INTO initial_balance FROM public.v_budget_period_balances
  WHERE budget_period_id=current_period.id;
  rollover:=CASE schedule.rollover_mode
    WHEN 'FULL' THEN initial_balance.available
    WHEN 'PARTIAL_PERCENT' THEN round(
      initial_balance.available*schedule.rollover_percentage/100,2
    )
    WHEN 'CUSTOM_AMOUNT' THEN least(
      initial_balance.available,schedule.custom_rollover_amount
    )
    ELSE 0 END;
  base_allocation:=CASE WHEN schedule.rollover_mode='NONE'
    THEN 0 ELSE schedule.fixed_allocation END;

  FOR reservation IN
    SELECT * FROM public.budget_reservations
    WHERE budget_period_id=current_period.id
      AND remaining_reserved>0
      AND status IN (
        'RESERVED','PARTIALLY_SPENT','ADDITIONAL_APPROVAL_REQUIRED'
      )
    ORDER BY id FOR UPDATE
  LOOP
    carried_reservations:=carried_reservations+reservation.remaining_reserved;
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,current_period.id,'RESERVATION_REDUCTION',
      reservation.remaining_reserved,0,reservation.remaining_reserved,
      -reservation.remaining_reserved,0,0,0,0,reservation.request_id,
      reservation.request_version,reservation.id,NULL,'BUDGET_PERIOD',
      current_period.id,p_actor_user_id,p_actor_role_assignment_id,p_system_job,
      'PERIOD_RESERVATION_CARRY_OUT',p_reason,correlation,
      p_idempotency_key||'-carry-out-'||reservation.id::text,p_at
    );
  END LOOP;
  available_to_expire:=initial_balance.available+carried_reservations;
  IF available_to_expire>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,current_period.id,'EXPIRY_ADJUSTMENT',
      available_to_expire,0,-available_to_expire,0,0,0,0,
      available_to_expire,NULL,NULL,NULL,NULL,'BUDGET_PERIOD',
      current_period.id,p_actor_user_id,p_actor_role_assignment_id,p_system_job,
      CASE WHEN rollover>0 THEN 'ROLLOVER_OUT' ELSE 'NO_ROLLOVER_EXPIRY' END,
      p_reason,correlation,p_idempotency_key||'-close',p_at
    );
  END IF;
  UPDATE public.budget_periods SET status='CLOSED',closed_at=p_at
  WHERE id=current_period.id;
  next_start:=current_period.ends_at;
  next_end:=public.axora_next_budget_boundary(schedule.id,next_start);
  INSERT INTO public.budget_periods(
    id,company_id,budget_account_id,previous_period_id,period_name,starts_at,
    ends_at,timezone,allocation_method,rollover_policy,rollover_cap,status,
    refresh_due_at,created_by,schedule_id,schedule_version,cycle_number,
    refresh_idempotency_key
  ) VALUES (
    next_id,account.company_id,account.id,current_period.id,
    to_char(next_start AT TIME ZONE schedule.timezone,'YYYY-MM-DD')||' / '||
      schedule.frequency,next_start,next_end,schedule.timezone,'REFRESH',
    CASE schedule.rollover_mode WHEN 'FULL' THEN 'FULL'
      WHEN 'PARTIAL_PERCENT' THEN 'CAPPED'
      WHEN 'CUSTOM_AMOUNT' THEN 'CAPPED' ELSE 'NONE' END,
    CASE schedule.rollover_mode
      WHEN 'PARTIAL_PERCENT' THEN rollover
      WHEN 'CUSTOM_AMOUNT' THEN schedule.custom_rollover_amount END,
    'ACTIVE',next_end,p_actor_user_id,schedule.id,schedule.schedule_version,
    current_period.cycle_number+1,p_idempotency_key
  );
  IF base_allocation>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,next_id,'PERIOD_REFRESH',base_allocation,
      base_allocation,base_allocation,0,0,0,0,0,NULL,NULL,NULL,NULL,
      'BUDGET_PERIOD',current_period.id,p_actor_user_id,
      p_actor_role_assignment_id,p_system_job,'PERIOD_REFRESH',p_reason,
      correlation,p_idempotency_key||'-allocation',p_at
    );
  END IF;
  IF rollover>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,next_id,'ROLLOVER_IN',rollover,
      rollover,rollover,0,0,0,rollover,0,NULL,NULL,NULL,NULL,
      'BUDGET_PERIOD',current_period.id,p_actor_user_id,
      p_actor_role_assignment_id,p_system_job,'ROLLOVER_IN',p_reason,
      correlation,p_idempotency_key||'-rollover',p_at
    );
  END IF;
  IF carried_reservations>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      account.company_id,account.id,next_id,'PERIOD_REFRESH',
      carried_reservations,carried_reservations,carried_reservations,
      0,0,0,0,0,NULL,NULL,NULL,NULL,'BUDGET_PERIOD',current_period.id,
      p_actor_user_id,p_actor_role_assignment_id,p_system_job,
      'RESERVATION_CARRY_ALLOCATION',p_reason,correlation,
      p_idempotency_key||'-carry-allocation',p_at
    );
    FOR reservation IN
      SELECT * FROM public.budget_reservations
      WHERE budget_period_id=current_period.id AND remaining_reserved>0
        AND status IN (
          'RESERVED','PARTIALLY_SPENT','ADDITIONAL_APPROVAL_REQUIRED'
        )
      ORDER BY id FOR UPDATE
    LOOP
      PERFORM public.axora_post_budget_entry_internal(
        account.company_id,account.id,next_id,'RESERVATION',
        reservation.remaining_reserved,0,-reservation.remaining_reserved,
        reservation.remaining_reserved,0,0,0,0,reservation.request_id,
        reservation.request_version,reservation.id,NULL,'BUDGET_PERIOD',
        current_period.id,p_actor_user_id,p_actor_role_assignment_id,p_system_job,
        'PERIOD_RESERVATION_CARRY_IN',p_reason,correlation,
        p_idempotency_key||'-carry-in-'||reservation.id::text,p_at
      );
      UPDATE public.budget_reservations
      SET budget_period_id=next_id,updated_at=p_at WHERE id=reservation.id;
      INSERT INTO public.budget_reservation_rollovers(
        reservation_id,company_id,from_period_id,to_period_id,amount,
        correlation_id,occurred_at
      ) VALUES (
        reservation.id,account.company_id,current_period.id,next_id,
        reservation.remaining_reserved,correlation,p_at
      );
      INSERT INTO public.budget_reservation_events(
        reservation_id,company_id,event_type,amount,previous_status,new_status,
        actor_user_id,system_job,reason,correlation_id,idempotency_key,occurred_at
      ) VALUES (
        reservation.id,account.company_id,'ROLLED_FORWARD',
        reservation.remaining_reserved,reservation.status,reservation.status,
        p_actor_user_id,p_system_job,p_reason,correlation,
        p_idempotency_key||'-carry-event-'||reservation.id::text,p_at
      );
    END LOOP;
  END IF;
  IF schedule.frequency<>'MANUAL' THEN
    INSERT INTO public.budget_refresh_jobs(
      company_id,budget_account_id,budget_period_id,schedule_id,due_at,
      next_attempt_at
    ) VALUES (
      account.company_id,account.id,next_id,schedule.id,next_end,next_end
    ) ON CONFLICT(budget_account_id,due_at) DO NOTHING;
  END IF;
  PERFORM public.axora_evaluate_budget_alerts_internal(next_id,p_at);
  result:=jsonb_build_object(
    'accountId',account.id,'previousPeriodId',current_period.id,
    'periodId',next_id,'rollover',rollover::text,
    'carriedReservations',carried_reservations::text,'changed',true,
    'scheduleVersion',schedule.schedule_version,'correlationId',correlation
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_refresh_budget_period(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_reason text,p_idempotency_key text,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; account public.budget_accounts%ROWTYPE; result jsonb;
BEGIN
  IF char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'The budget refresh command is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active;
  IF snapshot IS NULL OR account.id IS NULL
    OR NOT public.axora_budget_account_permission(
      snapshot,'budget.refresh',account.level_type,account.company_id,
      account.branch_id,account.department_id
    ) THEN RAISE EXCEPTION 'The budget refresh is unavailable'; END IF;
  result:=public.axora_refresh_budget_period_internal(
    account.id,p_actor_user_id,p_actor_role_assignment_id,NULL,btrim(p_reason),
    p_idempotency_key,p_at
  );
  IF COALESCE((result->>'changed')::boolean,false) THEN
    PERFORM public.axora_emit_budget_notification(
      account.id,'budget.refreshed',
      'budget-refresh-manual:'||(result->>'periodId'),p_actor_user_id,
      p_actor_user_id,(result->>'correlationId')::uuid,p_at,result
    );
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_budget_retry_delay(p_attempt integer)
RETURNS interval
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_attempt
    WHEN 1 THEN interval '1 minute'
    WHEN 2 THEN interval '5 minutes'
    WHEN 3 THEN interval '15 minutes'
    WHEN 4 THEN interval '1 hour'
    WHEN 5 THEN interval '4 hours'
    ELSE interval '12 hours' END
$$;

CREATE OR REPLACE FUNCTION public.axora_reconcile_budget_refresh_jobs(
  p_at timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE inserted_count integer;
BEGIN
  WITH inserted AS (
    INSERT INTO public.budget_refresh_jobs(
      company_id,budget_account_id,budget_period_id,schedule_id,due_at,
      next_attempt_at
    )
    SELECT period.company_id,period.budget_account_id,period.id,
      period.schedule_id,period.ends_at,least(period.ends_at,p_at)
    FROM public.budget_periods period
    JOIN public.budget_cycle_schedules schedule ON schedule.id=period.schedule_id
    WHERE period.status='ACTIVE' AND schedule.frequency<>'MANUAL'
      AND NOT EXISTS (
        SELECT 1 FROM public.budget_refresh_jobs job
        WHERE job.budget_account_id=period.budget_account_id
          AND job.due_at=period.ends_at
      )
    ON CONFLICT(budget_account_id,due_at) DO NOTHING
    RETURNING id,company_id
  )
  INSERT INTO public.budget_refresh_job_events(
    job_id,company_id,event_type,attempt_count,occurred_at
  )
  SELECT id,company_id,'RECONCILED',0,p_at FROM inserted;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  RETURN inserted_count;
END $$;

CREATE OR REPLACE FUNCTION public.axora_claim_budget_refresh_jobs(
  p_worker_id text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 90,
  p_at timestamptz DEFAULT now()
) RETURNS TABLE(job_id uuid,lease_token uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF char_length(btrim(COALESCE(p_worker_id,''))) NOT BETWEEN 3 AND 120
    OR p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'The budget worker lease is invalid';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT job.id FROM public.budget_refresh_jobs job
    WHERE (
        job.state IN ('PENDING','RETRY')
        OR (job.state='LEASED' AND job.lease_expires_at<=p_at)
      )
      AND job.next_attempt_at<=p_at
    ORDER BY job.due_at,job.created_at,job.id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), leased AS (
    UPDATE public.budget_refresh_jobs job SET
      state='LEASED',attempt_count=attempt_count+1,
      lease_owner=btrim(p_worker_id),lease_token=gen_random_uuid(),
      lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
      updated_at=p_at
    FROM candidates WHERE job.id=candidates.id
    RETURNING job.id,job.company_id,job.attempt_count,job.lease_token
  ), evidence AS (
    INSERT INTO public.budget_refresh_job_events(
      job_id,company_id,event_type,attempt_count,worker_id,occurred_at
    )
    SELECT id,company_id,'LEASED',attempt_count,btrim(p_worker_id),p_at
    FROM leased RETURNING job_id
  )
  SELECT leased.id,leased.lease_token FROM leased ORDER BY leased.id;
END $$;

CREATE OR REPLACE FUNCTION public.axora_process_budget_refresh_job(
  p_worker_id text,p_job_id uuid,p_lease_token uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  job public.budget_refresh_jobs%ROWTYPE;
  result jsonb;
  error_state text;
  error_code text;
  next_state text;
  next_attempt timestamptz;
  correlation uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO job FROM public.budget_refresh_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF job.id IS NULL OR job.state<>'LEASED'
    OR job.lease_owner IS DISTINCT FROM btrim(p_worker_id)
    OR job.lease_token IS DISTINCT FROM p_lease_token
    OR job.lease_expires_at<=p_at THEN
    RAISE EXCEPTION 'The budget refresh lease is unavailable';
  END IF;
  BEGIN
    result:=public.axora_refresh_budget_period_internal(
      job.budget_account_id,NULL,NULL,'BUDGET_REFRESH_WORKER',
      'Scheduled budget cycle refresh',
      'budget-job-'||job.id::text,p_at
    );
    UPDATE public.budget_refresh_jobs SET state='SUCCEEDED',
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      result=result,completed_at=p_at,last_error_code=NULL,updated_at=p_at
    WHERE id=job.id;
    INSERT INTO public.budget_refresh_job_events(
      job_id,company_id,event_type,attempt_count,worker_id,occurred_at,metadata
    ) VALUES (
      job.id,job.company_id,'SUCCEEDED',job.attempt_count,p_worker_id,p_at,
      jsonb_build_object('periodId',result->>'periodId')
    );
    IF COALESCE((result->>'changed')::boolean,false) THEN
      PERFORM public.axora_emit_budget_notification(
        job.budget_account_id,'budget.refreshed',
        'budget-refresh-job:'||job.id::text,NULL,NULL,
        (result->>'correlationId')::uuid,p_at,result
      );
    END IF;
    RETURN jsonb_build_object('jobId',job.id,'state','SUCCEEDED','result',result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE;
    error_code:=CASE error_state
      WHEN '40001' THEN 'SERIALIZATION_RETRY'
      WHEN '40P01' THEN 'DEADLOCK_RETRY'
      WHEN '55P03' THEN 'LOCK_RETRY'
      ELSE 'REFRESH_FAILED' END;
    next_state:=CASE WHEN job.attempt_count>=job.max_attempts
      THEN 'DEAD_LETTER' ELSE 'RETRY' END;
    next_attempt:=p_at+public.axora_budget_retry_delay(job.attempt_count);
    UPDATE public.budget_refresh_jobs SET state=next_state,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      next_attempt_at=next_attempt,last_error_code=error_code,updated_at=p_at
    WHERE id=job.id;
    INSERT INTO public.budget_refresh_job_events(
      job_id,company_id,event_type,attempt_count,worker_id,error_code,
      occurred_at,metadata
    ) VALUES (
      job.id,job.company_id,
      CASE WHEN next_state='DEAD_LETTER'
        THEN 'DEAD_LETTERED' ELSE 'RETRY_SCHEDULED' END,
      job.attempt_count,p_worker_id,error_code,p_at,
      jsonb_build_object('nextAttemptAt',next_attempt)
    );
    IF next_state='DEAD_LETTER' THEN
      PERFORM public.axora_emit_budget_notification(
        job.budget_account_id,'budget.refresh_failed',
        'budget-refresh-failed:'||job.id::text,NULL,NULL,correlation,p_at,
        jsonb_build_object('jobId',job.id,'errorCode',error_code)
      );
    END IF;
    RETURN jsonb_build_object(
      'jobId',job.id,'state',next_state,'errorCode',error_code,
      'nextAttemptAt',next_attempt
    );
  END;
END $$;

CREATE OR REPLACE FUNCTION public.axora_rerun_budget_refresh_job(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_job_id uuid,
  p_reason text,p_idempotency_key text,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.budget_refresh_jobs%ROWTYPE;
  account public.budget_accounts%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO job FROM public.budget_refresh_jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=job.budget_account_id;
  IF snapshot IS NULL OR job.id IS NULL
    OR job.state NOT IN ('RETRY','DEAD_LETTER')
    OR NOT public.axora_budget_account_permission(
      snapshot,'budget.refresh',account.level_type,account.company_id,
      account.branch_id,account.department_id
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget refresh job is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.budget_refresh_job_events event
    WHERE event.job_id=job.id
      AND event.metadata->>'idempotencyKey'=p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('jobId',job.id,'state',job.state,'changed',false);
  END IF;
  UPDATE public.budget_refresh_jobs SET state='PENDING',
    next_attempt_at=p_at,attempt_count=0,lease_owner=NULL,lease_token=NULL,
    lease_expires_at=NULL,completed_at=NULL,result=NULL,last_error_code=NULL,
    manual_rerun_count=manual_rerun_count+1,updated_at=p_at
  WHERE id=job.id;
  INSERT INTO public.budget_refresh_job_events(
    job_id,company_id,event_type,attempt_count,worker_id,occurred_at,metadata
  ) VALUES (
    job.id,job.company_id,'MANUAL_RERUN',0,p_actor_user_id::text,p_at,
    jsonb_build_object('idempotencyKey',p_idempotency_key)
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'budget_refresh_jobs',job.id,'MANUAL_RERUN',p_actor_user_id,
    job.company_id,NULL,p_reason,jsonb_build_object('state','PENDING')
  );
  RETURN jsonb_build_object('jobId',job.id,'state','PENDING','changed',true);
END $$;

INSERT INTO public.budget_refresh_jobs(
  company_id,budget_account_id,budget_period_id,schedule_id,due_at,
  next_attempt_at
)
SELECT period.company_id,period.budget_account_id,period.id,period.schedule_id,
  period.ends_at,period.ends_at
FROM public.budget_periods period
JOIN public.budget_cycle_schedules schedule ON schedule.id=period.schedule_id
WHERE period.status='ACTIVE' AND schedule.frequency<>'MANUAL'
ON CONFLICT(budget_account_id,due_at) DO NOTHING;

INSERT INTO public.budget_refresh_job_events(
  job_id,company_id,event_type,attempt_count,occurred_at
)
SELECT job.id,job.company_id,'ENQUEUED',0,job.created_at
FROM public.budget_refresh_jobs job;

CREATE OR REPLACE FUNCTION public.axora_request_budget_adjustment(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_budget_account_id uuid,
  p_adjustment jsonb,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  account public.budget_accounts%ROWTYPE;
  source_account public.budget_accounts%ROWTYPE;
  existing public.budget_adjustment_requests%ROWTYPE;
  adjustment_type_value text;
  amount_value numeric(18,2);
  source_id uuid;
  effective_until_value timestamptz;
  request_id uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=p_budget_account_id AND active;
  IF snapshot IS NULL OR account.id IS NULL
    OR NOT public.axora_budget_account_permission(
      snapshot,'budget.view',account.level_type,account.company_id,
      account.branch_id,account.department_id
    ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  SELECT * INTO existing FROM public.budget_adjustment_requests
  WHERE target_budget_account_id=account.id
    AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.requested_by<>p_actor_user_id
      OR existing.requested_by_role_assignment_id<>p_actor_role_assignment_id THEN
      RAISE EXCEPTION 'The budget adjustment is unavailable';
    END IF;
    RETURN jsonb_build_object('adjustmentRequestId',existing.id,'state',existing.state);
  END IF;
  adjustment_type_value:=upper(COALESCE(p_adjustment->>'adjustmentType',''));
  amount_value:=(p_adjustment->>'amount')::numeric;
  source_id:=NULLIF(p_adjustment->>'sourceBudgetAccountId','')::uuid;
  effective_until_value:=NULLIF(
    p_adjustment->>'effectiveUntil',''
  )::timestamptz;
  IF adjustment_type_value NOT IN (
      'ONE_TIME','TEMPORARY','PERMANENT','TRANSFER'
    )
    OR amount_value<=0 OR amount_value<>round(amount_value,2)
    OR (adjustment_type_value='TRANSFER' AND source_id IS NULL)
    OR (adjustment_type_value<>'TRANSFER' AND source_id IS NOT NULL)
    OR (adjustment_type_value='TEMPORARY'
      AND (effective_until_value IS NULL OR effective_until_value<=p_at))
    OR (adjustment_type_value<>'TEMPORARY'
      AND effective_until_value IS NOT NULL)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget adjustment is invalid';
  END IF;
  IF source_id IS NOT NULL THEN
    SELECT * INTO source_account FROM public.budget_accounts
    WHERE id=source_id AND active;
    IF source_account.id IS NULL
      OR source_account.company_id<>account.company_id
      OR source_account.currency<>account.currency
      OR source_account.id=account.id
      OR NOT public.axora_budget_account_permission(
        snapshot,'budget.view',source_account.level_type,
        source_account.company_id,source_account.branch_id,
        source_account.department_id
      ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  END IF;
  INSERT INTO public.budget_adjustment_requests(
    id,company_id,target_budget_account_id,source_budget_account_id,
    adjustment_type,amount,effective_until,state,requested_by,
    requested_by_role_assignment_id,request_reason,idempotency_key,
    correlation_id,result
  ) VALUES (
    request_id,account.company_id,account.id,source_id,
    adjustment_type_value,amount_value,effective_until_value,'PENDING_COMPANY',
    p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
    p_idempotency_key,correlation,
    jsonb_build_object('adjustmentRequestId',request_id,'state','PENDING_COMPANY')
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'budget_adjustment_requests',request_id,'REQUEST',p_actor_user_id,
    account.company_id,NULL,p_reason,
    jsonb_build_object(
      'budgetAccountId',account.id,'adjustmentType',adjustment_type_value,
      'amount',amount_value::text,'state','PENDING_COMPANY'
    )
  );
  PERFORM public.axora_emit_budget_notification(
    account.id,'budget.adjustment_requested',
    'budget-adjustment-request:'||request_id::text,p_actor_user_id,
    p_actor_user_id,correlation,p_at,
    jsonb_build_object('adjustmentRequestId',request_id)
  );
  RETURN jsonb_build_object(
    'adjustmentRequestId',request_id,'state','PENDING_COMPANY'
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_apply_budget_adjustment_internal(
  p_adjustment_request_id uuid,p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,p_system_override boolean,p_reason text,
  p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request public.budget_adjustment_requests%ROWTYPE;
  target public.budget_accounts%ROWTYPE;
  source public.budget_accounts%ROWTYPE;
  target_period public.budget_periods%ROWTYPE;
  source_period public.budget_periods%ROWTYPE;
  source_balance record;
  transfer_group uuid:=gen_random_uuid();
  key_prefix text;
BEGIN
  SELECT * INTO request FROM public.budget_adjustment_requests
  WHERE id=p_adjustment_request_id FOR UPDATE;
  SELECT * INTO target FROM public.budget_accounts
  WHERE id=request.target_budget_account_id FOR UPDATE;
  SELECT * INTO target_period FROM public.budget_periods
  WHERE budget_account_id=target.id AND status='ACTIVE' FOR UPDATE;
  key_prefix:='adjustment-'||request.id::text;
  IF request.adjustment_type='TRANSFER' THEN
    PERFORM account.id FROM public.budget_accounts account
    WHERE account.id IN (
      request.source_budget_account_id,request.target_budget_account_id
    ) ORDER BY account.id FOR UPDATE;
    SELECT * INTO source FROM public.budget_accounts
    WHERE id=request.source_budget_account_id;
    SELECT * INTO source_period FROM public.budget_periods
    WHERE budget_account_id=source.id AND status='ACTIVE' FOR UPDATE;
    SELECT * INTO source_balance FROM public.v_budget_period_balances
    WHERE budget_period_id=source_period.id;
    IF source_balance.available<request.amount THEN
      RAISE EXCEPTION 'The source budget balance is insufficient';
    END IF;
    PERFORM public.axora_post_budget_entry_internal(
      request.company_id,source.id,source_period.id,'TRANSFER_OUT',
      request.amount,-request.amount,-request.amount,0,0,0,0,0,
      NULL,NULL,NULL,transfer_group,'BUDGET_ADJUSTMENT',request.id,
      p_actor_user_id,p_actor_role_assignment_id,
      CASE WHEN p_system_override THEN 'AXORA_CEILING_OVERRIDE' END,
      'BUDGET_ADJUSTMENT_TRANSFER_OUT',p_reason,request.correlation_id,
      key_prefix||'-out',p_at
    );
    PERFORM public.axora_post_budget_entry_internal(
      request.company_id,target.id,target_period.id,'TRANSFER_IN',
      request.amount,request.amount,request.amount,0,0,0,0,0,
      NULL,NULL,NULL,transfer_group,'BUDGET_ADJUSTMENT',request.id,
      p_actor_user_id,p_actor_role_assignment_id,
      CASE WHEN p_system_override THEN 'AXORA_CEILING_OVERRIDE' END,
      'BUDGET_ADJUSTMENT_TRANSFER_IN',p_reason,request.correlation_id,
      key_prefix||'-in',p_at
    );
  ELSE
    PERFORM public.axora_post_budget_entry_internal(
      request.company_id,target.id,target_period.id,'ALLOCATION_INCREASE',
      request.amount,request.amount,request.amount,0,0,0,0,0,
      NULL,NULL,NULL,NULL,'BUDGET_ADJUSTMENT',request.id,p_actor_user_id,
      p_actor_role_assignment_id,
      CASE WHEN p_system_override THEN 'AXORA_CEILING_OVERRIDE' END,
      'BUDGET_ADJUSTMENT_'||request.adjustment_type,p_reason,
      request.correlation_id,key_prefix||'-increase',p_at
    );
    IF request.adjustment_type='PERMANENT' THEN
      UPDATE public.budget_accounts
      SET recurring_allocation=recurring_allocation+request.amount,
        updated_at=p_at WHERE id=target.id;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'adjustmentRequestId',request.id,'state','APPROVED',
    'amount',request.amount::text,'adjustmentType',request.adjustment_type,
    'correlationId',request.correlation_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_decide_budget_adjustment(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_adjustment_request_id uuid,p_decision text,p_reason text,
  p_idempotency_key text,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  request public.budget_adjustment_requests%ROWTYPE;
  account public.budget_accounts%ROWTYPE;
  existing_decision public.budget_adjustment_decisions%ROWTYPE;
  authorization_state text;
  active_allocated numeric(18,2);
  ceiling numeric(18,2);
  next_state text;
  action_value text;
  result jsonb;
  correlation uuid:=gen_random_uuid();
BEGIN
  IF upper(p_decision) NOT IN ('APPROVE','REJECT','RETURN')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The budget adjustment is unavailable';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request FROM public.budget_adjustment_requests
  WHERE id=p_adjustment_request_id FOR UPDATE;
  SELECT * INTO account FROM public.budget_accounts
  WHERE id=request.target_budget_account_id FOR UPDATE;
  IF snapshot IS NULL OR request.id IS NULL OR account.id IS NULL
    OR request.requested_by=p_actor_user_id THEN
    RAISE EXCEPTION 'The budget adjustment is unavailable';
  END IF;
  SELECT * INTO existing_decision
  FROM public.budget_adjustment_decisions decision
  WHERE decision.adjustment_request_id=request.id
    AND decision.idempotency_key=p_idempotency_key;
  IF existing_decision.id IS NOT NULL AND (
    existing_decision.actor_user_id<>p_actor_user_id
    OR existing_decision.actor_role_assignment_id<>p_actor_role_assignment_id
  ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  authorization_state:=COALESCE(existing_decision.state_before,request.state);
  IF authorization_state NOT IN ('PENDING_COMPANY','PENDING_AXORA') THEN
    RAISE EXCEPTION 'The budget adjustment is unavailable';
  END IF;
  IF authorization_state='PENDING_COMPANY' THEN
    IF NOT public.axora_budget_account_permission(
      snapshot,
      CASE WHEN request.adjustment_type='TRANSFER'
        THEN 'budget.assign' ELSE 'budget.increase' END,
      account.level_type,account.company_id,account.branch_id,
      account.department_id
    ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  ELSIF NOT public.axora_snapshot_has_permission(
    snapshot,'commercial.company_ceiling.override','PLATFORM',
    NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'The budget adjustment is unavailable'; END IF;
  IF existing_decision.id IS NOT NULL THEN RETURN existing_decision.result; END IF;
  IF upper(p_decision) IN ('REJECT','RETURN') THEN
    next_state:=CASE WHEN upper(p_decision)='REJECT'
      THEN 'REJECTED' ELSE 'RETURNED' END;
    action_value:=upper(p_decision);
    result:=jsonb_build_object(
      'adjustmentRequestId',request.id,'state',next_state
    );
  ELSE
    SELECT COALESCE(sum(balance.allocated),0)::numeric(18,2)
      INTO active_allocated
    FROM public.v_budget_period_balances balance
    JOIN public.budget_periods period
      ON period.id=balance.budget_period_id AND period.status='ACTIVE'
    WHERE balance.company_id=request.company_id;
    SELECT contractual_ceiling INTO ceiling FROM public.companies
    WHERE id=request.company_id FOR KEY SHARE;
    IF request.state='PENDING_COMPANY'
      AND request.adjustment_type<>'TRANSFER'
      AND active_allocated+request.amount>ceiling THEN
      next_state:='PENDING_AXORA';
      action_value:='ESCALATE';
      result:=jsonb_build_object(
        'adjustmentRequestId',request.id,'state',next_state,
        'projectedAllocation',(active_allocated+request.amount)::text
      );
    ELSE
      result:=public.axora_apply_budget_adjustment_internal(
        request.id,p_actor_user_id,p_actor_role_assignment_id,
        request.state='PENDING_AXORA',p_reason,p_at
      );
      next_state:='APPROVED';
      action_value:='APPROVE';
    END IF;
  END IF;
  UPDATE public.budget_adjustment_requests SET state=next_state,
    result=result,decided_at=CASE WHEN next_state IN (
      'APPROVED','REJECTED','RETURNED'
    ) THEN p_at END,updated_at=p_at
  WHERE id=request.id;
  INSERT INTO public.budget_adjustment_decisions(
    adjustment_request_id,company_id,state_before,state_after,decision,
    actor_user_id,actor_role_assignment_id,reason,correlation_id,
    idempotency_key,result,decided_at
  ) VALUES (
    request.id,request.company_id,request.state,next_state,action_value,
    p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),correlation,
    p_idempotency_key,result,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'budget_adjustment_requests',request.id,action_value,p_actor_user_id,
    request.company_id,NULL,p_reason,
    jsonb_build_object('state',next_state,'amount',request.amount::text)
  );
  PERFORM public.axora_emit_budget_notification(
    account.id,
    CASE WHEN next_state='APPROVED' THEN 'budget.adjustment_approved'
      WHEN next_state='PENDING_AXORA' THEN 'budget.adjustment_blocked'
      ELSE 'budget.adjustment_rejected' END,
    'budget-adjustment-decision:'||request.id::text||':'||request.state,
    request.requested_by,p_actor_user_id,correlation,p_at,
    jsonb_build_object('adjustmentRequestId',request.id,'state',next_state)
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_assign_fulfilment_purchase(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_assigned_user_id uuid,p_assigned_role_assignment_id uuid,p_reason text,
  p_idempotency_key text,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  target_snapshot jsonb;
  request public.requests%ROWTYPE;
  existing public.fulfilment_purchase_assignments%ROWTYPE;
  assignment_id uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  target_snapshot:=public.axora_live_authorization_snapshot(
    p_assigned_user_id,p_assigned_role_assignment_id,p_at
  );
  SELECT * INTO request FROM public.requests WHERE id=p_request_id FOR UPDATE;
  IF snapshot IS NULL OR target_snapshot IS NULL OR request.id IS NULL
    OR request.approval_state NOT IN ('APPROVED','AWAITING_FULFILMENT')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      target_snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The fulfilment assignment is unavailable';
  END IF;
  SELECT * INTO existing FROM public.fulfilment_purchase_assignments
  WHERE request_id=request.id AND request_version=request.request_version
    AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.assigned_by<>p_actor_user_id
      OR existing.assigned_by_role_assignment_id<>p_actor_role_assignment_id
      OR existing.assigned_user_id<>p_assigned_user_id
      OR existing.assigned_role_assignment_id<>p_assigned_role_assignment_id THEN
      RAISE EXCEPTION 'The fulfilment assignment is unavailable';
    END IF;
    RETURN jsonb_build_object(
      'assignmentId',existing.id,'status',existing.status
    );
  END IF;
  UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',
    updated_at=p_at WHERE request_id=request.id
      AND request_version=request.request_version AND status='ASSIGNED';
  INSERT INTO public.fulfilment_purchase_assignments(
    id,request_id,request_version,company_id,assigned_user_id,
    assigned_role_assignment_id,assigned_by,assigned_by_role_assignment_id,
    status,reason,correlation_id,idempotency_key,assigned_at
  ) VALUES (
    assignment_id,request.id,request.request_version,request.company_id,
    p_assigned_user_id,p_assigned_role_assignment_id,p_actor_user_id,
    p_actor_role_assignment_id,'ASSIGNED',btrim(p_reason),correlation,
    p_idempotency_key,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'fulfilment_purchase_assignments',assignment_id,'ASSIGN',
    p_actor_user_id,request.company_id,request.id,p_reason,
    jsonb_build_object(
      'requestId',request.id,'assignedUserId',p_assigned_user_id
    )
  );
  PERFORM public.axora_emit_p1_notification(
    request.company_id,request.branch_id,request.id,'request.actual',
    request.id,'request.approved','fulfilment-assignment:'||assignment_id::text,
    COALESCE(request.order_code,request.id::text),'/sourcing',
    ARRAY[p_assigned_user_id],p_actor_user_id,correlation,p_at,
    jsonb_build_object('assignmentId',assignment_id)
  );
  RETURN jsonb_build_object(
    'assignmentId',assignment_id,'status','ASSIGNED',
    'correlationId',correlation
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_actual_approval_recipients(
  p_request_id uuid,p_target_state text,p_at timestamptz
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT assignment.user_id ORDER BY assignment.user_id),
    ARRAY[]::uuid[])
  FROM public.requests request
  JOIN public.role_assignments assignment
    ON assignment.active AND assignment.revoked_at IS NULL
  JOIN public.users account ON account.id=assignment.user_id
    AND account.active AND account.account_status='ACTIVE'
  WHERE request.id=p_request_id
    AND (
      (p_target_state='PENDING_AXORA'
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            assignment.user_id,assignment.id,p_at
          ),
          'commercial.company_ceiling.override','PLATFORM',
          NULL,NULL,NULL,NULL
        ))
      OR
      (p_target_state='PENDING_COMPANY'
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            assignment.user_id,assignment.id,p_at
          ),
          'request.approve.additional_actual',
          CASE WHEN request.department_id IS NULL THEN 'BRANCH'
            ELSE 'DEPARTMENT' END,
          request.company_id,request.branch_id,request.department_id,NULL
        ))
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_apply_actual_submission_internal(
  p_submission_id uuid,p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_system_job text,p_funding_option text,p_source_budget_account_id uuid,
  p_allow_ceiling_override boolean,p_reason text,p_idempotency_key text,
  p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  submission public.request_actual_submissions%ROWTYPE;
  request public.requests%ROWTYPE;
  reservation public.budget_reservations%ROWTYPE;
  period public.budget_periods%ROWTYPE;
  balance record;
  company_exposure numeric(18,2);
  company_ceiling numeric(18,2);
  extra_amount numeric(18,2);
  release_amount numeric(18,2):=0;
  source_account public.budget_accounts%ROWTYPE;
  source_period public.budget_periods%ROWTYPE;
  source_balance record;
  transfer_group uuid;
  next_remaining numeric(18,2);
  next_status text;
  result jsonb;
  entry_actor uuid:=p_actor_user_id;
  entry_system text:=p_system_job;
BEGIN
  SELECT * INTO submission FROM public.request_actual_submissions
  WHERE id=p_submission_id FOR UPDATE;
  SELECT * INTO request FROM public.requests
  WHERE id=submission.request_id FOR UPDATE;
  SELECT * INTO reservation FROM public.budget_reservations
  WHERE id=submission.reservation_id FOR UPDATE;
  SELECT * INTO period FROM public.budget_periods
  WHERE id=reservation.budget_period_id FOR UPDATE;
  IF submission.id IS NULL OR submission.state='FINALIZED' THEN
    IF submission.state='FINALIZED' THEN RETURN submission.result; END IF;
    RAISE EXCEPTION 'The actual purchase submission is unavailable';
  END IF;
  IF submission.purchase_mode='REFUND' THEN
    IF submission.submission_amount>reservation.spent_amount THEN
      RAISE EXCEPTION 'The refund exceeds recorded spend';
    END IF;
    PERFORM public.axora_post_budget_entry_internal(
      request.company_id,reservation.budget_account_id,
      reservation.budget_period_id,'MANUAL_CORRECTION',
      submission.submission_amount,0,submission.submission_amount,0,
      -submission.submission_amount,0,0,0,request.id,request.request_version,
      reservation.id,NULL,'ACTUAL_SUBMISSION',submission.id,entry_actor,
      p_actor_role_assignment_id,entry_system,'ACTUAL_PURCHASE_REFUND',
      p_reason,submission.correlation_id,
      'actual-refund-'||submission.id::text,p_at
    );
    UPDATE public.budget_reservations SET
      spent_amount=spent_amount-submission.submission_amount,
      released_amount=released_amount+submission.submission_amount,
      status='PARTIALLY_RELEASED',updated_at=p_at
    WHERE id=reservation.id;
    INSERT INTO public.budget_reservation_events(
      reservation_id,company_id,event_type,amount,previous_status,new_status,
      actor_user_id,system_job,reason,correlation_id,idempotency_key,occurred_at
    ) VALUES (
      reservation.id,request.company_id,'REFUNDED',submission.submission_amount,
      reservation.status,'PARTIALLY_RELEASED',entry_actor,entry_system,p_reason,
      submission.correlation_id,'actual-refund-event-'||submission.id::text,p_at
    );
    result:=jsonb_build_object(
      'submissionId',submission.id,'requestId',request.id,'state','FINALIZED',
      'purchaseMode','REFUND','refundedAmount',submission.submission_amount::text,
      'cumulativeActualAmount',submission.cumulative_actual_amount::text,
      'correlationId',submission.correlation_id
    );
  ELSE
    extra_amount:=greatest(
      submission.submission_amount-reservation.remaining_reserved,0
    );
    IF extra_amount>0 THEN
      IF p_funding_option NOT IN (
        'APPROVE_ADDITIONAL','TRANSFER_RESERVE','TEMPORARY_INCREASE'
      ) THEN RAISE EXCEPTION 'An additional amount funding option is required'; END IF;
      IF p_funding_option='TRANSFER_RESERVE' THEN
        SELECT * INTO source_account FROM public.budget_accounts
        WHERE id=p_source_budget_account_id AND active FOR UPDATE;
        SELECT * INTO source_period FROM public.budget_periods
        WHERE budget_account_id=source_account.id AND status='ACTIVE'
        FOR UPDATE;
        SELECT * INTO source_balance FROM public.v_budget_period_balances
        WHERE budget_period_id=source_period.id;
        IF source_account.id IS NULL
          OR source_account.company_id<>request.company_id
          OR source_account.currency<>reservation.currency
          OR source_account.id=reservation.budget_account_id
          OR source_balance.available<extra_amount THEN
          RAISE EXCEPTION 'The transfer reserve is unavailable';
        END IF;
        transfer_group:=gen_random_uuid();
        PERFORM public.axora_post_budget_entry_internal(
          request.company_id,source_account.id,source_period.id,'TRANSFER_OUT',
          extra_amount,-extra_amount,-extra_amount,0,0,0,0,0,NULL,NULL,NULL,
          transfer_group,'ACTUAL_SUBMISSION',submission.id,entry_actor,
          p_actor_role_assignment_id,entry_system,'ACTUAL_TRANSFER_OUT',
          p_reason,submission.correlation_id,
          'actual-transfer-out-'||submission.id::text,p_at
        );
        PERFORM public.axora_post_budget_entry_internal(
          request.company_id,reservation.budget_account_id,
          reservation.budget_period_id,'TRANSFER_IN',extra_amount,
          extra_amount,extra_amount,0,0,0,0,0,NULL,NULL,NULL,transfer_group,
          'ACTUAL_SUBMISSION',submission.id,entry_actor,
          p_actor_role_assignment_id,entry_system,'ACTUAL_TRANSFER_IN',
          p_reason,submission.correlation_id,
          'actual-transfer-in-'||submission.id::text,p_at
        );
      ELSIF p_funding_option='TEMPORARY_INCREASE' THEN
        PERFORM public.axora_post_budget_entry_internal(
          request.company_id,reservation.budget_account_id,
          reservation.budget_period_id,'ALLOCATION_INCREASE',extra_amount,
          extra_amount,extra_amount,0,0,0,0,0,NULL,NULL,NULL,NULL,
          'ACTUAL_SUBMISSION',submission.id,entry_actor,
          p_actor_role_assignment_id,entry_system,'ACTUAL_TEMPORARY_INCREASE',
          p_reason,submission.correlation_id,
          'actual-temp-increase-'||submission.id::text,p_at
        );
      END IF;
      SELECT * INTO balance FROM public.v_budget_period_balances
      WHERE budget_period_id=reservation.budget_period_id;
      IF balance.available<extra_amount THEN
        RAISE EXCEPTION 'The additional amount is not available';
      END IF;
      SELECT COALESCE(sum(company_balance.reserved+company_balance.spent),0)::numeric(18,2)
        INTO company_exposure
      FROM public.v_budget_period_balances company_balance
      JOIN public.budget_periods company_period
        ON company_period.id=company_balance.budget_period_id
       AND company_period.status='ACTIVE'
      WHERE company_balance.company_id=request.company_id;
      SELECT contractual_ceiling INTO company_ceiling FROM public.companies
      WHERE id=request.company_id FOR KEY SHARE;
      IF NOT p_allow_ceiling_override
        AND company_exposure+extra_amount>company_ceiling THEN
        RAISE EXCEPTION 'The company ceiling requires Axora authorization';
      END IF;
      PERFORM public.axora_post_budget_entry_internal(
        request.company_id,reservation.budget_account_id,
        reservation.budget_period_id,'RESERVATION_INCREASE',extra_amount,
        0,-extra_amount,extra_amount,0,0,0,0,request.id,
        request.request_version,reservation.id,NULL,'ACTUAL_SUBMISSION',
        submission.id,entry_actor,p_actor_role_assignment_id,entry_system,
        'ADDITIONAL_ACTUAL_APPROVED',p_reason,submission.correlation_id,
        'actual-reserve-'||submission.id::text,p_at
      );
      UPDATE public.budget_reservations SET
        reserved_amount=reserved_amount+extra_amount,
        remaining_reserved=remaining_reserved+extra_amount,updated_at=p_at
      WHERE id=reservation.id;
      reservation.remaining_reserved:=reservation.remaining_reserved+extra_amount;
      reservation.reserved_amount:=reservation.reserved_amount+extra_amount;
    END IF;
    PERFORM public.axora_post_budget_entry_internal(
      request.company_id,reservation.budget_account_id,
      reservation.budget_period_id,'FINAL_SPEND',submission.submission_amount,
      0,0,-submission.submission_amount,submission.submission_amount,
      0,0,0,request.id,request.request_version,reservation.id,NULL,
      'ACTUAL_SUBMISSION',submission.id,entry_actor,p_actor_role_assignment_id,
      entry_system,'ACTUAL_PURCHASE_SPEND',p_reason,submission.correlation_id,
      'actual-spend-'||submission.id::text,p_at
    );
    next_remaining:=reservation.remaining_reserved-submission.submission_amount;
    IF submission.purchase_mode='FINAL' THEN
      release_amount:=next_remaining;
      IF release_amount>0 THEN
        PERFORM public.axora_post_budget_entry_internal(
          request.company_id,reservation.budget_account_id,
          reservation.budget_period_id,'RELEASE',release_amount,0,
          release_amount,-release_amount,0,0,0,0,request.id,
          request.request_version,reservation.id,NULL,'ACTUAL_SUBMISSION',
          submission.id,entry_actor,p_actor_role_assignment_id,entry_system,
          'ACTUAL_FINAL_RELEASE',p_reason,submission.correlation_id,
          'actual-release-'||submission.id::text,p_at
        );
      END IF;
      next_remaining:=0;
      next_status:=CASE WHEN release_amount>0
        THEN 'PARTIALLY_RELEASED' ELSE 'SPENT' END;
    ELSE
      next_status:='PARTIALLY_SPENT';
    END IF;
    UPDATE public.budget_reservations SET remaining_reserved=next_remaining,
      spent_amount=spent_amount+submission.submission_amount,
      released_amount=released_amount+release_amount,status=next_status,
      updated_at=p_at WHERE id=reservation.id;
    INSERT INTO public.budget_reservation_events(
      reservation_id,company_id,event_type,amount,previous_status,new_status,
      actor_user_id,system_job,reason,correlation_id,idempotency_key,occurred_at
    ) VALUES (
      reservation.id,request.company_id,'FINALIZED',
      submission.submission_amount,reservation.status,next_status,entry_actor,
      entry_system,p_reason,submission.correlation_id,
      'actual-final-event-'||submission.id::text,p_at
    );
    IF submission.purchase_mode='FINAL' THEN
      UPDATE public.fulfilment_purchase_assignments
      SET status='COMPLETED',completed_at=p_at,updated_at=p_at
      WHERE id=submission.assignment_id;
    END IF;
    result:=jsonb_build_object(
      'submissionId',submission.id,'requestId',request.id,'state','FINALIZED',
      'purchaseMode',submission.purchase_mode,
      'actualAmount',submission.submission_amount::text,
      'cumulativeActualAmount',submission.cumulative_actual_amount::text,
      'releasedAmount',release_amount::text,'additionalAmount',extra_amount::text,
      'correlationId',submission.correlation_id
    );
  END IF;
  UPDATE public.request_actual_submissions SET state='FINALIZED',
    approval_revision=approval_revision+1,result=result,finalized_at=p_at,
    updated_at=p_at WHERE id=submission.id;
  INSERT INTO public.request_actual_decisions(
    submission_id,request_id,company_id,approval_revision_before,
    approval_revision_after,state_before,state_after,decision,funding_option,
    actor_user_id,actor_role_assignment_id,system_job,reason,correlation_id,
    idempotency_key,result,decided_at
  ) VALUES (
    submission.id,request.id,request.company_id,submission.approval_revision,
    submission.approval_revision+1,submission.state,'FINALIZED',
    CASE WHEN p_system_job IS NOT NULL THEN 'AUTO_FINALIZE' ELSE 'APPROVE' END,
    p_funding_option,p_actor_user_id,p_actor_role_assignment_id,p_system_job,
    p_reason,submission.correlation_id,
    p_idempotency_key,result,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'request_actual_submissions',submission.id,'FINALIZE',p_actor_user_id,
    request.company_id,request.id,p_reason,
    jsonb_build_object(
      'state','FINALIZED','purchaseMode',submission.purchase_mode,
      'submissionAmount',submission.submission_amount::text,
      'cumulativeActualAmount',submission.cumulative_actual_amount::text
    )
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_submit_request_actual(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_purchase_mode text,p_receipt_attachment_id uuid,p_notes text,
  p_lines jsonb,p_idempotency_key text,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  request public.requests%ROWTYPE;
  assignment public.fulfilment_purchase_assignments%ROWTYPE;
  reservation public.budget_reservations%ROWTYPE;
  policy public.procurement_variance_policies%ROWTYPE;
  existing public.request_actual_submissions%ROWTYPE;
  item jsonb;
  request_line public.request_lines%ROWTYPE;
  actual_product_id uuid;
  supplier_id uuid;
  quantity_value numeric(14,3);
  buy_price numeric(18,6);
  tax_rate_value numeric(7,4);
  delivery_value numeric(18,2);
  other_value numeric(18,2);
  customer_price numeric(18,4);
  tax_value numeric(18,2);
  line_total_value numeric(18,2);
  total_value numeric(18,2):=0;
  previous_actual numeric(18,2);
  cumulative_actual numeric(18,2);
  estimate_value numeric(18,2);
  difference_value numeric(18,2);
  within_tolerance_value boolean;
  substitute_value boolean:=false;
  available_value numeric(18,2);
  company_exposure numeric(18,2);
  company_ceiling numeric(18,2);
  extra_value numeric(18,2);
  submission_state text;
  submission_id uuid:=gen_random_uuid();
  correlation uuid:=gen_random_uuid();
  result jsonb;
  markup_value numeric(9,4);
  rounding_value integer;
  relation record;
  recipients uuid[];
  event_key text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request FROM public.requests WHERE id=p_request_id FOR UPDATE;
  SELECT * INTO existing FROM public.request_actual_submissions
  WHERE request_id=request.id AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF snapshot IS NULL OR existing.submitted_by<>p_actor_user_id
      OR existing.submitted_by_role_assignment_id<>p_actor_role_assignment_id
      OR NOT public.axora_snapshot_has_permission(
        snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
      ) THEN
      RAISE EXCEPTION 'The actual purchase submission is unavailable';
    END IF;
    RETURN existing.result;
  END IF;
  SELECT * INTO assignment FROM public.fulfilment_purchase_assignments
  WHERE request_id=request.id AND request_version=request.request_version
    AND status='ASSIGNED' FOR UPDATE;
  SELECT * INTO reservation FROM public.budget_reservations
  WHERE request_id=request.id AND request_version=request.request_version
    AND status IN (
      'RESERVED','PARTIALLY_SPENT','SPENT','PARTIALLY_RELEASED',
      'ADDITIONAL_APPROVAL_REQUIRED'
    ) FOR UPDATE;
  IF snapshot IS NULL OR request.id IS NULL OR assignment.id IS NULL
    OR assignment.assigned_user_id<>p_actor_user_id
    OR assignment.assigned_role_assignment_id<>p_actor_role_assignment_id
    OR reservation.id IS NULL
    OR request.approval_state NOT IN ('APPROVED','AWAITING_FULFILMENT')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR upper(p_purchase_mode) NOT IN ('PARTIAL','FINAL','REFUND')
    OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0
    OR jsonb_array_length(p_lines)>200
    OR char_length(btrim(COALESCE(p_notes,''))) NOT BETWEEN 3 AND 2000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The actual purchase submission is unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attachments attachment
    WHERE attachment.id=p_receipt_attachment_id
      AND attachment.request_id=request.id
      AND attachment.company_id=request.company_id
      AND attachment.visibility='INTERNAL'
      AND attachment.uploaded_by=p_actor_user_id
  ) THEN RAISE EXCEPTION 'The private receipt evidence is unavailable'; END IF;
  SELECT * INTO policy
  FROM public.axora_current_variance_policy(request.company_id,p_at);
  SELECT snapshot.amount INTO estimate_value
  FROM public.request_approval_snapshots snapshot
  WHERE snapshot.request_id=request.id
    AND snapshot.request_version=request.request_version;
  SELECT COALESCE(sum(CASE submission.purchase_mode
      WHEN 'REFUND' THEN -submission.submission_amount
      ELSE submission.submission_amount END),0)::numeric(18,2)
    INTO previous_actual
  FROM public.request_actual_submissions submission
  WHERE submission.request_id=request.id AND submission.state='FINALIZED';
  SELECT rule.markup_percentage,rule.rounding_scale
    INTO markup_value,rounding_value
  FROM public.commercial_pricing_rules rule
  WHERE rule.status='ACTIVE' AND rule.effective_from<=p_at
  ORDER BY rule.effective_from DESC,rule.rule_version DESC LIMIT 1;
  IF policy.id IS NULL OR estimate_value IS NULL OR markup_value IS NULL THEN
    RAISE EXCEPTION 'The actual purchase policy is unavailable';
  END IF;

  INSERT INTO public.request_actual_submissions(
    id,request_id,request_version,company_id,assignment_id,reservation_id,
    variance_policy_id,variance_policy_version,purchase_mode,estimate_amount,
    previous_actual_amount,submission_amount,cumulative_actual_amount,
    difference_amount,within_tolerance,substitute_present,
    receipt_attachment_id,state,submitted_by,submitted_by_role_assignment_id,
    notes,idempotency_key,correlation_id,result,submitted_at
  ) VALUES (
    submission_id,request.id,request.request_version,request.company_id,
    assignment.id,reservation.id,policy.id,policy.policy_version,
    upper(p_purchase_mode),estimate_value,previous_actual,0,previous_actual,
    previous_actual-estimate_value,false,false,p_receipt_attachment_id,
    'PENDING_COMPANY',p_actor_user_id,p_actor_role_assignment_id,btrim(p_notes),
    p_idempotency_key,correlation,'{}'::jsonb,p_at
  );
  FOR item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO request_line FROM public.request_lines
    WHERE id=(item->>'requestLineId')::uuid
      AND request_id=request.id FOR SHARE;
    actual_product_id:=(item->>'actualProductId')::uuid;
    supplier_id:=(item->>'supplierId')::uuid;
    quantity_value:=(item->>'quantity')::numeric;
    buy_price:=(item->>'actualBuyUnitPrice')::numeric;
    tax_rate_value:=COALESCE((item->>'taxRate')::numeric,0);
    delivery_value:=COALESCE((item->>'deliveryCharge')::numeric,0);
    other_value:=COALESCE((item->>'otherCharge')::numeric,0);
    SELECT supplier_product.supplier_moq,
      supplier_product.maximum_order_quantity,
      supplier_product.order_increment
    INTO relation
    FROM public.product_suppliers supplier_product
    JOIN public.suppliers supplier ON supplier.id=supplier_product.supplier_id
      AND supplier.active AND supplier.company_id IS NULL
    JOIN public.products product ON product.id=supplier_product.product_id
      AND product.active
    WHERE supplier_product.product_id=actual_product_id
      AND supplier_product.supplier_id=supplier_id
      AND supplier_product.active
      AND supplier_product.quantity_rule_effective_from<=p_at
      AND (
        supplier_product.quantity_rule_effective_to IS NULL
        OR supplier_product.quantity_rule_effective_to>p_at
      )
    FOR SHARE OF supplier_product,supplier,product;
    IF request_line.id IS NULL OR relation.supplier_moq IS NULL
      OR quantity_value<=0 OR buy_price<0
      OR buy_price<>round(buy_price,6)
      OR tax_rate_value<0 OR tax_rate_value>100
      OR delivery_value<0 OR other_value<0
      OR NOT public.axora_quantity_is_valid(
        quantity_value,relation.supplier_moq,
        relation.maximum_order_quantity,relation.order_increment
      ) THEN RAISE EXCEPTION 'An actual purchase line is invalid'; END IF;
    IF actual_product_id<>request_line.product_id
      AND char_length(btrim(COALESCE(item->>'substituteReason','')))
        NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'A substitute reason is required';
    END IF;
    customer_price:=public.axora_round_commercial_price(
      buy_price,markup_value,rounding_value
    );
    tax_value:=round(quantity_value*customer_price*tax_rate_value/100,2);
    line_total_value:=round(
      quantity_value*customer_price+tax_value+delivery_value+other_value,2
    );
    total_value:=total_value+line_total_value;
    substitute_value:=substitute_value
      OR actual_product_id<>request_line.product_id;
    INSERT INTO public.request_actual_lines(
      submission_id,request_id,request_line_id,estimated_product_id,
      actual_product_id,supplier_id,quantity,unit_of_measure,
      actual_buy_unit_price,markup_percentage_snapshot,
      rounding_scale_snapshot,customer_unit_price,tax_rate,tax_amount,
      delivery_charge,other_charge,line_total,substitute_reason,notes,created_at
    ) VALUES (
      submission_id,request.id,request_line.id,request_line.product_id,
      actual_product_id,supplier_id,quantity_value,request_line.unit_of_measure,
      buy_price,markup_value,rounding_value,customer_price,tax_rate_value,
      tax_value,delivery_value,other_value,line_total_value,
      CASE WHEN actual_product_id<>request_line.product_id
        THEN btrim(item->>'substituteReason') END,
      NULLIF(btrim(COALESCE(item->>'notes','')),''),p_at
    );
  END LOOP;
  total_value:=round(total_value,2);
  cumulative_actual:=CASE WHEN upper(p_purchase_mode)='REFUND'
    THEN previous_actual-total_value ELSE previous_actual+total_value END;
  IF total_value<=0 OR cumulative_actual<0 THEN
    RAISE EXCEPTION 'The actual purchase total is invalid';
  END IF;
  difference_value:=cumulative_actual-estimate_value;
  within_tolerance_value:=difference_value<=0 OR CASE policy.tolerance_mode
    WHEN 'FIXED' THEN difference_value<=policy.fixed_tolerance
    WHEN 'PERCENTAGE' THEN difference_value<=round(
      estimate_value*policy.percentage_tolerance/100,2
    )
    ELSE false END;
  SELECT available INTO available_value FROM public.v_budget_period_balances
  WHERE budget_period_id=reservation.budget_period_id;
  SELECT COALESCE(sum(balance.reserved+balance.spent),0)::numeric(18,2)
    INTO company_exposure
  FROM public.v_budget_period_balances balance
  JOIN public.budget_periods period
    ON period.id=balance.budget_period_id AND period.status='ACTIVE'
  WHERE balance.company_id=request.company_id;
  SELECT contractual_ceiling INTO company_ceiling FROM public.companies
  WHERE id=request.company_id FOR KEY SHARE;
  extra_value:=CASE WHEN upper(p_purchase_mode)='REFUND' THEN 0
    ELSE greatest(total_value-reservation.remaining_reserved,0) END;
  submission_state:=CASE
    WHEN upper(p_purchase_mode)='REFUND' THEN 'FINALIZED'
    WHEN substitute_value THEN 'PENDING_COMPANY'
    WHEN within_tolerance_value AND extra_value<=available_value
      AND company_exposure+extra_value<=company_ceiling THEN 'FINALIZED'
    WHEN within_tolerance_value
      AND company_exposure+extra_value>company_ceiling THEN 'PENDING_AXORA'
    ELSE 'PENDING_COMPANY' END;
  UPDATE public.request_actual_submissions SET
    submission_amount=total_value,cumulative_actual_amount=cumulative_actual,
    difference_amount=difference_value,within_tolerance=within_tolerance_value,
    substitute_present=substitute_value,state=CASE
      WHEN submission_state='FINALIZED' THEN 'PENDING_COMPANY'
      ELSE submission_state END,
    result=jsonb_build_object(
      'submissionId',submission_id,'requestId',request.id,
      'state',submission_state,'actualAmount',total_value::text,
      'cumulativeActualAmount',cumulative_actual::text,
      'differenceAmount',difference_value::text,
      'withinTolerance',within_tolerance_value,
      'substitutePresent',substitute_value,'correlationId',correlation
    ),
    updated_at=p_at
  WHERE id=submission_id;
  IF submission_state='FINALIZED' THEN
    result:=public.axora_apply_actual_submission_internal(
      submission_id,p_actor_user_id,p_actor_role_assignment_id,
      'VARIANCE_POLICY_AUTO_FINALIZE',
      CASE WHEN extra_value>0 THEN 'APPROVE_ADDITIONAL' END,
      NULL,false,'Actual purchase accepted by the approved variance policy',
      'actual-apply-'||submission_id::text,p_at
    );
  ELSE
    SELECT result INTO result FROM public.request_actual_submissions
    WHERE id=submission_id;
  END IF;
  PERFORM public.axora_record_p1_procurement_audit(
    'request_actual_submissions',submission_id,'SUBMIT',p_actor_user_id,
    request.company_id,request.id,p_notes,
    jsonb_build_object(
      'state',result->>'state','purchaseMode',upper(p_purchase_mode),
      'submissionAmount',total_value::text,
      'cumulativeActualAmount',cumulative_actual::text,
      'receiptAttachmentId',p_receipt_attachment_id,
      'substitutePresent',substitute_value
    )
  );
  IF submission_state='FINALIZED' THEN
    recipients:=ARRAY[request.created_by,assignment.assigned_user_id];
    event_key:='request.approved';
  ELSE
    recipients:=public.axora_actual_approval_recipients(
      request.id,submission_state,p_at
    );
    event_key:=CASE WHEN substitute_value
      THEN 'approval.substitute_required'
      ELSE 'approval.additional_actual_required' END;
  END IF;
  PERFORM public.axora_emit_p1_notification(
    request.company_id,request.branch_id,request.id,'request.actual',
    submission_id,event_key,'actual-submission:'||submission_id::text,
    COALESCE(request.order_code,request.id::text),
    CASE WHEN submission_state='FINALIZED'
      THEN '/sourcing' ELSE '/approvals' END,
    recipients,p_actor_user_id,correlation,p_at,
    jsonb_build_object(
      'submissionId',submission_id,'state',submission_state,
      'actualAmount',total_value::text
    )
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_decide_request_actual(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_submission_id uuid,
  p_expected_revision integer,p_decision text,p_funding_option text,
  p_source_budget_account_id uuid,p_reason text,p_idempotency_key text,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  submission public.request_actual_submissions%ROWTYPE;
  request public.requests%ROWTYPE;
  assignment public.fulfilment_purchase_assignments%ROWTYPE;
  reservation public.budget_reservations%ROWTYPE;
  existing_decision public.request_actual_decisions%ROWTYPE;
  authorization_state text;
  approval_limit numeric(18,2);
  company_exposure numeric(18,2);
  company_ceiling numeric(18,2);
  extra_amount numeric(18,2);
  next_state text;
  action_value text;
  option_value text;
  result jsonb;
  correlation uuid:=gen_random_uuid();
  recipients uuid[];
BEGIN
  IF upper(p_decision) NOT IN ('APPROVE','RETURN','REJECT')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The actual purchase decision is unavailable';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO submission FROM public.request_actual_submissions
  WHERE id=p_submission_id FOR UPDATE;
  SELECT * INTO request FROM public.requests
  WHERE id=submission.request_id FOR UPDATE;
  SELECT * INTO assignment FROM public.fulfilment_purchase_assignments
  WHERE id=submission.assignment_id FOR SHARE;
  SELECT * INTO reservation FROM public.budget_reservations
  WHERE id=submission.reservation_id FOR UPDATE;
  option_value:=upper(NULLIF(COALESCE(p_funding_option,''),''));
  IF snapshot IS NULL OR submission.id IS NULL OR request.id IS NULL
    OR assignment.id IS NULL OR reservation.id IS NULL
    OR submission.submitted_by=p_actor_user_id
    OR assignment.assigned_user_id=p_actor_user_id
    THEN
    RAISE EXCEPTION 'The actual purchase decision is unavailable';
  END IF;
  SELECT * INTO existing_decision
  FROM public.request_actual_decisions decision
  WHERE decision.submission_id=submission.id
    AND decision.idempotency_key=p_idempotency_key;
  IF existing_decision.id IS NOT NULL AND (
    existing_decision.actor_user_id<>p_actor_user_id
    OR existing_decision.actor_role_assignment_id<>p_actor_role_assignment_id
    OR existing_decision.approval_revision_before<>p_expected_revision
  ) THEN RAISE EXCEPTION 'The actual purchase decision is unavailable'; END IF;
  authorization_state:=COALESCE(existing_decision.state_before,submission.state);
  IF authorization_state NOT IN ('PENDING_COMPANY','PENDING_AXORA') THEN
    RAISE EXCEPTION 'The actual purchase decision is unavailable';
  END IF;
  IF authorization_state='PENDING_COMPANY' THEN
    IF NOT public.axora_snapshot_has_permission(
      snapshot,'request.approve.additional_actual',
      CASE WHEN request.department_id IS NULL THEN 'BRANCH'
        ELSE 'DEPARTMENT' END,
      request.company_id,request.branch_id,request.department_id,NULL
    ) THEN RAISE EXCEPTION 'The actual purchase decision is unavailable'; END IF;
    approval_limit:=public.axora_approval_limit_for_request(
      snapshot,'request.approve.additional_actual',request.company_id,
      request.branch_id,request.department_id,reservation.currency,false
    );
    IF approval_limit IS NULL
      OR approval_limit<submission.cumulative_actual_amount THEN
      RAISE EXCEPTION 'The actual purchase decision is unavailable';
    END IF;
  ELSIF NOT public.axora_snapshot_has_permission(
    snapshot,'commercial.company_ceiling.override','PLATFORM',
    NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'The actual purchase decision is unavailable'; END IF;
  IF existing_decision.id IS NOT NULL THEN RETURN existing_decision.result; END IF;
  IF submission.approval_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'The actual purchase decision is unavailable';
  END IF;
  IF upper(p_decision) IN ('RETURN','REJECT') THEN
    next_state:=CASE WHEN upper(p_decision)='RETURN'
      THEN 'RETURNED' ELSE 'REJECTED' END;
    action_value:=upper(p_decision);
    result:=jsonb_build_object(
      'submissionId',submission.id,'requestId',request.id,'state',next_state,
      'correlationId',correlation
    );
    UPDATE public.request_actual_submissions SET state=next_state,
      approval_revision=approval_revision+1,result=result,updated_at=p_at
    WHERE id=submission.id;
  ELSE
    extra_amount:=greatest(
      submission.submission_amount-reservation.remaining_reserved,0
    );
    IF extra_amount>0 AND option_value NOT IN (
      'APPROVE_ADDITIONAL','TRANSFER_RESERVE','TEMPORARY_INCREASE'
    ) THEN RAISE EXCEPTION 'An additional amount funding option is required'; END IF;
    IF submission.state='PENDING_COMPANY'
      AND option_value='TRANSFER_RESERVE'
      AND NOT public.axora_budget_account_permission(
        snapshot,'budget.assign',
        (SELECT level_type FROM public.budget_accounts
          WHERE id=reservation.budget_account_id),
        request.company_id,request.branch_id,request.department_id
      ) THEN RAISE EXCEPTION 'The transfer option is unavailable'; END IF;
    IF submission.state='PENDING_COMPANY'
      AND option_value='TEMPORARY_INCREASE'
      AND NOT public.axora_budget_account_permission(
        snapshot,'budget.increase',
        (SELECT level_type FROM public.budget_accounts
          WHERE id=reservation.budget_account_id),
        request.company_id,request.branch_id,request.department_id
      ) THEN RAISE EXCEPTION 'The temporary increase is unavailable'; END IF;
    SELECT COALESCE(sum(balance.reserved+balance.spent),0)::numeric(18,2)
      INTO company_exposure
    FROM public.v_budget_period_balances balance
    JOIN public.budget_periods period
      ON period.id=balance.budget_period_id AND period.status='ACTIVE'
    WHERE balance.company_id=request.company_id;
    SELECT contractual_ceiling INTO company_ceiling FROM public.companies
    WHERE id=request.company_id FOR KEY SHARE;
    IF submission.state='PENDING_COMPANY'
      AND company_exposure+extra_amount>company_ceiling THEN
      next_state:='PENDING_AXORA';
      action_value:='ESCALATE';
      result:=jsonb_build_object(
        'submissionId',submission.id,'requestId',request.id,
        'state',next_state,'correlationId',correlation
      );
      UPDATE public.request_actual_submissions SET state=next_state,
        approval_revision=approval_revision+1,
        approved_funding_option=option_value,
        approved_source_budget_account_id=p_source_budget_account_id,
        result=result,updated_at=p_at WHERE id=submission.id;
    ELSE
      result:=public.axora_apply_actual_submission_internal(
        submission.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
        COALESCE(
          CASE WHEN submission.state='PENDING_AXORA'
            THEN submission.approved_funding_option END,
          option_value
        ),
        COALESCE(
          CASE WHEN submission.state='PENDING_AXORA'
            THEN submission.approved_source_budget_account_id END,
          p_source_budget_account_id
        ),
        submission.state='PENDING_AXORA',p_reason,p_idempotency_key,p_at
      );
      next_state:='FINALIZED';
      action_value:='APPROVE';
    END IF;
  END IF;
  IF action_value<>'APPROVE' OR next_state<>'FINALIZED' THEN
    INSERT INTO public.request_actual_decisions(
      submission_id,request_id,company_id,approval_revision_before,
      approval_revision_after,state_before,state_after,decision,funding_option,
      actor_user_id,actor_role_assignment_id,reason,correlation_id,
      idempotency_key,result,decided_at
    ) VALUES (
      submission.id,request.id,request.company_id,submission.approval_revision,
      submission.approval_revision+1,submission.state,next_state,action_value,
      option_value,p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
      correlation,p_idempotency_key,result,p_at
    );
  END IF;
  PERFORM public.axora_record_p1_procurement_audit(
    'request_actual_submissions',submission.id,action_value,p_actor_user_id,
    request.company_id,request.id,p_reason,
    jsonb_build_object(
      'state',next_state,
      'cumulativeActualAmount',submission.cumulative_actual_amount::text
    )
  );
  recipients:=CASE WHEN next_state='PENDING_AXORA'
    THEN public.axora_actual_approval_recipients(request.id,next_state,p_at)
    ELSE ARRAY[request.created_by,assignment.assigned_user_id] END;
  PERFORM public.axora_emit_p1_notification(
    request.company_id,request.branch_id,request.id,'request.actual',
    submission.id,
    CASE WHEN next_state='FINALIZED' THEN 'request.approved'
      WHEN next_state='RETURNED' THEN 'request.returned'
      WHEN next_state='REJECTED' THEN 'request.rejected'
      ELSE 'approval.additional_actual_required' END,
    'actual-decision:'||submission.id::text||':'||submission.approval_revision,
    COALESCE(request.order_code,request.id::text),
    CASE WHEN next_state='PENDING_AXORA' THEN '/approvals'
      ELSE '/requests/'||request.id::text END,
    recipients,p_actor_user_id,correlation,p_at,
    jsonb_build_object('submissionId',submission.id,'state',next_state)
  );
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.axora_budget_cycle_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'accounts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',account.id,'companyId',account.company_id,
        'name',account.name,'code',account.account_code,
        'currency',account.currency,'levelType',account.level_type,
        'canRequest',true,
        'canApprove',public.axora_budget_account_permission(
          snapshot,'budget.assign',account.level_type,account.company_id,
          account.branch_id,account.department_id
        ),
        'canRefresh',public.axora_budget_account_permission(
          snapshot,'budget.refresh',account.level_type,account.company_id,
          account.branch_id,account.department_id
        ),
        'schedule',jsonb_build_object(
          'id',schedule.id,'version',schedule.schedule_version,
          'frequency',schedule.frequency,'intervalCount',schedule.interval_count,
          'customIntervalDays',schedule.custom_interval_days,
          'timezone',schedule.timezone,'anchorLocal',schedule.anchor_local,
          'dstResolution',schedule.dst_resolution,
          'fixedAllocation',schedule.fixed_allocation::text,
          'rolloverMode',schedule.rollover_mode,
          'rolloverPercentage',schedule.rollover_percentage,
          'customRolloverAmount',schedule.custom_rollover_amount,
          'lowThresholdPercentage',schedule.low_threshold_percentage,
          'criticalThresholdPercentage',schedule.critical_threshold_percentage,
          'hysteresisPercentage',schedule.hysteresis_percentage,
          'effectiveAt',schedule.effective_at
        ),
        'nextRefreshAt',period.ends_at,
        'periods',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',history.id,'name',history.period_name,
            'startsAt',history.starts_at,'endsAt',history.ends_at,
            'status',history.status,'scheduleVersion',history.schedule_version,
            'allocated',balance.allocated::text,
            'available',balance.available::text,
            'reserved',balance.reserved::text,'spent',balance.spent::text
          ) ORDER BY history.starts_at DESC)
          FROM (
            SELECT * FROM public.budget_periods candidate
            WHERE candidate.budget_account_id=account.id
            ORDER BY candidate.starts_at DESC LIMIT 8
          ) history
          JOIN public.v_budget_period_balances balance
            ON balance.budget_period_id=history.id
        ),'[]'::jsonb)
      ) ORDER BY account.level_type,account.name)
      FROM public.budget_accounts account
      JOIN public.budget_periods period
        ON period.budget_account_id=account.id AND period.status='ACTIVE'
      JOIN LATERAL (
        SELECT candidate.* FROM public.budget_cycle_schedules candidate
        WHERE candidate.budget_account_id=account.id
          AND candidate.effective_at<=greatest(p_at,period.starts_at)
        ORDER BY candidate.effective_at DESC,candidate.schedule_version DESC
        LIMIT 1
      ) schedule ON true
      WHERE account.active AND public.axora_budget_account_permission(
        snapshot,'budget.view',account.level_type,account.company_id,
        account.branch_id,account.department_id
      )
    ),'[]'::jsonb),
    'changeRequests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',change.id,'budgetAccountId',change.budget_account_id,
        'accountName',account.name,'state',change.state,
        'requestedBy',requester.display_name,
        'requestedById',change.requested_by,
        'reason',change.request_reason,'config',change.proposed_config,
        'effectiveAt',change.proposed_effective_at,
        'createdAt',change.created_at,
        'canDecide',change.requested_by<>p_actor_user_id AND (
          (change.state='PENDING_COMPANY'
            AND public.axora_budget_account_permission(
              snapshot,'budget.assign',account.level_type,account.company_id,
              account.branch_id,account.department_id
            ))
          OR (change.state='PENDING_AXORA'
            AND public.axora_snapshot_has_permission(
              snapshot,'commercial.company_ceiling.override','PLATFORM',
              NULL,NULL,NULL,NULL
            ))
        )
      ) ORDER BY change.created_at DESC)
      FROM public.budget_cycle_change_requests change
      JOIN public.budget_accounts account ON account.id=change.budget_account_id
      JOIN public.users requester ON requester.id=change.requested_by
      WHERE change.state IN ('PENDING_COMPANY','PENDING_AXORA')
        AND public.axora_budget_account_permission(
          snapshot,'budget.view',account.level_type,account.company_id,
          account.branch_id,account.department_id
        )
    ),'[]'::jsonb),
    'jobs',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',job.id,'budgetAccountId',job.budget_account_id,
        'accountName',account.name,'state',job.state,
        'dueAt',job.due_at,'nextAttemptAt',job.next_attempt_at,
        'attemptCount',job.attempt_count,'maxAttempts',job.max_attempts,
        'lastErrorCode',job.last_error_code,
        'manualRerunCount',job.manual_rerun_count,
        'canRerun',job.state IN ('RETRY','DEAD_LETTER')
          AND public.axora_budget_account_permission(
            snapshot,'budget.refresh',account.level_type,account.company_id,
            account.branch_id,account.department_id
          )
      ) ORDER BY job.due_at DESC)
      FROM (
        SELECT candidate.* FROM public.budget_refresh_jobs candidate
        ORDER BY candidate.due_at DESC LIMIT 50
      ) job
      JOIN public.budget_accounts account ON account.id=job.budget_account_id
      WHERE public.axora_budget_account_permission(
        snapshot,'budget.view',account.level_type,account.company_id,
        account.branch_id,account.department_id
      )
    ),'[]'::jsonb),
    'alerts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',alert.id,'budgetAccountId',alert.budget_account_id,
        'accountName',account.name,'thresholdCode',alert.threshold_code,
        'active',alert.active,'lastAvailable',alert.last_available::text,
        'lastPercentage',alert.last_percentage,
        'notificationCount',alert.notification_count,
        'lastNotifiedAt',alert.last_notified_at
      ) ORDER BY alert.updated_at DESC)
      FROM public.budget_alert_states alert
      JOIN public.budget_accounts account ON account.id=alert.budget_account_id
      WHERE public.axora_budget_account_permission(
        snapshot,'budget.view',account.level_type,account.company_id,
        account.branch_id,account.department_id
      )
    ),'[]'::jsonb),
    'variancePolicies',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',policy.id,'companyId',policy.company_id,
        'companyName',company.name,'version',policy.policy_version,
        'toleranceMode',policy.tolerance_mode,
        'fixedTolerance',policy.fixed_tolerance,
        'percentageTolerance',policy.percentage_tolerance,
        'effectiveAt',policy.effective_at,
        'canRequest',public.axora_snapshot_has_permission(
          snapshot,'budget.view','COMPANY',policy.company_id,NULL,NULL,NULL
        )
      ) ORDER BY company.name)
      FROM public.procurement_variance_policies policy
      JOIN public.companies company ON company.id=policy.company_id
      WHERE policy.id=(
        SELECT current_policy.id
        FROM public.procurement_variance_policies current_policy
        WHERE current_policy.company_id=policy.company_id
          AND current_policy.effective_at<=p_at
        ORDER BY current_policy.effective_at DESC,
          current_policy.policy_version DESC LIMIT 1
      )
      AND EXISTS (
        SELECT 1 FROM public.budget_accounts account
        WHERE account.company_id=policy.company_id
          AND public.axora_budget_account_permission(
            snapshot,'budget.view',account.level_type,account.company_id,
            account.branch_id,account.department_id
          )
      )
    ),'[]'::jsonb),
    'variancePolicyChanges',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',change.id,'companyId',change.company_id,
        'companyName',company.name,'state',change.state,
        'requestedBy',requester.display_name,'requestedById',change.requested_by,
        'policy',change.proposed_policy,'effectiveAt',change.proposed_effective_at,
        'reason',change.request_reason,'createdAt',change.created_at,
        'canDecide',change.requested_by<>p_actor_user_id
          AND public.axora_snapshot_has_permission(
            snapshot,'request.approve.additional_actual','COMPANY',
            change.company_id,NULL,NULL,NULL
          )
      ) ORDER BY change.created_at DESC)
      FROM public.procurement_variance_policy_changes change
      JOIN public.companies company ON company.id=change.company_id
      JOIN public.users requester ON requester.id=change.requested_by
      WHERE change.state='PENDING_COMPANY'
        AND EXISTS (
          SELECT 1 FROM public.budget_accounts account
          WHERE account.company_id=change.company_id
            AND public.axora_budget_account_permission(
              snapshot,'budget.view',account.level_type,account.company_id,
              account.branch_id,account.department_id
            )
        )
    ),'[]'::jsonb),
    'adjustmentRequests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',adjustment.id,'budgetAccountId',account.id,
        'accountName',account.name,'state',adjustment.state,
        'adjustmentType',adjustment.adjustment_type,
        'amount',adjustment.amount::text,
        'sourceBudgetAccountId',adjustment.source_budget_account_id,
        'requestedBy',requester.display_name,
        'requestedById',adjustment.requested_by,
        'reason',adjustment.request_reason,'createdAt',adjustment.created_at,
        'canDecide',adjustment.requested_by<>p_actor_user_id AND (
          (adjustment.state='PENDING_COMPANY'
            AND public.axora_budget_account_permission(
              snapshot,
              CASE WHEN adjustment.adjustment_type='TRANSFER'
                THEN 'budget.assign' ELSE 'budget.increase' END,
              account.level_type,account.company_id,account.branch_id,
              account.department_id
            ))
          OR (adjustment.state='PENDING_AXORA'
            AND public.axora_snapshot_has_permission(
              snapshot,'commercial.company_ceiling.override','PLATFORM',
              NULL,NULL,NULL,NULL
            ))
        )
      ) ORDER BY adjustment.created_at DESC)
      FROM public.budget_adjustment_requests adjustment
      JOIN public.budget_accounts account
        ON account.id=adjustment.target_budget_account_id
      JOIN public.users requester ON requester.id=adjustment.requested_by
      WHERE adjustment.state IN ('PENDING_COMPANY','PENDING_AXORA')
        AND public.axora_budget_account_permission(
          snapshot,'budget.view',account.level_type,account.company_id,
          account.branch_id,account.department_id
        )
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_procurement_actual_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; can_assign boolean;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  can_assign:=public.axora_snapshot_has_permission(
    snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
  );
  RETURN jsonb_build_object(
    'capturedAt',p_at,'canAssign',can_assign,
    'eligibleUsers',CASE WHEN can_assign THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId',assignment.user_id,'roleAssignmentId',assignment.id,
        'name',account.display_name
      ) ORDER BY account.display_name)
      FROM public.role_assignments assignment
      JOIN public.users account ON account.id=assignment.user_id
        AND account.active AND account.account_status='ACTIVE'
      WHERE assignment.active AND assignment.revoked_at IS NULL
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            assignment.user_id,assignment.id,p_at
          ),
          'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
        )
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'products',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',product.id,'name',product.name,'code',product.product_code
      ) ORDER BY product.name)
      FROM public.products product WHERE product.active
    ),'[]'::jsonb),
    'suppliers',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',supplier.id,'name',supplier.name,'code',supplier.supplier_code
      ) ORDER BY supplier.name)
      FROM public.suppliers supplier
      WHERE supplier.active AND supplier.company_id IS NULL
    ),'[]'::jsonb),
    'requests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',request.id,'requestNumber',request.order_code,
        'requestVersion',request.request_version,
        'companyName',company.name,'branchName',branch.name,
        'currency',request.currency,'estimateAmount',approval.amount::text,
        'reservationRemaining',reservation.remaining_reserved::text,
        'assignment',CASE WHEN fulfilment.id IS NULL THEN NULL ELSE
          jsonb_build_object(
            'id',fulfilment.id,'assignedUserId',fulfilment.assigned_user_id,
            'assignedUserName',assigned_user.display_name,
            'status',fulfilment.status
          ) END,
        'canSubmit',fulfilment.status='ASSIGNED'
          AND fulfilment.assigned_user_id=p_actor_user_id
          AND fulfilment.assigned_role_assignment_id=p_actor_role_assignment_id,
        'lines',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',line.id,'productId',line.product_id,
            'productName',line.product_name_snapshot,
            'quantity',line.quantity,'unitOfMeasure',line.unit_of_measure,
            'estimatedUnitPrice',line.unit_sell_price::text,
            'selectedSupplierId',line.selected_supplier_id
          ) ORDER BY line.request_line_code)
          FROM public.request_lines line WHERE line.request_id=request.id
        ),'[]'::jsonb),
        'actualHistory',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',actual.id,'purchaseMode',actual.purchase_mode,
            'state',actual.state,'submissionAmount',actual.submission_amount::text,
            'cumulativeActualAmount',actual.cumulative_actual_amount::text,
            'differenceAmount',actual.difference_amount::text,
            'withinTolerance',actual.within_tolerance,
            'substitutePresent',actual.substitute_present,
            'receiptAttachmentId',actual.receipt_attachment_id,
            'submittedAt',actual.submitted_at
          ) ORDER BY actual.submitted_at DESC)
          FROM public.request_actual_submissions actual
          WHERE actual.request_id=request.id
        ),'[]'::jsonb)
      ) ORDER BY request.created_at DESC)
      FROM public.requests request
      JOIN public.companies company ON company.id=request.company_id
      JOIN public.branches branch ON branch.id=request.branch_id
      JOIN public.request_approval_snapshots approval
        ON approval.request_id=request.id
       AND approval.request_version=request.request_version
      JOIN public.budget_reservations reservation
        ON reservation.request_id=request.id
       AND reservation.request_version=request.request_version
      LEFT JOIN public.fulfilment_purchase_assignments fulfilment
        ON fulfilment.request_id=request.id
       AND fulfilment.request_version=request.request_version
       AND fulfilment.status='ASSIGNED'
      LEFT JOIN public.users assigned_user
        ON assigned_user.id=fulfilment.assigned_user_id
      WHERE request.approval_state IN ('APPROVED','AWAITING_FULFILMENT')
        AND (
          can_assign OR fulfilment.assigned_user_id=p_actor_user_id
        )
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_procurement_variance_approval_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'submissions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',submission.id,'requestId',request.id,
        'requestNumber',request.order_code,
        'companyName',company.name,'branchName',branch.name,
        'currency',request.currency,'state',submission.state,
        'approvalRevision',submission.approval_revision,
        'estimateAmount',submission.estimate_amount::text,
        'previousActualAmount',submission.previous_actual_amount::text,
        'submissionAmount',submission.submission_amount::text,
        'cumulativeActualAmount',submission.cumulative_actual_amount::text,
        'differenceAmount',submission.difference_amount::text,
        'withinTolerance',submission.within_tolerance,
        'substitutePresent',submission.substitute_present,
        'receiptProvided',true,'notes',submission.notes,
        'submittedBy',submitter.display_name,
        'submittedAt',submission.submitted_at,
        'lines',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',line.id,'estimatedProductName',estimated.name,
            'actualProductName',actual.name,'quantity',line.quantity,
            'unitOfMeasure',line.unit_of_measure,
            'customerUnitPrice',line.customer_unit_price::text,
            'taxAmount',line.tax_amount::text,
            'deliveryCharge',line.delivery_charge::text,
            'otherCharge',line.other_charge::text,
            'lineTotal',line.line_total::text,
            'substituteReason',line.substitute_reason
          ) ORDER BY line.id)
          FROM public.request_actual_lines line
          JOIN public.products estimated ON estimated.id=line.estimated_product_id
          JOIN public.products actual ON actual.id=line.actual_product_id
          WHERE line.submission_id=submission.id
        ),'[]'::jsonb),
        'sourceAccounts',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',source.id,'name',source.name,
            'available',balance.available::text
          ) ORDER BY source.name)
          FROM public.budget_accounts source
          JOIN public.budget_periods period
            ON period.budget_account_id=source.id AND period.status='ACTIVE'
          JOIN public.v_budget_period_balances balance
            ON balance.budget_period_id=period.id
          WHERE source.company_id=request.company_id
            AND source.currency=request.currency
            AND source.id<>reservation.budget_account_id
            AND public.axora_budget_account_permission(
              snapshot,'budget.assign',source.level_type,source.company_id,
              source.branch_id,source.department_id
            )
        ),'[]'::jsonb)
      ) ORDER BY submission.submitted_at)
      FROM public.request_actual_submissions submission
      JOIN public.requests request ON request.id=submission.request_id
      JOIN public.companies company ON company.id=request.company_id
      JOIN public.branches branch ON branch.id=request.branch_id
      JOIN public.users submitter ON submitter.id=submission.submitted_by
      JOIN public.budget_reservations reservation
        ON reservation.id=submission.reservation_id
      JOIN public.fulfilment_purchase_assignments fulfilment
        ON fulfilment.id=submission.assignment_id
      WHERE submission.state IN ('PENDING_COMPANY','PENDING_AXORA')
        AND submission.submitted_by<>p_actor_user_id
        AND fulfilment.assigned_user_id<>p_actor_user_id
        AND (
          (submission.state='PENDING_COMPANY'
            AND public.axora_snapshot_has_permission(
              snapshot,'request.approve.additional_actual',
              CASE WHEN request.department_id IS NULL THEN 'BRANCH'
                ELSE 'DEPARTMENT' END,
              request.company_id,request.branch_id,request.department_id,NULL
            )
            AND public.axora_approval_limit_for_request(
              snapshot,'request.approve.additional_actual',request.company_id,
              request.branch_id,request.department_id,request.currency,false
            )>=submission.cumulative_actual_amount)
          OR (submission.state='PENDING_AXORA'
            AND public.axora_snapshot_has_permission(
              snapshot,'commercial.company_ceiling.override','PLATFORM',
              NULL,NULL,NULL,NULL
            ))
        )
    ),'[]'::jsonb)
  );
END $$;

-- Tables stay inaccessible to the application role. Every returned row is
-- filtered in the capability functions above before it leaves PostgreSQL.
ALTER TABLE public.budget_cycle_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_cycle_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_cycle_change_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_refresh_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_refresh_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_alert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reservation_rollovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_variance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_variance_policy_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_variance_policy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfilment_purchase_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_actual_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_actual_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_actual_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_adjustment_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.budget_cycle_schedules,public.budget_cycle_change_requests,
  public.budget_cycle_change_decisions,public.budget_refresh_jobs,
  public.budget_refresh_job_events,public.budget_alert_states,
  public.budget_reservation_rollovers,public.procurement_variance_policies,
  public.procurement_variance_policy_changes,
  public.procurement_variance_policy_decisions,
  public.fulfilment_purchase_assignments,public.request_actual_submissions,
  public.request_actual_lines,public.request_actual_decisions,
  public.budget_adjustment_requests,public.budget_adjustment_decisions
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.axora_reject_p1_procurement_evidence_change(),
  public.axora_record_p1_procurement_audit(text,uuid,text,uuid,uuid,uuid,text,jsonb),
  public.axora_resolve_budget_local_boundary(timestamp,text,text),
  public.axora_next_budget_boundary(uuid,timestamptz),
  public.axora_p1_notification_copy(text,text,text),
  public.axora_emit_p1_notification(uuid,uuid,uuid,text,uuid,text,text,text,text,uuid[],uuid,uuid,timestamptz,jsonb),
  public.axora_budget_notification_recipients(uuid,text,uuid,timestamptz),
  public.axora_emit_budget_notification(uuid,text,text,uuid,uuid,uuid,timestamptz,jsonb),
  public.axora_seed_budget_period_schedule(),
  public.axora_seed_variance_policy(),
  public.axora_current_variance_policy(uuid,timestamptz),
  public.axora_evaluate_budget_alerts_internal(uuid,timestamptz),
  public.axora_evaluate_budget_alert_after_entry(),
  public.axora_refresh_budget_period_internal(uuid,uuid,uuid,text,text,text,timestamptz),
  public.axora_budget_retry_delay(integer),
  public.axora_apply_budget_adjustment_internal(uuid,uuid,uuid,boolean,text,timestamptz),
  public.axora_actual_approval_recipients(uuid,text,timestamptz),
  public.axora_apply_actual_submission_internal(uuid,uuid,uuid,text,text,uuid,boolean,text,text,timestamptz)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.axora_request_budget_cycle_change(uuid,uuid,uuid,jsonb,text,text,timestamptz),
  public.axora_decide_budget_cycle_change(uuid,uuid,uuid,text,text,text,timestamptz),
  public.axora_request_variance_policy_change(uuid,uuid,uuid,jsonb,text,text,timestamptz),
  public.axora_decide_variance_policy_change(uuid,uuid,uuid,text,text,text,timestamptz),
  public.axora_reconcile_budget_refresh_jobs(timestamptz),
  public.axora_claim_budget_refresh_jobs(text,integer,integer,timestamptz),
  public.axora_process_budget_refresh_job(text,uuid,uuid,timestamptz),
  public.axora_rerun_budget_refresh_job(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_request_budget_adjustment(uuid,uuid,uuid,jsonb,text,text,timestamptz),
  public.axora_decide_budget_adjustment(uuid,uuid,uuid,text,text,text,timestamptz),
  public.axora_assign_fulfilment_purchase(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz),
  public.axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz),
  public.axora_decide_request_actual(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz),
  public.axora_budget_cycle_workspace(uuid,uuid,timestamptz),
  public.axora_procurement_actual_workspace(uuid,uuid,timestamptz),
  public.axora_procurement_variance_approval_workspace(uuid,uuid,timestamptz)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.budget_cycle_schedules,public.budget_cycle_change_requests,
      public.budget_cycle_change_decisions,public.budget_refresh_jobs,
      public.budget_refresh_job_events,public.budget_alert_states,
      public.budget_reservation_rollovers,public.procurement_variance_policies,
      public.procurement_variance_policy_changes,
      public.procurement_variance_policy_decisions,
      public.fulfilment_purchase_assignments,public.request_actual_submissions,
      public.request_actual_lines,public.request_actual_decisions,
      public.budget_adjustment_requests,public.budget_adjustment_decisions
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_request_budget_cycle_change(uuid,uuid,uuid,jsonb,text,text,timestamptz),
      public.axora_decide_budget_cycle_change(uuid,uuid,uuid,text,text,text,timestamptz),
      public.axora_request_variance_policy_change(uuid,uuid,uuid,jsonb,text,text,timestamptz),
      public.axora_decide_variance_policy_change(uuid,uuid,uuid,text,text,text,timestamptz),
      public.axora_reconcile_budget_refresh_jobs(timestamptz),
      public.axora_claim_budget_refresh_jobs(text,integer,integer,timestamptz),
      public.axora_process_budget_refresh_job(text,uuid,uuid,timestamptz),
      public.axora_rerun_budget_refresh_job(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_request_budget_adjustment(uuid,uuid,uuid,jsonb,text,text,timestamptz),
      public.axora_decide_budget_adjustment(uuid,uuid,uuid,text,text,text,timestamptz),
      public.axora_assign_fulfilment_purchase(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz),
      public.axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz),
      public.axora_decide_request_actual(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz),
      public.axora_budget_cycle_workspace(uuid,uuid,timestamptz),
      public.axora_procurement_actual_workspace(uuid,uuid,timestamptz),
      public.axora_procurement_variance_approval_workspace(uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
