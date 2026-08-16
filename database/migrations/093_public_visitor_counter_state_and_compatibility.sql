BEGIN;

-- Migration 093 restores a missing singleton visitor counter state row and
-- reintroduces the legacy v2 compatibility API signatures after the cookie-only
-- rollout in migration 092.

CREATE OR REPLACE FUNCTION public.axora_public_visitor_snapshot_v3(
  p_token_hash text
)
RETURNS TABLE(
  snapshot_version bigint,
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
  state_total bigint;
BEGIN
  IF p_token_hash IS NOT NULL AND p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor token fingerprint is invalid';
  END IF;

  SELECT claim.visitor_number, claim.choice
  INTO matched_number, matched_choice
  FROM public.public_visitor_claim_tokens token
  JOIN public.public_visitor_claims claim ON claim.id=token.claim_id
  WHERE p_token_hash IS NOT NULL
    AND token.token_hash=p_token_hash
  LIMIT 1;

  SELECT state.total_count
  INTO state_total
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true;

  IF state_total IS NULL THEN
    RAISE EXCEPTION 'Public visitor counter state is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    state_total,
    state.total_count,
    state.early_bird_count,
    state.night_owl_count,
    matched_number,
    matched_choice
  FROM public.public_visitor_counter_state state
  WHERE state.singleton=true;
END $$;

DO $$
DECLARE
  v_claim_count bigint;
  v_early_claim_count bigint;
  v_night_claim_count bigint;
  v_distinct_claims bigint;
  v_min_visitor bigint;
  v_max_visitor bigint;
  v_state_rows bigint;
  v_state_total bigint;
  v_state_early bigint;
  v_state_night bigint;
  v_gap_count bigint;
BEGIN
  IF to_regclass('public.public_visitor_counter_state') IS NULL THEN
    RAISE EXCEPTION 'public_visitor_counter_state table is missing and cannot be repaired';
  END IF;
  IF to_regclass('public.public_visitor_claims') IS NULL THEN
    RAISE EXCEPTION 'public_visitor_claims table is missing and cannot be repaired';
  END IF;
  IF to_regclass('public.public_visitor_claim_tokens') IS NULL THEN
    RAISE EXCEPTION 'public_visitor_claim_tokens table is missing and cannot be repaired';
  END IF;

  LOCK TABLE public.public_visitor_claim_tokens IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.public_visitor_claims IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.public_visitor_counter_state IN ACCESS EXCLUSIVE MODE;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE choice = 'EARLY_BIRD'),
    COUNT(*) FILTER (WHERE choice = 'NIGHT_OWL'),
    COUNT(DISTINCT visitor_number),
    MIN(visitor_number),
    MAX(visitor_number)
  INTO
    v_claim_count,
    v_early_claim_count,
    v_night_claim_count,
    v_distinct_claims,
    v_min_visitor,
    v_max_visitor
  FROM public.public_visitor_claims;

  IF EXISTS (
    SELECT 1
    FROM public.public_visitor_claims
    WHERE visitor_number IS NULL
      OR visitor_number <= 0
      OR choice NOT IN ('EARLY_BIRD', 'NIGHT_OWL')
      OR locale NOT IN ('en', 'ar', 'ms')
  ) THEN
    RAISE EXCEPTION 'Public visitor claims contain invalid or malformed rows';
  END IF;

  IF v_claim_count != v_distinct_claims THEN
    RAISE EXCEPTION 'Public visitor claim visitor_number values are duplicated';
  END IF;

  IF v_claim_count <> v_early_claim_count + v_night_claim_count THEN
    RAISE EXCEPTION 'Public visitor claim counts do not match canonical choices';
  END IF;

  IF v_claim_count > 0 THEN
    IF v_min_visitor != 1 OR v_max_visitor != v_claim_count THEN
      RAISE EXCEPTION 'Public visitor claim ordinals are invalid';
    END IF;

    SELECT COUNT(*)
    INTO v_gap_count
    FROM generate_series(1, v_claim_count) AS expected(number)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.public_visitor_claims
      WHERE visitor_number = expected.number
    );

    IF v_gap_count > 0 THEN
      RAISE EXCEPTION 'Public visitor claim ordinals have gaps or missing values';
    END IF;
  END IF;

  SELECT count(*)
  INTO v_state_rows
  FROM public.public_visitor_counter_state
  WHERE singleton = true;

  IF v_state_rows = 0 THEN
    INSERT INTO public.public_visitor_counter_state(singleton, total_count, early_bird_count, night_owl_count)
    VALUES (true, v_claim_count, v_early_claim_count, v_night_claim_count);
  ELSIF v_state_rows = 1 THEN
    SELECT total_count, early_bird_count, night_owl_count
    INTO v_state_total, v_state_early, v_state_night
    FROM public.public_visitor_counter_state
    WHERE singleton = true;

    IF v_state_total != v_claim_count
      OR v_state_early != v_early_claim_count
      OR v_state_night != v_night_claim_count
      OR v_state_total != (v_state_early + v_state_night)
      OR v_state_total != v_max_visitor THEN
      RAISE EXCEPTION 'Existing public visitor counter state is inconsistent with claims';
    END IF;
  ELSE
    RAISE EXCEPTION 'Multiple public_visitor_counter_state singleton rows exist';
  END IF;

  SELECT count(*)
  INTO v_state_rows
  FROM public.public_visitor_counter_state
  WHERE singleton = true;

  IF v_state_rows != 1 THEN
    RAISE EXCEPTION 'Expected exactly one visitor counter singleton row';
  END IF;
