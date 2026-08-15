BEGIN;

ALTER TABLE public.products
  ADD COLUMN public_reference text;

UPDATE public.products
SET public_reference='item-'||substr(
  md5(id::text||':'||product_code),1,20
);

ALTER TABLE public.products
  ALTER COLUMN public_reference SET NOT NULL,
  ALTER COLUMN public_reference SET DEFAULT (
    'item-'||lower(substr(replace(gen_random_uuid()::text,'-',''),1,20))
  ),
  ADD CONSTRAINT products_public_reference_format_check CHECK (
    public_reference ~ '^item-[a-f0-9]{20}$'
  ),
  ADD CONSTRAINT products_public_reference_unique UNIQUE (public_reference);

-- Append the public reference while retaining the existing view shape for a
-- safe rolling deploy. Customer application queries use only this value;
-- product_code remains an internal staff identifier.
CREATE OR REPLACE VIEW public.v_customer_catalog_products
WITH (security_barrier=true)
AS
SELECT product.id,product.company_id,product.product_code,product.name,
  product.category,product.subcategory,product.brand,product.product_size,
  product.unit_of_measure,product.packaging,product.description,
  offer.selling_price AS default_sell_price,
  offer.minimum_quantity AS minimum_order_quantity,
  offer.maximum_quantity AS maximum_order_quantity,
  offer.order_increment,offer.pack_size,offer.pack_unit,
  offer.quantity_rule_version,offer.quantity_rule_effective_from,
  offer.price_rule_version,offer.price_effective_from,offer.price_changed_at,
  offer.price_currency,product.delivery_sla_days,
  (product.image_content IS NOT NULL) AS has_image,product.image_alt_text,
  product.active,product.needs_review,product.created_at,product.updated_at,
  product.public_reference
FROM public.products product
CROSS JOIN LATERAL public.axora_catalog_offer(product.id,now()) offer;

COMMIT;
