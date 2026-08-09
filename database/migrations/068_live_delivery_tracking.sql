BEGIN;

-- P2-02: assignment-bound live delivery tracking. Raw coordinates are private,
-- short-lived operational data; lifecycle events and route summaries retain
-- accountability without retaining movement indefinitely.

INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk,active
) VALUES (
  'delivery.tracking.history','Delivery','View retained tracking history',
  'View unexpired raw delivery coordinates for an authorized dispute or security investigation.',
  true,true
)
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  high_risk=EXCLUDED.high_risk,
  active=true,
  updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.role_key IN ('PLATFORM_OWNER','AUDITOR')
  AND permission.permission_code='delivery.tracking.history'
ON CONFLICT DO NOTHING;

CREATE TABLE public.delivery_tracking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL UNIQUE
    REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  driver_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    status IN ('NOT_STARTED','ACTIVE','PAUSED','ENDED','REVOKED')
  ),
  start_reason text,
  end_reason text,
  started_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz,
  destination_latitude numeric(9,6),
  destination_longitude numeric(9,6),
  visibility_precision text NOT NULL DEFAULT 'APPROXIMATE'
    CHECK (visibility_precision IN ('APPROXIMATE','EXACT')),
  show_vehicle_details boolean NOT NULL DEFAULT false,
  contact_mode text NOT NULL DEFAULT 'AXORA_RELAY'
    CHECK (contact_mode IN ('AXORA_RELAY','NONE')),
  raw_retention_days smallint NOT NULL DEFAULT 30
    CHECK (raw_retention_days BETWEEN 1 AND 90),
  vehicle_type text,
  vehicle_colour text,
  vehicle_registration text,
  point_count integer NOT NULL DEFAULT 0 CHECK (point_count >= 0),
  distance_meters numeric(14,2) NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
  last_point_at timestamptz,
  last_failure_code text,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (destination_latitude IS NULL AND destination_longitude IS NULL)
    OR (
      destination_latitude BETWEEN -90 AND 90
      AND destination_longitude BETWEEN -180 AND 180
    )
  ),
  CHECK (
    start_reason IS NULL
    OR char_length(btrim(start_reason)) BETWEEN 3 AND 1000
  ),
  CHECK (
    end_reason IS NULL
    OR char_length(btrim(end_reason)) BETWEEN 3 AND 1000
  ),
  CHECK (
    vehicle_type IS NULL
    OR char_length(btrim(vehicle_type)) BETWEEN 1 AND 80
  ),
  CHECK (
    vehicle_colour IS NULL
    OR char_length(btrim(vehicle_colour)) BETWEEN 1 AND 80
  ),
  CHECK (
    vehicle_registration IS NULL
    OR char_length(btrim(vehicle_registration)) BETWEEN 1 AND 80
  ),
  CHECK (
    (status='NOT_STARTED' AND started_at IS NULL AND ended_at IS NULL)
    OR (
      status IN ('ACTIVE','PAUSED')
      AND started_at IS NOT NULL
      AND ended_at IS NULL
    )
    OR (
      status IN ('ENDED','REVOKED')
      AND ended_at IS NOT NULL
    )
  )
);

CREATE TABLE public.delivery_tracking_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL
    REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL
    REFERENCES public.delivery_tracking_sessions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED','CONFIGURED','STARTED','PAUSED','RESUMED','ENDED','REVOKED',
    'PERMISSION_DENIED','LOCATION_UNAVAILABLE','RETENTION_PURGED'
  )),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 1000
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object'
    AND public.workflow_metadata_is_safe(metadata)
  ),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_tracking_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL
    REFERENCES public.delivery_tracking_sessions(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL
    REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  client_point_id uuid NOT NULL,
  device_id uuid NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence >= 0),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(9,2) NOT NULL
    CHECK (accuracy_meters > 0 AND accuracy_meters <= 2000),
  speed_mps numeric(8,2) CHECK (speed_mps IS NULL OR speed_mps BETWEEN 0 AND 100),
  heading_degrees numeric(6,2)
    CHECK (heading_degrees IS NULL OR heading_degrees BETWEEN 0 AND 360),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL,
  UNIQUE(session_id,client_point_id),
  UNIQUE(session_id,device_id,device_sequence),
  CHECK (retention_until > received_at)
);

