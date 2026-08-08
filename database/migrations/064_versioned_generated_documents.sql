BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS document_budget_balance_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document_receipt_policy text NOT NULL DEFAULT 'REFERENCE_ONLY';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_document_receipt_policy_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_document_receipt_policy_check
  CHECK (document_receipt_policy IN ('REFERENCE_ONLY','AUTHORIZED_LINK'));

CREATE TABLE public.document_templates (
  document_type text NOT NULL,
  template_version integer NOT NULL,
  generator_version text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_type,template_version),
  CHECK (document_type IN (
    'APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER'
  )),
  CHECK (template_version>0),
  CHECK (generator_version ~ '^[A-Za-z0-9._/-]{3,80}$')
);

INSERT INTO public.document_templates(
  document_type,template_version,generator_version
) VALUES
  ('APPROVED_REQUEST',1,'axora-pdfkit-1'),
  ('FINAL_FULFILMENT_DELIVERY',1,'axora-pdfkit-1'),
  ('SUPPLIER_PURCHASE_ORDER',1,'axora-pdfkit-1')
ON CONFLICT(document_type,template_version) DO NOTHING;

CREATE TABLE public.document_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  branch_id uuid REFERENCES public.branches(id),
  department_id uuid REFERENCES public.departments(id),
  request_id uuid NOT NULL REFERENCES public.requests(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  document_type text NOT NULL,
  request_version integer NOT NULL,
  source_version integer NOT NULL,
  source_reference text NOT NULL,
  locale text NOT NULL,
  timezone text NOT NULL,
  input_snapshot jsonb NOT NULL,
  input_sha256 text NOT NULL,
  company_logo_content bytea,
  company_logo_content_type text,
  company_logo_sha256 text,
  company_logo_version integer,
  template_version integer NOT NULL,
  generator_version text NOT NULL,
  generation_reason text NOT NULL,
  supersedes_document_id uuid,
  requested_by uuid REFERENCES public.users(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  maximum_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE(company_id,idempotency_key),
  CHECK (document_type IN (
    'APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER'
  )),
  CHECK (
    (document_type='SUPPLIER_PURCHASE_ORDER' AND supplier_id IS NOT NULL)
    OR (document_type<>'SUPPLIER_PURCHASE_ORDER' AND supplier_id IS NULL)
  ),
  CHECK (request_version>0 AND source_version>0),
  CHECK (locale IN ('en','ar','ms')),
  CHECK (char_length(timezone) BETWEEN 3 AND 100),
  CHECK (jsonb_typeof(input_snapshot)='object'),
  CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    (company_logo_content IS NULL AND company_logo_content_type IS NULL
      AND company_logo_sha256 IS NULL AND company_logo_version IS NULL)
    OR (company_logo_content IS NOT NULL
      AND company_logo_content_type IN ('image/jpeg','image/png','image/webp')
      AND company_logo_sha256 ~ '^[0-9a-f]{64}$'
      AND company_logo_version>0
      AND octet_length(company_logo_content)<=2097152)
  ),
  CHECK (template_version>0),
  CHECK (generator_version ~ '^[A-Za-z0-9._/-]{3,80}$'),
  CHECK (generation_reason IN ('WORKFLOW','REGENERATION','CORRECTION','AMENDMENT')),
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CHECK (status IN ('PENDING','PROCESSING','RETRY','COMPLETED','FAILED','CANCELLED')),
  CHECK (attempts>=0 AND maximum_attempts BETWEEN 1 AND 10),
  CHECK (last_error IS NULL OR char_length(last_error)<=500),
  CHECK (
    (status='PROCESSING' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status<>'PROCESSING' AND lease_id IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX document_generation_jobs_claim_idx
  ON public.document_generation_jobs(status,available_at,created_at)
  WHERE status IN ('PENDING','RETRY','PROCESSING');
CREATE INDEX document_generation_jobs_request_idx
  ON public.document_generation_jobs(request_id,document_type,created_at DESC);

CREATE TABLE public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id uuid NOT NULL UNIQUE
    REFERENCES public.document_generation_jobs(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  branch_id uuid REFERENCES public.branches(id),
  department_id uuid REFERENCES public.departments(id),
  request_id uuid NOT NULL REFERENCES public.requests(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  document_type text NOT NULL,
  visibility text NOT NULL,
  document_version integer NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'CURRENT',
  supersedes_document_id uuid REFERENCES public.generated_documents(id),
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  storage_path text NOT NULL,
  checksum_sha256 text NOT NULL,
  page_count integer NOT NULL,
  file_size_bytes bigint NOT NULL,
  input_sha256 text NOT NULL,
  template_version integer NOT NULL,
  generator_version text NOT NULL,
  source_version integer NOT NULL,
  generated_by uuid REFERENCES public.users(id),
  generated_at timestamptz NOT NULL,
  superseded_at timestamptz,
  UNIQUE(company_id,document_type,request_id,supplier_id,document_version),
  CHECK (document_type IN (
    'APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER'
  )),
  CHECK (visibility IN ('CUSTOMER','SUPPLIER')),
  CHECK (
    (document_type='SUPPLIER_PURCHASE_ORDER'
      AND visibility='SUPPLIER' AND supplier_id IS NOT NULL)
    OR (document_type<>'SUPPLIER_PURCHASE_ORDER'
      AND visibility='CUSTOMER' AND supplier_id IS NULL)
  ),
  CHECK (document_version>0 AND source_version>0 AND template_version>0),
  CHECK (lifecycle_status IN ('CURRENT','SUPERSEDED','CORRECTED','CANCELLED')),
  CHECK (char_length(file_name) BETWEEN 5 AND 180
    AND position('/' IN file_name)=0
    AND position(chr(92) IN file_name)=0
    AND file_name !~ '[[:cntrl:]]'),
  CHECK (content_type='application/pdf'),
  CHECK (storage_path ~ '^generated-documents/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  CHECK (storage_path !~ '(^|/)\.\.?(/|$)'),
  CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (page_count BETWEEN 1 AND 2000),
  CHECK (file_size_bytes BETWEEN 100 AND 26214400),
  CHECK (generator_version ~ '^[A-Za-z0-9._/-]{3,80}$'),
  CHECK (
    (lifecycle_status='CURRENT' AND superseded_at IS NULL)
    OR (lifecycle_status<>'CURRENT' AND superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX generated_documents_one_current_idx
  ON public.generated_documents(
    document_type,request_id,COALESCE(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE lifecycle_status='CURRENT';
CREATE INDEX generated_documents_request_idx
  ON public.generated_documents(request_id,document_type,document_version DESC);

ALTER TABLE public.document_generation_jobs
  ADD CONSTRAINT document_generation_jobs_supersedes_fk
  FOREIGN KEY(supersedes_document_id) REFERENCES public.generated_documents(id);

CREATE TABLE public.supplier_purchase_order_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES public.generated_documents(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  request_id uuid NOT NULL REFERENCES public.requests(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  revision integer NOT NULL,
  workflow_state text NOT NULL DEFAULT 'DRAFT',
  workflow_version integer NOT NULL DEFAULT 1,
  recipient_user_id uuid REFERENCES public.users(id),
  recipient_email_snapshot text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  dispatched_by uuid REFERENCES public.users(id),
  dispatched_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  acknowledged_at timestamptz,
  amended_at timestamptz,
  cancelled_at timestamptz,
  last_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revision>0 AND workflow_version>0),
  CHECK (workflow_state IN (
    'DRAFT','READY_FOR_SALES_REVIEW','APPROVED_FOR_DISPATCH',
    'DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED','AMENDED','CANCELLED'
  )),
  CHECK (
    (recipient_user_id IS NULL AND recipient_email_snapshot IS NULL)
    OR (recipient_user_id IS NOT NULL
      AND recipient_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  ),
  CHECK (last_reason IS NULL OR char_length(last_reason) BETWEEN 3 AND 500)
);

CREATE INDEX supplier_po_workflows_queue_idx
  ON public.supplier_purchase_order_workflows(workflow_state,updated_at DESC);

CREATE TABLE public.document_generation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  job_id uuid NOT NULL REFERENCES public.document_generation_jobs(id),
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id),
  command_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,command_id),
  CHECK (event_type IN (
    'QUEUED','CLAIMED','RETRY_SCHEDULED','FAILED','COMPLETED','CANCELLED'
  )),
  CHECK (reason IS NULL OR char_length(reason)<=500),
  CHECK (jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata))
);

CREATE TABLE public.supplier_purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  workflow_id uuid NOT NULL REFERENCES public.supplier_purchase_order_workflows(id),
  document_id uuid NOT NULL REFERENCES public.generated_documents(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  state_before text,
  state_after text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id),
  recipient_user_id uuid REFERENCES public.users(id),
  recipient_email_snapshot text,
  command_id uuid NOT NULL UNIQUE,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state_before IS NULL OR state_before IN (
    'DRAFT','READY_FOR_SALES_REVIEW','APPROVED_FOR_DISPATCH',
    'DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED','AMENDED','CANCELLED'
  )),
  CHECK (state_after IN (
    'DRAFT','READY_FOR_SALES_REVIEW','APPROVED_FOR_DISPATCH',
    'DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED','AMENDED','CANCELLED'
  )),
  CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 500)
);

CREATE TABLE public.document_enqueue_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  request_id uuid NOT NULL REFERENCES public.requests(id),
  source_key text NOT NULL,
  error_code text NOT NULL,
  error_summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,source_key),
  CHECK (char_length(source_key) BETWEEN 8 AND 200),
  CHECK (error_code ~ '^[A-Z0-9]{5}$'),
  CHECK (char_length(error_summary) BETWEEN 1 AND 500)
);

CREATE OR REPLACE FUNCTION public.axora_document_json_has_forbidden_key(
  p_value jsonb,
  p_forbidden text[]
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  item_key text;
  item_value jsonb;
  normalized_key text;
BEGIN
  IF p_value IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_value)='object' THEN
    FOR item_key,item_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
      normalized_key:=lower(regexp_replace(item_key,'[^A-Za-z0-9]','','g'));
      IF EXISTS (
        SELECT 1 FROM unnest(p_forbidden) forbidden_key
        WHERE normalized_key LIKE forbidden_key||'%'
      ) THEN RETURN true; END IF;
      IF public.axora_document_json_has_forbidden_key(item_value,p_forbidden) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value)='array' THEN
    FOR item_value IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.axora_document_json_has_forbidden_key(item_value,p_forbidden) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_assert_document_snapshot_safe(
  p_document_type text,
  p_snapshot jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE forbidden text[];
BEGIN
  IF jsonb_typeof(p_snapshot)<>'object' THEN
    RAISE EXCEPTION 'The document snapshot is invalid';
  END IF;
  forbidden:=ARRAY[
    'password','passwordhash','token','secret','sessionid','internalnotes'
  ];
  IF p_document_type IN ('APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY') THEN
    forbidden:=forbidden||ARRAY[
      'supplier','supplierid','suppliername','suppliercode','supplierunitprice',
      'quotationreference','unitbuyprice','buyunitprice','baseunitprice',
      'buycost','basecost','actualbuyunitprice',
      'commercialbasecostsnapshot','commercialmarkuppercentagesnapshot',
      'markup','margin','paymentterms'
    ];
  ELSIF p_document_type='SUPPLIER_PURCHASE_ORDER' THEN
    forbidden:=forbidden||ARRAY[
      'budget','budgetaccount','budgetbalance','remainingreserved','spentamount',
      'releasedamount','contractualceiling','companyceiling','requester',
      'approver','driver','deliveryagent','actualbuyunitprice','markup','margin',
      'othersupplier'
    ];
  ELSE
    RAISE EXCEPTION 'The document type is invalid';
  END IF;
  IF public.axora_document_json_has_forbidden_key(p_snapshot,forbidden) THEN
    RAISE EXCEPTION 'The document snapshot contains a forbidden field';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_build_approved_request_document_snapshot(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  context record;
  lines_value jsonb;
  decisions_value jsonb;
  budget_value jsonb;
  snapshot_value jsonb;
BEGIN
  SELECT r.*,
    company.name AS company_name,
    company.legal_name AS company_legal_name,
    company.default_locale AS company_locale,
    company.timezone AS company_timezone,
    company.document_budget_balance_visible,
    company.document_receipt_policy,
    branch.name AS branch_name,
    branch.branch_code,
    branch.delivery_address,
    branch.delivery_instructions,
    COALESCE(department.name,r.department) AS department_name,
    department.department_code,
    cost_centre.name AS cost_centre_name,
    cost_centre.cost_centre_code,
    COALESCE(requester.display_name,r.requested_by) AS requester_name,
    requester.email AS requester_email
  INTO context
  FROM public.requests r
  JOIN public.companies company ON company.id=r.company_id
  LEFT JOIN public.branches branch ON branch.id=r.branch_id
  LEFT JOIN public.departments department ON department.id=r.department_id
  LEFT JOIN public.cost_centres cost_centre ON cost_centre.id=r.cost_centre_id
  LEFT JOIN public.users requester ON requester.id=r.created_by
  WHERE r.id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The request is unavailable'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'lineReference',line.request_line_code,
    'sku',product.product_code,
    'name',COALESCE(line.product_name_snapshot,product.name),
    'description',product.description,
    'specification',line.specification,
    'quantity',line.quantity,
    'unitOfMeasure',line.unit_of_measure,
    'neededByDate',line.needed_by_date,
    'unitSellPrice',line.unit_sell_price,
    'deliveryCharge',COALESCE(line.delivery_charge,0),
    'taxRate',context.tax_rate,
    'lineSubtotal',round(line.quantity*COALESCE(line.unit_sell_price,0),2),
    'lineTotal',round(
      (line.quantity*COALESCE(line.unit_sell_price,0)+COALESCE(line.delivery_charge,0))
      *(1+context.tax_rate/100),2
    )
  )) ORDER BY line.created_at,line.id),'[]'::jsonb)
  INTO lines_value
  FROM public.request_lines line
  LEFT JOIN public.products product ON product.id=line.product_id
  WHERE line.request_id=p_request_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'action',decision.action,
    'stateAfter',decision.state_after,
    'actorName',actor.display_name,
    'role',role.role_key,
    'decidedAt',decision.decided_at,
    'approvalLimit',decision.approval_limit
  )) ORDER BY decision.decided_at,decision.id),'[]'::jsonb)
  INTO decisions_value
  FROM public.request_approval_decisions decision
  LEFT JOIN public.users actor ON actor.id=decision.actor_user_id
  LEFT JOIN public.role_assignments assignment
    ON assignment.id=decision.actor_role_assignment_id
  LEFT JOIN public.roles role ON role.id=assignment.role_id
  WHERE decision.request_id=p_request_id;

  IF context.document_budget_balance_visible THEN
    SELECT COALESCE(jsonb_build_object(
      'accountCode',account.account_code,
      'accountName',account.name,
      'currency',reservation.currency,
      'reservedAmount',reservation.reserved_amount,
      'remainingAmount',reservation.remaining_reserved,
      'status',reservation.status
    ),'null'::jsonb)
    INTO budget_value
    FROM public.budget_reservations reservation
    JOIN public.budget_accounts account ON account.id=reservation.budget_account_id
    WHERE reservation.request_id=p_request_id
      AND reservation.request_version=context.request_version
    ORDER BY reservation.created_at DESC LIMIT 1;
  ELSE
    budget_value:='null'::jsonb;
  END IF;

  snapshot_value:=jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion',1,
    'documentType','APPROVED_REQUEST',
    'locale',CASE WHEN context.company_locale IN ('en','ar','ms')
      THEN context.company_locale ELSE 'en' END,
    'timezone',COALESCE(context.company_timezone,'Asia/Kuala_Lumpur'),
    'capturedAt',p_at,
    'request',jsonb_strip_nulls(jsonb_build_object(
      'reference',context.order_code,
      'version',context.request_version,
      'status',context.approval_state,
      'requestDate',context.request_date,
      'neededByDate',context.needed_by_date,
      'currency',context.currency,
      'notes',context.notes,
      'company',jsonb_strip_nulls(jsonb_build_object(
        'name',context.company_name,'legalName',context.company_legal_name
      )),
      'branch',jsonb_strip_nulls(jsonb_build_object(
        'name',context.branch_name,'code',context.branch_code
      )),
      'department',jsonb_strip_nulls(jsonb_build_object(
        'name',context.department_name,'code',context.department_code
      )),
      'costCentre',jsonb_strip_nulls(jsonb_build_object(
        'name',context.cost_centre_name,'code',context.cost_centre_code
      )),
      'requester',jsonb_strip_nulls(jsonb_build_object(
        'name',context.requester_name,'email',context.requester_email
      )),
      'delivery',jsonb_strip_nulls(jsonb_build_object(
        'address',context.delivery_address,
        'instructions',context.delivery_instructions
      ))
    )),
    'lines',lines_value,
    'approval',jsonb_build_object(
      'state',context.approval_state,
      'revision',context.approval_revision,
      'submittedAt',context.approval_submitted_at,
      'decidedAt',context.approval_decided_at,
      'decisions',decisions_value
    ),
    'totals',jsonb_build_object(
      'subtotal',COALESCE((SELECT sum(
        line.quantity*COALESCE(line.unit_sell_price,0)
      ) FROM public.request_lines line WHERE line.request_id=p_request_id),0),
      'delivery',COALESCE((SELECT sum(COALESCE(line.delivery_charge,0))
        FROM public.request_lines line WHERE line.request_id=p_request_id),0),
      'tax',context.tax_amount,
      'grandTotal',COALESCE((SELECT sum(
        line.quantity*COALESCE(line.unit_sell_price,0)+COALESCE(line.delivery_charge,0)
      ) FROM public.request_lines line WHERE line.request_id=p_request_id),0)
        +context.tax_amount,
      'currency',context.currency
    ),
    'budget',budget_value,
    'disclaimer','Approved estimate. Final quantities and charges may change through the controlled fulfilment workflow.',
    'metadata',jsonb_build_object(
      'requestVersion',context.request_version,
      'approvalRevision',context.approval_revision
    )
  ));
  PERFORM public.axora_assert_document_snapshot_safe(
    'APPROVED_REQUEST',snapshot_value
  );
  RETURN snapshot_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_build_final_delivery_document_snapshot(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  base_value jsonb;
  actual_row record;
  job_row record;
  actual_lines jsonb;
  unavailable_lines jsonb;
  timeline_value jsonb;
  evidence_value jsonb;
  history_value jsonb;
  delivery_agent_name text;
  recipient_name text;
  otp_verified boolean;
  snapshot_value jsonb;
BEGIN
  base_value:=public.axora_build_approved_request_document_snapshot(
    p_request_id,p_at
  );
  SELECT submission.* INTO actual_row
  FROM public.request_actual_submissions submission
  WHERE submission.request_id=p_request_id
    AND submission.purchase_mode='FINAL' AND submission.state='FINALIZED'
  ORDER BY submission.finalized_at DESC,submission.id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The final purchase is unavailable'; END IF;

  SELECT job.* INTO job_row FROM public.delivery_jobs job
  WHERE job.request_id=p_request_id AND job.status='COMPLETED'
    AND public.axora_delivery_job_has_required_proof(job.id)
  ORDER BY job.status_changed_at DESC,job.id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The completed delivery is unavailable'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'lineReference',line.request_line_id,
    'originalName',COALESCE(original.product_name_snapshot,estimated.name),
    'actualSku',actual_product.product_code,
    'actualName',actual_product.name,
    'quantity',line.quantity,
    'unitOfMeasure',line.unit_of_measure,
    'customerUnitPrice',line.customer_unit_price,
    'taxRate',line.tax_rate,
    'taxAmount',line.tax_amount,
    'deliveryCharge',line.delivery_charge,
    'otherCharge',line.other_charge,
    'lineTotal',line.line_total,
    'substituteReason',line.substitute_reason,
    'changed',line.actual_product_id<>line.estimated_product_id
  )) ORDER BY line.created_at,line.id),'[]'::jsonb)
  INTO actual_lines
  FROM public.request_actual_lines line
  JOIN public.request_lines original ON original.id=line.request_line_id
  LEFT JOIN public.products estimated ON estimated.id=line.estimated_product_id
  LEFT JOIN public.products actual_product ON actual_product.id=line.actual_product_id
  WHERE line.submission_id=actual_row.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineReference',line.request_line_code,
    'name',COALESCE(line.product_name_snapshot,product.name),
    'requestedQuantity',line.quantity,
    'unitOfMeasure',line.unit_of_measure
  ) ORDER BY line.created_at,line.id),'[]'::jsonb)
  INTO unavailable_lines
  FROM public.request_lines line
  LEFT JOIN public.products product ON product.id=line.product_id
  WHERE line.request_id=p_request_id
    AND NOT EXISTS (
      SELECT 1 FROM public.request_actual_lines actual_line
      WHERE actual_line.submission_id=actual_row.id
        AND actual_line.request_line_id=line.id
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event',event.event_type,
    'recordedAt',event.received_at,
    'localRecordedAt',event.client_local_recorded_at,
    'timezone',event.destination_timezone_snapshot
  ) ORDER BY event.received_at,event.id),'[]'::jsonb)
  INTO timeline_value
  FROM public.delivery_job_events event
  WHERE event.delivery_job_id=job_row.id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'type',evidence.evidence_type,
    'reference',evidence.id,
    'version',evidence.evidence_version,
    'checksum',evidence.sha256,
    'capturedAt',evidence.captured_at,
    'recipientIdentity',evidence.recipient_identity,
    'consentedAt',evidence.consented_at
  )) ORDER BY evidence.captured_at,evidence.id),'[]'::jsonb),
    max(evidence.recipient_identity) FILTER (
      WHERE evidence.evidence_type='SIGNATURE'
    )
  INTO evidence_value,recipient_name
  FROM public.delivery_evidence evidence
  WHERE evidence.delivery_job_id=job_row.id
    AND evidence.validation_status='ACCEPTED'
    AND evidence.malware_status<>'QUARANTINED';

  SELECT actor.display_name INTO delivery_agent_name
  FROM public.delivery_job_assignments assignment
  JOIN public.users actor ON actor.id=assignment.driver_user_id
  WHERE assignment.delivery_job_id=job_row.id
  ORDER BY assignment.assigned_at DESC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.delivery_otp_challenges challenge
    WHERE challenge.delivery_job_id=job_row.id AND challenge.status='VERIFIED'
  ) INTO otp_verified;

  SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.occurred_at,entry.sort_id),'[]'::jsonb)
  INTO history_value
  FROM (
    SELECT decision.decided_at AS occurred_at,decision.id AS sort_id,
      jsonb_build_object(
        'type','APPROVAL','action',decision.action,
        'state',decision.state_after,'occurredAt',decision.decided_at
      ) AS value
    FROM public.request_approval_decisions decision
    WHERE decision.request_id=p_request_id
    UNION ALL
    SELECT submission.submitted_at,submission.id,
      jsonb_build_object(
        'type','ACTUAL_PURCHASE','action',submission.purchase_mode,
        'state',submission.state,'occurredAt',submission.submitted_at
      )
    FROM public.request_actual_submissions submission
    WHERE submission.request_id=p_request_id
    UNION ALL
    SELECT event.received_at,event.id,
      jsonb_build_object(
        'type','DELIVERY','action',event.event_type,
        'occurredAt',event.received_at
      )
    FROM public.delivery_job_events event
    WHERE event.delivery_job_id=job_row.id
  ) entry;

  snapshot_value:=(base_value-'documentType'-'lines'-'totals'-'disclaimer')
    ||jsonb_strip_nulls(jsonb_build_object(
      'documentType','FINAL_FULFILMENT_DELIVERY',
      'original',jsonb_build_object(
        'lines',base_value->'lines','totals',base_value->'totals'
      ),
      'actual',jsonb_build_object(
        'purchaseMode',actual_row.purchase_mode,
        'estimateAmount',actual_row.estimate_amount,
        'actualAmount',actual_row.cumulative_actual_amount,
        'differenceAmount',actual_row.difference_amount,
        'withinTolerance',actual_row.within_tolerance,
        'lines',actual_lines,
        'unavailableLines',unavailable_lines,
        'receiptReference',actual_row.receipt_attachment_id,
        'finalizedAt',actual_row.finalized_at
      ),
      'delivery',jsonb_build_object(
        'reference',job_row.job_code,
        'status',job_row.status,
        'address',job_row.delivery_address_snapshot,
        'scheduledStart',job_row.scheduled_window_start,
        'scheduledEnd',job_row.scheduled_window_end,
        'timezone',job_row.destination_timezone,
        'agentName',delivery_agent_name,
        'recipientName',recipient_name,
        'otpVerified',otp_verified,
        'timeline',timeline_value,
        'evidence',evidence_value
      ),
      'history',history_value,
      'disclaimer','Final customer record of approved, purchased and delivered items. Private sourcing and buying data is excluded.',
      'metadata',(base_value->'metadata')||jsonb_build_object(
        'actualRevision',actual_row.approval_revision,
        'deliveryVersion',job_row.workflow_version
      )
    ));
  PERFORM public.axora_assert_document_snapshot_safe(
    'FINAL_FULFILMENT_DELIVERY',snapshot_value
  );
  RETURN snapshot_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_build_supplier_po_document_snapshot(
  p_request_id uuid,
  p_supplier_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  context record;
  lines_value jsonb;
  warnings_value jsonb;
  selected_locale text;
  snapshot_value jsonb;
BEGIN
  SELECT r.*,
    company.name AS ship_to_company,
    company.legal_name AS ship_to_legal_name,
    branch.name AS branch_name,
    branch.delivery_address,
    branch.delivery_instructions,
    supplier.name AS supplier_name,
    supplier.supplier_code,
    supplier.address AS supplier_address,
    supplier.payment_terms AS supplier_terms
  INTO context
  FROM public.requests r
  JOIN public.companies company ON company.id=r.company_id
  LEFT JOIN public.branches branch ON branch.id=r.branch_id
  JOIN public.suppliers supplier ON supplier.id=p_supplier_id AND supplier.active
  WHERE r.id=p_request_id
    AND EXISTS (
      SELECT 1 FROM public.request_lines line
      WHERE line.request_id=r.id AND line.selected_supplier_id=p_supplier_id
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'The supplier order is unavailable'; END IF;

  SELECT COALESCE(profile.preferred_locale,'en') INTO selected_locale
  FROM public.supplier_memberships membership
  JOIN public.users account ON account.id=membership.user_id
    AND account.active AND account.account_status='ACTIVE'
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE membership.supplier_id=p_supplier_id
    AND membership.status='ACTIVE' AND membership.ended_at IS NULL
  ORDER BY membership.created_at,membership.id LIMIT 1;
  selected_locale:=CASE WHEN selected_locale IN ('en','ar','ms')
    THEN selected_locale ELSE 'en' END;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'lineReference',line.request_line_code,
    'sku',product.product_code,
    'name',COALESCE(line.product_name_snapshot,product.name),
    'description',product.description,
    'specification',line.specification,
    'quantity',line.quantity,
    'unitOfMeasure',line.unit_of_measure,
    'neededByDate',line.needed_by_date,
    'quoteReference',quote.quotation_reference,
    'supplierUnitPrice',quote.unit_price,
    'deliveryCharge',quote.delivery_charge,
    'lineTotal',CASE WHEN quote.unit_price IS NULL THEN NULL
      ELSE round(line.quantity*quote.unit_price+COALESCE(quote.delivery_charge,0),2)
      END
  )) ORDER BY line.created_at,line.id),'[]'::jsonb)
  INTO lines_value
  FROM public.request_lines line
  LEFT JOIN public.products product ON product.id=line.product_id
  LEFT JOIN LATERAL (
    SELECT quotation.quotation_reference,quotation.unit_price,
      quotation.delivery_charge,quotation.valid_until
    FROM public.quotations quotation
    WHERE quotation.request_line_id=line.id
      AND quotation.supplier_id=p_supplier_id AND quotation.selected
    ORDER BY quotation.updated_at DESC,quotation.id DESC LIMIT 1
  ) quote ON true
  WHERE line.request_id=p_request_id
    AND line.selected_supplier_id=p_supplier_id;

  SELECT COALESCE(jsonb_agg(warning ORDER BY warning),'[]'::jsonb)
  INTO warnings_value
  FROM (
    SELECT DISTINCT warning
    FROM public.request_lines line
    LEFT JOIN LATERAL (
      SELECT quotation.unit_price,quotation.valid_until
      FROM public.quotations quotation
      WHERE quotation.request_line_id=line.id
        AND quotation.supplier_id=p_supplier_id AND quotation.selected
      ORDER BY quotation.updated_at DESC,quotation.id DESC LIMIT 1
    ) quote ON true
    CROSS JOIN LATERAL unnest(ARRAY[
      CASE WHEN quote.unit_price IS NULL THEN 'MISSING_SELECTED_QUOTATION' END,
      CASE WHEN quote.valid_until IS NOT NULL AND quote.valid_until<p_at::date
        THEN 'QUOTATION_EXPIRED' END
    ]) warning
    WHERE line.request_id=p_request_id
      AND line.selected_supplier_id=p_supplier_id AND warning IS NOT NULL
  ) warnings;

  snapshot_value:=jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion',1,
    'documentType','SUPPLIER_PURCHASE_ORDER',
    'locale',selected_locale,
    'timezone',COALESCE(
      (SELECT company.timezone FROM public.companies company WHERE company.id=context.company_id),
      'Asia/Kuala_Lumpur'
    ),
    'capturedAt',p_at,
    'purchaseOrder',jsonb_build_object(
      'reference','PO-'||context.order_code||'-'||context.supplier_code,
      'requestReference',context.order_code,
      'requestVersion',context.request_version,
      'currency',context.currency,
      'neededByDate',context.needed_by_date,
      'buyerName','Axora',
      'status','DRAFT'
    ),
    'supplier',jsonb_strip_nulls(jsonb_build_object(
      'code',context.supplier_code,
      'name',context.supplier_name,
      'address',context.supplier_address,
      'terms',context.supplier_terms
    )),
    'shipTo',jsonb_strip_nulls(jsonb_build_object(
      'company',COALESCE(context.ship_to_legal_name,context.ship_to_company),
      'branch',context.branch_name,
      'address',context.delivery_address,
      'instructions',context.delivery_instructions
    )),
    'lines',lines_value,
    'totals',jsonb_build_object(
      'subtotal',COALESCE((SELECT sum(line.quantity*quotation.unit_price)
        FROM public.request_lines line
        JOIN LATERAL (
          SELECT quote.unit_price FROM public.quotations quote
          WHERE quote.request_line_id=line.id
            AND quote.supplier_id=p_supplier_id AND quote.selected
          ORDER BY quote.updated_at DESC,quote.id DESC LIMIT 1
        ) quotation ON true
        WHERE line.request_id=p_request_id
          AND line.selected_supplier_id=p_supplier_id),0),
      'delivery',COALESCE((SELECT sum(COALESCE(quotation.delivery_charge,0))
        FROM public.request_lines line
        JOIN LATERAL (
          SELECT quote.delivery_charge FROM public.quotations quote
          WHERE quote.request_line_id=line.id
            AND quote.supplier_id=p_supplier_id AND quote.selected
          ORDER BY quote.updated_at DESC,quote.id DESC LIMIT 1
        ) quotation ON true
        WHERE line.request_id=p_request_id
          AND line.selected_supplier_id=p_supplier_id),0),
      'currency',context.currency
    ),
    'warnings',warnings_value,
    'terms','Supply only the listed items and quantities. Amendments require a new version issued through Axora.',
    'metadata',jsonb_build_object(
      'requestVersion',context.request_version,
      'approvalRevision',context.approval_revision
    )
  ));
  PERFORM public.axora_assert_document_snapshot_safe(
    'SUPPLIER_PURCHASE_ORDER',snapshot_value
  );
  RETURN snapshot_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_queue_document_generation_job(
  p_document_type text,
  p_request_id uuid,
  p_supplier_id uuid,
  p_generation_reason text,
  p_requested_by uuid,
  p_idempotency_key text,
  p_supersedes_document_id uuid,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request_row record;
  template_row record;
  logo_content_value bytea;
  logo_content_type_value text;
  logo_sha256_value text;
  logo_version_value integer;
  snapshot_value jsonb;
  source_version_value integer;
  locale_value text;
  job_id_value uuid;
BEGIN
  SELECT request.id,request.company_id,request.branch_id,request.department_id,
    request.request_version,request.approval_revision,
    company.default_locale,company.timezone
  INTO request_row
  FROM public.requests request
  JOIN public.companies company ON company.id=request.company_id
  WHERE request.id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The document source is unavailable'; END IF;

  SELECT * INTO template_row FROM public.document_templates
  WHERE document_type=p_document_type AND active
  ORDER BY template_version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The document template is unavailable'; END IF;

  IF p_document_type='APPROVED_REQUEST' THEN
    snapshot_value:=public.axora_build_approved_request_document_snapshot(
      p_request_id,p_at
    );
    source_version_value:=request_row.approval_revision;
  ELSIF p_document_type='FINAL_FULFILMENT_DELIVERY' THEN
    snapshot_value:=public.axora_build_final_delivery_document_snapshot(
      p_request_id,p_at
    );
    source_version_value:=COALESCE(
      (snapshot_value->'metadata'->>'actualRevision')::integer,
      request_row.approval_revision
    );
  ELSIF p_document_type='SUPPLIER_PURCHASE_ORDER' THEN
    snapshot_value:=public.axora_build_supplier_po_document_snapshot(
      p_request_id,p_supplier_id,p_at
    );
    source_version_value:=request_row.approval_revision;
  ELSE
    RAISE EXCEPTION 'The document type is invalid';
  END IF;
  PERFORM public.axora_assert_document_snapshot_safe(p_document_type,snapshot_value);
  locale_value:=COALESCE(snapshot_value->>'locale','en');

  IF p_document_type<>'SUPPLIER_PURCHASE_ORDER' THEN
    SELECT logo.logo_content,logo.content_type,logo.sha256,logo.version
    INTO logo_content_value,logo_content_type_value,logo_sha256_value,logo_version_value
    FROM public.company_logos logo
    WHERE logo.company_id=request_row.company_id AND logo.active
    ORDER BY logo.version DESC LIMIT 1;
  END IF;

  INSERT INTO public.document_generation_jobs(
    company_id,branch_id,department_id,request_id,supplier_id,document_type,
    request_version,source_version,source_reference,locale,timezone,
    input_snapshot,input_sha256,company_logo_content,
    company_logo_content_type,company_logo_sha256,company_logo_version,
    template_version,generator_version,generation_reason,
    supersedes_document_id,requested_by,idempotency_key,available_at,created_at
  ) VALUES (
    request_row.company_id,request_row.branch_id,request_row.department_id,
    p_request_id,p_supplier_id,p_document_type,request_row.request_version,
    source_version_value,p_request_id::text,locale_value,
    COALESCE(snapshot_value->>'timezone',request_row.timezone,'Asia/Kuala_Lumpur'),
    snapshot_value,
    encode(pg_catalog.sha256(convert_to(snapshot_value::text,'UTF8')),'hex'),
    logo_content_value,logo_content_type_value,logo_sha256_value,logo_version_value,
    template_row.template_version,template_row.generator_version,
    p_generation_reason,p_supersedes_document_id,p_requested_by,
    p_idempotency_key,p_at,p_at
  ) ON CONFLICT(company_id,idempotency_key) DO NOTHING
  RETURNING id INTO job_id_value;
  IF job_id_value IS NULL THEN
    SELECT id INTO job_id_value FROM public.document_generation_jobs
    WHERE company_id=request_row.company_id
      AND idempotency_key=p_idempotency_key;
  ELSE
    INSERT INTO public.document_generation_events(
      company_id,job_id,event_type,actor_user_id,reason,occurred_at
    ) VALUES (
      request_row.company_id,job_id_value,'QUEUED',p_requested_by,
      p_generation_reason,p_at
    );
  END IF;
  RETURN job_id_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_enqueue_approval_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_id uuid;
  supplier_id_value uuid;
BEGIN
  IF NEW.job_type<>'REQUEST_PDF' THEN RETURN NEW; END IF;
  SELECT decision.actor_user_id INTO actor_id
  FROM public.request_approval_decisions decision
  WHERE decision.request_id=NEW.request_id
    AND decision.approval_revision_after=NEW.approval_revision
  ORDER BY decision.decided_at DESC LIMIT 1;
  PERFORM public.axora_queue_document_generation_job(
    'APPROVED_REQUEST',NEW.request_id,NULL,'WORKFLOW',actor_id,
    'approval:'||NEW.request_id||':'||NEW.request_version||':'||NEW.approval_revision,
    NULL,NEW.created_at
  );
  FOR supplier_id_value IN
    SELECT DISTINCT line.selected_supplier_id
    FROM public.request_lines line
    WHERE line.request_id=NEW.request_id
      AND line.selected_supplier_id IS NOT NULL
  LOOP
    PERFORM public.axora_queue_document_generation_job(
      'SUPPLIER_PURCHASE_ORDER',NEW.request_id,supplier_id_value,'WORKFLOW',
      actor_id,'supplier-po:'||NEW.request_id||':'||supplier_id_value||':'
        ||NEW.request_version||':'||NEW.approval_revision,
      NULL,NEW.created_at
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.document_enqueue_failures(
    company_id,request_id,source_key,error_code,error_summary,created_at
  ) VALUES (
    NEW.company_id,NEW.request_id,'approval-outbox:'||NEW.id,SQLSTATE,
    left(SQLERRM,500),NEW.created_at
  ) ON CONFLICT(company_id,source_key) DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER request_approval_enqueue_generated_documents
AFTER INSERT ON public.request_approval_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_enqueue_approval_documents();

CREATE OR REPLACE FUNCTION public.axora_maybe_enqueue_final_document(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  request_row record;
  actual_row record;
  job_row record;
BEGIN
  SELECT request.* INTO request_row FROM public.requests request
  WHERE request.id=p_request_id AND request.approval_state<>'CANCELLED';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT submission.id,submission.approval_revision,submission.finalized_at
  INTO actual_row FROM public.request_actual_submissions submission
  WHERE submission.request_id=p_request_id
    AND submission.purchase_mode='FINAL' AND submission.state='FINALIZED'
  ORDER BY submission.finalized_at DESC,submission.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT job.id,job.workflow_version,job.status_changed_at
  INTO job_row FROM public.delivery_jobs job
  WHERE job.request_id=p_request_id AND job.status='COMPLETED'
    AND public.axora_delivery_job_has_required_proof(job.id)
  ORDER BY job.status_changed_at DESC,job.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.axora_queue_document_generation_job(
    'FINAL_FULFILMENT_DELIVERY',p_request_id,NULL,'WORKFLOW',NULL,
    'final-document:'||p_request_id||':'||request_row.request_version||':'
      ||actual_row.approval_revision||':'||job_row.workflow_version,
    NULL,p_at
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

CREATE OR REPLACE FUNCTION public.axora_enqueue_final_document_from_actual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.purchase_mode='FINAL' AND NEW.state='FINALIZED' THEN
    PERFORM public.axora_maybe_enqueue_final_document(NEW.request_id,now());
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_enqueue_final_document_from_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.status='COMPLETED' THEN
    PERFORM public.axora_maybe_enqueue_final_document(NEW.request_id,now());
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER request_actual_enqueue_final_document
AFTER INSERT OR UPDATE OF state ON public.request_actual_submissions
FOR EACH ROW EXECUTE FUNCTION public.axora_enqueue_final_document_from_actual();

CREATE TRIGGER delivery_job_enqueue_final_document
AFTER INSERT OR UPDATE OF status ON public.delivery_jobs
FOR EACH ROW EXECUTE FUNCTION public.axora_enqueue_final_document_from_delivery();

CREATE OR REPLACE FUNCTION public.axora_cancel_request_document_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE job_row record;
DECLARE workflow_row record;
BEGIN
  IF NEW.approval_state<>'CANCELLED'
    OR OLD.approval_state='CANCELLED' THEN RETURN NEW; END IF;
  FOR job_row IN
    UPDATE public.document_generation_jobs
    SET status='CANCELLED',cancelled_at=now(),lease_id=NULL,
      lease_expires_at=NULL,last_error='Request cancelled'
    WHERE request_id=NEW.id AND status IN ('PENDING','RETRY')
    RETURNING id,company_id
  LOOP
    INSERT INTO public.document_generation_events(
      company_id,job_id,event_type,actor_user_id,reason,occurred_at
    ) VALUES (
      job_row.company_id,job_row.id,'CANCELLED',
      public.axora_context_user_id(),'Request cancelled',now()
    );
  END LOOP;
  FOR workflow_row IN
    UPDATE public.supplier_purchase_order_workflows
    SET workflow_state='CANCELLED',workflow_version=workflow_version+1,
      cancelled_at=now(),last_reason='Request cancelled',updated_at=now()
    WHERE request_id=NEW.id
      AND workflow_state NOT IN ('CANCELLED','AMENDED','ACKNOWLEDGED')
    RETURNING *
  LOOP
    INSERT INTO public.supplier_purchase_order_events(
      company_id,workflow_id,document_id,supplier_id,state_before,state_after,
      actor_user_id,recipient_user_id,recipient_email_snapshot,command_id,
      reason,occurred_at
    ) VALUES (
      workflow_row.company_id,workflow_row.id,workflow_row.document_id,
      workflow_row.supplier_id,NULL,'CANCELLED',
      public.axora_context_user_id(),workflow_row.recipient_user_id,
      workflow_row.recipient_email_snapshot,gen_random_uuid(),
      'Request cancelled',now()
    );
  END LOOP;
  RETURN NEW;
END
$$;

CREATE TRIGGER requests_cancel_generated_documents
AFTER UPDATE OF approval_state ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.axora_cancel_request_document_jobs();

CREATE OR REPLACE FUNCTION public.axora_document_request_permission(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_request_id uuid,
  p_permission text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(public.axora_role_assignment_has_direct_permission(
    p_actor_user_id,p_actor_role_assignment_id,p_permission,
    CASE WHEN request.department_id IS NOT NULL THEN 'DEPARTMENT'
      WHEN request.branch_id IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END,
    request.company_id,request.branch_id,request.department_id,NULL,p_at
  ),false)
  FROM public.requests request WHERE request.id=p_request_id
$$;

CREATE OR REPLACE FUNCTION public.axora_document_supplier_permission(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_supplier_id uuid,
  p_permission text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(public.axora_role_assignment_has_direct_permission(
    p_actor_user_id,p_actor_role_assignment_id,p_permission,'SUPPLIER',
    NULL,NULL,NULL,p_supplier_id,p_at
  ),false)
$$;

CREATE OR REPLACE FUNCTION public.axora_generated_document_access_allowed(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_document_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE document_row record;
BEGIN
  SELECT document.*,workflow.workflow_state
  INTO document_row
  FROM public.generated_documents document
  LEFT JOIN public.supplier_purchase_order_workflows workflow
    ON workflow.document_id=document.id
  WHERE document.id=p_document_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF document_row.visibility='CUSTOMER' THEN
    RETURN public.axora_document_request_permission(
      p_actor_user_id,p_actor_role_assignment_id,document_row.request_id,
      'document.download',p_at
    );
  END IF;
  IF public.axora_document_request_permission(
    p_actor_user_id,p_actor_role_assignment_id,document_row.request_id,
    'document.dispatch.supplier',p_at
  ) THEN RETURN true; END IF;
  RETURN document_row.workflow_state IN (
      'DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED','CANCELLED'
    )
    AND EXISTS (
      SELECT 1 FROM public.supplier_memberships membership
      JOIN public.users account ON account.id=membership.user_id
      WHERE membership.user_id=p_actor_user_id
        AND membership.supplier_id=document_row.supplier_id
        AND membership.status='ACTIVE' AND membership.ended_at IS NULL
        AND account.active AND account.account_status='ACTIVE'
    )
    AND public.axora_document_supplier_permission(
      p_actor_user_id,p_actor_role_assignment_id,document_row.supplier_id,
      'document.download',p_at
    );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_generated_document_download(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_document_id uuid,
  p_at timestamptz
)
RETURNS TABLE(
  document_id uuid,file_name text,content_type text,storage_path text,
  checksum_sha256 text,file_size_bytes bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT document.id,document.file_name,document.content_type,
    document.storage_path,document.checksum_sha256,document.file_size_bytes
  FROM public.generated_documents document
  WHERE document.id=p_document_id
    AND public.axora_generated_document_access_allowed(
      p_actor_user_id,p_actor_role_assignment_id,document.id,p_at
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_generated_document_workspace(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'capturedAt',p_at,
    'documents',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',document.id,'type',document.document_type,
        'requestId',document.request_id,'requestReference',request.order_code,
        'supplierId',document.supplier_id,'supplierName',supplier.name,
        'version',document.document_version,'status',document.lifecycle_status,
        'fileName',document.file_name,'checksum',document.checksum_sha256,
        'pageCount',document.page_count,'fileSize',document.file_size_bytes,
        'templateVersion',document.template_version,
        'generatorVersion',document.generator_version,
        'generatedAt',document.generated_at,
        'downloadUrl','/api/generated-documents/'||document.id
      ) ORDER BY document.generated_at DESC,document.id)
      FROM public.generated_documents document
      JOIN public.requests request ON request.id=document.request_id
      LEFT JOIN public.suppliers supplier ON supplier.id=document.supplier_id
      WHERE public.axora_generated_document_access_allowed(
        p_actor_user_id,p_actor_role_assignment_id,document.id,p_at
      )
    ),'[]'::jsonb),
    'jobs',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',job.id,'type',job.document_type,
        'requestId',job.request_id,'requestReference',request.order_code,
        'supplierName',supplier.name,'status',job.status,
        'attempts',job.attempts,'maximumAttempts',job.maximum_attempts,
        'lastError',job.last_error,'availableAt',job.available_at,
        'createdAt',job.created_at
      ) ORDER BY job.created_at DESC,job.id)
      FROM public.document_generation_jobs job
      JOIN public.requests request ON request.id=job.request_id
      LEFT JOIN public.suppliers supplier ON supplier.id=job.supplier_id
      WHERE (
        job.document_type<>'SUPPLIER_PURCHASE_ORDER'
        AND public.axora_document_request_permission(
          p_actor_user_id,p_actor_role_assignment_id,job.request_id,
          'document.download',p_at
        )
      ) OR (
        job.document_type='SUPPLIER_PURCHASE_ORDER'
        AND public.axora_document_request_permission(
          p_actor_user_id,p_actor_role_assignment_id,job.request_id,
          'document.dispatch.supplier',p_at
        )
      )
    ),'[]'::jsonb),
    'purchaseOrders',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',workflow.id,'documentId',document.id,
        'requestId',document.request_id,'requestReference',request.order_code,
        'supplierId',document.supplier_id,'supplierName',supplier.name,
        'revision',workflow.revision,'state',workflow.workflow_state,
        'version',workflow.workflow_version,
        'recipientUserId',workflow.recipient_user_id,
        'recipientEmail',workflow.recipient_email_snapshot,
        'warnings',job.input_snapshot->'warnings',
        'generatedAt',document.generated_at,
        'downloadUrl','/api/generated-documents/'||document.id,
        'canDispatch',public.axora_document_request_permission(
          p_actor_user_id,p_actor_role_assignment_id,document.request_id,
          'document.dispatch.supplier',p_at
        ),
        'canAcknowledge',workflow.workflow_state='DISPATCHED_TO_SUPPLIER'
          AND workflow.recipient_user_id=p_actor_user_id
      ) ORDER BY document.generated_at DESC,document.id)
      FROM public.supplier_purchase_order_workflows workflow
      JOIN public.generated_documents document ON document.id=workflow.document_id
      JOIN public.document_generation_jobs job ON job.id=document.generation_job_id
      JOIN public.requests request ON request.id=document.request_id
      JOIN public.suppliers supplier ON supplier.id=document.supplier_id
      WHERE public.axora_generated_document_access_allowed(
        p_actor_user_id,p_actor_role_assignment_id,document.id,p_at
      ) OR public.axora_document_request_permission(
        p_actor_user_id,p_actor_role_assignment_id,document.request_id,
        'document.dispatch.supplier',p_at
      )
    ),'[]'::jsonb),
    'supplierContacts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId',contact.id,'supplierId',membership.supplier_id,
        'name',contact.display_name,'email',contact.email
      ) ORDER BY supplier.name,contact.display_name,contact.id)
      FROM public.supplier_memberships membership
      JOIN public.suppliers supplier ON supplier.id=membership.supplier_id
      JOIN public.users contact ON contact.id=membership.user_id
      WHERE membership.status='ACTIVE' AND membership.ended_at IS NULL
        AND contact.active AND contact.account_status='ACTIVE'
        AND contact.email_verified_at IS NOT NULL
        AND NOT public.axora_email_recipient_is_suppressed(contact.email)
        AND EXISTS (
          SELECT 1 FROM public.generated_documents document
          WHERE document.supplier_id=membership.supplier_id
            AND public.axora_document_request_permission(
              p_actor_user_id,p_actor_role_assignment_id,document.request_id,
              'document.dispatch.supplier',p_at
            )
        )
    ),'[]'::jsonb),
    'enqueueFailures',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',failure.id,'requestId',failure.request_id,
        'requestReference',request.order_code,'errorCode',failure.error_code,
        'errorSummary',failure.error_summary,'createdAt',failure.created_at
      ) ORDER BY failure.created_at DESC,failure.id)
      FROM public.document_enqueue_failures failure
      JOIN public.requests request ON request.id=failure.request_id
      WHERE public.axora_document_request_permission(
        p_actor_user_id,p_actor_role_assignment_id,failure.request_id,
        'document.generate',p_at
      )
    ),'[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_claim_document_generation_job(
  p_worker_id uuid,
  p_lease_seconds integer,
  p_at timestamptz
)
RETURNS TABLE(
  job_id uuid,lease_id uuid,company_id uuid,request_id uuid,supplier_id uuid,
  document_type text,locale text,timezone text,input_snapshot jsonb,
  company_logo_content bytea,company_logo_content_type text,
  template_version integer,generator_version text,created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE selected_job public.document_generation_jobs%ROWTYPE;
DECLARE lease_value uuid:=gen_random_uuid();
BEGIN
  IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'The document worker lease is invalid';
  END IF;
  SELECT job.* INTO selected_job
  FROM public.document_generation_jobs job
  WHERE (
    job.status IN ('PENDING','RETRY') AND job.available_at<=p_at
  ) OR (
    job.status='PROCESSING' AND job.lease_expires_at<=p_at
  )
  ORDER BY job.available_at,job.created_at,job.id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.document_generation_jobs job
  SET status='PROCESSING',attempts=job.attempts+1,
    lease_id=lease_value,lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
    started_at=COALESCE(job.started_at,p_at),last_error=NULL
  WHERE job.id=selected_job.id;
  INSERT INTO public.document_generation_events(
    company_id,job_id,event_type,reason,metadata,occurred_at
  ) VALUES (
    selected_job.company_id,selected_job.id,'CLAIMED','document-worker',
    jsonb_build_object('worker',p_worker_id,'attempt',selected_job.attempts+1),p_at
  );
  RETURN QUERY SELECT selected_job.id,lease_value,selected_job.company_id,
    selected_job.request_id,selected_job.supplier_id,selected_job.document_type,
    selected_job.locale,selected_job.timezone,selected_job.input_snapshot,
    selected_job.company_logo_content,selected_job.company_logo_content_type,
    selected_job.template_version,selected_job.generator_version,
    selected_job.created_at;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_document_notification_recipient_ids(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT recipient.id ORDER BY recipient.id),ARRAY[]::uuid[])
  FROM (
    SELECT request.created_by AS id
    FROM public.requests request WHERE request.id=p_request_id
    UNION
    SELECT decision.actor_user_id
    FROM public.request_approval_decisions decision
    WHERE decision.request_id=p_request_id
    UNION
    SELECT assignment.manager_user_id
    FROM public.requests request
    JOIN public.company_assignments assignment
      ON assignment.company_id=request.company_id
      AND assignment.status='ACTIVE'
      AND assignment.coverage_starts_at<=p_at
      AND (assignment.coverage_ends_at IS NULL OR assignment.coverage_ends_at>p_at)
    WHERE request.id=p_request_id
    UNION
    SELECT role_assignment.user_id
    FROM public.requests request
    JOIN public.role_assignments role_assignment
      ON role_assignment.company_id=request.company_id
      AND role_assignment.active AND role_assignment.revoked_at IS NULL
    JOIN public.roles role ON role.id=role_assignment.role_id
      AND role.role_key IN ('COMPANY_ADMIN','FINANCE_REVIEWER')
    WHERE request.id=p_request_id
  ) candidates
  JOIN public.users recipient ON recipient.id=candidates.id
    AND recipient.active AND recipient.account_status='ACTIVE'
