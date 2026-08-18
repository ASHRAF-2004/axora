BEGIN;

-- Canonical Light/Dark appearance preference. The legacy atmosphere table and
-- functions remain in place during this expand/contract deployment because
-- production applies migrations before replacing the currently running app.
CREATE TABLE public.user_appearance_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  appearance text NOT NULL CHECK (appearance IN ('light','dark')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at <= clock_timestamp() + interval '5 minutes')
);

ALTER TABLE public.user_appearance_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_appearance_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_appearance_preferences FROM PUBLIC;

-- Deterministic one-time conversion of every legacy stored preference.
INSERT INTO public.user_appearance_preferences(user_id,appearance,updated_at)
SELECT
  user_id,
  CASE atmosphere
    WHEN 'Aurora' THEN 'light'
    WHEN 'Solar' THEN 'light'
    WHEN 'Ember' THEN 'light'
    WHEN 'Midnight' THEN 'dark'
  END,
  updated_at
FROM public.user_atmosphere_preferences
ON CONFLICT (user_id) DO UPDATE
SET appearance=EXCLUDED.appearance,
    updated_at=EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.axora_get_user_appearance(
  p_user_id uuid,
  p_at timestamptz
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE chosen text;
BEGIN
  IF p_user_id IS NULL OR p_at IS NULL
    OR p_at > clock_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'Appearance preference unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id=p_user_id
      AND active
      AND account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Appearance preference unavailable';
  END IF;

  SELECT appearance INTO chosen
  FROM public.user_appearance_preferences
  WHERE user_id=p_user_id;

  RETURN chosen;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_set_user_appearance(
  p_user_id uuid,
  p_appearance text,
  p_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF p_appearance IS NULL OR p_appearance NOT IN ('light','dark')
    OR p_user_id IS NULL OR p_at IS NULL
    OR p_at > clock_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'Appearance preference unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id=p_user_id
      AND active
      AND account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Appearance preference unavailable';
  END IF;

  INSERT INTO public.user_appearance_preferences(user_id,appearance,updated_at)
  VALUES(p_user_id,p_appearance,p_at)
  ON CONFLICT (user_id) DO UPDATE
  SET appearance=EXCLUDED.appearance,
      updated_at=EXCLUDED.updated_at;

  RETURN p_appearance;
END
$$;

REVOKE ALL ON FUNCTION public.axora_get_user_appearance(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_user_appearance(uuid,text,timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_get_user_appearance(uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_set_user_appearance(uuid,text,timestamptz) TO axora_app;
  END IF;
END
$$;

-- Compatibility bridge for the deployment window only. If the old revision
-- writes its four-value preference after this migration but before application
-- replacement, mirror that write into the new Light/Dark table. Deletes mirror
-- too, preserving existing user/company cleanup behavior. New application code
-- never writes the legacy table.
CREATE OR REPLACE FUNCTION public.axora_mirror_legacy_atmosphere_preference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE mapped_appearance text;
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM public.user_appearance_preferences WHERE user_id=OLD.user_id;
    RETURN OLD;
  END IF;

  mapped_appearance := CASE NEW.atmosphere
    WHEN 'Aurora' THEN 'light'
    WHEN 'Solar' THEN 'light'
    WHEN 'Ember' THEN 'light'
    WHEN 'Midnight' THEN 'dark'
  END;

  IF mapped_appearance IS NULL THEN
    RAISE EXCEPTION 'Appearance preference unavailable';
  END IF;

  INSERT INTO public.user_appearance_preferences(user_id,appearance,updated_at)
  VALUES(NEW.user_id,mapped_appearance,NEW.updated_at)
  ON CONFLICT (user_id) DO UPDATE
  SET appearance=EXCLUDED.appearance,
      updated_at=EXCLUDED.updated_at;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.axora_mirror_legacy_atmosphere_preference() FROM PUBLIC;

DROP TRIGGER IF EXISTS mirror_legacy_atmosphere_preference ON public.user_atmosphere_preferences;
CREATE TRIGGER mirror_legacy_atmosphere_preference
AFTER INSERT OR UPDATE OR DELETE ON public.user_atmosphere_preferences
FOR EACH ROW EXECUTE FUNCTION public.axora_mirror_legacy_atmosphere_preference();

COMMIT;
