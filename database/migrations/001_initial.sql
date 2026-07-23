BEGIN;

CREATE SEQUENCE IF NOT EXISTS company_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS branch_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS supplier_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS product_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS order_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS request_line_code_seq START 1000;

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users(lower(email));

CREATE TABLE IF NOT EXISTS lookup_types (
  type_key text PRIMARY KEY,
  label text NOT NULL,
  configurable boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lookup_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text NOT NULL REFERENCES lookup_types(type_key),
  value_key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(type_key, value_key),
  UNIQUE(type_key, label)
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text NOT NULL UNIQUE,
  name text NOT NULL,
  industry text NOT NULL DEFAULT '',
  main_contact_name text NOT NULL DEFAULT '',
  main_contact_email text NOT NULL DEFAULT '',
  main_contact_phone text NOT NULL DEFAULT '',
  billing_contact_name text NOT NULL DEFAULT '',
  billing_contact_email text NOT NULL DEFAULT '',
  billing_contact_phone text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  payment_terms text NOT NULL DEFAULT '',
  billing_cycle text NOT NULL DEFAULT '',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_lower_uq ON companies(lower(name));

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code_id text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  branch_code text NOT NULL,
  delivery_address text NOT NULL,
  city text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  delivery_instructions text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  UNIQUE(company_id, branch_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS branches_company_name_lower_uq ON branches(company_id, lower(name));

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  coverage_area text NOT NULL DEFAULT '',
  payment_terms text NOT NULL DEFAULT '',
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  minimum_order_quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity >= 0),
  main_products text NOT NULL DEFAULT '',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_lower_uq ON suppliers(lower(name));

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  subcategory text NOT NULL DEFAULT '',
  brand text,
  product_size text,
  unit_of_measure text NOT NULL,
  packaging text,
  description text,
  default_buy_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_buy_price >= 0),
  default_sell_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_sell_price >= 0),
  minimum_order_quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity >= 0),
  delivery_sla_days integer NOT NULL DEFAULT 0 CHECK (delivery_sla_days >= 0),
  active boolean NOT NULL DEFAULT true,
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_name_lower_idx ON products(lower(name));
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category, subcategory);
CREATE UNIQUE INDEX IF NOT EXISTS products_active_name_lower_uq ON products(lower(name)) WHERE active AND NOT needs_review;

CREATE TABLE IF NOT EXISTS product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  preferred boolean NOT NULL DEFAULT false,
  indicative_buy_price numeric(14,2) CHECK (indicative_buy_price >= 0),
  supplier_moq numeric(14,3) CHECK (supplier_moq >= 0),
  lead_time_days integer CHECK (lead_time_days >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, supplier_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_preferred_supplier_per_product ON product_suppliers(product_id) WHERE preferred;

CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  request_type_id uuid NOT NULL REFERENCES lookup_values(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid NOT NULL,
  department text NOT NULL DEFAULT '',
  requested_by text NOT NULL,
  requester_contact text NOT NULL DEFAULT '',
  needed_by_date date NOT NULL,
  urgency_id uuid NOT NULL REFERENCES lookup_values(id),
  status_id uuid NOT NULL REFERENCES lookup_values(id),
  notes text,
  issue_reason text,
  created_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(branch_id, company_id) REFERENCES branches(id, company_id)
);
CREATE INDEX IF NOT EXISTS requests_company_date_idx ON requests(company_id, request_date DESC);
CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status_id, needed_by_date);