$$;

CREATE OR REPLACE FUNCTION public.axora_document_internal_recipient_ids(
  p_request_id uuid,
  p_at timestamptz
)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT account.id ORDER BY account.id),ARRAY[]::uuid[])
  FROM public.requests request
  JOIN public.role_assignments assignment ON assignment.active
    AND assignment.revoked_at IS NULL
  JOIN public.users account ON account.id=assignment.user_id
    AND account.active AND account.account_status='ACTIVE'
  WHERE request.id=p_request_id
    AND public.axora_role_assignment_has_direct_permission(
      account.id,assignment.id,'document.dispatch.supplier',
      CASE WHEN request.department_id IS NOT NULL THEN 'DEPARTMENT'
        WHEN request.branch_id IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END,
      request.company_id,request.branch_id,request.department_id,NULL,p_at
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_complete_document_generation_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_file_name text,
  p_storage_path text,
  p_checksum_sha256 text,
  p_page_count integer,
  p_file_size_bytes bigint,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  job_row public.document_generation_jobs%ROWTYPE;
  previous_document public.generated_documents%ROWTYPE;
  document_id_value uuid:=gen_random_uuid();
  document_version_value integer;
  event_key_value text;
  recipients uuid[];
  workflow_id_value uuid;
BEGIN
  IF char_length(COALESCE(p_file_name,'')) NOT BETWEEN 5 AND 180
    OR position('/' IN p_file_name)>0
    OR position(chr(92) IN p_file_name)>0
    OR p_file_name ~ '[[:cntrl:]]'
    OR p_storage_path !~ '^generated-documents/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
    OR p_checksum_sha256 !~ '^[0-9a-f]{64}$'
    OR p_page_count NOT BETWEEN 1 AND 2000
    OR p_file_size_bytes NOT BETWEEN 100 AND 26214400 THEN
    RAISE EXCEPTION 'The generated document output is invalid';
  END IF;
  SELECT * INTO job_row FROM public.document_generation_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR job_row.status<>'PROCESSING'
    OR job_row.lease_id<>p_lease_id OR job_row.lease_expires_at<=p_at THEN
    RAISE EXCEPTION 'The document worker lease is unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    job_row.document_type||':'||job_row.request_id||':'
      ||COALESCE(job_row.supplier_id::text,''),0
  ));
  SELECT * INTO previous_document FROM public.generated_documents document
  WHERE document.document_type=job_row.document_type
    AND document.request_id=job_row.request_id
    AND document.supplier_id IS NOT DISTINCT FROM job_row.supplier_id
    AND document.lifecycle_status='CURRENT'
  FOR UPDATE;
  SELECT COALESCE(max(document.document_version),0)+1
  INTO document_version_value FROM public.generated_documents document
  WHERE document.document_type=job_row.document_type
    AND document.request_id=job_row.request_id
    AND document.supplier_id IS NOT DISTINCT FROM job_row.supplier_id;
  IF previous_document.id IS NOT NULL THEN
    UPDATE public.generated_documents
    SET lifecycle_status=CASE WHEN job_row.generation_reason='CORRECTION'
        THEN 'CORRECTED' ELSE 'SUPERSEDED' END,
      superseded_at=p_at
    WHERE id=previous_document.id;
  END IF;
  INSERT INTO public.generated_documents(
    id,generation_job_id,company_id,branch_id,department_id,request_id,
    supplier_id,document_type,visibility,document_version,lifecycle_status,
    supersedes_document_id,file_name,storage_path,checksum_sha256,page_count,
    file_size_bytes,input_sha256,template_version,generator_version,
    source_version,generated_by,generated_at
  ) VALUES (
    document_id_value,job_row.id,job_row.company_id,job_row.branch_id,
    job_row.department_id,job_row.request_id,job_row.supplier_id,
    job_row.document_type,
    CASE WHEN job_row.document_type='SUPPLIER_PURCHASE_ORDER'
      THEN 'SUPPLIER' ELSE 'CUSTOMER' END,
    document_version_value,'CURRENT',
    COALESCE(job_row.supersedes_document_id,previous_document.id),
    p_file_name,p_storage_path,p_checksum_sha256,p_page_count,p_file_size_bytes,
    job_row.input_sha256,job_row.template_version,job_row.generator_version,
    job_row.source_version,job_row.requested_by,p_at
  );
  UPDATE public.document_generation_jobs
  SET status='COMPLETED',completed_at=p_at,lease_id=NULL,lease_expires_at=NULL,
    last_error=NULL
  WHERE id=job_row.id;
  INSERT INTO public.document_generation_events(
    company_id,job_id,event_type,actor_user_id,reason,
    metadata,occurred_at
  ) VALUES (
    job_row.company_id,job_row.id,'COMPLETED',job_row.requested_by,
    job_row.generation_reason,
    jsonb_build_object(
      'documentId',document_id_value,'version',document_version_value,
      'checksum',p_checksum_sha256,'pages',p_page_count,'bytes',p_file_size_bytes
    ),p_at
  );

  IF job_row.document_type='SUPPLIER_PURCHASE_ORDER' THEN
    workflow_id_value:=gen_random_uuid();
    INSERT INTO public.supplier_purchase_order_workflows(
      id,document_id,company_id,request_id,supplier_id,revision,created_at,updated_at
    ) VALUES (
      workflow_id_value,document_id_value,job_row.company_id,job_row.request_id,
      job_row.supplier_id,document_version_value,p_at,p_at
    );
    INSERT INTO public.supplier_purchase_order_events(
      company_id,workflow_id,document_id,supplier_id,state_after,
      actor_user_id,command_id,reason,occurred_at
    ) VALUES (
      job_row.company_id,workflow_id_value,document_id_value,job_row.supplier_id,
      'DRAFT',job_row.requested_by,gen_random_uuid(),'Generated for sales review',p_at
    );
    recipients:=public.axora_document_internal_recipient_ids(
      job_row.request_id,p_at
    );
    PERFORM public.axora_emit_p1_notification(
      job_row.company_id,job_row.branch_id,job_row.request_id,
      'generated_document',document_id_value,'document.supplier_po_ready',
      'document-po-ready:'||document_id_value,
      COALESCE(job_row.input_snapshot->'purchaseOrder'->>'reference','Supplier purchase order'),
      '/documents#purchase-order-'||workflow_id_value,recipients,
      job_row.requested_by,gen_random_uuid(),p_at,
      jsonb_build_object('documentVersion',document_version_value,'audience','INTERNAL')
    );
  ELSE
    event_key_value:=CASE job_row.document_type
      WHEN 'APPROVED_REQUEST' THEN 'document.approved_request_pdf'
      ELSE 'document.final_delivery_pdf' END;
    recipients:=public.axora_document_notification_recipient_ids(
      job_row.request_id,p_at
    );
    PERFORM public.axora_emit_p1_notification(
      job_row.company_id,job_row.branch_id,job_row.request_id,
      'generated_document',document_id_value,event_key_value,
      'document-completed:'||document_id_value,
      COALESCE(job_row.input_snapshot->'request'->>'reference','Purchase request'),
      '/api/generated-documents/'||document_id_value,recipients,
      job_row.requested_by,gen_random_uuid(),p_at,
      jsonb_build_object('documentVersion',document_version_value,'audience','CUSTOMER')
    );
  END IF;
  RETURN jsonb_build_object(
    'jobId',job_row.id,'documentId',document_id_value,
    'documentVersion',document_version_value,'status','COMPLETED'
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_fail_document_generation_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error_summary text,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE job_row public.document_generation_jobs%ROWTYPE;
DECLARE next_status text;
BEGIN
  SELECT * INTO job_row FROM public.document_generation_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR job_row.status<>'PROCESSING' OR job_row.lease_id<>p_lease_id THEN
    RAISE EXCEPTION 'The document worker lease is unavailable';
  END IF;
  next_status:=CASE WHEN job_row.attempts>=job_row.maximum_attempts
    THEN 'FAILED' ELSE 'RETRY' END;
  UPDATE public.document_generation_jobs
  SET status=next_status,lease_id=NULL,lease_expires_at=NULL,
    available_at=CASE WHEN next_status='RETRY'
      THEN p_at+make_interval(secs=>least(3600,30*(2^least(job_row.attempts,6))::integer))
      ELSE available_at END,
    last_error=left(regexp_replace(p_error_summary,'[[:cntrl:]]',' ','g'),500)
  WHERE id=job_row.id;
  INSERT INTO public.document_generation_events(
    company_id,job_id,event_type,reason,metadata,occurred_at
  ) VALUES (
    job_row.company_id,job_row.id,
    CASE WHEN next_status='FAILED' THEN 'FAILED' ELSE 'RETRY_SCHEDULED' END,
    left(regexp_replace(p_error_summary,'[[:cntrl:]]',' ','g'),500),
    jsonb_build_object('attempt',job_row.attempts),p_at
  );
  RETURN jsonb_build_object(
    'jobId',job_row.id,'status',next_status,'attempts',job_row.attempts
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_request_document_regeneration(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_operation text,
  p_reason text,
  p_command_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE document_row public.generated_documents%ROWTYPE;
DECLARE job_id_value uuid;
BEGIN
  SELECT * INTO document_row FROM public.generated_documents
  WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND OR document_row.document_type='SUPPLIER_PURCHASE_ORDER'
    OR p_operation NOT IN ('REGENERATE','CORRECT')
    OR p_command_id IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500
    OR NOT public.axora_document_request_permission(
      p_actor_user_id,p_actor_role_assignment_id,document_row.request_id,
      'document.generate',p_at
    ) THEN RAISE EXCEPTION 'The document command is unavailable'; END IF;
  SELECT event.job_id INTO job_id_value
  FROM public.document_generation_events event
  JOIN public.document_generation_jobs job ON job.id=event.job_id
  WHERE event.command_id=p_command_id
    AND event.actor_user_id=p_actor_user_id
    AND event.event_type='QUEUED'
    AND job.supersedes_document_id=p_document_id
  ORDER BY event.occurred_at,event.id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'jobId',job_id_value,
      'status',(SELECT status FROM public.document_generation_jobs WHERE id=job_id_value)
    );
  END IF;
  IF document_row.document_version<>p_expected_version
    OR document_row.lifecycle_status<>'CURRENT' THEN
    RAISE EXCEPTION 'The document command is unavailable';
  END IF;
  job_id_value:=public.axora_queue_document_generation_job(
    document_row.document_type,document_row.request_id,NULL,
    CASE WHEN p_operation='CORRECT' THEN 'CORRECTION' ELSE 'REGENERATION' END,
    p_actor_user_id,'document-command:'||p_command_id,document_row.id,p_at
  );
  INSERT INTO public.document_generation_events(
    company_id,job_id,event_type,actor_user_id,command_id,reason,occurred_at
  ) VALUES (
    document_row.company_id,job_id_value,'QUEUED',p_actor_user_id,p_command_id,
    btrim(p_reason),p_at
  ) ON CONFLICT(job_id,command_id) DO NOTHING;
  RETURN jsonb_build_object('jobId',job_id_value,'status','PENDING');
END
$$;

CREATE OR REPLACE FUNCTION public.axora_manage_supplier_purchase_order(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_operation text,
  p_recipient_user_id uuid,
  p_reason text,
  p_command_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  workflow_row public.supplier_purchase_order_workflows%ROWTYPE;
  document_row public.generated_documents%ROWTYPE;
  recipient_row public.users%ROWTYPE;
  old_state text;
  new_state text;
  new_version integer;
  job_id_value uuid;
BEGIN
  SELECT workflow.* INTO workflow_row
  FROM public.supplier_purchase_order_workflows workflow
  WHERE workflow.document_id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The supplier order command is unavailable'; END IF;
  SELECT * INTO document_row FROM public.generated_documents
  WHERE id=p_document_id;
  IF p_command_id IS NULL THEN
    RAISE EXCEPTION 'The supplier order command is unavailable';
  END IF;
  IF p_operation='ACKNOWLEDGE' THEN
    IF workflow_row.recipient_user_id<>p_actor_user_id
      OR NOT EXISTS (
        SELECT 1 FROM public.supplier_memberships membership
        WHERE membership.user_id=p_actor_user_id
          AND membership.supplier_id=workflow_row.supplier_id
          AND membership.status='ACTIVE' AND membership.ended_at IS NULL
      ) OR NOT public.axora_document_supplier_permission(
        p_actor_user_id,p_actor_role_assignment_id,workflow_row.supplier_id,
        'document.download',p_at
      ) THEN RAISE EXCEPTION 'The supplier order command is unavailable'; END IF;
  ELSIF NOT public.axora_document_request_permission(
    p_actor_user_id,p_actor_role_assignment_id,workflow_row.request_id,
    'document.dispatch.supplier',p_at
  ) THEN
    RAISE EXCEPTION 'The supplier order command is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_order_events event
    WHERE event.command_id=p_command_id
      AND event.workflow_id=workflow_row.id
      AND event.actor_user_id=p_actor_user_id
  ) THEN
    RETURN jsonb_build_object(
      'documentId',p_document_id,'state',workflow_row.workflow_state,
      'version',workflow_row.workflow_version
    );
  END IF;
  IF workflow_row.workflow_version<>p_expected_version THEN
    RAISE EXCEPTION 'The supplier order has changed';
  END IF;
  old_state:=workflow_row.workflow_state;

  IF p_operation='ACKNOWLEDGE' THEN
    IF old_state<>'DISPATCHED_TO_SUPPLIER'
      OR workflow_row.recipient_user_id<>p_actor_user_id
      OR NOT EXISTS (
        SELECT 1 FROM public.supplier_memberships membership
        WHERE membership.user_id=p_actor_user_id
          AND membership.supplier_id=workflow_row.supplier_id
          AND membership.status='ACTIVE' AND membership.ended_at IS NULL
      ) OR NOT public.axora_document_supplier_permission(
        p_actor_user_id,p_actor_role_assignment_id,workflow_row.supplier_id,
        'document.download',p_at
      ) THEN RAISE EXCEPTION 'The supplier order command is unavailable'; END IF;
    new_state:='ACKNOWLEDGED';
    UPDATE public.supplier_purchase_order_workflows
    SET workflow_state=new_state,workflow_version=workflow_version+1,
      acknowledged_by=p_actor_user_id,acknowledged_at=p_at,
      last_reason=COALESCE(NULLIF(btrim(p_reason),''),'Supplier acknowledged'),
      updated_at=p_at
    WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
  ELSE
    IF NOT public.axora_document_request_permission(
      p_actor_user_id,p_actor_role_assignment_id,workflow_row.request_id,
      'document.dispatch.supplier',p_at
    ) THEN RAISE EXCEPTION 'The supplier order command is unavailable'; END IF;
    IF p_operation='MARK_READY' AND old_state='DRAFT' THEN
      new_state:='READY_FOR_SALES_REVIEW';
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_state=new_state,workflow_version=workflow_version+1,
        last_reason=COALESCE(NULLIF(btrim(p_reason),''),'Ready for sales review'),
        updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
    ELSIF p_operation='APPROVE' AND old_state='READY_FOR_SALES_REVIEW' THEN
      IF jsonb_array_length((SELECT job.input_snapshot->'warnings'
          FROM public.document_generation_jobs job
          WHERE job.id=document_row.generation_job_id))>0 THEN
        RAISE EXCEPTION 'The supplier order warnings must be resolved';
      END IF;
      SELECT account.* INTO recipient_row
      FROM public.users account
      JOIN public.supplier_memberships membership
        ON membership.user_id=account.id
      WHERE account.id=p_recipient_user_id
        AND membership.supplier_id=workflow_row.supplier_id
        AND membership.status='ACTIVE' AND membership.ended_at IS NULL
        AND account.active AND account.account_status='ACTIVE'
        AND account.email_verified_at IS NOT NULL
        AND NOT public.axora_email_recipient_is_suppressed(account.email);
      IF NOT FOUND THEN RAISE EXCEPTION 'The verified supplier contact is unavailable'; END IF;
      new_state:='APPROVED_FOR_DISPATCH';
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_state=new_state,workflow_version=workflow_version+1,
        recipient_user_id=recipient_row.id,
        recipient_email_snapshot=lower(recipient_row.email),
        approved_by=p_actor_user_id,approved_at=p_at,
        last_reason=COALESCE(NULLIF(btrim(p_reason),''),'Approved for dispatch'),
        updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
      workflow_row.recipient_user_id:=recipient_row.id;
      workflow_row.recipient_email_snapshot:=lower(recipient_row.email);
    ELSIF p_operation='DISPATCH' AND old_state='APPROVED_FOR_DISPATCH' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.users account
        JOIN public.supplier_memberships membership ON membership.user_id=account.id
        WHERE account.id=workflow_row.recipient_user_id
          AND membership.supplier_id=workflow_row.supplier_id
          AND membership.status='ACTIVE' AND membership.ended_at IS NULL
          AND account.active AND account.account_status='ACTIVE'
          AND account.email_verified_at IS NOT NULL
          AND NOT public.axora_email_recipient_is_suppressed(account.email)
      ) THEN RAISE EXCEPTION 'The verified supplier contact is unavailable'; END IF;
      new_state:='DISPATCHED_TO_SUPPLIER';
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_state=new_state,workflow_version=workflow_version+1,
        dispatched_by=p_actor_user_id,dispatched_at=p_at,
        last_reason=COALESCE(NULLIF(btrim(p_reason),''),'Dispatched to supplier'),
        updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
      PERFORM public.axora_emit_p1_notification(
        document_row.company_id,document_row.branch_id,document_row.request_id,
        'supplier_purchase_order',document_row.id,'document.supplier_po_ready',
        'document-po-dispatch:'||document_row.id||':'||new_version,
        document_row.file_name,'/api/generated-documents/'||document_row.id,
        ARRAY[workflow_row.recipient_user_id],p_actor_user_id,
        p_command_id,p_at,jsonb_build_object(
          'documentVersion',document_row.document_version,'audience','SUPPLIER'
        )
      );
    ELSIF p_operation='RESEND'
      AND old_state IN ('DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED') THEN
      IF workflow_row.recipient_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.users account
        JOIN public.supplier_memberships membership ON membership.user_id=account.id
        WHERE account.id=workflow_row.recipient_user_id
          AND membership.supplier_id=workflow_row.supplier_id
          AND membership.status='ACTIVE' AND membership.ended_at IS NULL
          AND account.active AND account.account_status='ACTIVE'
          AND account.email_verified_at IS NOT NULL
          AND NOT public.axora_email_recipient_is_suppressed(account.email)
      ) THEN
        RAISE EXCEPTION 'The verified supplier contact is unavailable';
      END IF;
      new_state:=old_state;
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_version=workflow_version+1,
        last_reason=COALESCE(NULLIF(btrim(p_reason),''),'Secure link resent'),
        updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
      PERFORM public.axora_emit_p1_notification(
        document_row.company_id,document_row.branch_id,document_row.request_id,
        'supplier_purchase_order',document_row.id,'document.supplier_po_ready',
        'document-po-resend:'||document_row.id||':'||new_version,
        document_row.file_name,'/api/generated-documents/'||document_row.id,
        ARRAY[workflow_row.recipient_user_id],p_actor_user_id,
        p_command_id,p_at,jsonb_build_object(
          'documentVersion',document_row.document_version,'audience','SUPPLIER'
        )
      );
    ELSIF p_operation='AMEND'
      AND old_state IN (
        'READY_FOR_SALES_REVIEW','APPROVED_FOR_DISPATCH',
        'DISPATCHED_TO_SUPPLIER','ACKNOWLEDGED'
      ) AND char_length(btrim(p_reason)) BETWEEN 3 AND 500 THEN
      new_state:='AMENDED';
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_state=new_state,workflow_version=workflow_version+1,
        amended_at=p_at,last_reason=btrim(p_reason),updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
      UPDATE public.generated_documents
      SET lifecycle_status='SUPERSEDED',superseded_at=p_at
      WHERE id=document_row.id AND lifecycle_status='CURRENT';
      job_id_value:=public.axora_queue_document_generation_job(
        'SUPPLIER_PURCHASE_ORDER',document_row.request_id,
        document_row.supplier_id,'AMENDMENT',p_actor_user_id,
        'supplier-po-amend:'||p_command_id,document_row.id,p_at
      );
    ELSIF p_operation='CANCEL'
      AND old_state NOT IN ('AMENDED','CANCELLED')
      AND char_length(btrim(p_reason)) BETWEEN 3 AND 500 THEN
      new_state:='CANCELLED';
      UPDATE public.supplier_purchase_order_workflows
      SET workflow_state=new_state,workflow_version=workflow_version+1,
        cancelled_at=p_at,last_reason=btrim(p_reason),updated_at=p_at
      WHERE id=workflow_row.id RETURNING workflow_version INTO new_version;
      UPDATE public.generated_documents
      SET lifecycle_status='CANCELLED',superseded_at=p_at
      WHERE id=document_row.id AND lifecycle_status='CURRENT';
    ELSE
      RAISE EXCEPTION 'The supplier order command is unavailable';
    END IF;
  END IF;

  INSERT INTO public.supplier_purchase_order_events(
    company_id,workflow_id,document_id,supplier_id,state_before,state_after,
    actor_user_id,recipient_user_id,recipient_email_snapshot,command_id,
    reason,occurred_at
  ) VALUES (
    workflow_row.company_id,workflow_row.id,document_row.id,
    workflow_row.supplier_id,old_state,new_state,p_actor_user_id,
    workflow_row.recipient_user_id,workflow_row.recipient_email_snapshot,
    p_command_id,COALESCE(NULLIF(btrim(p_reason),''),p_operation),p_at
  );
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'documentId',document_row.id,'state',new_state,'version',new_version,
    'jobId',job_id_value
  ));
