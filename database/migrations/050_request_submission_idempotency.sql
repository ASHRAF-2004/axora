BEGIN;

-- P0-03 session and refresh recovery: a browser retry, multi-tab submit, or
-- interrupted redirect must resolve to the same purchase request instead of
-- inserting a second request. The key is scoped to the authenticated creator.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS client_submission_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS requests_creator_submission_key_uq
  ON public.requests(created_by,client_submission_key)
  WHERE created_by IS NOT NULL AND client_submission_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.axora_protect_request_submission_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF OLD.client_submission_key IS DISTINCT FROM NEW.client_submission_key THEN
    RAISE EXCEPTION 'Request submission identity is immutable';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_protect_request_submission_identity()
FROM PUBLIC;

DROP TRIGGER IF EXISTS protect_request_submission_identity
  ON public.requests;
CREATE TRIGGER protect_request_submission_identity
BEFORE UPDATE OF client_submission_key
ON public.requests
FOR EACH ROW
EXECUTE FUNCTION public.axora_protect_request_submission_identity();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_protect_request_submission_identity()
    FROM axora_app;
  END IF;
END $$;

COMMIT;
