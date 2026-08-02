BEGIN;

-- Migration 027 separates logistics evidence from customer acceptance.  The
-- legacy `deliveries` table historically mixed those concepts, while the
-- receiving portal introduced independently confirmed receipt lines.  Freeze
-- one truthful migration boundary so the same physical delivery is never
-- counted once from each model.
LOCK TABLE request_lines, deliveries, receipts, receipt_lines
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS request_line_receipt_baselines (
  request_line_id uuid PRIMARY KEY
    REFERENCES request_lines(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  ordered_quantity_snapshot numeric(14,3) NOT NULL
    CHECK (ordered_quantity_snapshot > 0),
  legacy_accepted_quantity_snapshot numeric(14,3) NOT NULL
    CHECK (legacy_accepted_quantity_snapshot >= 0),
  independent_accepted_quantity_snapshot numeric(14,3) NOT NULL
    CHECK (independent_accepted_quantity_snapshot >= 0),
  baseline_accepted_quantity numeric(14,3) NOT NULL
    CHECK (baseline_accepted_quantity >= 0),
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES branches(id,company_id) ON DELETE RESTRICT,
  UNIQUE(request_line_id,company_id),
  CHECK (
    baseline_accepted_quantity = LEAST(
      ordered_quantity_snapshot,
      GREATEST(
        legacy_accepted_quantity_snapshot,
        independent_accepted_quantity_snapshot
      )
    )
  )
);

-- UUID receipt identifiers are not chronological watermarks.  Record the
-- exact receipt lines included in the baseline, then count only receipt lines
-- that are absent from this immutable source set after the migration.
CREATE TABLE IF NOT EXISTS request_line_receipt_baseline_sources (
  receipt_line_id uuid PRIMARY KEY,
  request_line_id uuid NOT NULL,
  company_id uuid NOT NULL,
  FOREIGN KEY(request_line_id,company_id)
    REFERENCES request_line_receipt_baselines(request_line_id,company_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(receipt_line_id,company_id,request_line_id)
    REFERENCES receipt_lines(id,company_id,request_line_id)
    ON DELETE RESTRICT
);

WITH legacy AS (
  SELECT delivery.request_line_id,
    COALESCE(sum(delivery.quantity_received),0)::numeric(14,3) AS accepted
  FROM deliveries delivery
  JOIN lookup_values status
    ON status.id=delivery.status_id
   AND status.type_key='delivery_status'
  WHERE status.label IN ('Partially Delivered','Delivered')
  GROUP BY delivery.request_line_id
), independent AS (
  SELECT receipt_line.request_line_id,
    COALESCE(sum(receipt_line.accepted_quantity),0)::numeric(14,3) AS accepted
  FROM receipt_lines receipt_line
  GROUP BY receipt_line.request_line_id
)
INSERT INTO request_line_receipt_baselines(
  request_line_id,company_id,branch_id,ordered_quantity_snapshot,
  legacy_accepted_quantity_snapshot,
  independent_accepted_quantity_snapshot,baseline_accepted_quantity
)
SELECT line.id,request.company_id,request.branch_id,line.quantity,
  COALESCE(legacy.accepted,0),COALESCE(independent.accepted,0),
  LEAST(
    line.quantity,
    GREATEST(COALESCE(legacy.accepted,0),COALESCE(independent.accepted,0))
  )
FROM request_lines line
JOIN requests request ON request.id=line.request_id
LEFT JOIN legacy ON legacy.request_line_id=line.id
LEFT JOIN independent ON independent.request_line_id=line.id
ON CONFLICT(request_line_id) DO NOTHING;

INSERT INTO request_line_receipt_baseline_sources(
  receipt_line_id,request_line_id,company_id
)
SELECT receipt_line.id,receipt_line.request_line_id,receipt_line.company_id
FROM receipt_lines receipt_line
JOIN request_line_receipt_baselines baseline
  ON baseline.request_line_id=receipt_line.request_line_id
 AND baseline.company_id=receipt_line.company_id
ON CONFLICT(receipt_line_id) DO NOTHING;

DROP TRIGGER IF EXISTS request_line_receipt_baselines_append_only
  ON request_line_receipt_baselines;
CREATE TRIGGER request_line_receipt_baselines_append_only
BEFORE UPDATE OR DELETE ON request_line_receipt_baselines
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS request_line_receipt_baseline_sources_append_only
  ON request_line_receipt_baseline_sources;
CREATE TRIGGER request_line_receipt_baseline_sources_append_only
BEFORE UPDATE OR DELETE ON request_line_receipt_baseline_sources
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- Raw calculation is private to reviewed database functions and triggers.
-- It intentionally has no actor parameter, preventing a caller from asserting
-- another identity.  Application code receives only the scoped wrapper below.
CREATE OR REPLACE FUNCTION axora_effective_received_quantity_internal(
  p_request_line_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT LEAST(
    line.quantity,
    COALESCE(baseline.baseline_accepted_quantity,0)
      + COALESCE((
          SELECT sum(receipt_line.accepted_quantity)
          FROM public.receipt_lines receipt_line
          WHERE receipt_line.request_line_id=line.id
            AND NOT EXISTS (
              SELECT 1
              FROM public.request_line_receipt_baseline_sources source
              WHERE source.receipt_line_id=receipt_line.id
            )
        ),0)
  )
  FROM public.request_lines line
  LEFT JOIN public.request_line_receipt_baselines baseline
    ON baseline.request_line_id=line.id
  WHERE line.id=p_request_line_id
$$;

REVOKE ALL ON FUNCTION
  axora_effective_received_quantity_internal(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION axora_received_quantity(
  p_request_line_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  context_user_id uuid;
  line_company_id uuid;
  line_branch_id uuid;
  access_allowed boolean := false;
BEGIN
  IF p_request_line_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT request.company_id,request.branch_id
  INTO line_company_id,line_branch_id
  FROM public.request_lines line
  JOIN public.requests request ON request.id=line.request_id
  WHERE line.id=p_request_line_id;

  IF line_company_id IS NULL THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  context_user_id := public.axora_context_user_id();
  IF context_user_id IS NULL THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id
     AND assignment.active
     AND assignment.revoked_at IS NULL
     AND assignment.scope_type='PLATFORM'
    JOIN public.roles role
      ON role.id=assignment.role_id
     AND role.role_key IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS')
    WHERE account.id=context_user_id
      AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind='PLATFORM'
      AND account.account_setup_completed_at IS NOT NULL
  ) INTO access_allowed;

  IF NOT access_allowed THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.users account
      JOIN public.company_memberships membership
        ON membership.user_id=account.id
       AND membership.company_id=line_company_id
       AND membership.status='ACTIVE'
      JOIN public.companies company
        ON company.id=membership.company_id
       AND company.active
      JOIN public.branches branch
        ON branch.id=line_branch_id
       AND branch.company_id=line_company_id
       AND branch.active
      JOIN public.role_assignments assignment
        ON assignment.user_id=account.id
       AND assignment.company_id=line_company_id
       AND assignment.active
       AND assignment.revoked_at IS NULL
       AND (
         assignment.scope_type='COMPANY'
         OR (
           assignment.scope_type='BRANCH'
           AND assignment.branch_id=line_branch_id
           AND EXISTS (
             SELECT 1
             FROM public.branch_assignments branch_scope
             WHERE branch_scope.user_id=account.id
               AND branch_scope.company_id=line_company_id
               AND branch_scope.branch_id=line_branch_id
               AND branch_scope.status='ACTIVE'
           )
         )
       )
      WHERE account.id=context_user_id
        AND account.active
        AND account.account_status='ACTIVE'
        AND account.account_kind='COMPANY'
        AND account.account_setup_completed_at IS NOT NULL
    ) INTO access_allowed;
  END IF;

  IF NOT access_allowed THEN
    RAISE EXCEPTION 'Received quantity is unavailable'
      USING ERRCODE='42501';
  END IF;

  RETURN public.axora_effective_received_quantity_internal(p_request_line_id);
END $$;

REVOKE ALL ON FUNCTION axora_received_quantity(uuid) FROM PUBLIC;

-- Legacy Partially Delivered / Delivered rows are now frozen history.  New
-- logistics status rows may still be recorded, but only the receiving portal
-- may increase accepted quantity.
CREATE OR REPLACE FUNCTION prevent_excess_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  delivery_status text;
BEGIN
  SELECT label INTO delivery_status
  FROM public.lookup_values
  WHERE id=NEW.status_id AND type_key='delivery_status';

  IF delivery_status IS NULL THEN
    RAISE EXCEPTION 'Delivery status is invalid';
  END IF;
  IF delivery_status IN ('Partially Delivered','Delivered') THEN
    RAISE EXCEPTION
      'Legacy delivery acceptance is frozen; use independent customer receiving';
  END IF;
  IF NEW.quantity_received<>0
    OR NEW.received_by IS NOT NULL
    OR NEW.actual_date IS NOT NULL THEN
    RAISE EXCEPTION
      'Logistics status updates cannot record customer receipt evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_frozen_legacy_delivery_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  old_status text;
BEGIN
  SELECT label INTO old_status
  FROM public.lookup_values
  WHERE id=OLD.status_id AND type_key='delivery_status';

  IF old_status IN ('Partially Delivered','Delivered') THEN
    RAISE EXCEPTION 'Frozen legacy delivery acceptance is immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS protect_frozen_legacy_delivery_acceptance_write
  ON deliveries;
CREATE TRIGGER protect_frozen_legacy_delivery_acceptance_write
BEFORE UPDATE OR DELETE ON deliveries
FOR EACH ROW EXECUTE FUNCTION protect_frozen_legacy_delivery_acceptance();

-- Receipt writes serialize on the request line and cannot over-accept either
-- the order or an individual delivery-job line.
CREATE OR REPLACE FUNCTION validate_receipt_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  planned_quantity numeric(14,3);
  ordered_quantity numeric(14,3);
  job_line_recorded_quantity numeric(14,3);
  effective_accepted_quantity numeric(14,3);
  receipt_status text;
BEGIN
  SELECT line.quantity
  INTO ordered_quantity
  FROM public.request_lines line
  WHERE line.id=NEW.request_line_id
  FOR UPDATE;

  SELECT job_line.quantity_to_deliver
  INTO planned_quantity
  FROM public.delivery_job_lines job_line
  WHERE job_line.id=NEW.delivery_job_line_id
    AND job_line.delivery_job_id=NEW.delivery_job_id
    AND job_line.company_id=NEW.company_id
    AND job_line.request_line_id=NEW.request_line_id;

  IF ordered_quantity IS NULL OR planned_quantity IS NULL
    OR planned_quantity<>NEW.planned_quantity_snapshot THEN
    RAISE EXCEPTION 'Receipt planned quantity must match the delivery job line';
  END IF;

  SELECT status INTO receipt_status
  FROM public.receipts
  WHERE id=NEW.receipt_id
    AND delivery_job_id=NEW.delivery_job_id
    AND company_id=NEW.company_id;

  IF receipt_status='ACCEPTED' AND NEW.discrepancy_code<>'NONE' THEN
    RAISE EXCEPTION 'An accepted receipt cannot contain a discrepancy';
  END IF;
  IF receipt_status='REJECTED' AND NEW.accepted_quantity>0 THEN
    RAISE EXCEPTION 'A rejected receipt cannot contain accepted quantity';
  END IF;

  SELECT COALESCE(sum(existing.delivered_quantity),0)
  INTO job_line_recorded_quantity
  FROM public.receipt_lines existing
  WHERE existing.delivery_job_line_id=NEW.delivery_job_line_id;
  IF job_line_recorded_quantity+NEW.delivered_quantity>planned_quantity THEN
    RAISE EXCEPTION 'Receipt quantity exceeds the delivery job line';
  END IF;

  effective_accepted_quantity :=
    COALESCE(public.axora_effective_received_quantity_internal(
      NEW.request_line_id
    ),0);
  IF effective_accepted_quantity+NEW.accepted_quantity>ordered_quantity THEN
    RAISE EXCEPTION 'Accepted receipt quantity exceeds the ordered quantity';
  END IF;

  RETURN NEW;
END $$;

-- New delivery jobs reserve only quantities that have not already been
-- independently accepted. Driver events are append-only evidence and the
-- application does not rewrite delivery_jobs.status for every event, so a
-- customer receipt line releases its job-line reservation regardless of that
-- denormalized status. The accepted quantity then governs any redelivery.
CREATE OR REPLACE FUNCTION validate_delivery_job_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  line_request_id uuid;
  ordered_quantity numeric(14,3);
  accepted_quantity numeric(14,3);
  job_request_id uuid;
  job_status text;
  already_reserved numeric(14,3);
BEGIN
  SELECT request_id,quantity
  INTO line_request_id,ordered_quantity
  FROM public.request_lines
  WHERE id=NEW.request_line_id
  FOR UPDATE;

  SELECT request_id,status
  INTO job_request_id,job_status
  FROM public.delivery_jobs
  WHERE id=NEW.delivery_job_id AND company_id=NEW.company_id;

  IF line_request_id IS NULL OR line_request_id<>job_request_id THEN
    RAISE EXCEPTION 'Delivery line must belong to the delivery job request';
  END IF;
  IF job_status IN ('DELIVERED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'Lines cannot be added to a terminal delivery job';
  END IF;

  accepted_quantity := COALESCE(
    public.axora_effective_received_quantity_internal(NEW.request_line_id),0
  );
  SELECT COALESCE(sum(existing.quantity_to_deliver),0)
  INTO already_reserved
  FROM public.delivery_job_lines existing
  JOIN public.delivery_jobs existing_job
    ON existing_job.id=existing.delivery_job_id
  WHERE existing.request_line_id=NEW.request_line_id
    AND existing_job.status IN (
      'CREATED','ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED','DELIVERED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.receipt_lines received
      WHERE received.delivery_job_line_id=existing.id
    );

  IF accepted_quantity+already_reserved+NEW.quantity_to_deliver
      > ordered_quantity THEN
    RAISE EXCEPTION
      'Planned delivery quantity exceeds the unreceived ordered quantity';
  END IF;
  RETURN NEW;
END $$;

-- The application already checks this transition, and the database enforces
-- the same invariant so another server-side write path cannot mark driver
-- evidence as customer acceptance.
CREATE OR REPLACE FUNCTION validate_request_received_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  next_status text;
BEGIN
  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  SELECT status.label INTO next_status
  FROM public.lookup_values status
  WHERE status.id=NEW.status_id AND status.type_key='request_status';
  IF next_status='Delivered' AND EXISTS (
    SELECT 1 FROM public.request_lines line
    WHERE line.request_id=NEW.id
      AND COALESCE(
        public.axora_effective_received_quantity_internal(line.id),0
      )<line.quantity
  ) THEN
    RAISE EXCEPTION
      'Request cannot be marked delivered before full customer receipt';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_request_received_transition_write ON requests;
CREATE TRIGGER validate_request_received_transition_write
BEFORE UPDATE OF status_id ON requests
FOR EACH ROW EXECUTE FUNCTION validate_request_received_transition();

-- Direct invoice and COD inserts receive the same independent-receipt gates
-- as application writes.  These trigger functions use only the private raw
-- calculator and never expose it to the shared application role.
CREATE OR REPLACE FUNCTION validate_new_invoice_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  request_company uuid;
  request_status text;
  invoice_status text;
  authorized_total numeric;
  already_invoiced numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices invoice
    WHERE invoice.id=NEW.id
       OR (invoice.direction=NEW.direction
         AND invoice.invoice_number=NEW.invoice_number)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT request.company_id,status.label
  INTO request_company,request_status
  FROM public.requests request
  JOIN public.lookup_values status ON status.id=request.status_id
  WHERE request.id=NEW.request_id
  FOR UPDATE OF request;

  IF request_company IS NULL
    OR request_status NOT IN ('Delivered','Invoice Issued')
    OR NOT EXISTS (
      SELECT 1 FROM public.approvals approval
      WHERE approval.request_id=NEW.request_id
        AND approval.approval_type='Company approval'
        AND approval.status='Approved'
    )
    OR EXISTS (
      SELECT 1 FROM public.request_lines line
      WHERE line.request_id=NEW.request_id
        AND COALESCE(
          public.axora_effective_received_quantity_internal(line.id),0
        )<line.quantity
    ) THEN
    RAISE EXCEPTION 'Invoice requires an approved, fully received request';
  END IF;

  SELECT label INTO invoice_status
  FROM public.lookup_values
  WHERE id=NEW.status_id AND type_key='invoice_status';
  IF invoice_status<>'Issued' THEN
    RAISE EXCEPTION 'New invoices must be issued records';
  END IF;

  IF NEW.direction='CUSTOMER' THEN
    IF NEW.company_id IS DISTINCT FROM request_company
      OR NEW.supplier_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Customer invoice counterparty does not match request company';
    END IF;

    SELECT COALESCE(sum(round(line.quantity*line.unit_sell_price,2)),0)
        + request.estimated_delivery_fee + request.tax_amount
    INTO authorized_total
    FROM public.requests request
    LEFT JOIN public.request_lines line ON line.request_id=request.id
    WHERE request.id=NEW.request_id
    GROUP BY request.id,request.estimated_delivery_fee,request.tax_amount;

    SELECT COALESCE(sum(invoice.amount),0)
    INTO already_invoiced
    FROM public.invoices invoice
    JOIN public.lookup_values status ON status.id=invoice.status_id
    WHERE invoice.request_id=NEW.request_id
      AND invoice.direction='CUSTOMER'
      AND status.label<>'Cancelled';
    IF already_invoiced+NEW.amount>authorized_total THEN
      RAISE EXCEPTION
        'Customer invoices cannot exceed approved request total';
    END IF;
  ELSIF NEW.direction='SUPPLIER' THEN
    IF NEW.company_id IS NOT NULL
      OR NEW.supplier_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.suppliers supplier
        JOIN public.request_lines line
          ON line.request_id=NEW.request_id
         AND line.selected_supplier_id=supplier.id
        WHERE supplier.id=NEW.supplier_id
          AND supplier.active=true
          AND supplier.company_id IS NULL
      ) THEN
      RAISE EXCEPTION
        'Supplier invoice must match a sourced supplier on the request';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_invoice_overpayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  invoice_total numeric;
  already_paid numeric;
  invoice_status text;
  request_status text;
BEGIN
  SELECT invoice.amount,invoice_state.label,request_state.label
  INTO invoice_total,invoice_status,request_status
  FROM public.invoices invoice
  JOIN public.lookup_values invoice_state ON invoice_state.id=invoice.status_id
  JOIN public.requests request ON request.id=invoice.request_id
  JOIN public.lookup_values request_state ON request_state.id=request.status_id
  WHERE invoice.id=NEW.invoice_id
  FOR UPDATE OF invoice;

  IF invoice_status<>'Issued'
    OR request_status NOT IN ('Delivered','Invoice Issued','Completed')
    OR EXISTS (
      SELECT 1
      FROM public.request_lines line
      JOIN public.invoices invoice ON invoice.request_id=line.request_id
      WHERE invoice.id=NEW.invoice_id
        AND COALESCE(
          public.axora_effective_received_quantity_internal(line.id),0
        )<line.quantity
    ) THEN
    RAISE EXCEPTION
      'COD payment requires an issued invoice after full receipt';
  END IF;
  IF NEW.method<>'Cash on delivery (COD)'
    OR NULLIF(btrim(NEW.reference),'') IS NULL THEN
    RAISE EXCEPTION 'COD payment requires a numbered receipt reference';
  END IF;

  SELECT COALESCE(sum(payment.amount),0)
  INTO already_paid
  FROM public.payments payment
  WHERE payment.invoice_id=NEW.invoice_id AND payment.id<>NEW.id;
  IF already_paid+NEW.amount>invoice_total THEN
    RAISE EXCEPTION 'Payments cannot exceed invoice amount';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON TABLE request_line_receipt_baselines FROM PUBLIC;
REVOKE ALL ON TABLE request_line_receipt_baseline_sources FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_receipt_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_delivery_job_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_request_received_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_new_invoice_workflow() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_invoice_overpayment() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE request_line_receipt_baselines FROM axora_app;
    REVOKE ALL ON TABLE request_line_receipt_baseline_sources FROM axora_app;
    REVOKE ALL ON FUNCTION
      axora_effective_received_quantity_internal(uuid) FROM axora_app;
    GRANT EXECUTE ON FUNCTION axora_received_quantity(uuid) TO axora_app;
  END IF;
END $$;

COMMIT;
