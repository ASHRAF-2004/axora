BEGIN;

-- A refresh job represents work that becomes eligible at due_at.  Claiming it
-- beforehand exhausts its retry budget while the current period is correctly
-- still open, leaving a dated-out ACTIVE period with no successor.
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
      period.schedule_id,period.ends_at,greatest(period.ends_at,p_at)
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
    WHERE job.due_at<=p_at
      AND (
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
    FROM leased
    RETURNING public.budget_refresh_job_events.job_id AS evidenced_job_id
  )
  SELECT leased.id,leased.lease_token FROM leased ORDER BY leased.id;
END $$;

ALTER TABLE public.budget_refresh_job_events
  DROP CONSTRAINT budget_refresh_job_events_event_type_check,
  ADD CONSTRAINT budget_refresh_job_events_event_type_check CHECK (
    event_type IN (
      'ENQUEUED','LEASED','SUCCEEDED','RETRY_SCHEDULED','DEAD_LETTERED',
      'MANUAL_RERUN','RECONCILED','REQUEUED_PREMATURE_CLAIM'
    )
  );

-- A dead-lettered job is eligible for this repair only when every attempted
-- lease was before its due time.  The repair never touches a period, ledger,
-- Wallet, request, invoice, or payment; it merely lets the existing,
-- idempotent and Wallet-guarded refresh worker run when the job is due.
WITH requeued AS (
  UPDATE public.budget_refresh_jobs job
  SET state='RETRY',attempt_count=0,next_attempt_at=greatest(job.due_at,now()),
    last_error_code=NULL,updated_at=now()
  WHERE job.state='DEAD_LETTER' AND job.due_at<=now()
    AND EXISTS (
      SELECT 1 FROM public.budget_refresh_job_events event
      WHERE event.job_id=job.id AND event.event_type='DEAD_LETTERED'
        AND event.occurred_at<job.due_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.budget_refresh_job_events event
      WHERE event.job_id=job.id AND event.event_type='LEASED'
        AND event.occurred_at>=job.due_at
    )
  RETURNING job.id,job.company_id,job.due_at
)
INSERT INTO public.budget_refresh_job_events(
  job_id,company_id,event_type,attempt_count,occurred_at,metadata
)
SELECT id,company_id,'REQUEUED_PREMATURE_CLAIM',0,now(),
  jsonb_build_object('dueAt',due_at,'reason','PREMATURE_CLAIM_REPAIR')
FROM requeued;

COMMIT;
