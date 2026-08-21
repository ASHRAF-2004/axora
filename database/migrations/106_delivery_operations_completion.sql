BEGIN;

-- Prompt 9: paid-safe operational acquisition evidence. Customer pricing was
-- finalized by Approve & Pay; these records must never drive wallet, budget or
-- invoice mutations.
CREATE TABLE public.delivery_acquisition_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  driver_role_assignment_id uuid NOT NULL REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  event_command_id uuid NOT NULL,
  submission_version integer NOT NULL CHECK (submission_version>0),
  expected_workflow_version integer NOT NULL CHECK (expected_workflow_version>0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  notes text CHECK (notes IS NULL OR char_length(btrim(notes)) BETWEEN 3 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_job_id,submission_version),
  UNIQUE (driver_user_id,command_id),
  UNIQUE (driver_user_id,event_command_id)
);

CREATE TABLE public.delivery_acquisition_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL UNIQUE
    REFERENCES public.delivery_acquisition_submissions(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES public.delivery_job_assignments(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  file_name text NOT NULL CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 180),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf','image/jpeg','image/png','image/webp'
  )),
  storage_path text NOT NULL UNIQUE CHECK (
    storage_path ~ '^delivery-receipts/[A-Za-z0-9._/-]+$'
    AND storage_path !~ '(^|/)\.\.?(/|$)'
  ),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 5242880),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_acquisition_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL
    REFERENCES public.delivery_acquisition_submissions(id) ON DELETE RESTRICT,
  delivery_job_line_id uuid NOT NULL REFERENCES public.delivery_job_lines(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL REFERENCES public.request_lines(id) ON DELETE RESTRICT,
  resolution text NOT NULL CHECK (resolution IN ('ACQUIRED','UNAVAILABLE')),
  expected_quantity numeric(14,3) NOT NULL CHECK (expected_quantity>0),
  acquired_quantity numeric(14,3) NOT NULL CHECK (
    acquired_quantity>=0 AND acquired_quantity<=expected_quantity
  ),
  unit_of_measure_snapshot text NOT NULL,
  actual_internal_unit_cost numeric(18,6) CHECK (actual_internal_unit_cost>=0),
  unavailable_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id,delivery_job_line_id),
  CHECK (
    (resolution='ACQUIRED' AND acquired_quantity=expected_quantity
      AND actual_internal_unit_cost IS NOT NULL AND unavailable_reason IS NULL)
    OR
    (resolution='UNAVAILABLE' AND acquired_quantity=0
      AND actual_internal_unit_cost IS NULL
      AND char_length(btrim(unavailable_reason)) BETWEEN 3 AND 1000)
  )
);

ALTER TABLE public.delivery_acquisition_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_acquisition_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_acquisition_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_acquisition_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_acquisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_acquisition_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_acquisition_submissions FROM PUBLIC;
REVOKE ALL ON public.delivery_acquisition_receipts FROM PUBLIC;
REVOKE ALL ON public.delivery_acquisition_lines FROM PUBLIC;

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('delivery_acquisition_submissions','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Operational acquisition history is protected delivery evidence after payment.'),
  ('delivery_acquisition_receipts','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Internal receipt metadata is protected delivery evidence after payment.'),
  ('delivery_acquisition_lines','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Line acquisition and availability history is protected delivery evidence after payment.')
ON CONFLICT(table_name) DO NOTHING;

INSERT INTO public.company_deletion_ownership_dag(
  delete_order,table_name,rationale
)
SELECT (SELECT COALESCE(max(existing.delete_order),0)
        FROM public.company_deletion_ownership_dag existing)+ordered.ordinality,
  ordered.table_name,
  'Prompt 9 protected acquisition evidence; retained evidence prevents hard deletion, and empty evidence tables remain constraint-safe.'
