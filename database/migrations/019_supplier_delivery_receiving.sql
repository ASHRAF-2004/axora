BEGIN;

-- These helpers make row-security policies fail closed when the application
-- has not established an authenticated request context.
CREATE OR REPLACE FUNCTION axora_context_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  context_value text;
BEGIN
  context_value := current_setting('axora.user_id', true);
  IF context_value IS NULL OR context_value = '' THEN
    RETURN NULL;
  END IF;
  RETURN context_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION axora_user_is_platform(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users account
    WHERE account.id = p_user_id
      AND account.active
      AND account.account_status = 'ACTIVE'
      AND (
        account.is_owner
        OR EXISTS (
          SELECT 1
          FROM public.role_assignments assignment
          JOIN public.roles role ON role.id = assignment.role_id
          WHERE assignment.user_id = account.id
            AND assignment.active
            AND assignment.scope_type = 'PLATFORM'
            AND role.role_key IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION axora_context_is_platform()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT axora_user_is_platform(axora_context_user_id())
$$;

CREATE OR REPLACE FUNCTION axora_user_is_supplier_member(
  p_user_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_memberships membership
    JOIN public.users account ON account.id = membership.user_id
    WHERE membership.user_id = p_user_id
      AND membership.supplier_id = p_supplier_id
      AND membership.status = 'ACTIVE'
      AND account.active
      AND account.account_status = 'ACTIVE'
      AND account.account_kind = 'SUPPLIER'
  )
$$;

CREATE OR REPLACE FUNCTION axora_context_has_supplier_access(p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT axora_context_is_platform()
    OR axora_user_is_supplier_member(axora_context_user_id(), p_supplier_id)
$$;

CREATE OR REPLACE FUNCTION axora_user_can_receive(
  p_user_id uuid,
  p_company_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.company_memberships membership
      ON membership.user_id = account.id
      AND membership.company_id = p_company_id
      AND membership.status = 'ACTIVE'
    JOIN public.branch_assignments branch_scope
      ON branch_scope.user_id = account.id
      AND branch_scope.company_id = p_company_id
      AND branch_scope.branch_id = p_branch_id
      AND branch_scope.status = 'ACTIVE'
    WHERE account.id = p_user_id
      AND account.active
      AND account.account_status = 'ACTIVE'
      AND account.account_kind = 'COMPANY'
      AND EXISTS (
        SELECT 1
        FROM public.role_assignments assignment
        JOIN public.roles role ON role.id = assignment.role_id
        WHERE assignment.user_id = account.id
          AND assignment.active
          AND role.role_key IN ('RECEIVING_USER','COMPANY_ADMIN')
          AND (
            (assignment.scope_type = 'COMPANY'
              AND assignment.company_id = p_company_id)
            OR
            (assignment.scope_type = 'BRANCH'
              AND assignment.company_id = p_company_id
              AND assignment.branch_id = p_branch_id)
          )
      )
  )
$$;

CREATE OR REPLACE FUNCTION axora_user_can_review_match(
  p_user_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.axora_user_is_platform(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.users account
      JOIN public.company_memberships membership
        ON membership.user_id = account.id
        AND membership.company_id = p_company_id
        AND membership.status = 'ACTIVE'
      JOIN public.role_assignments assignment
        ON assignment.user_id = account.id
        AND assignment.active
        AND assignment.company_id = p_company_id
      JOIN public.roles role
        ON role.id = assignment.role_id
        AND role.role_key = 'FINANCE_REVIEWER'
      WHERE account.id = p_user_id
        AND account.active
        AND account.account_status = 'ACTIVE'
        AND account.account_kind = 'COMPANY'
        AND assignment.scope_type IN ('COMPANY','BRANCH')
    )
$$;

-- Supplier portal ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL REFERENCES request_lines(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  rfq_reference text NOT NULL CHECK (char_length(btrim(rfq_reference)) BETWEEN 3 AND 80),
  status text NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('ISSUED','VIEWED','ACKNOWLEDGED','RESPONDED','DECLINED','WITHDRAWN','EXPIRED','CLOSED')),
  respond_by timestamptz,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(requirements) = 'object' AND workflow_metadata_is_safe(requirements)),
  issued_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200
      AND idempotency_key !~ '[[:cntrl:]]'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, supplier_id, company_id),
  UNIQUE(company_id, rfq_reference),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(request_line_id, supplier_id, round_number),
  CHECK (respond_by IS NULL OR respond_by > issued_at),
  CHECK ((status IN ('WITHDRAWN','EXPIRED','CLOSED') AND closed_at IS NOT NULL)
    OR (status NOT IN ('WITHDRAWN','EXPIRED','CLOSED') AND closed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS supplier_rfqs_supplier_status_idx
  ON supplier_rfqs(supplier_id, status, respond_by);
CREATE INDEX IF NOT EXISTS supplier_rfqs_company_line_idx
  ON supplier_rfqs(company_id, request_line_id, round_number DESC);

CREATE OR REPLACE FUNCTION validate_supplier_rfq()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_company_id uuid;
  supplier_is_active boolean;
BEGIN
  SELECT request.company_id
  INTO line_company_id
  FROM request_lines line
  JOIN requests request ON request.id = line.request_id
  WHERE line.id = NEW.request_line_id;

  IF line_company_id IS NULL OR line_company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'RFQ request line must belong to the same company';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT active INTO supplier_is_active FROM suppliers WHERE id = NEW.supplier_id;
    IF supplier_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RFQ supplier must be active';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NOT axora_user_is_platform(NEW.issued_by) THEN
    RAISE EXCEPTION 'Only an active platform operator may issue an RFQ';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','respond_by','closed_at','updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','respond_by','closed_at','updated_at']) THEN
      RAISE EXCEPTION 'RFQ identity and issued content are immutable';
    END IF;

    IF OLD.status IN ('WITHDRAWN','EXPIRED','CLOSED') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A terminal RFQ cannot be reopened';
    END IF;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_supplier_rfq_write ON supplier_rfqs;
CREATE TRIGGER validate_supplier_rfq_write
BEFORE INSERT OR UPDATE ON supplier_rfqs
FOR EACH ROW EXECUTE FUNCTION validate_supplier_rfq();

CREATE TABLE IF NOT EXISTS supplier_rfq_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_membership_id uuid NOT NULL REFERENCES supplier_memberships(id) ON DELETE RESTRICT,
  acknowledged_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  acknowledgement text NOT NULL
    CHECK (acknowledgement IN ('ACKNOWLEDGED','DECLINED','CLARIFICATION_REQUESTED')),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  client_event_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rfq_id, supplier_id, company_id)
    REFERENCES supplier_rfqs(id, supplier_id, company_id) ON DELETE RESTRICT,
  UNIQUE(supplier_id, client_event_id),
  UNIQUE(rfq_id, supplier_membership_id, client_event_id),
  CHECK (acknowledged_at <= recorded_at + interval '24 hours')
);

CREATE TABLE IF NOT EXISTS supplier_quotation_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_membership_id uuid NOT NULL REFERENCES supplier_memberships(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  response_version integer NOT NULL CHECK (response_version > 0),
  response_status text NOT NULL
    CHECK (response_status IN ('SUBMITTED','REVISED','WITHDRAWN')),
  quotation_reference text NOT NULL
    CHECK (char_length(btrim(quotation_reference)) BETWEEN 1 AND 120),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  delivery_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  minimum_order_quantity numeric(14,3)
    CHECK (minimum_order_quantity IS NULL OR minimum_order_quantity >= 0),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  valid_until date,
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  client_event_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rfq_id, supplier_id, company_id)
    REFERENCES supplier_rfqs(id, supplier_id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, rfq_id, supplier_id, company_id),
  UNIQUE(rfq_id, response_version),
  UNIQUE(supplier_id, client_event_id),
  CHECK (submitted_at <= recorded_at + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS supplier_quotation_responses_rfq_idx
  ON supplier_quotation_responses(rfq_id, response_version DESC);

CREATE TABLE IF NOT EXISTS supplier_rfq_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  document_version integer NOT NULL CHECK (document_version > 0),
  document_kind text NOT NULL
    CHECK (document_kind IN ('RFQ','QUOTATION','ACKNOWLEDGEMENT','CLARIFICATION','SUPPORTING')),
  file_name text NOT NULL
    CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 180
      AND file_name !~ '[\\/[:cntrl:]]'),
  content_type text NOT NULL
    CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  storage_path text NOT NULL
    CHECK (char_length(storage_path) BETWEEN 10 AND 500
      AND storage_path ~ '^supplier-portal/[A-Za-z0-9._/-]+$'
      AND storage_path !~ '(^|/)\.\.(/|$)'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_membership_id uuid REFERENCES supplier_memberships(id) ON DELETE RESTRICT,
  supersedes_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rfq_id, supplier_id, company_id)
    REFERENCES supplier_rfqs(id, supplier_id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, rfq_id, supplier_id, company_id),
  UNIQUE(rfq_id, document_kind, document_version),
  UNIQUE(rfq_id, sha256),
  FOREIGN KEY(supersedes_document_id, rfq_id, supplier_id, company_id)
    REFERENCES supplier_rfq_documents(id, rfq_id, supplier_id, company_id) ON DELETE RESTRICT,
  CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> id)
);

CREATE INDEX IF NOT EXISTS supplier_rfq_documents_history_idx
  ON supplier_rfq_documents(rfq_id, document_kind, document_version DESC);

CREATE OR REPLACE FUNCTION validate_supplier_portal_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  membership_user_id uuid;
  membership_supplier_id uuid;
  membership_status text;
  submission_user_id uuid;
BEGIN
  SELECT user_id, supplier_id, status
  INTO membership_user_id, membership_supplier_id, membership_status
  FROM supplier_memberships
  WHERE id = NEW.supplier_membership_id;

  IF membership_status IS DISTINCT FROM 'ACTIVE'
    OR membership_supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'Submission requires an active membership for this supplier';
  END IF;

  submission_user_id := CASE TG_TABLE_NAME
    WHEN 'supplier_rfq_acknowledgements'
      THEN (to_jsonb(NEW)->>'acknowledged_by')::uuid
    WHEN 'supplier_quotation_responses'
      THEN (to_jsonb(NEW)->>'submitted_by')::uuid
    ELSE NULL
  END;

  IF membership_user_id IS DISTINCT FROM submission_user_id THEN
    RAISE EXCEPTION 'Submission actor must own the supplier membership';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_supplier_acknowledgement
  ON supplier_rfq_acknowledgements;
CREATE TRIGGER validate_supplier_acknowledgement
BEFORE INSERT ON supplier_rfq_acknowledgements
FOR EACH ROW EXECUTE FUNCTION validate_supplier_portal_submission();

DROP TRIGGER IF EXISTS validate_supplier_quotation_response
  ON supplier_quotation_responses;
CREATE TRIGGER validate_supplier_quotation_response
BEFORE INSERT ON supplier_quotation_responses
FOR EACH ROW EXECUTE FUNCTION validate_supplier_portal_submission();

CREATE OR REPLACE FUNCTION validate_supplier_rfq_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  member_user_id uuid;
  member_supplier_id uuid;
  member_status text;
BEGIN
  IF NEW.supplier_membership_id IS NULL THEN
    IF NOT axora_user_is_platform(NEW.uploaded_by) THEN
      RAISE EXCEPTION 'Platform document uploads require a platform operator';
    END IF;
    IF NEW.document_kind IN ('QUOTATION','ACKNOWLEDGEMENT') THEN
      RAISE EXCEPTION 'Supplier-authored documents require a supplier membership';
    END IF;
  ELSE
    SELECT user_id, supplier_id, status
    INTO member_user_id, member_supplier_id, member_status
    FROM supplier_memberships
    WHERE id = NEW.supplier_membership_id;
    IF member_status IS DISTINCT FROM 'ACTIVE'
      OR member_supplier_id IS DISTINCT FROM NEW.supplier_id
      OR member_user_id IS DISTINCT FROM NEW.uploaded_by THEN
      RAISE EXCEPTION 'Document uploader must be an active member of this supplier';
    END IF;
    IF NEW.document_kind = 'RFQ' THEN
      RAISE EXCEPTION 'Only platform operators may publish RFQ documents';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_supplier_rfq_document_insert
  ON supplier_rfq_documents;
CREATE TRIGGER validate_supplier_rfq_document_insert
BEFORE INSERT ON supplier_rfq_documents
FOR EACH ROW EXECUTE FUNCTION validate_supplier_rfq_document();

DO $$
DECLARE
  append_table text;
BEGIN
  FOREACH append_table IN ARRAY ARRAY[
    'supplier_rfq_acknowledgements',
    'supplier_quotation_responses',
    'supplier_rfq_documents'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', append_table, append_table);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation()',
      append_table,
      append_table
    );
  END LOOP;
END $$;

-- Delivery portal ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  request_id uuid NOT NULL,
  job_code text NOT NULL CHECK (char_length(btrim(job_code)) BETWEEN 3 AND 80),
  status text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED','DELIVERED','FAILED','CANCELLED')),
  scheduled_window_start timestamptz,
  scheduled_window_end timestamptz,
  delivery_address_snapshot text NOT NULL
    CHECK (char_length(btrim(delivery_address_snapshot)) BETWEEN 3 AND 1000),
  contact_name_snapshot text NOT NULL DEFAULT '' CHECK (char_length(contact_name_snapshot) <= 200),
  contact_phone_snapshot text NOT NULL DEFAULT '' CHECK (char_length(contact_phone_snapshot) <= 40),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200
      AND idempotency_key !~ '[[:cntrl:]]'),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id, company_id)
    REFERENCES branches(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY(request_id, company_id)
    REFERENCES requests(id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, company_id),
  UNIQUE(company_id, job_code),
  UNIQUE(company_id, idempotency_key),
  CHECK (scheduled_window_start IS NULL OR scheduled_window_end IS NULL
    OR scheduled_window_end > scheduled_window_start)
);

