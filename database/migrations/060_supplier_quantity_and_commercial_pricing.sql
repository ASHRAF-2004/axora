BEGIN;

-- P1-03: supplier-product quantity rules -------------------------------

ALTER TABLE public.product_suppliers
  ADD COLUMN maximum_order_quantity numeric(14,3),
  ADD COLUMN order_increment numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN pack_size numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN pack_unit text,
  ADD COLUMN quantity_rule_version integer NOT NULL DEFAULT 1,
  ADD COLUMN quantity_rule_effective_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN quantity_rule_effective_to timestamptz,
  ADD COLUMN quantity_rule_reason text NOT NULL DEFAULT 'Legacy supplier-product rule migrated',
  ADD COLUMN quantity_rule_updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.product_suppliers supplier_product
SET supplier_moq=greatest(
      ceil(coalesce(nullif(supplier_product.supplier_moq,0),
        nullif(product.minimum_order_quantity,0),1)),1
    ),
    order_increment=1,
    pack_size=1,
    pack_unit=product.unit_of_measure,
    quantity_rule_version=1,
    quantity_rule_effective_from=coalesce(supplier_product.created_at,now()),
    quantity_rule_reason='Legacy supplier-product rule migrated',
    updated_at=coalesce(supplier_product.created_at,now())
FROM public.products product
WHERE product.id=supplier_product.product_id;

ALTER TABLE public.product_suppliers
  ALTER COLUMN supplier_moq SET DEFAULT 1,
  ALTER COLUMN supplier_moq SET NOT NULL,
  ADD CONSTRAINT product_supplier_minimum_quantity_valid
    CHECK (supplier_moq>=1 AND supplier_moq=trunc(supplier_moq)),
  ADD CONSTRAINT product_supplier_maximum_quantity_valid
    CHECK (maximum_order_quantity IS NULL OR (
      maximum_order_quantity>=supplier_moq
      AND maximum_order_quantity=trunc(maximum_order_quantity)
    )),
  ADD CONSTRAINT product_supplier_increment_valid
    CHECK (order_increment>=1 AND order_increment=trunc(order_increment)),
  ADD CONSTRAINT product_supplier_pack_size_valid
    CHECK (pack_size>=1 AND pack_size=trunc(pack_size)),
  ADD CONSTRAINT product_supplier_pack_unit_valid
    CHECK (pack_unit IS NULL OR char_length(btrim(pack_unit)) BETWEEN 1 AND 80),
  ADD CONSTRAINT product_supplier_rule_version_valid
    CHECK (quantity_rule_version>0),
  ADD CONSTRAINT product_supplier_rule_dates_valid
    CHECK (quantity_rule_effective_to IS NULL
      OR quantity_rule_effective_to>quantity_rule_effective_from),
  ADD CONSTRAINT product_supplier_rule_reason_valid
    CHECK (char_length(btrim(quantity_rule_reason)) BETWEEN 3 AND 1000);

CREATE TABLE public.product_supplier_quantity_rule_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  version integer NOT NULL CHECK (version>0),
  minimum_quantity numeric(14,3) NOT NULL CHECK (minimum_quantity>=1),
  maximum_quantity numeric(14,3),
  order_increment numeric(14,3) NOT NULL CHECK (order_increment>=1),
  pack_size numeric(14,3) NOT NULL CHECK (pack_size>=1),
  pack_unit text NOT NULL CHECK (char_length(btrim(pack_unit)) BETWEEN 1 AND 80),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  changed_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_supplier_id,version)
);
CREATE INDEX product_supplier_quantity_history_product_idx
  ON public.product_supplier_quantity_rule_history(product_id,recorded_at DESC);

INSERT INTO public.product_supplier_quantity_rule_history(
  product_supplier_id,product_id,supplier_id,version,minimum_quantity,
  maximum_quantity,order_increment,pack_size,pack_unit,effective_from,
  effective_to,reason,changed_by,recorded_at
)
SELECT supplier_product.id,supplier_product.product_id,supplier_product.supplier_id,
  supplier_product.quantity_rule_version,supplier_product.supplier_moq,
  supplier_product.maximum_order_quantity,supplier_product.order_increment,
  supplier_product.pack_size,
  coalesce(nullif(btrim(pack_unit),''),product.unit_of_measure),
  supplier_product.quantity_rule_effective_from,
  supplier_product.quantity_rule_effective_to,
  supplier_product.quantity_rule_reason,
  supplier_product.quantity_rule_updated_by,supplier_product.updated_at
FROM public.product_suppliers supplier_product
JOIN public.products product ON product.id=supplier_product.product_id;

