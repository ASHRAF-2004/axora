BEGIN;

-- Delivery accounts are operational identities. They must not inherit the
-- procurement dashboard or receive it through a future explicit grant.
UPDATE public.roles
SET label='Delivery Agent',
    description='Acquires requested items and completes only assigned deliveries'
WHERE role_key IN ('DELIVERY_GUY','DELIVERY_AGENT','DELIVERY_DRIVER');

DELETE FROM public.role_permissions role_permission
USING public.roles role,public.permissions permission
WHERE role_permission.role_id=role.id
  AND role_permission.permission_id=permission.id
  AND role.role_key IN ('DELIVERY_GUY','DELIVERY_AGENT','DELIVERY_DRIVER')
  AND permission.permission_code='dashboard.view';

CREATE OR REPLACE FUNCTION public.axora_permission_allowed_for_account_kind(
  p_account_kind text,p_permission_code text
)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE p_account_kind
    WHEN 'COMPANY' THEN NOT (
      position('platform.' IN p_permission_code)=1
      OR position('platform_user.' IN p_permission_code)=1
      OR position('delivery_user.' IN p_permission_code)=1
      OR position('supplier.' IN p_permission_code)=1
      OR position('email.operations.' IN p_permission_code)=1
      OR position('system.diagnostics.' IN p_permission_code)=1
      OR position('commercial.cost.' IN p_permission_code)=1
      OR position('commercial.markup.' IN p_permission_code)=1
      OR position('commercial.platform_margin.' IN p_permission_code)=1
      OR position('commercial.pricing.' IN p_permission_code)=1
      OR position('analytics.platform.' IN p_permission_code)=1
      OR p_permission_code IN (
        'company.create','company.view.all','company.lead.view',
        'company.lead.create','company.lead.assign','company.lead.reassign',
        'company.activate','company.suspend','company.portal.publish',
        'catalog.manage','product.manage','product.archive','category.manage',
        'analytics.revenue.view','finance.manage','finance.match.review',
        'finance.wallet.top_up.record','commercial.company_ceiling.override',
        'delivery.manage','delivery.assign',
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update'
      )
    )
    WHEN 'DELIVERY' THEN p_permission_code IN (
      'delivery.view','delivery.claim','delivery.accept',
      'delivery.shop','delivery.receipt.upload','delivery.track',
      'delivery.complete','delivery.portal.view','delivery.assignment.update',
      'document.view','document.download'
    )
    WHEN 'SUPPLIER' THEN p_permission_code='dashboard.view'
      OR position('supplier.' IN p_permission_code)=1
      OR p_permission_code IN ('document.view','document.download')
    WHEN 'PLATFORM' THEN position('supplier.' IN p_permission_code)<>1
      AND p_permission_code<>'procurement.direct_purchase'
      AND p_permission_code NOT IN (
        'delivery.claim','delivery.accept','delivery.shop',
        'delivery.receipt.upload','delivery.track','delivery.complete',
        'delivery.portal.view','delivery.assignment.update'
      )
    ELSE false
  END
$$;