END
$$;

CREATE OR REPLACE FUNCTION public.axora_protect_document_job_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY[
      'status','attempts','available_at','lease_id','lease_expires_at',
      'last_error','started_at','completed_at','cancelled_at'
    ]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY[
      'status','attempts','available_at','lease_id','lease_expires_at',
      'last_error','started_at','completed_at','cancelled_at'
    ]) THEN
    RAISE EXCEPTION 'The document generation input is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_generation_jobs_protect_snapshot
BEFORE UPDATE ON public.document_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_document_job_snapshot();

CREATE OR REPLACE FUNCTION public.axora_protect_generated_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['lifecycle_status','superseded_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lifecycle_status','superseded_at']) THEN
    RAISE EXCEPTION 'The generated document version is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER generated_documents_protect_version
BEFORE UPDATE ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_generated_document();

CREATE OR REPLACE FUNCTION public.axora_document_audit_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  old_value jsonb;
  new_value jsonb;
  row_value jsonb;
  actor_id uuid;
BEGIN
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  old_value:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN
    to_jsonb(OLD)-ARRAY['input_snapshot','company_logo_content'] ELSE NULL END;
  new_value:=CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN
    to_jsonb(NEW)-ARRAY['input_snapshot','company_logo_content'] ELSE NULL END;
  BEGIN actor_id:=NULLIF(current_setting('axora.user_id',true),'')::uuid;
  EXCEPTION WHEN OTHERS THEN actor_id:=NULL; END;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,company_id,reason
  ) VALUES (
    TG_TABLE_NAME,(row_value->>'id')::uuid,TG_OP,old_value,new_value,actor_id,
    (row_value->>'company_id')::uuid,current_setting('axora.change_reason',true)
  );
  RETURN COALESCE(NEW,OLD);
