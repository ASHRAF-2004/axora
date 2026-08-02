BEGIN;

-- Delivery attempts, partial handovers and operational issues are immutable
-- driver evidence.  They never create or modify the independently confirmed
-- customer receipt introduced by migration 019.
ALTER TABLE delivery_job_events
  DROP CONSTRAINT IF EXISTS delivery_job_events_event_type_check;
ALTER TABLE delivery_job_events
  ADD CONSTRAINT delivery_job_events_event_type_check CHECK (event_type IN (
    'ACCEPTED','REJECTED','EN_ROUTE','ARRIVED','DELIVERY_ATTEMPTED',
    'PARTIALLY_DELIVERED','DELIVERED','FAILED','ISSUE_REPORTED','NOTE_ADDED'
  ));

CREATE OR REPLACE FUNCTION axora_delivery_event_metadata_is_valid(
  p_event_type text,
  p_metadata jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  outcome jsonb;
  line_id text;
  seen_line_ids text[] := ARRAY[]::text[];
  delivered numeric;
  damaged numeric;
  missing numeric;
  has_receiver boolean;
  has_outcomes boolean;
  has_issue boolean;
  has_note boolean;
BEGIN
  -- Every pre-029 metadata object was valid under the existing
  -- workflow_metadata_is_safe constraint. Preserve those rows exactly; apply
  -- this narrower contract when a new event type or new structured evidence
  -- field is used.
  IF p_event_type IN (
    'ACCEPTED','REJECTED','EN_ROUTE','ARRIVED','DELIVERED','FAILED','NOTE_ADDED'
  ) AND NOT p_metadata ?| ARRAY['issueCode','receiverName','lineOutcomes'] THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(p_metadata)<>'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_metadata) key
    WHERE key NOT IN ('note','issueCode','receiverName','lineOutcomes')
  ) THEN
    RETURN false;
  END IF;

  has_note := p_metadata ? 'note';
  has_issue := p_metadata ? 'issueCode';
  has_receiver := p_metadata ? 'receiverName';
  has_outcomes := p_metadata ? 'lineOutcomes';

  IF has_note AND (
    jsonb_typeof(p_metadata->'note')<>'string'
    OR char_length(btrim(p_metadata->>'note')) NOT BETWEEN 1 AND 1000
  ) THEN
    RETURN false;
  END IF;
  IF has_issue AND (
    jsonb_typeof(p_metadata->'issueCode')<>'string'
    OR p_metadata->>'issueCode' NOT IN (
      'CUSTOMER_UNAVAILABLE','ACCESS_BLOCKED','ADDRESS_PROBLEM','DAMAGED_ITEMS',
      'MISSING_ITEMS','VEHICLE_PROBLEM','SAFETY_CONCERN','OTHER'
    )
  ) THEN
    RETURN false;
  END IF;
  IF has_receiver AND (
    jsonb_typeof(p_metadata->'receiverName')<>'string'
    OR char_length(btrim(p_metadata->>'receiverName')) NOT BETWEEN 2 AND 200
  ) THEN
    RETURN false;
  END IF;

  IF has_outcomes THEN
    IF jsonb_typeof(p_metadata->'lineOutcomes')<>'array'
      OR jsonb_array_length(p_metadata->'lineOutcomes') NOT BETWEEN 1 AND 100 THEN
      RETURN false;
    END IF;
    FOR outcome IN SELECT value FROM jsonb_array_elements(p_metadata->'lineOutcomes') LOOP
      IF jsonb_typeof(outcome)<>'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(outcome) key
          WHERE key NOT IN (
            'deliveryJobLineId','deliveredQuantity','damagedQuantity','missingQuantity'
          )
        )
        OR NOT outcome ?& ARRAY[
          'deliveryJobLineId','deliveredQuantity','damagedQuantity','missingQuantity'
        ]
        OR jsonb_typeof(outcome->'deliveryJobLineId')<>'string'
        OR jsonb_typeof(outcome->'deliveredQuantity')<>'number'
        OR jsonb_typeof(outcome->'damagedQuantity')<>'number'
        OR jsonb_typeof(outcome->'missingQuantity')<>'number' THEN
        RETURN false;
      END IF;
      line_id := outcome->>'deliveryJobLineId';
      IF line_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR line_id=ANY(seen_line_ids) THEN
        RETURN false;
      END IF;
      seen_line_ids := array_append(seen_line_ids,line_id);
      delivered := (outcome->>'deliveredQuantity')::numeric;
      damaged := (outcome->>'damagedQuantity')::numeric;
      missing := (outcome->>'missingQuantity')::numeric;
      IF delivered<0 OR damaged<0 OR missing<0
        OR delivered>1000000000 OR damaged>1000000000 OR missing>1000000000
        OR damaged>delivered THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF p_event_type IN ('DELIVERY_ATTEMPTED','ISSUE_REPORTED') AND NOT has_issue THEN
    RETURN false;
  END IF;
  IF p_event_type='ISSUE_REPORTED' AND (
    NOT has_note OR char_length(btrim(p_metadata->>'note'))<3
  ) THEN
    RETURN false;
  END IF;
  IF p_event_type NOT IN ('DELIVERY_ATTEMPTED','ISSUE_REPORTED','FAILED') AND has_issue THEN
    RETURN false;
  END IF;
  IF p_event_type NOT IN ('PARTIALLY_DELIVERED','DELIVERED')
    AND (has_receiver OR has_outcomes) THEN
    RETURN false;
  END IF;
  IF p_event_type='PARTIALLY_DELIVERED' AND (NOT has_receiver OR NOT has_outcomes) THEN
    RETURN false;
  END IF;
  IF p_event_type='DELIVERED' AND has_receiver<>has_outcomes THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION axora_delivery_event_metadata_is_valid(text,jsonb)
  FROM PUBLIC;