-- Availability controls admission to the shared pool, not the visibility of
-- the driver's already-assigned work. An unavailable driver therefore gets a
-- valid empty pool instead of a failed workspace read.
CREATE OR REPLACE FUNCTION public.axora_driver_available_jobs(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; availability_value text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT profile.availability_status INTO availability_value
  FROM public.delivery_agent_profiles profile
  JOIN public.users account ON account.id=profile.user_id
  WHERE profile.user_id=p_actor_user_id
    AND profile.active AND account.active
    AND account.account_status='ACTIVE';
  IF snapshot IS NULL OR availability_value IS NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL
    )
  THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'sequence',(extract(epoch FROM p_at)*1000)::bigint,
    'capturedAt',p_at,
    'availability',availability_value,
    'jobs',CASE WHEN availability_value<>'AVAILABLE' THEN '[]'::jsonb
      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',job.id,'code',job.job_code,'requestReference',request.order_code,
        'companyName',company.name,'branchName',branch.name,
        'area',COALESCE(branch.city,''),'destinationTimezone',job.destination_timezone,
        'scheduledStart',job.scheduled_window_start,'scheduledEnd',job.scheduled_window_end,
        'lineCount',(SELECT count(*) FROM public.delivery_job_lines line
          WHERE line.delivery_job_id=job.id),
        'status','AVAILABLE'
      ) ORDER BY job.created_at,job.id)
      FROM public.delivery_jobs job
      JOIN public.requests request ON request.id=job.request_id
      JOIN public.companies company ON company.id=job.company_id
      JOIN public.branches branch ON branch.id=job.branch_id
      WHERE job.status='AWAITING_ASSIGNMENT'
        AND EXISTS (
          SELECT 1 FROM public.invoices invoice
          JOIN public.payments payment ON payment.invoice_id=invoice.id
          WHERE invoice.request_id=job.request_id
            AND invoice.lifecycle_status='FINALIZED'
            AND payment.payment_status='PAID'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_job_assignments assignment
          WHERE assignment.delivery_job_id=job.id
            AND assignment.status IN ('ASSIGNED','ACCEPTED')
            AND assignment.ended_at IS NULL
        )),'[]'::jsonb) END
  );
END
$$;

-- A response can be lost after the atomic claim commits. This read-only
-- command projection lets the same actor reconcile that exact command without
-- issuing the mutation again or inspecting another driver's assignment.
CREATE OR REPLACE FUNCTION public.axora_driver_claim_result(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'assignmentId',assignment.id,
    'jobId',assignment.delivery_job_id,
    'status','ASSIGNED',
    'created',false
  ) INTO result
  FROM public.delivery_job_assignments assignment
  WHERE assignment.delivery_job_id=p_delivery_job_id
    AND assignment.command_id=p_command_id
    AND assignment.driver_user_id=p_actor_user_id
    AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
    AND assignment.assigned_by=p_actor_user_id;
  RETURN result;
END
$$;

-- Delivery workflow commands, paid-safe acquisitions and proof uploads already
-- carry actor-owned idempotency keys. Expose only the result of the caller's
-- exact command so a lost HTTP response can be reconciled without replaying a
-- mutation or granting table access.
CREATE OR REPLACE FUNCTION public.axora_driver_delivery_command_result(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_command_kind text,
  p_command_id uuid,
  p_related_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL
    OR p_command_kind NOT IN ('EVENT','ACQUISITION','EVIDENCE','OTP')
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.portal.view','DELIVERY',NULL,NULL,NULL,NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.delivery_job_assignments assignment
      WHERE assignment.delivery_job_id=p_delivery_job_id
        AND assignment.driver_user_id=p_actor_user_id
        AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
    )
  THEN RETURN NULL; END IF;

  IF p_command_kind='EVENT' THEN
    SELECT command.result INTO result
    FROM public.delivery_workflow_commands command
    WHERE command.delivery_job_id=p_delivery_job_id
      AND command.actor_user_id=p_actor_user_id
      AND command.actor_role_assignment_id=p_actor_role_assignment_id
      AND command.command_id=p_command_id
      AND command.command_type LIKE 'EVENT:%'
      AND command.status='COMPLETED';
  ELSIF p_command_kind='ACQUISITION' THEN
    SELECT jsonb_build_object(
      'registration',jsonb_build_object(
        'submissionId',submission.id,
        'jobId',submission.delivery_job_id,
        'workflowVersion',submission.expected_workflow_version,
        'created',false,
        'unavailableLines',(SELECT count(*) FROM public.delivery_acquisition_lines line
          WHERE line.submission_id=submission.id AND line.resolution='UNAVAILABLE')
      ),
      'event',command.result
    ) INTO result
    FROM public.delivery_acquisition_submissions submission
    JOIN public.delivery_workflow_commands command
      ON command.actor_user_id=submission.driver_user_id
     AND command.actor_role_assignment_id=submission.driver_role_assignment_id
     AND command.delivery_job_id=submission.delivery_job_id
     AND command.command_id=submission.event_command_id
     AND command.command_type IN ('EVENT:ITEMS_ACQUIRED','EVENT:ISSUE_REPORTED')
     AND command.status='COMPLETED'
    WHERE submission.delivery_job_id=p_delivery_job_id
      AND submission.driver_user_id=p_actor_user_id
      AND submission.driver_role_assignment_id=p_actor_role_assignment_id
      AND submission.command_id=p_command_id
      AND submission.event_command_id=p_related_command_id;
  ELSIF p_command_kind='EVIDENCE' THEN
    SELECT jsonb_build_object(
      'evidenceId',evidence.id,
      'version',evidence.evidence_version,
      'validationStatus',evidence.validation_status,
      'created',false
    ) INTO result
    FROM public.delivery_evidence evidence
    WHERE evidence.delivery_job_id=p_delivery_job_id
      AND evidence.driver_user_id=p_actor_user_id
      AND evidence.client_evidence_id=p_command_id;
  ELSE
    SELECT command.result INTO result
    FROM public.delivery_workflow_commands command
    WHERE command.delivery_job_id=p_delivery_job_id
      AND command.actor_user_id=p_actor_user_id
      AND command.actor_role_assignment_id=p_actor_role_assignment_id
      AND command.command_id=p_command_id
      AND command.command_type='OTP_VERIFY'
      AND command.status='COMPLETED';
  END IF;
  RETURN result;
