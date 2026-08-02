BEGIN;

-- Public request throttles retain only keyed, irreversible fingerprints. Raw
-- network addresses and unknown account identifiers never enter PostgreSQL.
CREATE TABLE IF NOT EXISTS public_request_rate_buckets (
  action_key text NOT NULL
    CHECK (action_key IN ('CONTACT','PASSWORD_RESET','EMAIL_VERIFICATION')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('NETWORK','IDENTIFIER')),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1
    CHECK (request_count BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(action_key,scope_kind,scope_hash,bucket_started_at)
);

CREATE INDEX IF NOT EXISTS public_request_rate_buckets_retention_idx
  ON public_request_rate_buckets(bucket_started_at);

CREATE OR REPLACE FUNCTION protect_public_request_rate_bucket() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
    OR NEW.bucket_started_at IS DISTINCT FROM OLD.bucket_started_at
    OR NEW.request_count < OLD.request_count THEN
    RAISE EXCEPTION 'Public request rate buckets are monotonic and immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_public_request_rate_buckets
  ON public_request_rate_buckets;
CREATE TRIGGER protect_public_request_rate_buckets
BEFORE UPDATE ON public_request_rate_buckets
FOR EACH ROW EXECUTE FUNCTION protect_public_request_rate_bucket();

CREATE TABLE IF NOT EXISTS public_contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale text NOT NULL CHECK (locale IN ('en','ar','ms')),
  contact_name text NOT NULL
    CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 200
      AND contact_name !~ '[[:cntrl:]]'),
  contact_email text NOT NULL
    CHECK (char_length(contact_email) BETWEEN 3 AND 254
      AND contact_email=lower(contact_email)
      AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  company_name text NOT NULL
    CHECK (char_length(btrim(company_name)) BETWEEN 1 AND 200
      AND company_name !~ '[[:cntrl:]]'),
  phone text CHECK (phone IS NULL OR (
    char_length(btrim(phone)) BETWEEN 1 AND 40 AND phone !~ '[[:cntrl:]]'
  )),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 200
    AND subject !~ '[[:cntrl:]]'),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 5000),
  privacy_accepted_at timestamptz NOT NULL,
  network_rate_key text NOT NULL CHECK (network_rate_key ~ '^[0-9a-f]{64}$'),
  sender_rate_key text NOT NULL CHECK (sender_rate_key ~ '^[0-9a-f]{64}$'),
  turnstile_success boolean NOT NULL CHECK (turnstile_success),
  turnstile_challenge_at timestamptz NOT NULL,
  turnstile_verified_at timestamptz NOT NULL DEFAULT now(),
  turnstile_hostname text NOT NULL
    CHECK (char_length(btrim(turnstile_hostname)) BETWEEN 1 AND 253
      AND turnstile_hostname !~ '[[:cntrl:]]'),
  turnstile_action text NOT NULL CHECK (turnstile_action='contact'),
  notification_status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (notification_status IN (
      'RECEIVED','NOTIFIED','NOTIFICATION_FAILED','NOTIFICATION_UNCERTAIN'
    )),
  notified_at timestamptz,
  notification_finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (turnstile_challenge_at <= turnstile_verified_at + interval '5 minutes'),
  CHECK (privacy_accepted_at <= created_at + interval '5 minutes'),
  CHECK ((notification_status='RECEIVED'
      AND notified_at IS NULL AND notification_finalized_at IS NULL)
    OR (notification_status='NOTIFIED'
      AND notified_at IS NOT NULL AND notification_finalized_at IS NOT NULL)
    OR (notification_status IN ('NOTIFICATION_FAILED','NOTIFICATION_UNCERTAIN')
      AND notified_at IS NULL AND notification_finalized_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS public_contact_submissions_created_idx
  ON public_contact_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS public_contact_submissions_network_rate_idx
  ON public_contact_submissions(network_rate_key,created_at DESC);
CREATE INDEX IF NOT EXISTS public_contact_submissions_sender_rate_idx
  ON public_contact_submissions(sender_rate_key,created_at DESC);
CREATE INDEX IF NOT EXISTS public_contact_submissions_pending_idx
  ON public_contact_submissions(created_at)
  WHERE notification_status='RECEIVED';

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS revoked_reason text;
ALTER TABLE password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_locale_check;
ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_locale_check
    CHECK (locale IN ('en','ar','ms'));
ALTER TABLE password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_revoked_reason_check;
ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_revoked_reason_check CHECK (
    revoked_reason IS NULL
    OR (char_length(revoked_reason) BETWEEN 1 AND 120
      AND revoked_reason ~ '^[a-z0-9_]+$')
  );

ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS revoked_reason text;
ALTER TABLE email_verification_tokens
  DROP CONSTRAINT IF EXISTS email_verification_tokens_locale_check;
ALTER TABLE email_verification_tokens
  ADD CONSTRAINT email_verification_tokens_locale_check
    CHECK (locale IN ('en','ar','ms'));
ALTER TABLE email_verification_tokens
  DROP CONSTRAINT IF EXISTS email_verification_tokens_revoked_reason_check;
ALTER TABLE email_verification_tokens
  ADD CONSTRAINT email_verification_tokens_revoked_reason_check CHECK (
    revoked_reason IS NULL
    OR (char_length(revoked_reason) BETWEEN 1 AND 120
      AND revoked_reason ~ '^[a-z0-9_]+$')
  );

CREATE OR REPLACE FUNCTION protect_password_reset_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.request_network_hash IS DISTINCT FROM OLD.request_network_hash
    OR NEW.locale IS DISTINCT FROM OLD.locale THEN
    RAISE EXCEPTION 'Password reset token identity is immutable';
  END IF;
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'A used password reset token cannot be changed';
  END IF;
  IF OLD.revoked_at IS NOT NULL
    AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason) THEN
    RAISE EXCEPTION 'A revoked password reset token cannot be changed';
  END IF;
  IF NEW.revoked_at IS NOT NULL AND NEW.revoked_reason IS NULL THEN
    RAISE EXCEPTION 'A revoked password reset token requires a reason';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_password_reset_tokens ON password_reset_tokens;
CREATE TRIGGER protect_password_reset_tokens
BEFORE UPDATE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION protect_password_reset_token();

CREATE OR REPLACE FUNCTION protect_email_verification_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.locale IS DISTINCT FROM OLD.locale THEN
    RAISE EXCEPTION 'Email verification token identity is immutable';
  END IF;
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'A used email verification token cannot be changed';
  END IF;
  IF OLD.revoked_at IS NOT NULL
    AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason) THEN
    RAISE EXCEPTION 'A revoked email verification token cannot be changed';
  END IF;
  IF NEW.revoked_at IS NOT NULL AND NEW.revoked_reason IS NULL THEN
    RAISE EXCEPTION 'A revoked email verification token requires a reason';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_email_verification_tokens
  ON email_verification_tokens;