CREATE OR REPLACE FUNCTION public.axora_prepare_product_supplier_quantity_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE next_version integer;
BEGIN
  NEW.supplier_moq:=coalesce(NEW.supplier_moq,1);
  NEW.order_increment:=coalesce(NEW.order_increment,1);
  NEW.pack_size:=coalesce(NEW.pack_size,1);
  NEW.pack_unit:=coalesce(nullif(btrim(NEW.pack_unit),''),(
    SELECT product.unit_of_measure FROM public.products product
    WHERE product.id=NEW.product_id
  ));
  NEW.quantity_rule_reason:=coalesce(
    nullif(btrim(NEW.quantity_rule_reason),''),
    'Supplier-product ordering rule configured'
  );
  NEW.quantity_rule_effective_from:=coalesce(NEW.quantity_rule_effective_from,now());

  IF TG_OP='INSERT' THEN
    SELECT coalesce(max(history.version),0)+1 INTO next_version
    FROM public.product_supplier_quantity_rule_history history
    WHERE history.product_id=NEW.product_id AND history.supplier_id=NEW.supplier_id;
    NEW.quantity_rule_version:=greatest(coalesce(next_version,1),1);
    NEW.updated_at:=now();
  ELSIF (
    NEW.supplier_moq,NEW.maximum_order_quantity,NEW.order_increment,
    NEW.pack_size,NEW.pack_unit,NEW.quantity_rule_effective_from,
    NEW.quantity_rule_effective_to
  ) IS DISTINCT FROM (
    OLD.supplier_moq,OLD.maximum_order_quantity,OLD.order_increment,
    OLD.pack_size,OLD.pack_unit,OLD.quantity_rule_effective_from,
    OLD.quantity_rule_effective_to
  ) THEN
    NEW.quantity_rule_version:=OLD.quantity_rule_version+1;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_capture_product_supplier_quantity_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='INSERT' OR (
    NEW.supplier_moq,NEW.maximum_order_quantity,NEW.order_increment,
    NEW.pack_size,NEW.pack_unit,NEW.quantity_rule_effective_from,
    NEW.quantity_rule_effective_to
  ) IS DISTINCT FROM (
    OLD.supplier_moq,OLD.maximum_order_quantity,OLD.order_increment,
    OLD.pack_size,OLD.pack_unit,OLD.quantity_rule_effective_from,
    OLD.quantity_rule_effective_to
  ) THEN
    INSERT INTO public.product_supplier_quantity_rule_history(
      product_supplier_id,product_id,supplier_id,version,minimum_quantity,
      maximum_quantity,order_increment,pack_size,pack_unit,effective_from,
      effective_to,reason,changed_by,recorded_at
    ) VALUES (
      NEW.id,NEW.product_id,NEW.supplier_id,NEW.quantity_rule_version,
      NEW.supplier_moq,NEW.maximum_order_quantity,NEW.order_increment,
      NEW.pack_size,NEW.pack_unit,NEW.quantity_rule_effective_from,
      NEW.quantity_rule_effective_to,NEW.quantity_rule_reason,
      NEW.quantity_rule_updated_by,NEW.updated_at
    ) ON CONFLICT(product_supplier_id,version) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prepare_product_supplier_quantity_rule
BEFORE INSERT OR UPDATE ON public.product_suppliers
FOR EACH ROW EXECUTE FUNCTION public.axora_prepare_product_supplier_quantity_rule();
CREATE TRIGGER capture_product_supplier_quantity_rule
AFTER INSERT OR UPDATE ON public.product_suppliers
FOR EACH ROW EXECUTE FUNCTION public.axora_capture_product_supplier_quantity_rule();

