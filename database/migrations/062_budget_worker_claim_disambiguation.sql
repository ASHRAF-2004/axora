BEGIN;

-- PostgreSQL exposes RETURNS TABLE columns as PL/pgSQL variables. Qualify the
-- data-modifying CTE's RETURNING expression so `job_id` cannot collide with
-- the function output variable when the worker first compiles this function.
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
    FROM leased
    RETURNING public.budget_refresh_job_events.job_id AS evidenced_job_id
  )
  SELECT leased.id,leased.lease_token FROM leased ORDER BY leased.id;
END $$;

REVOKE ALL ON FUNCTION public.axora_claim_budget_refresh_jobs(
  text,integer,integer,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_claim_budget_refresh_jobs(
      text,integer,integer,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
