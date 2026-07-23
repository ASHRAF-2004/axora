BEGIN;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS file_content bytea;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS audit_logs_company_occurred_idx
  ON audit_logs(company_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_text text;
  actor uuid;
  row_data jsonb;
  affected_company uuid;
  linked_id uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN actor := actor_text::uuid; END IF;
  row_data := (CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END)
    - 'file_content' - 'password_hash';

  CASE TG_TABLE_NAME
    WHEN 'companies' THEN affected_company := (row_data->>'id')::uuid;
    WHEN 'users', 'branches', 'suppliers', 'products', 'requests', 'attachments'
      THEN affected_company := NULLIF(row_data->>'company_id', '')::uuid;
    WHEN 'request_lines' THEN
      SELECT company_id INTO affected_company FROM public.requests WHERE id=(row_data->>'request_id')::uuid;
    WHEN 'product_suppliers' THEN
      SELECT company_id INTO affected_company FROM public.products WHERE id=(row_data->>'product_id')::uuid;
    WHEN 'quotations' THEN
      SELECT r.company_id INTO affected_company FROM public.request_lines l JOIN public.requests r ON r.id=l.request_id
      WHERE l.id=(row_data->>'request_line_id')::uuid;
    WHEN 'approvals' THEN
      SELECT company_id INTO affected_company FROM public.requests WHERE id=(row_data->>'request_id')::uuid;
    WHEN 'deliveries' THEN
      SELECT r.company_id INTO affected_company FROM public.request_lines l JOIN public.requests r ON r.id=l.request_id
      WHERE l.id=(row_data->>'request_line_id')::uuid;
    WHEN 'invoices' THEN
      SELECT company_id INTO affected_company FROM public.requests WHERE id=(row_data->>'request_id')::uuid;
    WHEN 'invoice_allocations' THEN
      SELECT r.company_id INTO affected_company FROM public.request_lines l JOIN public.requests r ON r.id=l.request_id
      WHERE l.id=(row_data->>'request_line_id')::uuid;
    WHEN 'payments' THEN
      SELECT r.company_id INTO affected_company FROM public.invoices i JOIN public.requests r ON r.id=i.request_id
      WHERE i.id=(row_data->>'invoice_id')::uuid;
    ELSE affected_company := NULL;
  END CASE;

  linked_id := NULLIF(row_data->>'id', '')::uuid;
  INSERT INTO public.audit_logs(entity_type, record_id, action, old_values, new_values, actor_id, company_id, reason)
  VALUES (TG_TABLE_NAME, linked_id, TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'file_content' - 'password_hash' ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'file_content' - 'password_hash' ELSE NULL END,
    actor, affected_company, current_setting('axora.change_reason', true));
  RETURN COALESCE(NEW, OLD);
END $$;

UPDATE audit_logs a
SET company_id=u.company_id
FROM users u
WHERE a.company_id IS NULL AND a.actor_id=u.id AND u.company_id IS NOT NULL;

UPDATE audit_logs
SET old_values=old_values - 'password_hash' - 'file_content',
    new_values=new_values - 'password_hash' - 'file_content'
WHERE old_values ?| ARRAY['password_hash','file_content']
   OR new_values ?| ARRAY['password_hash','file_content'];

UPDATE audit_logs SET company_id=record_id
WHERE company_id IS NULL AND entity_type='companies'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.id=audit_logs.record_id);
UPDATE audit_logs a SET company_id=b.company_id FROM branches b
WHERE a.company_id IS NULL AND a.entity_type='branches' AND a.record_id=b.id;
UPDATE audit_logs a SET company_id=s.company_id FROM suppliers s
WHERE a.company_id IS NULL AND a.entity_type='suppliers' AND a.record_id=s.id;
UPDATE audit_logs a SET company_id=p.company_id FROM products p
WHERE a.company_id IS NULL AND a.entity_type='products' AND a.record_id=p.id;
UPDATE audit_logs a SET company_id=r.company_id FROM requests r
WHERE a.company_id IS NULL AND a.entity_type='requests' AND a.record_id=r.id;
UPDATE audit_logs a SET company_id=x.company_id FROM (
  SELECT l.id,r.company_id FROM request_lines l JOIN requests r ON r.id=l.request_id
) x WHERE a.company_id IS NULL AND a.entity_type='request_lines' AND a.record_id=x.id;
UPDATE audit_logs a SET company_id=x.company_id FROM (
  SELECT q.id,r.company_id FROM quotations q JOIN request_lines l ON l.id=q.request_line_id JOIN requests r ON r.id=l.request_id
) x WHERE a.company_id IS NULL AND a.entity_type='quotations' AND a.record_id=x.id;
UPDATE audit_logs a SET company_id=x.company_id FROM (
  SELECT i.id,r.company_id FROM invoices i JOIN requests r ON r.id=i.request_id
) x WHERE a.company_id IS NULL AND a.entity_type='invoices' AND a.record_id=x.id;
UPDATE audit_logs a SET company_id=att.company_id FROM attachments att
WHERE a.company_id IS NULL AND a.entity_type='attachments' AND a.record_id=att.id;

COMMIT;
