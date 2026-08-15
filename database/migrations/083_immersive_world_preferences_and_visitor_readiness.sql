BEGIN;

CREATE TABLE public.user_atmosphere_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  atmosphere text NOT NULL CHECK (atmosphere IN ('Aurora','Solar','Ember','Midnight')),
  updated_at timestamptz NOT NULL,
  CHECK (updated_at <= now() + interval '5 minutes')
);

ALTER TABLE public.user_atmosphere_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_atmosphere_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_atmosphere_preferences FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_get_staff_atmosphere(
  p_actor_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE result text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users account
    WHERE account.id=p_actor_user_id AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind IN ('PLATFORM','DELIVERY')
  ) THEN RETURN NULL; END IF;
  SELECT preference.atmosphere INTO result
  FROM public.user_atmosphere_preferences preference
  WHERE preference.user_id=p_actor_user_id;
  RETURN COALESCE(result,'Aurora');
END
$$;

CREATE OR REPLACE FUNCTION public.axora_set_staff_atmosphere(
  p_actor_user_id uuid,
  p_atmosphere text,
  p_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF p_atmosphere NOT IN ('Aurora','Solar','Ember','Midnight') OR NOT EXISTS (
    SELECT 1 FROM public.users account
    WHERE account.id=p_actor_user_id AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind IN ('PLATFORM','DELIVERY')
  ) THEN RAISE EXCEPTION 'Atmosphere preference unavailable'; END IF;
  INSERT INTO public.user_atmosphere_preferences(user_id,atmosphere,updated_at)
  VALUES (p_actor_user_id,p_atmosphere,p_at)
  ON CONFLICT(user_id) DO UPDATE SET atmosphere=EXCLUDED.atmosphere,updated_at=EXCLUDED.updated_at;
  RETURN p_atmosphere;
END
$$;

REVOKE ALL ON FUNCTION public.axora_get_staff_atmosphere(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_staff_atmosphere(uuid,text,timestamptz) FROM PUBLIC;

DO $axora_runtime_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    EXECUTE 'REVOKE ALL ON public.user_atmosphere_preferences FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_get_staff_atmosphere(uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_set_staff_atmosphere(uuid,text,timestamptz) TO axora_app';
    -- Reassert the narrow visitor capabilities. A missing execute grant is the
    -- production-like 503 class this migration prevents after role rebuilds.
    IF to_regprocedure('public.axora_public_visitor_snapshot_v2(text,text,text,text)') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_public_visitor_snapshot_v2(text,text,text,text) TO axora_app';
    END IF;
    IF to_regprocedure('public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text) TO axora_app';
    END IF;
  END IF;
END
$axora_runtime_role$;

COMMIT;
