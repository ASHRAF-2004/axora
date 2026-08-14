BEGIN;

INSERT INTO public.permissions(permission_code,permission_group,label,description,high_risk)
VALUES ('delivery.claim','Delivery','Claim available delivery jobs','Atomically claim one paid, available delivery job for the signed-in Delivery Guy.',true)
ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,label=EXCLUDED.label,
  description=EXCLUDED.description,high_risk=EXCLUDED.high_risk,
  active=true,updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code='delivery.claim'
WHERE role.role_key IN ('DELIVERY_GUY','PLATFORM_OWNER')
ON CONFLICT DO NOTHING;

ALTER TABLE public.delivery_agent_profiles
  ADD COLUMN availability_status text NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN availability_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT delivery_agent_availability_check
    CHECK (availability_status IN ('AVAILABLE','UNAVAILABLE','OFFLINE'));

CREATE OR REPLACE FUNCTION public.axora_create_available_job_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE invoice_row public.invoices%ROWTYPE;
DECLARE request_row public.requests%ROWTYPE;
DECLARE branch_row public.branches%ROWTYPE;
DECLARE creator_user_id uuid;
DECLARE job_id uuid:=gen_random_uuid();
DECLARE job_code text;
BEGIN
  IF NEW.payment_status<>'PAID' THEN RETURN NEW; END IF;
  SELECT * INTO invoice_row FROM public.invoices invoice
  WHERE invoice.id=NEW.invoice_id AND invoice.lifecycle_status='FINALIZED';
  IF invoice_row.id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.request_id=invoice_row.request_id) THEN RETURN NEW; END IF;
  SELECT * INTO request_row FROM public.requests request WHERE request.id=invoice_row.request_id FOR SHARE;
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=request_row.branch_id AND branch.company_id=request_row.company_id FOR SHARE;
  IF request_row.id IS NULL OR branch_row.id IS NULL OR NOT branch_row.active THEN
    RAISE EXCEPTION 'Paid request delivery context is unavailable';
  END IF;
  SELECT account.id INTO creator_user_id
  FROM public.users account
  WHERE account.active AND public.axora_user_is_platform(account.id)
  ORDER BY account.created_at,account.id LIMIT 1;
  IF creator_user_id IS NULL THEN RETURN NEW; END IF;
  job_code:='DEL-'||to_char(COALESCE(NEW.paid_at,now()) AT TIME ZONE 'UTC','YYYYMMDD')||'-'||
    upper(substr(replace(job_id::text,'-',''),1,8));
  INSERT INTO public.delivery_jobs(
    id,company_id,branch_id,request_id,job_code,status,
    delivery_address_snapshot,contact_name_snapshot,contact_phone_snapshot,
    instructions,idempotency_key,created_by,workflow_version,
    destination_timezone,status_changed_at,proof_policy,created_at,updated_at
  ) VALUES (
    job_id,request_row.company_id,request_row.branch_id,request_row.id,job_code,
    'AWAITING_ASSIGNMENT',branch_row.delivery_address,branch_row.contact_name,
    branch_row.contact_phone,NULL,'paid-request-'||request_row.id::text,
    creator_user_id,1,branch_row.timezone,COALESCE(NEW.paid_at,now()),
    ARRAY['PHOTO']::text[],COALESCE(NEW.paid_at,now()),COALESCE(NEW.paid_at,now())
  ) ON CONFLICT(company_id,idempotency_key) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.delivery_job_lines(
      company_id,delivery_job_id,request_line_id,quantity_to_deliver,
      unit_of_measure_snapshot,created_at
    ) SELECT request_row.company_id,job_id,line.id,line.quantity,
        line.unit_of_measure,COALESCE(NEW.paid_at,now())
      FROM public.request_lines line WHERE line.request_id=request_row.id;
    PERFORM public.axora_record_p1_procurement_audit(
      'delivery_jobs',job_id,'CREATE',invoice_row.finalized_by,
      request_row.company_id,request_row.id,
      'Paid request entered the available delivery pool',
      jsonb_build_object('status','AWAITING_ASSIGNMENT','source','PAID_INVOICE')
    );
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS payments_create_available_delivery_job ON public.payments;
CREATE TRIGGER payments_create_available_delivery_job
AFTER INSERT OR UPDATE OF payment_status ON public.payments
FOR EACH ROW WHEN (NEW.payment_status='PAID')
EXECUTE FUNCTION public.axora_create_available_job_after_payment();

