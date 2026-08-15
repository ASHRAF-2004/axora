BEGIN;

-- Audit identifiers are immutable historical snapshots, not ownership links.
-- Keeping these foreign keys would force either deletion or mutation of the
-- append-only integrity chain before a disposable tenant root could be
-- removed. The values remain unchanged and owner-only audit access remains.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_company_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;

ALTER TABLE public.company_deletion_ownership_rules
  DROP CONSTRAINT IF EXISTS company_deletion_ownership_rules_unprotected_action_check;
ALTER TABLE public.company_deletion_ownership_rules
  ADD CONSTRAINT company_deletion_ownership_rules_unprotected_action_check
  CHECK (unprotected_action IN (
    'HARD_DELETE','CASCADE_DELETE','ANONYMIZE_AND_RETAIN',
    'RETAIN_WITH_ACCESS_REVOKED','BLOCK'
  ));
UPDATE public.company_deletion_ownership_rules
SET unprotected_action='RETAIN_WITH_ACCESS_REVOKED',
  protected_action='RETAIN_WITH_ACCESS_REVOKED',
  rationale='Append-only audit snapshots remain immutable after tenant removal; their historical UUID values are not ownership foreign keys.'
WHERE table_name='audit_logs';

-- The reviewed list is the deletion DAG. Only tables with a direct,
-- validated company_id scope may appear here. Indirect child tables are
-- handled explicitly in the capability before this ordered pass.
CREATE TABLE public.company_deletion_ownership_dag (
  delete_order integer PRIMARY KEY CHECK (delete_order BETWEEN 1 AND 1000),
  table_name text NOT NULL UNIQUE
    REFERENCES public.company_deletion_ownership_rules(table_name) ON DELETE RESTRICT,
  scope_column text NOT NULL DEFAULT 'company_id' CHECK (scope_column='company_id'),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 8 AND 500)
);

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT ordinality::integer,table_name,
  'Reviewed company-owned table; delete after all earlier dependency rows while foreign keys and triggers remain active.'
