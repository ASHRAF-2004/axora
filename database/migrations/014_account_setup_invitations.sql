BEGIN;

-- Existing accounts already have usable credentials. New invited accounts use
-- a valid bcrypt sentinel while account_setup_completed_at remains NULL. This
-- keeps password_hash compatible with an application-only rollback: an older
-- bcrypt comparison safely returns false instead of receiving NULL.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_setup_completed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;

UPDATE users
SET account_setup_completed_at=COALESCE(last_login_at, created_at, now())
WHERE account_setup_completed_at IS NULL AND password_hash IS NOT NULL
  AND password_hash <> '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By';

UPDATE users
SET password_hash='$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By'
WHERE account_setup_completed_at IS NULL AND password_hash IS NULL;

ALTER TABLE users
  ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_credential_state_check;
ALTER TABLE users
  ADD CONSTRAINT users_credential_state_check CHECK (
    (account_setup_completed_at IS NULL AND password_hash =
      '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By')
    OR
    (account_setup_completed_at IS NOT NULL AND password_hash <>
      '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By')
  );

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_auth_version_check;
ALTER TABLE users
  ADD CONSTRAINT users_auth_version_check CHECK (auth_version > 0);

-- Password verifiers are credentials, not audit content. Existing versions of
-- the generic audit trigger copied password_hash into audit_logs. Remove those
-- historical copies and keep future user history useful without retaining a
-- second credential store.
UPDATE audit_logs
SET old_values=CASE WHEN old_values IS NULL THEN NULL ELSE old_values-'password_hash' END,
    new_values=CASE WHEN new_values IS NULL THEN NULL ELSE new_values-'password_hash' END
WHERE entity_type='users'
  AND (COALESCE(old_values,'{}'::jsonb) ? 'password_hash'
    OR COALESCE(new_values,'{}'::jsonb) ? 'password_hash');

CREATE OR REPLACE FUNCTION audit_user_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_text text;
  actor uuid;
  affected_company uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN
    actor := actor_text::uuid;
  END IF;
  affected_company := COALESCE(NEW.company_id, OLD.company_id);
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,
    actor_id,company_id,reason
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id,OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE')
      THEN to_jsonb(OLD)-'password_hash' ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE')
      THEN to_jsonb(NEW)-'password_hash' ELSE NULL END,
    actor,
    affected_company,
    current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS audit_users ON users;
CREATE TRIGGER audit_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_user_change();

-- This composite key binds every invitation to the same tenant as its user.
-- Platform owners have no company and are never invited through this flow.
CREATE UNIQUE INDEX IF NOT EXISTS users_id_company_uq
  ON users(id, company_id);

