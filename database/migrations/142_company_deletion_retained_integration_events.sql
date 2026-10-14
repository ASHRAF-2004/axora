BEGIN;

-- Migration 129 correctly classified these detached, immutable snapshots as
-- retained evidence, but also appended them to the hard-delete DAG. Keep the
-- immutable trigger and bounded retention capability unchanged; the company
-- deletion capability must never try to remove the retained event rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.company_deletion_ownership_rules
    WHERE table_name='integration_events'
      AND unprotected_action='RETAIN_WITH_ACCESS_REVOKED'
      AND protected_action='RETAIN_WITH_ACCESS_REVOKED'
  ) THEN
    RAISE EXCEPTION 'Integration event retention classification is unavailable';
  END IF;
END
$$;

DELETE FROM public.company_deletion_ownership_dag
WHERE table_name='integration_events';

COMMIT;
