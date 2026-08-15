BEGIN;

CREATE TABLE public.delivery_recovery_commands (
  command_id uuid PRIMARY KEY,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  previous_assignment_id uuid REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  eligibility_facts jsonb NOT NULL CHECK (jsonb_typeof(eligibility_facts)='object'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_recovery_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_recovery_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_recovery_commands FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_ensure_available_job_for_paid_payment(
  p_payment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE payment_row public.payments%ROWTYPE;
DECLARE invoice_row public.invoices%ROWTYPE;
DECLARE request_row public.requests%ROWTYPE;
DECLARE branch_row public.branches%ROWTYPE;
DECLARE company_active boolean;
DECLARE request_status_key text;
DECLARE creator_user_id uuid;
DECLARE job_id uuid;
DECLARE new_job_id uuid:=gen_random_uuid();
DECLARE job_code text;
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id=p_payment_id FOR UPDATE;
  IF payment_row.id IS NULL OR payment_row.payment_status<>'PAID' THEN RETURN NULL; END IF;
  SELECT * INTO invoice_row FROM public.invoices
  WHERE id=payment_row.invoice_id AND lifecycle_status='FINALIZED' FOR SHARE;
  IF invoice_row.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO request_row FROM public.requests WHERE id=invoice_row.request_id FOR SHARE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Paid request delivery context is unavailable'; END IF;
  SELECT status.value_key INTO request_status_key
  FROM public.lookup_values status
  WHERE status.id=request_row.status_id AND status.type_key='request_status';
  IF request_status_key IN ('COMPLETED','CANCELLED') THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request_row.id::text,884));
  SELECT job.id INTO job_id FROM public.delivery_jobs job
  WHERE job.request_id=request_row.id ORDER BY job.created_at,job.id LIMIT 1;
  IF job_id IS NOT NULL THEN RETURN job_id; END IF;
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=request_row.branch_id AND branch.company_id=request_row.company_id FOR SHARE;
  SELECT company.active INTO company_active FROM public.companies company
  WHERE company.id=request_row.company_id FOR SHARE;
  IF branch_row.id IS NULL OR NOT branch_row.active OR company_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Paid request delivery context is unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.request_lines line
    WHERE line.request_id=request_row.id
      AND line.quantity>COALESCE(public.axora_effective_received_quantity_internal(line.id),0)
  ) THEN RETURN NULL; END IF;
  SELECT account.id INTO creator_user_id FROM public.users account
  WHERE account.active AND account.account_status='ACTIVE'
    AND public.axora_user_is_platform(account.id)
  ORDER BY account.created_at,account.id LIMIT 1;
  IF creator_user_id IS NULL THEN
    RAISE EXCEPTION 'No active platform service actor can create the paid delivery job';
  END IF;
  job_code:='DEL-'||to_char(COALESCE(payment_row.paid_at,p_at) AT TIME ZONE 'UTC','YYYYMMDD')||'-'||
    upper(substr(replace(new_job_id::text,'-',''),1,8));
  INSERT INTO public.delivery_jobs(
    id,company_id,branch_id,request_id,job_code,status,
    delivery_address_snapshot,contact_name_snapshot,contact_phone_snapshot,
    instructions,idempotency_key,created_by,workflow_version,
    destination_timezone,status_changed_at,proof_policy,created_at,updated_at
  ) VALUES (
    new_job_id,request_row.company_id,request_row.branch_id,request_row.id,job_code,
    'AWAITING_ASSIGNMENT',branch_row.delivery_address,branch_row.contact_name,
    branch_row.contact_phone,NULL,'paid-request-'||request_row.id::text,
    creator_user_id,1,branch_row.timezone,COALESCE(payment_row.paid_at,p_at),
    ARRAY['PHOTO']::text[],COALESCE(payment_row.paid_at,p_at),COALESCE(payment_row.paid_at,p_at)
  ) ON CONFLICT(company_id,idempotency_key) DO NOTHING RETURNING id INTO job_id;
  IF job_id IS NULL THEN
    SELECT job.id INTO job_id FROM public.delivery_jobs job
    WHERE job.request_id=request_row.id ORDER BY job.created_at,job.id LIMIT 1;
    RETURN job_id;
  END IF;
  INSERT INTO public.delivery_job_lines(
    company_id,delivery_job_id,request_line_id,quantity_to_deliver,
    unit_of_measure_snapshot,created_at
  ) SELECT request_row.company_id,job_id,line.id,
      line.quantity-COALESCE(public.axora_effective_received_quantity_internal(line.id),0),
      line.unit_of_measure,COALESCE(payment_row.paid_at,p_at)
    FROM public.request_lines line
    WHERE line.request_id=request_row.id
      AND line.quantity>COALESCE(public.axora_effective_received_quantity_internal(line.id),0)
  ON CONFLICT(delivery_job_id,request_line_id) DO NOTHING;
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_jobs',job_id,'CREATE',COALESCE(invoice_row.finalized_by,creator_user_id),
    request_row.company_id,request_row.id,'Paid request entered the available delivery pool',
    jsonb_build_object('status','AWAITING_ASSIGNMENT','source','PAID_FINALIZED_INVOICE','paymentId',payment_row.id)
  );
  RETURN job_id;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_create_available_job_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.payment_status='PAID' THEN
    PERFORM public.axora_ensure_available_job_for_paid_payment(NEW.id,COALESCE(NEW.paid_at,now()));
  END IF;
  RETURN NEW;
