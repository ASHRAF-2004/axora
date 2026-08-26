BEGIN;

SELECT pg_advisory_xact_lock(12120260826);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

CREATE OR REPLACE FUNCTION public.axora_enforce_profile_phone_e164()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  NEW.phone:=btrim(COALESCE(NEW.phone,''));
  IF NEW.phone<>'' AND NEW.phone !~ '^[+][1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone number must use canonical E.164 format' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.axora_enforce_branch_phone_e164()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.contact_phone IS NOT DISTINCT FROM OLD.contact_phone THEN
    RETURN NEW;
  END IF;
  NEW.contact_phone:=btrim(COALESCE(NEW.contact_phone,''));
  IF NEW.contact_phone<>'' AND NEW.contact_phone !~ '^[+][1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone number must use canonical E.164 format' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_profiles_phone_e164 ON public.user_profiles;
CREATE TRIGGER user_profiles_phone_e164
BEFORE INSERT OR UPDATE OF phone ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.axora_enforce_profile_phone_e164();

DROP TRIGGER IF EXISTS branches_contact_phone_e164 ON public.branches;
CREATE TRIGGER branches_contact_phone_e164
BEFORE INSERT OR UPDATE OF contact_phone ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.axora_enforce_branch_phone_e164();

COMMENT ON FUNCTION public.axora_enforce_profile_phone_e164() IS
  'Rejects changed nonempty profile phone values that are not canonical E.164; preserves untouched legacy rows.';
COMMENT ON FUNCTION public.axora_enforce_branch_phone_e164() IS
  'Rejects changed nonempty branch phone values that are not canonical E.164; preserves untouched legacy rows.';

REVOKE ALL ON FUNCTION public.axora_enforce_profile_phone_e164() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_enforce_branch_phone_e164() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.axora_enforce_profile_phone_e164() FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_enforce_branch_phone_e164() FROM axora_app;
  END IF;
END $$;

COMMIT;
