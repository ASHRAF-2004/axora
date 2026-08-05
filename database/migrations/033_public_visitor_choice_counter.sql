BEGIN;

-- Public visitor-choice attempts share the existing irreversible HMAC rate
-- bucket. Raw IP addresses and browser/device signals never enter PostgreSQL.
ALTER TABLE public.public_request_rate_buckets
  DROP CONSTRAINT IF EXISTS public_request_rate_buckets_action_key_check;
ALTER TABLE public.public_request_rate_buckets
  ADD CONSTRAINT public_request_rate_buckets_action_key_check
    CHECK (action_key IN (
      'CONTACT','PASSWORD_RESET','EMAIL_VERIFICATION','LOGIN','VISITOR_CHOICE'
    ));

CREATE INDEX IF NOT EXISTS public_request_rate_buckets_visitor_choice_idx
  ON public.public_request_rate_buckets(
    scope_kind,scope_hash,bucket_started_at DESC
  )
  WHERE action_key='VISITOR_CHOICE';

-- The singleton row makes visitor ordinals gap-free for committed claims and
-- keeps the two public side totals consistent with the overall total.
CREATE TABLE IF NOT EXISTS public.public_visitor_counter_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  total_count bigint NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  early_bird_count bigint NOT NULL DEFAULT 0 CHECK (early_bird_count >= 0),
  night_owl_count bigint NOT NULL DEFAULT 0 CHECK (night_owl_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_count=early_bird_count+night_owl_count)
);

INSERT INTO public.public_visitor_counter_state(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- Only irreversible, domain-separated fingerprints are retained. The
-- Turnstile token, signed first-party cookie value, raw IP, User-Agent and
-- client signal payload are deliberately excluded from storage.
CREATE TABLE IF NOT EXISTS public.public_visitor_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_number bigint NOT NULL UNIQUE CHECK (visitor_number > 0),
  choice text NOT NULL CHECK (choice IN ('EARLY_BIRD','NIGHT_OWL')),
  locale text NOT NULL CHECK (locale IN ('en','ar','ms')),
  network_hash text CHECK (
    network_hash IS NULL OR network_hash ~ '^[0-9a-f]{64}$'
  ),
  network_device_hash text CHECK (
    network_device_hash IS NULL OR network_device_hash ~ '^[0-9a-f]{64}$'
  ),
  client_signal_hash text CHECK (
    client_signal_hash IS NULL OR client_signal_hash ~ '^[0-9a-f]{64}$'
  ),
  turnstile_device_hash text CHECK (
    turnstile_device_hash IS NULL OR turnstile_device_hash ~ '^[0-9a-f]{64}$'
  ),
  turnstile_challenge_at timestamptz NOT NULL,
  turnstile_hostname text NOT NULL CHECK (
    char_length(btrim(turnstile_hostname)) BETWEEN 1 AND 253
    AND turnstile_hostname !~ '[[:cntrl:]]'
  ),
  turnstile_action text NOT NULL CHECK (turnstile_action='visitor_choice'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    turnstile_challenge_at >= created_at - interval '5 minutes'
    AND turnstile_challenge_at <= created_at + interval '1 minute'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS public_visitor_claims_network_device_uidx
  ON public.public_visitor_claims(network_device_hash)
  WHERE network_device_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS public_visitor_claims_turnstile_device_uidx
  ON public.public_visitor_claims(turnstile_device_hash)
  WHERE turnstile_device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_visitor_claims_network_idx
  ON public.public_visitor_claims(network_hash,created_at DESC)
  WHERE network_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_visitor_claims_client_signal_idx
  ON public.public_visitor_claims(client_signal_hash,created_at DESC)
  WHERE client_signal_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_visitor_claims_created_idx
  ON public.public_visitor_claims(created_at DESC);

-- A claim can accumulate signed-cookie aliases when the same anonymous
-- visitor returns from a private window or another browser and the server-side
-- signals resolve to the existing claim. Aliases never create a new ordinal.
CREATE TABLE IF NOT EXISTS public.public_visitor_claim_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  claim_id uuid NOT NULL
    REFERENCES public.public_visitor_claims(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_visitor_claim_tokens_claim_idx
  ON public.public_visitor_claim_tokens(claim_id,created_at);

CREATE OR REPLACE FUNCTION public.protect_public_visitor_counter_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.singleton IS DISTINCT FROM OLD.singleton
    OR NEW.total_count < OLD.total_count
    OR NEW.early_bird_count < OLD.early_bird_count
    OR NEW.night_owl_count < OLD.night_owl_count
    OR NEW.total_count<>NEW.early_bird_count+NEW.night_owl_count THEN
    RAISE EXCEPTION 'Public visitor counter state is monotonic';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_public_visitor_counter_state
  ON public.public_visitor_counter_state;
CREATE TRIGGER protect_public_visitor_counter_state
BEFORE UPDATE ON public.public_visitor_counter_state
FOR EACH ROW EXECUTE FUNCTION public.protect_public_visitor_counter_state();

CREATE OR REPLACE FUNCTION public.reject_public_visitor_claim_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Public visitor claims are append-only';
END $$;

DROP TRIGGER IF EXISTS reject_public_visitor_claim_update
  ON public.public_visitor_claims;
CREATE TRIGGER reject_public_visitor_claim_update
BEFORE UPDATE OR DELETE ON public.public_visitor_claims
FOR EACH ROW EXECUTE FUNCTION public.reject_public_visitor_claim_mutation();

DROP TRIGGER IF EXISTS reject_public_visitor_claim_token_update
  ON public.public_visitor_claim_tokens;
CREATE TRIGGER reject_public_visitor_claim_token_update
BEFORE UPDATE OR DELETE ON public.public_visitor_claim_tokens
FOR EACH ROW EXECUTE FUNCTION public.reject_public_visitor_claim_mutation();

CREATE OR REPLACE FUNCTION public.axora_public_visitor_snapshot(
  p_token_hash text,
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
    CASE WHEN p_token_hash IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.public_visitor_claim_tokens token
      WHERE token.claim_id=claim.id AND token.token_hash=p_token_hash
    ) THEN 0 ELSE 1 END,
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

  -- Serializing on the singleton row prevents duplicate ordinals and closes
  -- races between a cookie alias and a network/device match.
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
    ) OR (
      p_network_device_hash IS NOT NULL
      AND claim.network_device_hash=p_network_device_hash
    ) OR (
      p_turnstile_device_hash IS NOT NULL
      AND claim.turnstile_device_hash=p_turnstile_device_hash
    )
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
    turnstile_hostname,turnstile_action
  ) VALUES (
    next_total,p_choice,p_locale,
    p_network_hash,p_network_device_hash,p_client_signal_hash,
    p_turnstile_device_hash,p_turnstile_challenge_at,
    lower(btrim(p_turnstile_hostname)),'visitor_choice'
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

REVOKE ALL ON TABLE
  public.public_visitor_counter_state,
  public.public_visitor_claims,
  public.public_visitor_claim_tokens
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_public_visitor_snapshot(text,text,text),
  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  )
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.public_visitor_counter_state,
      public.public_visitor_claims,
      public.public_visitor_claim_tokens
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_public_visitor_snapshot(text,text,text),
      public.axora_claim_public_visitor(
        text,text,text,text,text,text,text,timestamptz,text
      )
    TO axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback: retain anonymous claim records and ordinals during an application
-- rollback. Remove this feature only in a later reviewed forward migration so
-- published visitor numbers are not silently reassigned or lost.
