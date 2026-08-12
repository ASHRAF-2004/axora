BEGIN;

-- OFFLINE is an internal strategy identifier. Customer-facing surfaces use
-- Pay/Paid wording and never couple payment to physical delivery.
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_cod_only_payment_terms_check;
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_cod_only_payment_terms_check;
UPDATE public.companies SET payment_terms='Standard billing terms'
WHERE payment_terms IN ('Cash on delivery (COD)','Cash on delivery','COD');
UPDATE public.suppliers SET payment_terms='Standard billing terms'
WHERE payment_terms IN ('Cash on delivery (COD)','Cash on delivery','COD');

-- Preserve the reviewed company lifecycle implementations while replacing
-- their deployed legacy billing-term literal. Lead conversion and direct
-- company creation must agree with the neutral current model.
DO $$
DECLARE function_definition text;
DECLARE function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'axora_create_company_lead','axora_convert_company_lead'
  ] LOOP
    SELECT pg_get_functiondef(procedure.oid) INTO function_definition
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.proname=function_name;
    IF function_definition IS NULL
      OR position('Cash on delivery (COD)' IN function_definition)=0 THEN
      RAISE EXCEPTION 'The company billing-term migration source is unavailable';
    END IF;
    EXECUTE replace(
      function_definition,'Cash on delivery (COD)','Standard billing terms'
    );
  END LOOP;
END $$;
ALTER TABLE public.companies
  ALTER COLUMN payment_terms SET DEFAULT 'Standard billing terms';
ALTER TABLE public.suppliers
  ALTER COLUMN payment_terms SET DEFAULT 'Standard billing terms';

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_cod_only_method_check;
ALTER TABLE public.payments
  ALTER COLUMN method DROP DEFAULT,
  ADD COLUMN payment_status text,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN idempotency_key text;
UPDATE public.payments
SET method='OFFLINE',payment_status='PAID',
  paid_at=payment_date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
ALTER TABLE public.payments
  ALTER COLUMN method SET DEFAULT 'OFFLINE',
  ALTER COLUMN payment_status SET DEFAULT 'PAID',
  ALTER COLUMN payment_status SET NOT NULL,
  ALTER COLUMN paid_at SET DEFAULT now(),
  ADD CONSTRAINT payments_method_check CHECK (
    method IN ('OFFLINE','BANK_TRANSFER','CARD_GATEWAY','FPX','INVOICE_TERMS')
  ),
  ADD CONSTRAINT payments_status_check CHECK (
    payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED')
  ),
  ADD CONSTRAINT payments_paid_at_check CHECK (
    (payment_status='PAID' AND paid_at IS NOT NULL)
    OR (payment_status<>'PAID' AND paid_at IS NULL)
  ),
  ADD CONSTRAINT payments_idempotency_key_check CHECK (
    idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 200
  );
