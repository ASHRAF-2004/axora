BEGIN;

-- Existing attachments predate explicit audience controls. Fail closed:
-- owners can deliberately share a file later through the application.
UPDATE attachments SET visibility='INTERNAL';
ALTER TABLE attachments ALTER COLUMN visibility SET DEFAULT 'INTERNAL';

-- A hold without a stored previous status can only safely pause verification.
-- Prevent pending requests from bypassing company approval and later workflow
-- stages from jumping backwards through the generic hold-resume route.
DELETE FROM request_status_transitions transition
USING lookup_values source, lookup_values target
WHERE transition.from_status_id=source.id
  AND transition.to_status_id=target.id
  AND target.label='On Hold'
  AND source.label<>'Under Verification';

-- Budget periods follow Malaysia civil time even when PostgreSQL runs in UTC.
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
           AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
             >= date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
           AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
             < date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 month'
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
               AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
                 >= date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
               AND (a.decided_at AT TIME ZONE 'Asia/Kuala_Lumpur')
                 < date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 month'
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

COMMIT;
