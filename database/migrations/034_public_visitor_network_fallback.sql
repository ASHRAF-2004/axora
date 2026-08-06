BEGIN;

-- Cloudflare Turnstile remains the preferred verification path. This forward
-- migration adds a bounded first-party fallback for cases where Siteverify is
-- unavailable or rejects an otherwise same-origin browser attempt. Raw IP
-- addresses and raw browser signals are still never stored: the application
-- passes only domain-separated HMAC fingerprints into PostgreSQL.
-- Add the default and NOT NULL contract atomically: existing claim rows are
-- populated by ALTER TABLE itself, without firing their append-only DML trigger.
ALTER TABLE public.public_visitor_claims
  ADD COLUMN IF NOT EXISTS verification_method text
    NOT NULL DEFAULT 'TURNSTILE';

ALTER TABLE public.public_visitor_claims
  ALTER COLUMN verification_method SET DEFAULT 'TURNSTILE',
  ALTER COLUMN verification_method SET NOT NULL,
  ALTER COLUMN turnstile_challenge_at DROP NOT NULL,
  ALTER COLUMN turnstile_hostname DROP NOT NULL,
  ALTER COLUMN turnstile_action DROP NOT NULL;

ALTER TABLE public.public_visitor_claims
  DROP CONSTRAINT IF EXISTS public_visitor_claims_verification_method_check,
  DROP CONSTRAINT IF EXISTS public_visitor_claims_verification_evidence_check;

ALTER TABLE public.public_visitor_claims
  ADD CONSTRAINT public_visitor_claims_verification_method_check
    CHECK (verification_method IN (
      'TURNSTILE','NETWORK_DEVICE_FALLBACK'
    )),
  ADD CONSTRAINT public_visitor_claims_verification_evidence_check
    CHECK (
      (
        verification_method='TURNSTILE'
        AND turnstile_challenge_at IS NOT NULL
        AND turnstile_hostname IS NOT NULL
        AND turnstile_action='visitor_choice'
      )
      OR
      (
        verification_method='NETWORK_DEVICE_FALLBACK'
        AND network_hash IS NOT NULL
        AND network_device_hash IS NOT NULL
        AND client_signal_hash IS NOT NULL
        AND turnstile_device_hash IS NULL
        AND turnstile_challenge_at IS NULL
        AND turnstile_hostname IS NULL
        AND turnstile_action IS NULL
      )
    );

-- Keep the original Turnstile function and signature intact so a retained
-- pre-034 application release remains compatible after this forward migration.
-- The new function is intentionally narrower and requires all three
-- irreversible network/device fingerprints before it can create a fallback
-- claim.
CREATE OR REPLACE FUNCTION public.axora_claim_public_visitor_fallback(
  p_token_hash text,
  p_network_hash text,
  p_network_device_hash text,
  p_client_signal_hash text,
  p_choice text,
  p_locale text
)
RETURNS TABLE(
  total_count bigint,
  early_bird_count bigint,
  night_owl_count bigint,
  visitor_number bigint,
  choice text,
  claimed_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing_claim_id uuid;
  existing_number bigint;
  existing_choice text;
  next_total bigint;
  next_early bigint;
  next_night bigint;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor token fingerprint is invalid';
  END IF;
  IF p_network_hash IS NULL OR p_network_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network fingerprint is invalid';
  END IF;
  IF p_network_device_hash IS NULL
    OR p_network_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network-device fingerprint is invalid';
  END IF;
  IF p_client_signal_hash IS NULL
    OR p_client_signal_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor client-signal fingerprint is invalid';
  END IF;
  IF p_choice NOT IN ('EARLY_BIRD','NIGHT_OWL') THEN
    RAISE EXCEPTION 'Public visitor choice is invalid';
  END IF;
  IF p_locale NOT IN ('en','ar','ms') THEN
    RAISE EXCEPTION 'Public visitor locale is invalid';
  END IF;

  -- Serializing on the singleton row preserves gap-free ordinals and closes
  -- races between a signed-cookie alias and a network/device match.
  PERFORM 1
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true
  FOR UPDATE;

  SELECT claim.id,claim.visitor_number,claim.choice
  INTO existing_claim_id,existing_number,existing_choice
  FROM public.public_visitor_claims claim
  WHERE (
      EXISTS (
        SELECT 1
        FROM public.public_visitor_claim_tokens token
        WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
      )
    ) OR claim.network_device_hash=p_network_device_hash
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1
      FROM public.public_visitor_claim_tokens token
      WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
    ) THEN 0 ELSE 1 END,
    claim.visitor_number
  LIMIT 1;

  IF existing_claim_id IS NOT NULL THEN
    INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
    VALUES (p_token_hash,existing_claim_id)
    ON CONFLICT (token_hash) DO NOTHING;

    RETURN QUERY
    SELECT
      state.total_count,
      state.early_bird_count,
      state.night_owl_count,
      existing_number,
      existing_choice,
      false
    FROM public.public_visitor_counter_state state
    WHERE state.singleton=true;
    RETURN;
  END IF;

  UPDATE public.public_visitor_counter_state state
  SET
    total_count=state.total_count+1,
    early_bird_count=state.early_bird_count
      + CASE WHEN p_choice='EARLY_BIRD' THEN 1 ELSE 0 END,
    night_owl_count=state.night_owl_count
      + CASE WHEN p_choice='NIGHT_OWL' THEN 1 ELSE 0 END
  WHERE state.singleton=true
  RETURNING
    state.total_count,state.early_bird_count,state.night_owl_count
  INTO next_total,next_early,next_night;

  INSERT INTO public.public_visitor_claims(
    visitor_number,choice,locale,
    network_hash,network_device_hash,client_signal_hash,
    turnstile_device_hash,turnstile_challenge_at,
    turnstile_hostname,turnstile_action,verification_method
  ) VALUES (
    next_total,p_choice,p_locale,
    p_network_hash,p_network_device_hash,p_client_signal_hash,
    NULL,NULL,NULL,NULL,'NETWORK_DEVICE_FALLBACK'
  )
  RETURNING id,public_visitor_claims.visitor_number,
    public_visitor_claims.choice
  INTO existing_claim_id,existing_number,existing_choice;

  INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
  VALUES (p_token_hash,existing_claim_id);

  RETURN QUERY SELECT
    next_total,next_early,next_night,
    existing_number,existing_choice,true;
END $$;

REVOKE ALL ON FUNCTION
  public.axora_claim_public_visitor_fallback(
    text,text,text,text,text,text
  )
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_claim_public_visitor_fallback(
        text,text,text,text,text,text
      )
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_claim_public_visitor_fallback(
        text,text,text,text,text,text
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback compatibility: the original nine-argument Turnstile claim function
-- remains present. A code rollback can therefore keep serving after migration
-- 034 without down-migrating or deleting fallback claims.
