BEGIN;

-- A customer order must always have a positive amount that can be invoiced.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE default_sell_price <= 0) THEN
    RAISE EXCEPTION 'Positive-price migration blocked: review products with a zero customer selling price';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE amount <= 0) THEN
    RAISE EXCEPTION 'Positive-invoice migration blocked: review zero-value invoices';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='products_sell_price_positive_check'
      AND conrelid='products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_sell_price_positive_check CHECK (default_sell_price > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='invoices_amount_positive_check'
      AND conrelid='invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_amount_positive_check CHECK (amount > 0);
  END IF;
END $$;

-- Budget commitment uses the same per-line cent rounding as invoices and the
-- request financial view, so fractional units cannot create half-cent drift.
CREATE OR REPLACE VIEW v_branch_budget_usage AS
SELECT
  b.id AS branch_id,
  b.company_id,
  b.monthly_budget,
  COALESCE(sum(
    CASE
      WHEN r.id IS NOT NULL
       AND rs.label <> 'Cancelled'
       AND EXISTS (
         SELECT 1 FROM approvals a
         WHERE a.request_id=r.id
           AND a.approval_type='Company approval'
           AND a.status='Approved'
           AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
             >= date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
           AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
             < date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 month'
       )
      THEN COALESCE(lines.total, 0)
      ELSE 0
    END
  ), 0)::numeric(14,2) AS committed_amount,
  CASE
    WHEN b.monthly_budget IS NULL THEN NULL
    ELSE greatest(
      b.monthly_budget - COALESCE(sum(
        CASE
          WHEN r.id IS NOT NULL
           AND rs.label <> 'Cancelled'
           AND EXISTS (
             SELECT 1 FROM approvals a
             WHERE a.request_id=r.id
               AND a.approval_type='Company approval'
               AND a.status='Approved'
               AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
                 >= date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
               AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
                 < date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 month'
           )
          THEN COALESCE(lines.total, 0)
          ELSE 0
        END
      ), 0),
      0
    )::numeric(14,2)
  END AS remaining_amount
FROM branches b
LEFT JOIN requests r ON r.branch_id=b.id
LEFT JOIN lookup_values rs ON rs.id=r.status_id
LEFT JOIN LATERAL (
  SELECT sum(round(l.quantity*l.unit_sell_price,2))::numeric(14,2) AS total
  FROM request_lines l
  WHERE l.request_id=r.id
) lines ON true
GROUP BY b.id;

-- Only accepted receipt events count toward delivered quantity. The status,
-- accepted quantity and receiver evidence must describe the same outcome.
CREATE OR REPLACE FUNCTION prevent_excess_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ordered numeric;
  already_received numeric;
  received_after_update numeric;
  delivery_status text;
BEGIN
  SELECT quantity INTO ordered
  FROM request_lines
  WHERE id=NEW.request_line_id
  FOR UPDATE;

  SELECT label INTO delivery_status
  FROM lookup_values
  WHERE id=NEW.status_id AND type_key='delivery_status';

  IF delivery_status IN ('Partially Delivered','Delivered') THEN
    IF NEW.quantity_received <= 0 OR NEW.actual_date IS NULL OR NULLIF(btrim(NEW.received_by),'') IS NULL THEN
      RAISE EXCEPTION 'Accepted delivery requires quantity, actual date and receiver';
    END IF;
  ELSIF NEW.quantity_received <> 0 THEN
    RAISE EXCEPTION 'Only accepted partial or full delivery can increase received quantity';
  END IF;

  SELECT COALESCE(sum(d.quantity_received),0) INTO already_received
  FROM deliveries d
  JOIN lookup_values status ON status.id=d.status_id
  WHERE d.request_line_id=NEW.request_line_id
    AND d.id<>NEW.id
    AND status.label IN ('Partially Delivered','Delivered');

  received_after_update := already_received + CASE
    WHEN delivery_status IN ('Partially Delivered','Delivered') THEN NEW.quantity_received
    ELSE 0
  END;

  IF already_received >= ordered THEN
    RAISE EXCEPTION 'Fully delivered request line cannot receive another delivery update';
  END IF;
  IF received_after_update > ordered THEN
    RAISE EXCEPTION 'Delivered quantity cannot exceed ordered quantity';
  END IF;
  IF delivery_status='Delivered' AND received_after_update <> ordered THEN
    RAISE EXCEPTION 'Use Partially Delivered until the full ordered quantity is accepted';
  END IF;
  IF delivery_status='Partially Delivered' AND received_after_update >= ordered THEN
    RAISE EXCEPTION 'Use Delivered when the accepted receipt completes the order';
  END IF;
  RETURN NEW;
END $$;

-- Direct database inserts receive the same invoice safeguards as the app:
-- company approval, full delivery, matching sourced supplier and approved cap.
CREATE OR REPLACE FUNCTION validate_new_invoice_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_company uuid;
  request_status text;
  invoice_status text;
  authorized_total numeric;
  already_invoiced numeric;