END
$$;

-- OTP attempts previously had no command id, so a lost response could make a
-- safe client retry consume another attempt. Keep the canonical verifier and
-- wrap it in the existing delivery command ledger.
CREATE OR REPLACE FUNCTION public.axora_verify_delivery_otp_command(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_challenge_id uuid,
  p_code_hash text,
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE;
  assignment public.delivery_job_assignments%ROWTYPE; command_row record;
  payload_hash text; verified boolean; result jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO job FROM public.delivery_jobs
  WHERE id=p_delivery_job_id FOR SHARE;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=p_delivery_job_id
    AND driver_user_id=p_actor_user_id
    AND driver_role_assignment_id=p_actor_role_assignment_id
    AND status IN ('ASSIGNED','ACCEPTED')
    AND ended_at IS NULL FOR SHARE;
  IF snapshot IS NULL OR job.id IS NULL OR assignment.id IS NULL
    OR p_code_hash !~ '^[0-9a-f]{64}$'
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.complete','DELIVERY',NULL,NULL,NULL,NULL
    )
  THEN RAISE EXCEPTION 'The delivery confirmation is unavailable'; END IF;
  payload_hash:=encode(pg_catalog.sha256(convert_to(concat_ws('|',
    p_delivery_job_id,p_challenge_id,p_code_hash),'UTF8')),'hex');
  SELECT * INTO command_row FROM public.axora_begin_delivery_command(
    job.company_id,job.id,p_actor_user_id,p_actor_role_assignment_id,
    p_command_id,'OTP_VERIFY',payload_hash,p_at
  );
  IF NOT command_row.is_new THEN RETURN command_row.replay_result; END IF;
  verified:=public.axora_verify_delivery_otp(
    p_actor_user_id,p_actor_role_assignment_id,p_delivery_job_id,
    p_challenge_id,p_code_hash,p_at
  );
  result:=jsonb_build_object(
    'jobId',job.id,'challengeId',p_challenge_id,'verified',verified
  );
  PERFORM public.axora_complete_delivery_command(
    command_row.command_row_id,result,p_at
  );
  RETURN result;
END
$$;