FROM unnest(ARRAY[
  'account_setup_invitations','approval_limits','branch_assignments',
  'branch_delivery_service_levels','budget_adjustment_decisions',
  'budget_adjustment_requests','budget_alert_states',
  'budget_cycle_change_decisions','budget_cycle_change_requests',
  'budget_ledger_entries','budget_refresh_job_events','budget_refresh_jobs',
  'budget_reservation_events','budget_reservation_rollovers',
  'company_brand_theme_events','company_brand_theme_workflows',
  'company_brand_themes','company_ceiling_history','company_duplicate_candidates',
  'company_logos','company_manager_continuity_events','company_assignments',
  'company_memberships','company_notification_preferences',
  'company_onboarding_reminders','company_onboarding_items',
  'company_publication_history','company_status_history',
  'company_verification_history','customer_three_way_matches',
  'delegated_access_scopes','delivery_evidence','delivery_job_events',
  'delivery_otp_events','delivery_otp_challenges','delivery_proof_exceptions',
  'delivery_tracking_points','delivery_tracking_route_summaries',
  'delivery_tracking_session_events','delivery_tracking_sessions',
  'delivery_job_assignments','delivery_workflow_commands',
  'department_assignments','document_enqueue_failures',
  'document_generation_events','email_delivery_attempts',
  'email_operations_events',
  'in_app_notifications','organization_structure_history',
  'payment_accountability_events','procurement_variance_policy_decisions',
  'procurement_variance_policy_changes','products','request_actual_decisions',
  'request_actual_submissions','attachments','budget_reservations',
  'fulfilment_purchase_assignments','procurement_variance_policies',
  'request_approval_escalations','request_approval_decisions',
  'request_approval_outbox','request_approval_snapshots',
  'request_line_receipt_baseline_sources','request_line_receipt_baselines',
  'supplier_purchase_order_events','supplier_purchase_order_workflows',
  'generated_documents','document_generation_jobs',
  'supplier_rfq_acknowledgements','supplier_rfq_documents',
  'three_way_match_exceptions','three_way_matches','invoices','receipt_lines',
  'delivery_job_lines','receipts','delivery_jobs',
  'supplier_quotation_responses','supplier_rfqs','user_permission_overrides',
  'user_scopes','workflow_email_outbox','workflow_events','requests',
  'budget_periods','budget_cycle_schedules','budget_accounts','cost_centres',
  'business_units','delivery_locations','request_approval_policies',
  'role_assignments','departments','suppliers','users','branches'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality);

ALTER TABLE public.company_deletion_ownership_dag ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_ownership_dag FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_deletion_ownership_dag FROM PUBLIC;

-- A custom GUC is user-settable and therefore cannot authorize deletion. This
-- private row exists only inside the SECURITY DEFINER deletion transaction and
-- is removed before the capability returns. Trigger exceptions require the
-- same backend, transaction, command, and RUNNING command state.
CREATE TABLE public.company_deletion_execution_authorizations (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  command_id uuid NOT NULL
    REFERENCES public.company_deletion_commands(command_id) ON DELETE CASCADE,
  target_company_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (backend_pid,transaction_id),
  UNIQUE (command_id)
);
ALTER TABLE public.company_deletion_execution_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_execution_authorizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_deletion_execution_authorizations FROM PUBLIC;

-- These cycles are entirely inside a single tenant deletion unit. Deferring
-- them preserves constraint enforcement while allowing both sides to be
-- removed before the transaction commits.
ALTER TABLE public.budget_cycle_change_requests
  ALTER CONSTRAINT budget_cycle_change_requests_result_schedule_id_fkey
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.budget_cycle_schedules
  ALTER CONSTRAINT budget_cycle_schedule_change_fk
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.document_generation_jobs
  ALTER CONSTRAINT document_generation_jobs_supersedes_fk
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.generated_documents
  ALTER CONSTRAINT generated_documents_generation_job_id_fkey
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.procurement_variance_policies
  ALTER CONSTRAINT procurement_variance_policy_change_fk
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.procurement_variance_policy_changes
  ALTER CONSTRAINT procurement_variance_policy_changes_result_policy_id_fkey
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.company_deletion_cleanup_tasks
  DROP CONSTRAINT IF EXISTS company_deletion_cleanup_tasks_status_check;
UPDATE public.company_deletion_cleanup_tasks SET status='TERMINAL_FAILED'
WHERE status='FAILED';
UPDATE public.company_deletion_cleanup_tasks
SET completed_at=COALESCE(completed_at,now())
WHERE status='TERMINAL_FAILED';
ALTER TABLE public.company_deletion_cleanup_tasks
  ADD CONSTRAINT company_deletion_cleanup_tasks_status_check
  CHECK (status IN ('PENDING','LEASED','RETRY_WAIT','COMPLETE','TERMINAL_FAILED'));
ALTER TABLE public.company_deletion_cleanup_tasks
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 8
    CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN lease_id uuid,
  ADD COLUMN leased_by text
    CHECK (leased_by IS NULL OR leased_by ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_started_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome)='object'),
  ADD CONSTRAINT company_deletion_cleanup_tasks_lease_state_check CHECK (
    (status='LEASED' AND lease_id IS NOT NULL AND leased_by IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (status<>'LEASED' AND lease_id IS NULL AND leased_by IS NULL
      AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT company_deletion_cleanup_tasks_completion_check CHECK (
    (status IN ('COMPLETE','TERMINAL_FAILED'))=(completed_at IS NOT NULL)
  );
CREATE INDEX company_deletion_cleanup_tasks_claim_idx
  ON public.company_deletion_cleanup_tasks(status,available_at,created_at,id)
  WHERE status IN ('PENDING','RETRY_WAIT','LEASED');
UPDATE public.company_deletion_commands
SET completed_at=NULL WHERE status='CLEANUP_PENDING';

CREATE OR REPLACE FUNCTION public.axora_company_deletion_trigger_is_authorized()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.company_deletion_execution_authorizations authz
    JOIN public.company_deletion_commands deletion_command
      ON deletion_command.command_id=authz.command_id
    WHERE authz.backend_pid=pg_backend_pid()
      AND authz.transaction_id=txid_current()
      AND deletion_command.requested_mode='HARD_DELETE'
      AND deletion_command.status='RUNNING'
  );
END
$$;
REVOKE ALL ON FUNCTION public.axora_company_deletion_trigger_is_authorized() FROM PUBLIC;

-- Append-only and protected-table triggers remain enabled. They recognize
-- only the narrow, owner-authorized RUNNING deletion command set by the
-- SECURITY DEFINER capability. Normal UPDATE/DELETE behavior is unchanged.
CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only; % is not permitted',TG_TABLE_NAME,TG_OP
    USING ERRCODE='55000';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_p1_procurement_evidence_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Procurement configuration and decision evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_budget_evidence_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Budget evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_organization_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.axora_company_deletion_trigger_is_authorized() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Organization records are deactivated, not deleted';
END $$;

CREATE OR REPLACE FUNCTION public.protect_company_brand_event()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Company brand workflow events are append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_company_manager_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Company manager continuity events are append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_tracking_point_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE purge_cutoff timestamptz;
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Raw delivery coordinates are immutable'; END IF;
  purge_cutoff:=NULLIF(current_setting('axora.tracking_retention_cutoff',true),'')::timestamptz;
  IF purge_cutoff IS NULL OR OLD.retention_until>purge_cutoff THEN
    RAISE EXCEPTION 'Raw delivery coordinates may only be removed by retention';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.axora_email_operations_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Email operations evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.protect_in_app_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF public.axora_company_deletion_trigger_is_authorized() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'In-app notifications cannot be deleted' USING ERRCODE='55000';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['read_at','archived_at','delivered_to_client_at','state_version'])
    IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['read_at','archived_at','delivered_to_client_at','state_version'])
  THEN RAISE EXCEPTION 'Notification identity and content are immutable' USING ERRCODE='55000'; END IF;
  IF (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at)
    OR (OLD.delivered_to_client_at IS NOT NULL
      AND NEW.delivered_to_client_at IS DISTINCT FROM OLD.delivered_to_client_at)
  THEN RAISE EXCEPTION 'Notification lifecycle timestamps are monotonic' USING ERRCODE='55000'; END IF;
  IF NEW.read_at IS DISTINCT FROM OLD.read_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
    OR NEW.delivered_to_client_at IS DISTINCT FROM OLD.delivered_to_client_at
  THEN NEW.state_version:=OLD.state_version+1; ELSE NEW.state_version:=OLD.state_version; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_protect_request_approval_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF public.axora_company_deletion_trigger_is_authorized() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Approval evidence is append-only';
  END IF;
  IF TG_TABLE_NAME='request_approval_policies'
    AND to_jsonb(OLD)-'status'-'retired_at'=to_jsonb(NEW)-'status'-'retired_at'
    AND OLD.status='ACTIVE' AND NEW.status='RETIRED' AND NEW.retired_at IS NOT NULL
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Approval evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_role_assignment_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF public.axora_company_deletion_trigger_is_authorized() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Role assignments are append-only; revoke instead';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_notification_evidence_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Notification evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.reject_permission_change_history_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Permission change history is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_reject_commercial_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Commercial and quantity evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Company lead evidence is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.protect_frozen_legacy_delivery_acceptance()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_status text;
BEGIN
  IF TG_OP='DELETE' AND public.axora_company_deletion_trigger_is_authorized()
  THEN RETURN OLD; END IF;
  SELECT label INTO old_status FROM public.lookup_values
  WHERE id=OLD.status_id AND type_key='delivery_status';
  IF old_status IN ('Partially Delivered','Delivered') THEN
    RAISE EXCEPTION 'Frozen legacy delivery acceptance is immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_deletion_impact_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base jsonb; owned_counts jsonb:='{}'::jsonb;
