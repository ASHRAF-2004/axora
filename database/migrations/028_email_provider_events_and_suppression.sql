BEGIN;

-- Email Sending events contain recipient addresses, subjects and SMTP
-- diagnostics. Axora deliberately persists none of those fields. The edge
-- consumer normalizes the recipient and sends only this deterministic digest;
-- the same function lets claim-time checks compare current account addresses.
CREATE OR REPLACE FUNCTION axora_email_recipient_fingerprint(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT encode(
    pg_catalog.sha256(convert_to(lower(btrim(p_email)),'UTF8')),
    'hex'
  )
$$;

CREATE TABLE IF NOT EXISTS email_provider_events (
  provider_event_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider='CLOUDFLARE_EMAIL_SENDING'),
  event_type text NOT NULL CHECK (
    event_type IN ('MESSAGE_BOUNCED','MESSAGE_COMPLAINED')
  ),
  recipient_fingerprint text NOT NULL CHECK (
    recipient_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  bounce_type text CHECK (bounce_type IN ('HARD','SOFT')),
  suppresses_recipient boolean NOT NULL,
  event_schema_version smallint NOT NULL CHECK (event_schema_version=1),
  event_occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_occurred_at <= received_at + interval '10 minutes'),
  CHECK (
    (event_type='MESSAGE_BOUNCED'
      AND bounce_type IS NOT NULL
      AND suppresses_recipient=(bounce_type='HARD'))
    OR
    (event_type='MESSAGE_COMPLAINED'
      AND bounce_type IS NULL
      AND suppresses_recipient=true)
  )
);