CREATE TABLE public.delivery_tracking_route_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL
    REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL UNIQUE
    REFERENCES public.delivery_tracking_sessions(id) ON DELETE RESTRICT,
  final_status text NOT NULL CHECK (final_status IN ('ENDED','REVOKED')),
  start_reason text,
  end_reason text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz NOT NULL,
  duration_seconds bigint NOT NULL CHECK (duration_seconds >= 0),
  point_count integer NOT NULL CHECK (point_count >= 0),
  distance_meters numeric(14,2) NOT NULL CHECK (distance_meters >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_tracking_session_job_idx
  ON public.delivery_tracking_sessions(
    company_id,branch_id,delivery_job_id,status,updated_at DESC
  );
CREATE INDEX delivery_tracking_session_driver_idx
  ON public.delivery_tracking_sessions(driver_user_id,status,updated_at DESC);
CREATE INDEX delivery_tracking_points_latest_idx
  ON public.delivery_tracking_points(session_id,recorded_at DESC,id DESC);
CREATE INDEX delivery_tracking_points_retention_idx
  ON public.delivery_tracking_points(retention_until,id);
CREATE INDEX delivery_tracking_events_session_idx
  ON public.delivery_tracking_session_events(session_id,occurred_at,id);

CREATE OR REPLACE FUNCTION public.axora_delivery_distance_meters(
  p_latitude_a numeric,
  p_longitude_a numeric,
  p_latitude_b numeric,
  p_longitude_b numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT round((
    6371000::double precision * 2 * asin(sqrt(least(
      1::double precision,
      power(sin(radians((p_latitude_b-p_latitude_a)::double precision)/2),2)
      + cos(radians(p_latitude_a::double precision))
        * cos(radians(p_latitude_b::double precision))
        * power(sin(radians((p_longitude_b-p_longitude_a)::double precision)/2),2)
    )))
  )::numeric,2)
$$;

CREATE OR REPLACE FUNCTION public.axora_reject_tracking_point_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE purge_cutoff timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Raw delivery coordinates are immutable';
  END IF;
  purge_cutoff:=NULLIF(
    current_setting('axora.tracking_retention_cutoff',true),''
  )::timestamptz;
  IF purge_cutoff IS NULL OR OLD.retention_until>purge_cutoff THEN
    RAISE EXCEPTION 'Raw delivery coordinates may only be removed by retention';
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_transition_delivery_tracking(
  p_session_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS public.delivery_tracking_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  item public.delivery_tracking_sessions%ROWTYPE;
  transition_event text;
BEGIN
  SELECT * INTO item
  FROM public.delivery_tracking_sessions
  WHERE id=p_session_id
  FOR UPDATE;
  IF item.id IS NULL
    OR p_status NOT IN ('ACTIVE','PAUSED','ENDED','REVOKED')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The delivery tracking transition is unavailable';
  END IF;
  IF item.status=p_status THEN RETURN item; END IF;
  IF NOT (
    (item.status='NOT_STARTED' AND p_status IN ('ACTIVE','ENDED','REVOKED'))
    OR (item.status='ACTIVE' AND p_status IN ('PAUSED','ENDED','REVOKED'))
    OR (item.status='PAUSED' AND p_status IN ('ACTIVE','ENDED','REVOKED'))
  ) THEN
    RAISE EXCEPTION 'The delivery tracking transition is unavailable';
  END IF;

  transition_event:=CASE
    WHEN p_status='ACTIVE' AND item.status='PAUSED' THEN 'RESUMED'
    WHEN p_status='ACTIVE' THEN 'STARTED'
    WHEN p_status='PAUSED' THEN 'PAUSED'
    WHEN p_status='ENDED' THEN 'ENDED'
    ELSE 'REVOKED'
  END;

  UPDATE public.delivery_tracking_sessions
  SET status=p_status,
      start_reason=CASE
        WHEN p_status='ACTIVE' AND started_at IS NULL THEN btrim(p_reason)
        ELSE start_reason
      END,
      started_at=CASE
        WHEN p_status='ACTIVE' THEN COALESCE(started_at,p_at)
        ELSE started_at
      END,
      paused_at=CASE WHEN p_status='PAUSED' THEN p_at ELSE paused_at END,
      end_reason=CASE
        WHEN p_status IN ('ENDED','REVOKED') THEN btrim(p_reason)
        ELSE end_reason
      END,
      ended_at=CASE
        WHEN p_status IN ('ENDED','REVOKED') THEN p_at
        ELSE NULL
      END,
      updated_at=p_at
  WHERE id=item.id
  RETURNING * INTO item;

  INSERT INTO public.delivery_tracking_session_events(
    company_id,delivery_job_id,assignment_id,session_id,event_type,
    actor_user_id,actor_role_assignment_id,reason,metadata,occurred_at
  ) VALUES (
    item.company_id,item.delivery_job_id,item.assignment_id,item.id,
    transition_event,p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
    jsonb_build_object('status',item.status,'pointCount',item.point_count),p_at
  );

  IF p_status IN ('ENDED','REVOKED') THEN
    INSERT INTO public.delivery_tracking_route_summaries(
      company_id,delivery_job_id,assignment_id,session_id,final_status,
      start_reason,end_reason,started_at,ended_at,duration_seconds,
      point_count,distance_meters,created_at
    ) VALUES (
      item.company_id,item.delivery_job_id,item.assignment_id,item.id,item.status,
      item.start_reason,item.end_reason,item.started_at,item.ended_at,
      CASE WHEN item.started_at IS NULL THEN 0
        ELSE greatest(
          extract(epoch FROM item.ended_at-item.started_at)::bigint,0
        )
      END,
      item.point_count,item.distance_meters,p_at
    )
    ON CONFLICT(session_id) DO NOTHING;
  END IF;
  RETURN item;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_tracking_assignment_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  previous public.delivery_tracking_sessions%ROWTYPE;
  created public.delivery_tracking_sessions%ROWTYPE;
  actor_id uuid;
  actor_assignment_id uuid;
  final_status text;
BEGIN
  actor_id:=COALESCE(public.axora_context_user_id(),NEW.assigned_by);
  actor_assignment_id:=COALESCE(
    public.axora_context_role_assignment_id(),NEW.supervisor_role_assignment_id
  );
  IF TG_OP='INSERT' THEN
    SELECT * INTO previous
    FROM public.delivery_tracking_sessions
    WHERE delivery_job_id=NEW.delivery_job_id
    ORDER BY created_at DESC,id DESC
    LIMIT 1;
    INSERT INTO public.delivery_tracking_sessions(
      company_id,branch_id,delivery_job_id,assignment_id,driver_user_id,
      driver_role_assignment_id,destination_latitude,destination_longitude,
      visibility_precision,show_vehicle_details,contact_mode,
      raw_retention_days,vehicle_type,vehicle_colour,vehicle_registration,
      created_at,updated_at
    )
    SELECT
      NEW.company_id,job.branch_id,NEW.delivery_job_id,NEW.id,
      NEW.driver_user_id,NEW.driver_role_assignment_id,
      previous.destination_latitude,previous.destination_longitude,
      COALESCE(previous.visibility_precision,'APPROXIMATE'),
      COALESCE(previous.show_vehicle_details,false),
      COALESCE(previous.contact_mode,'AXORA_RELAY'),
      COALESCE(previous.raw_retention_days,30),
      previous.vehicle_type,previous.vehicle_colour,
      previous.vehicle_registration,NEW.assigned_at,NEW.assigned_at
    FROM public.delivery_jobs job
    WHERE job.id=NEW.delivery_job_id
    RETURNING * INTO created;
    INSERT INTO public.delivery_tracking_session_events(
      company_id,delivery_job_id,assignment_id,session_id,event_type,
      actor_user_id,actor_role_assignment_id,reason,occurred_at
    ) VALUES (
      created.company_id,created.delivery_job_id,created.assignment_id,
      created.id,'CREATED',actor_id,actor_assignment_id,
      'Delivery assignment created',NEW.assigned_at
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED') THEN
    final_status:=CASE WHEN NEW.status='COMPLETED' THEN 'ENDED' ELSE 'REVOKED' END;
    SELECT id INTO created.id
    FROM public.delivery_tracking_sessions
    WHERE assignment_id=NEW.id
      AND status IN ('NOT_STARTED','ACTIVE','PAUSED')
    FOR UPDATE;
    IF created.id IS NOT NULL THEN
      PERFORM public.axora_transition_delivery_tracking(
        created.id,final_status,
        CASE NEW.status
          WHEN 'REASSIGNED' THEN 'Delivery assignment was reassigned'
          WHEN 'REJECTED' THEN 'Delivery assignment was declined'
          WHEN 'CANCELLED' THEN 'Delivery assignment was removed'
          ELSE 'Delivery assignment completed'
        END,
        actor_id,actor_assignment_id,COALESCE(NEW.ended_at,now())
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_tracking_job_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  item public.delivery_tracking_sessions%ROWTYPE;
  actor_id uuid;
  actor_assignment_id uuid;
BEGIN
  actor_id:=public.axora_context_user_id();
  actor_assignment_id:=public.axora_context_role_assignment_id();
  IF NEW.status='OUT_FOR_DELIVERY' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT session.* INTO item
    FROM public.delivery_tracking_sessions session
    JOIN public.delivery_job_assignments assignment
      ON assignment.id=session.assignment_id
    WHERE session.delivery_job_id=NEW.id
      AND session.status='NOT_STARTED'
      AND assignment.status IN ('ASSIGNED','ACCEPTED')
      AND assignment.ended_at IS NULL
    ORDER BY assignment.assigned_at DESC
    LIMIT 1
    FOR UPDATE OF session;
    IF item.id IS NULL THEN
      RAISE EXCEPTION 'An active assigned tracking session is required';
    END IF;
    PERFORM public.axora_transition_delivery_tracking(
      item.id,'ACTIVE','Out for delivery started',
      COALESCE(actor_id,item.driver_user_id),
      COALESCE(actor_assignment_id,item.driver_role_assignment_id),
      COALESCE(NEW.status_changed_at,now())
    );
  ELSIF NEW.status IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT * INTO item
    FROM public.delivery_tracking_sessions
    WHERE delivery_job_id=NEW.id
      AND status IN ('NOT_STARTED','ACTIVE','PAUSED')
    ORDER BY created_at DESC,id DESC
    LIMIT 1
    FOR UPDATE;
    IF item.id IS NOT NULL THEN
      PERFORM public.axora_transition_delivery_tracking(
        item.id,'ENDED',
        CASE NEW.status
          WHEN 'COMPLETED' THEN 'Delivery completed'
          WHEN 'CANCELLED' THEN 'Delivery cancelled'
          WHEN 'FAILED' THEN 'Delivery failed'
          ELSE 'Delivery returned'
        END,
        COALESCE(actor_id,item.driver_user_id),
        COALESCE(actor_assignment_id,item.driver_role_assignment_id),
        COALESCE(NEW.status_changed_at,now())
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_configure_delivery_tracking(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_session_id uuid,
  p_destination_latitude numeric,
  p_destination_longitude numeric,
  p_visibility_precision text,
  p_show_vehicle_details boolean,
  p_contact_mode text,
  p_raw_retention_days integer,
  p_vehicle_type text,
  p_vehicle_colour text,
  p_vehicle_registration text,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  item public.delivery_tracking_sessions%ROWTYPE;
  job public.delivery_jobs%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO item
  FROM public.delivery_tracking_sessions
  WHERE id=p_session_id
  FOR UPDATE;
  SELECT * INTO job
  FROM public.delivery_jobs
  WHERE id=item.delivery_job_id
  FOR SHARE;
  IF snapshot IS NULL OR item.id IS NULL OR job.id IS NULL
    OR item.status IN ('ENDED','REVOKED')
    OR NOT EXISTS (
      SELECT 1
      FROM public.delivery_job_assignments assignment
      WHERE assignment.id=item.assignment_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR ((p_destination_latitude IS NULL)<>(p_destination_longitude IS NULL))
    OR (
      p_destination_latitude IS NOT NULL
      AND (
        p_destination_latitude NOT BETWEEN -90 AND 90
        OR p_destination_longitude NOT BETWEEN -180 AND 180
      )
    )
    OR p_visibility_precision NOT IN ('APPROXIMATE','EXACT')
    OR p_contact_mode NOT IN ('AXORA_RELAY','NONE')
    OR p_raw_retention_days NOT BETWEEN 1 AND 90
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR char_length(btrim(COALESCE(p_vehicle_type,'')))>80
    OR char_length(btrim(COALESCE(p_vehicle_colour,'')))>80
    OR char_length(btrim(COALESCE(p_vehicle_registration,'')))>80 THEN
    RAISE EXCEPTION 'The delivery tracking policy is unavailable';
  END IF;

  UPDATE public.delivery_tracking_sessions
  SET destination_latitude=p_destination_latitude,
      destination_longitude=p_destination_longitude,
      visibility_precision=p_visibility_precision,
      show_vehicle_details=p_show_vehicle_details,
      contact_mode=p_contact_mode,
      raw_retention_days=p_raw_retention_days,
      vehicle_type=NULLIF(btrim(COALESCE(p_vehicle_type,'')),''),
      vehicle_colour=NULLIF(btrim(COALESCE(p_vehicle_colour,'')),''),
      vehicle_registration=NULLIF(
        btrim(COALESCE(p_vehicle_registration,'')),''
      ),
      updated_at=p_at
  WHERE id=item.id
  RETURNING * INTO item;

  INSERT INTO public.delivery_tracking_session_events(
    company_id,delivery_job_id,assignment_id,session_id,event_type,
    actor_user_id,actor_role_assignment_id,reason,metadata,occurred_at
  ) VALUES (
    item.company_id,item.delivery_job_id,item.assignment_id,item.id,
    'CONFIGURED',p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
    jsonb_build_object(
      'destinationConfigured',item.destination_latitude IS NOT NULL,
      'visibilityPrecision',item.visibility_precision,
      'showVehicleDetails',item.show_vehicle_details,
      'contactMode',item.contact_mode,
      'rawRetentionDays',item.raw_retention_days
    ),p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_tracking_sessions',item.id,'CONFIGURE',p_actor_user_id,
    item.company_id,job.request_id,p_reason,
    jsonb_build_object(
      'destinationConfigured',item.destination_latitude IS NOT NULL,
      'visibilityPrecision',item.visibility_precision,
      'rawRetentionDays',item.raw_retention_days
    )
  );
  RETURN jsonb_build_object(
    'sessionId',item.id,'status',item.status,
    'destinationConfigured',item.destination_latitude IS NOT NULL,
    'visibilityPrecision',item.visibility_precision,
    'rawRetentionDays',item.raw_retention_days
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_purge_expired_delivery_locations(
  p_cutoff timestamptz DEFAULT now(),
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  point_ids uuid[];
  session_ids uuid[];
  purged integer:=0;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'The retention batch is invalid';
  END IF;
  SELECT array_agg(id),array_agg(DISTINCT session_id),count(*)::integer
    INTO point_ids,session_ids,purged
  FROM (
    SELECT id,session_id
    FROM public.delivery_tracking_points
    WHERE retention_until<=p_cutoff
    ORDER BY retention_until,id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) expired;
  IF purged=0 THEN RETURN 0; END IF;
  PERFORM set_config('axora.tracking_retention_cutoff',p_cutoff::text,true);
  DELETE FROM public.delivery_tracking_points
  WHERE id=ANY(point_ids);
  INSERT INTO public.delivery_tracking_session_events(
    company_id,delivery_job_id,assignment_id,session_id,event_type,
    reason,metadata,occurred_at
  )
  SELECT
    session.company_id,session.delivery_job_id,session.assignment_id,
    session.id,'RETENTION_PURGED',
    'Expired raw coordinates purged by retention policy',
    jsonb_build_object('purgedBefore',p_cutoff),p_cutoff
  FROM public.delivery_tracking_sessions session
  WHERE session.id=ANY(session_ids);
  RETURN purged;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_record_delivery_location(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_session_id uuid,
  p_client_point_id uuid,
  p_device_id uuid,
  p_device_sequence bigint,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_speed_mps numeric,
  p_heading_degrees numeric,
  p_recorded_at timestamptz,
  p_received_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  session public.delivery_tracking_sessions%ROWTYPE;
  previous public.delivery_tracking_points%ROWTYPE;
  existing public.delivery_tracking_points%ROWTYPE;
  travelled numeric:=0;
  elapsed_seconds numeric;
  accepted_id uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO existing
  FROM public.delivery_tracking_points
  WHERE session_id=p_session_id AND client_point_id=p_client_point_id;
  IF existing.id IS NOT NULL THEN
    IF existing.device_id<>p_device_id
      OR existing.device_sequence<>p_device_sequence
      OR existing.latitude<>p_latitude
      OR existing.longitude<>p_longitude
      OR existing.accuracy_meters<>p_accuracy_meters
      OR existing.speed_mps IS DISTINCT FROM p_speed_mps
      OR existing.heading_degrees IS DISTINCT FROM p_heading_degrees
      OR existing.recorded_at<>p_recorded_at THEN
      RAISE EXCEPTION 'The delivery location is unavailable';
    END IF;
    RETURN jsonb_build_object(
      'pointId',existing.id,'sessionId',existing.session_id,
      'acceptedAt',existing.received_at,'replayed',true
    );
  END IF;

  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_received_at
  );
  SELECT * INTO session
  FROM public.delivery_tracking_sessions
  WHERE id=p_session_id
  FOR UPDATE;
  IF snapshot IS NULL OR session.id IS NULL OR session.status<>'ACTIVE'
    OR session.driver_user_id<>p_actor_user_id
    OR session.driver_role_assignment_id<>p_actor_role_assignment_id
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.track','DELIVERY',NULL,NULL,NULL,NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.delivery_job_assignments assignment
      JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
      WHERE assignment.id=session.assignment_id
        AND assignment.driver_user_id=p_actor_user_id
        AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
        AND job.status IN (
          'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
        )
    )
    OR p_device_sequence<0
    OR p_latitude NOT BETWEEN -90 AND 90
    OR p_longitude NOT BETWEEN -180 AND 180
    OR p_accuracy_meters<=0 OR p_accuracy_meters>2000
    OR (p_speed_mps IS NOT NULL AND p_speed_mps NOT BETWEEN 0 AND 100)
    OR (
      p_heading_degrees IS NOT NULL
      AND p_heading_degrees NOT BETWEEN 0 AND 360
    )
    OR p_recorded_at>p_received_at+interval '5 minutes'
    OR p_recorded_at<session.started_at-interval '1 minute'
    OR p_recorded_at<p_received_at-interval '24 hours' THEN
    RAISE EXCEPTION 'The delivery location is unavailable';
  END IF;

  SELECT * INTO previous
  FROM public.delivery_tracking_points
  WHERE session_id=session.id
  ORDER BY recorded_at DESC,id DESC
  LIMIT 1
  FOR SHARE;
  IF previous.id IS NOT NULL THEN
    IF p_recorded_at<=previous.recorded_at THEN
      RAISE EXCEPTION 'The delivery location is out of order';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.delivery_tracking_points point
      WHERE point.session_id=session.id
        AND point.device_id=p_device_id
        AND point.device_sequence>=p_device_sequence
    ) THEN
      RAISE EXCEPTION 'The delivery location is out of order';
    END IF;
    travelled:=public.axora_delivery_distance_meters(
      previous.latitude,previous.longitude,p_latitude,p_longitude
    );
    elapsed_seconds:=extract(epoch FROM p_recorded_at-previous.recorded_at);
    IF travelled>greatest(
        2000::numeric,
        (previous.accuracy_meters+p_accuracy_meters)*2
      )
      AND travelled/greatest(elapsed_seconds,1)>70 THEN
      RAISE EXCEPTION 'The delivery location failed movement validation';
    END IF;
  END IF;

  INSERT INTO public.delivery_tracking_points(
    id,company_id,session_id,assignment_id,client_point_id,device_id,
    device_sequence,latitude,longitude,accuracy_meters,speed_mps,
    heading_degrees,recorded_at,received_at,retention_until
  ) VALUES (
    accepted_id,session.company_id,session.id,session.assignment_id,
    p_client_point_id,p_device_id,p_device_sequence,p_latitude,p_longitude,
    p_accuracy_meters,p_speed_mps,p_heading_degrees,p_recorded_at,p_received_at,
    p_received_at+make_interval(days=>session.raw_retention_days)
  );
  UPDATE public.delivery_tracking_sessions
  SET point_count=point_count+1,
      distance_meters=distance_meters+travelled,
      last_point_at=p_recorded_at,
      last_failure_code=NULL,
      last_failure_at=NULL,
      updated_at=p_received_at
  WHERE id=session.id;
  PERFORM public.axora_purge_expired_delivery_locations(p_received_at,500);
  RETURN jsonb_build_object(
    'pointId',accepted_id,'sessionId',session.id,
    'acceptedAt',p_received_at,'replayed',false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_control_delivery_tracking(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_session_id uuid,
  p_operation text,
  p_reason text,
  p_failure_code text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  item public.delivery_tracking_sessions%ROWTYPE;
  job public.delivery_jobs%ROWTYPE;
  manager_allowed boolean;
  driver_allowed boolean;
  next_status text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO item
  FROM public.delivery_tracking_sessions
  WHERE id=p_session_id
  FOR UPDATE;
  SELECT * INTO job
  FROM public.delivery_jobs
  WHERE id=item.delivery_job_id
  FOR SHARE;
  manager_allowed:=snapshot IS NOT NULL AND public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  );
  driver_allowed:=snapshot IS NOT NULL
    AND item.driver_user_id=p_actor_user_id
    AND item.driver_role_assignment_id=p_actor_role_assignment_id
    AND public.axora_snapshot_has_permission(
      snapshot,'delivery.track','DELIVERY',NULL,NULL,NULL,NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.delivery_job_assignments assignment
      WHERE assignment.id=item.assignment_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
    );
  IF item.id IS NULL OR job.id IS NULL
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_operation NOT IN ('PAUSE','RESUME','END','REPORT_FAILURE')
    OR (
      p_operation IN ('PAUSE','RESUME')
      AND NOT manager_allowed
    )
    OR (
      p_operation IN ('END','REPORT_FAILURE')
      AND NOT (manager_allowed OR driver_allowed)
    ) THEN
    RAISE EXCEPTION 'The delivery tracking command is unavailable';
  END IF;

  IF p_operation='REPORT_FAILURE' THEN
    IF item.status NOT IN ('ACTIVE','PAUSED')
      OR p_failure_code NOT IN (
        'PERMISSION_DENIED','LOCATION_UNAVAILABLE','LOCATION_TIMEOUT',
        'BATTERY_RESTRICTED','OFFLINE'
      ) THEN
      RAISE EXCEPTION 'The delivery tracking command is unavailable';
    END IF;
    UPDATE public.delivery_tracking_sessions
    SET last_failure_code=p_failure_code,last_failure_at=p_at,updated_at=p_at
    WHERE id=item.id;
    INSERT INTO public.delivery_tracking_session_events(
      company_id,delivery_job_id,assignment_id,session_id,event_type,
      actor_user_id,actor_role_assignment_id,reason,metadata,occurred_at
    ) VALUES (
      item.company_id,item.delivery_job_id,item.assignment_id,item.id,
      CASE WHEN p_failure_code='PERMISSION_DENIED'
        THEN 'PERMISSION_DENIED' ELSE 'LOCATION_UNAVAILABLE' END,
      p_actor_user_id,p_actor_role_assignment_id,btrim(p_reason),
      jsonb_build_object('failureCode',p_failure_code),p_at
    );
    RETURN jsonb_build_object(
      'sessionId',item.id,'status',item.status,'failureCode',p_failure_code
    );
  END IF;

  next_status:=CASE p_operation
    WHEN 'PAUSE' THEN 'PAUSED'
    WHEN 'RESUME' THEN 'ACTIVE'
    ELSE 'ENDED'
  END;
  item:=public.axora_transition_delivery_tracking(
    item.id,next_status,p_reason,p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_tracking_sessions',item.id,p_operation,p_actor_user_id,
    item.company_id,job.request_id,p_reason,
    jsonb_build_object('status',item.status,'pointCount',item.point_count)
  );
  RETURN jsonb_build_object(
    'sessionId',item.id,'status',item.status,'updatedAt',item.updated_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_driver_delivery_tracking_workspace(
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
    snapshot,'delivery.track','DELIVERY',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'actorId',p_actor_user_id,'capturedAt',p_at,
    'sessions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sessionId',session.id,'jobId',job.id,'jobCode',job.job_code,
        'assignmentId',session.assignment_id,'jobStatus',job.status,
        'status',session.status,'startedAt',session.started_at,
        'pausedAt',session.paused_at,'lastUpdatedAt',session.last_point_at,
        'pointCount',session.point_count,
        'destinationLatitude',session.destination_latitude,
        'destinationLongitude',session.destination_longitude,
        'visibilityPrecision',session.visibility_precision,
        'rawRetentionDays',session.raw_retention_days,
        'lastFailureCode',session.last_failure_code,
        'lastFailureAt',session.last_failure_at
      ) ORDER BY assignment.assigned_at DESC)
      FROM public.delivery_tracking_sessions session
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=session.assignment_id
      JOIN public.delivery_jobs job ON job.id=session.delivery_job_id
      WHERE session.driver_user_id=p_actor_user_id
        AND session.driver_role_assignment_id=p_actor_role_assignment_id
        AND session.status IN ('NOT_STARTED','ACTIVE','PAUSED')
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
        AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_supervisor_delivery_tracking_workspace(
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
    'sessions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sessionId',session.id,'jobId',job.id,'jobCode',job.job_code,
        'companyName',company.name,'branchName',branch.name,
        'assignmentId',session.assignment_id,'jobStatus',job.status,
        'status',session.status,'startedAt',session.started_at,
        'pausedAt',session.paused_at,'lastUpdatedAt',point.recorded_at,
        'stale',point.recorded_at IS NULL
          OR point.recorded_at<p_at-interval '2 minutes',
        'latitude',point.latitude,'longitude',point.longitude,
        'accuracyMeters',point.accuracy_meters,
        'destinationLatitude',session.destination_latitude,
        'destinationLongitude',session.destination_longitude,
        'remainingMeters',route.remaining_meters,
        'etaSeconds',CASE
          WHEN point.recorded_at IS NULL
            OR point.recorded_at<p_at-interval '2 minutes'
            OR route.remaining_meters IS NULL THEN NULL
          ELSE ceil(route.remaining_meters/greatest(
            CASE WHEN point.speed_mps BETWEEN 1 AND 50
              THEN point.speed_mps ELSE 8.33 END,1
          ))::integer
        END,
        'visibilityPrecision',session.visibility_precision,
        'showVehicleDetails',session.show_vehicle_details,
        'contactMode',session.contact_mode,
        'rawRetentionDays',session.raw_retention_days,
        'vehicleType',session.vehicle_type,
        'vehicleColour',session.vehicle_colour,
        'vehicleRegistration',session.vehicle_registration,
        'agentUserId',session.driver_user_id,'agentName',driver.display_name,
        'lastFailureCode',session.last_failure_code,
        'lastFailureAt',session.last_failure_at
      ) ORDER BY assignment.assigned_at DESC)
      FROM public.delivery_tracking_sessions session
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=session.assignment_id
      JOIN public.delivery_jobs job ON job.id=session.delivery_job_id
      JOIN public.companies company ON company.id=session.company_id
      JOIN public.branches branch ON branch.id=session.branch_id
      JOIN public.users driver ON driver.id=session.driver_user_id
      LEFT JOIN LATERAL (
        SELECT location.*
        FROM public.delivery_tracking_points location
        WHERE location.session_id=session.id
          AND location.retention_until>p_at
        ORDER BY location.recorded_at DESC,location.id DESC
        LIMIT 1
      ) point ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN point.id IS NULL OR session.destination_latitude IS NULL
            THEN NULL
          ELSE public.axora_delivery_distance_meters(
            point.latitude,point.longitude,
            session.destination_latitude,session.destination_longitude
          )
        END AS remaining_meters
      ) route ON true
      WHERE session.status IN ('NOT_STARTED','ACTIVE','PAUSED')
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
        AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_company_delivery_tracking_workspace(
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
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'sessions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sessionId',session.id,'jobId',job.id,'jobCode',job.job_code,
        'branchName',branch.name,'jobStatus',job.status,
        'status',session.status,'startedAt',session.started_at,
        'lastUpdatedAt',point.recorded_at,
        'stale',point.recorded_at IS NULL
          OR point.recorded_at<p_at-interval '2 minutes',
        'latitude',CASE session.visibility_precision
          WHEN 'APPROXIMATE' THEN round(point.latitude,3)
          ELSE point.latitude END,
        'longitude',CASE session.visibility_precision
          WHEN 'APPROXIMATE' THEN round(point.longitude,3)
          ELSE point.longitude END,
        'accuracyMeters',CASE session.visibility_precision
          WHEN 'APPROXIMATE' THEN greatest(point.accuracy_meters,150)
          ELSE point.accuracy_meters END,
        'destinationLatitude',CASE session.visibility_precision
          WHEN 'APPROXIMATE' THEN round(session.destination_latitude,3)
          ELSE session.destination_latitude END,
        'destinationLongitude',CASE session.visibility_precision
          WHEN 'APPROXIMATE' THEN round(session.destination_longitude,3)
          ELSE session.destination_longitude END,
        'remainingMeters',route.remaining_meters,
        'etaSeconds',CASE
          WHEN point.recorded_at IS NULL
            OR point.recorded_at<p_at-interval '2 minutes'
            OR route.remaining_meters IS NULL THEN NULL
          ELSE ceil(route.remaining_meters/greatest(
            CASE WHEN point.speed_mps BETWEEN 1 AND 50
              THEN point.speed_mps ELSE 8.33 END,1
          ))::integer
        END,
        'routeMode','PRIVACY_SAFE_ESTIMATE',
        'visibilityPrecision',session.visibility_precision,
        'agentUserId',session.driver_user_id,'agentName',driver.display_name,
        'contactMode',session.contact_mode,
        'contactPath',CASE session.contact_mode
          WHEN 'AXORA_RELAY' THEN '/support?delivery='||job.id::text
          ELSE NULL END,
        'vehicleType',CASE WHEN session.show_vehicle_details
          THEN session.vehicle_type END,
        'vehicleColour',CASE WHEN session.show_vehicle_details
          THEN session.vehicle_colour END,
        'vehicleRegistration',CASE WHEN session.show_vehicle_details
          THEN session.vehicle_registration END
      ) ORDER BY job.scheduled_window_start,job.id)
      FROM public.delivery_tracking_sessions session
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=session.assignment_id
      JOIN public.delivery_jobs job ON job.id=session.delivery_job_id
      JOIN public.branches branch ON branch.id=session.branch_id
      JOIN public.users driver ON driver.id=session.driver_user_id
      LEFT JOIN LATERAL (
        SELECT location.*
        FROM public.delivery_tracking_points location
        WHERE location.session_id=session.id
          AND location.retention_until>p_at
        ORDER BY location.recorded_at DESC,location.id DESC
        LIMIT 1
      ) point ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN point.id IS NULL OR session.destination_latitude IS NULL
            THEN NULL
          ELSE public.axora_delivery_distance_meters(
            point.latitude,point.longitude,
            session.destination_latitude,session.destination_longitude
          )
        END AS remaining_meters
      ) route ON true
      WHERE session.status IN ('ACTIVE','PAUSED')
        AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND assignment.ended_at IS NULL
        AND job.status IN (
          'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
        )
        AND public.axora_snapshot_has_permission(
          snapshot,'receiving.confirm','BRANCH',
          session.company_id,session.branch_id,NULL,NULL
        )
        AND public.axora_user_can_receive(
          p_actor_user_id,session.company_id,session.branch_id
        )
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_tracking_history(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  snapshot jsonb;
  job public.delivery_jobs%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO job
  FROM public.delivery_jobs
  WHERE id=p_delivery_job_id;
  IF snapshot IS NULL OR job.id IS NULL OR NOT (
    public.axora_snapshot_has_permission(
      snapshot,'delivery.tracking.history','PLATFORM',
      NULL,NULL,NULL,NULL
    )
    OR public.axora_snapshot_has_permission(
      snapshot,'delivery.tracking.history','COMPANY',
      job.company_id,NULL,NULL,NULL
    )
    OR public.axora_snapshot_has_permission(
      snapshot,'delivery.tracking.history','BRANCH',
      job.company_id,job.branch_id,NULL,NULL
    )
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'jobId',job.id,
    'sessions',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sessionId',session.id,'status',session.status,
        'startedAt',session.started_at,'endedAt',session.ended_at,
        'startReason',session.start_reason,'endReason',session.end_reason,
        'pointCount',session.point_count,
        'distanceMeters',session.distance_meters,
        'points',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'recordedAt',point.recorded_at,
            'latitude',point.latitude,'longitude',point.longitude,
            'accuracyMeters',point.accuracy_meters
          ) ORDER BY point.recorded_at,point.id)
          FROM public.delivery_tracking_points point
          WHERE point.session_id=session.id
            AND point.retention_until>p_at
        ),'[]'::jsonb)
      ) ORDER BY session.created_at,session.id)
      FROM public.delivery_tracking_sessions session
      WHERE session.delivery_job_id=job.id
    ),'[]'::jsonb)
  );