-- Drivers may pause and resume their own active collection after explicit
-- browser consent. END remains an operational/terminal command so pausing can
-- never strand an otherwise active delivery.
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
  SELECT * INTO item FROM public.delivery_tracking_sessions
  WHERE id=p_session_id FOR UPDATE;
  SELECT * INTO job FROM public.delivery_jobs
  WHERE id=item.delivery_job_id FOR SHARE;
  manager_allowed:=snapshot IS NOT NULL AND public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  );
  driver_allowed:=snapshot IS NOT NULL
    AND item.driver_user_id=p_actor_user_id
    AND item.driver_role_assignment_id=p_actor_role_assignment_id
    AND public.axora_snapshot_has_permission(
      snapshot,'delivery.track','DELIVERY',NULL,NULL,NULL,NULL
    )
    AND job.status IN (
      'OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED'
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
    OR (p_operation IN ('PAUSE','RESUME','REPORT_FAILURE')
      AND NOT (manager_allowed OR driver_allowed))
    OR (p_operation='END' AND NOT manager_allowed)
  THEN RAISE EXCEPTION 'The delivery tracking command is unavailable'; END IF;

  IF p_operation='REPORT_FAILURE' THEN
    IF item.status NOT IN ('ACTIVE','PAUSED')
      OR p_failure_code NOT IN (
        'PERMISSION_DENIED','LOCATION_UNAVAILABLE','LOCATION_TIMEOUT',
        'BATTERY_RESTRICTED','OFFLINE'
      )
    THEN RAISE EXCEPTION 'The delivery tracking command is unavailable'; END IF;
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

-- The driver's own operational projection carries the newest accepted point
-- and a clearly direct (not road-routed) distance/ETA estimate.
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
        'companyName',company.name,'branchName',branch.name,
        'assignmentId',session.assignment_id,'jobStatus',job.status,
        'status',session.status,'startedAt',session.started_at,
        'pausedAt',session.paused_at,'lastUpdatedAt',point.recorded_at,
        'stale',point.recorded_at IS NULL
          OR point.recorded_at<p_at-interval '2 minutes',
        'pointCount',session.point_count,
        'latitude',point.latitude,'longitude',point.longitude,
        'accuracyMeters',point.accuracy_meters,
        'locationAvailable',point.id IS NOT NULL,
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
        'routeMode','DIRECT_ESTIMATE',
        'visibilityPrecision',session.visibility_precision,
        'rawRetentionDays',session.raw_retention_days,
        'lastFailureCode',session.last_failure_code,
        'lastFailureAt',session.last_failure_at
      ) ORDER BY assignment.assigned_at DESC)
      FROM public.delivery_tracking_sessions session
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=session.assignment_id
      JOIN public.delivery_jobs job ON job.id=session.delivery_job_id
      JOIN public.companies company ON company.id=session.company_id
      JOIN public.branches branch ON branch.id=session.branch_id
      LEFT JOIN LATERAL (
        SELECT location.* FROM public.delivery_tracking_points location
        WHERE location.session_id=session.id
          AND location.retention_until>p_at
        ORDER BY location.recorded_at DESC,location.id DESC LIMIT 1
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

-- Keep the driver's just-completed outcome visible across an authoritative
-- refresh without reopening the ended assignment or returning destination,
-- recipient, evidence-file, supplier, or acquisition details.
CREATE OR REPLACE FUNCTION public.axora_driver_recent_delivery_completion(
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
    'products','[]'::jsonb,'suppliers','[]'::jsonb,
    'jobs',COALESCE((
      SELECT jsonb_agg(completed.item)
      FROM (
        SELECT jsonb_build_object(
          'id',job.id,'code',job.job_code,'status','COMPLETED',
          'workflowVersion',job.workflow_version,
          'assignmentId',assignment.id,'requestId',job.request_id,
          'requestNumber',request.order_code,'companyName',company.name,
          'branchName',branch.name,
          'destinationTimezone',job.destination_timezone,
          'scheduledLocalStart',job.scheduled_local_start,
          'scheduledLocalEnd',job.scheduled_local_end,
          'acceptanceDeadline',assignment.acceptance_deadline,
          'slaDueAt',job.sla_due_at,'address',branch.name,
          'proofPolicy',job.proof_policy,
          'proofSatisfied',public.axora_delivery_job_has_required_proof(job.id),
          'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',delivery_line.id,'requestLineId',request_line.id,
            'productId',request_line.product_id,
            'productName',request_line.product_name_snapshot,
            'quantity',delivery_line.quantity_to_deliver,
            'unitOfMeasure',delivery_line.unit_of_measure_snapshot
          ) ORDER BY request_line.request_line_code)
          FROM public.delivery_job_lines delivery_line
          JOIN public.request_lines request_line
            ON request_line.id=delivery_line.request_line_id
          WHERE delivery_line.delivery_job_id=job.id),'[]'::jsonb),
          'events',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',event.id,'type',event.event_type,
            'receivedAt',event.received_at
          ) ORDER BY event.received_at,event.id)
          FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id),'[]'::jsonb),
          'evidence','[]'::jsonb,'actualHistory','[]'::jsonb
        ) AS item
        FROM public.delivery_job_assignments assignment
        JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
        JOIN public.requests request ON request.id=job.request_id
        JOIN public.companies company ON company.id=job.company_id
        JOIN public.branches branch ON branch.id=job.branch_id
        WHERE assignment.driver_user_id=p_actor_user_id
          AND assignment.driver_role_assignment_id=p_actor_role_assignment_id
          AND assignment.status='COMPLETED'
          AND assignment.ended_at>=p_at-interval '24 hours'
          AND job.status='COMPLETED'
        ORDER BY assignment.ended_at DESC,assignment.id DESC
        LIMIT 1
      ) completed
    ),'[]'::jsonb)
  );