BEGIN
  -- Idempotent sanitized seeds can attempt an INSERT that will be discarded by
  -- ON CONFLICT. Do not make that harmless replay fail on the current status.
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id=NEW.id OR (i.direction=NEW.direction AND i.invoice_number=NEW.invoice_number)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT r.company_id, status.label
    INTO request_company, request_status
  FROM requests r
  JOIN lookup_values status ON status.id=r.status_id
  WHERE r.id=NEW.request_id
  FOR UPDATE OF r;

  IF request_company IS NULL
     OR request_status NOT IN ('Delivered','Invoice Issued')
     OR NOT EXISTS (
       SELECT 1 FROM approvals a
       WHERE a.request_id=NEW.request_id
         AND a.approval_type='Company approval'
         AND a.status='Approved'
     )
     OR EXISTS (
       SELECT 1 FROM request_lines line
       WHERE line.request_id=NEW.request_id
         AND COALESCE((
           SELECT sum(delivery.quantity_received)
           FROM deliveries delivery
           JOIN lookup_values delivery_status ON delivery_status.id=delivery.status_id
           WHERE delivery.request_line_id=line.id
             AND delivery_status.label IN ('Partially Delivered','Delivered')
         ),0) < line.quantity
     ) THEN
    RAISE EXCEPTION 'Invoice requires an approved, fully delivered request';
  END IF;

  SELECT label INTO invoice_status
  FROM lookup_values
  WHERE id=NEW.status_id AND type_key='invoice_status';
  IF invoice_status <> 'Issued' THEN
    RAISE EXCEPTION 'New invoices must be issued records';
  END IF;

  IF NEW.direction='CUSTOMER' THEN
    IF NEW.company_id IS DISTINCT FROM request_company OR NEW.supplier_id IS NOT NULL THEN
      RAISE EXCEPTION 'Customer invoice counterparty does not match request company';
    END IF;
    SELECT COALESCE(sum(round(l.quantity*l.unit_sell_price,2)),0)
      INTO authorized_total
    FROM request_lines l
    WHERE l.request_id=NEW.request_id;
    SELECT COALESCE(sum(i.amount),0)
      INTO already_invoiced
    FROM invoices i
    JOIN lookup_values status ON status.id=i.status_id
    WHERE i.request_id=NEW.request_id
      AND i.direction='CUSTOMER'
      AND status.label<>'Cancelled';
    IF already_invoiced + NEW.amount > authorized_total THEN
      RAISE EXCEPTION 'Customer invoices cannot exceed approved request total';
    END IF;
  ELSIF NEW.direction='SUPPLIER' THEN
    IF NEW.company_id IS NOT NULL
       OR NEW.supplier_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM suppliers s
         JOIN request_lines l
           ON l.request_id=NEW.request_id
          AND l.selected_supplier_id=s.id
         WHERE s.id=NEW.supplier_id
           AND s.active=true
           AND s.company_id IS NULL
       ) THEN
      RAISE EXCEPTION 'Supplier invoice must match a sourced supplier on the request';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_invoice_workflow_insert ON invoices;
CREATE TRIGGER validate_invoice_workflow_insert
BEFORE INSERT ON invoices
FOR EACH ROW EXECUTE FUNCTION validate_new_invoice_workflow();

-- COD evidence is valid only for an issued invoice after full delivery.
CREATE OR REPLACE FUNCTION prevent_invoice_overpayment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice_total numeric;
  already_paid numeric;
  invoice_status text;
  request_status text;
BEGIN
  SELECT i.amount, invoice_state.label, request_state.label
    INTO invoice_total, invoice_status, request_status
  FROM invoices i
  JOIN lookup_values invoice_state ON invoice_state.id=i.status_id
  JOIN requests r ON r.id=i.request_id
  JOIN lookup_values request_state ON request_state.id=r.status_id
  WHERE i.id=NEW.invoice_id
  FOR UPDATE OF i;

  IF invoice_status<>'Issued'
     OR request_status NOT IN ('Delivered','Invoice Issued','Completed')
     OR EXISTS (
       SELECT 1 FROM request_lines line
       JOIN invoices invoice ON invoice.request_id=line.request_id
       WHERE invoice.id=NEW.invoice_id
         AND COALESCE((
           SELECT sum(delivery.quantity_received)
           FROM deliveries delivery
           JOIN lookup_values delivery_status ON delivery_status.id=delivery.status_id
           WHERE delivery.request_line_id=line.id
             AND delivery_status.label IN ('Partially Delivered','Delivered')
         ),0) < line.quantity
     ) THEN
    RAISE EXCEPTION 'COD payment requires an issued invoice after full delivery';
  END IF;
  IF NEW.method<>'Cash on delivery (COD)' OR NULLIF(btrim(NEW.reference),'') IS NULL THEN
    RAISE EXCEPTION 'COD payment requires a numbered receipt reference';
  END IF;

  SELECT COALESCE(sum(amount),0) INTO already_paid
  FROM payments
  WHERE invoice_id=NEW.invoice_id AND id<>NEW.id;
  IF already_paid + NEW.amount > invoice_total THEN
    RAISE EXCEPTION 'Payments cannot exceed invoice amount';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