CREATE OR REPLACE FUNCTION public.axora_quantity_is_valid(
  p_quantity numeric,p_minimum numeric,p_maximum numeric,p_increment numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_quantity IS NOT NULL
    AND p_quantity>=coalesce(p_minimum,1)
    AND p_quantity=trunc(p_quantity)
    AND (p_maximum IS NULL OR p_quantity<=p_maximum)
    AND mod(p_quantity-coalesce(p_minimum,1),coalesce(nullif(p_increment,0),1))=0
$$;

-- P1-04: deterministic commercial pricing ------------------------------

CREATE TABLE public.commercial_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (char_length(btrim(rule_key)) BETWEEN 3 AND 80),
  version integer NOT NULL CHECK (version>0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  markup_percentage numeric(9,4) NOT NULL CHECK (markup_percentage>=0),
  rounding_scale integer NOT NULL DEFAULT 2 CHECK (rounding_scale BETWEEN 0 AND 4),
  tax_treatment text NOT NULL DEFAULT 'EXCLUDED'
    CHECK (tax_treatment IN ('EXCLUDED','INCLUDED')),
  delivery_treatment text NOT NULL DEFAULT 'EXCLUDED'
    CHECK (delivery_treatment IN ('EXCLUDED','INCLUDED')),
  source text NOT NULL CHECK (source IN ('SYSTEM_DEFAULT','PLATFORM_RULE')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to>effective_from),
  UNIQUE(rule_key,currency,version)
);
CREATE INDEX commercial_pricing_rules_effective_idx
  ON public.commercial_pricing_rules(currency,effective_from DESC,version DESC);

INSERT INTO public.commercial_pricing_rules(
  rule_key,version,currency,markup_percentage,rounding_scale,tax_treatment,
  delivery_treatment,source,effective_from,reason
) VALUES (
  'STANDARD_MARKUP',1,'MYR',10,2,'EXCLUDED','EXCLUDED','SYSTEM_DEFAULT',
  '2000-01-01T00:00:00Z','Default Axora ten percent commercial markup'
);

CREATE OR REPLACE FUNCTION public.axora_round_commercial_price(
  p_base_cost numeric,p_markup_percentage numeric,p_rounding_scale integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_base_cost IS NULL OR p_base_cost<0
    OR p_markup_percentage IS NULL OR p_markup_percentage<0
    OR p_rounding_scale NOT BETWEEN 0 AND 4 THEN
    RAISE EXCEPTION 'Commercial pricing input is invalid';
  END IF;
  RETURN round(p_base_cost*(1+p_markup_percentage/100),p_rounding_scale);
END $$;

CREATE OR REPLACE FUNCTION public.axora_current_product_offer_internal(
  p_product_id uuid,p_at timestamptz
)
RETURNS TABLE(
  base_cost numeric,selling_price_raw numeric,selling_price numeric,
  price_currency text,pricing_rule_id uuid,pricing_rule_version integer,
  markup_percentage numeric,rounding_scale integer,tax_treatment text,
  delivery_treatment text,pricing_source text,price_effective_from timestamptz,
  quantity_rule_id uuid,quantity_supplier_id uuid,minimum_quantity numeric,
  maximum_quantity numeric,order_increment numeric,pack_size numeric,
  pack_unit text,quantity_rule_version integer,
  quantity_rule_effective_from timestamptz,quantity_rule_reason text,
  price_changed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  WITH selected_product AS (
    SELECT product.* FROM public.products product
    WHERE product.id=p_product_id
  ), preferred_supplier AS (
    SELECT supplier_product.*
    FROM public.product_suppliers supplier_product
    JOIN public.suppliers supplier ON supplier.id=supplier_product.supplier_id
    WHERE supplier_product.product_id=p_product_id
      AND supplier_product.preferred AND supplier_product.active AND supplier.active
      AND supplier.company_id IS NULL
      AND supplier_product.quantity_rule_effective_from<=p_at
      AND (supplier_product.quantity_rule_effective_to IS NULL
        OR supplier_product.quantity_rule_effective_to>p_at)
    ORDER BY supplier_product.quantity_rule_version DESC,
      supplier_product.updated_at DESC
    LIMIT 1
  ), pricing AS (
    SELECT rule.* FROM public.commercial_pricing_rules rule
    WHERE rule.rule_key='STANDARD_MARKUP' AND rule.currency='MYR'
      AND rule.effective_from<=p_at
      AND (rule.effective_to IS NULL OR rule.effective_to>p_at)
    ORDER BY rule.version DESC,rule.effective_from DESC
    LIMIT 1
  )
  SELECT
    coalesce(supplier_product.indicative_buy_price,product.default_buy_price),
    (coalesce(supplier_product.indicative_buy_price,product.default_buy_price)
      *(1+pricing.markup_percentage/100))::numeric(18,6),
    public.axora_round_commercial_price(
      coalesce(supplier_product.indicative_buy_price,product.default_buy_price),
      pricing.markup_percentage,pricing.rounding_scale
    ),
    pricing.currency,pricing.id,pricing.version,pricing.markup_percentage,
    pricing.rounding_scale,pricing.tax_treatment,pricing.delivery_treatment,
    pricing.source,pricing.effective_from,
    supplier_product.id,supplier_product.supplier_id,
    coalesce(supplier_product.supplier_moq,1),
    supplier_product.maximum_order_quantity,
    coalesce(supplier_product.order_increment,1),
    coalesce(supplier_product.pack_size,1),
    coalesce(nullif(btrim(supplier_product.pack_unit),''),product.unit_of_measure),
    coalesce(supplier_product.quantity_rule_version,1),
    coalesce(supplier_product.quantity_rule_effective_from,product.created_at),
    coalesce(supplier_product.quantity_rule_reason,'Default quantity of one'),
    greatest(product.updated_at,coalesce(supplier_product.updated_at,product.updated_at),
      pricing.created_at,pricing.effective_from)
  FROM selected_product product
  CROSS JOIN pricing
  LEFT JOIN preferred_supplier supplier_product ON true
$$;

CREATE OR REPLACE FUNCTION public.axora_catalog_offer(
  p_product_id uuid,p_at timestamptz
)
RETURNS TABLE(
  selling_price numeric,price_currency text,price_rule_version integer,
  price_effective_from timestamptz,price_changed_at timestamptz,
  minimum_quantity numeric,maximum_quantity numeric,order_increment numeric,
  pack_size numeric,pack_unit text,quantity_rule_version integer,
  quantity_rule_effective_from timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT offer.selling_price,offer.price_currency,offer.pricing_rule_version,
    offer.price_effective_from,offer.price_changed_at,offer.minimum_quantity,
    offer.maximum_quantity,offer.order_increment,offer.pack_size,offer.pack_unit,
    offer.quantity_rule_version,offer.quantity_rule_effective_from
  FROM public.axora_current_product_offer_internal(p_product_id,p_at) offer
$$;

CREATE VIEW public.v_customer_catalog_products
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
  product.active,product.needs_review,product.created_at,product.updated_at
FROM public.products product
CROSS JOIN LATERAL public.axora_catalog_offer(product.id,now()) offer;

UPDATE public.products product
SET default_sell_price=(
  SELECT offer.selling_price
  FROM public.axora_current_product_offer_internal(product.id,now()) offer
),updated_at=now();

CREATE TABLE public.product_commercial_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  supplier_id uuid,
  base_cost numeric(18,6) NOT NULL CHECK (base_cost>=0),
  raw_selling_price numeric(18,6) NOT NULL CHECK (raw_selling_price>=0),
  selling_price numeric(18,4) NOT NULL CHECK (selling_price>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  pricing_rule_id uuid NOT NULL,
  pricing_rule_version integer NOT NULL CHECK (pricing_rule_version>0),
  markup_percentage numeric(9,4) NOT NULL CHECK (markup_percentage>=0),
  rounding_scale integer NOT NULL CHECK (rounding_scale BETWEEN 0 AND 4),
  tax_treatment text NOT NULL,
  delivery_treatment text NOT NULL,
  source text NOT NULL,
  effective_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  changed_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_commercial_price_history_product_idx
  ON public.product_commercial_price_history(product_id,recorded_at DESC);

CREATE OR REPLACE FUNCTION public.axora_append_product_price_history(
  p_product_id uuid,p_reason text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE offer record; actor_id uuid;
BEGIN
  SELECT * INTO offer
  FROM public.axora_current_product_offer_internal(p_product_id,now());
  IF offer.pricing_rule_id IS NULL THEN RETURN; END IF;
  BEGIN
    actor_id:=nullif(current_setting('axora.user_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN actor_id:=NULL;
  END;
  INSERT INTO public.product_commercial_price_history(
    product_id,supplier_id,base_cost,raw_selling_price,selling_price,currency,
    pricing_rule_id,pricing_rule_version,markup_percentage,rounding_scale,
    tax_treatment,delivery_treatment,source,effective_from,reason,changed_by
  ) VALUES (
    p_product_id,offer.quantity_supplier_id,offer.base_cost,
    offer.selling_price_raw,offer.selling_price,offer.price_currency,
    offer.pricing_rule_id,offer.pricing_rule_version,offer.markup_percentage,
    offer.rounding_scale,offer.tax_treatment,offer.delivery_treatment,
    offer.pricing_source,offer.price_effective_from,
    left(coalesce(nullif(btrim(p_reason),''),'Commercial offer recalculated'),1000),
    actor_id
  );
END $$;

INSERT INTO public.product_commercial_price_history(
  product_id,supplier_id,base_cost,raw_selling_price,selling_price,currency,
  pricing_rule_id,pricing_rule_version,markup_percentage,rounding_scale,
  tax_treatment,delivery_treatment,source,effective_from,reason,recorded_at
)
SELECT product.id,offer.quantity_supplier_id,offer.base_cost,
  offer.selling_price_raw,offer.selling_price,offer.price_currency,
  offer.pricing_rule_id,offer.pricing_rule_version,offer.markup_percentage,
  offer.rounding_scale,offer.tax_treatment,offer.delivery_treatment,
  offer.pricing_source,offer.price_effective_from,
  'P1-04 deterministic ten percent pricing baseline',now()
FROM public.products product
CROSS JOIN LATERAL public.axora_current_product_offer_internal(product.id,now()) offer;

CREATE OR REPLACE FUNCTION public.axora_capture_product_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  PERFORM public.axora_append_product_price_history(
    CASE WHEN TG_TABLE_NAME='products' THEN NEW.id
      ELSE (to_jsonb(NEW)->>'product_id')::uuid END,
    coalesce(nullif(current_setting('axora.change_reason',true),''),
      CASE WHEN TG_TABLE_NAME='products' THEN 'Product base cost changed'
        ELSE 'Supplier-product commercial offer changed' END)
  );
  RETURN NEW;
END $$;

CREATE TRIGGER capture_product_price_history
AFTER INSERT OR UPDATE OF default_buy_price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.axora_capture_product_price_history();
CREATE TRIGGER capture_supplier_product_price_history
AFTER INSERT OR UPDATE OF indicative_buy_price,preferred,active
ON public.product_suppliers
FOR EACH ROW EXECUTE FUNCTION public.axora_capture_product_price_history();

-- Request submission, approval, supplier selection and PO snapshots -------

ALTER TABLE public.request_lines
  ADD COLUMN submitted_quantity_rule_id uuid,
  ADD COLUMN submitted_quantity_supplier_id uuid,
  ADD COLUMN submitted_quantity_rule_version integer,
  ADD COLUMN submitted_minimum_quantity numeric(14,3),
  ADD COLUMN submitted_maximum_quantity numeric(14,3),
  ADD COLUMN submitted_order_increment numeric(14,3),
  ADD COLUMN submitted_pack_size numeric(14,3),
  ADD COLUMN submitted_pack_unit text,
  ADD COLUMN submitted_quantity_rule_effective_from timestamptz,
  ADD COLUMN commercial_pricing_rule_id uuid,
  ADD COLUMN commercial_pricing_rule_version integer,
  ADD COLUMN commercial_base_cost_snapshot numeric(18,6),
  ADD COLUMN commercial_raw_selling_price_snapshot numeric(18,6),
  ADD COLUMN commercial_markup_percentage_snapshot numeric(9,4),
  ADD COLUMN commercial_rounding_scale_snapshot integer,
  ADD COLUMN commercial_currency_snapshot text,
  ADD COLUMN commercial_tax_treatment_snapshot text,
  ADD COLUMN commercial_delivery_treatment_snapshot text,
  ADD COLUMN commercial_tax_rate_snapshot numeric(7,4),
  ADD COLUMN commercial_pricing_source_snapshot text,
  ADD COLUMN commercial_pricing_effective_from_snapshot timestamptz,
  ADD COLUMN commercial_price_changed_at_snapshot timestamptz,
  ADD COLUMN commercial_priced_at timestamptz;

UPDATE public.request_lines line
SET submitted_quantity_rule_version=0,
    submitted_minimum_quantity=1,
    submitted_order_increment=1,
    submitted_pack_size=1,
    submitted_pack_unit=line.unit_of_measure,
    submitted_quantity_rule_effective_from=line.created_at,
    commercial_pricing_rule_version=0,
    commercial_base_cost_snapshot=line.unit_buy_price,
    commercial_raw_selling_price_snapshot=line.unit_sell_price,
    commercial_markup_percentage_snapshot=CASE
      WHEN line.unit_buy_price>0 THEN greatest(
        round(((line.unit_sell_price/line.unit_buy_price)-1)*100,4),0)
      ELSE 0 END,
    commercial_rounding_scale_snapshot=2,
    commercial_currency_snapshot=request.currency,
    commercial_tax_treatment_snapshot='EXCLUDED',
    commercial_delivery_treatment_snapshot='EXCLUDED',
    commercial_tax_rate_snapshot=request.tax_rate,
    commercial_pricing_source_snapshot='LEGACY_REQUEST_SNAPSHOT',
    commercial_pricing_effective_from_snapshot=line.created_at,
    commercial_price_changed_at_snapshot=line.created_at,
    commercial_priced_at=line.created_at
FROM public.requests request
WHERE request.id=line.request_id;

ALTER TABLE public.request_lines
  ALTER COLUMN submitted_quantity_rule_version SET NOT NULL,
  ALTER COLUMN submitted_minimum_quantity SET NOT NULL,
  ALTER COLUMN submitted_order_increment SET NOT NULL,
  ALTER COLUMN submitted_pack_size SET NOT NULL,
  ALTER COLUMN submitted_pack_unit SET NOT NULL,
  ALTER COLUMN submitted_quantity_rule_effective_from SET NOT NULL,
  ALTER COLUMN commercial_pricing_rule_version SET NOT NULL,
  ALTER COLUMN commercial_base_cost_snapshot SET NOT NULL,
  ALTER COLUMN commercial_raw_selling_price_snapshot SET NOT NULL,
  ALTER COLUMN commercial_markup_percentage_snapshot SET NOT NULL,
  ALTER COLUMN commercial_rounding_scale_snapshot SET NOT NULL,
  ALTER COLUMN commercial_currency_snapshot SET NOT NULL,
  ALTER COLUMN commercial_tax_treatment_snapshot SET NOT NULL,
  ALTER COLUMN commercial_delivery_treatment_snapshot SET NOT NULL,
  ALTER COLUMN commercial_tax_rate_snapshot SET NOT NULL,
  ALTER COLUMN commercial_pricing_source_snapshot SET NOT NULL,
  ALTER COLUMN commercial_pricing_effective_from_snapshot SET NOT NULL,
  ALTER COLUMN commercial_price_changed_at_snapshot SET NOT NULL,
  ALTER COLUMN commercial_priced_at SET NOT NULL,
  ADD CONSTRAINT request_line_submitted_quantity_snapshot_valid CHECK (
    submitted_quantity_rule_version>=0
    AND submitted_minimum_quantity>=1
    AND submitted_order_increment>=1
    AND submitted_pack_size>=1
    AND (submitted_maximum_quantity IS NULL
      OR submitted_maximum_quantity>=submitted_minimum_quantity)
  ),
  ADD CONSTRAINT request_line_commercial_snapshot_valid CHECK (
    commercial_pricing_rule_version>=0
    AND commercial_base_cost_snapshot>=0
    AND commercial_raw_selling_price_snapshot>=0
    AND commercial_markup_percentage_snapshot>=0
    AND commercial_rounding_scale_snapshot BETWEEN 0 AND 4
    AND commercial_currency_snapshot ~ '^[A-Z]{3}$'
  );

CREATE OR REPLACE FUNCTION public.axora_prepare_request_line_commercial_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE offer record; request_context record;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.unit_sell_price IS DISTINCT FROM OLD.unit_sell_price
      OR (
        NEW.submitted_quantity_rule_id,NEW.submitted_quantity_supplier_id,
        NEW.submitted_quantity_rule_version,NEW.submitted_minimum_quantity,
        NEW.submitted_maximum_quantity,NEW.submitted_order_increment,
        NEW.submitted_pack_size,NEW.submitted_pack_unit,
        NEW.submitted_quantity_rule_effective_from,
        NEW.commercial_pricing_rule_id,NEW.commercial_pricing_rule_version,
        NEW.commercial_base_cost_snapshot,NEW.commercial_raw_selling_price_snapshot,
        NEW.commercial_markup_percentage_snapshot,NEW.commercial_rounding_scale_snapshot,
        NEW.commercial_currency_snapshot,NEW.commercial_tax_treatment_snapshot,
        NEW.commercial_delivery_treatment_snapshot,NEW.commercial_tax_rate_snapshot,
        NEW.commercial_pricing_source_snapshot,
        NEW.commercial_pricing_effective_from_snapshot,
        NEW.commercial_price_changed_at_snapshot,NEW.commercial_priced_at
      ) IS DISTINCT FROM (
        OLD.submitted_quantity_rule_id,OLD.submitted_quantity_supplier_id,
        OLD.submitted_quantity_rule_version,OLD.submitted_minimum_quantity,
        OLD.submitted_maximum_quantity,OLD.submitted_order_increment,
        OLD.submitted_pack_size,OLD.submitted_pack_unit,
        OLD.submitted_quantity_rule_effective_from,
        OLD.commercial_pricing_rule_id,OLD.commercial_pricing_rule_version,
        OLD.commercial_base_cost_snapshot,OLD.commercial_raw_selling_price_snapshot,
        OLD.commercial_markup_percentage_snapshot,OLD.commercial_rounding_scale_snapshot,
        OLD.commercial_currency_snapshot,OLD.commercial_tax_treatment_snapshot,
        OLD.commercial_delivery_treatment_snapshot,OLD.commercial_tax_rate_snapshot,
        OLD.commercial_pricing_source_snapshot,
        OLD.commercial_pricing_effective_from_snapshot,
        OLD.commercial_price_changed_at_snapshot,OLD.commercial_priced_at
      ) THEN
      RAISE EXCEPTION 'Submitted quantity and commercial snapshots are immutable';
    END IF;
    IF NEW.quantity IS DISTINCT FROM OLD.quantity AND NOT public.axora_quantity_is_valid(
      NEW.quantity,OLD.submitted_minimum_quantity,OLD.submitted_maximum_quantity,
      OLD.submitted_order_increment
    ) THEN
      RAISE EXCEPTION 'Quantity does not match the submitted supplier-product rule';
    END IF;
    RETURN NEW;
  END IF;

  SELECT request.currency,request.tax_rate INTO request_context
  FROM public.requests request WHERE request.id=NEW.request_id FOR SHARE;
  SELECT * INTO offer
  FROM public.axora_current_product_offer_internal(NEW.product_id,now());
  IF request_context.currency IS NULL OR offer.pricing_rule_id IS NULL
    OR offer.price_currency<>request_context.currency THEN
    RAISE EXCEPTION 'The current product price is unavailable for this request currency';
  END IF;
  IF NOT public.axora_quantity_is_valid(
    NEW.quantity,offer.minimum_quantity,offer.maximum_quantity,offer.order_increment
  ) THEN
    RAISE EXCEPTION 'Quantity does not match the current supplier-product rule';
  END IF;

  NEW.submitted_quantity_rule_id:=offer.quantity_rule_id;
  NEW.submitted_quantity_supplier_id:=offer.quantity_supplier_id;
  NEW.submitted_quantity_rule_version:=offer.quantity_rule_version;
  NEW.submitted_minimum_quantity:=offer.minimum_quantity;
  NEW.submitted_maximum_quantity:=offer.maximum_quantity;
  NEW.submitted_order_increment:=offer.order_increment;
  NEW.submitted_pack_size:=offer.pack_size;
  NEW.submitted_pack_unit:=offer.pack_unit;
  NEW.submitted_quantity_rule_effective_from:=offer.quantity_rule_effective_from;
  NEW.commercial_pricing_rule_id:=offer.pricing_rule_id;
  NEW.commercial_pricing_rule_version:=offer.pricing_rule_version;
  NEW.commercial_base_cost_snapshot:=offer.base_cost;
  NEW.commercial_raw_selling_price_snapshot:=offer.selling_price_raw;
  NEW.commercial_markup_percentage_snapshot:=offer.markup_percentage;
  NEW.commercial_rounding_scale_snapshot:=offer.rounding_scale;
  NEW.commercial_currency_snapshot:=offer.price_currency;
  NEW.commercial_tax_treatment_snapshot:=offer.tax_treatment;
  NEW.commercial_delivery_treatment_snapshot:=offer.delivery_treatment;
  NEW.commercial_tax_rate_snapshot:=request_context.tax_rate;
  NEW.commercial_pricing_source_snapshot:=offer.pricing_source;
  NEW.commercial_pricing_effective_from_snapshot:=offer.price_effective_from;
  NEW.commercial_price_changed_at_snapshot:=offer.price_changed_at;
  NEW.commercial_priced_at:=now();
  NEW.unit_buy_price:=offer.base_cost;
  NEW.unit_sell_price:=offer.selling_price;
  RETURN NEW;
END $$;

CREATE TRIGGER prepare_request_line_commercial_snapshot
BEFORE INSERT OR UPDATE ON public.request_lines
FOR EACH ROW EXECUTE FUNCTION public.axora_prepare_request_line_commercial_snapshot();

CREATE TABLE public.request_line_supplier_rule_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id uuid NOT NULL REFERENCES public.request_lines(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  quotation_id uuid,
  evidence_type text NOT NULL
    CHECK (evidence_type IN ('SUPPLIER_SELECTION','SUBSTITUTION','PURCHASE_ORDER')),
  quantity numeric(14,3) NOT NULL,
  quantity_rule_id uuid,
  quantity_rule_version integer NOT NULL CHECK (quantity_rule_version>=0),
  minimum_quantity numeric(14,3) NOT NULL CHECK (minimum_quantity>=1),
  maximum_quantity numeric(14,3),
  order_increment numeric(14,3) NOT NULL CHECK (order_increment>=1),
  pack_size numeric(14,3) NOT NULL CHECK (pack_size>=1),
  pack_unit text NOT NULL,
  effective_from timestamptz NOT NULL,
  reason text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_line_supplier_rule_snapshot_request_idx
  ON public.request_line_supplier_rule_snapshots(request_id,captured_at DESC);

CREATE OR REPLACE FUNCTION public.axora_capture_request_line_supplier_rule(
  p_request_line_id uuid,p_supplier_id uuid,p_evidence_type text,p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE context record; snapshot_id uuid; minimum_quantity numeric;
BEGIN
  IF p_evidence_type NOT IN ('SUPPLIER_SELECTION','SUBSTITUTION','PURCHASE_ORDER') THEN
    RAISE EXCEPTION 'Supplier quantity evidence type is invalid';
  END IF;
  SELECT line.id AS line_id,line.request_id,line.product_id,line.quantity,
    line.unit_of_measure,quotation.id AS quotation_id,
    quotation.minimum_order_quantity AS quotation_minimum,
    supplier_product.id AS rule_id,
    supplier_product.quantity_rule_version,
    supplier_product.supplier_moq,supplier_product.maximum_order_quantity,
    supplier_product.order_increment,supplier_product.pack_size,
    supplier_product.pack_unit,supplier_product.quantity_rule_effective_from,
    supplier_product.quantity_rule_reason
  INTO context
  FROM public.request_lines line
  JOIN public.suppliers supplier ON supplier.id=p_supplier_id
    AND supplier.active AND supplier.company_id IS NULL
  LEFT JOIN LATERAL (
    SELECT quote.id,quote.minimum_order_quantity
    FROM public.quotations quote
    WHERE quote.request_line_id=line.id AND quote.supplier_id=p_supplier_id
      AND quote.selected
    ORDER BY quote.updated_at DESC LIMIT 1
  ) quotation ON true
  JOIN public.product_suppliers supplier_product
    ON supplier_product.product_id=line.product_id
    AND supplier_product.supplier_id=p_supplier_id
    AND supplier_product.active
    AND supplier_product.quantity_rule_effective_from<=p_at
    AND (supplier_product.quantity_rule_effective_to IS NULL
      OR supplier_product.quantity_rule_effective_to>p_at)
  WHERE line.id=p_request_line_id
  FOR SHARE OF line,supplier,supplier_product;
  IF context.line_id IS NULL THEN
    RAISE EXCEPTION 'The supplier-product quantity rule is unavailable';
  END IF;
  minimum_quantity:=greatest(
    coalesce(context.supplier_moq,1),coalesce(context.quotation_minimum,1)
  );
  IF NOT public.axora_quantity_is_valid(
    context.quantity,minimum_quantity,context.maximum_order_quantity,
    coalesce(context.order_increment,1)
  ) THEN
    RAISE EXCEPTION 'Requested quantity does not satisfy the selected supplier rule';
  END IF;
  INSERT INTO public.request_line_supplier_rule_snapshots(
    request_line_id,request_id,product_id,supplier_id,quotation_id,evidence_type,
    quantity,quantity_rule_id,quantity_rule_version,minimum_quantity,
    maximum_quantity,order_increment,pack_size,pack_unit,effective_from,reason,
    captured_at
  ) VALUES (
    context.line_id,context.request_id,context.product_id,p_supplier_id,
    context.quotation_id,p_evidence_type,context.quantity,context.rule_id,
    coalesce(context.quantity_rule_version,0),minimum_quantity,
    context.maximum_order_quantity,coalesce(context.order_increment,1),
    coalesce(context.pack_size,1),
    coalesce(nullif(btrim(context.pack_unit),''),context.unit_of_measure),
    coalesce(context.quantity_rule_effective_from,p_at),
    coalesce(context.quantity_rule_reason,
      CASE WHEN context.quotation_id IS NULL THEN 'Default quantity of one'
        ELSE 'Supplier quotation minimum quantity' END),p_at
  ) RETURNING id INTO snapshot_id;
  RETURN snapshot_id;
END $$;

CREATE OR REPLACE FUNCTION public.axora_capture_selected_supplier_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.selected_supplier_id IS NOT NULL
    AND NEW.selected_supplier_id IS DISTINCT FROM OLD.selected_supplier_id THEN
    PERFORM public.axora_capture_request_line_supplier_rule(
      NEW.id,NEW.selected_supplier_id,
      CASE WHEN OLD.selected_supplier_id IS NULL THEN 'SUPPLIER_SELECTION'
        ELSE 'SUBSTITUTION' END,now()
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_selected_supplier_rule
AFTER UPDATE OF selected_supplier_id ON public.request_lines
FOR EACH ROW EXECUTE FUNCTION public.axora_capture_selected_supplier_rule();

CREATE OR REPLACE FUNCTION public.axora_validate_purchase_order_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE old_status text; new_status text; line record;
BEGIN
  SELECT label INTO old_status FROM public.lookup_values WHERE id=OLD.status_id;
  SELECT label INTO new_status FROM public.lookup_values WHERE id=NEW.status_id;
  IF new_status='Ordered' AND old_status IS DISTINCT FROM new_status THEN
    FOR line IN SELECT id,selected_supplier_id FROM public.request_lines
      WHERE request_id=NEW.id ORDER BY id FOR SHARE
    LOOP
      IF line.selected_supplier_id IS NULL THEN
        RAISE EXCEPTION 'Every purchase-order line requires a selected supplier';
      END IF;
      PERFORM public.axora_capture_request_line_supplier_rule(
        line.id,line.selected_supplier_id,'PURCHASE_ORDER',now()
      );
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_purchase_order_rules
BEFORE UPDATE OF status_id ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_purchase_order_rules();

CREATE OR REPLACE FUNCTION public.axora_validate_request_commercial_snapshots(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.request_lines line
    JOIN public.requests request ON request.id=line.request_id
    WHERE line.request_id=p_request_id AND (
      NOT public.axora_quantity_is_valid(
        line.quantity,line.submitted_minimum_quantity,
        line.submitted_maximum_quantity,line.submitted_order_increment
      )
      OR line.commercial_currency_snapshot<>request.currency
      OR line.commercial_tax_rate_snapshot<>request.tax_rate
      OR (line.commercial_pricing_rule_version>0 AND (
        line.commercial_raw_selling_price_snapshot<>
          round(line.commercial_base_cost_snapshot
            *(1+line.commercial_markup_percentage_snapshot/100),6)
        OR line.unit_sell_price<>public.axora_round_commercial_price(
          line.commercial_base_cost_snapshot,
          line.commercial_markup_percentage_snapshot,
          line.commercial_rounding_scale_snapshot
        )
        OR line.commercial_tax_treatment_snapshot<>'EXCLUDED'
        OR line.commercial_delivery_treatment_snapshot<>'EXCLUDED'
      ))
    )
  ) THEN
    RAISE EXCEPTION 'Request quantity or commercial snapshot validation failed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.axora_validate_request_commercial_snapshots_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  PERFORM public.axora_validate_request_commercial_snapshots(NEW.request_id);
  RETURN NEW;
END $$;
CREATE TRIGGER validate_request_commercial_approval_snapshot
BEFORE INSERT ON public.request_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_request_commercial_snapshots_trigger();
CREATE TRIGGER validate_request_commercial_approval_decision
BEFORE INSERT ON public.request_approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_request_commercial_snapshots_trigger();

-- Keep confidential base cost, supplier identity and markup out of the
-- company approval payload while retaining customer selling and safe quantity
-- terms. Existing approval evidence is left unchanged.
CREATE OR REPLACE FUNCTION public.axora_request_snapshot_payload_internal(
  p_request_id uuid,p_policy_version integer,p_amount numeric,p_currency text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'request',to_jsonb(request)-'client_submission_key'-'approval_last_correlation_id',
    'lines',coalesce((SELECT jsonb_agg(
      to_jsonb(line)-ARRAY[
        'unit_cost','buying_cost','margin','supplier_id','selected_supplier_id',
        'quotation_reference','unit_buy_price','submitted_quantity_rule_id',
        'submitted_quantity_supplier_id','commercial_pricing_rule_id',
        'commercial_base_cost_snapshot','commercial_raw_selling_price_snapshot',
        'commercial_markup_percentage_snapshot','commercial_rounding_scale_snapshot',
        'commercial_pricing_source_snapshot','commercial_pricing_effective_from_snapshot',
        'commercial_price_changed_at_snapshot','commercial_priced_at'
      ]::text[] ORDER BY line.id
    ) FROM public.request_lines line WHERE line.request_id=request.id),'[]'::jsonb),
    'amount',p_amount::text,'currency',p_currency,'policyVersion',p_policy_version
  )
  FROM public.requests request WHERE request.id=p_request_id
$$;

CREATE OR REPLACE FUNCTION public.axora_reject_commercial_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Commercial and quantity evidence is append-only';
END $$;
CREATE TRIGGER protect_commercial_pricing_rules
BEFORE UPDATE OR DELETE ON public.commercial_pricing_rules
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_commercial_evidence_mutation();
CREATE TRIGGER protect_product_supplier_quantity_history
BEFORE UPDATE OR DELETE ON public.product_supplier_quantity_rule_history
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_commercial_evidence_mutation();
CREATE TRIGGER protect_product_commercial_price_history
BEFORE UPDATE OR DELETE ON public.product_commercial_price_history
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_commercial_evidence_mutation();
CREATE TRIGGER protect_request_line_supplier_rule_snapshots
BEFORE UPDATE OR DELETE ON public.request_line_supplier_rule_snapshots
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_commercial_evidence_mutation();

CREATE OR REPLACE FUNCTION public.axora_product_commercial_history(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_product_id uuid,
  p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; payload jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'commercial.cost.view','PLATFORM',NULL,NULL,NULL,NULL
  ) OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=p_product_id) THEN
    RAISE EXCEPTION 'Commercial price history is unavailable';
  END IF;
  INSERT INTO public.audit_logs(entity_type,record_id,action,actor_id,reason)
  VALUES ('product_commercial_price_history',p_product_id,'VIEW',
    p_actor_user_id,'Viewed confidential product commercial price history');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',history.id,'baseCost',history.base_cost,'rawSellingPrice',history.raw_selling_price,
    'sellingPrice',history.selling_price,'markupPercentage',history.markup_percentage,
    'currency',history.currency,'pricingRuleVersion',history.pricing_rule_version,
    'source',history.source,'reason',history.reason,
    'effectiveFrom',history.effective_from,'recordedAt',history.recorded_at
  ) ORDER BY history.recorded_at DESC,history.id DESC),'[]'::jsonb)
  INTO payload FROM (
    SELECT * FROM public.product_commercial_price_history
    WHERE product_id=p_product_id ORDER BY recorded_at DESC,id DESC LIMIT 100
  ) history;
  RETURN payload;
END $$;

CREATE OR REPLACE FUNCTION public.axora_product_administration_catalog(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; payload jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'catalog.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN
    RAISE EXCEPTION 'Product catalog is unavailable';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',product.id::text,
    'companyId',product.company_id::text,
    'companyName',company.name,
    'code',product.product_code,
    'name',product.name,
    'category',product.category,
    'subcategory',product.subcategory,
    'brand',product.brand,
    'size',product.product_size,
    'unit',product.unit_of_measure,
    'packaging',product.packaging,
    'description',product.description,
    'defaultBuyPrice',offer.base_cost,
    'defaultSellPrice',offer.selling_price,
    'minimumOrderQuantity',offer.minimum_quantity,
    'maximumOrderQuantity',offer.maximum_quantity,
    'orderIncrement',offer.order_increment,
    'packSize',offer.pack_size,
    'packUnit',offer.pack_unit,
    'quantityRuleVersion',offer.quantity_rule_version,
    'quantityRuleEffectiveFrom',offer.quantity_rule_effective_from,
    'priceRuleVersion',offer.pricing_rule_version,
    'priceEffectiveFrom',offer.price_effective_from,
    'priceChangedAt',offer.price_changed_at,
    'priceCurrency',offer.price_currency,
    'deliverySlaDays',product.delivery_sla_days,
    'preferredSupplierId',offer.quantity_supplier_id::text,
    'preferredSupplierName',supplier.name,
    'hasImage',(product.image_content IS NOT NULL),
    'imageAltText',product.image_alt_text,
    'status',CASE WHEN product.needs_review THEN 'Needs Review'
      WHEN product.active THEN 'Active' ELSE 'Inactive' END,
    'duplicateWarning',(SELECT count(*)>1 FROM public.products duplicate
      WHERE lower(btrim(duplicate.name))=lower(btrim(product.name)))
  ) ORDER BY product.name),'[]'::jsonb)
  INTO payload
  FROM public.products product
  LEFT JOIN public.companies company ON company.id=product.company_id
  CROSS JOIN LATERAL public.axora_current_product_offer_internal(
    product.id,p_at
  ) offer
  LEFT JOIN public.suppliers supplier ON supplier.id=offer.quantity_supplier_id;

  INSERT INTO public.audit_logs(entity_type,record_id,action,actor_id,reason)
  VALUES ('product_catalog',p_actor_user_id,'VIEW',p_actor_user_id,
    'Viewed platform product administration catalog');
  RETURN payload;
END $$;

REVOKE ALL ON FUNCTION public.axora_product_administration_catalog(
  uuid,uuid,timestamptz
) FROM PUBLIC;

-- Runtime grants --------------------------------------------------------

REVOKE ALL ON TABLE public.commercial_pricing_rules,
  public.product_supplier_quantity_rule_history,
  public.product_commercial_price_history,
  public.request_line_supplier_rule_snapshots
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_quantity_is_valid(numeric,numeric,numeric,numeric),
  public.axora_round_commercial_price(numeric,numeric,integer),
  public.axora_current_product_offer_internal(uuid,timestamptz),
  public.axora_append_product_price_history(uuid,text),
  public.axora_capture_product_price_history(),
  public.axora_prepare_product_supplier_quantity_rule(),
  public.axora_capture_product_supplier_quantity_rule(),
  public.axora_prepare_request_line_commercial_snapshot(),
  public.axora_validate_request_commercial_snapshots(uuid),
  public.axora_validate_request_commercial_snapshots_trigger(),
  public.axora_capture_request_line_supplier_rule(uuid,uuid,text,timestamptz),
  public.axora_capture_selected_supplier_rule(),
  public.axora_validate_purchase_order_rules(),
  public.axora_reject_commercial_evidence_mutation()
FROM PUBLIC;

DO $$
DECLARE readable_product_columns text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.commercial_pricing_rules,
      public.product_supplier_quantity_rule_history,
      public.product_commercial_price_history,
      public.request_line_supplier_rule_snapshots
    FROM axora_app;
    REVOKE SELECT ON TABLE public.products,public.product_suppliers
    FROM axora_app;
    SELECT string_agg(quote_ident(attribute.attname),',' ORDER BY attribute.attnum)
    INTO readable_product_columns
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid='public.products'::regclass
      AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND attribute.attname<>'default_buy_price';
    EXECUTE format(
      'GRANT SELECT (%s) ON TABLE public.products TO axora_app',
      readable_product_columns
    );
    GRANT SELECT (id,product_id,supplier_id,preferred,active)
    ON TABLE public.product_suppliers TO axora_app;
    GRANT SELECT ON TABLE public.v_customer_catalog_products TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_catalog_offer(uuid,timestamptz),
      public.axora_product_commercial_history(uuid,uuid,uuid,timestamptz),
      public.axora_product_administration_catalog(uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
