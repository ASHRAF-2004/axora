BEGIN;

-- A delivery job can remain in the available pool beyond the acceptance
-- deadline captured when it was created. Self-claiming is a new assignment
-- decision, so it must receive a fresh bounded window instead of inheriting a
-- deadline that may already be in the past. Patch the current function rather
-- than replacing it with the historical migration 084 definition so the
-- command advisory lock and conflict checks added later remain intact.
DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  stale_assignment_expression constant text :=
    $$COALESCE(job.acceptance_deadline,p_at+interval '2 hours')$$;
  stale_job_expression constant text :=
    $$COALESCE(acceptance_deadline,p_at+interval '2 hours')$$;
  replacement_expression constant text :=
    $$p_at+interval '2 hours'$$;
  assignment_expression_count integer;
  job_expression_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_claim_available_delivery_job(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) INTO original_definition;
  assignment_expression_count:=(
    char_length(original_definition)
      - char_length(replace(original_definition,stale_assignment_expression,''))
  ) / char_length(stale_assignment_expression);
  job_expression_count:=(
    char_length(original_definition)
      - char_length(replace(original_definition,stale_job_expression,''))
  ) / char_length(stale_job_expression);
  IF original_definition IS NULL
    OR assignment_expression_count<>1 OR job_expression_count<>1
    OR position('delivery-claim-command:' IN original_definition)=0
    OR position('AXORA_DELIVERY_CLAIM_COMMAND_CONFLICT' IN original_definition)=0
  THEN RAISE EXCEPTION 'The current delivery claim contract cannot be patched safely'; END IF;
  patched_definition:=replace(
    original_definition,stale_assignment_expression,replacement_expression
  );
  patched_definition:=replace(
    patched_definition,stale_job_expression,replacement_expression
  );
  IF patched_definition=original_definition
    OR position(stale_assignment_expression IN patched_definition)<>0
    OR position(stale_job_expression IN patched_definition)<>0
  THEN RAISE EXCEPTION 'The delivery self-claim acceptance window was not patched'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Repair only pristine self-claims whose copied deadline was already invalid
-- at assignment time. The table lock prevents concurrent assignment writes
-- while the immutable-row validator is opened for this one bounded repair and
-- restored in the same transaction. Legitimately elapsed assignments whose
-- deadline was after assigned_at are intentionally left untouched.
LOCK TABLE public.delivery_job_assignments IN SHARE ROW EXCLUSIVE MODE;

DO $repair$
DECLARE
  original_validator text;
  repair_validator text;
  restored_validator text;
  immutable_columns constant text :=
    $$ARRAY['status','accepted_at','ended_at','updated_at']$$;
  repair_columns constant text :=
    $$ARRAY['status','accepted_at','ended_at','updated_at','acceptance_deadline']$$;
  immutable_expression_count integer;
  repair_at timestamptz:=now();
BEGIN
  SELECT pg_get_functiondef(
    'public.validate_delivery_assignment()'::regprocedure
  ) INTO original_validator;
  immutable_expression_count:=(
    char_length(original_validator)
      - char_length(replace(original_validator,immutable_columns,''))
  ) / char_length(immutable_columns);
  IF original_validator IS NULL OR immutable_expression_count<>2
  THEN RAISE EXCEPTION 'The delivery assignment validator cannot be opened safely'; END IF;
  repair_validator:=replace(
    original_validator,immutable_columns,repair_columns
  );
  IF repair_validator=original_validator
  THEN RAISE EXCEPTION 'The delivery assignment repair validator was not prepared'; END IF;
  EXECUTE repair_validator;

  WITH repaired_assignment AS (
    UPDATE public.delivery_job_assignments assignment
    SET acceptance_deadline=repair_at+interval '2 hours',updated_at=repair_at
    FROM public.delivery_jobs job
    WHERE assignment.delivery_job_id=job.id
      AND assignment.company_id=job.company_id
      AND assignment.status='ASSIGNED'
      AND assignment.accepted_at IS NULL
      AND assignment.ended_at IS NULL
      AND assignment.assigned_by=assignment.driver_user_id
      AND assignment.supervisor_role_assignment_id IS NULL
      AND assignment.command_id IS NOT NULL
      AND assignment.assignment_reason='Claimed by Delivery Guy'
      AND assignment.acceptance_deadline IS NOT NULL
      AND assignment.acceptance_deadline<=assignment.assigned_at
      AND job.status='ASSIGNED'
      AND job.acceptance_deadline IS NOT DISTINCT FROM assignment.acceptance_deadline
      AND assignment.expected_job_version=job.workflow_version-1
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_job_events event
        WHERE event.delivery_job_id=job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_workflow_commands command
        WHERE command.delivery_job_id=job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_tracking_sessions session
        WHERE session.delivery_job_id=job.id AND session.status<>'NOT_STARTED'
      )
    RETURNING assignment.delivery_job_id,assignment.acceptance_deadline
  )
  UPDATE public.delivery_jobs job
  SET acceptance_deadline=repaired.acceptance_deadline,updated_at=repair_at
  FROM repaired_assignment repaired
  WHERE job.id=repaired.delivery_job_id;

  EXECUTE original_validator;
  SELECT pg_get_functiondef(
    'public.validate_delivery_assignment()'::regprocedure
  ) INTO restored_validator;
  IF restored_validator IS DISTINCT FROM original_validator
  THEN RAISE EXCEPTION 'The delivery assignment validator was not restored'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.delivery_job_assignments assignment
    JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
    WHERE assignment.status='ASSIGNED'
      AND assignment.ended_at IS NULL
      AND assignment.assigned_by=assignment.driver_user_id
      AND assignment.supervisor_role_assignment_id IS NULL
      AND assignment.command_id IS NOT NULL
      AND assignment.assignment_reason='Claimed by Delivery Guy'
      AND assignment.acceptance_deadline IS NOT NULL
      AND assignment.acceptance_deadline<=assignment.assigned_at
      AND job.status='ASSIGNED'
      AND job.acceptance_deadline IS NOT DISTINCT FROM assignment.acceptance_deadline
      AND assignment.expected_job_version=job.workflow_version-1
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_job_events event
        WHERE event.delivery_job_id=job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_workflow_commands command
        WHERE command.delivery_job_id=job.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_tracking_sessions session
        WHERE session.delivery_job_id=job.id AND session.status<>'NOT_STARTED'
      )
  ) THEN RAISE EXCEPTION 'An invalid pristine self-claim deadline remains'; END IF;
END $repair$;

REVOKE ALL ON FUNCTION public.axora_claim_available_delivery_job(
  uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_claim_available_delivery_job(
      uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