CREATE TRIGGER protect_email_verification_tokens
BEFORE UPDATE ON email_verification_tokens
FOR EACH ROW EXECUTE FUNCTION protect_email_verification_token();

CREATE TABLE IF NOT EXISTS transactional_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_kind text NOT NULL CHECK (message_kind IN (
    'CONTACT_NOTIFICATION','PASSWORD_RESET','EMAIL_VERIFICATION'
  )),
  contact_submission_id uuid UNIQUE
    REFERENCES public_contact_submissions(id) ON DELETE CASCADE,
  password_reset_token_id uuid UNIQUE
    REFERENCES password_reset_tokens(id) ON DELETE CASCADE,
  email_verification_token_id uuid UNIQUE
    REFERENCES email_verification_tokens(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('en','ar','ms')),
  token_ciphertext text CHECK (
    token_ciphertext IS NULL OR token_ciphertext ~ '^[A-Za-z0-9_-]{58}$'
  ),
  token_nonce text CHECK (
    token_nonce IS NULL OR token_nonce ~ '^[A-Za-z0-9_-]{16}$'
  ),
  token_authentication_tag text CHECK (
    token_authentication_tag IS NULL
    OR token_authentication_tag ~ '^[A-Za-z0-9_-]{22}$'
  ),
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (
    delivery_status IN (
      'PENDING','SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    )
  ),
  delivery_attempt_count integer NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count BETWEEN 0 AND 3),
  delivery_available_at timestamptz NOT NULL DEFAULT now(),
  delivery_attempted_at timestamptz,
  delivery_lease_id uuid,
  delivery_lease_expires_at timestamptz,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (message_kind='CONTACT_NOTIFICATION'
      AND contact_submission_id IS NOT NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind='PASSWORD_RESET'
      AND contact_submission_id IS NULL
      AND password_reset_token_id IS NOT NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind='EMAIL_VERIFICATION'
      AND contact_submission_id IS NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NOT NULL)
  ),
  CHECK (
    (token_ciphertext IS NULL AND token_nonce IS NULL
      AND token_authentication_tag IS NULL)
    OR (token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL
      AND token_authentication_tag IS NOT NULL)
  ),
  CHECK (
    (message_kind='CONTACT_NOTIFICATION'
      AND token_ciphertext IS NULL)
    OR (message_kind IN ('PASSWORD_RESET','EMAIL_VERIFICATION')
      AND ((delivery_status IN ('PENDING','SENDING')
          AND token_ciphertext IS NOT NULL)
        OR (delivery_status NOT IN ('PENDING','SENDING')
          AND token_ciphertext IS NULL)))
  ),
  CHECK (
    (delivery_status='PENDING'
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='SENDING'
      AND delivery_attempt_count > 0 AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NOT NULL AND delivery_lease_expires_at IS NOT NULL
      AND delivery_lease_expires_at > delivery_attempted_at
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='SENT'
      AND delivery_attempt_count > 0 AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NOT NULL)
    OR (delivery_status IN ('FAILED','DISABLED','UNCERTAIN')
      AND delivery_attempted_at IS NOT NULL
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (delivery_status='CANCELLED'
      AND delivery_lease_id IS NULL AND delivery_lease_expires_at IS NULL
      AND sent_at IS NULL AND provider_message_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS transactional_email_outbox_ready_idx
  ON transactional_email_outbox(delivery_available_at,created_at)
  WHERE delivery_status='PENDING';
CREATE INDEX IF NOT EXISTS transactional_email_outbox_lease_idx
  ON transactional_email_outbox(delivery_lease_expires_at)
  WHERE delivery_status='SENDING';

CREATE OR REPLACE FUNCTION protect_transactional_email_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.message_kind IS DISTINCT FROM OLD.message_kind
    OR NEW.contact_submission_id IS DISTINCT FROM OLD.contact_submission_id
    OR NEW.password_reset_token_id IS DISTINCT FROM OLD.password_reset_token_id
    OR NEW.email_verification_token_id IS DISTINCT FROM OLD.email_verification_token_id
    OR NEW.locale IS DISTINCT FROM OLD.locale
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Transactional email outbox identity is immutable';
  END IF;
  IF (OLD.token_ciphertext IS NULL AND NEW.token_ciphertext IS NOT NULL)
    OR (OLD.token_nonce IS NULL AND NEW.token_nonce IS NOT NULL)
    OR (OLD.token_authentication_tag IS NULL
      AND NEW.token_authentication_tag IS NOT NULL)
    OR (OLD.token_ciphertext IS NOT NULL AND NEW.token_ciphertext IS NOT NULL
      AND OLD.token_ciphertext IS DISTINCT FROM NEW.token_ciphertext)
    OR (OLD.token_nonce IS NOT NULL AND NEW.token_nonce IS NOT NULL
      AND OLD.token_nonce IS DISTINCT FROM NEW.token_nonce)
    OR (OLD.token_authentication_tag IS NOT NULL
      AND NEW.token_authentication_tag IS NOT NULL
      AND OLD.token_authentication_tag IS DISTINCT FROM NEW.token_authentication_tag) THEN
    RAISE EXCEPTION 'Transactional email encrypted payload is immutable';
  END IF;
  IF NEW.delivery_attempt_count < OLD.delivery_attempt_count THEN
    RAISE EXCEPTION 'Transactional email attempts cannot decrease';
  END IF;
  IF OLD.delivery_status NOT IN ('PENDING','SENDING') AND (
    NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
    OR NEW.delivery_attempt_count IS DISTINCT FROM OLD.delivery_attempt_count
    OR NEW.delivery_available_at IS DISTINCT FROM OLD.delivery_available_at
    OR NEW.delivery_attempted_at IS DISTINCT FROM OLD.delivery_attempted_at
    OR NEW.delivery_lease_id IS DISTINCT FROM OLD.delivery_lease_id
    OR NEW.delivery_lease_expires_at IS DISTINCT FROM OLD.delivery_lease_expires_at
    OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
    OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
    OR NEW.last_delivery_error IS DISTINCT FROM OLD.last_delivery_error
  ) THEN
    RAISE EXCEPTION 'Transactional email delivery metadata is final';
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    IF OLD.delivery_status='PENDING' AND NEW.delivery_status NOT IN (
      'SENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid transactional email delivery transition';
    ELSIF OLD.delivery_status='SENDING' AND NEW.delivery_status NOT IN (
      'PENDING','SENT','FAILED','DISABLED','UNCERTAIN','CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Invalid transactional email delivery transition';
    ELSIF OLD.delivery_status NOT IN ('PENDING','SENDING') THEN
      RAISE EXCEPTION 'Transactional email delivery status is final';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_transactional_email_outbox_trigger
  ON transactional_email_outbox;
CREATE TRIGGER protect_transactional_email_outbox_trigger
BEFORE UPDATE ON transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION protect_transactional_email_outbox();

-- Contact content and security-token material are deliberately excluded from
-- audit JSON. Operators retain lifecycle evidence without a shadow PII or
-- credential store.
CREATE OR REPLACE FUNCTION audit_public_contact_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE actor_text text; actor uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN actor := actor_text::uuid; END IF;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,reason
  ) VALUES (
    TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object(
      'notification_status',OLD.notification_status,
      'created_at',OLD.created_at,
      'notified_at',OLD.notified_at,
      'notification_finalized_at',OLD.notification_finalized_at
    ) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object(
      'notification_status',NEW.notification_status,
      'created_at',NEW.created_at,
      'notified_at',NEW.notified_at,
      'notification_finalized_at',NEW.notification_finalized_at
    ) ELSE NULL END,
    actor,current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS audit_public_contact_submissions
  ON public_contact_submissions;
CREATE TRIGGER audit_public_contact_submissions
AFTER INSERT OR UPDATE OR DELETE ON public_contact_submissions
FOR EACH ROW EXECUTE FUNCTION audit_public_contact_submission();

CREATE OR REPLACE FUNCTION audit_transactional_email_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE actor_text text; actor uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NOT NULL AND actor_text <> '' THEN actor := actor_text::uuid; END IF;
  INSERT INTO public.audit_logs(
    entity_type,record_id,action,old_values,new_values,actor_id,reason
  ) VALUES (
    TG_TABLE_NAME,COALESCE(NEW.id,OLD.id),TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN
      to_jsonb(OLD)-'token_ciphertext'-'token_nonce'-'token_authentication_tag'
        -'provider_message_id'-'last_delivery_error'-'delivery_lease_id'
      ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN
      to_jsonb(NEW)-'token_ciphertext'-'token_nonce'-'token_authentication_tag'
        -'provider_message_id'-'last_delivery_error'-'delivery_lease_id'
      ELSE NULL END,
    actor,current_setting('axora.change_reason', true)
  );
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS audit_transactional_email_outbox_trigger
  ON transactional_email_outbox;
CREATE TRIGGER audit_transactional_email_outbox_trigger
AFTER INSERT OR UPDATE OR DELETE ON transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION audit_transactional_email_outbox();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT,INSERT,UPDATE ON TABLE
      public_request_rate_buckets,public_contact_submissions,
      transactional_email_outbox
    TO axora_app;
    REVOKE DELETE ON TABLE
      public_request_rate_buckets,public_contact_submissions,
      transactional_email_outbox
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      protect_public_request_rate_bucket(),protect_password_reset_token(),
      protect_email_verification_token(),protect_transactional_email_outbox(),
      audit_public_contact_submission(),audit_transactional_email_outbox()
    TO axora_app;
  END IF;
END $$;

COMMIT;
