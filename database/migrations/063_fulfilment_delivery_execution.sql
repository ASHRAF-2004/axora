-- P1-08, P1-09 and P1-10: canonical fulfilment execution, destination-time
-- scheduling and policy-bound proof of delivery.
--
-- This migration is additive. Historical events and evidence remain immutable;
-- legacy job state values are mapped to their canonical equivalents in place.

ALTER TABLE public.delivery_jobs
  DROP CONSTRAINT delivery_jobs_status_check;

UPDATE public.delivery_jobs
SET status = CASE status
  WHEN 'CREATED' THEN 'AWAITING_ASSIGNMENT'
  WHEN 'EN_ROUTE' THEN 'OUT_FOR_DELIVERY'
  ELSE status
END;

ALTER TABLE public.delivery_jobs
  ALTER COLUMN status SET DEFAULT 'AWAITING_ASSIGNMENT',
  ADD COLUMN workflow_version integer NOT NULL DEFAULT 1,
  ADD COLUMN destination_timezone text,
  ADD COLUMN scheduled_local_start timestamp without time zone,
  ADD COLUMN scheduled_local_end timestamp without time zone,
  ADD COLUMN scheduled_local_date date,
  ADD COLUMN acceptance_deadline timestamptz,
  ADD COLUMN sla_due_at timestamptz,
  ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN proof_policy text[] NOT NULL DEFAULT ARRAY['PHOTO']::text[],
  ADD COLUMN tracking_stopped_at timestamptz,
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT delivery_jobs_workflow_version_check
    CHECK (workflow_version > 0),
  ADD CONSTRAINT delivery_jobs_status_check CHECK (status IN (
    'AWAITING_ASSIGNMENT','ASSIGNED','ACCEPTED','SHOPPING',
    'AWAITING_SUBSTITUTE_APPROVAL','AWAITING_ADDITIONAL_APPROVAL',
    'ITEMS_ACQUIRED','OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED',
    'DELIVERED','COMPLETED','RESCHEDULED','FAILED','CANCELLED','RETURNED'
  )),
  ADD CONSTRAINT delivery_jobs_destination_timezone_check CHECK (
    destination_timezone IS NULL
    OR destination_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  ADD CONSTRAINT delivery_jobs_proof_policy_check CHECK (
    cardinality(proof_policy) BETWEEN 1 AND 3
    AND proof_policy <@ ARRAY['PHOTO','SIGNATURE','OTP']::text[]
  ),
  ADD CONSTRAINT delivery_jobs_terminal_tracking_check CHECK (
    (status IN ('COMPLETED','CANCELLED') AND tracking_stopped_at IS NOT NULL)
    OR (status NOT IN ('COMPLETED','CANCELLED'))
  ),
  ADD CONSTRAINT delivery_jobs_cancellation_reason_check CHECK (
    cancellation_reason IS NULL
    OR char_length(btrim(cancellation_reason)) BETWEEN 3 AND 1000
  );

ALTER TABLE public.delivery_jobs DISABLE TRIGGER validate_delivery_job_write;

UPDATE public.delivery_jobs job
SET destination_timezone = COALESCE(branch.timezone, company.timezone, 'UTC'),
    scheduled_local_start = job.scheduled_window_start AT TIME ZONE
      COALESCE(branch.timezone, company.timezone, 'UTC'),
    scheduled_local_end = job.scheduled_window_end AT TIME ZONE
      COALESCE(branch.timezone, company.timezone, 'UTC'),
    scheduled_local_date = (job.scheduled_window_start AT TIME ZONE
      COALESCE(branch.timezone, company.timezone, 'UTC'))::date,
    acceptance_deadline = COALESCE(
      job.scheduled_window_start - interval '2 hours',
      job.created_at + interval '2 hours'
    ),
    sla_due_at = job.scheduled_window_end,
    tracking_stopped_at = CASE
      WHEN job.status IN ('COMPLETED','CANCELLED')
        THEN COALESCE(job.updated_at, now())
      ELSE job.tracking_stopped_at
    END
FROM public.branches branch
JOIN public.companies company ON company.id = branch.company_id
WHERE branch.id = job.branch_id
  AND branch.company_id = job.company_id;

ALTER TABLE public.delivery_jobs ENABLE TRIGGER validate_delivery_job_write;

ALTER TABLE public.delivery_jobs
  ALTER COLUMN destination_timezone SET NOT NULL;

ALTER TABLE public.delivery_job_assignments
  ADD COLUMN driver_role_assignment_id uuid,
  ADD COLUMN supervisor_role_assignment_id uuid,
  ADD COLUMN expected_job_version integer NOT NULL DEFAULT 1,
  ADD COLUMN assignment_reason text NOT NULL DEFAULT 'Legacy assignment preserved',
  ADD COLUMN acceptance_deadline timestamptz,
  ADD COLUMN vehicle_snapshot text,
  ADD COLUMN shift_snapshot text,
  ADD COLUMN zone_snapshot text,
  ADD COLUMN command_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT delivery_assignment_driver_role_fk
    FOREIGN KEY (driver_role_assignment_id)
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT delivery_assignment_supervisor_role_fk
    FOREIGN KEY (supervisor_role_assignment_id)
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT delivery_assignment_expected_version_check
    CHECK (expected_job_version > 0),
  ADD CONSTRAINT delivery_assignment_reason_check
    CHECK (char_length(btrim(assignment_reason)) BETWEEN 3 AND 1000),
  ADD CONSTRAINT delivery_assignment_vehicle_check CHECK (
    vehicle_snapshot IS NULL
    OR char_length(btrim(vehicle_snapshot)) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT delivery_assignment_shift_check CHECK (
    shift_snapshot IS NULL
    OR char_length(btrim(shift_snapshot)) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT delivery_assignment_zone_check CHECK (
    zone_snapshot IS NULL
    OR char_length(btrim(zone_snapshot)) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT delivery_assignment_command_unique
    UNIQUE (company_id, command_id);

UPDATE public.delivery_job_assignments assignment
SET driver_role_assignment_id = (
  SELECT role_assignment.id
  FROM public.role_assignments role_assignment
  JOIN public.roles role ON role.id = role_assignment.role_id
  WHERE role_assignment.user_id = assignment.driver_user_id
    AND role_assignment.active
    AND role_assignment.revoked_at IS NULL
    AND role_assignment.scope_type = 'DELIVERY'
    AND role.role_key IN ('DELIVERY_AGENT','DELIVERY_DRIVER')
  ORDER BY role_assignment.assigned_at DESC, role_assignment.id
  LIMIT 1
)
WHERE assignment.driver_role_assignment_id IS NULL;

UPDATE public.delivery_job_assignments assignment
SET supervisor_role_assignment_id = (
  SELECT role_assignment.id
  FROM public.role_assignments role_assignment
  JOIN public.roles role ON role.id = role_assignment.role_id
  WHERE role_assignment.user_id = assignment.assigned_by
    AND role_assignment.active
    AND role_assignment.revoked_at IS NULL
    AND role_assignment.scope_type = 'PLATFORM'
    AND role.role_key IN (
      'PLATFORM_OWNER','PLATFORM_OPERATIONS','DELIVERY_TEAM_SUPERVISOR'
    )
  ORDER BY role_assignment.assigned_at DESC, role_assignment.id
  LIMIT 1
)
WHERE assignment.supervisor_role_assignment_id IS NULL;

ALTER TABLE public.delivery_job_events
  DROP CONSTRAINT delivery_job_events_event_type_check,
  ADD COLUMN job_version_before integer,
  ADD COLUMN job_version_after integer,
  ADD COLUMN destination_timezone_snapshot text,
  ADD COLUMN client_local_recorded_at timestamp without time zone,
  ADD COLUMN command_id uuid,
  ADD CONSTRAINT delivery_job_events_event_type_check CHECK (event_type IN (
    'ACCEPTED','REJECTED','SHOPPING_STARTED','ITEMS_ACQUIRED',
    'OUT_FOR_DELIVERY','EN_ROUTE','ARRIVED','DELIVERY_ATTEMPTED',
    'PARTIALLY_DELIVERED','DELIVERED','COMPLETED','FAILED','RESCHEDULED',
    'CANCELLED','ISSUE_REPORTED','NOTE_ADDED'
  )),
  ADD CONSTRAINT delivery_job_events_versions_check CHECK (
    (job_version_before IS NULL AND job_version_after IS NULL)
    OR (
      job_version_before > 0
      AND job_version_after = job_version_before + 1
    )
  ),
  ADD CONSTRAINT delivery_job_events_command_unique
    UNIQUE (driver_user_id, command_id);

UPDATE public.delivery_job_events event
SET destination_timezone_snapshot = job.destination_timezone,
    client_local_recorded_at = event.client_recorded_at
      AT TIME ZONE job.destination_timezone
FROM public.delivery_jobs job
WHERE job.id = event.delivery_job_id;

ALTER TABLE public.delivery_evidence
  ADD COLUMN evidence_version integer NOT NULL DEFAULT 1,
  ADD COLUMN supersedes_evidence_id uuid,
  ADD COLUMN recipient_identity text,
  ADD COLUMN consent_copy_version text,
  ADD COLUMN consented_at timestamptz,
  ADD COLUMN image_width integer,
  ADD COLUMN image_height integer,
  ADD COLUMN validation_status text NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN malware_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN retention_until timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  ADD COLUMN legal_hold boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT delivery_evidence_supersedes_fk
    FOREIGN KEY (supersedes_evidence_id)
    REFERENCES public.delivery_evidence(id) ON DELETE RESTRICT,
  ADD CONSTRAINT delivery_evidence_version_check CHECK (evidence_version > 0),
  ADD CONSTRAINT delivery_evidence_validation_status_check CHECK (
    validation_status IN ('ACCEPTED','REJECTED','QUARANTINED')
  ),
  ADD CONSTRAINT delivery_evidence_malware_status_check CHECK (
    malware_status IN ('NOT_CONFIGURED','CLEAN','QUARANTINED')
  ),
  ADD CONSTRAINT delivery_evidence_dimensions_check CHECK (
    (image_width IS NULL AND image_height IS NULL)
    OR (
      image_width BETWEEN 1 AND 12000
      AND image_height BETWEEN 1 AND 12000
    )
  ),
  ADD CONSTRAINT delivery_evidence_signature_consent_check CHECK (
    evidence_type <> 'SIGNATURE'
    OR (
      recipient_identity IS NOT NULL
      AND char_length(btrim(recipient_identity)) BETWEEN 2 AND 200
      AND consent_copy_version IS NOT NULL
      AND char_length(btrim(consent_copy_version)) BETWEEN 1 AND 80
      AND consented_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX delivery_evidence_superseded_once_idx
  ON public.delivery_evidence(supersedes_evidence_id)
  WHERE supersedes_evidence_id IS NOT NULL;

CREATE TABLE public.branch_delivery_service_levels (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  timezone text NOT NULL,
  operating_weekdays integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  operating_start time NOT NULL DEFAULT time '08:00',
  operating_end time NOT NULL DEFAULT time '18:00',
  acceptance_minutes integer NOT NULL DEFAULT 120,
  delivery_minutes integer NOT NULL DEFAULT 480,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'),
  CHECK (operating_weekdays <@ ARRAY[0,1,2,3,4,5,6]::integer[]),
  CHECK (cardinality(operating_weekdays) BETWEEN 1 AND 7),
  CHECK (operating_end > operating_start),
  CHECK (acceptance_minutes BETWEEN 5 AND 10080),
  CHECK (delivery_minutes BETWEEN 15 AND 43200),
  UNIQUE (branch_id, company_id)
);

INSERT INTO public.branch_delivery_service_levels(branch_id,company_id,timezone)
SELECT branch.id,branch.company_id,branch.timezone
FROM public.branches branch
ON CONFLICT (branch_id) DO NOTHING;

CREATE TABLE public.delivery_workflow_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  command_type text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (actor_user_id, command_id),
  CHECK (
    (status='COMPLETED' AND completed_at IS NOT NULL)
    OR (status='IN_PROGRESS' AND completed_at IS NULL)
  )
);

CREATE TABLE public.delivery_proof_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  exception_version integer NOT NULL CHECK (exception_version > 0),
  decision text NOT NULL CHECK (decision IN ('GRANTED','REVOKED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_job_id, exception_version),
  UNIQUE (approved_by, command_id)
);

CREATE TABLE public.delivery_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  recipient_identity_snapshot text NOT NULL,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','VERIFIED','EXPIRED','LOCKED','SUPERSEDED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  maximum_attempts integer NOT NULL DEFAULT 5 CHECK (maximum_attempts BETWEEN 1 AND 5),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verified_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((status='VERIFIED') = (verified_at IS NOT NULL)),
  FOREIGN KEY (branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX delivery_otp_one_active_idx
  ON public.delivery_otp_challenges(delivery_job_id)
  WHERE status='ACTIVE';

CREATE TABLE public.delivery_otp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  challenge_id uuid NOT NULL REFERENCES public.delivery_otp_challenges(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'ISSUED','FAILED','LOCKED','EXPIRED','VERIFIED','SUPERSEDED'
  )),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata))
);

ALTER TABLE public.branch_delivery_service_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_delivery_service_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_workflow_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_workflow_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_proof_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_proof_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.branch_delivery_service_levels FROM PUBLIC;
REVOKE ALL ON public.delivery_workflow_commands FROM PUBLIC;
REVOKE ALL ON public.delivery_proof_exceptions FROM PUBLIC;
REVOKE ALL ON public.delivery_otp_challenges FROM PUBLIC;
REVOKE ALL ON public.delivery_otp_events FROM PUBLIC;

CREATE TRIGGER delivery_proof_exceptions_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_proof_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_otp_events_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_otp_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_jobs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_proof_exceptions_audit
  AFTER INSERT OR DELETE ON public.delivery_proof_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_otp_events_audit
  AFTER INSERT OR DELETE ON public.delivery_otp_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE OR REPLACE FUNCTION public.axora_context_role_assignment_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('axora.role_assignment_id',true),'')::uuid
$$;

CREATE OR REPLACE FUNCTION public.axora_context_can_access_delivery_job(
  p_delivery_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_job_assignments assignment
    WHERE assignment.delivery_job_id=p_delivery_job_id
      AND assignment.driver_user_id=public.axora_context_user_id()
      AND assignment.status IN ('ASSIGNED','ACCEPTED')
      AND assignment.ended_at IS NULL
      AND (
        assignment.driver_role_assignment_id IS NULL
        OR assignment.driver_role_assignment_id=public.axora_context_role_assignment_id()
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.delivery_jobs job
    WHERE job.id=p_delivery_job_id
      AND public.axora_user_can_receive(
        public.axora_context_user_id(),job.company_id,job.branch_id
      )
  ) OR public.axora_snapshot_has_permission(
    public.axora_live_authorization_snapshot(
      public.axora_context_user_id(),
      public.axora_context_role_assignment_id(),
      now()
    ),
    'delivery.view','PLATFORM',NULL,NULL,NULL,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_context_is_job_driver(
  p_delivery_job_id uuid,
  p_driver_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT p_driver_user_id=public.axora_context_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.delivery_job_assignments assignment
      WHERE assignment.delivery_job_id=p_delivery_job_id
        AND assignment.driver_user_id=p_driver_user_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
        AND (
          assignment.driver_role_assignment_id IS NULL
          OR assignment.driver_role_assignment_id=public.axora_context_role_assignment_id()
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.validate_delivery_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE destination_zone text;
BEGIN
  IF TG_OP='INSERT' AND NOT public.axora_user_is_platform(NEW.created_by) THEN
    RAISE EXCEPTION 'Only a platform operator may create a delivery job';
  END IF;
  SELECT COALESCE(branch.timezone,company.timezone,'UTC')
    INTO destination_zone
  FROM public.branches branch
  JOIN public.companies company ON company.id=branch.company_id
  WHERE branch.id=NEW.branch_id AND branch.company_id=NEW.company_id;
  IF destination_zone IS NULL THEN
    RAISE EXCEPTION 'The delivery destination is unavailable';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.status:=CASE WHEN NEW.status='CREATED' THEN 'AWAITING_ASSIGNMENT'
      WHEN NEW.status='EN_ROUTE' THEN 'OUT_FOR_DELIVERY' ELSE NEW.status END;
    NEW.destination_timezone:=destination_zone;
    NEW.scheduled_local_start:=NEW.scheduled_window_start AT TIME ZONE destination_zone;
    NEW.scheduled_local_end:=NEW.scheduled_window_end AT TIME ZONE destination_zone;
    NEW.scheduled_local_date:=(NEW.scheduled_window_start AT TIME ZONE destination_zone)::date;
    NEW.acceptance_deadline:=COALESCE(
      NEW.acceptance_deadline,
      NEW.scheduled_window_start-interval '2 hours',
      now()+interval '2 hours'
    );
    NEW.sla_due_at:=COALESCE(NEW.sla_due_at,NEW.scheduled_window_end);
  ELSE
    IF (to_jsonb(NEW)-ARRAY[
      'status','scheduled_window_start','scheduled_window_end','instructions',
      'updated_at','workflow_version','scheduled_local_start',
      'scheduled_local_end','scheduled_local_date','acceptance_deadline',
      'sla_due_at','status_changed_at','proof_policy','tracking_stopped_at',
      'cancellation_reason'
    ]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY[
      'status','scheduled_window_start','scheduled_window_end','instructions',
      'updated_at','workflow_version','scheduled_local_start',
      'scheduled_local_end','scheduled_local_date','acceptance_deadline',
      'sla_due_at','status_changed_at','proof_policy','tracking_stopped_at',
      'cancellation_reason'
    ]) THEN
      RAISE EXCEPTION 'Delivery job identity and tenant scope are immutable';
    END IF;
    IF OLD.status IN ('COMPLETED','CANCELLED') AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'A terminal delivery job cannot be reopened';
    END IF;
    IF NEW.destination_timezone<>destination_zone THEN
      RAISE EXCEPTION 'The delivery destination timezone is immutable';
    END IF;
    NEW.scheduled_local_start:=NEW.scheduled_window_start AT TIME ZONE destination_zone;
    NEW.scheduled_local_end:=NEW.scheduled_window_end AT TIME ZONE destination_zone;
    NEW.scheduled_local_date:=(NEW.scheduled_window_start AT TIME ZONE destination_zone)::date;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE driver_is_active boolean; job_status text;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT profile.active AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind='DELIVERY'
      INTO driver_is_active
    FROM public.delivery_agent_profiles profile
    JOIN public.users account ON account.id=profile.user_id
    WHERE profile.user_id=NEW.driver_user_id;
    IF driver_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Only an active delivery driver can be assigned';
    END IF;
    IF NOT public.axora_user_is_platform(NEW.assigned_by) THEN
      RAISE EXCEPTION 'Only a platform operator may assign a delivery job';
    END IF;
    IF NEW.driver_role_assignment_id IS NULL THEN
      SELECT role_assignment.id INTO NEW.driver_role_assignment_id
      FROM public.role_assignments role_assignment
      WHERE role_assignment.user_id=NEW.driver_user_id
        AND role_assignment.active AND role_assignment.revoked_at IS NULL
        AND role_assignment.scope_type='DELIVERY'
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            role_assignment.user_id,role_assignment.id,now()
          ),'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
        )
      ORDER BY role_assignment.assigned_at DESC,role_assignment.id LIMIT 1;
    END IF;
    IF NEW.supervisor_role_assignment_id IS NULL THEN
      NEW.supervisor_role_assignment_id:=public.axora_context_role_assignment_id();
    END IF;
    SELECT status INTO job_status FROM public.delivery_jobs
    WHERE id=NEW.delivery_job_id AND company_id=NEW.company_id;
    IF job_status IS NULL OR job_status IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'A terminal or missing delivery job cannot be assigned';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','accepted_at','ended_at','updated_at'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','accepted_at','ended_at','updated_at']) THEN
      RAISE EXCEPTION 'Delivery assignment identity is immutable';
    END IF;
    IF OLD.status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED')
      AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'A terminal assignment cannot be reopened';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_begin_delivery_command(
  p_company_id uuid,
  p_delivery_job_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_payload_hash text,
  p_at timestamptz
)
RETURNS TABLE(command_row_id uuid,replay_result jsonb,is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE inserted_id uuid; existing public.delivery_workflow_commands%ROWTYPE;
BEGIN
  INSERT INTO public.delivery_workflow_commands(
    company_id,delivery_job_id,actor_user_id,actor_role_assignment_id,
    command_id,command_type,payload_hash,created_at
  ) VALUES (
    p_company_id,p_delivery_job_id,p_actor_user_id,p_actor_role_assignment_id,
    p_command_id,p_command_type,p_payload_hash,p_at
  ) ON CONFLICT (actor_user_id,command_id) DO NOTHING
  RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN
    RETURN QUERY SELECT inserted_id,NULL::jsonb,true;
    RETURN;
  END IF;
  SELECT * INTO existing FROM public.delivery_workflow_commands
  WHERE actor_user_id=p_actor_user_id AND command_id=p_command_id;
  IF existing.payload_hash<>p_payload_hash
    OR existing.command_type<>p_command_type
    OR existing.actor_role_assignment_id<>p_actor_role_assignment_id
    OR existing.status<>'COMPLETED' THEN
    RAISE EXCEPTION 'The delivery command is unavailable';
  END IF;
  RETURN QUERY SELECT existing.id,existing.result,false;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_complete_delivery_command(
  p_command_row_id uuid,p_result jsonb,p_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  UPDATE public.delivery_workflow_commands
  SET status='COMPLETED',result=p_result,completed_at=p_at
  WHERE id=p_command_row_id AND status='IN_PROGRESS'
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_creation_context(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; context_row record;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  SELECT request.id,request.company_id,request.branch_id,request.order_code,
    branch.timezone,branch.name AS branch_name
    INTO context_row
  FROM public.requests request
  JOIN public.branches branch ON branch.id=request.branch_id
    AND branch.company_id=request.company_id
  WHERE request.id=p_request_id
    AND request.approval_state IN ('APPROVED','AWAITING_FULFILMENT');
  IF context_row.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'requestId',context_row.id,'companyId',context_row.company_id,
    'branchId',context_row.branch_id,'requestNumber',context_row.order_code,
    'branchName',context_row.branch_name,'destinationTimezone',context_row.timezone
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_create_delivery_job(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_request_id uuid,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_local_start timestamp without time zone,
  p_local_end timestamp without time zone,
  p_destination_timezone text,
  p_instructions text,
  p_idempotency_key text,
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; request_row public.requests%ROWTYPE; branch_row public.branches%ROWTYPE;
  existing public.delivery_jobs%ROWTYPE; command_row record; job_id uuid:=gen_random_uuid();
  job_code text; result jsonb; service_level public.branch_delivery_service_levels%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request_row FROM public.requests WHERE id=p_request_id FOR UPDATE;
  IF snapshot IS NULL OR request_row.id IS NULL
    OR request_row.approval_state NOT IN ('APPROVED','AWAITING_FULFILMENT')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
    ) THEN RAISE EXCEPTION 'The delivery job is unavailable'; END IF;
  SELECT * INTO existing FROM public.delivery_jobs
  WHERE company_id=request_row.company_id AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'jobId',existing.id,'status',existing.status,
      'workflowVersion',existing.workflow_version
    );
  END IF;
  SELECT * INTO branch_row FROM public.branches
  WHERE id=request_row.branch_id AND company_id=request_row.company_id FOR SHARE;
  SELECT * INTO service_level FROM public.branch_delivery_service_levels
  WHERE branch_id=branch_row.id;
  IF branch_row.id IS NULL OR NOT branch_row.active
    OR p_destination_timezone<>branch_row.timezone
    OR p_scheduled_window_start IS NULL OR p_scheduled_window_end IS NULL
    OR p_scheduled_window_end<=p_scheduled_window_start
    OR p_scheduled_window_start AT TIME ZONE branch_row.timezone<>p_local_start
    OR p_scheduled_window_end AT TIME ZONE branch_row.timezone<>p_local_end
    OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The delivery schedule is unavailable';
  END IF;
  SELECT * INTO command_row FROM public.axora_begin_delivery_command(
    request_row.company_id,NULL,p_actor_user_id,p_actor_role_assignment_id,
    p_command_id,'CREATE_JOB',encode(digest(
      concat_ws('|',p_request_id,p_scheduled_window_start,p_scheduled_window_end,
        p_destination_timezone,COALESCE(p_instructions,''),p_idempotency_key),'sha256'
    ),'hex'),p_at
  );
  IF NOT command_row.is_new THEN RETURN command_row.replay_result; END IF;
  job_code:='DEL-'||to_char(p_at AT TIME ZONE 'UTC','YYYYMMDD')||'-'||
    upper(substr(replace(job_id::text,'-',''),1,8));
  INSERT INTO public.delivery_jobs(
    id,company_id,branch_id,request_id,job_code,status,
    scheduled_window_start,scheduled_window_end,delivery_address_snapshot,
    contact_name_snapshot,contact_phone_snapshot,instructions,idempotency_key,
    created_by,workflow_version,destination_timezone,scheduled_local_start,
    scheduled_local_end,scheduled_local_date,acceptance_deadline,sla_due_at,
    status_changed_at,proof_policy,created_at,updated_at
  ) VALUES (
    job_id,request_row.company_id,request_row.branch_id,request_row.id,job_code,
    'AWAITING_ASSIGNMENT',p_scheduled_window_start,p_scheduled_window_end,
    branch_row.delivery_address,branch_row.contact_name,branch_row.contact_phone,
    NULLIF(btrim(COALESCE(p_instructions,'')),''),p_idempotency_key,
    p_actor_user_id,1,branch_row.timezone,p_local_start,p_local_end,p_local_start::date,
    least(p_scheduled_window_start,
      p_at+make_interval(mins=>COALESCE(service_level.acceptance_minutes,120))),
    p_scheduled_window_end,p_at,ARRAY['PHOTO']::text[],p_at,p_at
  );
  INSERT INTO public.delivery_job_lines(
    company_id,delivery_job_id,request_line_id,quantity_to_deliver,
    unit_of_measure_snapshot,created_at
  ) SELECT request_row.company_id,job_id,line.id,line.quantity,
      line.unit_of_measure,p_at
    FROM public.request_lines line WHERE line.request_id=request_row.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The delivery lines are unavailable'; END IF;
  result:=jsonb_build_object(
    'jobId',job_id,'jobCode',job_code,'status','AWAITING_ASSIGNMENT',
    'workflowVersion',1,'destinationTimezone',branch_row.timezone
  );
  UPDATE public.delivery_workflow_commands SET delivery_job_id=job_id
  WHERE id=command_row.command_row_id;
  PERFORM public.axora_complete_delivery_command(command_row.command_row_id,result,p_at);
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_jobs',job_id,'CREATE',p_actor_user_id,request_row.company_id,
    request_row.id,'Delivery job created',jsonb_build_object(
      'status','AWAITING_ASSIGNMENT','destinationTimezone',branch_row.timezone,
      'scheduledLocalDate',p_local_start::date
    )
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_assign_delivery_job(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_driver_user_id uuid,
  p_driver_role_assignment_id uuid,
  p_expected_workflow_version integer,
  p_reason text,
  p_acceptance_deadline timestamptz,
  p_vehicle text,
  p_shift text,
  p_zone text,
  p_proof_policy text[],
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; target_snapshot jsonb; job public.delivery_jobs%ROWTYPE;
  active_assignment public.delivery_job_assignments%ROWTYPE; assignment_id uuid:=gen_random_uuid();
  command_row record; result jsonb; current_request_version integer; payload_hash text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  target_snapshot:=public.axora_live_authorization_snapshot(
    p_driver_user_id,p_driver_role_assignment_id,p_at
  );
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  IF snapshot IS NULL OR target_snapshot IS NULL OR job.id IS NULL
    OR job.workflow_version<>p_expected_workflow_version
    OR job.status IN ('DELIVERED','COMPLETED','CANCELLED')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      target_snapshot,'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_acceptance_deadline<=p_at OR p_acceptance_deadline>job.scheduled_window_end
    OR cardinality(p_proof_policy) NOT BETWEEN 1 AND 3
    OR NOT (p_proof_policy <@ ARRAY['PHOTO','SIGNATURE','OTP']::text[]) THEN
    RAISE EXCEPTION 'The delivery assignment is unavailable';
  END IF;
  payload_hash:=encode(digest(concat_ws('|',p_delivery_job_id,p_driver_user_id,
    p_driver_role_assignment_id,p_expected_workflow_version,btrim(p_reason),
    p_acceptance_deadline,COALESCE(p_vehicle,''),COALESCE(p_shift,''),
    COALESCE(p_zone,''),array_to_string(p_proof_policy,',')),'sha256'),'hex');
  SELECT * INTO command_row FROM public.axora_begin_delivery_command(
    job.company_id,job.id,p_actor_user_id,p_actor_role_assignment_id,p_command_id,
    'ASSIGN',payload_hash,p_at
  );
  IF NOT command_row.is_new THEN RETURN command_row.replay_result; END IF;
  SELECT * INTO active_assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=job.id AND status IN ('ASSIGNED','ACCEPTED')
    AND ended_at IS NULL FOR UPDATE;
  IF active_assignment.id IS NOT NULL THEN
    UPDATE public.delivery_job_assignments
    SET status='REASSIGNED',ended_at=p_at,updated_at=p_at
    WHERE id=active_assignment.id;
  END IF;
  INSERT INTO public.delivery_job_assignments(
    id,company_id,delivery_job_id,driver_user_id,status,assigned_by,
    assigned_at,driver_role_assignment_id,supervisor_role_assignment_id,
    expected_job_version,assignment_reason,acceptance_deadline,
    vehicle_snapshot,shift_snapshot,zone_snapshot,command_id,updated_at
  ) VALUES (
    assignment_id,job.company_id,job.id,p_driver_user_id,'ASSIGNED',
    p_actor_user_id,p_at,p_driver_role_assignment_id,p_actor_role_assignment_id,
    p_expected_workflow_version,btrim(p_reason),p_acceptance_deadline,
    NULLIF(btrim(COALESCE(p_vehicle,'')),''),
    NULLIF(btrim(COALESCE(p_shift,'')),''),
    NULLIF(btrim(COALESCE(p_zone,'')),''),p_command_id,p_at
  );
  SELECT request.request_version INTO current_request_version
  FROM public.requests request WHERE request.id=job.request_id FOR SHARE;
  UPDATE public.fulfilment_purchase_assignments
  SET status='CANCELLED',updated_at=p_at
  WHERE request_id=job.request_id AND request_version=current_request_version
    AND status='ASSIGNED';
  INSERT INTO public.fulfilment_purchase_assignments(
    request_id,request_version,company_id,assigned_user_id,
    assigned_role_assignment_id,assigned_by,assigned_by_role_assignment_id,
    status,reason,correlation_id,idempotency_key,assigned_at,updated_at
  ) VALUES (
    job.request_id,current_request_version,job.company_id,p_driver_user_id,
    p_driver_role_assignment_id,p_actor_user_id,p_actor_role_assignment_id,
    'ASSIGNED',btrim(p_reason),p_command_id,
    'delivery-assignment-'||assignment_id::text,p_at,p_at
  );
  UPDATE public.delivery_jobs SET status='ASSIGNED',
    workflow_version=workflow_version+1,acceptance_deadline=p_acceptance_deadline,
    proof_policy=p_proof_policy,status_changed_at=p_at,
    tracking_stopped_at=NULL,cancellation_reason=NULL,updated_at=p_at
  WHERE id=job.id;
  result:=jsonb_build_object(
    'jobId',job.id,'assignmentId',assignment_id,'status','ASSIGNED',
    'workflowVersion',job.workflow_version+1,'driverUserId',p_driver_user_id,
    'acceptanceDeadline',p_acceptance_deadline
  );
  PERFORM public.axora_complete_delivery_command(command_row.command_row_id,result,p_at);
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_job_assignments',assignment_id,
    CASE WHEN active_assignment.id IS NULL THEN 'ASSIGN' ELSE 'REASSIGN' END,
    p_actor_user_id,job.company_id,job.request_id,p_reason,
    jsonb_build_object('driverUserId',p_driver_user_id,
      'workflowVersion',job.workflow_version+1,'proofPolicy',p_proof_policy)
  );
  PERFORM public.axora_emit_p1_notification(
    job.company_id,job.branch_id,job.request_id,'delivery-job',job.id,
    'delivery.assigned','delivery-assigned:'||assignment_id::text,
    job.job_code,'/driver',ARRAY[p_driver_user_id],p_actor_user_id,p_command_id,
    p_at,jsonb_build_object('jobId',job.id,'acceptanceDeadline',p_acceptance_deadline)
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_job_has_required_proof(
  p_delivery_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT NOT (
    'PHOTO'=ANY(job.proof_policy) AND NOT EXISTS (
      SELECT 1 FROM public.delivery_evidence evidence
      WHERE evidence.delivery_job_id=job.id
        AND evidence.evidence_type='PHOTO'
        AND evidence.validation_status='ACCEPTED'
        AND evidence.malware_status IN ('NOT_CONFIGURED','CLEAN')
        AND (evidence.retention_until>now() OR evidence.legal_hold)
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_evidence newer
          WHERE newer.supersedes_evidence_id=evidence.id
        )
    )
  ) AND NOT (
    'SIGNATURE'=ANY(job.proof_policy) AND NOT EXISTS (
      SELECT 1 FROM public.delivery_evidence evidence
      WHERE evidence.delivery_job_id=job.id
        AND evidence.evidence_type='SIGNATURE'
        AND evidence.validation_status='ACCEPTED'
        AND evidence.recipient_identity IS NOT NULL
        AND evidence.consented_at IS NOT NULL
        AND (evidence.retention_until>now() OR evidence.legal_hold)
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_evidence newer
          WHERE newer.supersedes_evidence_id=evidence.id
        )
    )
  ) AND NOT (
    'OTP'=ANY(job.proof_policy) AND NOT EXISTS (
      SELECT 1 FROM public.delivery_otp_challenges challenge
      WHERE challenge.delivery_job_id=job.id AND challenge.status='VERIFIED'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_proof_exceptions exception
    WHERE exception.delivery_job_id=job.id
      AND exception.decision='GRANTED'
      AND exception.exception_version=(
        SELECT max(latest.exception_version)
        FROM public.delivery_proof_exceptions latest
        WHERE latest.delivery_job_id=job.id
      )
  )
  FROM public.delivery_jobs job WHERE job.id=p_delivery_job_id
$$;

CREATE OR REPLACE FUNCTION public.axora_record_delivery_event(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_assignment_id uuid,
  p_expected_workflow_version integer,
  p_command_id uuid,
  p_device_id uuid,
  p_device_sequence bigint,
  p_event_type text,
  p_client_recorded_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE;
  assignment public.delivery_job_assignments%ROWTYPE; command_row record;
  next_status text; required_permission text; event_id uuid:=gen_random_uuid();
  result jsonb; payload_hash text; existing public.delivery_job_events%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE id=p_assignment_id AND delivery_job_id=p_delivery_job_id FOR UPDATE;
  SELECT * INTO existing FROM public.delivery_job_events
  WHERE driver_user_id=p_actor_user_id AND client_event_id=p_command_id;
  IF existing.id IS NOT NULL THEN
    IF existing.assignment_id<>p_assignment_id
      OR existing.event_type<>p_event_type
      OR existing.device_id<>p_device_id
      OR existing.device_sequence<>p_device_sequence
      OR existing.client_recorded_at<>p_client_recorded_at
      OR existing.metadata<>COALESCE(p_metadata,'{}'::jsonb)
      OR existing.job_version_before<>p_expected_workflow_version THEN
      RAISE EXCEPTION 'The delivery event is unavailable';
    END IF;
    RETURN jsonb_build_object(
      'eventId',existing.id,'jobId',existing.delivery_job_id,
      'status',(SELECT status FROM public.delivery_jobs WHERE id=existing.delivery_job_id),
      'workflowVersion',COALESCE(existing.job_version_after,
        (SELECT workflow_version FROM public.delivery_jobs WHERE id=existing.delivery_job_id))
    );
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  required_permission:=CASE
    WHEN p_event_type IN ('ACCEPTED','REJECTED') THEN 'delivery.accept'
    WHEN p_event_type IN ('SHOPPING_STARTED','ITEMS_ACQUIRED') THEN 'delivery.shop'
    WHEN p_event_type IN ('PARTIALLY_DELIVERED','DELIVERED','COMPLETED')
      THEN 'delivery.complete'
    ELSE 'delivery.track' END;
  IF snapshot IS NULL OR job.id IS NULL OR assignment.id IS NULL
    OR assignment.driver_user_id<>p_actor_user_id
    OR assignment.driver_role_assignment_id<>p_actor_role_assignment_id
    OR assignment.status NOT IN ('ASSIGNED','ACCEPTED') OR assignment.ended_at IS NOT NULL
    OR job.workflow_version<>p_expected_workflow_version
    OR job.status IN ('COMPLETED','CANCELLED')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,required_permission,'DELIVERY',NULL,NULL,NULL,NULL
    ) OR p_device_sequence<0
    OR p_client_recorded_at>p_at+interval '5 minutes'
    OR p_client_recorded_at<assignment.assigned_at-interval '5 minutes' THEN
    RAISE EXCEPTION 'The delivery event is unavailable';
  END IF;
  next_status:=CASE p_event_type
    WHEN 'ACCEPTED' THEN CASE WHEN job.status='ASSIGNED' THEN 'ACCEPTED' END
    WHEN 'REJECTED' THEN CASE WHEN job.status='ASSIGNED' THEN 'AWAITING_ASSIGNMENT' END
    WHEN 'SHOPPING_STARTED' THEN CASE WHEN job.status='ACCEPTED' THEN 'SHOPPING' END
    WHEN 'ITEMS_ACQUIRED' THEN CASE WHEN job.status='SHOPPING' AND EXISTS (
      SELECT 1 FROM public.request_actual_submissions actual
      WHERE actual.request_id=job.request_id AND actual.state='FINALIZED'
    ) THEN 'ITEMS_ACQUIRED' END
    WHEN 'OUT_FOR_DELIVERY' THEN CASE WHEN job.status='ITEMS_ACQUIRED'
      THEN 'OUT_FOR_DELIVERY' END
    WHEN 'EN_ROUTE' THEN CASE WHEN job.status='ITEMS_ACQUIRED'
      THEN 'OUT_FOR_DELIVERY' END
    WHEN 'ARRIVED' THEN CASE WHEN job.status='OUT_FOR_DELIVERY' THEN 'ARRIVED' END
    WHEN 'PARTIALLY_DELIVERED' THEN CASE WHEN job.status='ARRIVED'
      THEN 'PARTIALLY_DELIVERED' END
    WHEN 'DELIVERED' THEN CASE WHEN job.status IN ('ARRIVED','PARTIALLY_DELIVERED')
      THEN 'DELIVERED' END
    WHEN 'COMPLETED' THEN CASE WHEN job.status IN ('DELIVERED','PARTIALLY_DELIVERED')
      AND public.axora_delivery_job_has_required_proof(job.id)
      THEN 'COMPLETED' END
    WHEN 'FAILED' THEN CASE WHEN job.status IN (
      'ASSIGNED','ACCEPTED','SHOPPING','ITEMS_ACQUIRED','OUT_FOR_DELIVERY','ARRIVED',
      'PARTIALLY_DELIVERED'
    ) THEN 'FAILED' END
    WHEN 'DELIVERY_ATTEMPTED' THEN CASE WHEN job.status='ARRIVED' THEN job.status END
    WHEN 'ISSUE_REPORTED' THEN job.status
    WHEN 'NOTE_ADDED' THEN job.status
  END;
  IF next_status IS NULL THEN RAISE EXCEPTION 'The delivery transition is unavailable'; END IF;
  IF p_event_type IN ('REJECTED','FAILED','ISSUE_REPORTED')
    AND char_length(btrim(COALESCE(p_metadata->>'note',''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A delivery exception reason is required';
  END IF;
  payload_hash:=encode(digest(concat_ws('|',p_delivery_job_id,p_assignment_id,
    p_expected_workflow_version,p_device_id,p_device_sequence,p_event_type,
    p_client_recorded_at,p_metadata::text),'sha256'),'hex');
  SELECT * INTO command_row FROM public.axora_begin_delivery_command(
    job.company_id,job.id,p_actor_user_id,p_actor_role_assignment_id,p_command_id,
    'EVENT:'||p_event_type,payload_hash,p_at
  );
  IF NOT command_row.is_new THEN RETURN command_row.replay_result; END IF;
  INSERT INTO public.delivery_job_events(
    id,company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
    client_event_id,device_sequence,event_type,client_recorded_at,received_at,
    metadata,job_version_before,job_version_after,destination_timezone_snapshot,
    client_local_recorded_at,command_id
  ) VALUES (
    event_id,job.company_id,job.id,assignment.id,p_actor_user_id,p_device_id,
    p_command_id,p_device_sequence,p_event_type,p_client_recorded_at,p_at,
    COALESCE(p_metadata,'{}'::jsonb),job.workflow_version,job.workflow_version+1,
    job.destination_timezone,p_client_recorded_at AT TIME ZONE job.destination_timezone,
    p_command_id
  );
  IF p_event_type='ACCEPTED' THEN
    UPDATE public.delivery_job_assignments SET status='ACCEPTED',accepted_at=p_at,
      updated_at=p_at WHERE id=assignment.id;
  ELSIF p_event_type IN ('REJECTED','FAILED') THEN
    UPDATE public.delivery_job_assignments SET status=CASE p_event_type
        WHEN 'REJECTED' THEN 'REJECTED' ELSE 'CANCELLED' END,
      ended_at=p_at,updated_at=p_at WHERE id=assignment.id;
    UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',updated_at=p_at
    WHERE request_id=job.request_id AND assigned_user_id=p_actor_user_id
      AND assigned_role_assignment_id=p_actor_role_assignment_id AND status='ASSIGNED';
  ELSIF p_event_type='COMPLETED' THEN
    UPDATE public.delivery_job_assignments SET status='COMPLETED',ended_at=p_at,
      updated_at=p_at WHERE id=assignment.id;
    UPDATE public.fulfilment_purchase_assignments SET status='COMPLETED',
      completed_at=p_at,updated_at=p_at
    WHERE request_id=job.request_id AND assigned_user_id=p_actor_user_id
      AND assigned_role_assignment_id=p_actor_role_assignment_id AND status='ASSIGNED';
  END IF;
  UPDATE public.delivery_jobs SET status=next_status,
    workflow_version=workflow_version+1,status_changed_at=CASE
      WHEN next_status<>job.status THEN p_at ELSE status_changed_at END,
    tracking_stopped_at=CASE WHEN next_status='COMPLETED' THEN p_at ELSE tracking_stopped_at END,
    updated_at=p_at WHERE id=job.id;
  result:=jsonb_build_object(
    'eventId',event_id,'jobId',job.id,'status',next_status,
    'workflowVersion',job.workflow_version+1,'receivedAt',p_at
  );
  PERFORM public.axora_complete_delivery_command(command_row.command_row_id,result,p_at);
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_job_events',event_id,p_event_type,p_actor_user_id,job.company_id,
    job.request_id,COALESCE(p_metadata->>'note',p_event_type),
    jsonb_build_object('statusBefore',job.status,'statusAfter',next_status,
      'workflowVersion',job.workflow_version+1)
  );
  PERFORM public.axora_emit_p1_notification(
    job.company_id,job.branch_id,job.request_id,'delivery-job',job.id,
    'delivery.'||lower(p_event_type),'delivery-event:'||event_id::text,
    job.job_code,CASE WHEN next_status IN ('DELIVERED','COMPLETED')
      THEN '/receiving' ELSE '/deliveries' END,
    ARRAY[p_actor_user_id,job.created_by],p_actor_user_id,p_command_id,p_at,
    jsonb_build_object('jobId',job.id,'status',next_status)
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_manage_delivery_job(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_expected_workflow_version integer,
  p_operation text,
  p_reason text,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_local_start timestamp without time zone,
  p_local_end timestamp without time zone,
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE; command_row record;
  operation text:=upper(p_operation); next_status text; result jsonb;
  active_assignment public.delivery_job_assignments%ROWTYPE; exception_version integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  IF snapshot IS NULL OR job.id IS NULL
    OR job.workflow_version<>p_expected_workflow_version
    OR operation NOT IN ('CANCEL','RESCHEDULE','PROOF_EXCEPTION')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
    ) THEN RAISE EXCEPTION 'The delivery management command is unavailable'; END IF;
  IF operation='CANCEL' AND job.status IN (
      'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED','COMPLETED','CANCELLED'
    ) THEN RAISE EXCEPTION 'The delivery cannot be cancelled at this stage'; END IF;
  IF operation='RESCHEDULE' AND (
    job.status IN ('DELIVERED','COMPLETED','CANCELLED')
    OR p_scheduled_window_start IS NULL OR p_scheduled_window_end<=p_scheduled_window_start
    OR p_scheduled_window_start AT TIME ZONE job.destination_timezone<>p_local_start
    OR p_scheduled_window_end AT TIME ZONE job.destination_timezone<>p_local_end
  ) THEN RAISE EXCEPTION 'The delivery reschedule is unavailable'; END IF;
  IF operation='PROOF_EXCEPTION' AND job.status NOT IN ('DELIVERED','PARTIALLY_DELIVERED')
    THEN RAISE EXCEPTION 'The delivery proof exception is unavailable'; END IF;
  SELECT * INTO command_row FROM public.axora_begin_delivery_command(
    job.company_id,job.id,p_actor_user_id,p_actor_role_assignment_id,p_command_id,
    operation,encode(digest(concat_ws('|',job.id,p_expected_workflow_version,
      operation,btrim(p_reason),p_scheduled_window_start,p_scheduled_window_end),
      'sha256'),'hex'),p_at
  );
  IF NOT command_row.is_new THEN RETURN command_row.replay_result; END IF;
  IF operation='PROOF_EXCEPTION' THEN
    SELECT COALESCE(max(value.exception_version),0)+1 INTO exception_version
    FROM public.delivery_proof_exceptions value WHERE value.delivery_job_id=job.id;
    INSERT INTO public.delivery_proof_exceptions(
      company_id,delivery_job_id,exception_version,decision,reason,approved_by,
      approved_by_role_assignment_id,command_id,created_at
    ) VALUES (job.company_id,job.id,exception_version,'GRANTED',btrim(p_reason),
      p_actor_user_id,p_actor_role_assignment_id,p_command_id,p_at);
    next_status:=job.status;
  ELSE
    next_status:=CASE operation WHEN 'CANCEL' THEN 'CANCELLED' ELSE 'RESCHEDULED' END;
    SELECT * INTO active_assignment FROM public.delivery_job_assignments
    WHERE delivery_job_id=job.id AND status IN ('ASSIGNED','ACCEPTED')
      AND ended_at IS NULL FOR UPDATE;
    IF active_assignment.id IS NOT NULL THEN
      UPDATE public.delivery_job_assignments SET status='CANCELLED',ended_at=p_at,
        updated_at=p_at WHERE id=active_assignment.id;
      UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',updated_at=p_at
      WHERE request_id=job.request_id AND status='ASSIGNED';
    END IF;
    UPDATE public.delivery_jobs SET status=next_status,
      workflow_version=workflow_version+1,status_changed_at=p_at,
      scheduled_window_start=CASE WHEN operation='RESCHEDULE'
        THEN p_scheduled_window_start ELSE scheduled_window_start END,
      scheduled_window_end=CASE WHEN operation='RESCHEDULE'
        THEN p_scheduled_window_end ELSE scheduled_window_end END,
      acceptance_deadline=CASE WHEN operation='RESCHEDULE'
        THEN least(p_scheduled_window_start,p_at+interval '2 hours') ELSE acceptance_deadline END,
      sla_due_at=CASE WHEN operation='RESCHEDULE'
        THEN p_scheduled_window_end ELSE sla_due_at END,
      tracking_stopped_at=CASE WHEN operation='CANCEL' THEN p_at ELSE tracking_stopped_at END,
      cancellation_reason=CASE WHEN operation='CANCEL' THEN btrim(p_reason) END,
      updated_at=p_at WHERE id=job.id;
  END IF;
  result:=jsonb_build_object('jobId',job.id,'status',next_status,
    'workflowVersion',CASE WHEN operation='PROOF_EXCEPTION'
      THEN job.workflow_version ELSE job.workflow_version+1 END,
    'operation',operation);
  PERFORM public.axora_complete_delivery_command(command_row.command_row_id,result,p_at);
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_jobs',job.id,operation,p_actor_user_id,job.company_id,job.request_id,
    p_reason,jsonb_build_object('statusBefore',job.status,'statusAfter',next_status)
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_create_delivery_otp(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_code_hash text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE; challenge_id uuid:=gen_random_uuid();
  recipient_name text; recent_count integer; expires timestamptz:=p_at+interval '10 minutes';
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  SELECT account.display_name INTO recipient_name FROM public.users account
  WHERE account.id=p_actor_user_id;
  SELECT count(*) INTO recent_count FROM public.delivery_otp_challenges challenge
  WHERE challenge.recipient_user_id=p_actor_user_id
    AND challenge.delivery_job_id=p_delivery_job_id
    AND challenge.created_at>p_at-interval '15 minutes';
  IF snapshot IS NULL OR job.id IS NULL
    OR job.status NOT IN ('ARRIVED','PARTIALLY_DELIVERED','DELIVERED')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'receiving.confirm','BRANCH',job.company_id,job.branch_id,NULL,NULL
    ) OR NOT public.axora_user_can_receive(p_actor_user_id,job.company_id,job.branch_id)
    OR p_code_hash !~ '^[0-9a-f]{64}$' OR recent_count>=3 THEN
    RAISE EXCEPTION 'The delivery confirmation is unavailable';
  END IF;
  UPDATE public.delivery_otp_challenges SET status='SUPERSEDED'
  WHERE delivery_job_id=job.id AND status='ACTIVE';
  INSERT INTO public.delivery_otp_challenges(
    id,company_id,branch_id,delivery_job_id,recipient_user_id,
    recipient_role_assignment_id,recipient_identity_snapshot,code_hash,
    status,attempt_count,maximum_attempts,expires_at,created_at
  ) VALUES (challenge_id,job.company_id,job.branch_id,job.id,p_actor_user_id,
    p_actor_role_assignment_id,recipient_name,p_code_hash,'ACTIVE',0,5,expires,p_at);
  INSERT INTO public.delivery_otp_events(
    company_id,delivery_job_id,challenge_id,event_type,actor_user_id,occurred_at
  ) VALUES (job.company_id,job.id,challenge_id,'ISSUED',p_actor_user_id,p_at);
  RETURN jsonb_build_object('challengeId',challenge_id,'expiresAt',expires,
    'recipientIdentity',recipient_name);
END
$$;

CREATE OR REPLACE FUNCTION public.axora_verify_delivery_otp(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_challenge_id uuid,
  p_code_hash text,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; assignment public.delivery_job_assignments%ROWTYPE;
  challenge public.delivery_otp_challenges%ROWTYPE; event_type text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=p_delivery_job_id AND driver_user_id=p_actor_user_id
    AND driver_role_assignment_id=p_actor_role_assignment_id
    AND status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL FOR UPDATE;
  SELECT * INTO challenge FROM public.delivery_otp_challenges
  WHERE id=p_challenge_id AND delivery_job_id=p_delivery_job_id FOR UPDATE;
  IF snapshot IS NULL OR assignment.id IS NULL OR challenge.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.complete','DELIVERY',NULL,NULL,NULL,NULL
    ) THEN RAISE EXCEPTION 'The delivery confirmation is unavailable'; END IF;
  IF challenge.status<>'ACTIVE' THEN RETURN challenge.status='VERIFIED'; END IF;
  IF challenge.expires_at<=p_at THEN
    UPDATE public.delivery_otp_challenges SET status='EXPIRED' WHERE id=challenge.id;
    event_type:='EXPIRED';
  ELSIF challenge.attempt_count>=challenge.maximum_attempts THEN
    UPDATE public.delivery_otp_challenges SET status='LOCKED' WHERE id=challenge.id;
    event_type:='LOCKED';
  ELSIF challenge.code_hash=p_code_hash THEN
    UPDATE public.delivery_otp_challenges SET status='VERIFIED',verified_at=p_at,
      verified_by=p_actor_user_id WHERE id=challenge.id;
    event_type:='VERIFIED';
  ELSE
    UPDATE public.delivery_otp_challenges
    SET attempt_count=attempt_count+1,
      status=CASE WHEN attempt_count+1>=maximum_attempts THEN 'LOCKED' ELSE status END
    WHERE id=challenge.id;
    event_type:=CASE WHEN challenge.attempt_count+1>=challenge.maximum_attempts
      THEN 'LOCKED' ELSE 'FAILED' END;
  END IF;
  INSERT INTO public.delivery_otp_events(
    company_id,delivery_job_id,challenge_id,event_type,actor_user_id,occurred_at,
    metadata
  ) VALUES (challenge.company_id,challenge.delivery_job_id,challenge.id,
    event_type,p_actor_user_id,p_at,jsonb_build_object(
      'attemptNumber',least(challenge.attempt_count+1,challenge.maximum_attempts)
    ));
  RETURN event_type='VERIFIED';
END
$$;

CREATE OR REPLACE FUNCTION public.axora_register_delivery_evidence(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_delivery_job_event_id uuid,
  p_client_evidence_id uuid,
  p_evidence_type text,
  p_file_name text,
  p_content_type text,
  p_storage_path text,
  p_sha256 text,
  p_captured_at timestamptz,
  p_recipient_identity text,
  p_consent_copy_version text,
  p_consented_at timestamptz,
  p_image_width integer,
  p_image_height integer,
  p_supersedes_evidence_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; assignment public.delivery_job_assignments%ROWTYPE;
  event public.delivery_job_events%ROWTYPE; parent public.delivery_evidence%ROWTYPE;
  existing public.delivery_evidence%ROWTYPE; evidence_id uuid:=gen_random_uuid();
  next_version integer;
BEGIN
  SELECT * INTO existing FROM public.delivery_evidence
  WHERE driver_user_id=p_actor_user_id AND client_evidence_id=p_client_evidence_id;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('evidenceId',existing.id,'version',existing.evidence_version);
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=p_delivery_job_id AND driver_user_id=p_actor_user_id
    AND driver_role_assignment_id=p_actor_role_assignment_id
    AND status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL FOR UPDATE;
  SELECT * INTO event FROM public.delivery_job_events
  WHERE id=p_delivery_job_event_id AND delivery_job_id=p_delivery_job_id
    AND driver_user_id=p_actor_user_id;
  IF p_supersedes_evidence_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.delivery_evidence
    WHERE id=p_supersedes_evidence_id AND delivery_job_id=p_delivery_job_id
      AND driver_user_id=p_actor_user_id FOR SHARE;
  END IF;
  IF snapshot IS NULL OR assignment.id IS NULL OR event.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.receipt.upload','DELIVERY',NULL,NULL,NULL,NULL
    ) OR p_evidence_type NOT IN ('PHOTO','SIGNATURE','DELIVERY_NOTE')
    OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path !~ '^delivery-evidence/[A-Za-z0-9._/-]+$'
    OR (p_evidence_type IN ('PHOTO','SIGNATURE') AND p_content_type NOT LIKE 'image/%')
    OR (p_content_type LIKE 'image/%' AND (p_image_width IS NULL OR p_image_height IS NULL))
    OR (p_supersedes_evidence_id IS NOT NULL AND parent.id IS NULL)
    OR (p_evidence_type='SIGNATURE' AND (
      char_length(btrim(COALESCE(p_recipient_identity,''))) NOT BETWEEN 2 AND 200
      OR char_length(btrim(COALESCE(p_consent_copy_version,''))) NOT BETWEEN 1 AND 80
      OR p_consented_at IS NULL
    )) THEN RAISE EXCEPTION 'The delivery evidence is unavailable'; END IF;
  SELECT COALESCE(max(evidence.evidence_version),0)+1 INTO next_version
  FROM public.delivery_evidence evidence
  WHERE evidence.delivery_job_id=p_delivery_job_id
    AND evidence.evidence_type=p_evidence_type;
  INSERT INTO public.delivery_evidence(
    id,company_id,delivery_job_id,delivery_job_event_id,driver_user_id,
    client_evidence_id,evidence_type,file_name,content_type,storage_path,sha256,
    captured_at,created_at,metadata,evidence_version,supersedes_evidence_id,
    recipient_identity,consent_copy_version,consented_at,image_width,image_height,
    validation_status,malware_status,retention_until,legal_hold
  ) VALUES (
    evidence_id,assignment.company_id,p_delivery_job_id,p_delivery_job_event_id,
    p_actor_user_id,p_client_evidence_id,p_evidence_type,p_file_name,p_content_type,
    p_storage_path,p_sha256,p_captured_at,p_at,COALESCE(p_metadata,'{}'::jsonb),
    next_version,p_supersedes_evidence_id,
    NULLIF(btrim(COALESCE(p_recipient_identity,'')),''),
    NULLIF(btrim(COALESCE(p_consent_copy_version,'')),''),p_consented_at,
    p_image_width,p_image_height,'ACCEPTED','NOT_CONFIGURED',
    p_at+interval '365 days',false
  );
  RETURN jsonb_build_object('evidenceId',evidence_id,'version',next_version,
    'validationStatus','ACCEPTED');
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_evidence_file(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_evidence_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  evidence_id uuid,file_name text,content_type text,storage_path text,
  sha256 text,delivery_job_id uuid,evidence_version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; evidence public.delivery_evidence%ROWTYPE;
  job public.delivery_jobs%ROWTYPE; authorized boolean:=false;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO evidence FROM public.delivery_evidence WHERE id=p_evidence_id;
  SELECT * INTO job FROM public.delivery_jobs WHERE id=evidence.delivery_job_id;
  IF snapshot IS NULL OR evidence.id IS NULL OR job.id IS NULL
    OR evidence.validation_status<>'ACCEPTED'
    OR (evidence.retention_until<=p_at AND NOT evidence.legal_hold) THEN RETURN; END IF;
  authorized:=public.axora_snapshot_has_permission(
    snapshot,'delivery.view','PLATFORM',NULL,NULL,NULL,NULL
  ) OR (
    public.axora_snapshot_has_permission(
      snapshot,'receiving.confirm','BRANCH',job.company_id,job.branch_id,NULL,NULL
    ) AND public.axora_user_can_receive(p_actor_user_id,job.company_id,job.branch_id)
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_job_assignments assignment
    WHERE assignment.delivery_job_id=job.id
      AND assignment.driver_user_id=p_actor_user_id
      AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
      AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
  );
  IF NOT authorized THEN RETURN; END IF;
  RETURN QUERY SELECT evidence.id,evidence.file_name,evidence.content_type,
    evidence.storage_path,evidence.sha256,evidence.delivery_job_id,
    evidence.evidence_version;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_create_delivery_receipt_attachment(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_request_id uuid,
  p_file_name text,
  p_content_type text,
  p_file_content bytea,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; assignment public.fulfilment_purchase_assignments%ROWTYPE;
  request public.requests%ROWTYPE; attachment_id uuid:=gen_random_uuid();
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request FROM public.requests WHERE id=p_request_id FOR SHARE;
  SELECT * INTO assignment FROM public.fulfilment_purchase_assignments
  WHERE request_id=request.id AND request_version=request.request_version
    AND assigned_user_id=p_actor_user_id
    AND assigned_role_assignment_id=p_actor_role_assignment_id
    AND status='ASSIGNED' FOR SHARE;
  IF snapshot IS NULL OR request.id IS NULL OR assignment.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.receipt.upload','DELIVERY',NULL,NULL,NULL,NULL
    ) OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR octet_length(p_file_content) NOT BETWEEN 1 AND 5242880
    OR char_length(btrim(COALESCE(p_file_name,''))) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'The private receipt evidence is unavailable';
  END IF;
  INSERT INTO public.attachments(
    id,entity_type,record_id,file_name,content_type,storage_path,uploaded_by,
    created_at,company_id,file_content,visibility,request_id
  ) VALUES (
    attachment_id,'request',request.id,btrim(p_file_name),p_content_type,
    'database/delivery-receipts/'||attachment_id::text,p_actor_user_id,p_at,
    request.company_id,p_file_content,'INTERNAL',request.id
  );
  RETURN attachment_id;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_execution_workspace(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
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
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.portal.view','DELIVERY',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'actorId',p_actor_user_id,'capturedAt',p_at,
    'products',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',product.id,'name',product.name,'code',product.product_code
    ) ORDER BY product.name) FROM public.products product WHERE product.active),'[]'::jsonb),
    'suppliers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',supplier.id,'name',supplier.name,'code',supplier.supplier_code
    ) ORDER BY supplier.name) FROM public.suppliers supplier
      WHERE supplier.active AND supplier.company_id IS NULL),'[]'::jsonb),
    'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',job.id,'code',job.job_code,'status',job.status,
      'workflowVersion',job.workflow_version,'assignmentId',assignment.id,
      'requestId',job.request_id,'requestNumber',request.order_code,
      'currency',request.currency,'branchName',branch.name,
      'destinationTimezone',job.destination_timezone,
      'scheduledWindowStart',job.scheduled_window_start,
      'scheduledWindowEnd',job.scheduled_window_end,
      'scheduledLocalStart',job.scheduled_local_start,
      'scheduledLocalEnd',job.scheduled_local_end,
      'scheduledLocalDate',job.scheduled_local_date,
      'acceptanceDeadline',assignment.acceptance_deadline,
      'slaDueAt',job.sla_due_at,'address',job.delivery_address_snapshot,
      'contactName',job.contact_name_snapshot,'contactPhone',job.contact_phone_snapshot,
      'instructions',job.instructions,'vehicle',assignment.vehicle_snapshot,
      'shift',assignment.shift_snapshot,'zone',assignment.zone_snapshot,
      'proofPolicy',job.proof_policy,
      'proofSatisfied',public.axora_delivery_job_has_required_proof(job.id),
      'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',delivery_line.id,'requestLineId',request_line.id,
        'productId',request_line.product_id,'productName',request_line.product_name_snapshot,
        'quantity',delivery_line.quantity_to_deliver,
        'unitOfMeasure',delivery_line.unit_of_measure_snapshot,
        'selectedSupplierId',request_line.selected_supplier_id
      ) ORDER BY request_line.request_line_code)
      FROM public.delivery_job_lines delivery_line
      JOIN public.request_lines request_line ON request_line.id=delivery_line.request_line_id
      WHERE delivery_line.delivery_job_id=job.id),'[]'::jsonb),
      'actualHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',actual.id,'state',actual.state,'purchaseMode',actual.purchase_mode,
        'amount',actual.submission_amount::text,'substitutePresent',actual.substitute_present,
        'submittedAt',actual.submitted_at
      ) ORDER BY actual.submitted_at DESC) FROM public.request_actual_submissions actual
      WHERE actual.request_id=job.request_id),'[]'::jsonb),
      'events',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',event.id,'type',event.event_type,'receivedAt',event.received_at,
        'clientRecordedAt',event.client_recorded_at,'localRecordedAt',event.client_local_recorded_at,
        'timezone',event.destination_timezone_snapshot,'metadata',event.metadata,
        'versionAfter',event.job_version_after
      ) ORDER BY event.received_at,event.id) FROM public.delivery_job_events event
      WHERE event.delivery_job_id=job.id),'[]'::jsonb),
      'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',evidence.id,'type',evidence.evidence_type,'fileName',evidence.file_name,
        'version',evidence.evidence_version,'validationStatus',evidence.validation_status,
        'recipientIdentity',evidence.recipient_identity,'createdAt',evidence.created_at
      ) ORDER BY evidence.created_at DESC) FROM public.delivery_evidence evidence
      WHERE evidence.delivery_job_id=job.id
        AND NOT EXISTS (SELECT 1 FROM public.delivery_evidence newer
          WHERE newer.supersedes_evidence_id=evidence.id)),'[]'::jsonb)
    ) ORDER BY job.scheduled_window_start NULLS LAST,job.created_at)
    FROM public.delivery_job_assignments assignment
    JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
    JOIN public.requests request ON request.id=job.request_id
    JOIN public.branches branch ON branch.id=job.branch_id
    WHERE assignment.driver_user_id=p_actor_user_id
      AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
      AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
      AND job.status NOT IN ('COMPLETED','CANCELLED')),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_supervisor_workspace(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
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
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'agents',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'userId',account.id,'roleAssignmentId',role_assignment.id,
      'name',account.display_name,'email',account.email,
      'activeJobs',(SELECT count(*) FROM public.delivery_job_assignments active
        WHERE active.driver_user_id=account.id AND active.status IN ('ASSIGNED','ACCEPTED')
          AND active.ended_at IS NULL),
      'overdueJobs',(SELECT count(*) FROM public.delivery_job_assignments overdue
        WHERE overdue.driver_user_id=account.id AND overdue.status='ASSIGNED'
          AND overdue.ended_at IS NULL AND overdue.acceptance_deadline<p_at)
    ) ORDER BY account.display_name)
    FROM public.role_assignments role_assignment
    JOIN public.users account ON account.id=role_assignment.user_id
      AND account.active AND account.account_status='ACTIVE'
    WHERE role_assignment.active AND role_assignment.revoked_at IS NULL
      AND role_assignment.scope_type='DELIVERY'
      AND public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot(
          account.id,role_assignment.id,p_at
        ),'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
      )),'[]'::jsonb),
    'requests',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',request.id,'number',request.order_code,'companyName',company.name,
      'branchName',branch.name,'branchTimezone',branch.timezone,
      'neededByDate',request.needed_by_date
    ) ORDER BY request.created_at DESC)
    FROM public.requests request
    JOIN public.companies company ON company.id=request.company_id
    JOIN public.branches branch ON branch.id=request.branch_id
    WHERE request.approval_state IN ('APPROVED','AWAITING_FULFILMENT')
      AND NOT EXISTS (SELECT 1 FROM public.delivery_jobs active_job
        WHERE active_job.request_id=request.id
          AND active_job.status NOT IN ('COMPLETED','CANCELLED'))),'[]'::jsonb),
    'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',job.id,'code',job.job_code,'status',job.status,
      'workflowVersion',job.workflow_version,'requestNumber',request.order_code,
      'companyName',company.name,'branchName',branch.name,
      'destinationTimezone',job.destination_timezone,
      'scheduledWindowStart',job.scheduled_window_start,
      'scheduledWindowEnd',job.scheduled_window_end,
      'scheduledLocalStart',job.scheduled_local_start,
      'scheduledLocalEnd',job.scheduled_local_end,
      'scheduledLocalDate',job.scheduled_local_date,
      'acceptanceDeadline',job.acceptance_deadline,'slaDueAt',job.sla_due_at,
      'proofPolicy',job.proof_policy,
      'proofSatisfied',public.axora_delivery_job_has_required_proof(job.id),
      'assignment',CASE WHEN assignment.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id',assignment.id,'driverUserId',assignment.driver_user_id,
        'driverName',driver.display_name,'driverRoleAssignmentId',assignment.driver_role_assignment_id,
        'status',assignment.status,'reason',assignment.assignment_reason,
        'vehicle',assignment.vehicle_snapshot,'shift',assignment.shift_snapshot,
        'zone',assignment.zone_snapshot,'assignedAt',assignment.assigned_at
      ) END,
      'history',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',history.id,'driverName',history_driver.display_name,
        'status',history.status,'reason',history.assignment_reason,
        'assignedAt',history.assigned_at,'endedAt',history.ended_at
      ) ORDER BY history.assigned_at DESC)
      FROM public.delivery_job_assignments history
      JOIN public.users history_driver ON history_driver.id=history.driver_user_id
      WHERE history.delivery_job_id=job.id),'[]'::jsonb)
    ) ORDER BY job.created_at DESC)
    FROM public.delivery_jobs job
    JOIN public.requests request ON request.id=job.request_id
    JOIN public.companies company ON company.id=job.company_id
    JOIN public.branches branch ON branch.id=job.branch_id
    LEFT JOIN public.delivery_job_assignments assignment
      ON assignment.delivery_job_id=job.id
      AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
    LEFT JOIN public.users driver ON driver.id=assignment.driver_user_id),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_receiving_delivery_workspace(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
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
  RETURN jsonb_build_object('capturedAt',p_at,'jobs',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',job.id,'code',job.job_code,'status',job.status,
      'requestNumber',request.order_code,'branchName',branch.name,
      'destinationTimezone',job.destination_timezone,
      'scheduledLocalStart',job.scheduled_local_start,
      'proofPolicy',job.proof_policy
    ) ORDER BY job.scheduled_window_start)
    FROM public.delivery_jobs job
    JOIN public.requests request ON request.id=job.request_id
    JOIN public.branches branch ON branch.id=job.branch_id
    WHERE job.status IN ('ARRIVED','PARTIALLY_DELIVERED','DELIVERED')
      AND public.axora_snapshot_has_permission(
        snapshot,'receiving.confirm','BRANCH',job.company_id,job.branch_id,NULL,NULL
      )
      AND public.axora_user_can_receive(p_actor_user_id,job.company_id,job.branch_id)
  ),'[]'::jsonb));