ALTER TABLE delivery_job_events
  DROP CONSTRAINT IF EXISTS delivery_job_events_metadata_contract_check;
ALTER TABLE delivery_job_events
  ADD CONSTRAINT delivery_job_events_metadata_contract_check
  CHECK (axora_delivery_event_metadata_is_valid(event_type,metadata))
  NOT VALID;
ALTER TABLE delivery_job_events
  VALIDATE CONSTRAINT delivery_job_events_metadata_contract_check;

-- A customer receipt is still a separate authenticated act, but it may only
-- be created after delivery evidence from the current/completed assignment.
-- Historical events accepted after reassignment remain auditable and cannot
-- silently make a job receivable.
CREATE OR REPLACE FUNCTION validate_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_branch_id uuid;
BEGIN
  SELECT branch_id
  INTO job_branch_id
  FROM delivery_jobs
  WHERE id=NEW.delivery_job_id AND company_id=NEW.company_id;

  IF job_branch_id IS NULL OR job_branch_id<>NEW.branch_id THEN
    RAISE EXCEPTION 'Receipt branch must match the delivery job branch';
  END IF;
  IF NOT axora_user_can_receive(
    NEW.confirmed_by_user_id,NEW.company_id,NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Receipt confirmation requires an assigned customer receiving user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM delivery_job_assignments assignment
    WHERE assignment.delivery_job_id=NEW.delivery_job_id
      AND assignment.driver_user_id=NEW.confirmed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Driver evidence cannot serve as customer receipt confirmation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM delivery_job_events event
    JOIN delivery_job_assignments assignment
      ON assignment.id=event.assignment_id
     AND assignment.delivery_job_id=event.delivery_job_id
     AND assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
    WHERE event.delivery_job_id=NEW.delivery_job_id
      AND event.company_id=NEW.company_id
      AND event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Customer receipt requires current assignment delivery evidence';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      axora_delivery_event_metadata_is_valid(text,jsonb)
    TO axora_app;
  END IF;
END $$;

COMMIT;
