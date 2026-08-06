BEGIN;

-- One public network identity maps permanently to one canonical anonymous
-- visitor claim. The application derives network_hash with a secret-keyed,
-- domain-separated HMAC from Cloudflare's validated CF-Connecting-IP value.
-- The raw address never enters PostgreSQL or application logs.
CREATE TABLE IF NOT EXISTS public.public_visitor_network_claims (
  network_hash text PRIMARY KEY CHECK (network_hash ~ '^[0-9a-f]{64}$'),
  claim_id uuid NOT NULL
    REFERENCES public.public_visitor_claims(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_visitor_network_claims_claim_idx
  ON public.public_visitor_network_claims(claim_id,created_at);

-- Existing installations may already contain more than one claim for the same
-- network because migration 034 deduplicated only the combined network/device
-- fingerprint. Preserve every append-only claim and published visitor number,
-- but select the earliest visitor as the permanent canonical network claim.
INSERT INTO public.public_visitor_network_claims(
  network_hash,claim_id,created_at
)
SELECT canonical.network_hash,canonical.id,canonical.created_at
FROM (
  SELECT DISTINCT ON (claim.network_hash)
    claim.network_hash,claim.id,claim.created_at,claim.visitor_number
  FROM public.public_visitor_claims claim
  WHERE claim.network_hash IS NOT NULL
  ORDER BY claim.network_hash,claim.visitor_number
) canonical
ON CONFLICT (network_hash) DO NOTHING;

DROP TRIGGER IF EXISTS reject_public_visitor_network_claim_update
  ON public.public_visitor_network_claims;
CREATE TRIGGER reject_public_visitor_network_claim_update
BEFORE UPDATE OR DELETE ON public.public_visitor_network_claims
FOR EACH ROW EXECUTE FUNCTION public.reject_public_visitor_claim_mutation();

-- The legacy three-argument snapshot function remains available for retained
-- application releases. Current code uses this version so a private window or
-- cleared cookie still resolves through the permanent network identity.
CREATE OR REPLACE FUNCTION public.axora_public_visitor_snapshot_v2(
  p_token_hash text,
  p_network_hash text,
  p_network_device_hash text,
  p_turnstile_device_hash text
)
RETURNS TABLE(
  total_count bigint,
  early_bird_count bigint,
  night_owl_count bigint,
  visitor_number bigint,
  choice text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  matched_number bigint;
  matched_choice text;
BEGIN
  IF p_token_hash IS NOT NULL
    AND p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor token fingerprint is invalid';
  END IF;
  IF p_network_hash IS NOT NULL
    AND p_network_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network fingerprint is invalid';
  END IF;
  IF p_network_device_hash IS NOT NULL
    AND p_network_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network-device fingerprint is invalid';
  END IF;
  IF p_turnstile_device_hash IS NOT NULL
    AND p_turnstile_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor Turnstile-device fingerprint is invalid';
  END IF;

  SELECT claim.visitor_number,claim.choice
  INTO matched_number,matched_choice
  FROM public.public_visitor_claims claim
  WHERE (
      p_network_hash IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.public_visitor_network_claims network
        WHERE network.network_hash=p_network_hash
          AND network.claim_id=claim.id
      )
    ) OR (
      p_token_hash IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.public_visitor_claim_tokens token
        WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
      )
    ) OR (
      p_network_device_hash IS NOT NULL
      AND claim.network_device_hash=p_network_device_hash
    ) OR (
      p_turnstile_device_hash IS NOT NULL
      AND claim.turnstile_device_hash=p_turnstile_device_hash
    )
  ORDER BY
    CASE
      WHEN p_network_hash IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.public_visitor_network_claims network
        WHERE network.network_hash=p_network_hash
          AND network.claim_id=claim.id
      ) THEN 0
      WHEN p_token_hash IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.public_visitor_claim_tokens token
        WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
      ) THEN 1
      WHEN p_network_device_hash IS NOT NULL
        AND claim.network_device_hash=p_network_device_hash THEN 2
      ELSE 3
    END,
    claim.visitor_number
  LIMIT 1;

  RETURN QUERY
  SELECT
    state.total_count,
    state.early_bird_count,
    state.night_owl_count,
    matched_number,
    matched_choice
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true;
END $$;