END
$$;

-- Preserve current assignments. If legacy data contains several deliveries
-- already in transit for one driver, only the newest remains active and the
-- others require an explicit supervisor resume.
WITH candidates AS (
  SELECT
    assignment.*,job.branch_id,job.status AS job_status,
    job.status_changed_at,
    row_number() OVER (
      PARTITION BY assignment.driver_user_id
      ORDER BY job.status_changed_at DESC,assignment.assigned_at DESC
    ) AS active_rank
  FROM public.delivery_job_assignments assignment
  JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
  WHERE assignment.status IN ('ASSIGNED','ACCEPTED')
    AND assignment.ended_at IS NULL
    AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
)
INSERT INTO public.delivery_tracking_sessions(
  company_id,branch_id,delivery_job_id,assignment_id,driver_user_id,
  driver_role_assignment_id,status,start_reason,started_at,paused_at,
  last_failure_code,last_failure_at,created_at,updated_at
)
SELECT
  candidate.company_id,candidate.branch_id,candidate.delivery_job_id,
  candidate.id,candidate.driver_user_id,candidate.driver_role_assignment_id,
  CASE
    WHEN candidate.job_status IN (
      'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
    ) AND candidate.active_rank=1 THEN 'ACTIVE'
    WHEN candidate.job_status IN (
      'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
    ) THEN 'PAUSED'
    ELSE 'NOT_STARTED'
  END,
  CASE WHEN candidate.job_status IN (
    'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
  ) THEN 'Existing in-transit assignment preserved' END,
  CASE WHEN candidate.job_status IN (
    'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
  ) THEN candidate.status_changed_at END,
  CASE WHEN candidate.job_status IN (
    'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
  ) AND candidate.active_rank>1 THEN now() END,
  CASE WHEN candidate.job_status IN (
    'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
  ) AND candidate.active_rank>1 THEN 'MULTIPLE_ACTIVE_DELIVERIES_REVIEW' END,
  CASE WHEN candidate.job_status IN (
    'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
  ) AND candidate.active_rank>1 THEN now() END,
  candidate.assigned_at,now()