END
$$;

-- Backfill work that became paid before migration 084 installed its trigger.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT payment.id,COALESCE(payment.paid_at,payment.created_at,now()) AS at
    FROM public.payments payment
    JOIN public.invoices invoice ON invoice.id=payment.invoice_id
    JOIN public.requests request ON request.id=invoice.request_id
    JOIN public.companies company ON company.id=request.company_id AND company.active
    JOIN public.branches branch ON branch.id=request.branch_id
      AND branch.company_id=request.company_id AND branch.active
    WHERE payment.payment_status='PAID'
      AND invoice.lifecycle_status='FINALIZED'
      AND NOT EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.request_id=request.id)
    ORDER BY payment.created_at,payment.id
  LOOP
    PERFORM public.axora_ensure_available_job_for_paid_payment(candidate.id,candidate.at);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.axora_delivery_recovery_eligibility(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_delivery_job_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
DECLARE job public.delivery_jobs%ROWTYPE;
DECLARE assignment public.delivery_job_assignments%ROWTYPE;
DECLARE driver_active boolean;
DECLARE availability text;
DECLARE availability_at timestamptz;
DECLARE tracking_status text;
DECLARE tracking_activity timestamptz;
DECLARE latest_activity timestamptz;
DECLARE eligible boolean:=false;
DECLARE reason_code text:='HEALTHY_ACTIVE_JOB';
DECLARE reason_text text:='The active delivery is healthy and cannot be released.';
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RETURN NULL; END IF;
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id;
  IF job.id IS NULL THEN RETURN NULL; END IF;
  IF job.status IN ('DELIVERED','COMPLETED','CANCELLED','FAILED','RETURNED') THEN
    RETURN jsonb_build_object('eligible',false,'reasonCode','TERMINAL_JOB',
      'reason','A terminal delivery cannot be recovered.','facts',jsonb_build_object('jobStatus',job.status));
  END IF;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=job.id AND status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL
  ORDER BY assigned_at DESC,id DESC LIMIT 1;
  IF assignment.id IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'reasonCode','NO_ACTIVE_ASSIGNMENT',
      'reason','This delivery has no active assignment to recover.','facts',jsonb_build_object('jobStatus',job.status));
  END IF;
  SELECT account.active AND account.account_status='ACTIVE' AND profile.active,
    profile.availability_status,profile.availability_updated_at
  INTO driver_active,availability,availability_at
  FROM public.users account JOIN public.delivery_agent_profiles profile ON profile.user_id=account.id
  WHERE account.id=assignment.driver_user_id;
  SELECT tracking.status,GREATEST(tracking.updated_at,tracking.last_point_at)
  INTO tracking_status,tracking_activity
  FROM public.delivery_tracking_sessions tracking
  WHERE tracking.assignment_id=assignment.id
  ORDER BY tracking.created_at DESC LIMIT 1;
  latest_activity:=GREATEST(job.status_changed_at,job.updated_at,assignment.updated_at,
    assignment.accepted_at,tracking_activity);
  IF driver_active IS DISTINCT FROM true THEN
    eligible:=true; reason_code:='DRIVER_INACTIVE'; reason_text:='The assigned driver is no longer active.';
  ELSIF assignment.status='ASSIGNED' AND assignment.acceptance_deadline IS NOT NULL
    AND assignment.acceptance_deadline<p_at THEN
    eligible:=true; reason_code:='ACCEPTANCE_EXPIRED'; reason_text:='The assignment acceptance deadline has expired.';
  ELSIF availability='OFFLINE' AND availability_at<p_at-interval '15 minutes' THEN
    eligible:=true; reason_code:='DRIVER_OFFLINE'; reason_text:='The assigned driver has remained offline beyond the recovery threshold.';
  ELSIF tracking_status IN ('ACTIVE','PAUSED')
    AND COALESCE(tracking_activity,assignment.updated_at)<p_at-interval '30 minutes' THEN
    eligible:=true; reason_code:='TRACKING_STALE'; reason_text:='Tracking and delivery activity are stale beyond the recovery threshold.';
  ELSIF latest_activity<p_at-interval '2 hours' THEN
    eligible:=true; reason_code:='WORKFLOW_STALE'; reason_text:='No delivery workflow activity was recorded within the recovery period.';
  END IF;
  RETURN jsonb_build_object(
    'eligible',eligible,'reasonCode',reason_code,'reason',reason_text,
    'facts',jsonb_build_object(
      'jobStatus',job.status,'assignmentStatus',assignment.status,
      'acceptanceDeadline',assignment.acceptance_deadline,'driverActive',COALESCE(driver_active,false),
      'acceptanceExpired',assignment.status='ASSIGNED'
        AND assignment.acceptance_deadline IS NOT NULL AND assignment.acceptance_deadline<p_at,
      'availability',availability,'availabilityUpdatedAt',availability_at,
      'trackingStatus',tracking_status,'latestActivityAt',latest_activity,
      'evaluatedAt',p_at,'assignmentId',assignment.id
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_release_stuck_delivery_job(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_delivery_job_id uuid,
  p_command_id uuid,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb;
DECLARE job public.delivery_jobs%ROWTYPE;
DECLARE assignment public.delivery_job_assignments%ROWTYPE;
DECLARE eligibility jsonb;
DECLARE previous_result jsonb;
DECLARE result jsonb;
BEGIN
  IF p_command_id IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A recovery command and reason are required';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'delivery.assign','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN RAISE EXCEPTION 'Delivery recovery unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text,885));
  SELECT command.result INTO previous_result FROM public.delivery_recovery_commands command
  WHERE command.command_id=p_command_id AND command.actor_user_id=p_actor_user_id;
  IF previous_result IS NOT NULL THEN RETURN previous_result; END IF;
  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'Delivery recovery unavailable'; END IF;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE delivery_job_id=job.id AND status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL
  ORDER BY assigned_at DESC,id DESC LIMIT 1 FOR UPDATE;
  eligibility:=public.axora_delivery_recovery_eligibility(
    p_actor_user_id,p_actor_role_assignment_id,p_delivery_job_id,p_at
  );
  IF eligibility IS NULL OR COALESCE((eligibility->>'eligible')::boolean,false) IS NOT true THEN
    RAISE EXCEPTION 'Delivery recovery is not eligible: %',COALESCE(eligibility->>'reasonCode','UNAVAILABLE');
  END IF;
  UPDATE public.delivery_job_assignments SET status='REASSIGNED',ended_at=p_at,updated_at=p_at
  WHERE id=assignment.id;
  UPDATE public.fulfilment_purchase_assignments SET status='CANCELLED',updated_at=p_at
  WHERE request_id=job.request_id AND assigned_user_id=assignment.driver_user_id AND status='ASSIGNED';
  UPDATE public.delivery_tracking_sessions SET status='REVOKED',ended_at=p_at,
    end_reason='Delivery assignment recovered',updated_at=p_at
  WHERE assignment_id=assignment.id AND status IN ('NOT_STARTED','ACTIVE','PAUSED');
  UPDATE public.delivery_jobs SET status='AWAITING_ASSIGNMENT',workflow_version=workflow_version+1,
    acceptance_deadline=NULL,status_changed_at=p_at,tracking_stopped_at=p_at,updated_at=p_at
  WHERE id=job.id;
  result:=jsonb_build_object('jobId',job.id,'released',true,'status','AWAITING_ASSIGNMENT',
    'commandId',p_command_id,'eligibility',eligibility);
  INSERT INTO public.delivery_recovery_commands(
    command_id,delivery_job_id,actor_user_id,previous_assignment_id,
    eligibility_facts,reason,result,created_at
  ) VALUES (
    p_command_id,job.id,p_actor_user_id,assignment.id,eligibility,
    btrim(p_reason),result,p_at
  );
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_jobs',job.id,'UPDATE',p_actor_user_id,job.company_id,job.request_id,
    'Eligible stuck delivery released to the available pool',
    jsonb_build_object('commandId',p_command_id,'reason',btrim(p_reason),
      'previousAssignmentId',assignment.id,'eligibility',eligibility)
  );
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.axora_ensure_available_job_for_paid_payment(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_recovery_eligibility(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_release_stuck_delivery_job(uuid,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON public.delivery_recovery_commands FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_delivery_recovery_eligibility(uuid,uuid,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_release_stuck_delivery_job(uuid,uuid,uuid,uuid,text,timestamptz) TO axora_app;
  END IF;
END $$;

COMMIT;