-- Preserve the original signature while adding permanent network matching.
CREATE OR REPLACE FUNCTION public.axora_claim_public_visitor(
  p_token_hash text,
  p_network_hash text,
  p_network_device_hash text,
  p_client_signal_hash text,
  p_turnstile_device_hash text,
  p_choice text,
  p_locale text,
  p_turnstile_challenge_at timestamptz,
  p_turnstile_hostname text
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
  IF p_network_hash IS NOT NULL
    AND p_network_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network fingerprint is invalid';
  END IF;
  IF p_network_device_hash IS NOT NULL
    AND p_network_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network-device fingerprint is invalid';
  END IF;
  IF p_client_signal_hash IS NOT NULL
    AND p_client_signal_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor client-signal fingerprint is invalid';
  END IF;
  IF p_turnstile_device_hash IS NOT NULL
    AND p_turnstile_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor Turnstile-device fingerprint is invalid';
  END IF;
  IF p_choice NOT IN ('EARLY_BIRD','NIGHT_OWL') THEN
    RAISE EXCEPTION 'Public visitor choice is invalid';
  END IF;
  IF p_locale NOT IN ('en','ar','ms') THEN
    RAISE EXCEPTION 'Public visitor locale is invalid';
  END IF;
  IF p_turnstile_challenge_at IS NULL
    OR p_turnstile_challenge_at < now() - interval '5 minutes'
    OR p_turnstile_challenge_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'Public visitor verification time is invalid';
  END IF;
  IF p_turnstile_hostname IS NULL
    OR char_length(btrim(p_turnstile_hostname)) NOT BETWEEN 1 AND 253
    OR p_turnstile_hostname ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Public visitor verification hostname is invalid';
  END IF;

  -- Every claim path serializes on the singleton counter row. Together with
  -- the network_hash primary key this prevents two concurrent private-window
  -- attempts from creating separate visitor ordinals for one public address.
  PERFORM 1
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true
  FOR UPDATE;

  SELECT claim.id,claim.visitor_number,claim.choice
  INTO existing_claim_id,existing_number,existing_choice
  FROM public.public_visitor_claims claim
  WHERE (
      p_network_hash IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.public_visitor_network_claims network
        WHERE network.network_hash=p_network_hash
          AND network.claim_id=claim.id
      )
    ) OR EXISTS (
      SELECT 1
      FROM public.public_visitor_claim_tokens token
      WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
    ) OR (
      p_network_device_hash IS NOT NULL
      AND claim.network_device_hash=p_network_device_hash
    ) OR (
      p_turnstile_device_hash IS NOT NULL
      AND claim.turnstile_device_hash=p_turnstile_device_hash
    )
  ORDER BY
    CASE
      WHEN p_network_hash IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.public_visitor_network_claims network
        WHERE network.network_hash=p_network_hash
          AND network.claim_id=claim.id
      ) THEN 0
      WHEN EXISTS (
        SELECT 1
        FROM public.public_visitor_claim_tokens token
        WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
      ) THEN 1
      WHEN p_network_device_hash IS NOT NULL
        AND claim.network_device_hash=p_network_device_hash THEN 2
      ELSE 3
    END,
    claim.visitor_number
  LIMIT 1;

  IF existing_claim_id IS NOT NULL THEN
    INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
    VALUES (p_token_hash,existing_claim_id)
    ON CONFLICT (token_hash) DO NOTHING;

    IF p_network_hash IS NOT NULL THEN
      INSERT INTO public.public_visitor_network_claims(network_hash,claim_id)
      VALUES (p_network_hash,existing_claim_id)
      ON CONFLICT (network_hash) DO NOTHING;
    END IF;

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
    p_turnstile_device_hash,p_turnstile_challenge_at,
    lower(btrim(p_turnstile_hostname)),'visitor_choice','TURNSTILE'
  )
  RETURNING id,public_visitor_claims.visitor_number,
    public_visitor_claims.choice
  INTO existing_claim_id,existing_number,existing_choice;

  INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
  VALUES (p_token_hash,existing_claim_id);

  IF p_network_hash IS NOT NULL THEN
    INSERT INTO public.public_visitor_network_claims(network_hash,claim_id)
    VALUES (p_network_hash,existing_claim_id);
  END IF;

  RETURN QUERY SELECT
    next_total,next_early,next_night,
    existing_number,existing_choice,true;
END $$;

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

  PERFORM 1
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true
  FOR UPDATE;

  SELECT claim.id,claim.visitor_number,claim.choice
  INTO existing_claim_id,existing_number,existing_choice
  FROM public.public_visitor_claims claim
  WHERE EXISTS (
      SELECT 1
      FROM public.public_visitor_network_claims network
      WHERE network.network_hash=p_network_hash
        AND network.claim_id=claim.id
    ) OR EXISTS (
      SELECT 1
      FROM public.public_visitor_claim_tokens token
      WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
    ) OR claim.network_device_hash=p_network_device_hash
  ORDER BY
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.public_visitor_network_claims network
        WHERE network.network_hash=p_network_hash
          AND network.claim_id=claim.id
      ) THEN 0
      WHEN EXISTS (
        SELECT 1
        FROM public.public_visitor_claim_tokens token
        WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
      ) THEN 1
      ELSE 2
    END,
    claim.visitor_number
  LIMIT 1;

  IF existing_claim_id IS NOT NULL THEN
    INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
    VALUES (p_token_hash,existing_claim_id)
    ON CONFLICT (token_hash) DO NOTHING;

    INSERT INTO public.public_visitor_network_claims(network_hash,claim_id)
    VALUES (p_network_hash,existing_claim_id)
    ON CONFLICT (network_hash) DO NOTHING;

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

  INSERT INTO public.public_visitor_network_claims(network_hash,claim_id)
  VALUES (p_network_hash,existing_claim_id);

  RETURN QUERY SELECT
    next_total,next_early,next_night,
    existing_number,existing_choice,true;
END $$;

REVOKE ALL ON TABLE public.public_visitor_network_claims FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_public_visitor_snapshot_v2(text,text,text,text),
  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  ),
  public.axora_claim_public_visitor_fallback(
    text,text,text,text,text,text
  )
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.public_visitor_network_claims FROM axora_app;
    REVOKE ALL ON FUNCTION
      public.axora_public_visitor_snapshot_v2(text,text,text,text),
      public.axora_claim_public_visitor(
        text,text,text,text,text,text,text,timestamptz,text
      ),
      public.axora_claim_public_visitor_fallback(
        text,text,text,text,text,text
      )
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_public_visitor_snapshot_v2(text,text,text,text),
      public.axora_claim_public_visitor(
        text,text,text,text,text,text,text,timestamptz,text
      ),
      public.axora_claim_public_visitor_fallback(
        text,text,text,text,text,text
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;

-- Existing duplicate claim rows remain immutable and their historical visitor
-- numbers remain published. From this migration onward, the earliest claim for
-- each permanent network hash is canonical and every later private-window or
-- cleared-cookie attempt from that public address resolves to it.