END $$;

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
  legacy_snapshot record;
BEGIN
  IF p_token_hash IS NOT NULL AND p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor token fingerprint is invalid';
  END IF;
  IF p_network_hash IS NOT NULL AND p_network_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network fingerprint is invalid';
  END IF;
  IF p_network_device_hash IS NOT NULL AND p_network_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network-device fingerprint is invalid';
  END IF;
  IF p_turnstile_device_hash IS NOT NULL AND p_turnstile_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor Turnstile-device fingerprint is invalid';
  END IF;

  SELECT *
    INTO legacy_snapshot
    FROM public.axora_public_visitor_snapshot_v3(p_token_hash);

  -- Legacy parameters are accepted for compatibility only and no longer influence
  -- the canonical claim selection.
  RETURN QUERY
  SELECT
    legacy_snapshot.total_count,
    legacy_snapshot.early_bird_count,
    legacy_snapshot.night_owl_count,
    legacy_snapshot.visitor_number,
    legacy_snapshot.choice;
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
  legacy_claim record;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor token fingerprint is invalid';
  END IF;
  IF p_network_hash IS NOT NULL AND p_network_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network fingerprint is invalid';
  END IF;
  IF p_network_device_hash IS NOT NULL AND p_network_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor network-device fingerprint is invalid';
  END IF;
  IF p_client_signal_hash IS NOT NULL AND p_client_signal_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor client-signal fingerprint is invalid';
  END IF;
  IF p_turnstile_device_hash IS NOT NULL AND p_turnstile_device_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Public visitor Turnstile-device fingerprint is invalid';
  END IF;
  IF p_choice NOT IN ('EARLY_BIRD', 'NIGHT_OWL') OR p_locale NOT IN ('en', 'ar', 'ms') THEN
    RAISE EXCEPTION 'Public visitor claim selection is invalid';
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

  SELECT *
    INTO legacy_claim
    FROM public.axora_claim_public_visitor_v3(
      p_token_hash,
      p_choice,
      p_locale,
      p_turnstile_challenge_at,
      p_turnstile_hostname
    );

  -- Legacy parameters are accepted for compatibility only and are not persisted or
  -- consulted by the authoritative claim path.
  RETURN QUERY
  SELECT
    legacy_claim.total_count,
    legacy_claim.early_bird_count,
    legacy_claim.night_owl_count,
    legacy_claim.visitor_number,
    legacy_claim.choice,
    legacy_claim.claimed_new;
END $$;

REVOKE ALL ON FUNCTION
  public.axora_public_visitor_snapshot_v2(text,text,text,text),
  public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.axora_public_visitor_snapshot_v3(text),
  public.axora_claim_public_visitor_v3(text,text,text,timestamptz,text),
  public.axora_prune_public_visitor_rate_buckets()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.axora_public_visitor_snapshot_v3(text),
      public.axora_claim_public_visitor_v3(text,text,text,timestamptz,text),
      public.axora_public_visitor_snapshot_v2(text,text,text,text),
      public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text),
      public.axora_prune_public_visitor_rate_buckets()
    TO axora_app;
  END IF;
END $$;

COMMIT;