DECLARE rule record; row_count bigint; file_count bigint;
BEGIN
  base:=public.axora_company_deletion_impact(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
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
    'confirmation',CASE WHEN (base->>'protectedEvidence')::bigint>0
      THEN 'ARCHIVE AND REVOKE '||(base->>'companyCode')
      ELSE 'PERMANENTLY DELETE '||(base->>'companyCode') END,
    'hardDeleteEligible',(
      (base->>'protectedEvidence')::bigint=0 AND (base->>'inFlightWork')::bigint=0
    ),
    'recommendedMode',CASE
      WHEN (base->>'inFlightWork')::bigint>0 THEN 'BLOCK'
      WHEN (base->>'protectedEvidence')::bigint=0 THEN 'HARD_DELETE'
      ELSE 'ARCHIVE_RETAIN' END,
    'ownership',owned_counts,'externalFileCount',file_count,
    'externalCleanupRequired',(file_count>0),
    'retentionPolicy','Protected financial, delivery, receipt and immutable audit evidence is retained with normal access revoked; no broader anonymization is performed without an approved retention policy.'
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_refresh_company_deletion_command(
  p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE command_row public.company_deletion_commands%ROWTYPE;
DECLARE pending_count integer; failed_count integer; total_count integer;
DECLARE cleanup_state text; result_value jsonb;
BEGIN
  SELECT * INTO command_row FROM public.company_deletion_commands
  WHERE command_id=p_command_id FOR UPDATE;
  IF command_row.command_id IS NULL THEN RAISE EXCEPTION 'Deletion command is unavailable'; END IF;
  SELECT count(*)::integer,
    count(*) FILTER (WHERE status IN ('PENDING','LEASED','RETRY_WAIT'))::integer,
    count(*) FILTER (WHERE status='TERMINAL_FAILED')::integer
  INTO total_count,pending_count,failed_count
  FROM public.company_deletion_cleanup_tasks WHERE command_id=p_command_id;
  cleanup_state:=CASE
    WHEN failed_count>0 THEN 'FAILED'
    WHEN pending_count>0 THEN 'PENDING'
    WHEN total_count>0 THEN 'COMPLETE'
    ELSE 'NOT_REQUIRED' END;
  result_value:=COALESCE(command_row.result,'{}'::jsonb)||jsonb_build_object(
    'cleanupStatus',cleanup_state,'pendingCleanupTasks',pending_count,
    'failedCleanupTasks',failed_count
  );
  UPDATE public.company_deletion_commands SET
    status=CASE WHEN failed_count>0 THEN 'FAILED'
      WHEN pending_count>0 THEN 'CLEANUP_PENDING' ELSE 'COMPLETE' END,
    result=result_value,
    completed_at=CASE WHEN pending_count>0 THEN NULL ELSE COALESCE(completed_at,p_at) END
  WHERE command_id=p_command_id;
  UPDATE public.company_deletion_tombstones SET cleanup_status=cleanup_state
  WHERE command_id=p_command_id;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.axora_refresh_company_deletion_command(uuid,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_reconcile_company_deletion_cleanup_tasks(
  p_at timestamptz DEFAULT now()
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE changed integer; affected uuid;
DECLARE affected_commands uuid[]:=ARRAY[]::uuid[];
BEGIN
  WITH expired AS (
    UPDATE public.company_deletion_cleanup_tasks task SET
      status=CASE WHEN task.attempts>=task.max_attempts
        THEN 'TERMINAL_FAILED' ELSE 'RETRY_WAIT' END,
      available_at=CASE WHEN task.attempts>=task.max_attempts THEN task.available_at
        ELSE p_at+make_interval(secs=>LEAST(3600,5*power(2,LEAST(task.attempts,9))::integer)) END,
      last_error=COALESCE(task.last_error,'worker_lease_expired'),
      lease_id=NULL,leased_by=NULL,lease_expires_at=NULL,updated_at=p_at,
      completed_at=CASE WHEN task.attempts>=task.max_attempts THEN p_at ELSE NULL END
    WHERE task.status='LEASED' AND task.lease_expires_at<=p_at
    RETURNING task.command_id
  ) SELECT count(*)::integer,COALESCE(array_agg(DISTINCT command_id),ARRAY[]::uuid[])
    INTO changed,affected_commands FROM expired;
  FOREACH affected IN ARRAY affected_commands
  LOOP PERFORM public.axora_refresh_company_deletion_command(affected,p_at); END LOOP;
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION public.axora_claim_company_deletion_cleanup_task(
  p_worker_id text,p_lease_seconds integer,p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  task_id uuid,command_id uuid,task_kind text,locator text,attempts integer,
  max_attempts integer,lease_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 900
  THEN RAISE EXCEPTION 'Cleanup worker claim is unavailable'; END IF;
  PERFORM public.axora_reconcile_company_deletion_cleanup_tasks(p_at);
  RETURN QUERY
  WITH candidate AS (
    SELECT task.id FROM public.company_deletion_cleanup_tasks task
    WHERE task.status IN ('PENDING','RETRY_WAIT') AND task.available_at<=p_at
    ORDER BY task.available_at,task.created_at,task.id
    FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.company_deletion_cleanup_tasks task SET
    status='LEASED',attempts=task.attempts+1,
    lease_id=gen_random_uuid(),leased_by=p_worker_id,
    lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
    last_started_at=p_at,updated_at=p_at,completed_at=NULL
  FROM candidate WHERE task.id=candidate.id
  RETURNING task.id,task.command_id,task.task_kind,task.locator,
    task.attempts,task.max_attempts,task.lease_id;
END $$;

CREATE OR REPLACE FUNCTION public.axora_complete_company_deletion_cleanup_task(
  p_task_id uuid,p_lease_id uuid,p_worker_id text,p_outcome jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task_row public.company_deletion_cleanup_tasks%ROWTYPE;
BEGIN
  IF p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object'
  THEN RAISE EXCEPTION 'Cleanup completion is unavailable'; END IF;
  SELECT * INTO task_row FROM public.company_deletion_cleanup_tasks
  WHERE id=p_task_id FOR UPDATE;
  IF task_row.id IS NULL OR task_row.status<>'LEASED'
    OR task_row.lease_id IS DISTINCT FROM p_lease_id
    OR task_row.leased_by IS DISTINCT FROM p_worker_id
    OR task_row.lease_expires_at<=p_at
  THEN RAISE EXCEPTION 'Cleanup worker lease is unavailable'; END IF;
  UPDATE public.company_deletion_cleanup_tasks SET status='COMPLETE',
    lease_id=NULL,leased_by=NULL,lease_expires_at=NULL,last_error=NULL,
    outcome=p_outcome,completed_at=p_at,updated_at=p_at
  WHERE id=p_task_id;
  RETURN public.axora_refresh_company_deletion_command(task_row.command_id,p_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_fail_company_deletion_cleanup_task(
  p_task_id uuid,p_lease_id uuid,p_worker_id text,p_error text,
  p_retryable boolean,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task_row public.company_deletion_cleanup_tasks%ROWTYPE; terminal boolean;
BEGIN
  IF char_length(btrim(COALESCE(p_error,''))) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'Cleanup failure report is unavailable'; END IF;
  SELECT * INTO task_row FROM public.company_deletion_cleanup_tasks
  WHERE id=p_task_id FOR UPDATE;
  IF task_row.id IS NULL OR task_row.status<>'LEASED'
    OR task_row.lease_id IS DISTINCT FROM p_lease_id
    OR task_row.leased_by IS DISTINCT FROM p_worker_id
  THEN RAISE EXCEPTION 'Cleanup worker lease is unavailable'; END IF;
  terminal:=NOT p_retryable OR task_row.attempts>=task_row.max_attempts;
  UPDATE public.company_deletion_cleanup_tasks SET
    status=CASE WHEN terminal THEN 'TERMINAL_FAILED' ELSE 'RETRY_WAIT' END,
    available_at=CASE WHEN terminal THEN available_at
      ELSE p_at+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,9))::integer)) END,
    lease_id=NULL,leased_by=NULL,lease_expires_at=NULL,
    last_error=left(regexp_replace(btrim(p_error),'[[:cntrl:]]+',' ','g'),500),
    completed_at=CASE WHEN terminal THEN p_at ELSE NULL END,updated_at=p_at
  WHERE id=p_task_id;
  RETURN public.axora_refresh_company_deletion_command(task_row.command_id,p_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_company_deletion_command_status(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; value jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT COALESCE((snapshot->>'isOwner')::boolean,false)
    OR snapshot->>'accountKind'<>'PLATFORM'
  THEN RAISE EXCEPTION 'Deletion command is unavailable'; END IF;
  SELECT jsonb_build_object(
    'commandId',command.command_id,'companyId',command.requested_company_id,
    'companyCode',command.company_code,'mode',command.requested_mode,
    'status',command.status,'createdAt',command.created_at,
    'completedAt',command.completed_at,'result',command.result,
    'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'taskId',task.id,'kind',task.task_kind,'status',task.status,
      'attempts',task.attempts,'maximumAttempts',task.max_attempts,
      'availableAt',task.available_at,'lastError',task.last_error,
      'completedAt',task.completed_at
    ) ORDER BY task.created_at,task.id)
      FROM public.company_deletion_cleanup_tasks task
      WHERE task.command_id=command.command_id),'[]'::jsonb)
  ) INTO value FROM public.company_deletion_commands command
  WHERE command.command_id=p_command_id;
  IF value IS NULL THEN RAISE EXCEPTION 'Deletion command is unavailable'; END IF;
  RETURN value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_delete_or_archive_company_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_command_id uuid,p_confirmation text,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE company_row public.companies%ROWTYPE; deletion_impact jsonb;
DECLARE prior_command public.company_deletion_commands%ROWTYPE;
DECLARE command_result jsonb; cleanup_count integer:=0; rule record; residue bigint;
BEGIN
  IF current_setting('session_replication_role')<>'origin' THEN
    RAISE EXCEPTION 'Company deletion requires active constraints and triggers';
  END IF;
  IF p_command_id IS NULL OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'A deletion command and reason are required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text,911));
  SELECT * INTO prior_command FROM public.company_deletion_commands
  WHERE command_id=p_command_id;
  IF prior_command.command_id IS NOT NULL THEN
    IF prior_command.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR prior_command.requested_company_id IS DISTINCT FROM p_company_id
    THEN RAISE EXCEPTION 'Deletion command identity does not match'; END IF;
    RETURN prior_command.result;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text,912));
  SELECT * INTO company_row FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF company_row.id IS NULL OR EXISTS (
    SELECT 1 FROM public.company_deletion_tombstones WHERE company_id=p_company_id
  ) THEN RAISE EXCEPTION 'Company deletion is unavailable'; END IF;
  deletion_impact:=public.axora_company_deletion_impact_v2(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
  IF p_confirmation IS DISTINCT FROM deletion_impact->>'confirmation'
  THEN RAISE EXCEPTION 'The irreversible confirmation did not match'; END IF;
  IF (deletion_impact->>'inFlightWork')::bigint>0
  THEN RAISE EXCEPTION 'Company deletion is temporarily unavailable while work is in flight'; END IF;

  INSERT INTO public.company_deletion_commands(
    command_id,requested_company_id,company_code,actor_user_id,requested_mode,
    status,reason,impact,created_at
  ) VALUES (
    p_command_id,p_company_id,company_row.company_code,p_actor_user_id,
    CASE WHEN (deletion_impact->>'protectedEvidence')::bigint>0
      THEN 'ARCHIVE_RETAIN' ELSE 'HARD_DELETE' END,
    'RUNNING',btrim(p_reason),deletion_impact,p_at
  );

  IF (deletion_impact->>'protectedEvidence')::bigint>0 THEN
    command_result:=public.axora_delete_or_archive_company(
      p_actor_user_id,p_actor_role_assignment_id,p_company_id,
      'DELETE '||company_row.company_code,p_reason,p_at
    )||jsonb_build_object('commandId',p_command_id,'cleanupStatus','NOT_REQUIRED');
    UPDATE public.company_deletion_tombstones SET command_id=p_command_id,
      impact=deletion_impact,cleanup_status='NOT_REQUIRED' WHERE company_id=p_company_id;
    UPDATE public.company_deletion_commands SET status='COMPLETE',
      result=command_result,completed_at=p_at WHERE command_id=p_command_id;
    RETURN command_result;
  END IF;

  INSERT INTO public.company_deletion_execution_authorizations(
    backend_pid,transaction_id,command_id,target_company_id
  ) VALUES (pg_backend_pid(),txid_current(),p_command_id,p_company_id);
  SET CONSTRAINTS ALL DEFERRED;

  CREATE TEMP TABLE axora_delete_users(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_requests(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_request_lines(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_invoices(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_tokens(id uuid PRIMARY KEY,kind text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_notifications(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_workflow_emails(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_products(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_suppliers(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_leads(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_role_assignments(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_documents(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_email_operations(id uuid PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO axora_delete_users SELECT id FROM public.users WHERE company_id=p_company_id;
  INSERT INTO axora_delete_requests SELECT id FROM public.requests WHERE company_id=p_company_id;
  INSERT INTO axora_delete_request_lines SELECT line.id FROM public.request_lines line
    JOIN axora_delete_requests request ON request.id=line.request_id;
  INSERT INTO axora_delete_invoices SELECT id FROM public.invoices WHERE company_id=p_company_id;
  INSERT INTO axora_delete_tokens SELECT token.id,'PASSWORD' FROM public.password_reset_tokens token
    JOIN axora_delete_users account ON account.id=token.user_id;
  INSERT INTO axora_delete_tokens SELECT token.id,'VERIFICATION' FROM public.email_verification_tokens token
    JOIN axora_delete_users account ON account.id=token.user_id;
  INSERT INTO axora_delete_notifications SELECT id FROM public.in_app_notifications WHERE company_id=p_company_id;
  INSERT INTO axora_delete_workflow_emails SELECT id FROM public.workflow_email_outbox WHERE company_id=p_company_id;
  INSERT INTO axora_delete_products SELECT id FROM public.products WHERE company_id=p_company_id;
  INSERT INTO axora_delete_suppliers SELECT id FROM public.suppliers WHERE company_id=p_company_id;
  INSERT INTO axora_delete_leads SELECT id FROM public.company_leads WHERE converted_company_id=p_company_id;
  INSERT INTO axora_delete_role_assignments SELECT id FROM public.role_assignments
    WHERE company_id=p_company_id OR user_id IN (SELECT id FROM axora_delete_users);
  INSERT INTO axora_delete_documents SELECT id FROM public.generated_documents WHERE company_id=p_company_id;
  INSERT INTO axora_delete_email_operations SELECT id FROM public.email_operations_events WHERE company_id=p_company_id;

  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
    SELECT p_command_id,'FILE',storage_path FROM public.attachments
    WHERE company_id=p_company_id AND storage_path<>''
  ON CONFLICT DO NOTHING;
  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
    SELECT p_command_id,'FILE',storage_path FROM public.generated_documents
    WHERE company_id=p_company_id AND storage_path<>''
  ON CONFLICT DO NOTHING;
  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
    SELECT p_command_id,'FILE',path_value FROM public.profile_image_versions image
    JOIN axora_delete_users account ON account.id=image.user_id
    CROSS JOIN LATERAL unnest(ARRAY[
      image.storage_path_64,image.storage_path_128,image.storage_path_256
    ]) path_value
  ON CONFLICT DO NOTHING;

  DELETE FROM public.notification_email_relations
  WHERE notification_id IN (SELECT id FROM axora_delete_notifications)
    OR workflow_email_outbox_id IN (SELECT id FROM axora_delete_workflow_emails);
  DELETE FROM public.notification_state_events
  WHERE notification_id IN (SELECT id FROM axora_delete_notifications)
    OR related_notification_id IN (SELECT id FROM axora_delete_notifications)
    OR actor_user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.notification_reminders
  WHERE original_notification_id IN (SELECT id FROM axora_delete_notifications)
    OR materialized_notification_id IN (SELECT id FROM axora_delete_notifications)
    OR recipient_user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.email_agent_control_events
  WHERE operation_event_id IN (SELECT id FROM axora_delete_email_operations);
  DELETE FROM public.email_operator_suppression_events
  WHERE operation_event_id IN (SELECT id FROM axora_delete_email_operations);
  DELETE FROM public.email_provider_health_snapshots
  WHERE operation_event_id IN (SELECT id FROM axora_delete_email_operations);
  DELETE FROM public.email_resend_versions
  WHERE operation_event_id IN (SELECT id FROM axora_delete_email_operations)
    OR original_delivery_id IN (SELECT id FROM axora_delete_workflow_emails)
    OR new_delivery_id IN (SELECT id FROM axora_delete_workflow_emails);
  DELETE FROM public.transactional_email_outbox outbox
  WHERE outbox.invoice_id IN (SELECT id FROM axora_delete_invoices)
    OR outbox.generated_document_id IN (SELECT id FROM axora_delete_documents)
    OR outbox.password_reset_token_id IN (SELECT id FROM axora_delete_tokens WHERE kind='PASSWORD')
    OR outbox.email_verification_token_id IN (SELECT id FROM axora_delete_tokens WHERE kind='VERIFICATION')
    OR outbox.contact_submission_id IN (
      SELECT submission.id FROM public.public_contact_submissions submission
      JOIN axora_delete_leads lead ON lead.id=submission.lead_id
    );
  DELETE FROM public.invoice_allocations
  WHERE invoice_id IN (SELECT id FROM axora_delete_invoices)
    OR request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM axora_delete_invoices);
  DELETE FROM public.approvals WHERE request_id IN (SELECT id FROM axora_delete_requests);
  DELETE FROM public.deliveries WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.quotations
  WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines)
    OR supplier_id IN (SELECT id FROM axora_delete_suppliers);
  DELETE FROM public.request_line_supplier_rule_snapshots
  WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.request_actual_lines
  WHERE request_id IN (SELECT id FROM axora_delete_requests)
    OR request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.request_lines WHERE id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.product_suppliers
  WHERE product_id IN (SELECT id FROM axora_delete_products)
    OR supplier_id IN (SELECT id FROM axora_delete_suppliers);
  DELETE FROM public.product_images
  WHERE product_id IN (SELECT id FROM axora_delete_products)
    OR created_by IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.supplier_memberships
  WHERE supplier_id IN (SELECT id FROM axora_delete_suppliers)
    OR user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.delegated_access_permissions WHERE delegated_access_id IN (
    SELECT access.id FROM public.delegated_access access
    WHERE access.grantee_user_id IN (SELECT id FROM axora_delete_users)
      OR access.grantee_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments)
  );
  DELETE FROM public.delegated_access_scopes WHERE company_id=p_company_id;
  DELETE FROM public.delegated_access
  WHERE grantee_user_id IN (SELECT id FROM axora_delete_users)
    OR grantee_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments);
  DELETE FROM public.company_lead_access_events WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_assignments WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_duplicate_candidates
  WHERE lead_id IN (SELECT id FROM axora_delete_leads)
    OR candidate_lead_id IN (SELECT id FROM axora_delete_leads)
    OR candidate_company_id=p_company_id;
  DELETE FROM public.company_lead_events WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_notes WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_status_history WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_tasks WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.public_contact_submissions WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  UPDATE public.company_leads SET duplicate_of_company_id=NULL
  WHERE duplicate_of_company_id=p_company_id AND id NOT IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_leads WHERE id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.delivery_recovery_commands
  WHERE delivery_job_id IN (SELECT id FROM public.delivery_jobs WHERE company_id=p_company_id)
    OR previous_assignment_id IN (
      SELECT id FROM public.delivery_job_assignments WHERE company_id=p_company_id
    );
  DELETE FROM public.permission_change_history
  WHERE actor_user_id IN (SELECT id FROM axora_delete_users)
    OR target_user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.notification_commands
  WHERE actor_user_id IN (SELECT id FROM axora_delete_users)
    OR actor_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments);
  DELETE FROM public.account_credentials WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.password_reset_tokens WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.email_verification_tokens WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.onboarding_progress WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.notification_preferences WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.profile_image_versions WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.tutorial_step_progress WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_atmosphere_preferences WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_profiles WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_sessions WHERE user_id IN (SELECT id FROM axora_delete_users);

  FOR rule IN SELECT table_name FROM public.company_deletion_ownership_dag ORDER BY delete_order
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id=$1',rule.table_name)
      USING p_company_id;
  END LOOP;
  FOR rule IN SELECT table_name FROM public.company_deletion_ownership_dag ORDER BY delete_order
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id=$1',rule.table_name)
      INTO residue USING p_company_id;
    IF residue<>0 THEN RAISE EXCEPTION 'Company deletion left owned rows in %',rule.table_name; END IF;
  END LOOP;
  DELETE FROM public.companies WHERE id=p_company_id;
  IF EXISTS (SELECT 1 FROM public.companies WHERE id=p_company_id)
  THEN RAISE EXCEPTION 'Company deletion did not remove the tenant root'; END IF;
  IF current_setting('session_replication_role')<>'origin'
  THEN RAISE EXCEPTION 'Company deletion changed constraint enforcement'; END IF;

  SELECT count(*)::integer INTO cleanup_count
  FROM public.company_deletion_cleanup_tasks WHERE command_id=p_command_id;
  INSERT INTO public.company_deletion_tombstones(
    company_id,company_code,deletion_mode,reason,deleted_by,deleted_at,impact,
    command_id,cleanup_status
  ) VALUES (
    p_company_id,company_row.company_code,'HARD_DELETED',btrim(p_reason),
    p_actor_user_id,p_at,deletion_impact,p_command_id,
    CASE WHEN cleanup_count>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END
  );
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,new_values,actor_id,reason,occurred_at,
    command_id,system_identity
  ) VALUES (
    'companies',p_company_id,'HARD_DELETED',jsonb_build_object(
      'commandId',p_command_id,'cleanupTasks',cleanup_count
    ),p_actor_user_id,btrim(p_reason),p_at,p_command_id::text,'company-deletion'
  );
  DELETE FROM public.company_deletion_execution_authorizations
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()
    AND command_id=p_command_id AND target_company_id=p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company deletion execution authorization was not released';
  END IF;
  command_result:=jsonb_build_object(
    'companyId',p_company_id,'mode','HARD_DELETED','commandId',p_command_id,
    'impact',deletion_impact,
    'cleanupStatus',CASE WHEN cleanup_count>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END,
    'pendingCleanupTasks',cleanup_count,'failedCleanupTasks',0
  );
  UPDATE public.company_deletion_commands SET
    status=CASE WHEN cleanup_count>0 THEN 'CLEANUP_PENDING' ELSE 'COMPLETE' END,
    result=command_result,
    completed_at=CASE WHEN cleanup_count>0 THEN NULL ELSE p_at END
  WHERE command_id=p_command_id;
  RETURN command_result;
END $$;

REVOKE ALL ON FUNCTION public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_reconcile_company_deletion_cleanup_tasks(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_claim_company_deletion_cleanup_task(text,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_complete_company_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_fail_company_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_deletion_command_status(uuid,uuid,uuid,timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON public.company_deletion_ownership_dag,
      public.company_deletion_execution_authorizations FROM axora_app;
    REVOKE ALL ON FUNCTION
      public.axora_reconcile_company_deletion_cleanup_tasks(timestamptz),
      public.axora_claim_company_deletion_cleanup_task(text,integer,timestamptz),
      public.axora_complete_company_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz),
      public.axora_fail_company_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz)
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_company_deletion_command_status(uuid,uuid,uuid,timestamptz) TO axora_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_cleanup_worker') THEN
    REVOKE ALL ON public.company_deletion_ownership_dag,
      public.company_deletion_execution_authorizations,
      public.company_deletion_commands,
      public.company_deletion_cleanup_tasks FROM axora_cleanup_worker;
    GRANT USAGE ON SCHEMA public TO axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION public.axora_reconcile_company_deletion_cleanup_tasks(timestamptz) TO axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION public.axora_claim_company_deletion_cleanup_task(text,integer,timestamptz) TO axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION public.axora_complete_company_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz) TO axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION public.axora_fail_company_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz) TO axora_cleanup_worker;
  END IF;
END $$;

COMMIT;
