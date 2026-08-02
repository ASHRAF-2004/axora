BEGIN;

-- The original 019 match ledger is intentionally private to Axora because it
-- links supplier invoices and supplier quotations. Customer finance users
-- receive a separate ledger that compares only customer-visible evidence:
-- approved sell price, independent receipt, and customer invoice.
DROP POLICY IF EXISTS three_way_matches_finance_select ON three_way_matches;
CREATE POLICY three_way_matches_finance_select ON three_way_matches FOR SELECT
  USING (axora_context_is_platform());
DROP POLICY IF EXISTS three_way_matches_finance_insert ON three_way_matches;
CREATE POLICY three_way_matches_finance_insert ON three_way_matches FOR INSERT
  WITH CHECK (axora_context_is_platform());
DROP POLICY IF EXISTS three_way_matches_finance_update ON three_way_matches;
CREATE POLICY three_way_matches_finance_update ON three_way_matches FOR UPDATE
  USING (axora_context_is_platform()) WITH CHECK (axora_context_is_platform());

DROP POLICY IF EXISTS three_way_exceptions_finance_select ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_select ON three_way_match_exceptions FOR SELECT
  USING (axora_context_is_platform());
DROP POLICY IF EXISTS three_way_exceptions_finance_insert ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_insert ON three_way_match_exceptions FOR INSERT
  WITH CHECK (axora_context_is_platform());
DROP POLICY IF EXISTS three_way_exceptions_finance_update ON three_way_match_exceptions;
CREATE POLICY three_way_exceptions_finance_update ON three_way_match_exceptions FOR UPDATE
  USING (axora_context_is_platform()) WITH CHECK (axora_context_is_platform());

CREATE TABLE IF NOT EXISTS customer_three_way_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL REFERENCES request_lines(id) ON DELETE RESTRICT,
  customer_invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  receipt_line_id uuid,
  status text NOT NULL CHECK (status IN ('NOT_READY','MATCHED','EXCEPTION','OVERRIDDEN')),
  exception_codes text[] NOT NULL DEFAULT '{}'::text[],
  ordered_quantity_snapshot numeric(14,3) NOT NULL CHECK (ordered_quantity_snapshot > 0),
  received_quantity_snapshot numeric(14,3) CHECK (received_quantity_snapshot IS NULL OR received_quantity_snapshot >= 0),
  invoiced_quantity_snapshot numeric(14,3) NOT NULL CHECK (invoiced_quantity_snapshot >= 0),
  ordered_unit_price_snapshot numeric(14,2) NOT NULL CHECK (ordered_unit_price_snapshot >= 0),
  invoiced_unit_price_snapshot numeric(14,2) NOT NULL CHECK (invoiced_unit_price_snapshot >= 0),
  quantity_variance numeric(14,3),
  price_variance numeric(14,2) NOT NULL,
  evaluated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL,
  overridden_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  overridden_at timestamptz,
  override_reason text CHECK (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(receipt_line_id,company_id,request_line_id)
    REFERENCES receipt_lines(id,company_id,request_line_id) ON DELETE RESTRICT,
  UNIQUE(company_id,idempotency_key),
  CHECK (exception_codes <@ ARRAY[
    'MISSING_RECEIPT','QUANTITY_VARIANCE','PRICE_VARIANCE','DUPLICATE_INVOICE'
  ]::text[]),
  CHECK ((status='MATCHED' AND cardinality(exception_codes)=0 AND receipt_line_id IS NOT NULL)
    OR (status='NOT_READY' AND 'MISSING_RECEIPT'=ANY(exception_codes))
    OR (status='EXCEPTION' AND cardinality(exception_codes)>0)
    OR status='OVERRIDDEN'),
  CHECK (
    (receipt_line_id IS NULL
      AND received_quantity_snapshot IS NULL
      AND quantity_variance IS NULL
      AND 'MISSING_RECEIPT'=ANY(exception_codes))
    OR
    (receipt_line_id IS NOT NULL
      AND received_quantity_snapshot IS NOT NULL
      AND quantity_variance=
        invoiced_quantity_snapshot-received_quantity_snapshot
      AND NOT ('MISSING_RECEIPT'=ANY(exception_codes)))
  ),
  CHECK (
    ('QUANTITY_VARIANCE'=ANY(exception_codes)) =
    (receipt_line_id IS NOT NULL AND (
      received_quantity_snapshot<>ordered_quantity_snapshot
      OR invoiced_quantity_snapshot<>received_quantity_snapshot
    ))
  ),
  CHECK (price_variance=invoiced_unit_price_snapshot-ordered_unit_price_snapshot),
  CHECK (
    ('PRICE_VARIANCE'=ANY(exception_codes)) = (price_variance<>0)
  ),
  CHECK ((status='OVERRIDDEN' AND overridden_by_user_id IS NOT NULL
      AND overridden_at IS NOT NULL AND override_reason IS NOT NULL)
    OR (status<>'OVERRIDDEN' AND overridden_by_user_id IS NULL
      AND overridden_at IS NULL AND override_reason IS NULL)),
  CHECK (overridden_by_user_id IS NULL OR overridden_by_user_id<>evaluated_by_user_id),
  CHECK (evaluated_at<=created_at+interval '24 hours'),
  CHECK (overridden_at IS NULL OR overridden_at>=evaluated_at)
);