END
$$;

CREATE TRIGGER document_generation_jobs_audit
AFTER INSERT OR UPDATE OR DELETE ON public.document_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.axora_document_audit_change();
CREATE TRIGGER generated_documents_audit
AFTER INSERT OR UPDATE OR DELETE ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.axora_document_audit_change();
CREATE TRIGGER supplier_po_workflows_audit
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_purchase_order_workflows
FOR EACH ROW EXECUTE FUNCTION public.axora_document_audit_change();

CREATE TRIGGER document_generation_events_append_only
BEFORE UPDATE OR DELETE ON public.document_generation_events
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER supplier_po_events_append_only
BEFORE UPDATE OR DELETE ON public.supplier_purchase_order_events
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
CREATE TRIGGER document_enqueue_failures_append_only
BEFORE UPDATE OR DELETE ON public.document_enqueue_failures
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION public.axora_p1_notification_copy(
  p_event_key text,
  p_locale text,
  p_subject text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE subject text:=left(p_subject,120);
BEGIN
  IF p_locale='ar' THEN
    RETURN CASE p_event_key
      WHEN 'document.approved_request_pdf' THEN jsonb_build_object('title','ملف الطلب المعتمد متاح','body','يتوفر الآن السجل المعتمد لـ '||subject||'.')
      WHEN 'document.final_delivery_pdf' THEN jsonb_build_object('title','ملف التسليم النهائي متاح','body','يتوفر الآن سجل التجهيز والتسليم النهائي لـ '||subject||'.')
      WHEN 'document.supplier_po_ready' THEN jsonb_build_object('title','أمر شراء المورد جاهز','body','أمر الشراء الآمن لـ '||subject||' جاهز للمراجعة.')
      WHEN 'budget.low' THEN jsonb_build_object('title','تنبيه انخفاض الميزانية','body','انخفض الرصيد المتاح لـ '||subject||'.')
      WHEN 'budget.zero' THEN jsonb_build_object('title','نفاد الميزانية','body','بلغ الرصيد المتاح لـ '||subject||' صفراً.')
      WHEN 'budget.refreshed' THEN jsonb_build_object('title','تم تجديد الميزانية','body','تم فتح فترة ميزانية جديدة لـ '||subject||'.')
      WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','فشل تجديد الميزانية','body','تحتاج مهمة تجديد '||subject||' إلى مراجعة.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','موافقة مبلغ إضافي مطلوبة','body','تحتاج التكلفة الفعلية لـ '||subject||' إلى موافقة.')
      WHEN 'approval.substitute_required' THEN jsonb_build_object('title','موافقة بديل مطلوبة','body','يتضمن الشراء الفعلي لـ '||subject||' منتجاً بديلاً.')
      WHEN 'request.approved' THEN jsonb_build_object('title','تم اعتماد التكلفة الفعلية','body','تم تسجيل التكلفة الفعلية لـ '||subject||'.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','تم رفض التكلفة الفعلية','body','تم رفض التكلفة الفعلية لـ '||subject||'.')
      WHEN 'request.returned' THEN jsonb_build_object('title','أعيدت التكلفة الفعلية','body','أعيدت التكلفة الفعلية لـ '||subject||' للتعديل.')
      ELSE jsonb_build_object('title','تحديث سير العمل','body','تم تحديث سير العمل لـ '||subject||'.') END;
  ELSIF p_locale='ms' THEN
    RETURN CASE p_event_key
      WHEN 'document.approved_request_pdf' THEN jsonb_build_object('title','PDF permintaan diluluskan tersedia','body','Rekod diluluskan untuk '||subject||' kini tersedia.')
      WHEN 'document.final_delivery_pdf' THEN jsonb_build_object('title','PDF penghantaran akhir tersedia','body','Rekod pemenuhan dan penghantaran akhir untuk '||subject||' kini tersedia.')
      WHEN 'document.supplier_po_ready' THEN jsonb_build_object('title','Pesanan pembelian pembekal sedia','body','Pesanan pembelian selamat untuk '||subject||' sedia untuk semakan.')
      WHEN 'budget.low' THEN jsonb_build_object('title','Amaran bajet rendah','body','Baki tersedia untuk '||subject||' telah menurun.')
      WHEN 'budget.zero' THEN jsonb_build_object('title','Bajet sifar','body','Baki tersedia untuk '||subject||' kini sifar.')
      WHEN 'budget.refreshed' THEN jsonb_build_object('title','Bajet diperbaharui','body','Tempoh bajet baharu dibuka untuk '||subject||'.')
      WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','Pembaharuan bajet gagal','body','Tugas pembaharuan '||subject||' perlu disemak.')
      WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Kelulusan amaun tambahan diperlukan','body','Kos sebenar untuk '||subject||' memerlukan kelulusan.')
      WHEN 'approval.substitute_required' THEN jsonb_build_object('title','Kelulusan pengganti diperlukan','body','Pembelian sebenar untuk '||subject||' mengandungi produk pengganti.')
      WHEN 'request.approved' THEN jsonb_build_object('title','Kos sebenar diluluskan','body','Kos sebenar untuk '||subject||' telah direkodkan.')
      WHEN 'request.rejected' THEN jsonb_build_object('title','Kos sebenar ditolak','body','Kos sebenar untuk '||subject||' telah ditolak.')
      WHEN 'request.returned' THEN jsonb_build_object('title','Kos sebenar dikembalikan','body','Kos sebenar untuk '||subject||' dikembalikan untuk perubahan.')
      ELSE jsonb_build_object('title','Kemas kini aliran kerja','body','Aliran kerja untuk '||subject||' telah dikemas kini.') END;
  END IF;
  RETURN CASE p_event_key
    WHEN 'document.approved_request_pdf' THEN jsonb_build_object('title','Approved request PDF available','body','The approved record for '||subject||' is now available.')
    WHEN 'document.final_delivery_pdf' THEN jsonb_build_object('title','Final delivery PDF available','body','The final fulfilment and delivery record for '||subject||' is now available.')
    WHEN 'document.supplier_po_ready' THEN jsonb_build_object('title','Supplier purchase order ready','body','The secure purchase order for '||subject||' is ready for review.')
    WHEN 'budget.low' THEN jsonb_build_object('title','Low budget alert','body','Available balance for '||subject||' has crossed a configured threshold.')
    WHEN 'budget.zero' THEN jsonb_build_object('title','Budget at zero','body','Available balance for '||subject||' is now zero.')
    WHEN 'budget.refreshed' THEN jsonb_build_object('title','Budget refreshed','body','A new budget period was opened for '||subject||'.')
    WHEN 'budget.refresh_failed' THEN jsonb_build_object('title','Budget refresh failed','body','The refresh job for '||subject||' needs review.')
    WHEN 'approval.additional_actual_required' THEN jsonb_build_object('title','Additional amount approval required','body','Actual cost for '||subject||' requires approval.')
    WHEN 'approval.substitute_required' THEN jsonb_build_object('title','Substitute approval required','body','The actual purchase for '||subject||' contains a substitute product.')
    WHEN 'request.approved' THEN jsonb_build_object('title','Actual cost approved','body','Actual cost for '||subject||' was recorded.')
    WHEN 'request.rejected' THEN jsonb_build_object('title','Actual cost rejected','body','Actual cost for '||subject||' was rejected.')
    WHEN 'request.returned' THEN jsonb_build_object('title','Actual cost returned','body','Actual cost for '||subject||' was returned for changes.')
    ELSE jsonb_build_object('title','Workflow update','body','The workflow for '||subject||' was updated.') END;
END
$$;

DO $$
DECLARE request_row record;
DECLARE supplier_id_value uuid;
BEGIN
  FOR request_row IN
    SELECT request.* FROM public.requests request
    WHERE request.approval_state IN ('APPROVED','AWAITING_FULFILMENT')
  LOOP
    BEGIN
      PERFORM public.axora_queue_document_generation_job(
        'APPROVED_REQUEST',request_row.id,NULL,'WORKFLOW',NULL,
        'approval:'||request_row.id||':'||request_row.request_version||':'
          ||request_row.approval_revision,NULL,now()
      );
      FOR supplier_id_value IN
        SELECT DISTINCT line.selected_supplier_id
        FROM public.request_lines line
        WHERE line.request_id=request_row.id
          AND line.selected_supplier_id IS NOT NULL
      LOOP
        PERFORM public.axora_queue_document_generation_job(
          'SUPPLIER_PURCHASE_ORDER',request_row.id,supplier_id_value,
          'WORKFLOW',NULL,'supplier-po:'||request_row.id||':'
            ||supplier_id_value||':'||request_row.request_version||':'
            ||request_row.approval_revision,NULL,now()
        );
      END LOOP;
      PERFORM public.axora_maybe_enqueue_final_document(request_row.id,now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.document_enqueue_failures(
        company_id,request_id,source_key,error_code,error_summary
      ) VALUES (
        request_row.company_id,request_row.id,'migration-064:'||request_row.id,
        SQLSTATE,left(SQLERRM,500)
      ) ON CONFLICT(company_id,source_key) DO NOTHING;
    END;
  END LOOP;
END
$$;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_order_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_order_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_order_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_enqueue_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_enqueue_failures FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_templates FROM PUBLIC;
REVOKE ALL ON TABLE public.document_generation_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.generated_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.supplier_purchase_order_workflows FROM PUBLIC;
REVOKE ALL ON TABLE public.document_generation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.supplier_purchase_order_events FROM PUBLIC;
REVOKE ALL ON TABLE public.document_enqueue_failures FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.axora_document_json_has_forbidden_key(jsonb,text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_assert_document_snapshot_safe(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_build_approved_request_document_snapshot(uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_build_final_delivery_document_snapshot(uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_build_supplier_po_document_snapshot(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_queue_document_generation_job(text,uuid,uuid,text,uuid,text,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_enqueue_approval_documents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_maybe_enqueue_final_document(uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_enqueue_final_document_from_actual() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_enqueue_final_document_from_delivery() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_cancel_request_document_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_document_request_permission(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_document_supplier_permission(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_generated_document_access_allowed(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_generated_document_download(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_generated_document_workspace(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_claim_document_generation_job(uuid,integer,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_document_notification_recipient_ids(uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_document_internal_recipient_ids(uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_complete_document_generation_job(uuid,uuid,text,text,text,integer,bigint,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_fail_document_generation_job(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_request_document_regeneration(uuid,uuid,uuid,integer,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_manage_supplier_purchase_order(uuid,uuid,uuid,integer,text,uuid,text,uuid,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_protect_document_job_snapshot() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_protect_generated_document() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.axora_document_audit_change() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.document_templates FROM axora_app;
    REVOKE ALL ON TABLE public.document_generation_jobs FROM axora_app;
    REVOKE ALL ON TABLE public.generated_documents FROM axora_app;
    REVOKE ALL ON TABLE public.supplier_purchase_order_workflows FROM axora_app;
    REVOKE ALL ON TABLE public.document_generation_events FROM axora_app;
    REVOKE ALL ON TABLE public.supplier_purchase_order_events FROM axora_app;
    REVOKE ALL ON TABLE public.document_enqueue_failures FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_generated_document_download(uuid,uuid,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_generated_document_workspace(uuid,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_claim_document_generation_job(uuid,integer,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_complete_document_generation_job(uuid,uuid,text,text,text,integer,bigint,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_fail_document_generation_job(uuid,uuid,text,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_request_document_regeneration(uuid,uuid,uuid,integer,text,text,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_manage_supplier_purchase_order(uuid,uuid,uuid,integer,text,uuid,text,uuid,timestamptz) TO axora_app;
  END IF;
END
$$;

COMMIT;