CREATE TABLE IF NOT EXISTS account_setup_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,

  -- Only the high-entropy bearer token hash is persisted. The raw token is
  -- passed once to the private sender and is never recoverable from the DB.
  email_locale text NOT NULL DEFAULT 'en' CHECK (email_locale IN ('en','ar')),

  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (
    delivery_status IN (
      'PENDING','SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    )
  ),
  delivery_attempt_count integer NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count BETWEEN 0 AND 1),
  delivery_attempted_at timestamptz,
  sent_at timestamptz,
  provider_message_id text CHECK (
    provider_message_id IS NULL
    OR (char_length(provider_message_id) BETWEEN 1 AND 255
      AND position(chr(10) IN provider_message_id)=0
      AND position(chr(13) IN provider_message_id)=0)
  ),
  last_delivery_error text CHECK (
    last_delivery_error IS NULL OR last_delivery_error ~ '^[a-z0-9_]{1,64}$'
  ),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(user_id, company_id)
    REFERENCES users(id, company_id) ON DELETE CASCADE,

  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '7 days'),
  CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (delivery_status='PENDING'
      AND delivery_attempt_count=0 AND delivery_attempted_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR
    (delivery_status='SENDING'
      AND delivery_attempt_count=1 AND delivery_attempted_at IS NOT NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR
    (delivery_status='SENT'
      AND delivery_attempt_count=1 AND delivery_attempted_at IS NOT NULL
      AND sent_at IS NOT NULL)
    OR
    (delivery_status IN ('FAILED','DISABLED','UNCERTAIN')
      AND delivery_attempt_count=1 AND delivery_attempted_at IS NOT NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR
    (delivery_status='CANCELLED'
      AND sent_at IS NULL AND provider_message_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS account_setup_one_live_invitation_uq
  ON account_setup_invitations(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_setup_invitation_user_created_idx
  ON account_setup_invitations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_setup_invitation_company_created_idx
  ON account_setup_invitations(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_setup_invitation_creator_created_idx
  ON account_setup_invitations(created_by, created_at DESC)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_setup_invitation_expiry_idx
  ON account_setup_invitations(expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
-- Invitation identity is immutable. A token receives at most one synchronous
-- delivery attempt; retry means revoking it and issuing a fresh invitation.
CREATE OR REPLACE FUNCTION protect_account_setup_invitation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.email_locale IS DISTINCT FROM OLD.email_locale THEN
    RAISE EXCEPTION 'Account setup invitation identity is immutable';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by
    AND NEW.created_by IS NOT NULL THEN
    RAISE EXCEPTION 'Account setup invitation authorship is immutable';
  END IF;
  IF OLD.consumed_at IS NOT NULL
    AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'A consumed account setup invitation cannot be changed';
  END IF;
  IF OLD.revoked_at IS NOT NULL
    AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'A revoked account setup invitation cannot be changed';
  END IF;

  IF NEW.delivery_attempt_count < OLD.delivery_attempt_count THEN
    RAISE EXCEPTION 'Account setup delivery attempts cannot decrease';
  END IF;
  IF OLD.delivery_status NOT IN ('PENDING','SENDING')
    AND (
      NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
      OR NEW.delivery_attempt_count IS DISTINCT FROM OLD.delivery_attempt_count
      OR NEW.delivery_attempted_at IS DISTINCT FROM OLD.delivery_attempted_at
      OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
      OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
      OR NEW.last_delivery_error IS DISTINCT FROM OLD.last_delivery_error
    ) THEN
    RAISE EXCEPTION 'Account setup delivery metadata is final';
  END IF;

  IF (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
    OR (NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL) THEN
    IF OLD.delivery_status IN ('PENDING','SENDING') THEN
      NEW.delivery_status := 'CANCELLED';
      NEW.sent_at := NULL;
      NEW.provider_message_id := NULL;
    END IF;
  END IF;

  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.delivery_status='PENDING'
      AND NEW.delivery_status NOT IN ('SENDING','DISABLED','CANCELLED') THEN
      RAISE EXCEPTION 'Invalid account setup delivery transition';
    ELSIF OLD.delivery_status='SENDING'
      AND NEW.delivery_status NOT IN (
        'SENT','FAILED','UNCERTAIN','CANCELLED'
      ) THEN
      RAISE EXCEPTION 'Invalid account setup delivery transition';
    ELSIF OLD.delivery_status NOT IN ('PENDING','SENDING') THEN
      RAISE EXCEPTION 'Account setup delivery status is final';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Keep bearer digests, provider identifiers, and provider error details out
-- of audit history.
CREATE OR REPLACE FUNCTION audit_account_setup_invitation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_text text;
  actor uuid;
  row_data jsonb;
  affected_company uuid;
  linked_id uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN
    actor := actor_text::uuid;
  END IF;

  row_data := (CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END)
    - 'token_hash' - 'provider_message_id' - 'last_delivery_error';
  affected_company := NULLIF(row_data->>'company_id', '')::uuid;
  linked_id := NULLIF(row_data->>'id', '')::uuid;

  INSERT INTO public.audit_logs(
    entity_type, record_id, action, old_values, new_values,
    actor_id, company_id, reason
  ) VALUES (
    TG_TABLE_NAME,
    linked_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE')
      THEN to_jsonb(OLD) - 'token_hash' - 'provider_message_id'
        - 'last_delivery_error'
      ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE')
      THEN to_jsonb(NEW) - 'token_hash' - 'provider_message_id'
        - 'last_delivery_error'
      ELSE NULL END,
    actor,
    affected_company,
    current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS protect_account_setup_invitations
  ON account_setup_invitations;
CREATE TRIGGER protect_account_setup_invitations
BEFORE UPDATE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION protect_account_setup_invitation();

DROP TRIGGER IF EXISTS audit_account_setup_invitations
  ON account_setup_invitations;
CREATE TRIGGER audit_account_setup_invitations
AFTER INSERT OR UPDATE OR DELETE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION audit_account_setup_invitation_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE account_setup_invitations TO axora_app;
    REVOKE DELETE ON TABLE account_setup_invitations FROM axora_app;
    GRANT EXECUTE ON FUNCTION protect_account_setup_invitation() TO axora_app;
    GRANT EXECUTE ON FUNCTION audit_account_setup_invitation_change() TO axora_app;
    GRANT EXECUTE ON FUNCTION audit_user_change() TO axora_app;
  END IF;
END $$;

COMMIT;