CREATE TABLE IF NOT EXISTS request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_code text NOT NULL UNIQUE,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id),
  product_name_snapshot text NOT NULL,
  category_snapshot text NOT NULL,
  subcategory_snapshot text,
  specification text,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_of_measure text NOT NULL,
  needed_by_date date,
  urgency_id uuid REFERENCES lookup_values(id),
  status_id uuid REFERENCES lookup_values(id),
  selected_supplier_id uuid REFERENCES suppliers(id),
  quotation_reference text,
  supplier_confirmation_status_id uuid REFERENCES lookup_values(id),
  unit_buy_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_buy_price >= 0),
  unit_sell_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_sell_price >= 0),
  delivery_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_lines_request_idx ON request_lines(request_id);

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id uuid NOT NULL REFERENCES request_lines(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  quotation_reference text,
  quotation_date date,
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  delivery_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  minimum_order_quantity numeric(14,3) CHECK (minimum_order_quantity >= 0),
  lead_time_days integer CHECK (lead_time_days >= 0),
  valid_until date,
  status_id uuid NOT NULL REFERENCES lookup_values(id),
  attachment_path text,
  selected boolean NOT NULL DEFAULT false,
  selection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_line_id, supplier_id, quotation_reference)
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id),
  approval_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('Pending','Approved','Rejected')),
  reviewer_id uuid REFERENCES users(id),
  reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id uuid NOT NULL REFERENCES request_lines(id),
  expected_date date,
  revised_date date,
  actual_date date,
  status_id uuid NOT NULL REFERENCES lookup_values(id),
  quantity_received numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  received_by text,
  issue_reason text,
  proof_of_delivery_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_line_idx ON deliveries(request_line_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('CUSTOMER','SUPPLIER')),
  request_id uuid NOT NULL REFERENCES requests(id),
  company_id uuid REFERENCES companies(id),
  supplier_id uuid REFERENCES suppliers(id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status_id uuid NOT NULL REFERENCES lookup_values(id),
  attachment_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((direction='CUSTOMER' AND company_id IS NOT NULL AND supplier_id IS NULL) OR
         (direction='SUPPLIER' AND supplier_id IS NOT NULL AND company_id IS NULL)),
  UNIQUE(direction, invoice_number)
);
CREATE INDEX IF NOT EXISTS invoices_request_idx ON invoices(request_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS invoice_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  request_line_id uuid NOT NULL REFERENCES request_lines(id),
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount >= 0),
  PRIMARY KEY(invoice_id, request_line_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT '',
  reference text,
  evidence_path text,
  recorded_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id, payment_date);