FROM unnest(ARRAY[
  'delivery_acquisition_lines','delivery_acquisition_receipts',
  'delivery_acquisition_submissions'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
ON CONFLICT(table_name) DO NOTHING;

CREATE TRIGGER delivery_acquisition_submissions_append_only
BEFORE UPDATE OR DELETE ON public.delivery_acquisition_submissions
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_acquisition_receipts_append_only
BEFORE UPDATE OR DELETE ON public.delivery_acquisition_receipts
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_acquisition_lines_append_only
BEFORE UPDATE OR DELETE ON public.delivery_acquisition_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER delivery_acquisition_submissions_audit
AFTER INSERT ON public.delivery_acquisition_submissions
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_acquisition_receipts_audit
AFTER INSERT ON public.delivery_acquisition_receipts
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER delivery_acquisition_lines_audit
AFTER INSERT ON public.delivery_acquisition_lines
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

CREATE OR REPLACE FUNCTION public.axora_delivery_acquisition_is_complete(
  p_delivery_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_acquisition_submissions submission
    JOIN public.delivery_acquisition_receipts receipt
      ON receipt.submission_id=submission.id
    WHERE submission.delivery_job_id=p_delivery_job_id
      AND submission.submission_version=(
        SELECT max(latest.submission_version)
        FROM public.delivery_acquisition_submissions latest
        WHERE latest.delivery_job_id=p_delivery_job_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_job_lines job_line
        WHERE job_line.delivery_job_id=p_delivery_job_id
          AND NOT EXISTS (
            SELECT 1 FROM public.delivery_acquisition_lines acquired
            WHERE acquired.submission_id=submission.id
              AND acquired.delivery_job_line_id=job_line.id
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_acquisition_lines acquired
        WHERE acquired.submission_id=submission.id
          AND acquired.resolution<>'ACQUIRED'
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_delivery_line_outcomes_are_valid(
  p_delivery_job_id uuid,
  p_metadata jsonb,
  p_require_full boolean
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_typeof(p_metadata->'lineOutcomes')='array'
    AND jsonb_array_length(p_metadata->'lineOutcomes')=(
      SELECT count(*) FROM public.delivery_job_lines line
      WHERE line.delivery_job_id=p_delivery_job_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_job_lines line
      WHERE line.delivery_job_id=p_delivery_job_id
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_metadata->'lineOutcomes') outcome
          WHERE outcome->>'deliveryJobLineId'=line.id::text
            AND (outcome->>'deliveredQuantity')::numeric>=0
            AND (outcome->>'missingQuantity')::numeric>=0
            AND (outcome->>'damagedQuantity')::numeric>=0
            AND (outcome->>'damagedQuantity')::numeric
              <=(outcome->>'deliveredQuantity')::numeric
            AND (outcome->>'deliveredQuantity')::numeric
              +(outcome->>'missingQuantity')::numeric=line.quantity_to_deliver
            AND (
              (p_require_full
                AND (outcome->>'deliveredQuantity')::numeric=line.quantity_to_deliver
                AND (outcome->>'missingQuantity')::numeric=0
                AND (outcome->>'damagedQuantity')::numeric=0)
              OR NOT p_require_full
            )
        )
    )
    AND (p_require_full OR (
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_metadata->'lineOutcomes') outcome
        WHERE (outcome->>'deliveredQuantity')::numeric>0)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_metadata->'lineOutcomes') outcome
        WHERE (outcome->>'missingQuantity')::numeric>0)
    ))
$$;