FROM candidates candidate
ON CONFLICT(assignment_id) DO NOTHING;

INSERT INTO public.delivery_tracking_session_events(
  company_id,delivery_job_id,assignment_id,session_id,event_type,
  actor_user_id,actor_role_assignment_id,reason,metadata,occurred_at
)
SELECT
  session.company_id,session.delivery_job_id,session.assignment_id,session.id,
  'CREATED',assignment.assigned_by,assignment.supervisor_role_assignment_id,
  'Existing delivery assignment preserved',
  jsonb_build_object('migration','068'),session.created_at
FROM public.delivery_tracking_sessions session
JOIN public.delivery_job_assignments assignment
  ON assignment.id=session.assignment_id;

INSERT INTO public.delivery_tracking_session_events(
  company_id,delivery_job_id,assignment_id,session_id,event_type,
  actor_user_id,actor_role_assignment_id,reason,metadata,occurred_at
)
SELECT
  session.company_id,session.delivery_job_id,session.assignment_id,session.id,
  CASE session.status WHEN 'ACTIVE' THEN 'STARTED' ELSE 'PAUSED' END,
  assignment.driver_user_id,assignment.driver_role_assignment_id,
  CASE session.status
    WHEN 'ACTIVE' THEN 'Existing in-transit tracking preserved'
    ELSE 'Concurrent legacy tracking paused for supervisor review'
  END,
  jsonb_build_object('migration','068'),COALESCE(session.started_at,now())