CREATE INDEX IF NOT EXISTS customer_three_way_matches_scope_idx
  ON customer_three_way_matches(company_id,status,evaluated_at DESC);
CREATE INDEX IF NOT EXISTS customer_three_way_matches_invoice_idx
  ON customer_three_way_matches(customer_invoice_id,request_line_id,evaluated_at DESC);

CREATE OR REPLACE FUNCTION validate_customer_three_way_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_company uuid;
  line_request uuid;
  line_quantity numeric(14,3);
  line_price numeric(14,2);
  request_is_approved boolean;
  invoice_direction text;
  invoice_company uuid;
  invoice_request uuid;
  invoice_amount numeric(14,2);
  invoice_status text;
  receipt_confirmer uuid;
  receipt_accepted numeric(14,3);
BEGIN
  SELECT request.company_id,line.request_id,line.quantity,line.unit_sell_price,
    EXISTS (
      SELECT 1 FROM approvals approval
      WHERE approval.request_id=line.request_id
        AND approval.approval_type='Company approval'
        AND approval.status='Approved'
    )
  INTO line_company,line_request,line_quantity,line_price,request_is_approved
  FROM request_lines line JOIN requests request ON request.id=line.request_id
  WHERE line.id=NEW.request_line_id;
  IF line_company IS DISTINCT FROM NEW.company_id
    OR line_quantity IS DISTINCT FROM NEW.ordered_quantity_snapshot
    OR line_price IS DISTINCT FROM NEW.ordered_unit_price_snapshot THEN
    RAISE EXCEPTION 'Customer match order evidence is inconsistent';
  END IF;
  IF request_is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Customer match requires an Approved company approval';
  END IF;

  SELECT invoice.direction,invoice.company_id,invoice.request_id,invoice.amount,
    status.label
  INTO invoice_direction,invoice_company,invoice_request,invoice_amount,
    invoice_status
  FROM invoices invoice
  JOIN lookup_values status
    ON status.id=invoice.status_id AND status.type_key='invoice_status'
  WHERE invoice.id=NEW.customer_invoice_id;
  IF invoice_direction IS DISTINCT FROM 'CUSTOMER'
    OR invoice_company IS DISTINCT FROM NEW.company_id
    OR invoice_request IS DISTINCT FROM line_request THEN
    RAISE EXCEPTION 'Customer match requires a customer invoice for the same request';
  END IF;
  IF invoice_status IS DISTINCT FROM 'Issued' THEN
    RAISE EXCEPTION 'Customer match requires an Issued customer invoice';
  END IF;

  IF NEW.receipt_line_id IS NOT NULL THEN
    SELECT receipt.confirmed_by_user_id,receipt_line.accepted_quantity
    INTO receipt_confirmer,receipt_accepted
    FROM receipt_lines receipt_line
    JOIN receipts receipt ON receipt.id=receipt_line.receipt_id
    WHERE receipt_line.id=NEW.receipt_line_id
      AND receipt_line.company_id=NEW.company_id
      AND receipt_line.request_line_id=NEW.request_line_id;
    IF receipt_confirmer IS NULL
      OR receipt_accepted IS DISTINCT FROM NEW.received_quantity_snapshot THEN
      RAISE EXCEPTION 'Customer match receipt evidence is inconsistent';
    END IF;
  ELSIF NEW.received_quantity_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Received quantity requires independent receipt evidence';
  END IF;

  IF TG_OP='INSERT' THEN
    IF NOT axora_user_can_review_match(NEW.evaluated_by_user_id,NEW.company_id)
      OR NEW.evaluated_by_user_id=receipt_confirmer THEN
      RAISE EXCEPTION 'Customer match requires an independent scoped finance reviewer';
    END IF;
    IF (NEW.invoiced_quantity_snapshot*NEW.invoiced_unit_price_snapshot)
      > invoice_amount+0.01 THEN
      RAISE EXCEPTION 'Customer match allocations exceed the invoice amount';
    END IF;
  ELSE
    -- An idempotency replay uses ON CONFLICT DO UPDATE without changing the
    -- evidence. Keep that a true no-op rather than manufacturing a fresh
    -- update timestamp or reopening the review lifecycle.
    IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM
       (to_jsonb(OLD)-'updated_at') THEN
      RETURN OLD;
    END IF;
    IF (to_jsonb(NEW)-ARRAY['status','overridden_by_user_id','overridden_at','override_reason','updated_at'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','overridden_by_user_id','overridden_at','override_reason','updated_at']) THEN
      RAISE EXCEPTION 'Customer match evidence is immutable';
    END IF;
    IF OLD.status='OVERRIDDEN' THEN
      RAISE EXCEPTION 'An overridden customer match is terminal';
    END IF;
    IF OLD.status NOT IN ('NOT_READY','EXCEPTION')
      OR NEW.status<>'OVERRIDDEN' THEN
      RAISE EXCEPTION 'Customer match review can only move an exception to an override';
    END IF;
    IF NEW.overridden_by_user_id IS NOT NULL AND (
      NOT axora_user_can_review_match(NEW.overridden_by_user_id,NEW.company_id)
      OR NEW.overridden_by_user_id=NEW.evaluated_by_user_id
      OR NEW.overridden_by_user_id=receipt_confirmer
    ) THEN
      RAISE EXCEPTION 'Customer match override requires independent review';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_customer_three_way_match_write ON customer_three_way_matches;
CREATE TRIGGER validate_customer_three_way_match_write
BEFORE INSERT OR UPDATE ON customer_three_way_matches
FOR EACH ROW EXECUTE FUNCTION validate_customer_three_way_match();

ALTER TABLE customer_three_way_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_three_way_matches_select ON customer_three_way_matches;
CREATE POLICY customer_three_way_matches_select ON customer_three_way_matches FOR SELECT
  USING (axora_user_can_review_match(axora_context_user_id(),company_id));
DROP POLICY IF EXISTS customer_three_way_matches_insert ON customer_three_way_matches;
CREATE POLICY customer_three_way_matches_insert ON customer_three_way_matches FOR INSERT
  WITH CHECK (evaluated_by_user_id=axora_context_user_id()
    AND axora_user_can_review_match(axora_context_user_id(),company_id));
DROP POLICY IF EXISTS customer_three_way_matches_update ON customer_three_way_matches;
CREATE POLICY customer_three_way_matches_update ON customer_three_way_matches FOR UPDATE
  USING (axora_user_can_review_match(axora_context_user_id(),company_id))
  WITH CHECK (overridden_by_user_id=axora_context_user_id()
    AND axora_user_can_review_match(axora_context_user_id(),company_id));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT,INSERT,UPDATE ON customer_three_way_matches TO axora_app;
    REVOKE DELETE,TRUNCATE ON customer_three_way_matches FROM axora_app;
  END IF;
END $$;

COMMIT;