CREATE OR REPLACE FUNCTION public.axora_register_delivery_acquisition(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_delivery_job_id uuid,
  p_assignment_id uuid,
  p_expected_workflow_version integer,
  p_command_id uuid,
  p_event_command_id uuid,
  p_file_name text,
  p_content_type text,
  p_storage_path text,
  p_sha256 text,
  p_file_size_bytes bigint,
  p_captured_at timestamptz,
  p_notes text,
  p_lines jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; job public.delivery_jobs%ROWTYPE;
  assignment public.delivery_job_assignments%ROWTYPE;
  existing public.delivery_acquisition_submissions%ROWTYPE;
  submission_id uuid:=gen_random_uuid(); receipt_id uuid:=gen_random_uuid();
  payload_hash text; item jsonb; job_line public.delivery_job_lines%ROWTYPE;
  line_count integer:=0; acquired_count integer:=0; unavailable_count integer:=0;
  submission_version integer; result jsonb;
BEGIN
  IF p_command_id=p_event_command_id THEN
    RAISE EXCEPTION 'The delivery acquisition command is unavailable';
  END IF;
  payload_hash:=encode(pg_catalog.sha256(convert_to(concat_ws('|',p_delivery_job_id,p_assignment_id,
    p_expected_workflow_version,p_event_command_id,btrim(COALESCE(p_file_name,'')),
    COALESCE(p_content_type,''),COALESCE(p_sha256,''),p_file_size_bytes,
    p_captured_at,btrim(COALESCE(p_notes,'')),COALESCE(p_lines,'[]'::jsonb)::text),
    'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'delivery-acquisition-command:'||p_actor_user_id::text||':'||p_command_id::text,0
  ));
  SELECT * INTO existing FROM public.delivery_acquisition_submissions
  WHERE driver_user_id=p_actor_user_id AND command_id=p_command_id;
  IF existing.id IS NOT NULL THEN
    IF existing.payload_hash<>payload_hash
      OR existing.delivery_job_id<>p_delivery_job_id
      OR existing.assignment_id<>p_assignment_id THEN
      RAISE EXCEPTION 'The delivery acquisition command conflicts with its original payload';
    END IF;
    RETURN jsonb_build_object('submissionId',existing.id,'jobId',existing.delivery_job_id,
      'workflowVersion',existing.expected_workflow_version,'created',false,
      'storagePath',(SELECT receipt.storage_path FROM public.delivery_acquisition_receipts receipt
        WHERE receipt.submission_id=existing.id));
  END IF;

  SELECT * INTO job FROM public.delivery_jobs WHERE id=p_delivery_job_id FOR UPDATE;
  SELECT * INTO assignment FROM public.delivery_job_assignments
  WHERE id=p_assignment_id AND delivery_job_id=p_delivery_job_id FOR UPDATE;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR job.id IS NULL OR assignment.id IS NULL
    OR job.status<>'SHOPPING' OR job.workflow_version<>p_expected_workflow_version
    OR assignment.driver_user_id<>p_actor_user_id
    OR assignment.driver_role_assignment_id<>p_actor_role_assignment_id
    OR assignment.status<>'ACCEPTED' OR assignment.ended_at IS NOT NULL
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.shop','DELIVERY',NULL,NULL,NULL,NULL
    ) OR NOT public.axora_snapshot_has_permission(
      snapshot,'delivery.receipt.upload','DELIVERY',NULL,NULL,NULL,NULL
    ) OR jsonb_typeof(COALESCE(p_lines,'null'::jsonb))<>'array'
    OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200
    OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR p_storage_path !~ '^delivery-receipts/[A-Za-z0-9._/-]+$'
    OR p_storage_path ~ '(^|/)\.\.?(/|$)'
    OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_file_size_bytes NOT BETWEEN 1 AND 5242880
    OR char_length(btrim(COALESCE(p_file_name,''))) NOT BETWEEN 1 AND 180
    OR p_captured_at<p_at-interval '24 hours'
    OR p_captured_at>p_at+interval '5 minutes'
    OR (p_notes IS NOT NULL AND char_length(btrim(p_notes)) NOT BETWEEN 3 AND 2000)
  THEN RAISE EXCEPTION 'The delivery acquisition is unavailable'; END IF;
  SELECT COALESCE(max(submission.submission_version),0)+1 INTO submission_version
  FROM public.delivery_acquisition_submissions submission
  WHERE submission.delivery_job_id=job.id;

  INSERT INTO public.delivery_acquisition_submissions(
    id,company_id,delivery_job_id,assignment_id,driver_user_id,
    driver_role_assignment_id,command_id,event_command_id,submission_version,
    expected_workflow_version,payload_hash,notes,created_at
  ) VALUES (
    submission_id,job.company_id,job.id,assignment.id,p_actor_user_id,
    p_actor_role_assignment_id,p_command_id,p_event_command_id,submission_version,
    p_expected_workflow_version,payload_hash,NULLIF(btrim(COALESCE(p_notes,'')),''),p_at
  );
  INSERT INTO public.delivery_acquisition_receipts(
    id,company_id,delivery_job_id,submission_id,assignment_id,driver_user_id,
    file_name,content_type,storage_path,sha256,file_size_bytes,captured_at,created_at
  ) VALUES (
    receipt_id,job.company_id,job.id,submission_id,assignment.id,p_actor_user_id,
    btrim(p_file_name),p_content_type,p_storage_path,p_sha256,p_file_size_bytes,
    p_captured_at,p_at
  );

  FOR item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(item)<>'object'
      OR item->>'deliveryJobLineId' IS NULL
      OR item->>'resolution' NOT IN ('ACQUIRED','UNAVAILABLE') THEN
      RAISE EXCEPTION 'A delivery acquisition line is unavailable';
    END IF;
    BEGIN
      SELECT * INTO STRICT job_line FROM public.delivery_job_lines
      WHERE id=(item->>'deliveryJobLineId')::uuid
        AND delivery_job_id=job.id FOR SHARE;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A delivery acquisition line is unavailable';
    END;
    INSERT INTO public.delivery_acquisition_lines(
      company_id,delivery_job_id,submission_id,delivery_job_line_id,
      request_line_id,resolution,expected_quantity,acquired_quantity,
      unit_of_measure_snapshot,actual_internal_unit_cost,unavailable_reason,created_at
    ) VALUES (
      job.company_id,job.id,submission_id,job_line.id,job_line.request_line_id,
      item->>'resolution',job_line.quantity_to_deliver,
      CASE WHEN item->>'resolution'='ACQUIRED' THEN job_line.quantity_to_deliver ELSE 0 END,
      job_line.unit_of_measure_snapshot,
      CASE WHEN item->>'resolution'='ACQUIRED'
        THEN (item->>'actualInternalUnitCost')::numeric ELSE NULL END,
      CASE WHEN item->>'resolution'='UNAVAILABLE'
        THEN NULLIF(btrim(COALESCE(item->>'reason','')),'') ELSE NULL END,p_at
    );
    line_count:=line_count+1;
    IF item->>'resolution'='ACQUIRED' THEN acquired_count:=acquired_count+1;
    ELSE unavailable_count:=unavailable_count+1; END IF;
  END LOOP;
  IF line_count<>(SELECT count(*) FROM public.delivery_job_lines line
      WHERE line.delivery_job_id=job.id) THEN
    RAISE EXCEPTION 'Every delivery line must have a valid acquisition resolution';
  END IF;
  result:=jsonb_build_object('submissionId',submission_id,'receiptId',receipt_id,
    'submissionVersion',submission_version,
    'jobId',job.id,'workflowVersion',job.workflow_version,'created',true,
    'storagePath',p_storage_path,'acquiredLines',acquired_count,
    'unavailableLines',unavailable_count);
  PERFORM public.axora_record_p1_procurement_audit(
    'delivery_acquisition_submissions',submission_id,'RECORD',p_actor_user_id,
    job.company_id,job.request_id,'Paid-safe delivery acquisition recorded',
    jsonb_build_object('deliveryJobId',job.id,'acquiredLines',acquired_count,
      'unavailableLines',unavailable_count,'receiptSha256',p_sha256)
  );
  RETURN result;
END
$$;

-- Preserve the canonical state machine and its public signature. Tighten only
-- the missing operational guards and keep the legacy finalized-actual predicate
-- as a rollback-compatible fallback for the previous image.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_record_delivery_event(uuid,uuid,uuid,uuid,integer,uuid,uuid,bigint,text,timestamptz,jsonb,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $$OR p_device_sequence<0$$,
    $$OR (p_event_type='ACCEPTED' AND assignment.acceptance_deadline IS NOT NULL
      AND assignment.acceptance_deadline<p_at)
    OR p_device_sequence<0$$);
  patched_definition:=replace(patched_definition,
    $$WHEN 'ITEMS_ACQUIRED' THEN CASE WHEN job.status='SHOPPING' AND EXISTS (
      SELECT 1 FROM public.request_actual_submissions actual
      WHERE actual.request_id=job.request_id AND actual.state='FINALIZED'
    ) THEN 'ITEMS_ACQUIRED' END$$,
    $$WHEN 'ITEMS_ACQUIRED' THEN CASE WHEN job.status='SHOPPING' AND (
      EXISTS (
        SELECT 1 FROM public.request_actual_submissions actual
        WHERE actual.request_id=job.request_id AND actual.state='FINALIZED'
      ) OR public.axora_delivery_acquisition_is_complete(job.id)
    ) THEN 'ITEMS_ACQUIRED' END$$);
  patched_definition:=replace(patched_definition,
    $$WHEN 'DELIVERED' THEN CASE WHEN job.status IN ('ARRIVED','PARTIALLY_DELIVERED')
      THEN 'DELIVERED' END
    WHEN 'COMPLETED' THEN CASE WHEN job.status IN ('DELIVERED','PARTIALLY_DELIVERED')
      AND public.axora_delivery_job_has_required_proof(job.id)
      THEN 'COMPLETED' END$$,
    $$WHEN 'DELIVERED' THEN CASE WHEN job.status='ARRIVED'
      AND char_length(btrim(COALESCE(p_metadata->>'receiverName',''))) BETWEEN 2 AND 200
      AND public.axora_delivery_line_outcomes_are_valid(job.id,p_metadata,true)
      THEN 'DELIVERED' END
    WHEN 'COMPLETED' THEN CASE WHEN job.status='DELIVERED'
      AND public.axora_delivery_job_has_required_proof(job.id)
      AND EXISTS (SELECT 1 FROM public.delivery_job_events delivered
        WHERE delivered.delivery_job_id=job.id AND delivered.event_type='DELIVERED'
          AND char_length(btrim(COALESCE(delivered.metadata->>'receiverName',''))) BETWEEN 2 AND 200)
      THEN 'COMPLETED' END$$);
  patched_definition:=replace(patched_definition,
    $$WHEN 'PARTIALLY_DELIVERED' THEN CASE WHEN job.status='ARRIVED'
      THEN 'PARTIALLY_DELIVERED' END$$,
    $$WHEN 'PARTIALLY_DELIVERED' THEN CASE WHEN job.status='ARRIVED'
      AND char_length(btrim(COALESCE(p_metadata->>'receiverName',''))) BETWEEN 2 AND 200
      AND public.axora_delivery_line_outcomes_are_valid(job.id,p_metadata,false)
      THEN 'PARTIALLY_DELIVERED' END$$);
  patched_definition:=replace(patched_definition,
    $$ELSIF p_event_type='COMPLETED' THEN
    UPDATE public.delivery_job_assignments SET status='COMPLETED',ended_at=p_at,
      updated_at=p_at WHERE id=assignment.id;
    UPDATE public.fulfilment_purchase_assignments SET status='COMPLETED',
      completed_at=p_at,updated_at=p_at
    WHERE request_id=job.request_id AND assigned_user_id=p_actor_user_id
      AND assigned_role_assignment_id=p_actor_role_assignment_id AND status='ASSIGNED';
  END IF;$$,
    $$ELSIF p_event_type='COMPLETED' THEN
    UPDATE public.delivery_job_assignments SET status='COMPLETED',ended_at=p_at,
      updated_at=p_at WHERE id=assignment.id;
    UPDATE public.fulfilment_purchase_assignments SET status='COMPLETED',
      completed_at=p_at,updated_at=p_at
    WHERE request_id=job.request_id AND assigned_user_id=p_actor_user_id
      AND assigned_role_assignment_id=p_actor_role_assignment_id AND status='ASSIGNED';
    UPDATE public.requests request SET
      status_id=(SELECT status.id FROM public.lookup_values status
        WHERE status.type_key='request_status' AND status.value_key='COMPLETED'),
      updated_at=p_at
    WHERE request.id=job.request_id
      AND NOT EXISTS (SELECT 1 FROM public.delivery_jobs other
        WHERE other.request_id=request.id AND other.id<>job.id
          AND other.status<>'COMPLETED');
  END IF;$$);
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('assignment.acceptance_deadline<p_at' IN patched_definition)=0
    OR position('axora_delivery_acquisition_is_complete(job.id)' IN patched_definition)=0
    OR position('axora_delivery_line_outcomes_are_valid(job.id,p_metadata,true)' IN patched_definition)=0
    OR position($guard$job.status='DELIVERED'$guard$ IN patched_definition)=0
    OR position($guard$value_key='COMPLETED'$guard$ IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery completion guards were not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Bind evidence replays to the complete immutable file/event payload and allow
-- proof only after an arrival event on the current active assignment.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz)'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(patched_definition,
    $$IF existing.id IS NOT NULL THEN$$,$$IF existing.id IS NOT NULL THEN$$);
  patched_definition:=original_definition;
  patched_definition:=replace(patched_definition,
    $$OR existing.evidence_type IS DISTINCT FROM p_evidence_type$$,
    $$OR existing.evidence_type IS DISTINCT FROM p_evidence_type
      OR existing.delivery_job_event_id IS DISTINCT FROM p_delivery_job_event_id
      OR existing.file_name IS DISTINCT FROM p_file_name
      OR existing.content_type IS DISTINCT FROM p_content_type
      OR existing.sha256 IS DISTINCT FROM p_sha256
      OR existing.captured_at IS DISTINCT FROM p_captured_at
      OR existing.recipient_identity IS DISTINCT FROM NULLIF(btrim(COALESCE(p_recipient_identity,'')),'')
      OR existing.consent_copy_version IS DISTINCT FROM NULLIF(btrim(COALESCE(p_consent_copy_version,'')),'')
      OR existing.consented_at IS DISTINCT FROM p_consented_at
      OR existing.image_width IS DISTINCT FROM p_image_width
      OR existing.image_height IS DISTINCT FROM p_image_height
      OR existing.supersedes_evidence_id IS DISTINCT FROM p_supersedes_evidence_id
      OR existing.metadata IS DISTINCT FROM COALESCE(p_metadata,'{}'::jsonb)$$);
  patched_definition:=replace(patched_definition,
    $$IF snapshot IS NULL OR assignment.id IS NULL OR event.id IS NULL$$,
    $$IF snapshot IS NULL OR assignment.id IS NULL OR event.id IS NULL
    OR event.assignment_id<>assignment.id
    OR event.event_type NOT IN ('ARRIVED','PARTIALLY_DELIVERED','DELIVERED')
    OR p_captured_at<event.received_at-interval '30 minutes'
    OR p_captured_at>p_at+interval '5 minutes'$$);
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('existing.delivery_job_event_id IS DISTINCT' IN patched_definition)=0
    OR position($guard$event.event_type NOT IN ('ARRIVED'$guard$ IN patched_definition)=0
  THEN RAISE EXCEPTION 'Delivery evidence binding was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- A new tracking session always inherits the immutable job destination. A
-- prior session may still supply privacy/vehicle policy, never coordinates.
DO $patch$
DECLARE original_definition text; patched_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_delivery_tracking_assignment_lifecycle()'::regprocedure
  ) INTO original_definition;
  patched_definition:=replace(original_definition,
    $$previous.destination_latitude,previous.destination_longitude,$$,
    $$job.destination_latitude,job.destination_longitude,$$);
  IF original_definition IS NULL OR patched_definition=original_definition
    OR position('job.destination_latitude,job.destination_longitude' IN patched_definition)=0
  THEN RAISE EXCEPTION 'Tracking destination snapshot was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Reuse the versioned document worker with a paid-safe customer snapshot. The
