BEGIN;

-- Existing requests predate the append-only workflow ledger. Backfill a
-- minimal, truthful baseline without inventing actor identities or details.
WITH candidates AS (
  SELECT request.company_id,request.branch_id,request.id AS request_id,
    request.created_at AS occurred_at,'request.submitted'::text AS event_key,
    'baseline:request:' || request.id::text AS idempotency_key,
    jsonb_build_object('source','SYSTEM','newState','Submitted') AS metadata
  FROM requests request
  UNION ALL
  SELECT request.company_id,request.branch_id,request.id,
    approval.created_at,
    CASE approval.status WHEN 'Approved' THEN 'request.approved' ELSE 'request.rejected' END,
    'baseline:approval:' || approval.id::text,
    jsonb_build_object('source','SYSTEM','newState',approval.status)
  FROM approvals approval JOIN requests request ON request.id=approval.request_id
  WHERE approval.status IN ('Approved','Rejected')
), missing AS (
  SELECT candidate.*
  FROM candidates candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM workflow_events existing
    WHERE existing.company_id=candidate.company_id
      AND existing.idempotency_key=candidate.idempotency_key
  )
), ordered AS (
  SELECT missing.*,
    (
      COALESCE((
        SELECT max(existing.event_version)
        FROM workflow_events existing
        WHERE existing.company_id=missing.company_id
          AND existing.aggregate_type='request'
          AND existing.aggregate_id=missing.request_id
      ),0)
      + row_number() OVER (
      PARTITION BY company_id,request_id
      ORDER BY occurred_at,event_key,idempotency_key
      )
    )::int AS event_version
  FROM missing
)
INSERT INTO workflow_events(
  company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
  event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
  occurred_at,metadata
)
SELECT company_id,branch_id,request_id,'request',request_id,event_key,
  event_version,NULL,'SYSTEM',request_id,idempotency_key,occurred_at,metadata
FROM ordered
ON CONFLICT DO NOTHING;

ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_events_select_scope ON workflow_events;
CREATE POLICY workflow_events_select_scope ON workflow_events FOR SELECT
  USING (
    axora_context_is_platform()
    OR actor_user_id=axora_context_user_id()
    OR EXISTS (
      SELECT 1
      FROM role_assignments assignment
      JOIN company_memberships membership
        ON membership.user_id=assignment.user_id
       AND membership.company_id=workflow_events.company_id
       AND membership.status='ACTIVE'
      WHERE assignment.user_id=axora_context_user_id()
        AND assignment.active AND assignment.revoked_at IS NULL
        AND assignment.company_id=workflow_events.company_id
        AND (
          assignment.scope_type='COMPANY'
          OR (assignment.scope_type='BRANCH'
            AND assignment.branch_id=workflow_events.branch_id)
        )
    )
    OR (
      workflow_events.aggregate_type='supplier-rfq'
      AND EXISTS (
        SELECT 1
        FROM supplier_rfqs rfq
        WHERE rfq.id=workflow_events.aggregate_id
          AND rfq.company_id=workflow_events.company_id
          AND axora_context_has_supplier_access(rfq.supplier_id)
      )
    )
    OR (
      workflow_events.aggregate_type='delivery-job'
      AND EXISTS (
        SELECT 1
        FROM delivery_job_assignments assignment
        WHERE assignment.delivery_job_id=workflow_events.aggregate_id
          AND assignment.company_id=workflow_events.company_id
          AND assignment.driver_user_id=axora_context_user_id()
          AND assignment.status IN ('ASSIGNED','ACCEPTED')
      )
    )
  );

DROP POLICY IF EXISTS workflow_events_insert_scope ON workflow_events;
CREATE POLICY workflow_events_insert_scope ON workflow_events FOR INSERT
  WITH CHECK (
    axora_context_is_platform()
    OR (
      actor_user_id=axora_context_user_id()
      AND (
        (
          actor_kind='COMPANY'
          AND EXISTS (
            SELECT 1
            FROM role_assignments assignment
            JOIN company_memberships membership
              ON membership.user_id=assignment.user_id
             AND membership.company_id=workflow_events.company_id
             AND membership.status='ACTIVE'
            WHERE assignment.user_id=axora_context_user_id()
              AND assignment.active AND assignment.revoked_at IS NULL
              AND assignment.company_id=workflow_events.company_id
              AND (
                assignment.scope_type='COMPANY'
                OR (assignment.scope_type='BRANCH'
                  AND assignment.branch_id=workflow_events.branch_id)
              )
          )
        )
        OR (
          actor_kind='SUPPLIER'
          AND aggregate_type='supplier-rfq'
          AND EXISTS (
            SELECT 1
            FROM supplier_rfqs rfq
            JOIN request_lines line ON line.id=rfq.request_line_id
            JOIN requests request ON request.id=line.request_id
            WHERE rfq.id=workflow_events.aggregate_id
              AND rfq.company_id=workflow_events.company_id
              AND request.company_id=workflow_events.company_id
              AND request.id=workflow_events.request_id
              AND request.branch_id=workflow_events.branch_id
              AND axora_context_has_supplier_access(rfq.supplier_id)
          )
        )
        OR (
          actor_kind='DELIVERY'
          AND aggregate_type='delivery-job'
          AND EXISTS (
            SELECT 1
            FROM delivery_job_assignments assignment
            JOIN delivery_jobs job
              ON job.id=assignment.delivery_job_id
             AND job.company_id=assignment.company_id
            WHERE assignment.delivery_job_id=workflow_events.aggregate_id
              AND assignment.company_id=workflow_events.company_id
              AND assignment.driver_user_id=axora_context_user_id()
              AND assignment.status IN ('ASSIGNED','ACCEPTED')
              AND job.request_id=workflow_events.request_id
              AND job.branch_id=workflow_events.branch_id
          )
        )
      )
    )
  );

COMMIT;