CREATE UNIQUE INDEX payments_invoice_idempotency_uq
  ON public.payments(invoice_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE SEQUENCE public.customer_invoice_number_seq;
ALTER TABLE public.invoices
  ADD COLUMN lifecycle_status text,
  ADD COLUMN currency text NOT NULL DEFAULT 'MYR',
  ADD COLUMN subtotal numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN delivery_fee numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN customer_snapshot jsonb,
  ADD COLUMN line_items_snapshot jsonb,
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN recipient_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN checkout_idempotency_key text;
UPDATE public.invoices invoice
SET lifecycle_status=CASE status.label
    WHEN 'Cancelled' THEN 'VOID' WHEN 'Issued' THEN 'FINALIZED' ELSE 'DRAFT' END,
  finalized_at=CASE WHEN status.label='Issued'
    THEN invoice.invoice_date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur' END,
  subtotal=invoice.amount
FROM public.lookup_values status WHERE status.id=invoice.status_id;
ALTER TABLE public.invoices
  ALTER COLUMN lifecycle_status SET NOT NULL,
  ALTER COLUMN lifecycle_status SET DEFAULT 'FINALIZED',
  ADD CONSTRAINT invoices_lifecycle_status_check CHECK (
    lifecycle_status IN ('DRAFT','FINALIZED','VOID')
  ),
  ADD CONSTRAINT invoices_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT invoices_money_snapshot_check CHECK (
    checkout_idempotency_key IS NULL OR (
      subtotal>=0 AND discount_amount>=0 AND tax_amount>=0 AND delivery_fee>=0
      AND amount=round(subtotal-discount_amount+tax_amount+delivery_fee,2)
    )
  ) NOT VALID,
  ADD CONSTRAINT invoices_checkout_snapshot_check CHECK (
    checkout_idempotency_key IS NULL OR (
      direction='CUSTOMER' AND lifecycle_status='FINALIZED'
      AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL
      AND recipient_user_id IS NOT NULL
      AND jsonb_typeof(customer_snapshot)='object'
      AND jsonb_typeof(line_items_snapshot)='array'
      AND jsonb_array_length(line_items_snapshot)>0
      AND char_length(checkout_idempotency_key) BETWEEN 8 AND 200
    )
  );
CREATE UNIQUE INDEX invoices_customer_checkout_request_uq
  ON public.invoices(request_id)
  WHERE direction='CUSTOMER' AND checkout_idempotency_key IS NOT NULL;

CREATE TABLE public.payment_accountability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CHECKOUT_COMPLETED','PAYMENT_RECORDED','INVOICE_FINALIZED',
    'INVOICE_DOCUMENT_QUEUED','INVOICE_EMAIL_QUEUED'
  )),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_accountability_events_once_uq
  ON public.payment_accountability_events(invoice_id,event_type)
  WHERE invoice_id IS NOT NULL;
CREATE TRIGGER payment_accountability_events_append_only
BEFORE UPDATE OR DELETE ON public.payment_accountability_events
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();
ALTER TABLE public.payment_accountability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_accountability_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_accountability_events FROM PUBLIC;

-- Customer invoices are finalized at checkout. Supplier invoices retain the
-- full-receipt gate used by internal procurement finance.
CREATE OR REPLACE FUNCTION public.validate_new_invoice_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_row public.requests%ROWTYPE;
DECLARE approved_total numeric(18,2);
BEGIN
  SELECT * INTO request_row FROM public.requests WHERE id=NEW.request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Invoice request is unavailable'; END IF;
  IF NEW.direction='CUSTOMER' THEN
    IF NEW.checkout_idempotency_key IS NULL AND session_user<>'axora_app' THEN
      RETURN NEW;
    END IF;
    SELECT snapshot.amount INTO approved_total
    FROM public.request_approval_snapshots snapshot
    WHERE snapshot.request_id=request_row.id
      AND snapshot.request_version=request_row.request_version;
    IF NEW.checkout_idempotency_key IS NULL
      OR NEW.company_id IS DISTINCT FROM request_row.company_id
      OR NEW.supplier_id IS NOT NULL OR request_row.approval_state<>'APPROVED'
      OR approved_total IS NULL OR NEW.amount<>approved_total THEN
      RAISE EXCEPTION 'Customer invoice finalization is unavailable';
    END IF;
  ELSE
    IF NEW.company_id IS NOT NULL OR NEW.supplier_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.request_lines line
        WHERE line.request_id=request_row.id
          AND COALESCE(public.axora_effective_received_quantity_internal(line.id),0)<line.quantity
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.request_lines line
        JOIN public.suppliers supplier ON supplier.id=line.selected_supplier_id
        WHERE line.request_id=request_row.id AND supplier.id=NEW.supplier_id
          AND supplier.active AND supplier.company_id IS NULL
      ) THEN
      RAISE EXCEPTION 'Supplier invoice requires completed receiving and a sourced supplier';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_overpayment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE invoice_total numeric(18,2);
DECLARE already_paid numeric(18,2);
DECLARE invoice_lifecycle text;
BEGIN
  SELECT invoice.amount,invoice.lifecycle_status
  INTO invoice_total,invoice_lifecycle
  FROM public.invoices invoice WHERE invoice.id=NEW.invoice_id FOR UPDATE;
  IF invoice_lifecycle<>'FINALIZED' THEN
    RAISE EXCEPTION 'Payment requires a finalized invoice';
  END IF;
  IF NEW.method NOT IN ('OFFLINE','BANK_TRANSFER','CARD_GATEWAY','FPX','INVOICE_TERMS')
    OR NEW.payment_status<>'PAID' OR NEW.paid_at IS NULL THEN
    RAISE EXCEPTION 'Payment completion is invalid';
  END IF;
  SELECT COALESCE(sum(payment.amount),0) INTO already_paid
  FROM public.payments payment
  WHERE payment.invoice_id=NEW.invoice_id AND payment.id<>NEW.id
    AND payment.payment_status='PAID';
  IF already_paid+NEW.amount>invoice_total THEN
    RAISE EXCEPTION 'Payments cannot exceed invoice amount';
  END IF;
  RETURN NEW;