CREATE INDEX IF NOT EXISTS delivery_jobs_branch_status_idx
  ON delivery_jobs(company_id, branch_id, status, scheduled_window_start);

CREATE OR REPLACE FUNCTION validate_delivery_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT axora_user_is_platform(NEW.created_by) THEN
    RAISE EXCEPTION 'Only a platform operator may create a delivery job';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','scheduled_window_start','scheduled_window_end','instructions','updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','scheduled_window_start','scheduled_window_end','instructions','updated_at']) THEN
      RAISE EXCEPTION 'Delivery job identity and tenant scope are immutable';
    END IF;
    IF OLD.status IN ('DELIVERED','FAILED','CANCELLED') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A terminal delivery job cannot be reopened';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_delivery_job_write ON delivery_jobs;
CREATE TRIGGER validate_delivery_job_write
BEFORE INSERT OR UPDATE ON delivery_jobs
FOR EACH ROW EXECUTE FUNCTION validate_delivery_job();

CREATE TABLE IF NOT EXISTS delivery_job_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL,
  request_line_id uuid NOT NULL REFERENCES request_lines(id) ON DELETE RESTRICT,
  quantity_to_deliver numeric(14,3) NOT NULL CHECK (quantity_to_deliver > 0),
  unit_of_measure_snapshot text NOT NULL
    CHECK (char_length(btrim(unit_of_measure_snapshot)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(delivery_job_id, company_id)
    REFERENCES delivery_jobs(id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, delivery_job_id, company_id, request_line_id),
  UNIQUE(delivery_job_id, request_line_id)
);

CREATE OR REPLACE FUNCTION validate_delivery_job_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_request_id uuid;
  ordered_quantity numeric(14,3);
  job_request_id uuid;
  job_status text;
  already_planned numeric(14,3);
BEGIN
  SELECT request_id, quantity
  INTO line_request_id, ordered_quantity
  FROM request_lines
  WHERE id = NEW.request_line_id
  FOR UPDATE;

  SELECT request_id, status
  INTO job_request_id, job_status
  FROM delivery_jobs
  WHERE id = NEW.delivery_job_id AND company_id = NEW.company_id;

  IF line_request_id IS NULL OR line_request_id <> job_request_id THEN
    RAISE EXCEPTION 'Delivery line must belong to the delivery job request';
  END IF;
  IF job_status IN ('DELIVERED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'Lines cannot be added to a terminal delivery job';
  END IF;

  SELECT COALESCE(sum(job_line.quantity_to_deliver), 0)
  INTO already_planned
  FROM delivery_job_lines job_line
  JOIN delivery_jobs job ON job.id = job_line.delivery_job_id
  WHERE job_line.request_line_id = NEW.request_line_id
    AND job.status <> 'CANCELLED';

  IF already_planned + NEW.quantity_to_deliver > ordered_quantity THEN
    RAISE EXCEPTION 'Planned delivery quantity exceeds the ordered quantity';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_delivery_job_line_insert ON delivery_job_lines;
CREATE TRIGGER validate_delivery_job_line_insert
BEFORE INSERT ON delivery_job_lines
FOR EACH ROW EXECUTE FUNCTION validate_delivery_job_line();

DROP TRIGGER IF EXISTS delivery_job_lines_append_only ON delivery_job_lines;
CREATE TRIGGER delivery_job_lines_append_only
BEFORE UPDATE OR DELETE ON delivery_job_lines
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS delivery_job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES delivery_agent_profiles(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED','ACCEPTED','REJECTED','REASSIGNED','CANCELLED','COMPLETED')),
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(delivery_job_id, company_id)
    REFERENCES delivery_jobs(id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, delivery_job_id, company_id, driver_user_id),
  CHECK ((status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED') AND ended_at IS NOT NULL)
    OR (status IN ('ASSIGNED','ACCEPTED') AND ended_at IS NULL)),
  CHECK ((status = 'ACCEPTED' AND accepted_at IS NOT NULL)
    OR status <> 'ACCEPTED'),
  CHECK (accepted_at IS NULL OR accepted_at >= assigned_at),
  CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_job_one_active_assignment_uq
  ON delivery_job_assignments(delivery_job_id)
  WHERE status IN ('ASSIGNED','ACCEPTED');
CREATE INDEX IF NOT EXISTS delivery_assignments_driver_idx
  ON delivery_job_assignments(driver_user_id, status, assigned_at DESC);

CREATE OR REPLACE FUNCTION validate_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  driver_is_active boolean;
  job_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT profile.active AND account.active
      AND account.account_status = 'ACTIVE'
      AND account.account_kind = 'DELIVERY'
    INTO driver_is_active
    FROM delivery_agent_profiles profile
    JOIN users account ON account.id = profile.user_id
    WHERE profile.user_id = NEW.driver_user_id;

    IF driver_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Only an active delivery driver can be assigned';
    END IF;
    IF NOT axora_user_is_platform(NEW.assigned_by) THEN
      RAISE EXCEPTION 'Only a platform operator may assign a delivery job';
    END IF;

    SELECT status INTO job_status
    FROM delivery_jobs
    WHERE id = NEW.delivery_job_id AND company_id = NEW.company_id;
    IF job_status IS NULL OR job_status IN ('DELIVERED','FAILED','CANCELLED') THEN
      RAISE EXCEPTION 'A terminal or missing delivery job cannot be assigned';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','accepted_at','ended_at','updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','accepted_at','ended_at','updated_at']) THEN
      RAISE EXCEPTION 'Delivery assignment identity is immutable';
    END IF;
    IF OLD.status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED')
      AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A terminal assignment cannot be reopened';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_delivery_assignment_write
  ON delivery_job_assignments;
CREATE TRIGGER validate_delivery_assignment_write
BEFORE INSERT OR UPDATE ON delivery_job_assignments
FOR EACH ROW EXECUTE FUNCTION validate_delivery_assignment();

CREATE TABLE IF NOT EXISTS delivery_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES delivery_agent_profiles(user_id) ON DELETE RESTRICT,
  device_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence >= 0),
  event_type text NOT NULL
    CHECK (event_type IN ('ACCEPTED','REJECTED','EN_ROUTE','ARRIVED','DELIVERED','FAILED','NOTE_ADDED')),
  client_recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND workflow_metadata_is_safe(metadata)),
  FOREIGN KEY(assignment_id, delivery_job_id, company_id, driver_user_id)
    REFERENCES delivery_job_assignments(id, delivery_job_id, company_id, driver_user_id)
    ON DELETE RESTRICT,
  UNIQUE(driver_user_id, client_event_id),
  UNIQUE(assignment_id, device_id, device_sequence),
  UNIQUE(id, delivery_job_id, company_id, driver_user_id),
  -- Retain the device timestamp as evidence, but reject clocks far enough in
  -- the future to distort operational chronology. Offline events may be old;
  -- they must never be materially ahead of the authoritative receive time.
  CHECK (client_recorded_at <= received_at + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS delivery_job_events_timeline_idx
  ON delivery_job_events(delivery_job_id, received_at, id);

CREATE OR REPLACE FUNCTION validate_delivery_job_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_started_at timestamptz;
  assignment_ended_at timestamptz;
BEGIN
  -- Server receipt time is authoritative for operational ordering. A driver or
  -- compromised client must not be able to supply this value.
  NEW.received_at := clock_timestamp();

  SELECT assigned_at, ended_at
  INTO assignment_started_at, assignment_ended_at
  FROM delivery_job_assignments
  WHERE id = NEW.assignment_id
    AND delivery_job_id = NEW.delivery_job_id
    AND company_id = NEW.company_id
    AND driver_user_id = NEW.driver_user_id;

  IF assignment_started_at IS NULL THEN
    RAISE EXCEPTION 'Delivery event must belong to the driver assignment';
  END IF;
  IF NEW.client_recorded_at < assignment_started_at - interval '5 minutes'
    OR (assignment_ended_at IS NOT NULL
      AND NEW.client_recorded_at > assignment_ended_at + interval '15 minutes') THEN
    RAISE EXCEPTION 'Delivery event occurred outside the assignment window';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_delivery_job_event_insert ON delivery_job_events;
CREATE TRIGGER validate_delivery_job_event_insert
BEFORE INSERT ON delivery_job_events
FOR EACH ROW EXECUTE FUNCTION validate_delivery_job_event();

DROP TRIGGER IF EXISTS delivery_job_events_append_only ON delivery_job_events;
CREATE TRIGGER delivery_job_events_append_only
BEFORE UPDATE OR DELETE ON delivery_job_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS delivery_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  delivery_job_id uuid NOT NULL,
  delivery_job_event_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES delivery_agent_profiles(user_id) ON DELETE RESTRICT,
  client_evidence_id uuid NOT NULL,
  evidence_type text NOT NULL
    CHECK (evidence_type IN ('PHOTO','SIGNATURE','DELIVERY_NOTE','LOCATION')),
  file_name text CHECK (file_name IS NULL OR (
    char_length(btrim(file_name)) BETWEEN 1 AND 180
    AND file_name !~ '[\\/[:cntrl:]]')),
  content_type text CHECK (content_type IS NULL OR
    content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  storage_path text CHECK (storage_path IS NULL OR (
    char_length(storage_path) BETWEEN 10 AND 500
    AND storage_path ~ '^delivery-evidence/[A-Za-z0-9._/-]+$'
    AND storage_path !~ '(^|/)\.\.(/|$)')),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND workflow_metadata_is_safe(metadata)),
  FOREIGN KEY(delivery_job_event_id, delivery_job_id, company_id, driver_user_id)
    REFERENCES delivery_job_events(id, delivery_job_id, company_id, driver_user_id)
    ON DELETE RESTRICT,
  UNIQUE(driver_user_id, client_evidence_id),
  CHECK (
    (evidence_type = 'LOCATION'
      AND file_name IS NULL AND content_type IS NULL AND storage_path IS NULL AND sha256 IS NULL)
    OR
    (evidence_type <> 'LOCATION'
      AND file_name IS NOT NULL AND content_type IS NOT NULL
      AND storage_path IS NOT NULL AND sha256 IS NOT NULL)
  ),
  CHECK (captured_at <= created_at + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS delivery_evidence_job_idx
  ON delivery_evidence(delivery_job_id, captured_at);

DROP TRIGGER IF EXISTS delivery_evidence_append_only ON delivery_evidence;
CREATE TRIGGER delivery_evidence_append_only
BEFORE UPDATE OR DELETE ON delivery_evidence
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION axora_context_can_access_delivery_job(p_delivery_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.axora_context_is_platform()
    OR EXISTS (
      SELECT 1
      FROM public.delivery_job_assignments assignment
      WHERE assignment.delivery_job_id = p_delivery_job_id
        AND assignment.driver_user_id = public.axora_context_user_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public.delivery_jobs job
      WHERE job.id = p_delivery_job_id
        AND public.axora_user_can_receive(
          public.axora_context_user_id(), job.company_id, job.branch_id
        )
    )
$$;

CREATE OR REPLACE FUNCTION axora_context_is_job_driver(
  p_delivery_job_id uuid,
  p_driver_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_driver_user_id = public.axora_context_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.delivery_job_assignments assignment
      WHERE assignment.delivery_job_id = p_delivery_job_id
        AND assignment.driver_user_id = p_driver_user_id
    )
$$;

-- Customer receiving ------------------------------------------------------

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  delivery_job_id uuid NOT NULL,
  receipt_reference text NOT NULL
    CHECK (char_length(btrim(receipt_reference)) BETWEEN 3 AND 80),
  status text NOT NULL
    CHECK (status IN ('ACCEPTED','ACCEPTED_WITH_EXCEPTIONS','REJECTED')),
  confirmed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_event_id uuid NOT NULL,
  received_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  FOREIGN KEY(branch_id, company_id)
    REFERENCES branches(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY(delivery_job_id, company_id)
    REFERENCES delivery_jobs(id, company_id) ON DELETE RESTRICT,
  UNIQUE(id, delivery_job_id, company_id),
  UNIQUE(company_id, receipt_reference),
  UNIQUE(confirmed_by_user_id, client_event_id),
  CHECK (received_at <= recorded_at + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS receipts_job_idx
  ON receipts(delivery_job_id, received_at DESC);

CREATE OR REPLACE FUNCTION validate_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_branch_id uuid;
BEGIN
  SELECT branch_id
  INTO job_branch_id
  FROM delivery_jobs
  WHERE id = NEW.delivery_job_id AND company_id = NEW.company_id;

  IF job_branch_id IS NULL OR job_branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Receipt branch must match the delivery job branch';
  END IF;
  IF NOT axora_user_can_receive(
    NEW.confirmed_by_user_id, NEW.company_id, NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Receipt confirmation requires an assigned customer receiving user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM delivery_job_assignments assignment
    WHERE assignment.delivery_job_id = NEW.delivery_job_id
      AND assignment.driver_user_id = NEW.confirmed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Driver evidence cannot serve as customer receipt confirmation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_receipt_insert ON receipts;
CREATE TRIGGER validate_receipt_insert
BEFORE INSERT ON receipts
FOR EACH ROW EXECUTE FUNCTION validate_receipt();

DROP TRIGGER IF EXISTS receipts_append_only ON receipts;
CREATE TRIGGER receipts_append_only
BEFORE UPDATE OR DELETE ON receipts
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL,
  delivery_job_id uuid NOT NULL,
  delivery_job_line_id uuid NOT NULL,
  request_line_id uuid NOT NULL REFERENCES request_lines(id) ON DELETE RESTRICT,
  planned_quantity_snapshot numeric(14,3) NOT NULL CHECK (planned_quantity_snapshot > 0),
  delivered_quantity numeric(14,3) NOT NULL CHECK (delivered_quantity >= 0),
  accepted_quantity numeric(14,3) NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  damaged_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  short_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (short_quantity >= 0),
  discrepancy_code text NOT NULL DEFAULT 'NONE'
    CHECK (discrepancy_code IN ('NONE','DAMAGED','SHORT','OVER','WRONG_ITEM','QUALITY','OTHER')),
  discrepancy_note text CHECK (discrepancy_note IS NULL OR char_length(discrepancy_note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_id, delivery_job_id, company_id)
    REFERENCES receipts(id, delivery_job_id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY(delivery_job_line_id, delivery_job_id, company_id, request_line_id)
    REFERENCES delivery_job_lines(id, delivery_job_id, company_id, request_line_id)
    ON DELETE RESTRICT,
  UNIQUE(id, receipt_id, company_id, request_line_id),
  UNIQUE(id, company_id, request_line_id),
  UNIQUE(receipt_id, delivery_job_line_id),
  CHECK (accepted_quantity + rejected_quantity = delivered_quantity),
  CHECK (damaged_quantity <= rejected_quantity),
  CHECK (
    (discrepancy_code = 'NONE'
      AND rejected_quantity = 0 AND damaged_quantity = 0 AND short_quantity = 0
      AND delivered_quantity = planned_quantity_snapshot)
    OR
    (discrepancy_code <> 'NONE'
      AND (rejected_quantity > 0 OR damaged_quantity > 0 OR short_quantity > 0
        OR delivered_quantity <> planned_quantity_snapshot))
  )
);

CREATE INDEX IF NOT EXISTS receipt_lines_request_idx
  ON receipt_lines(company_id, request_line_id, created_at DESC);

CREATE OR REPLACE FUNCTION validate_receipt_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  planned_quantity numeric(14,3);
  receipt_status text;
BEGIN
  SELECT quantity_to_deliver
  INTO planned_quantity
  FROM delivery_job_lines
  WHERE id = NEW.delivery_job_line_id
    AND delivery_job_id = NEW.delivery_job_id
    AND company_id = NEW.company_id
    AND request_line_id = NEW.request_line_id;

  IF planned_quantity IS NULL OR planned_quantity <> NEW.planned_quantity_snapshot THEN
    RAISE EXCEPTION 'Receipt planned quantity must match the delivery job line';
  END IF;

  SELECT status INTO receipt_status
  FROM receipts
  WHERE id = NEW.receipt_id
    AND delivery_job_id = NEW.delivery_job_id
    AND company_id = NEW.company_id;

  IF receipt_status = 'ACCEPTED' AND NEW.discrepancy_code <> 'NONE' THEN
    RAISE EXCEPTION 'An accepted receipt cannot contain a discrepancy';
  END IF;
  IF receipt_status = 'REJECTED' AND NEW.accepted_quantity > 0 THEN
    RAISE EXCEPTION 'A rejected receipt cannot contain accepted quantity';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_receipt_line_insert ON receipt_lines;
CREATE TRIGGER validate_receipt_line_insert
BEFORE INSERT ON receipt_lines
FOR EACH ROW EXECUTE FUNCTION validate_receipt_line();

DROP TRIGGER IF EXISTS receipt_lines_append_only ON receipt_lines;
CREATE TRIGGER receipt_lines_append_only
BEFORE UPDATE OR DELETE ON receipt_lines
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION axora_context_can_access_receipt(p_receipt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.axora_context_is_platform()
    OR EXISTS (
      SELECT 1
      FROM public.receipts receipt
      WHERE receipt.id = p_receipt_id
        AND public.axora_user_can_receive(
          public.axora_context_user_id(), receipt.company_id, receipt.branch_id
        )
    )
$$;

CREATE OR REPLACE FUNCTION axora_context_is_receipt_confirmer(p_receipt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.receipts receipt
    WHERE receipt.id = p_receipt_id
      AND receipt.confirmed_by_user_id = public.axora_context_user_id()
      AND public.axora_user_can_receive(
        public.axora_context_user_id(), receipt.company_id, receipt.branch_id
      )
  )
$$;

-- Three-way matching ------------------------------------------------------

CREATE TABLE IF NOT EXISTS three_way_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL REFERENCES request_lines(id) ON DELETE RESTRICT,
  supplier_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  receipt_line_id uuid,
  legacy_quotation_id uuid REFERENCES quotations(id) ON DELETE RESTRICT,
  supplier_quotation_response_id uuid
    REFERENCES supplier_quotation_responses(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'NOT_READY'
    CHECK (status IN ('NOT_READY','MATCHED','EXCEPTION','OVERRIDDEN')),
  ordered_quantity_snapshot numeric(14,3) NOT NULL CHECK (ordered_quantity_snapshot > 0),
  received_quantity_snapshot numeric(14,3) CHECK (received_quantity_snapshot IS NULL OR received_quantity_snapshot >= 0),
  invoiced_quantity_snapshot numeric(14,3) CHECK (invoiced_quantity_snapshot IS NULL OR invoiced_quantity_snapshot >= 0),
  ordered_unit_price_snapshot numeric(14,2) CHECK (ordered_unit_price_snapshot IS NULL OR ordered_unit_price_snapshot >= 0),
  invoiced_unit_price_snapshot numeric(14,2) CHECK (invoiced_unit_price_snapshot IS NULL OR invoiced_unit_price_snapshot >= 0),
  quantity_tolerance numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_tolerance >= 0),
  price_tolerance numeric(14,2) NOT NULL DEFAULT 0 CHECK (price_tolerance >= 0),
  quantity_variance numeric(14,3),
  price_variance numeric(14,2),
  evaluated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  overridden_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  overridden_at timestamptz,
  override_reason text CHECK (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_line_id, company_id, request_line_id)
    REFERENCES receipt_lines(id, company_id, request_line_id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(legacy_quotation_id, supplier_quotation_response_id) <= 1),
  CHECK (
    (status = 'OVERRIDDEN'
      AND overridden_by_user_id IS NOT NULL
      AND overridden_at IS NOT NULL
      AND override_reason IS NOT NULL)
    OR
    (status <> 'OVERRIDDEN'
      AND overridden_by_user_id IS NULL
      AND overridden_at IS NULL
      AND override_reason IS NULL)
  ),
  CHECK (overridden_by_user_id IS NULL
    OR overridden_by_user_id <> evaluated_by_user_id),
  CHECK (status NOT IN ('MATCHED','OVERRIDDEN')
    OR (
      supplier_invoice_id IS NOT NULL
      AND receipt_line_id IS NOT NULL
      AND num_nonnulls(legacy_quotation_id, supplier_quotation_response_id) = 1
      AND received_quantity_snapshot IS NOT NULL
      AND invoiced_quantity_snapshot IS NOT NULL
      AND ordered_unit_price_snapshot IS NOT NULL
      AND invoiced_unit_price_snapshot IS NOT NULL
      AND quantity_variance IS NOT NULL
      AND price_variance IS NOT NULL
    )),
  CHECK (quantity_variance IS NULL OR (
    received_quantity_snapshot IS NOT NULL
    AND invoiced_quantity_snapshot IS NOT NULL
    AND quantity_variance = invoiced_quantity_snapshot - received_quantity_snapshot
  )),
  CHECK (price_variance IS NULL OR (
    ordered_unit_price_snapshot IS NOT NULL
    AND invoiced_unit_price_snapshot IS NOT NULL
    AND price_variance = invoiced_unit_price_snapshot - ordered_unit_price_snapshot
  )),
  CHECK (status <> 'MATCHED' OR (
    abs(received_quantity_snapshot - ordered_quantity_snapshot) <= quantity_tolerance
    AND abs(invoiced_quantity_snapshot - received_quantity_snapshot) <= quantity_tolerance
    AND abs(price_variance) <= price_tolerance
  )),
  CHECK (evaluated_at <= created_at + interval '24 hours'),
  CHECK (overridden_at IS NULL OR overridden_at >= evaluated_at)
);

CREATE INDEX IF NOT EXISTS three_way_matches_company_status_idx
  ON three_way_matches(company_id, status, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS three_way_matches_request_line_idx
  ON three_way_matches(request_line_id, evaluated_at DESC);

CREATE OR REPLACE FUNCTION validate_three_way_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_company_id uuid;
  line_request_id uuid;
  ordered_quantity numeric(14,3);
  invoice_direction text;
  invoice_request_id uuid;
  invoice_supplier_id uuid;
  quote_supplier_id uuid;
  quote_line_id uuid;
  receipt_confirmer uuid;
BEGIN
  SELECT request.company_id, line.request_id, line.quantity
  INTO line_company_id, line_request_id, ordered_quantity
  FROM request_lines line
  JOIN requests request ON request.id = line.request_id
  WHERE line.id = NEW.request_line_id;

  IF line_company_id IS NULL OR line_company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Match request line must belong to the same company';
  END IF;
  IF NEW.ordered_quantity_snapshot <> ordered_quantity THEN
    RAISE EXCEPTION 'Match ordered quantity must equal the request-line snapshot';
  END IF;

  IF NEW.supplier_invoice_id IS NOT NULL THEN
    SELECT direction, request_id, supplier_id
    INTO invoice_direction, invoice_request_id, invoice_supplier_id
    FROM invoices WHERE id = NEW.supplier_invoice_id;
    IF invoice_direction IS DISTINCT FROM 'SUPPLIER'
      OR invoice_request_id IS DISTINCT FROM line_request_id THEN
      RAISE EXCEPTION 'Match invoice must be a supplier invoice for the same request';
    END IF;
  END IF;

  IF NEW.legacy_quotation_id IS NOT NULL THEN
    SELECT supplier_id, request_line_id
    INTO quote_supplier_id, quote_line_id
    FROM quotations WHERE id = NEW.legacy_quotation_id;
  ELSIF NEW.supplier_quotation_response_id IS NOT NULL THEN
    SELECT response.supplier_id, rfq.request_line_id
    INTO quote_supplier_id, quote_line_id
    FROM supplier_quotation_responses response
    JOIN supplier_rfqs rfq ON rfq.id = response.rfq_id
    WHERE response.id = NEW.supplier_quotation_response_id;
  END IF;

  IF quote_line_id IS NOT NULL AND quote_line_id <> NEW.request_line_id THEN
    RAISE EXCEPTION 'Match quotation must belong to the same request line';
  END IF;
  IF invoice_supplier_id IS NOT NULL AND quote_supplier_id IS NOT NULL
    AND invoice_supplier_id <> quote_supplier_id THEN
    RAISE EXCEPTION 'Match invoice and quotation must belong to the same supplier';
  END IF;

  IF NEW.receipt_line_id IS NOT NULL THEN
    SELECT receipt.confirmed_by_user_id
    INTO receipt_confirmer
    FROM receipt_lines line
    JOIN receipts receipt ON receipt.id = line.receipt_id
    WHERE line.id = NEW.receipt_line_id
      AND line.company_id = NEW.company_id
      AND line.request_line_id = NEW.request_line_id;
    IF receipt_confirmer IS NULL THEN
      RAISE EXCEPTION 'Match receipt line must belong to the same tenant and request line';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
    AND NOT axora_user_can_review_match(NEW.evaluated_by_user_id, NEW.company_id) THEN
    RAISE EXCEPTION 'Three-way matching requires a scoped finance reviewer';
  END IF;
  IF TG_OP = 'INSERT' AND receipt_confirmer IS NOT NULL
    AND NEW.evaluated_by_user_id = receipt_confirmer THEN
    RAISE EXCEPTION 'The receiver cannot evaluate the same three-way match';
  END IF;

  IF NEW.overridden_by_user_id IS NOT NULL THEN
    IF NOT axora_user_can_review_match(NEW.overridden_by_user_id, NEW.company_id) THEN
      RAISE EXCEPTION 'A match override requires a scoped finance reviewer';
    END IF;
    IF NEW.overridden_by_user_id = NEW.evaluated_by_user_id
      OR NEW.overridden_by_user_id = receipt_confirmer THEN
      RAISE EXCEPTION 'A match override requires independent review';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','overridden_by_user_id','overridden_at','override_reason','updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','overridden_by_user_id','overridden_at','override_reason','updated_at']) THEN
      RAISE EXCEPTION 'Three-way match evidence and evaluator are immutable';
    END IF;
    IF OLD.status = 'OVERRIDDEN' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'An overridden match is terminal';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_three_way_match_write ON three_way_matches;
CREATE TRIGGER validate_three_way_match_write
BEFORE INSERT OR UPDATE ON three_way_matches
FOR EACH ROW EXECUTE FUNCTION validate_three_way_match();

CREATE TABLE IF NOT EXISTS three_way_match_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  three_way_match_id uuid NOT NULL REFERENCES three_way_matches(id) ON DELETE RESTRICT,
  exception_code text NOT NULL
    CHECK (exception_code IN (
      'MISSING_QUOTATION','MISSING_RECEIPT','MISSING_INVOICE',
      'QUANTITY_VARIANCE','PRICE_VARIANCE','DUPLICATE_INVOICE',
      'DOCUMENT_MISMATCH','SUPPLIER_MISMATCH','OTHER'
    )),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  detail text NOT NULL CHECK (char_length(btrim(detail)) BETWEEN 3 AND 2000),
  raised_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) BETWEEN 3 AND 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(three_way_match_id, exception_code),
  CHECK (
    (status = 'OPEN' AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL AND resolution_note IS NULL)
    OR
    (status IN ('RESOLVED','WAIVED') AND resolved_by_user_id IS NOT NULL
      AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)
  ),
  CHECK (resolved_at IS NULL OR resolved_at >= raised_at)
);

CREATE INDEX IF NOT EXISTS three_way_match_exceptions_open_idx
  ON three_way_match_exceptions(company_id, raised_at DESC)
  WHERE status = 'OPEN';

CREATE OR REPLACE FUNCTION validate_three_way_match_exception()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  match_company_id uuid;
  receipt_confirmer uuid;
BEGIN
  SELECT match_record.company_id, receipt.confirmed_by_user_id
  INTO match_company_id, receipt_confirmer
  FROM three_way_matches match_record
  LEFT JOIN receipt_lines line ON line.id = match_record.receipt_line_id
  LEFT JOIN receipts receipt ON receipt.id = line.receipt_id
  WHERE match_record.id = NEW.three_way_match_id;

  IF match_company_id IS NULL OR match_company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Match exception must use the same tenant as its match';
  END IF;
  IF TG_OP = 'INSERT' AND (
    NOT axora_user_can_review_match(NEW.raised_by_user_id, NEW.company_id)
    OR NEW.raised_by_user_id = receipt_confirmer
  ) THEN
    RAISE EXCEPTION 'Match exceptions require an independent finance reviewer';
  END IF;

  IF NEW.resolved_by_user_id IS NOT NULL THEN
    IF NOT axora_user_can_review_match(NEW.resolved_by_user_id, NEW.company_id)
      OR NEW.resolved_by_user_id = receipt_confirmer THEN
      RAISE EXCEPTION 'Exception resolution requires an independent finance reviewer';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','resolved_by_user_id','resolved_at','resolution_note','updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','resolved_by_user_id','resolved_at','resolution_note','updated_at']) THEN
      RAISE EXCEPTION 'Match exception evidence is immutable';
    END IF;
    IF OLD.status <> 'OPEN' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A resolved match exception is terminal';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_three_way_match_exception_write
  ON three_way_match_exceptions;
CREATE TRIGGER validate_three_way_match_exception_write
BEFORE INSERT OR UPDATE ON three_way_match_exceptions
FOR EACH ROW EXECUTE FUNCTION validate_three_way_match_exception();

-- Row security: the shared application role can only see supplier rows for an
-- active membership, assigned delivery work, or its explicitly scoped tenant.
ALTER TABLE supplier_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_rfq_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotation_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_rfq_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_rfqs_select_scope ON supplier_rfqs;
CREATE POLICY supplier_rfqs_select_scope ON supplier_rfqs FOR SELECT
  USING (axora_context_has_supplier_access(supplier_id));
DROP POLICY IF EXISTS supplier_rfqs_platform_write ON supplier_rfqs;
CREATE POLICY supplier_rfqs_platform_write ON supplier_rfqs FOR ALL
  USING (axora_context_is_platform())
  WITH CHECK (axora_context_is_platform() AND issued_by = axora_context_user_id());

DROP POLICY IF EXISTS supplier_acknowledgements_scope ON supplier_rfq_acknowledgements;
CREATE POLICY supplier_acknowledgements_scope ON supplier_rfq_acknowledgements FOR SELECT
  USING (axora_context_has_supplier_access(supplier_id));
DROP POLICY IF EXISTS supplier_acknowledgements_insert ON supplier_rfq_acknowledgements;
CREATE POLICY supplier_acknowledgements_insert ON supplier_rfq_acknowledgements FOR INSERT
  WITH CHECK (
    acknowledged_by = axora_context_user_id()
    AND axora_user_is_supplier_member(axora_context_user_id(), supplier_id)
  );

DROP POLICY IF EXISTS supplier_responses_scope ON supplier_quotation_responses;
CREATE POLICY supplier_responses_scope ON supplier_quotation_responses FOR SELECT
  USING (axora_context_has_supplier_access(supplier_id));
DROP POLICY IF EXISTS supplier_responses_insert ON supplier_quotation_responses;
CREATE POLICY supplier_responses_insert ON supplier_quotation_responses FOR INSERT
  WITH CHECK (
    submitted_by = axora_context_user_id()
    AND axora_user_is_supplier_member(axora_context_user_id(), supplier_id)
  );

DROP POLICY IF EXISTS supplier_documents_scope ON supplier_rfq_documents;
CREATE POLICY supplier_documents_scope ON supplier_rfq_documents FOR SELECT
  USING (axora_context_has_supplier_access(supplier_id));
DROP POLICY IF EXISTS supplier_documents_insert ON supplier_rfq_documents;
CREATE POLICY supplier_documents_insert ON supplier_rfq_documents FOR INSERT
  WITH CHECK (
    uploaded_by = axora_context_user_id()
    AND axora_context_has_supplier_access(supplier_id)
  );

ALTER TABLE delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_job_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE three_way_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE three_way_match_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_jobs_read_scope ON delivery_jobs;
CREATE POLICY delivery_jobs_read_scope ON delivery_jobs FOR SELECT
  USING (axora_context_can_access_delivery_job(id));
DROP POLICY IF EXISTS delivery_jobs_platform_write ON delivery_jobs;
CREATE POLICY delivery_jobs_platform_write ON delivery_jobs FOR ALL
  USING (axora_context_is_platform())
  WITH CHECK (axora_context_is_platform() AND created_by = axora_context_user_id());

DROP POLICY IF EXISTS delivery_job_lines_read_scope ON delivery_job_lines;
CREATE POLICY delivery_job_lines_read_scope ON delivery_job_lines FOR SELECT
  USING (axora_context_can_access_delivery_job(delivery_job_id));
DROP POLICY IF EXISTS delivery_job_lines_platform_insert ON delivery_job_lines;
CREATE POLICY delivery_job_lines_platform_insert ON delivery_job_lines FOR INSERT
  WITH CHECK (axora_context_is_platform());

DROP POLICY IF EXISTS delivery_assignments_read_scope ON delivery_job_assignments;
CREATE POLICY delivery_assignments_read_scope ON delivery_job_assignments FOR SELECT
  USING (axora_context_can_access_delivery_job(delivery_job_id));
DROP POLICY IF EXISTS delivery_assignments_platform_write ON delivery_job_assignments;
CREATE POLICY delivery_assignments_platform_write ON delivery_job_assignments FOR ALL
  USING (axora_context_is_platform())
  WITH CHECK (axora_context_is_platform() AND assigned_by = axora_context_user_id());

DROP POLICY IF EXISTS delivery_events_read_scope ON delivery_job_events;
CREATE POLICY delivery_events_read_scope ON delivery_job_events FOR SELECT
  USING (axora_context_can_access_delivery_job(delivery_job_id));
DROP POLICY IF EXISTS delivery_events_driver_insert ON delivery_job_events;
CREATE POLICY delivery_events_driver_insert ON delivery_job_events FOR INSERT
  WITH CHECK (axora_context_is_job_driver(delivery_job_id, driver_user_id));

DROP POLICY IF EXISTS delivery_evidence_read_scope ON delivery_evidence;
CREATE POLICY delivery_evidence_read_scope ON delivery_evidence FOR SELECT
  USING (axora_context_can_access_delivery_job(delivery_job_id));
DROP POLICY IF EXISTS delivery_evidence_driver_insert ON delivery_evidence;
CREATE POLICY delivery_evidence_driver_insert ON delivery_evidence FOR INSERT
  WITH CHECK (axora_context_is_job_driver(delivery_job_id, driver_user_id));

DROP POLICY IF EXISTS receipts_read_scope ON receipts;
CREATE POLICY receipts_read_scope ON receipts FOR SELECT
  USING (
    axora_context_is_platform()
    OR axora_user_can_receive(axora_context_user_id(), company_id, branch_id)
  );
DROP POLICY IF EXISTS receipts_receiver_insert ON receipts;
CREATE POLICY receipts_receiver_insert ON receipts FOR INSERT
  WITH CHECK (
    confirmed_by_user_id = axora_context_user_id()
    AND axora_user_can_receive(axora_context_user_id(), company_id, branch_id)
  );

DROP POLICY IF EXISTS receipt_lines_read_scope ON receipt_lines;
CREATE POLICY receipt_lines_read_scope ON receipt_lines FOR SELECT
  USING (axora_context_can_access_receipt(receipt_id));
DROP POLICY IF EXISTS receipt_lines_receiver_insert ON receipt_lines;
CREATE POLICY receipt_lines_receiver_insert ON receipt_lines FOR INSERT
  WITH CHECK (axora_context_is_receipt_confirmer(receipt_id));

DROP POLICY IF EXISTS three_way_matches_finance_scope ON three_way_matches;
DROP POLICY IF EXISTS three_way_matches_finance_select ON three_way_matches;
CREATE POLICY three_way_matches_finance_select ON three_way_matches FOR SELECT
  USING (
    axora_user_can_review_match(axora_context_user_id(), company_id)
  );
DROP POLICY IF EXISTS three_way_matches_finance_insert ON three_way_matches;
CREATE POLICY three_way_matches_finance_insert ON three_way_matches FOR INSERT
  WITH CHECK (
    axora_user_can_review_match(axora_context_user_id(), company_id)
    AND evaluated_by_user_id = axora_context_user_id()
  );
DROP POLICY IF EXISTS three_way_matches_finance_update ON three_way_matches;
CREATE POLICY three_way_matches_finance_update ON three_way_matches FOR UPDATE
  USING (axora_user_can_review_match(axora_context_user_id(), company_id))
  WITH CHECK (
    axora_user_can_review_match(axora_context_user_id(), company_id)
    AND (
      (overridden_by_user_id IS NULL
        AND evaluated_by_user_id = axora_context_user_id())
      OR overridden_by_user_id = axora_context_user_id()
    )
  );

DROP POLICY IF EXISTS three_way_exceptions_finance_scope ON three_way_match_exceptions;
DROP POLICY IF EXISTS three_way_exceptions_finance_select ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_select ON three_way_match_exceptions FOR SELECT
  USING (
    axora_user_can_review_match(axora_context_user_id(), company_id)
  );
DROP POLICY IF EXISTS three_way_exceptions_finance_insert ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_insert ON three_way_match_exceptions FOR INSERT
  WITH CHECK (
    axora_user_can_review_match(axora_context_user_id(), company_id)
    AND raised_by_user_id = axora_context_user_id()
  );
DROP POLICY IF EXISTS three_way_exceptions_finance_update ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_update ON three_way_match_exceptions FOR UPDATE
  USING (axora_user_can_review_match(axora_context_user_id(), company_id))
  WITH CHECK (
    axora_user_can_review_match(axora_context_user_id(), company_id)
    AND resolved_by_user_id = axora_context_user_id()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      supplier_rfqs,
      delivery_jobs,
      delivery_job_assignments,
      three_way_matches,
      three_way_match_exceptions
    TO axora_app;

    GRANT SELECT, INSERT ON TABLE
      supplier_rfq_acknowledgements,
      supplier_quotation_responses,
      supplier_rfq_documents,
      delivery_job_lines,
      delivery_job_events,
      delivery_evidence,
      receipts,
      receipt_lines
    TO axora_app;

    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
      supplier_rfq_acknowledgements,
      supplier_quotation_responses,
      supplier_rfq_documents,
      delivery_job_lines,
      delivery_job_events,
      delivery_evidence,
      receipts,
      receipt_lines
    FROM axora_app;

    REVOKE DELETE, TRUNCATE ON TABLE
      supplier_rfqs,
      delivery_jobs,
      delivery_job_assignments,
      three_way_matches,
      three_way_match_exceptions
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      axora_context_user_id(),
      axora_user_is_platform(uuid),
      axora_context_is_platform(),
      axora_user_is_supplier_member(uuid, uuid),
      axora_context_has_supplier_access(uuid),
      axora_user_can_receive(uuid, uuid, uuid),
      axora_user_can_review_match(uuid, uuid),
      axora_context_can_access_delivery_job(uuid),
      axora_context_is_job_driver(uuid, uuid),
      axora_context_can_access_receipt(uuid),
      axora_context_is_receipt_confirmer(uuid)
    TO axora_app;
  END IF;
END $$;

REVOKE ALL ON FUNCTION axora_user_is_platform(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_user_is_supplier_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_user_can_receive(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_user_can_review_match(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_context_can_access_delivery_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_context_is_job_driver(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_context_can_access_receipt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_context_is_receipt_confirmer(uuid) FROM PUBLIC;

COMMIT;
