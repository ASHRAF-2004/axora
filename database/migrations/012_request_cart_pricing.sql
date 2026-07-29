BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 100),
  ADD COLUMN IF NOT EXISTS estimated_delivery_fee numeric(14,2) NOT NULL DEFAULT 0
    CHECK (estimated_delivery_fee >= 0);

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS estimated_delivery_fee numeric(14,2) NOT NULL DEFAULT 0
    CHECK (estimated_delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 100),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0
    CHECK (tax_amount >= 0);

-- Approved branch budget includes the complete request estimate:
-- product subtotal, estimated delivery fee, and configured tax/SST.
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
      THEN COALESCE(request_total.total, 0)
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
          THEN COALESCE(request_total.total, 0)
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
  SELECT (
    COALESCE(sum(round(line.quantity * line.unit_sell_price, 2)), 0)
    + r.estimated_delivery_fee
    + r.tax_amount
  )::numeric(14,2) AS total
  FROM request_lines line
  WHERE line.request_id=r.id
) request_total ON true
GROUP BY b.id;

-- Customer invoice authorization uses the same full total approved by the
-- company instead of product lines alone.
CREATE OR REPLACE FUNCTION validate_new_invoice_workflow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_company uuid;
  request_status text;
  invoice_status text;
  authorized_total numeric;
  already_invoiced numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM invoices invoice
    WHERE invoice.id=NEW.id
       OR (
         invoice.direction=NEW.direction
         AND invoice.invoice_number=NEW.invoice_number
       )
  ) THEN
    RETURN NEW;
  END IF;

  SELECT request.company_id, status.label
    INTO request_company, request_status
  FROM requests request
  JOIN lookup_values status ON status.id=request.status_id
  WHERE request.id=NEW.request_id
  FOR UPDATE OF request;

  IF request_company IS NULL
     OR request_status NOT IN ('Delivered','Invoice Issued')
     OR NOT EXISTS (
       SELECT 1 FROM approvals approval
       WHERE approval.request_id=NEW.request_id
         AND approval.approval_type='Company approval'
         AND approval.status='Approved'
     )
     OR EXISTS (
       SELECT 1 FROM request_lines line
       WHERE line.request_id=NEW.request_id
         AND COALESCE((
           SELECT sum(delivery.quantity_received)
           FROM deliveries delivery
           JOIN lookup_values delivery_status
             ON delivery_status.id=delivery.status_id
           WHERE delivery.request_line_id=line.id
             AND delivery_status.label IN (
               'Partially Delivered',
               'Delivered'
             )
         ),0) < line.quantity
     ) THEN
    RAISE EXCEPTION
      'Invoice requires an approved, fully delivered request';
  END IF;

  SELECT label INTO invoice_status
  FROM lookup_values
  WHERE id=NEW.status_id AND type_key='invoice_status';

  IF invoice_status <> 'Issued' THEN
    RAISE EXCEPTION 'New invoices must be issued records';
  END IF;

  IF NEW.direction='CUSTOMER' THEN
    IF NEW.company_id IS DISTINCT FROM request_company
       OR NEW.supplier_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Customer invoice counterparty does not match request company';
    END IF;

    SELECT
      COALESCE(sum(round(line.quantity * line.unit_sell_price, 2)), 0)
      + request.estimated_delivery_fee
      + request.tax_amount
      INTO authorized_total
    FROM requests request
    LEFT JOIN request_lines line ON line.request_id=request.id
    WHERE request.id=NEW.request_id
    GROUP BY
      request.id,
      request.estimated_delivery_fee,
      request.tax_amount;

    SELECT COALESCE(sum(invoice.amount),0)
      INTO already_invoiced
    FROM invoices invoice
    JOIN lookup_values status ON status.id=invoice.status_id
    WHERE invoice.request_id=NEW.request_id
      AND invoice.direction='CUSTOMER'
      AND status.label<>'Cancelled';

    IF already_invoiced + NEW.amount > authorized_total THEN
      RAISE EXCEPTION
        'Customer invoices cannot exceed approved request total';
    END IF;
  ELSIF NEW.direction='SUPPLIER' THEN
    IF NEW.company_id IS NOT NULL
       OR NEW.supplier_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM suppliers supplier
         JOIN request_lines line
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

CREATE OR REPLACE VIEW v_order_financials AS
SELECT
  request.id AS request_id,
  request.order_code,
  count(line.id) AS line_count,
  COALESCE(sum(line.buying_cost),0) AS buying_cost,
  COALESCE(sum(line.sales_amount),0) AS sales_amount,
  COALESCE(sum(line.gross_profit),0) AS gross_profit,
  COALESCE(sum(line.delivery_charge),0) AS delivery_charges,
  CASE
    WHEN COALESCE(sum(line.sales_amount),0)=0 THEN 0
    ELSE round(
      (sum(line.gross_profit) / sum(line.sales_amount)) * 100,
      2
    )
  END AS gross_margin_percent,
  request.estimated_delivery_fee,
  request.tax_rate,
  request.tax_amount,
  (
    COALESCE(sum(line.sales_amount),0)
    + request.estimated_delivery_fee
    + request.tax_amount
  )::numeric(14,2) AS customer_total
FROM requests request
LEFT JOIN v_request_line_financials line
  ON line.request_id=request.id
GROUP BY
  request.id,
  request.order_code,
  request.estimated_delivery_fee,
  request.tax_rate,
  request.tax_amount;

COMMIT;