END
$$;

CREATE OR REPLACE FUNCTION public.axora_sync_delivery_actual_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE target_status text;
BEGIN
  target_status:=CASE
    WHEN NEW.state='FINALIZED' THEN 'ITEMS_ACQUIRED'
    WHEN NEW.state='PENDING_COMPANY' AND NEW.substitute_present
      THEN 'AWAITING_SUBSTITUTE_APPROVAL'
    WHEN NEW.state IN ('PENDING_COMPANY','PENDING_AXORA')
      THEN 'AWAITING_ADDITIONAL_APPROVAL'
    WHEN NEW.state IN ('RETURNED','REJECTED') THEN 'SHOPPING'
  END;
  IF target_status IS NOT NULL THEN
    UPDATE public.delivery_jobs SET status=target_status,
      workflow_version=workflow_version+1,status_changed_at=clock_timestamp(),
      updated_at=clock_timestamp()
    WHERE request_id=NEW.request_id
      AND status IN ('SHOPPING','AWAITING_SUBSTITUTE_APPROVAL',
        'AWAITING_ADDITIONAL_APPROVAL','ITEMS_ACQUIRED')
      AND status<>target_status;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER request_actual_sync_delivery_state
  AFTER INSERT OR UPDATE OF state,substitute_present
  ON public.request_actual_submissions
  FOR EACH ROW EXECUTE FUNCTION public.axora_sync_delivery_actual_state();