FROM public.delivery_tracking_sessions session
JOIN public.delivery_job_assignments assignment
  ON assignment.id=session.assignment_id
WHERE session.status IN ('ACTIVE','PAUSED');

CREATE UNIQUE INDEX delivery_tracking_one_active_driver_idx
  ON public.delivery_tracking_sessions(driver_user_id)
  WHERE status='ACTIVE';

CREATE TRIGGER delivery_tracking_assignment_lifecycle
  AFTER INSERT OR UPDATE OF status,ended_at
  ON public.delivery_job_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.axora_delivery_tracking_assignment_lifecycle();

CREATE TRIGGER delivery_tracking_job_lifecycle
  AFTER UPDATE OF status
  ON public.delivery_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.axora_delivery_tracking_job_lifecycle();

CREATE TRIGGER delivery_tracking_points_immutable
  BEFORE UPDATE OR DELETE ON public.delivery_tracking_points
  FOR EACH ROW
  EXECUTE FUNCTION public.axora_reject_tracking_point_mutation();
CREATE TRIGGER delivery_tracking_events_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_tracking_session_events
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_tracking_summaries_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_tracking_route_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_tracking_points_audit
  AFTER INSERT ON public.delivery_tracking_points
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_tracking_events_audit
  AFTER INSERT ON public.delivery_tracking_session_events
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_change();