CREATE OR REPLACE FUNCTION public.axora_driver_available_jobs(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.delivery_agent_profiles profile
    JOIN public.users account ON account.id=profile.user_id
    WHERE profile.user_id=p_actor_user_id AND profile.active
      AND profile.availability_status='AVAILABLE' AND account.active
      AND account.account_status='ACTIVE'
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'sequence',(extract(epoch FROM p_at)*1000)::bigint,
    'capturedAt',p_at,
    'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',job.id,'code',job.job_code,'requestReference',request.order_code,
      'companyName',company.name,'branchName',branch.name,
      'area',COALESCE(branch.city,''),'destinationTimezone',job.destination_timezone,
      'scheduledStart',job.scheduled_window_start,'scheduledEnd',job.scheduled_window_end,
      'lineCount',(SELECT count(*) FROM public.delivery_job_lines line WHERE line.delivery_job_id=job.id),
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
          AND invoice.lifecycle_status='FINALIZED' AND payment.payment_status='PAID'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_job_assignments assignment
        WHERE assignment.delivery_job_id=job.id
          AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
      )),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_claim_available_delivery_job(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_delivery_job_id uuid,
  p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE;
DECLARE existing public.delivery_job_assignments%ROWTYPE;
DECLARE assignment_id uuid:=gen_random_uuid();
DECLARE v_request_version integer; result jsonb;
BEGIN
  SELECT * INTO existing FROM public.delivery_job_assignments
  WHERE command_id=p_command_id AND driver_user_id=p_actor_user_id;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('assignmentId',existing.id,'jobId',existing.delivery_job_id,'status',existing.status,'created',false);
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  IF snapshot IS NULL OR job.id IS NULL OR job.status<>'AWAITING_ASSIGNMENT'
    OR NOT public.axora_snapshot_has_permission(snapshot,'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL)
    OR NOT EXISTS (
      SELECT 1 FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      JOIN public.delivery_agent_profiles profile ON profile.user_id=assignment.user_id
      JOIN public.users account ON account.id=assignment.user_id
      WHERE assignment.id=p_actor_role_assignment_id AND assignment.user_id=p_actor_user_id
        AND assignment.active AND assignment.revoked_at IS NULL
        AND assignment.scope_type='DELIVERY' AND role.role_key='DELIVERY_GUY'
        AND profile.active AND profile.availability_status='AVAILABLE'
        AND account.active AND account.account_status='ACTIVE'
    )
    OR EXISTS (
      SELECT 1 FROM public.delivery_job_assignments assignment
      JOIN public.delivery_jobs active_job ON active_job.id=assignment.delivery_job_id
      WHERE assignment.driver_user_id=p_actor_user_id
        AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
        AND active_job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.invoices invoice
      JOIN public.payments payment ON payment.invoice_id=invoice.id
      WHERE invoice.request_id=job.request_id
        AND invoice.lifecycle_status='FINALIZED' AND payment.payment_status='PAID'
    ) THEN RAISE EXCEPTION 'This job was already claimed.'; END IF;

  INSERT INTO public.delivery_job_assignments(
    id,company_id,delivery_job_id,driver_user_id,status,assigned_by,assigned_at,
    driver_role_assignment_id,supervisor_role_assignment_id,expected_job_version,
    assignment_reason,acceptance_deadline,command_id,updated_at
  ) VALUES (
    assignment_id,job.company_id,job.id,p_actor_user_id,'ASSIGNED',p_actor_user_id,p_at,
    p_actor_role_assignment_id,NULL,job.workflow_version,'Claimed by Delivery Guy',
    COALESCE(job.acceptance_deadline,p_at+interval '2 hours'),p_command_id,p_at
  );
  SELECT request.request_version INTO v_request_version
  FROM public.requests request WHERE request.id=job.request_id FOR SHARE;
  UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',updated_at=p_at
  WHERE request_id=job.request_id AND request_version=v_request_version
    AND status='ASSIGNED';
  INSERT INTO public.fulfilment_purchase_assignments(
    request_id,request_version,company_id,assigned_user_id,
    assigned_role_assignment_id,assigned_by,assigned_by_role_assignment_id,
    status,reason,correlation_id,idempotency_key,assigned_at,updated_at
  ) VALUES (
    job.request_id,v_request_version,job.company_id,p_actor_user_id,
    p_actor_role_assignment_id,p_actor_user_id,p_actor_role_assignment_id,
    'ASSIGNED','Claimed by Delivery Guy',p_command_id,
    'delivery-self-claim-'||assignment_id::text,p_at,p_at
  );
  UPDATE public.delivery_jobs SET status='ASSIGNED',workflow_version=workflow_version+1,
    acceptance_deadline=COALESCE(acceptance_deadline,p_at+interval '2 hours'),
    status_changed_at=p_at,tracking_stopped_at=NULL,updated_at=p_at
  WHERE id=job.id;
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_job_assignments',assignment_id,'CREATE',p_actor_user_id,
    job.company_id,job.request_id,'Delivery job claimed',
    jsonb_build_object('deliveryJobId',job.id,'mode','SELF_CLAIM')
  );
  result:=jsonb_build_object('assignmentId',assignment_id,'jobId',job.id,'status','ASSIGNED','created',true);
  RETURN result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This job was already claimed.';
END
$$;

CREATE OR REPLACE FUNCTION public.axora_driver_management_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'sequence',(extract(epoch FROM p_at)*1000)::bigint,'capturedAt',p_at,
    'drivers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',account.id,'name',profile.display_name,'email',account.email,
      'phone',COALESCE(driver.phone,profile.phone,''),'active',driver.active AND account.active,
      'availability',CASE WHEN NOT driver.active OR NOT account.active THEN 'DEACTIVATED' ELSE driver.availability_status END,
      'currentJobId',current_job.id,'currentJobCode',current_job.job_code,
      'currentJobStatus',current_job.status,
      'completedJobs',(SELECT count(*) FROM public.delivery_job_assignments history
        JOIN public.delivery_jobs completed ON completed.id=history.delivery_job_id
        WHERE history.driver_user_id=account.id AND completed.status='COMPLETED'),
      'lastLatitude',last_point.latitude,'lastLongitude',last_point.longitude,
      'lastAccuracy',last_point.accuracy_meters,'lastLocationAt',last_point.recorded_at,
      'locationStale',last_point.recorded_at IS NULL OR last_point.recorded_at<p_at-interval '2 minutes'
    ) ORDER BY profile.display_name,account.id)
    FROM public.delivery_agent_profiles driver
    JOIN public.users account ON account.id=driver.user_id
    JOIN public.user_profiles profile ON profile.user_id=account.id
    LEFT JOIN LATERAL (
      SELECT job.id,job.job_code,job.status
      FROM public.delivery_job_assignments assignment
      JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
      WHERE assignment.driver_user_id=account.id
        AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
        AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
      ORDER BY assignment.assigned_at DESC LIMIT 1
    ) current_job ON true
    LEFT JOIN LATERAL (
      SELECT point.latitude,point.longitude,point.accuracy_meters,
        point.recorded_at
      FROM public.delivery_tracking_points point
      JOIN public.delivery_tracking_sessions tracking_session
        ON tracking_session.id=point.session_id
      WHERE tracking_session.driver_user_id=account.id
        AND point.retention_until>p_at
      ORDER BY point.recorded_at DESC,point.id DESC LIMIT 1
    ) last_point ON true),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_driver_detail_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_driver_user_id uuid,
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
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id',account.id,'name',profile.display_name,'email',account.email,
    'phone',COALESCE(driver.phone,profile.phone,''),'vehicle',driver.vehicle_description,
    'active',driver.active AND account.active,'availability',driver.availability_status,
    'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',job.id,'code',job.job_code,'status',job.status,
      'companyName',company.name,'branchName',branch.name,
      'assignedAt',assignment.assigned_at,'endedAt',assignment.ended_at
    ) ORDER BY assignment.assigned_at DESC)
    FROM public.delivery_job_assignments assignment
    JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
    JOIN public.companies company ON company.id=job.company_id
    JOIN public.branches branch ON branch.id=job.branch_id
    WHERE assignment.driver_user_id=account.id),'[]'::jsonb),
    'locations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'latitude',point.latitude,'longitude',point.longitude,
      'accuracy',point.accuracy_meters,'capturedAt',point.recorded_at
    ) ORDER BY point.recorded_at)
    FROM (
      SELECT location.*
      FROM public.delivery_tracking_points location
      JOIN public.delivery_tracking_sessions tracking_session
        ON tracking_session.id=location.session_id
      WHERE tracking_session.driver_user_id=account.id
        AND location.retention_until>p_at
      ORDER BY location.recorded_at DESC LIMIT 100
    ) point),'[]'::jsonb)
  ) INTO result
  FROM public.delivery_agent_profiles driver
  JOIN public.users account ON account.id=driver.user_id
  JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE account.id=p_driver_user_id;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_set_driver_availability(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_availability text,p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR p_availability NOT IN ('AVAILABLE','UNAVAILABLE','OFFLINE')
    OR NOT public.axora_snapshot_has_permission(snapshot,'delivery.portal.view','DELIVERY',NULL,NULL,NULL,NULL)
  THEN RAISE EXCEPTION 'Driver availability unavailable'; END IF;
  UPDATE public.delivery_agent_profiles SET availability_status=p_availability,
    availability_updated_at=p_at,updated_at=p_at
  WHERE user_id=p_actor_user_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver availability unavailable'; END IF;
  RETURN p_availability;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_protect_active_driver_account()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.active AND NOT NEW.active AND OLD.account_kind='DELIVERY' AND EXISTS (
    SELECT 1 FROM public.delivery_job_assignments assignment
    JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
    WHERE assignment.driver_user_id=OLD.id
      AND assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
      AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
  ) THEN RAISE EXCEPTION 'Resolve the active delivery before deactivating this driver'; END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS protect_active_driver_account ON public.users;
CREATE TRIGGER protect_active_driver_account BEFORE UPDATE OF active ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_active_driver_account();

REVOKE ALL ON FUNCTION public.axora_create_available_job_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_available_jobs(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_claim_available_delivery_job(uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_management_workspace(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_driver_detail_workspace(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_driver_availability(uuid,uuid,text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_release_stuck_delivery_job(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_delivery_job_id uuid,
  p_command_id uuid,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE;
DECLARE assignment public.delivery_job_assignments%ROWTYPE;
BEGIN
  IF p_command_id IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A recovery command and reason are required';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'Delivery recovery unavailable'; END IF;
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'Delivery recovery unavailable'; END IF;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=job.id AND status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL
  ORDER BY assigned_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF assignment.id IS NULL THEN
    RETURN jsonb_build_object('jobId',job.id,'released',false,'status',job.status);
  END IF;
  IF job.status IN ('COMPLETED','CANCELLED','FAILED','RETURNED') THEN
    RAISE EXCEPTION 'A terminal delivery cannot be released';
  END IF;
  UPDATE public.delivery_job_assignments SET status='REASSIGNED',ended_at=p_at,updated_at=p_at
  WHERE id=assignment.id;
  UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',updated_at=p_at
  WHERE request_id=job.request_id AND assigned_user_id=assignment.driver_user_id AND status='ASSIGNED';
  UPDATE public.delivery_jobs SET status='AWAITING_ASSIGNMENT',workflow_version=workflow_version+1,
    acceptance_deadline=NULL,status_changed_at=p_at,tracking_stopped_at=p_at,updated_at=p_at
  WHERE id=job.id;
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_jobs',job.id,'UPDATE',p_actor_user_id,job.company_id,job.request_id,
    'Stuck delivery released to the available pool',
    jsonb_build_object('commandId',p_command_id,'reason',btrim(p_reason),'previousAssignmentId',assignment.id)
  );
  RETURN jsonb_build_object('jobId',job.id,'released',true,'status','AWAITING_ASSIGNMENT');
END
$$;

REVOKE ALL ON FUNCTION public.axora_release_stuck_delivery_job(uuid,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON public.delivery_agent_profiles FROM PUBLIC;

DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON public.delivery_agent_profiles FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_driver_available_jobs(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_claim_available_delivery_job(uuid,uuid,uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_driver_management_workspace(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_driver_detail_workspace(uuid,uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_set_driver_availability(uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_release_stuck_delivery_job(uuid,uuid,uuid,uuid,text,timestamptz) TO axora_app';
  END IF;
END
$axora_runtime_role$;

COMMIT;