REVOKE ALL ON FUNCTION public.axora_context_role_assignment_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_begin_delivery_command(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_complete_delivery_command(uuid,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_job_has_required_proof(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_sync_delivery_actual_state() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.axora_delivery_creation_context(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_delivery_job(uuid,uuid,uuid,timestamptz,timestamptz,timestamp without time zone,timestamp without time zone,text,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_assign_delivery_job(uuid,uuid,uuid,uuid,uuid,integer,text,timestamptz,text,text,text,text[],uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_manage_delivery_job(uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,timestamp without time zone,timestamp without time zone,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_delivery_otp(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_verify_delivery_otp(uuid,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_create_delivery_receipt_attachment(uuid,uuid,uuid,text,text,bytea,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_execution_workspace(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_supervisor_workspace(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_receiving_delivery_workspace(uuid,uuid,timestamptz) FROM PUBLIC;



-- Reuse the P1-07 actual-purchase engine for the exact active delivery role
-- captured by the fulfilment assignment. All pricing, substitute, variance,
-- budget and company-ceiling decisions remain unchanged.
CREATE OR REPLACE FUNCTION public.axora_submit_request_actual(p_actor_user_id uuid, p_actor_role_assignment_id uuid, p_request_id uuid, p_purchase_mode text, p_receipt_attachment_id uuid, p_notes text, p_lines jsonb, p_idempotency_key text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
      OR NOT (
        public.axora_snapshot_has_permission(
          snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
        ) OR public.axora_snapshot_has_permission(
          snapshot,'delivery.shop','DELIVERY',NULL,NULL,NULL,NULL
        )
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
    OR NOT (
        public.axora_snapshot_has_permission(
          snapshot,'sourcing.manage','PLATFORM',NULL,NULL,NULL,NULL
        ) OR public.axora_snapshot_has_permission(
          snapshot,'delivery.shop','DELIVERY',NULL,NULL,NULL,NULL
        )
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
END $function$;

REVOKE ALL ON FUNCTION public.axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz) FROM PUBLIC;


-- Runtime grants are conditional so an empty migration database does not need the
-- deployment role. Production creates axora_app before applying application grants.
DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE $axora_grant$REVOKE ALL ON public.branch_delivery_service_levels FROM axora_app$axora_grant$;
    EXECUTE $axora_grant$REVOKE ALL ON public.delivery_workflow_commands FROM axora_app$axora_grant$;
    EXECUTE $axora_grant$REVOKE ALL ON public.delivery_proof_exceptions FROM axora_app$axora_grant$;
    EXECUTE $axora_grant$REVOKE ALL ON public.delivery_otp_challenges FROM axora_app$axora_grant$;
    EXECUTE $axora_grant$REVOKE ALL ON public.delivery_otp_events FROM axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_delivery_creation_context(uuid,uuid,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_create_delivery_job(uuid,uuid,uuid,timestamptz,timestamptz,timestamp without time zone,timestamp without time zone,text,text,text,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_assign_delivery_job(uuid,uuid,uuid,uuid,uuid,integer,text,timestamptz,text,text,text,text[],uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_manage_delivery_job(uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,timestamp without time zone,timestamp without time zone,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_create_delivery_otp(uuid,uuid,uuid,text,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_verify_delivery_otp(uuid,uuid,uuid,uuid,text,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_delivery_evidence_file(uuid,uuid,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_create_delivery_receipt_attachment(uuid,uuid,uuid,text,text,bytea,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_delivery_execution_workspace(uuid,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_delivery_supervisor_workspace(uuid,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_receiving_delivery_workspace(uuid,uuid,timestamptz) TO axora_app$axora_grant$;
    EXECUTE $axora_grant$GRANT EXECUTE ON FUNCTION public.axora_submit_request_actual(uuid,uuid,uuid,text,uuid,text,jsonb,text,timestamptz) TO axora_app$axora_grant$;
  END IF;
END
$axora_runtime_role$;