END
$$;

-- Company recipients receive a purpose-specific projection: rounded active
-- positions and ETA, plus status-only preparing/completed records. Terminal
-- tracking never emits a last raw or rounded position.
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
        'companyName',company.name,'branchName',branch.name,
        'jobStatus',job.status,'status',session.status,
        'startedAt',session.started_at,'pausedAt',session.paused_at,
        'pointCount',session.point_count,
        'lastUpdatedAt',CASE WHEN session.status='ENDED'
          THEN session.ended_at ELSE point.recorded_at END,
        'stale',CASE WHEN session.status IN ('ENDED','NOT_STARTED') THEN false
          ELSE point.recorded_at IS NOT NULL
            AND point.recorded_at<p_at-interval '2 minutes' END,
        'latitude',CASE WHEN session.status='ENDED' THEN NULL
          ELSE round(point.latitude,3) END,
        'longitude',CASE WHEN session.status='ENDED' THEN NULL
          ELSE round(point.longitude,3) END,
        'accuracyMeters',CASE WHEN session.status='ENDED' THEN NULL
          ELSE greatest(point.accuracy_meters,150) END,
        'destinationLatitude',CASE WHEN session.status='ENDED' THEN NULL
          ELSE round(session.destination_latitude,3) END,
        'destinationLongitude',CASE WHEN session.status='ENDED' THEN NULL
          ELSE round(session.destination_longitude,3) END,
        'remainingMeters',CASE WHEN session.status='ENDED'
          THEN NULL ELSE route.remaining_meters END,
        'etaSeconds',CASE
          WHEN session.status='ENDED' OR point.recorded_at IS NULL
            OR point.recorded_at<p_at-interval '2 minutes'
            OR route.remaining_meters IS NULL THEN NULL
          ELSE ceil(route.remaining_meters/greatest(
            CASE WHEN point.speed_mps BETWEEN 1 AND 50
              THEN point.speed_mps ELSE 8.33 END,1
          ))::integer
        END,
        'routeMode','PRIVACY_SAFE_DIRECT_ESTIMATE',
        'visibilityPrecision','APPROXIMATE',
        'agentUserId',session.driver_user_id,'agentName',driver.display_name,
        'showVehicleDetails',CASE WHEN session.status='ENDED'
          THEN false ELSE session.show_vehicle_details END,
        'contactMode',CASE WHEN session.status='ENDED'
          THEN 'NONE' ELSE session.contact_mode END,
        'contactPath',CASE
          WHEN session.status<>'ENDED' AND session.contact_mode='AXORA_RELAY'
            THEN '/support?delivery='||job.id::text ELSE NULL END,
        'vehicleType',CASE WHEN session.status<>'ENDED'
          AND session.show_vehicle_details THEN session.vehicle_type END,
        'vehicleColour',CASE WHEN session.status<>'ENDED'
          AND session.show_vehicle_details THEN session.vehicle_colour END,
        'vehicleRegistration',CASE WHEN session.status<>'ENDED'
          AND session.show_vehicle_details THEN session.vehicle_registration END
      ) ORDER BY job.scheduled_window_start,job.id)
      FROM public.delivery_tracking_sessions session
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=session.assignment_id
      JOIN public.delivery_jobs job ON job.id=session.delivery_job_id
      JOIN public.companies company ON company.id=session.company_id
      JOIN public.branches branch ON branch.id=session.branch_id
      JOIN public.users driver ON driver.id=session.driver_user_id
      LEFT JOIN LATERAL (
        SELECT location.* FROM public.delivery_tracking_points location
        WHERE location.session_id=session.id
          AND location.retention_until>p_at
        ORDER BY location.recorded_at DESC,location.id DESC LIMIT 1
      ) point ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN point.id IS NULL OR session.destination_latitude IS NULL
            THEN NULL
          ELSE public.axora_delivery_distance_meters(
            round(point.latitude,3),round(point.longitude,3),
            round(session.destination_latitude,3),
            round(session.destination_longitude,3)
          )
        END AS remaining_meters
      ) route ON true
      WHERE (
          session.status IN ('NOT_STARTED','ACTIVE','PAUSED')
          AND assignment.status IN ('ASSIGNED','ACCEPTED')
          AND assignment.ended_at IS NULL
          AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
        OR session.status='ENDED'
          AND assignment.status='COMPLETED'
          AND job.status='COMPLETED'
          AND session.ended_at>=p_at-interval '30 days'
        )
        AND public.axora_snapshot_has_permission(
          snapshot,'receiving.confirm','BRANCH',
          session.company_id,session.branch_id,NULL,NULL
        )
        AND public.axora_user_can_receive(
          p_actor_user_id,session.company_id,session.branch_id
        )
    ),'[]'::jsonb) || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sessionId',job.id,'jobId',job.id,'jobCode',job.job_code,
        'companyName',company.name,'branchName',branch.name,
        'jobStatus',job.status,'status','NOT_STARTED',
        'startedAt',NULL,'pausedAt',NULL,'pointCount',0,
        'lastUpdatedAt',job.updated_at,'stale',false,
        'latitude',NULL,'longitude',NULL,'accuracyMeters',NULL,
        'destinationLatitude',round(job.destination_latitude,3),
        'destinationLongitude',round(job.destination_longitude,3),
        'remainingMeters',NULL,'etaSeconds',NULL,
        'routeMode','PRIVACY_SAFE_DIRECT_ESTIMATE',
        'visibilityPrecision','APPROXIMATE',
        'agentUserId',NULL,'agentName',NULL,
        'showVehicleDetails',false,'contactMode','NONE',
        'contactPath',NULL,'vehicleType',NULL,'vehicleColour',NULL,
        'vehicleRegistration',NULL
      ) ORDER BY job.scheduled_window_start,job.id)
      FROM public.delivery_jobs job
      JOIN public.companies company ON company.id=job.company_id
      JOIN public.branches branch ON branch.id=job.branch_id
      WHERE job.status='AWAITING_ASSIGNMENT'
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_tracking_sessions session
          WHERE session.delivery_job_id=job.id
        )
        AND public.axora_snapshot_has_permission(
          snapshot,'receiving.confirm','BRANCH',
          job.company_id,job.branch_id,NULL,NULL
        )
        AND public.axora_user_can_receive(
          p_actor_user_id,job.company_id,job.branch_id
        )
    ),'[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION public.axora_driver_available_jobs(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_claim_result(
  uuid,uuid,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_delivery_command_result(
  uuid,uuid,uuid,text,uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_verify_delivery_otp_command(
  uuid,uuid,uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_control_delivery_tracking(
  uuid,uuid,uuid,text,text,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_recent_delivery_completion(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_company_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_permission_allowed_for_account_kind(
  text,text
) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_driver_available_jobs(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_driver_claim_result(
      uuid,uuid,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_driver_delivery_command_result(
      uuid,uuid,uuid,text,uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_verify_delivery_otp_command(
      uuid,uuid,uuid,uuid,text,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_control_delivery_tracking(
      uuid,uuid,uuid,text,text,text,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_driver_delivery_tracking_workspace(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_driver_recent_delivery_completion(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_company_delivery_tracking_workspace(
      uuid,uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_permission_allowed_for_account_kind(
      text,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
