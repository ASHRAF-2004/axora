BEGIN;

-- Earlier sanitized demo seeds used a transfer label. Normalize only those
-- known demo rows; never rewrite an unknown real payment record silently.
UPDATE payments
SET method = 'Cash on delivery (COD)'
WHERE method IN ('Cash on delivery', 'COD')
   OR (method = 'Demo transfer' AND reference LIKE 'PAY-DEMO-%');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payments WHERE method <> 'Cash on delivery (COD)') THEN
    RAISE EXCEPTION 'COD-only migration blocked: resolve existing non-COD payment records first';
  END IF;
END $$;

ALTER TABLE payments
  ALTER COLUMN method SET DEFAULT 'Cash on delivery (COD)';

ALTER TABLE payments
  ADD CONSTRAINT payments_cod_only_method_check
  CHECK (method = 'Cash on delivery (COD)');

-- Company and supplier payment terms govern the MVP settlement policy, so
-- normalize them to the same value and prevent later credit/online terms.
UPDATE companies SET payment_terms = 'Cash on delivery (COD)';
UPDATE suppliers SET payment_terms = 'Cash on delivery (COD)';

ALTER TABLE companies
  ALTER COLUMN payment_terms SET DEFAULT 'Cash on delivery (COD)';
ALTER TABLE companies
  ADD CONSTRAINT companies_cod_only_payment_terms_check
  CHECK (payment_terms = 'Cash on delivery (COD)');

ALTER TABLE suppliers
  ALTER COLUMN payment_terms SET DEFAULT 'Cash on delivery (COD)';
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_cod_only_payment_terms_check
  CHECK (payment_terms = 'Cash on delivery (COD)');

COMMIT;