ALTER TABLE public.delivery_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_session_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_points FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_route_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_route_summaries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.delivery_tracking_sessions FROM PUBLIC;
REVOKE ALL ON public.delivery_tracking_session_events FROM PUBLIC;
REVOKE ALL ON public.delivery_tracking_points FROM PUBLIC;
REVOKE ALL ON public.delivery_tracking_route_summaries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_distance_meters(
  numeric,numeric,numeric,numeric
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_transition_delivery_tracking(
  uuid,text,text,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_configure_delivery_tracking(
  uuid,uuid,uuid,numeric,numeric,text,boolean,text,integer,
  text,text,text,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_purge_expired_delivery_locations(
  timestamptz,integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_record_delivery_location(
  uuid,uuid,uuid,uuid,uuid,bigint,numeric,numeric,numeric,numeric,
  numeric,timestamptz,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_control_delivery_tracking(
  uuid,uuid,uuid,text,text,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_supervisor_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_tracking_history(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON public.delivery_tracking_sessions FROM axora_app';
    EXECUTE 'REVOKE ALL ON public.delivery_tracking_session_events FROM axora_app';
    EXECUTE 'REVOKE ALL ON public.delivery_tracking_points FROM axora_app';
    EXECUTE 'REVOKE ALL ON public.delivery_tracking_route_summaries FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_configure_delivery_tracking(uuid,uuid,uuid,numeric,numeric,text,boolean,text,integer,text,text,text,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_record_delivery_location(uuid,uuid,uuid,uuid,uuid,bigint,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_control_delivery_tracking(uuid,uuid,uuid,text,text,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_driver_delivery_tracking_workspace(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_supervisor_delivery_tracking_workspace(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_company_delivery_tracking_workspace(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_delivery_tracking_history(uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;
END
$axora_runtime_role$;

COMMIT;
