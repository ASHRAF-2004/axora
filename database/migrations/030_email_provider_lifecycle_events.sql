BEGIN;

-- Cloudflare publishes six Email Sending lifecycle events. Keep only the
-- minimum fields needed to correlate their state transitions: hashes of the
-- recipient and provider message ID, the bounded event type, terminal flag and
-- event time. Existing 028 bounce/complaint rows cannot be correlated because
-- their provider message IDs were deliberately discarded, so their new
-- fingerprint remains NULL. Every event accepted after this migration must
-- provide a valid provider-message fingerprint through the narrow recorder.
ALTER TABLE email_provider_events
  ADD COLUMN provider_message_fingerprint text,
  ADD COLUMN terminal boolean NOT NULL DEFAULT true;

ALTER TABLE email_provider_events
  ALTER COLUMN terminal DROP DEFAULT,
  DROP CONSTRAINT email_provider_events_event_type_check,
  DROP CONSTRAINT email_provider_events_check1,
  ADD CONSTRAINT email_provider_events_event_type_check CHECK (
    event_type IN (
      'MESSAGE_DELIVERED','MESSAGE_DEFERRED','MESSAGE_BOUNCED',
      'MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED'
    )
  ),
  ADD CONSTRAINT email_provider_events_message_fingerprint_check CHECK (
    provider_message_fingerprint IS NULL
      OR provider_message_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT email_provider_events_lifecycle_shape_check CHECK (
    (event_type='MESSAGE_DELIVERED'
      AND terminal=true AND bounce_type IS NULL
      AND suppresses_recipient=false)
    OR
    (event_type='MESSAGE_DEFERRED'
      AND terminal=false AND bounce_type IS NULL
      AND suppresses_recipient=false)
    OR
    (event_type='MESSAGE_BOUNCED'
      AND terminal=true AND bounce_type IS NOT NULL
      AND suppresses_recipient=(bounce_type='HARD'))
    OR
    (event_type='MESSAGE_FAILED'
      AND terminal=true AND bounce_type IS NULL
      AND suppresses_recipient=false)
    OR
    (event_type='MESSAGE_REJECTED'
      AND terminal=true AND bounce_type IS NULL
      AND suppresses_recipient=false)
    OR
    (event_type='MESSAGE_COMPLAINED'
      AND terminal=true AND bounce_type IS NULL
      AND suppresses_recipient=true)
  );

CREATE INDEX email_provider_events_message_lifecycle_idx
  ON email_provider_events(
    provider_message_fingerprint,event_occurred_at,provider_event_id
  ) WHERE provider_message_fingerprint IS NOT NULL;
CREATE INDEX email_provider_events_type_occurred_idx
  ON email_provider_events(event_type,event_occurred_at DESC);

-- The send outboxes are intentionally terminal after their synchronous REST
-- outcome is finalized. Provider events can arrive later and out of order, so
-- rewriting SENT rows would violate their immutability and erase the original
-- send result. This private operator read model correlates the SHA-256 of each
-- stored provider message ID with lifecycle-event fingerprints instead. It
-- also exposes unmatched/ambiguous evidence so identifier drift is visible,
-- while never returning a message ID, recipient, subject or SMTP diagnostic.
CREATE VIEW email_provider_delivery_lifecycle
WITH (security_barrier=true)
AS
WITH outbox_messages AS (
  SELECT
    'ACCOUNT_SETUP'::text AS outbox_kind,
    invitation.id AS outbox_id,
    invitation.company_id,
    'ACCOUNT_SETUP'::text AS message_kind,
    invitation.delivery_status AS outbox_delivery_status,
    invitation.sent_at AS outbox_sent_at,
    encode(sha256(convert_to(invitation.provider_message_id,'UTF8')),'hex')
      AS message_fingerprint,
    public.axora_email_recipient_fingerprint(account.email)
      AS recipient_fingerprint
  FROM public.account_setup_invitations invitation
  JOIN public.users account ON account.id=invitation.user_id
  WHERE invitation.provider_message_id IS NOT NULL
    OR invitation.delivery_status='SENT'

  UNION ALL

  SELECT
    'TRANSACTIONAL'::text,
    outbox.id,
    COALESCE(reset_account.company_id,verification_account.company_id),
    outbox.message_kind,
    outbox.delivery_status,
    outbox.sent_at,
    encode(sha256(convert_to(outbox.provider_message_id,'UTF8')),'hex'),
    CASE
      WHEN reset_account.email IS NOT NULL
        THEN public.axora_email_recipient_fingerprint(reset_account.email)
      WHEN verification.email IS NOT NULL
        THEN public.axora_email_recipient_fingerprint(verification.email)
      ELSE NULL
    END
  FROM public.transactional_email_outbox outbox
  LEFT JOIN public.password_reset_tokens reset
    ON reset.id=outbox.password_reset_token_id
  LEFT JOIN public.users reset_account ON reset_account.id=reset.user_id
  LEFT JOIN public.email_verification_tokens verification
    ON verification.id=outbox.email_verification_token_id
  LEFT JOIN public.users verification_account
    ON verification_account.id=verification.user_id
  WHERE outbox.provider_message_id IS NOT NULL
    OR outbox.delivery_status='SENT'

  UNION ALL

  SELECT
    'WORKFLOW'::text,
    outbox.id,
    outbox.company_id,
    'WORKFLOW_UPDATE'::text,
    outbox.delivery_status,
    outbox.sent_at,
    encode(sha256(convert_to(outbox.provider_message_id,'UTF8')),'hex'),
    public.axora_email_recipient_fingerprint(account.email)
  FROM public.workflow_email_outbox outbox
  JOIN public.users account ON account.id=outbox.recipient_user_id
  WHERE outbox.provider_message_id IS NOT NULL
    OR outbox.delivery_status='SENT'
), event_match_counts AS (
  SELECT event.provider_event_id,count(outbox.outbox_id)::integer AS match_count
  FROM public.email_provider_events event
  LEFT JOIN outbox_messages outbox
    ON outbox.message_fingerprint=event.provider_message_fingerprint
   AND (outbox.recipient_fingerprint IS NULL
     OR outbox.recipient_fingerprint=event.recipient_fingerprint)
  GROUP BY event.provider_event_id
), matched_or_waiting AS (
  SELECT
    outbox.outbox_kind,
    outbox.outbox_id,
    outbox.company_id,
    outbox.message_kind,
    outbox.outbox_delivery_status,
    outbox.outbox_sent_at,
    outbox.message_fingerprint AS provider_message_fingerprint,
    event.provider_event_id,
    event.event_type AS provider_status,
    event.terminal AS provider_terminal,
    event.bounce_type,
    event.suppresses_recipient,
    event.event_occurred_at,
    event.received_at,
    CASE
      WHEN outbox.message_fingerprint IS NULL THEN 'NO_PROVIDER_MESSAGE_ID'
      WHEN event.provider_event_id IS NULL THEN 'AWAITING_PROVIDER_EVENT'
      WHEN matches.match_count=1 THEN 'MATCHED'
      ELSE 'AMBIGUOUS'
    END::text AS correlation_state
  FROM outbox_messages outbox
  LEFT JOIN public.email_provider_events event
    ON event.provider_message_fingerprint=outbox.message_fingerprint
   AND (outbox.recipient_fingerprint IS NULL
     OR outbox.recipient_fingerprint=event.recipient_fingerprint)
  LEFT JOIN event_match_counts matches
    ON matches.provider_event_id=event.provider_event_id
), unmatched_events AS (
  SELECT
    NULL::text AS outbox_kind,
    NULL::uuid AS outbox_id,
    NULL::uuid AS company_id,
    NULL::text AS message_kind,
    NULL::text AS outbox_delivery_status,
    NULL::timestamptz AS outbox_sent_at,
    event.provider_message_fingerprint,
    event.provider_event_id,
    event.event_type AS provider_status,
    event.terminal AS provider_terminal,
    event.bounce_type,
    event.suppresses_recipient,
    event.event_occurred_at,
    event.received_at,
    CASE
      WHEN event.provider_message_fingerprint IS NULL
        THEN 'LEGACY_UNCORRELATED'
      ELSE 'UNMATCHED'
    END::text AS correlation_state
  FROM public.email_provider_events event
  JOIN event_match_counts matches
    ON matches.provider_event_id=event.provider_event_id
  WHERE matches.match_count=0
)
SELECT * FROM matched_or_waiting
UNION ALL
SELECT * FROM unmatched_events;

COMMENT ON VIEW email_provider_delivery_lifecycle IS
  'Private privacy-minimized correlation of immutable Axora send outcomes to Cloudflare lifecycle events';

-- Replace the 028 two-event recorder. Dropping the old overload prevents a
-- stale application from silently omitting correlation and terminal data.
DROP FUNCTION axora_record_cloudflare_email_event(
  uuid,text,text,text,timestamptz,integer
);

CREATE FUNCTION axora_record_cloudflare_email_event(
  p_provider_event_id uuid,
  p_event_type text,
  p_recipient_fingerprint text,
  p_provider_message_fingerprint text,
  p_bounce_type text,
  p_terminal boolean,
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
    OR p_event_type NOT IN (
      'MESSAGE_DELIVERED','MESSAGE_DEFERRED','MESSAGE_BOUNCED',
      'MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED'
    )
    OR p_recipient_fingerprint IS NULL
    OR p_recipient_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_provider_message_fingerprint IS NULL
    OR p_provider_message_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_terminal IS NULL
    OR p_event_occurred_at IS NULL
    OR p_event_occurred_at > now()+interval '10 minutes'
    OR p_event_schema_version <> 1
    OR NOT COALESCE(
      (p_event_type='MESSAGE_DELIVERED'
        AND p_terminal=true AND p_bounce_type IS NULL)
      OR
      (p_event_type='MESSAGE_DEFERRED'
        AND p_terminal=false AND p_bounce_type IS NULL)
      OR
      (p_event_type='MESSAGE_BOUNCED'
        AND p_terminal=true AND p_bounce_type IN ('HARD','SOFT'))
      OR
      (p_event_type IN ('MESSAGE_FAILED','MESSAGE_REJECTED','MESSAGE_COMPLAINED')
        AND p_terminal=true AND p_bounce_type IS NULL),
      false
    ) THEN
    RAISE EXCEPTION 'Cloudflare email lifecycle event is invalid';
  END IF;

  should_suppress := p_event_type='MESSAGE_COMPLAINED'
    OR (p_event_type='MESSAGE_BOUNCED' AND p_bounce_type='HARD');

  INSERT INTO public.email_provider_events(
    provider_event_id,provider,event_type,recipient_fingerprint,
    provider_message_fingerprint,bounce_type,terminal,suppresses_recipient,
    event_schema_version,event_occurred_at
  ) VALUES (
    p_provider_event_id,'CLOUDFLARE_EMAIL_SENDING',p_event_type,
    p_recipient_fingerprint,p_provider_message_fingerprint,p_bounce_type,
    p_terminal,should_suppress,p_event_schema_version,p_event_occurred_at
  )
  ON CONFLICT (provider_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count=0 THEN
    SELECT * INTO existing_event
    FROM public.email_provider_events event
    WHERE event.provider_event_id=p_provider_event_id;
    IF existing_event.event_type IS DISTINCT FROM p_event_type
      OR existing_event.recipient_fingerprint IS DISTINCT FROM p_recipient_fingerprint
      -- A pre-030 event has no recoverable message ID. An otherwise identical
      -- retry remains idempotent, but it never gains invented correlation.
      OR (existing_event.provider_message_fingerprint IS NOT NULL
        AND existing_event.provider_message_fingerprint
          IS DISTINCT FROM p_provider_message_fingerprint)
      OR existing_event.bounce_type IS DISTINCT FROM p_bounce_type
      OR existing_event.terminal IS DISTINCT FROM p_terminal
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

    -- Pending email is cancelled only for a hard bounce or complaint. A
    -- deferred, failed, rejected, delivered or exhausted soft-bounce event is
    -- lifecycle evidence and never creates a durable recipient suppression.
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

REVOKE ALL ON TABLE email_provider_delivery_lifecycle FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_record_cloudflare_email_event(
  uuid,text,text,text,text,boolean,timestamptz,integer
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      email_provider_events,email_provider_delivery_lifecycle
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION axora_record_cloudflare_email_event(
      uuid,text,text,text,text,boolean,timestamptz,integer
    ) TO axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback: retain migration 030 and its append-only lifecycle evidence during
-- an application rollback. A pre-030 application cannot call the new recorder,
-- so disable outbound email before rolling application code back. Never remove
-- suppression state as part of rollback.
