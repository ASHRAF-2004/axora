BEGIN;

-- Customer delivery tracking is a read-only delivery-view capability. Receipt
-- confirmation remains separately assignment-bound: a company-scoped Company
-- Administrator must not need a branch assignment merely to observe the
-- privacy-safe delivery projection.
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
        AND snapshot->>'accountKind'='COMPANY'
        AND (
          public.axora_snapshot_has_permission(
            snapshot,'delivery.view','BRANCH',
            session.company_id,session.branch_id,NULL,NULL
          )
          OR (
            public.axora_snapshot_has_permission(
              snapshot,'receiving.confirm','BRANCH',
              session.company_id,session.branch_id,NULL,NULL
            )
            AND public.axora_user_can_receive(
              p_actor_user_id,session.company_id,session.branch_id
            )
          )
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
        AND snapshot->>'accountKind'='COMPANY'
        AND (
          public.axora_snapshot_has_permission(
            snapshot,'delivery.view','BRANCH',
            job.company_id,job.branch_id,NULL,NULL
          )
          OR (
            public.axora_snapshot_has_permission(
              snapshot,'receiving.confirm','BRANCH',
              job.company_id,job.branch_id,NULL,NULL
            )
            AND public.axora_user_can_receive(
              p_actor_user_id,job.company_id,job.branch_id
            )
          )
        )
    ),'[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION public.axora_company_delivery_tracking_workspace(
  uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_company_delivery_tracking_workspace(
      uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