-- internal receipt path and acquisition costs are intentionally excluded.
CREATE OR REPLACE FUNCTION public.axora_build_final_delivery_document_snapshot(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE base_value jsonb; job_row public.delivery_jobs%ROWTYPE;
  acquisition_row public.delivery_acquisition_submissions%ROWTYPE;
  delivered_lines jsonb; unavailable_lines jsonb; timeline_value jsonb;
  evidence_value jsonb; history_value jsonb; delivery_agent_name text;
  recipient_name text; otp_verified boolean; snapshot_value jsonb;
BEGIN
  base_value:=public.axora_build_approved_request_document_snapshot(p_request_id,p_at);
  SELECT job.* INTO job_row FROM public.delivery_jobs job
  WHERE job.request_id=p_request_id AND job.status='COMPLETED'
    AND public.axora_delivery_job_has_required_proof(job.id)
  ORDER BY job.status_changed_at DESC,job.id DESC LIMIT 1;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'The completed delivery is unavailable'; END IF;
  SELECT submission.* INTO acquisition_row
  FROM public.delivery_acquisition_submissions submission
  WHERE submission.delivery_job_id=job_row.id
  ORDER BY submission.submission_version DESC LIMIT 1;
  IF acquisition_row.id IS NULL OR NOT public.axora_delivery_acquisition_is_complete(job_row.id) THEN
    RAISE EXCEPTION 'The completed acquisition is unavailable';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'lineReference',request_line.request_line_code,
    'originalName',COALESCE(request_line.product_name_snapshot,product.name),
    'actualSku',COALESCE(product.product_code,request_line.request_line_code),
    'actualName',COALESCE(request_line.product_name_snapshot,product.name),
    'quantity',acquired.acquired_quantity,
    'unitOfMeasure',acquired.unit_of_measure_snapshot,
    'customerUnitPrice',request_line.unit_sell_price,
    'deliveryCharge',COALESCE(request_line.delivery_charge,0),
    'lineTotal',round(acquired.acquired_quantity*COALESCE(request_line.unit_sell_price,0)
      +COALESCE(request_line.delivery_charge,0),2),
    'changed',false
  )) ORDER BY request_line.request_line_code),'[]'::jsonb)
  INTO delivered_lines
  FROM public.delivery_acquisition_lines acquired
  JOIN public.request_lines request_line ON request_line.id=acquired.request_line_id
  LEFT JOIN public.products product ON product.id=request_line.product_id
  WHERE acquired.submission_id=acquisition_row.id AND acquired.resolution='ACQUIRED';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineReference',request_line.request_line_code,
    'name',COALESCE(request_line.product_name_snapshot,product.name),
    'requestedQuantity',acquired.expected_quantity,
    'unitOfMeasure',acquired.unit_of_measure_snapshot,
    'reason',acquired.unavailable_reason
  ) ORDER BY request_line.request_line_code),'[]'::jsonb)
  INTO unavailable_lines
  FROM public.delivery_acquisition_lines acquired
  JOIN public.request_lines request_line ON request_line.id=acquired.request_line_id
  LEFT JOIN public.products product ON product.id=request_line.product_id
  WHERE acquired.submission_id=acquisition_row.id AND acquired.resolution='UNAVAILABLE';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event',event.event_type,'recordedAt',event.received_at,
    'localRecordedAt',event.client_local_recorded_at,
    'timezone',event.destination_timezone_snapshot
  ) ORDER BY event.received_at,event.id),'[]'::jsonb)
  INTO timeline_value FROM public.delivery_job_events event
  WHERE event.delivery_job_id=job_row.id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'type',evidence.evidence_type,'reference',evidence.id,
    'version',evidence.evidence_version,'checksum',evidence.sha256,
    'capturedAt',evidence.captured_at,
    'recipientIdentity',evidence.recipient_identity,
    'consentedAt',evidence.consented_at
  )) ORDER BY evidence.captured_at,evidence.id),'[]'::jsonb)
  INTO evidence_value FROM public.delivery_evidence evidence
  WHERE evidence.delivery_job_id=job_row.id
    AND evidence.validation_status='ACCEPTED'
    AND evidence.malware_status<>'QUARANTINED';

  SELECT account.display_name INTO delivery_agent_name
  FROM public.delivery_job_assignments assignment
  JOIN public.users account ON account.id=assignment.driver_user_id
  WHERE assignment.delivery_job_id=job_row.id
  ORDER BY assignment.assigned_at DESC LIMIT 1;
  SELECT event.metadata->>'receiverName' INTO recipient_name
  FROM public.delivery_job_events event
  WHERE event.delivery_job_id=job_row.id AND event.event_type='DELIVERED'
  ORDER BY event.received_at DESC,event.id DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.delivery_otp_challenges challenge
    WHERE challenge.delivery_job_id=job_row.id AND challenge.status='VERIFIED')
  INTO otp_verified;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type','DELIVERY','action',event.event_type,'occurredAt',event.received_at
  ) ORDER BY event.received_at,event.id),'[]'::jsonb)
  INTO history_value FROM public.delivery_job_events event
  WHERE event.delivery_job_id=job_row.id;

  snapshot_value:=(base_value-'documentType'-'lines'-'totals'-'disclaimer')
    ||jsonb_strip_nulls(jsonb_build_object(
      'documentType','FINAL_FULFILMENT_DELIVERY',
      'request',(base_value->'request')||jsonb_build_object('status','COMPLETED'),
      'original',jsonb_build_object('lines',base_value->'lines','totals',base_value->'totals'),
      'actual',jsonb_build_object(
        'purchaseMode','PAID_OPERATIONAL_ACQUISITION',
        'estimateAmount',base_value#>'{totals,grandTotal}',
        'actualAmount',base_value#>'{totals,grandTotal}',
        'withinTolerance',true,'lines',delivered_lines,
        'unavailableLines',unavailable_lines,'finalizedAt',acquisition_row.created_at
      ),
      'delivery',jsonb_build_object(
        'reference',job_row.job_code,'status',job_row.status,
        'address',job_row.delivery_address_snapshot,
        'scheduledStart',job_row.scheduled_window_start,
        'scheduledEnd',job_row.scheduled_window_end,
        'timezone',job_row.destination_timezone,'agentName',delivery_agent_name,
        'recipientName',recipient_name,'otpVerified',otp_verified,
        'timeline',timeline_value,'evidence',evidence_value
      ),
      'history',history_value,
      'disclaimer','Final customer record of paid and delivered items. Private sourcing, receipt and buying-cost data is excluded.',
      'metadata',(base_value->'metadata')||jsonb_build_object(
        'acquisitionRevision',acquisition_row.submission_version,
        'deliveryVersion',job_row.workflow_version
      )
    ));
  PERFORM public.axora_assert_document_snapshot_safe(
    'FINAL_FULFILMENT_DELIVERY',snapshot_value
  );
  RETURN snapshot_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_maybe_enqueue_final_document(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE request_row public.requests%ROWTYPE; job_row public.delivery_jobs%ROWTYPE;
  acquisition_revision integer;
BEGIN
  SELECT request.* INTO request_row FROM public.requests request
  WHERE request.id=p_request_id AND request.approval_state<>'CANCELLED';
  IF request_row.id IS NULL THEN RETURN; END IF;
  SELECT job.* INTO job_row FROM public.delivery_jobs job
  WHERE job.request_id=p_request_id AND job.status='COMPLETED'
    AND public.axora_delivery_job_has_required_proof(job.id)
  ORDER BY job.status_changed_at DESC,job.id DESC LIMIT 1;
  IF job_row.id IS NULL OR NOT public.axora_delivery_acquisition_is_complete(job_row.id) THEN RETURN; END IF;
  SELECT max(submission.submission_version) INTO acquisition_revision
  FROM public.delivery_acquisition_submissions submission
  WHERE submission.delivery_job_id=job_row.id;
  PERFORM public.axora_queue_document_generation_job(
    'FINAL_FULFILMENT_DELIVERY',p_request_id,NULL,'WORKFLOW',NULL,
    'final-document:'||p_request_id||':'||request_row.request_version||':'
      ||acquisition_revision||':'||job_row.workflow_version,NULL,p_at
  );
EXCEPTION WHEN OTHERS THEN
  IF request_row.company_id IS NOT NULL THEN
    INSERT INTO public.document_enqueue_failures(
      company_id,request_id,source_key,error_code,error_summary,created_at
    ) VALUES (
      request_row.company_id,p_request_id,'final-document:'||p_request_id,
      SQLSTATE,left(SQLERRM,500),p_at
    ) ON CONFLICT(company_id,source_key) DO NOTHING;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.axora_delivery_acquisition_is_complete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delivery_line_outcomes_are_valid(uuid,jsonb,boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_register_delivery_acquisition(
  uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,text,bigint,timestamptz,text,jsonb,timestamptz
) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.delivery_acquisition_submissions,
      public.delivery_acquisition_receipts,public.delivery_acquisition_lines
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_delivery_acquisition_is_complete(uuid)
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_delivery_line_outcomes_are_valid(uuid,jsonb,boolean)
      FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_register_delivery_acquisition(
      uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,text,bigint,timestamptz,text,jsonb,timestamptz
    ) TO axora_app;
  END IF;
END $grant$;

COMMIT;
