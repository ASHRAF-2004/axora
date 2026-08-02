BEGIN;

-- Session rows contain credential-adjacent hashes and device/network
-- summaries. Audit only the irreversible revocation transition and construct
-- a fixed, privacy-minimized record inside PostgreSQL; never serialize either
-- OLD or NEW user_sessions rows.
CREATE OR REPLACE FUNCTION audit_user_session_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor_text text;
  actor_id uuid;
  affected_company uuid;
  change_reason text;
BEGIN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RETURN NEW;
  END IF;

  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text<>'' THEN
    IF actor_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Session revocation actor context is invalid';
    END IF;
    actor_id := actor_text::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.users actor WHERE actor.id=actor_id
    ) THEN
      RAISE EXCEPTION 'Session revocation actor context is invalid';
    END IF;
  ELSE
    actor_id := NEW.revoked_by;
  END IF;

  change_reason := NULLIF(btrim(current_setting('axora.change_reason',true)), '');
  IF change_reason IS NULL
    OR change_reason ~ '[[:cntrl:]]'
    OR char_length(change_reason)>240 THEN
    change_reason := CASE NEW.revoke_reason
      WHEN 'password_changed' THEN 'Changed own password and rotated sessions'
      WHEN 'revoked_by_account_owner' THEN 'Account owner revoked session'
      WHEN 'revoked_by_technical_support' THEN 'Technical support session revocation'
      WHEN 'User signed out' THEN 'User signed out'
      ELSE 'Session revoked'
    END;
  END IF;

  SELECT account.company_id INTO affected_company
  FROM public.users account
  WHERE account.id=NEW.user_id;

  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,
    actor_id,company_id,reason
  ) VALUES (
    'user_sessions',NEW.id,'UPDATE',NULL,
    jsonb_build_object('revoked',true),
    actor_id,affected_company,change_reason
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_user_session_revocations ON user_sessions;
CREATE TRIGGER audit_user_session_revocations
AFTER UPDATE OF revoked_at ON user_sessions
FOR EACH ROW
WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION audit_user_session_revocation();

-- Trigger execution does not require the mutating application role to execute
-- the function directly. Keep that capability with the trigger owner only.
REVOKE ALL ON FUNCTION audit_user_session_revocation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION audit_user_session_revocation() FROM axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback: retain the trigger and its privacy-minimized evidence during an
-- application rollback. Remove it only in a reviewed forward migration after
-- every session-revocation path has an equivalent append-only audit boundary.
