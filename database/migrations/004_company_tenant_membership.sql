BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS users_company_idx ON users(company_id);
CREATE INDEX IF NOT EXISTS suppliers_company_idx ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS products_company_idx ON products(company_id);
CREATE INDEX IF NOT EXISTS attachments_company_idx ON attachments(company_id);

DROP INDEX IF EXISTS suppliers_name_lower_uq;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_name_lower_uq ON suppliers(company_id, lower(name));

DROP INDEX IF EXISTS products_active_name_lower_uq;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_active_name_lower_uq
  ON products(company_id, lower(name)) WHERE active AND NOT needs_review;

UPDATE attachments a SET company_id = CASE
  WHEN a.entity_type = 'request' THEN (SELECT r.company_id FROM requests r WHERE r.id=a.record_id)
  WHEN a.entity_type = 'invoice' THEN (SELECT r.company_id FROM invoices i JOIN requests r ON r.id=i.request_id WHERE i.id=a.record_id)
  WHEN a.entity_type = 'delivery' THEN (SELECT r.company_id FROM deliveries d JOIN request_lines l ON l.id=d.request_line_id JOIN requests r ON r.id=l.request_id WHERE d.id=a.record_id)
END
WHERE a.company_id IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_owner_company_rule;
ALTER TABLE users ADD CONSTRAINT users_owner_company_rule
  CHECK ((is_owner AND company_id IS NULL) OR (NOT is_owner AND company_id IS NOT NULL));

COMMIT;