END $$;

-- Extend immutable document infrastructure without modifying migration 064.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conrelid::regclass AS relation_name,conname
    FROM pg_constraint
    WHERE contype='c' AND conrelid IN (
      'public.document_templates'::regclass,
      'public.document_generation_jobs'::regclass,
      'public.generated_documents'::regclass
    ) AND pg_get_constraintdef(oid) LIKE '%document_type%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
      constraint_row.relation_name,constraint_row.conname);
  END LOOP;
END $$;
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_type_check
  CHECK (document_type IN ('APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER','FINAL_INVOICE'));
ALTER TABLE public.document_generation_jobs ADD CONSTRAINT document_generation_jobs_type_check
  CHECK (document_type IN ('APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER','FINAL_INVOICE'));
ALTER TABLE public.document_generation_jobs ADD CONSTRAINT document_generation_jobs_supplier_scope_check
  CHECK ((document_type='SUPPLIER_PURCHASE_ORDER' AND supplier_id IS NOT NULL)
    OR (document_type<>'SUPPLIER_PURCHASE_ORDER' AND supplier_id IS NULL));
ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_type_check
  CHECK (document_type IN ('APPROVED_REQUEST','FINAL_FULFILMENT_DELIVERY','SUPPLIER_PURCHASE_ORDER','FINAL_INVOICE'));
ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_visibility_scope_check
  CHECK ((document_type='SUPPLIER_PURCHASE_ORDER' AND visibility='SUPPLIER' AND supplier_id IS NOT NULL)
    OR (document_type<>'SUPPLIER_PURCHASE_ORDER' AND visibility='CUSTOMER' AND supplier_id IS NULL));
INSERT INTO public.document_templates(document_type,template_version,generator_version)
VALUES ('FINAL_INVOICE',1,'axora-pdfkit-1') ON CONFLICT DO NOTHING;

ALTER TABLE public.transactional_email_outbox
  ADD COLUMN invoice_id uuid UNIQUE REFERENCES public.invoices(id) ON DELETE RESTRICT,
  ADD COLUMN generated_document_id uuid UNIQUE REFERENCES public.generated_documents(id) ON DELETE RESTRICT;
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.transactional_email_outbox'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%message_kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.transactional_email_outbox DROP CONSTRAINT %I',constraint_row.conname);
  END LOOP;
END $$;
ALTER TABLE public.transactional_email_outbox
  ADD CONSTRAINT transactional_email_message_kind_check CHECK (message_kind IN (
    'CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT','PASSWORD_RESET',
    'PASSWORD_CHANGED','EMAIL_VERIFICATION','INVOICE_FINALIZED'
  )),
  ADD CONSTRAINT transactional_email_source_check CHECK (
    (message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT')
      AND contact_submission_id IS NOT NULL AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NULL AND invoice_id IS NULL AND generated_document_id IS NULL)
    OR (message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED')
      AND contact_submission_id IS NULL AND password_reset_token_id IS NOT NULL
      AND email_verification_token_id IS NULL AND invoice_id IS NULL AND generated_document_id IS NULL)
    OR (message_kind='EMAIL_VERIFICATION'
      AND contact_submission_id IS NULL AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NOT NULL AND invoice_id IS NULL AND generated_document_id IS NULL)
    OR (message_kind='INVOICE_FINALIZED'
      AND contact_submission_id IS NULL AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NULL AND invoice_id IS NOT NULL AND generated_document_id IS NOT NULL)
  ),
  ADD CONSTRAINT transactional_email_token_kind_check CHECK (
    (message_kind IN ('PASSWORD_RESET','EMAIL_VERIFICATION')
      AND ((delivery_status IN ('PENDING','SENDING') AND token_ciphertext IS NOT NULL)
        OR (delivery_status NOT IN ('PENDING','SENDING') AND token_ciphertext IS NULL)))
    OR (message_kind NOT IN ('PASSWORD_RESET','EMAIL_VERIFICATION') AND token_ciphertext IS NULL)
  );

