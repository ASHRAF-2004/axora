BEGIN;

-- Catalog managers can create an inactive draft before an authorized
-- commercial manager supplies the confidential base cost.  A draft is never
-- available through the customer catalog, so its zero placeholder price must
-- be permitted; any active product remains required to have an invoiceable
-- positive selling price.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_sell_price_positive_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_sell_price_positive_check
  CHECK (NOT active OR default_sell_price > 0);

COMMIT;
