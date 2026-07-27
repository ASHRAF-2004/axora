BEGIN;

-- Documents uploaded by Axora may contain supplier quotations, supplier
-- invoices, and other internal commercial evidence. Keep those records
-- separate from files intentionally shared with the customer company.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_visibility_check;
ALTER TABLE attachments
  ADD CONSTRAINT attachments_visibility_check
  CHECK (visibility IN ('CUSTOMER', 'INTERNAL'));

CREATE INDEX IF NOT EXISTS attachments_company_visibility_created_idx
  ON attachments(company_id, visibility, created_at DESC);

COMMIT;