CREATE UNIQUE INDEX IF NOT EXISTS one_selected_quotation_per_line ON quotations(request_line_id) WHERE selected;

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  record_id uuid NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  actor_id uuid REFERENCES users(id),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_record_idx ON audit_logs(entity_type, record_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS request_status_transitions (
  from_status_id uuid NOT NULL REFERENCES lookup_values(id),
  to_status_id uuid NOT NULL REFERENCES lookup_values(id),
  reason_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY(from_status_id, to_status_id)
);

CREATE OR REPLACE FUNCTION lookup_id(p_type text, p_label text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM lookup_values WHERE type_key = p_type AND label = p_label AND active = true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION category_prefix(p_category text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(p_category)
    WHEN 'pantry / hospitality' THEN 'PAN'
    WHEN 'cleaning & hygiene' THEN 'CLN'
    WHEN 'office basics' THEN 'OFF'
    WHEN 'printing & branding / marketing' THEN 'PRN'
    WHEN 'printing & marketing' THEN 'PRN'
    ELSE 'GEN' END
$$;

CREATE OR REPLACE FUNCTION next_company_code() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'C-' || lpad(nextval('company_code_seq')::text, 3, '0') $$;
CREATE OR REPLACE FUNCTION next_branch_code() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'B-' || lpad(nextval('branch_code_seq')::text, 3, '0') $$;
CREATE OR REPLACE FUNCTION next_supplier_code() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'S-' || lpad(nextval('supplier_code_seq')::text, 3, '0') $$;
CREATE OR REPLACE FUNCTION next_product_code(p_category text) RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'AX-' || category_prefix(p_category) || '-' || lpad(nextval('product_code_seq')::text, 3, '0') $$;
CREATE OR REPLACE FUNCTION next_order_code() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('order_code_seq')::text, 4, '0') $$;
CREATE OR REPLACE FUNCTION next_request_line_code() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'REQ-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('request_line_code_seq')::text, 5, '0') $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION prevent_excess_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ordered numeric; already_received numeric;
BEGIN
  SELECT quantity INTO ordered FROM request_lines WHERE id=NEW.request_line_id FOR UPDATE;
  SELECT COALESCE(sum(quantity_received),0) INTO already_received FROM deliveries WHERE request_line_id=NEW.request_line_id AND id<>NEW.id;
  IF already_received + NEW.quantity_received > ordered THEN
    RAISE EXCEPTION 'Delivered quantity cannot exceed ordered quantity';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_invoice_overpayment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_total numeric; already_paid numeric;
BEGIN
  SELECT amount INTO invoice_total FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO already_paid FROM payments WHERE invoice_id=NEW.invoice_id AND id<>NEW.id;
  IF already_paid + NEW.amount > invoice_total THEN
    RAISE EXCEPTION 'Payments cannot exceed invoice amount';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_excess_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_total numeric; invoice_direction text; line_total numeric; already_allocated numeric;
BEGIN
  SELECT amount,direction INTO invoice_total,invoice_direction FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
  SELECT quantity * CASE WHEN invoice_direction='CUSTOMER' THEN unit_sell_price ELSE unit_buy_price END
    INTO line_total FROM request_lines WHERE id=NEW.request_line_id;
  IF NEW.allocated_amount > line_total THEN
    RAISE EXCEPTION 'Invoice allocation cannot exceed the request line amount';
  END IF;
  SELECT COALESCE(sum(allocated_amount),0) INTO already_allocated FROM invoice_allocations
    WHERE invoice_id=NEW.invoice_id AND request_line_id<>NEW.request_line_id;
  IF already_allocated + NEW.allocated_amount > invoice_total THEN
    RAISE EXCEPTION 'Invoice allocations cannot exceed invoice amount';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE actor_text text; actor uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN actor := actor_text::uuid; END IF;
  INSERT INTO public.audit_logs(entity_type, record_id, action, old_values, new_values, actor_id, reason)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    actor, current_setting('axora.change_reason', true));
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','companies','branches','suppliers','products','requests','request_lines','quotations','deliveries','invoices'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at_%I ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER set_updated_at_%I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['users','companies','branches','suppliers','products','product_suppliers','requests','request_lines','quotations','approvals','deliveries','invoices','invoice_allocations','payments','attachments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_change()', table_name, table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS enforce_delivery_quantity ON deliveries;
CREATE TRIGGER enforce_delivery_quantity BEFORE INSERT OR UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION prevent_excess_delivery();
DROP TRIGGER IF EXISTS enforce_payment_total ON payments;
CREATE TRIGGER enforce_payment_total BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION prevent_invoice_overpayment();
DROP TRIGGER IF EXISTS enforce_invoice_allocation_total ON invoice_allocations;
CREATE TRIGGER enforce_invoice_allocation_total BEFORE INSERT OR UPDATE ON invoice_allocations FOR EACH ROW EXECUTE FUNCTION prevent_excess_allocation();

CREATE OR REPLACE VIEW v_request_line_financials AS
SELECT l.*, round(l.quantity * l.unit_buy_price, 2) AS buying_cost,
  round(l.quantity * l.unit_sell_price, 2) AS sales_amount,
  round(l.quantity * (l.unit_sell_price - l.unit_buy_price), 2) AS gross_profit,
  CASE WHEN l.quantity * l.unit_sell_price = 0 THEN 0 ELSE round(((l.unit_sell_price - l.unit_buy_price) / l.unit_sell_price) * 100, 2) END AS gross_margin_percent
FROM request_lines l;

CREATE OR REPLACE VIEW v_order_financials AS
SELECT r.id AS request_id, r.order_code, count(l.id) AS line_count,
  COALESCE(sum(l.buying_cost),0) AS buying_cost, COALESCE(sum(l.sales_amount),0) AS sales_amount,
  COALESCE(sum(l.gross_profit),0) AS gross_profit, COALESCE(sum(l.delivery_charge),0) AS delivery_charges,
  CASE WHEN COALESCE(sum(l.sales_amount),0)=0 THEN 0 ELSE round((sum(l.gross_profit)/sum(l.sales_amount))*100,2) END AS gross_margin_percent
FROM requests r LEFT JOIN v_request_line_financials l ON l.request_id=r.id GROUP BY r.id,r.order_code;

CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT i.*, COALESCE(sum(p.amount),0) AS paid_amount, greatest(i.amount-COALESCE(sum(p.amount),0),0) AS outstanding_amount,
  CASE WHEN i.status_id=lookup_id('invoice_status','Cancelled') THEN 'Void'
       WHEN COALESCE(sum(p.amount),0)>=i.amount THEN 'Paid'
       WHEN COALESCE(sum(p.amount),0)>0 THEN 'Partial'
       ELSE 'Unpaid' END AS payment_status
FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id GROUP BY i.id;

INSERT INTO roles(role_key,label,description) VALUES
  ('ADMIN','Admin / Supervisor','Full approved access and user administration'),
  ('OPERATIONS','Operations','Master data, requests, sourcing and delivery workflow'),
  ('FINANCE','Finance','Invoices, payments and financial reporting'),
  ('VIEWER','Viewer','Read-only operational and summary access'),
  ('IT_SUPPORT','IT support','Technical maintenance without unrestricted business approval')
ON CONFLICT(role_key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description;

INSERT INTO lookup_types(type_key,label,configurable) VALUES
  ('request_type','Request type',true),('urgency','Urgency',true),('request_status','Request status',true),
  ('delivery_status','Delivery status',true),('invoice_status','Invoice status',true),
  ('supplier_confirmation','Supplier confirmation',true),('quotation_status','Quotation status',true)
ON CONFLICT(type_key) DO NOTHING;

INSERT INTO lookup_values(type_key,value_key,label,sort_order) VALUES
  ('request_type','STANDARD','Standard',10),('request_type','AD_HOC','Ad-hoc',20),('request_type','RECURRING','Recurring',30),
  ('urgency','LOW','Low',10),('urgency','NORMAL','Normal',20),('urgency','HIGH','High',30),('urgency','URGENT','Urgent',40),
  ('request_status','NEW','New Request',10),('request_status','VERIFY','Under Verification',20),('request_status','QUOTE','Waiting for Quotation',30),
  ('request_status','APPROVAL','Waiting for Approval',40),('request_status','APPROVED','Approved',50),('request_status','SUPPLIER','Supplier Assigned',60),
  ('request_status','ORDERED','Ordered',70),('request_status','PREPARING','Preparing for Delivery',80),('request_status','OUT','Out for Delivery',90),
  ('request_status','DELIVERED','Delivered',100),('request_status','INVOICED','Invoice Issued',110),('request_status','COMPLETED','Completed',120),
  ('request_status','HOLD','On Hold',900),('request_status','CANCELLED','Cancelled',910),
  ('delivery_status','NONE','Not Scheduled',10),('delivery_status','SCHEDULED','Scheduled',20),('delivery_status','PREPARING','Preparing',30),
  ('delivery_status','OUT','Out for Delivery',40),('delivery_status','PARTIAL','Partially Delivered',50),('delivery_status','DELIVERED','Delivered',60),
  ('delivery_status','DELAYED','Delayed',70),('delivery_status','FAILED','Failed',80),('delivery_status','CANCELLED','Cancelled',90),
  ('invoice_status','NONE','Not Issued',10),('invoice_status','DRAFT','Draft',20),('invoice_status','ISSUED','Issued',30),
  ('invoice_status','DISPUTED','Disputed',40),('invoice_status','CANCELLED','Cancelled',50),
  ('supplier_confirmation','PENDING','Pending',10),('supplier_confirmation','REQUESTED','Quotation Requested',20),
  ('supplier_confirmation','RECEIVED','Quotation Received',30),('supplier_confirmation','CONFIRMED','Confirmed',40),('supplier_confirmation','DECLINED','Declined',50),
  ('quotation_status','DRAFT','Draft',10),('quotation_status','RECEIVED','Received',20),('quotation_status','SELECTED','Selected',30),
  ('quotation_status','REJECTED','Rejected',40),('quotation_status','EXPIRED','Expired',50)
ON CONFLICT(type_key,value_key) DO UPDATE SET label=EXCLUDED.label, sort_order=EXCLUDED.sort_order;

INSERT INTO request_status_transitions(from_status_id,to_status_id,reason_required)
SELECT lookup_id('request_status',a),lookup_id('request_status',b),reason_required FROM (VALUES
  ('New Request','Under Verification',false),('Under Verification','Waiting for Quotation',false),('Under Verification','Waiting for Approval',false),
  ('Waiting for Quotation','Waiting for Approval',false),('Waiting for Approval','Approved',false),('Approved','Supplier Assigned',false),
  ('Supplier Assigned','Ordered',false),('Ordered','Preparing for Delivery',false),('Preparing for Delivery','Out for Delivery',false),
  ('Out for Delivery','Delivered',false),('Delivered','Invoice Issued',false),('Invoice Issued','Completed',false),
  ('New Request','On Hold',true),('Under Verification','On Hold',true),('Waiting for Quotation','On Hold',true),('Waiting for Approval','On Hold',true),
  ('Approved','On Hold',true),('Supplier Assigned','On Hold',true),('Ordered','On Hold',true),('Preparing for Delivery','On Hold',true),('Out for Delivery','On Hold',true),
  ('On Hold','Under Verification',true),('On Hold','Cancelled',true),
  ('New Request','Cancelled',true),('Under Verification','Cancelled',true),('Waiting for Quotation','Cancelled',true),('Waiting for Approval','Cancelled',true),
  ('Approved','Cancelled',true),('Supplier Assigned','Cancelled',true),('Ordered','Cancelled',true)
) AS t(a,b,reason_required)
ON CONFLICT DO NOTHING;

-- The Docker initializer creates this login before the migration. Keeping the
-- grants conditional also lets the schema be checked safely in isolated test
-- databases where that server role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO axora_app', current_database());
    GRANT USAGE ON SCHEMA public TO axora_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO axora_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM axora_app;
    GRANT SELECT ON TABLE public.audit_logs TO axora_app;
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
      REVOKE INSERT, UPDATE, DELETE ON TABLE public.schema_migrations FROM axora_app;
      GRANT SELECT ON TABLE public.schema_migrations TO axora_app;
    END IF;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO axora_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO axora_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO axora_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO axora_app;
  END IF;
END $$;

COMMIT;