CREATE OR REPLACE FUNCTION public.axora_set_transactional_email_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.template_key:=CASE NEW.message_kind
    WHEN 'CONTACT_NOTIFICATION' THEN 'new-lead-internal-alert'
    WHEN 'CONTACT_ACKNOWLEDGEMENT' THEN 'company-lead-acknowledgement'
    WHEN 'PASSWORD_RESET' THEN 'password-reset'
    WHEN 'PASSWORD_CHANGED' THEN 'password-changed'
    WHEN 'EMAIL_VERIFICATION' THEN 'email-verification'
    WHEN 'INVOICE_FINALIZED' THEN 'invoice-finalized'
    ELSE 'workflow-update' END;
  NEW.priority:=CASE
    WHEN NEW.message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION') THEN 'URGENT'
    WHEN NEW.message_kind='INVOICE_FINALIZED' THEN 'HIGH' ELSE 'NORMAL' END;
  NEW.provider_agent:=CASE
    WHEN NEW.message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION') THEN 'axora-auth'
    WHEN NEW.message_kind='INVOICE_FINALIZED' THEN 'axora-documents'
    ELSE 'axora-platform' END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_protect_invoice_email_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.generated_document_id IS DISTINCT FROM OLD.generated_document_id THEN
    RAISE EXCEPTION 'Transactional invoice email identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_invoice_email_identity
BEFORE UPDATE ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_invoice_email_identity();

CREATE OR REPLACE FUNCTION public.axora_invoice_email_payload(p_outbox_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,
    'requestId',request.id,'requestReference',request.order_code,
    'companyName',company.name,'amount',invoice.amount::text,
    'currency',invoice.currency,'paidAt',payment.paid_at,
    'issuedAt',invoice.finalized_at,'recipientEmail',recipient.email,
    'recipientName',recipient.display_name,
    'attachment',jsonb_build_object(
      'storagePath',document.storage_path,'fileName',document.file_name,
      'contentType',document.content_type,'checksum',document.checksum_sha256,
      'fileSize',document.file_size_bytes
    )
  )
  FROM public.transactional_email_outbox outbox
  JOIN public.invoices invoice ON invoice.id=outbox.invoice_id
  JOIN public.requests request ON request.id=invoice.request_id
  JOIN public.companies company ON company.id=request.company_id
  JOIN public.users recipient ON recipient.id=invoice.recipient_user_id
  JOIN public.generated_documents document ON document.id=outbox.generated_document_id
  JOIN LATERAL (
    SELECT paid.paid_at FROM public.payments paid
    WHERE paid.invoice_id=invoice.id AND paid.payment_status='PAID'
    ORDER BY paid.paid_at,paid.id LIMIT 1
  ) payment ON true
  WHERE outbox.id=p_outbox_id AND outbox.message_kind='INVOICE_FINALIZED'
    AND outbox.delivery_status IN ('PENDING','SENDING')
    AND invoice.lifecycle_status='FINALIZED'
    AND document.document_type='FINAL_INVOICE' AND document.lifecycle_status='CURRENT'
    AND document.file_size_bytes BETWEEN 100 AND 10485760
    AND recipient.active AND recipient.account_status='ACTIVE'
    AND recipient.account_setup_completed_at IS NOT NULL
    AND NOT public.axora_email_recipient_is_suppressed(recipient.email)
$$;

