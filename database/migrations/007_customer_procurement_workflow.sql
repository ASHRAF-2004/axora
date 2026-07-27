BEGIN;

-- Customer-side procurement roles. Platform owners remain ADMIN users with
-- is_owner=true; company ADMIN users remain company-wide administrators.
INSERT INTO roles(role_key, label, description) VALUES
  ('REQUESTER', 'Requester', 'Creates purchase requests for an assigned branch'),
  ('APPROVER', 'Branch approver', 'Reviews and approves requests for an assigned branch'),
  ('BRANCH_ADMIN', 'Branch administrator', 'Manages people, requests, approvals and budget visibility for one branch')
ON CONFLICT(role_key) DO UPDATE
SET label=EXCLUDED.label, description=EXCLUDED.description;

UPDATE roles SET
  label='Administrator',
  description='Platform owner when protected, otherwise company-wide customer administrator'
WHERE role_key='ADMIN';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id uuid;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_branch_company_fk;
ALTER TABLE users
  ADD CONSTRAINT users_branch_company_fk
  FOREIGN KEY(branch_id, company_id) REFERENCES branches(id, company_id);

CREATE INDEX IF NOT EXISTS users_branch_idx ON users(branch_id);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS monthly_budget numeric(14,2)
    CHECK (monthly_budget IS NULL OR monthly_budget >= 0),
  ADD COLUMN IF NOT EXISTS budget_updated_at timestamptz;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_file_name text,
  ADD COLUMN IF NOT EXISTS image_content_type text,
  ADD COLUMN IF NOT EXISTS image_content bytea,
  ADD COLUMN IF NOT EXISTS image_alt_text text;

-- New Axora catalog records and suppliers are global. Legacy tenant-linked
-- records remain readable during migration, while global names stay unique.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_global_name_lower_uq
  ON suppliers(lower(name)) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_global_active_name_lower_uq
  ON products(lower(name)) WHERE company_id IS NULL AND active AND NOT needs_review;

-- The company approval above is the single budget authorization. Once Axora
-- starts sourcing, the active route goes directly from quotation to supplier
-- assignment. Keep the legacy status values and their outbound transitions so
-- requests already stored there can still be completed.
DELETE FROM request_status_transitions transition
USING lookup_values source, lookup_values target
WHERE transition.from_status_id=source.id
  AND transition.to_status_id=target.id
  AND (
    (source.label='Under Verification' AND target.label='Waiting for Approval')
    OR
    (source.label='Waiting for Quotation' AND target.label='Waiting for Approval')
  );

INSERT INTO request_status_transitions(from_status_id,to_status_id,reason_required)
VALUES (
  lookup_id('request_status','Waiting for Quotation'),
  lookup_id('request_status','Supplier Assigned'),
  false
)
ON CONFLICT(from_status_id,to_status_id)
DO UPDATE SET reason_required=EXCLUDED.reason_required;

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
           AND a.decided_at >= date_trunc('month', CURRENT_DATE)
           AND a.decided_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
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
               AND a.decided_at >= date_trunc('month', CURRENT_DATE)
               AND a.decided_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
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
  SELECT sum(l.quantity * l.unit_sell_price)::numeric(14,2) AS total
  FROM request_lines l
  WHERE l.request_id=r.id
) lines ON true
GROUP BY b.id;

-- Keep large product image bytes and secrets out of the tenant audit trail.
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
    - 'file_content' - 'image_content' - 'password_hash';

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
  VALUES (
    TG_TABLE_NAME,
    linked_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE')
      THEN to_jsonb(OLD) - 'file_content' - 'image_content' - 'password_hash'
      ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE')
      THEN to_jsonb(NEW) - 'file_content' - 'image_content' - 'password_hash'
      ELSE NULL END,
    actor,
    affected_company,
    current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

COMMIT;