CREATE INDEX IF NOT EXISTS email_provider_events_recipient_idx
  ON email_provider_events(recipient_fingerprint,event_occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_provider_events_received_idx
  ON email_provider_events(received_at DESC);

-- This table is a compact, derived send-time deny list. The append-only event
-- table above remains the evidence source. A changed account address has a new
-- fingerprint and is therefore not silently suppressed by an old address.
CREATE TABLE IF NOT EXISTS email_recipient_suppressions (
  recipient_fingerprint text PRIMARY KEY CHECK (
    recipient_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  first_provider_event_id uuid NOT NULL
    REFERENCES email_provider_events(provider_event_id) ON DELETE RESTRICT,
  most_recent_provider_event_id uuid NOT NULL
    REFERENCES email_provider_events(provider_event_id) ON DELETE RESTRICT,
  first_suppressed_at timestamptz NOT NULL,
  most_recent_suppressed_at timestamptz NOT NULL,
  hard_bounce_count integer NOT NULL DEFAULT 0 CHECK (hard_bounce_count >= 0),
  complaint_count integer NOT NULL DEFAULT 0 CHECK (complaint_count >= 0),
  event_count integer NOT NULL CHECK (
    event_count > 0 AND event_count=hard_bounce_count+complaint_count
  ),
  CHECK (first_suppressed_at <= most_recent_suppressed_at),
  CHECK (hard_bounce_count > 0 OR complaint_count > 0)
);

CREATE INDEX IF NOT EXISTS email_recipient_suppressions_recent_idx
  ON email_recipient_suppressions(most_recent_suppressed_at DESC);

-- Application claim paths need only a yes/no answer. Keep the event evidence
-- and suppression rows private, and expose this narrow capability instead of
-- granting SELECT on either table. A null address cannot be suppressed.
CREATE OR REPLACE FUNCTION axora_email_recipient_is_suppressed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.email_recipient_suppressions suppression
    WHERE p_email IS NOT NULL
      AND suppression.recipient_fingerprint
        = public.axora_email_recipient_fingerprint(p_email)
  )
$$;

CREATE OR REPLACE FUNCTION protect_email_provider_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Email provider events are append-only';
END $$;

DROP TRIGGER IF EXISTS protect_email_provider_events_trigger
  ON email_provider_events;
CREATE TRIGGER protect_email_provider_events_trigger
BEFORE UPDATE OR DELETE ON email_provider_events
FOR EACH ROW EXECUTE FUNCTION protect_email_provider_event();

-- The public endpoint has already verified a timestamp/body-bound HMAC and a
-- strict schema before calling this capability. This function supplies the
-- durable idempotency boundary, rejects conflicting reuse of an event ID, and
-- atomically derives suppression. It never accepts a plaintext address.
CREATE OR REPLACE FUNCTION axora_record_cloudflare_email_event(
  p_provider_event_id uuid,
  p_event_type text,
  p_recipient_fingerprint text,
  p_bounce_type text,
  p_event_occurred_at timestamptz,
  p_event_schema_version integer DEFAULT 1
) RETURNS TABLE(recorded boolean,suppressed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  should_suppress boolean;
  inserted_count integer;
  existing_event public.email_provider_events%ROWTYPE;
BEGIN
  IF p_provider_event_id IS NULL
    OR p_event_type NOT IN ('MESSAGE_BOUNCED','MESSAGE_COMPLAINED')
    OR p_recipient_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_event_occurred_at IS NULL
    OR p_event_occurred_at > now()+interval '10 minutes'
    OR p_event_schema_version <> 1
    OR (p_event_type='MESSAGE_BOUNCED'
      AND p_bounce_type NOT IN ('HARD','SOFT'))
    OR (p_event_type='MESSAGE_COMPLAINED' AND p_bounce_type IS NOT NULL) THEN
    RAISE EXCEPTION 'Cloudflare email event is invalid';
  END IF;

  should_suppress := p_event_type='MESSAGE_COMPLAINED'
    OR (p_event_type='MESSAGE_BOUNCED' AND p_bounce_type='HARD');

  INSERT INTO public.email_provider_events(
    provider_event_id,provider,event_type,recipient_fingerprint,bounce_type,
    suppresses_recipient,event_schema_version,event_occurred_at
  ) VALUES (
    p_provider_event_id,'CLOUDFLARE_EMAIL_SENDING',p_event_type,
    p_recipient_fingerprint,p_bounce_type,should_suppress,
    p_event_schema_version,p_event_occurred_at
  )
  ON CONFLICT (provider_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count=0 THEN
    SELECT * INTO existing_event
    FROM public.email_provider_events event
    WHERE event.provider_event_id=p_provider_event_id;
    IF existing_event.event_type IS DISTINCT FROM p_event_type
      OR existing_event.recipient_fingerprint IS DISTINCT FROM p_recipient_fingerprint
      OR existing_event.bounce_type IS DISTINCT FROM p_bounce_type
      OR existing_event.suppresses_recipient IS DISTINCT FROM should_suppress
      OR existing_event.event_schema_version IS DISTINCT FROM p_event_schema_version
      OR existing_event.event_occurred_at IS DISTINCT FROM p_event_occurred_at THEN
      RAISE EXCEPTION 'Cloudflare email event identifier conflict';
    END IF;
    RETURN QUERY SELECT false,existing_event.suppresses_recipient;
    RETURN;
  END IF;

  IF should_suppress THEN
    INSERT INTO public.email_recipient_suppressions(
      recipient_fingerprint,first_provider_event_id,most_recent_provider_event_id,
      first_suppressed_at,most_recent_suppressed_at,
      hard_bounce_count,complaint_count,event_count
    ) VALUES (
      p_recipient_fingerprint,p_provider_event_id,p_provider_event_id,
      p_event_occurred_at,p_event_occurred_at,
      CASE WHEN p_event_type='MESSAGE_BOUNCED' THEN 1 ELSE 0 END,
      CASE WHEN p_event_type='MESSAGE_COMPLAINED' THEN 1 ELSE 0 END,
      1
    )
    ON CONFLICT (recipient_fingerprint) DO UPDATE SET
      first_provider_event_id=CASE
        WHEN EXCLUDED.first_suppressed_at
          < email_recipient_suppressions.first_suppressed_at
          THEN EXCLUDED.first_provider_event_id
        ELSE email_recipient_suppressions.first_provider_event_id
      END,
      first_suppressed_at=LEAST(
        email_recipient_suppressions.first_suppressed_at,
        EXCLUDED.first_suppressed_at
      ),
      most_recent_provider_event_id=CASE
        WHEN EXCLUDED.most_recent_suppressed_at
          >= email_recipient_suppressions.most_recent_suppressed_at
          THEN EXCLUDED.most_recent_provider_event_id
        ELSE email_recipient_suppressions.most_recent_provider_event_id
      END,
      most_recent_suppressed_at=GREATEST(
        email_recipient_suppressions.most_recent_suppressed_at,
        EXCLUDED.most_recent_suppressed_at
      ),
      hard_bounce_count=email_recipient_suppressions.hard_bounce_count
        + EXCLUDED.hard_bounce_count,
      complaint_count=email_recipient_suppressions.complaint_count
        + EXCLUDED.complaint_count,
      event_count=email_recipient_suppressions.event_count+1;

    -- In-flight sends have an ambiguous provider outcome and are not rewritten.
    -- Pending account invitations contain only bearer-token hashes. Cancel
    -- their single delivery opportunity. The durable transactional queue below
    -- separately erases its encrypted password-reset/verification payloads.
    UPDATE public.account_setup_invitations invitation
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
    FROM public.users account
    WHERE invitation.delivery_status='PENDING'
      AND account.id=invitation.user_id
      AND public.axora_email_recipient_fingerprint(account.email)
        = p_recipient_fingerprint;

    UPDATE public.transactional_email_outbox outbox
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed',
        token_ciphertext=NULL,token_nonce=NULL,token_authentication_tag=NULL
    WHERE outbox.delivery_status='PENDING'
      AND (
        EXISTS (
          SELECT 1
          FROM public.password_reset_tokens reset
          JOIN public.users account ON account.id=reset.user_id
          WHERE reset.id=outbox.password_reset_token_id
            AND public.axora_email_recipient_fingerprint(account.email)
              = p_recipient_fingerprint
        )
        OR EXISTS (
          SELECT 1
          FROM public.email_verification_tokens verification
          WHERE verification.id=outbox.email_verification_token_id
            AND public.axora_email_recipient_fingerprint(verification.email)
              = p_recipient_fingerprint
        )
      );

    UPDATE public.workflow_email_outbox outbox
    SET delivery_status='CANCELLED',last_delivery_error='recipient_suppressed'
    FROM public.users account
    WHERE outbox.delivery_status='PENDING'
      AND account.id=outbox.recipient_user_id
      AND public.axora_email_recipient_fingerprint(account.email)
        = p_recipient_fingerprint;
  END IF;

  RETURN QUERY SELECT true,should_suppress;
END $$;

-- Replace the 026 recipient validator so every workflow enqueue and claim also
-- checks the durable suppression list. In-app notification scope is unchanged.
CREATE OR REPLACE FUNCTION axora_workflow_email_recipient_is_valid(
  p_company_id uuid,
  p_workflow_event_id uuid,
  p_recipient_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.axora_workflow_notification_recipient_is_valid(
      p_company_id,p_workflow_event_id,p_recipient_user_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.users account
      WHERE account.id=p_recipient_user_id
        AND account.email_verified_at IS NOT NULL
        AND char_length(account.email) BETWEEN 3 AND 254
        AND lower(account.email)
          ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND account.email !~ '[[:cntrl:]]'
        AND NOT public.axora_email_recipient_is_suppressed(account.email)
    )
$$;

ALTER TABLE email_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_suppressions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE email_provider_events,email_recipient_suppressions
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  axora_email_recipient_fingerprint(text),
  axora_email_recipient_is_suppressed(text),
  axora_record_cloudflare_email_event(uuid,text,text,text,timestamptz,integer)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      email_provider_events,email_recipient_suppressions
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      axora_email_recipient_is_suppressed(text),
      axora_record_cloudflare_email_event(uuid,text,text,text,timestamptz,integer)
    TO axora_app;
    REVOKE ALL ON FUNCTION
      axora_email_recipient_fingerprint(text)
    FROM axora_app;
    REVOKE ALL ON FUNCTION
      axora_workflow_email_recipient_is_valid(uuid,uuid,uuid)
    FROM axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback: keep both evidence tables and the suppression checks during an
-- application rollback. Removing them can resume delivery to recipients who
-- hard-bounced or complained. A reviewed data-retention/export procedure must
-- precede any later destructive removal; no automatic down migration exists.