CREATE OR REPLACE FUNCTION public.axora_invoice_email_recipient_suppressed(p_outbox_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE((SELECT public.axora_email_recipient_is_suppressed(recipient.email)
    FROM public.transactional_email_outbox outbox
    JOIN public.invoices invoice ON invoice.id=outbox.invoice_id
    JOIN public.users recipient ON recipient.id=invoice.recipient_user_id
    WHERE outbox.id=p_outbox_id AND outbox.message_kind='INVOICE_FINALIZED'),false)
$$;

CREATE OR REPLACE FUNCTION public.axora_invoice_email_ready(p_outbox_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_invoice_email_payload(p_outbox_id) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.axora_queue_final_invoice_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE invoice_row public.invoices%ROWTYPE;
DECLARE locale_value text;
DECLARE outbox_id_value uuid;
BEGIN
  IF NEW.document_type<>'FINAL_INVOICE' OR NEW.lifecycle_status<>'CURRENT' THEN RETURN NEW; END IF;
  SELECT * INTO invoice_row FROM public.invoices invoice
  WHERE invoice.request_id=NEW.request_id AND invoice.direction='CUSTOMER'
    AND invoice.lifecycle_status='FINALIZED' AND invoice.checkout_idempotency_key IS NOT NULL
  ORDER BY invoice.finalized_at DESC,invoice.id LIMIT 1;
  IF invoice_row.id IS NULL THEN RAISE EXCEPTION 'Final invoice email source is unavailable'; END IF;
  SELECT COALESCE(NULLIF(job.locale,''),'en') INTO locale_value
  FROM public.document_generation_jobs job WHERE job.id=NEW.generation_job_id;
  INSERT INTO public.transactional_email_outbox(
    message_kind,invoice_id,generated_document_id,locale
  ) VALUES ('INVOICE_FINALIZED',invoice_row.id,NEW.id,locale_value)
  ON CONFLICT(invoice_id) DO NOTHING RETURNING id INTO outbox_id_value;
  IF outbox_id_value IS NOT NULL THEN
    INSERT INTO public.payment_accountability_events(
      company_id,request_id,invoice_id,payment_id,event_type,actor_user_id,
      correlation_id,metadata,occurred_at
    ) SELECT invoice_row.company_id,invoice_row.request_id,invoice_row.id,payment.id,
      'INVOICE_EMAIL_QUEUED',invoice_row.finalized_by,gen_random_uuid(),
      jsonb_build_object('outboxId',outbox_id_value,'documentId',NEW.id),NEW.generated_at
    FROM public.payments payment WHERE payment.invoice_id=invoice_row.id
      AND payment.payment_status='PAID' ORDER BY payment.paid_at LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_final_invoice_email
AFTER INSERT ON public.generated_documents
FOR EACH ROW EXECUTE FUNCTION public.axora_queue_final_invoice_email();

CREATE OR REPLACE FUNCTION public.axora_complete_final_invoice_document_job(
  p_job_id uuid,p_lease_id uuid,p_file_name text,p_storage_path text,
  p_checksum_sha256 text,p_page_count integer,p_file_size_bytes bigint,p_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job_row public.document_generation_jobs%ROWTYPE;
DECLARE document_id_value uuid:=gen_random_uuid();
BEGIN
  IF char_length(COALESCE(p_file_name,'')) NOT BETWEEN 5 AND 180
    OR position('/' IN p_file_name)>0 OR position(chr(92) IN p_file_name)>0
    OR p_file_name ~ '[[:cntrl:]]'
    OR p_storage_path !~ '^generated-documents/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
    OR p_checksum_sha256 !~ '^[0-9a-f]{64}$' OR p_page_count NOT BETWEEN 1 AND 2000
    OR p_file_size_bytes NOT BETWEEN 100 AND 10485760 THEN
    RAISE EXCEPTION 'The generated invoice output is invalid';
  END IF;
  SELECT * INTO job_row FROM public.document_generation_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF job_row.id IS NULL OR job_row.document_type<>'FINAL_INVOICE'
    OR job_row.status<>'PROCESSING' OR job_row.lease_id<>p_lease_id
    OR job_row.lease_expires_at<=p_at THEN
    RAISE EXCEPTION 'The invoice document worker lease is unavailable';
  END IF;
  INSERT INTO public.generated_documents(
    id,generation_job_id,company_id,branch_id,department_id,request_id,
    document_type,visibility,document_version,lifecycle_status,file_name,
    storage_path,checksum_sha256,page_count,file_size_bytes,input_sha256,
    template_version,generator_version,source_version,generated_by,generated_at
  ) VALUES (
    document_id_value,job_row.id,job_row.company_id,job_row.branch_id,
    job_row.department_id,job_row.request_id,'FINAL_INVOICE','CUSTOMER',1,'CURRENT',
    p_file_name,p_storage_path,p_checksum_sha256,p_page_count,p_file_size_bytes,
    job_row.input_sha256,job_row.template_version,job_row.generator_version,
    job_row.source_version,job_row.requested_by,p_at
  );
  UPDATE public.document_generation_jobs SET status='COMPLETED',completed_at=p_at,
    lease_id=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=job_row.id;
  INSERT INTO public.document_generation_events(
    company_id,job_id,event_type,actor_user_id,reason,metadata,occurred_at
  ) VALUES (job_row.company_id,job_row.id,'COMPLETED',job_row.requested_by,
    job_row.generation_reason,jsonb_build_object('documentId',document_id_value,
      'version',1,'checksum',p_checksum_sha256,'pages',p_page_count,'bytes',p_file_size_bytes),p_at);
  RETURN jsonb_build_object('documentId',document_id_value,'version',1);
END $$;

CREATE OR REPLACE FUNCTION public.axora_complete_payment(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_strategy text,p_idempotency_key text,p_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE access_snapshot jsonb;
DECLARE request_row record;
DECLARE subtotal_value numeric(18,2);
DECLARE total_value numeric(18,2);
DECLARE line_count integer;
DECLARE invoice_row public.invoices%ROWTYPE;
DECLARE payment_id_value uuid;
DECLARE job_id_value uuid;
DECLARE correlation_value uuid:=gen_random_uuid();
DECLARE invoice_number_value text;
DECLARE lines_value jsonb;
DECLARE customer_value jsonb;
DECLARE snapshot_value jsonb;
DECLARE template_row public.document_templates%ROWTYPE;
BEGIN
  IF p_strategy<>'OFFLINE' OR char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Payment completion is invalid';
  END IF;
  SELECT public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,'request.submit',p_request_id,p_at
  ) INTO access_snapshot;
  IF access_snapshot IS NULL THEN
    RAISE EXCEPTION 'The request is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT request.id,request.company_id,request.branch_id,request.department_id,
    request.request_version,request.order_code,request.currency,
    request.estimated_delivery_fee,request.tax_rate,request.tax_amount,
    request.approval_state,request.needed_by_date,company.name AS company_name,
    to_jsonb(company) AS company_json,branch.name AS branch_name,
    branch.delivery_address,approval.amount AS approved_amount,
    account.display_name AS recipient_name,account.email AS recipient_email,
    COALESCE(profile.preferred_locale,'en') AS locale,
    COALESCE(profile.timezone,'Asia/Kuala_Lumpur') AS timezone
  INTO request_row
  FROM public.requests request
  JOIN public.companies company ON company.id=request.company_id AND company.active
  JOIN public.branches branch ON branch.id=request.branch_id AND branch.active
  JOIN public.request_approval_snapshots approval
    ON approval.request_id=request.id AND approval.request_version=request.request_version
  JOIN public.users account ON account.id=p_actor_user_id AND account.active
    AND account.account_status='ACTIVE' AND account.account_kind='COMPANY'
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
  WHERE request.id=p_request_id FOR UPDATE OF request;
  IF request_row.id IS NULL OR request_row.approval_state<>'APPROVED' THEN
    RAISE EXCEPTION 'The request is not ready for payment';
  END IF;
  SELECT * INTO invoice_row FROM public.invoices invoice
  WHERE invoice.request_id=p_request_id AND invoice.direction='CUSTOMER'
    AND invoice.checkout_idempotency_key IS NOT NULL FOR UPDATE;
  IF invoice_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('invoiceId',invoice_row.id,
      'invoiceNumber',invoice_row.invoice_number,'paymentStatus','PAID',
      'invoiceStatus',invoice_row.lifecycle_status,'created',false);
  END IF;
  SELECT count(*)::integer,
    COALESCE(sum(round(line.quantity*line.unit_sell_price,2)),0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'sku',COALESCE(product.product_code,line.request_line_code),
      'name',line.product_name_snapshot,'description',COALESCE(line.specification,''),
      'quantity',line.quantity::text,'unitOfMeasure',line.unit_of_measure,
      'unitPrice',line.unit_sell_price::text,
      'lineTotal',round(line.quantity*line.unit_sell_price,2)::text
    ) ORDER BY line.created_at,line.id),'[]'::jsonb)
  INTO line_count,subtotal_value,lines_value
  FROM public.request_lines line
  LEFT JOIN public.products product ON product.id=line.product_id
  WHERE line.request_id=p_request_id;
  total_value:=round(subtotal_value+request_row.estimated_delivery_fee+request_row.tax_amount,2);
  IF line_count<1 OR total_value<=0 OR total_value<>request_row.approved_amount THEN
    RAISE EXCEPTION 'The approved request pricing is stale';
  END IF;
  customer_value:=jsonb_build_object(
    'companyName',request_row.company_name,
    'registrationNumber',COALESCE(request_row.company_json->>'registration_number',''),
    'billingName',COALESCE(request_row.company_json->>'billing_contact_name',''),
    'billingEmail',COALESCE(request_row.company_json->>'billing_contact_email',''),
    'billingAddress',COALESCE(request_row.company_json->>'billing_address',''),
    'branchName',request_row.branch_name,'deliveryAddress',request_row.delivery_address
  );
  invoice_number_value:='AX-INV-'||to_char(p_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY')
    ||'-'||lpad(nextval('public.customer_invoice_number_seq')::text,8,'0');
  INSERT INTO public.invoices(
    direction,request_id,company_id,invoice_number,invoice_date,due_date,amount,status_id,
    lifecycle_status,currency,subtotal,discount_amount,tax_amount,delivery_fee,
    customer_snapshot,line_items_snapshot,finalized_at,finalized_by,recipient_user_id,
    checkout_idempotency_key,notes
  ) VALUES (
    'CUSTOMER',p_request_id,request_row.company_id,invoice_number_value,
    (p_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
    (p_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,total_value,
    public.lookup_id('invoice_status','Issued'),'FINALIZED',request_row.currency,
    subtotal_value,0,request_row.tax_amount,request_row.estimated_delivery_fee,
    customer_value,lines_value,p_at,p_actor_user_id,p_actor_user_id,p_idempotency_key,
    'Finalized by the server-authoritative payment workflow'
  ) RETURNING * INTO invoice_row;
  INSERT INTO public.payments(
    invoice_id,payment_date,amount,method,reference,recorded_by,
    payment_status,paid_at,idempotency_key,notes
  ) VALUES (
    invoice_row.id,(p_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,total_value,p_strategy,
    'AXORA-'||invoice_number_value,p_actor_user_id,'PAID',p_at,
    'checkout:'||p_request_id,'Recorded by the current offline payment strategy'
  ) RETURNING id INTO payment_id_value;
  SELECT * INTO template_row FROM public.document_templates
  WHERE document_type='FINAL_INVOICE' AND active
  ORDER BY template_version DESC LIMIT 1;
  snapshot_value:=jsonb_build_object(
    'schemaVersion',1,'documentType','FINAL_INVOICE','locale',request_row.locale,
    'timezone',request_row.timezone,'capturedAt',p_at,'company',customer_value,
    'invoice',jsonb_build_object('number',invoice_number_value,'status','PAID',
      'issuedAt',p_at,'paidAt',p_at,'currency',request_row.currency,'amount',total_value::text),
    'request',jsonb_build_object('id',p_request_id,'reference',request_row.order_code,
      'branchName',request_row.branch_name,'neededByDate',request_row.needed_by_date),
    'lines',lines_value,'totals',jsonb_build_object('subtotal',subtotal_value::text,
      'discount','0.00','tax',request_row.tax_amount::text,
      'delivery',request_row.estimated_delivery_fee::text,'total',total_value::text),
    'disclaimer','This finalized invoice records the completed payment and is independent of physical delivery.'
  );
  INSERT INTO public.document_generation_jobs(
    company_id,branch_id,department_id,request_id,document_type,request_version,
    source_version,source_reference,locale,timezone,input_snapshot,input_sha256,
    template_version,generator_version,generation_reason,requested_by,idempotency_key
  ) VALUES (
    request_row.company_id,request_row.branch_id,request_row.department_id,p_request_id,
    'FINAL_INVOICE',request_row.request_version,1,invoice_number_value,
    request_row.locale,request_row.timezone,snapshot_value,
    encode(sha256(convert_to(snapshot_value::text,'UTF8')),'hex'),
    template_row.template_version,template_row.generator_version,'WORKFLOW',
    p_actor_user_id,'final-invoice:'||invoice_row.id
  ) RETURNING id INTO job_id_value;
  INSERT INTO public.payment_accountability_events(
    company_id,request_id,invoice_id,payment_id,event_type,actor_user_id,
    actor_role_assignment_id,correlation_id,metadata,occurred_at
  ) VALUES
    (request_row.company_id,p_request_id,invoice_row.id,payment_id_value,'CHECKOUT_COMPLETED',
      p_actor_user_id,p_actor_role_assignment_id,correlation_value,jsonb_build_object('strategy',p_strategy),p_at),
    (request_row.company_id,p_request_id,invoice_row.id,payment_id_value,'PAYMENT_RECORDED',
      p_actor_user_id,p_actor_role_assignment_id,correlation_value,jsonb_build_object('status','PAID','strategy',p_strategy),p_at),
    (request_row.company_id,p_request_id,invoice_row.id,payment_id_value,'INVOICE_FINALIZED',
      p_actor_user_id,p_actor_role_assignment_id,correlation_value,jsonb_build_object('invoiceNumber',invoice_number_value),p_at),
    (request_row.company_id,p_request_id,invoice_row.id,payment_id_value,'INVOICE_DOCUMENT_QUEUED',
      p_actor_user_id,p_actor_role_assignment_id,correlation_value,jsonb_build_object('jobId',job_id_value),p_at);
  RETURN jsonb_build_object('invoiceId',invoice_row.id,'invoiceNumber',invoice_number_value,
    'paymentStatus','PAID','invoiceStatus','FINALIZED','created',true);
END $$;

CREATE OR REPLACE FUNCTION public.axora_final_invoice_summary(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,p_at timestamptz
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,
    'status',invoice.lifecycle_status,'paymentStatus',payment.payment_status,
    'amount',invoice.amount::text,'currency',invoice.currency,
    'issuedAt',invoice.finalized_at,'paidAt',payment.paid_at,
    'documentId',document.id,
    'downloadUrl',CASE WHEN document.id IS NOT NULL
      THEN '/api/generated-documents/'||document.id END,
    'emailStatus',outbox.delivery_status
  )
  FROM public.invoices invoice
  JOIN public.payments payment ON payment.invoice_id=invoice.id
    AND payment.payment_status='PAID'
  LEFT JOIN public.generated_documents document ON document.request_id=invoice.request_id
    AND document.document_type='FINAL_INVOICE' AND document.lifecycle_status='CURRENT'
    AND public.axora_generated_document_access_allowed(
      p_actor_user_id,p_actor_role_assignment_id,document.id,p_at)
  LEFT JOIN public.transactional_email_outbox outbox ON outbox.invoice_id=invoice.id
  WHERE invoice.request_id=p_request_id AND invoice.direction='CUSTOMER'
    AND invoice.lifecycle_status='FINALIZED'
    AND public.axora_lock_request_resource_access(
      p_actor_user_id,p_actor_role_assignment_id,'request.submit',p_request_id,p_at
    ) IS NOT NULL
  ORDER BY payment.paid_at LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_final_invoice_summary(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_complete_final_invoice_document_job(uuid,uuid,text,text,text,integer,bigint,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_invoice_email_payload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_invoice_email_ready(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_invoice_email_recipient_suppressed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_queue_final_invoice_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_invoice_email_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_new_invoice_workflow() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_invoice_overpayment() FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  REVOKE ALL ON TABLE public.payment_accountability_events FROM axora_app;
  GRANT EXECUTE ON FUNCTION public.axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz) TO axora_app;
  GRANT EXECUTE ON FUNCTION public.axora_final_invoice_summary(uuid,uuid,uuid,timestamptz) TO axora_app;
  GRANT EXECUTE ON FUNCTION public.axora_complete_final_invoice_document_job(uuid,uuid,text,text,text,integer,bigint,timestamptz) TO axora_app;
END IF; END $$;

COMMIT;
