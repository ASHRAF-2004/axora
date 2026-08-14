BEGIN;

ALTER TABLE public.public_request_rate_buckets
  DROP CONSTRAINT IF EXISTS public_request_rate_buckets_action_key_check;
ALTER TABLE public.public_request_rate_buckets
  ADD CONSTRAINT public_request_rate_buckets_action_key_check
    CHECK (action_key IN (
      'CONTACT','PASSWORD_RESET','EMAIL_VERIFICATION','LOGIN',
      'VISITOR_CHOICE','VISITOR_CHOICE_STREAM'
    ));

-- A signed anonymous claim cookie is the only durable anonymous identity.
-- Historical network mappings remain immutable evidence, but are not consulted
-- for new snapshots or claims. Network-derived HMACs are accepted by the
-- retained function signature only for short-lived abuse controls in the app.
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

  SELECT claim.visitor_number,claim.choice
  INTO matched_number,matched_choice
  FROM public.public_visitor_claim_tokens token
  JOIN public.public_visitor_claims claim ON claim.id=token.claim_id
  WHERE p_token_hash IS NOT NULL AND token.token_hash=p_token_hash
  LIMIT 1;

  RETURN QUERY
  SELECT state.total_count,state.early_bird_count,state.night_owl_count,
    matched_number,matched_choice
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
  IF p_choice NOT IN ('EARLY_BIRD','NIGHT_OWL') OR p_locale NOT IN ('en','ar','ms') THEN
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

  PERFORM 1 FROM public.public_visitor_counter_state
  WHERE singleton=true FOR UPDATE;

  SELECT claim.id,claim.visitor_number,claim.choice
  INTO existing_claim_id,existing_number,existing_choice
  FROM public.public_visitor_claim_tokens token
  JOIN public.public_visitor_claims claim ON claim.id=token.claim_id
  WHERE token.token_hash=p_token_hash
  LIMIT 1;

  IF existing_claim_id IS NOT NULL THEN
    RETURN QUERY SELECT state.total_count,state.early_bird_count,
      state.night_owl_count,existing_number,existing_choice,false
    FROM public.public_visitor_counter_state state WHERE state.singleton=true;
    RETURN;
  END IF;

  UPDATE public.public_visitor_counter_state state
  SET total_count=state.total_count+1,
      early_bird_count=state.early_bird_count + CASE WHEN p_choice='EARLY_BIRD' THEN 1 ELSE 0 END,
      night_owl_count=state.night_owl_count + CASE WHEN p_choice='NIGHT_OWL' THEN 1 ELSE 0 END
  WHERE state.singleton=true
  RETURNING state.total_count,state.early_bird_count,state.night_owl_count
  INTO next_total,next_early,next_night;

  INSERT INTO public.public_visitor_claims(
    visitor_number,choice,locale,network_hash,network_device_hash,
    client_signal_hash,turnstile_device_hash,turnstile_challenge_at,
    turnstile_hostname,turnstile_action,verification_method
  ) VALUES (
    next_total,p_choice,p_locale,NULL,NULL,NULL,NULL,p_turnstile_challenge_at,
    lower(btrim(p_turnstile_hostname)),'visitor_choice','TURNSTILE'
  )
  RETURNING id,public_visitor_claims.visitor_number,public_visitor_claims.choice
  INTO existing_claim_id,existing_number,existing_choice;

  INSERT INTO public.public_visitor_claim_tokens(token_hash,claim_id)
  VALUES (p_token_hash,existing_claim_id);

  RETURN QUERY SELECT next_total,next_early,next_night,
    existing_number,existing_choice,true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_prune_public_visitor_rate_buckets()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  DELETE FROM public.public_request_rate_buckets
  WHERE action_key IN ('VISITOR_CHOICE','VISITOR_CHOICE_STREAM')
    AND bucket_started_at < now() - interval '48 hours';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;

REVOKE ALL ON FUNCTION
  public.axora_public_visitor_snapshot_v2(text,text,text,text),
  public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text),
  public.axora_claim_public_visitor_fallback(text,text,text,text,text,text),
  public.axora_prune_public_visitor_rate_buckets()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION
      public.axora_claim_public_visitor_fallback(text,text,text,text,text,text)
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_public_visitor_snapshot_v2(text,text,text,text),
      public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text),
      public.axora_prune_public_visitor_rate_buckets()
    TO axora_app;
  END IF;
END $$;

COMMIT;
