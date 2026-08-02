BEGIN;

-- This feature was rejected after migration 013 had already become part of the
-- immutable migration history. Remove only its isolated objects. Historical
-- audit rows intentionally remain in audit_logs as operational evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    IF to_regclass('public.company_interaction_profiles') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.company_interaction_profiles FROM axora_app';
    END IF;
    IF to_regclass('public.interaction_revisions') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.interaction_revisions FROM axora_app';
    END IF;
    IF to_regclass('public.interaction_assets') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.interaction_assets FROM axora_app';
    END IF;
    IF to_regprocedure('public.audit_company_interaction_change()') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.audit_company_interaction_change() FROM axora_app';
    END IF;
    IF to_regprocedure('public.protect_interaction_revision()') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.protect_interaction_revision() FROM axora_app';
    END IF;
  END IF;
END $$;

-- Avoid CASCADE so an unexpected dependency stops the migration instead of
-- deleting an object outside this feature boundary.
DROP TABLE IF EXISTS interaction_revisions;
DROP TABLE IF EXISTS interaction_assets;
DROP TABLE IF EXISTS company_interaction_profiles;

DROP FUNCTION IF EXISTS protect_interaction_revision();
DROP FUNCTION IF EXISTS audit_company_interaction_change();

COMMIT;
