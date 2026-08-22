BEGIN;

-- Resend quota headers describe account-wide provider usage, not Axora's
-- internal delivery ledger. Keep only the newest validated snapshot so a
-- routine provider response cannot create unbounded operational history.
CREATE TABLE public.resend_quota_snapshot (
  provider_name text PRIMARY KEY CHECK (provider_name='resend'),
  plan text NOT NULL CHECK (plan IN ('FREE','PAID')),
  monthly_used bigint NOT NULL CHECK (monthly_used BETWEEN 0 AND 1000000000),
  monthly_limit bigint NOT NULL CHECK (monthly_limit BETWEEN 1 AND 1000000000),
  daily_used bigint CHECK (daily_used BETWEEN 0 AND 1000000000),
  daily_limit bigint CHECK (daily_limit BETWEEN 1 AND 1000000000),
  source text NOT NULL CHECK (source IN (
    'PROVIDER_RESPONSE_HEADER','PROVIDER_READ_ONLY_SYNC'
  )),
  response_status_class smallint CHECK (response_status_class BETWEEN 2 AND 5),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((daily_used IS NULL)=(daily_limit IS NULL)),
  CHECK (plan<>'FREE' OR (daily_used IS NOT NULL AND daily_limit IS NOT NULL))
);

COMMENT ON TABLE public.resend_quota_snapshot IS
  'Single current, privacy-minimized Resend quota snapshot from validated provider headers.';

ALTER TABLE public.resend_quota_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resend_quota_snapshot FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resend_quota_snapshot FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_record_resend_quota_snapshot(
  p_plan text,
  p_monthly_used bigint,
  p_monthly_limit bigint,
  p_daily_used bigint,
  p_daily_limit bigint,
  p_source text,
  p_response_status_class smallint,
  p_captured_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE affected integer:=0;
BEGIN
  IF current_setting('axora.system_identity',true)<>'EMAIL_PROVIDER_QUOTA' THEN
    RAISE EXCEPTION 'Resend quota snapshot writer is unavailable';
  END IF;
  IF p_plan NOT IN ('FREE','PAID')
    OR p_monthly_used NOT BETWEEN 0 AND 1000000000
    OR p_monthly_limit NOT BETWEEN 1 AND 1000000000
    OR p_source NOT IN ('PROVIDER_RESPONSE_HEADER','PROVIDER_READ_ONLY_SYNC')
    OR p_response_status_class NOT BETWEEN 2 AND 5
    OR p_captured_at IS NULL
    OR ((p_daily_used IS NULL)<>(p_daily_limit IS NULL))
    OR (p_daily_used IS NOT NULL AND p_daily_used NOT BETWEEN 0 AND 1000000000)
    OR (p_daily_limit IS NOT NULL AND p_daily_limit NOT BETWEEN 1 AND 1000000000)
    OR (p_plan='FREE' AND (p_daily_used IS NULL OR p_daily_limit IS NULL)) THEN
    RAISE EXCEPTION 'Resend quota snapshot is invalid';
  END IF;

  INSERT INTO public.resend_quota_snapshot(
    provider_name,plan,monthly_used,monthly_limit,daily_used,daily_limit,
    source,response_status_class,captured_at,created_at,updated_at
  ) VALUES (
    'resend',p_plan,p_monthly_used,p_monthly_limit,p_daily_used,p_daily_limit,
    p_source,p_response_status_class,p_captured_at,now(),now()
  )
  ON CONFLICT (provider_name) DO UPDATE SET
    plan=EXCLUDED.plan,
    monthly_used=EXCLUDED.monthly_used,
    monthly_limit=EXCLUDED.monthly_limit,
    daily_used=EXCLUDED.daily_used,
    daily_limit=EXCLUDED.daily_limit,
    source=EXCLUDED.source,
    response_status_class=EXCLUDED.response_status_class,
    captured_at=EXCLUDED.captured_at,
    updated_at=now()
  WHERE EXCLUDED.captured_at>=resend_quota_snapshot.captured_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
END $$;

CREATE OR REPLACE FUNCTION public.axora_current_resend_quota_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_id uuid:=public.axora_context_user_id();
  actor_snapshot jsonb;
  result jsonb;
BEGIN
  actor_snapshot:=public.axora_email_operations_actor_snapshot(now());
  IF actor_snapshot IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users account
    WHERE account.id=actor_id
      AND account.is_owner=true
      AND account.account_kind='PLATFORM'
      AND account.account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Resend quota snapshot is unavailable';
  END IF;

  SELECT jsonb_build_object(
    'provider','resend',
    'plan',snapshot.plan,
    'monthlyUsed',snapshot.monthly_used,
    'monthlyLimit',snapshot.monthly_limit,
    'dailyUsed',snapshot.daily_used,
    'dailyLimit',snapshot.daily_limit,
    'source',snapshot.source,
    'responseStatusClass',snapshot.response_status_class,
    'capturedAt',snapshot.captured_at
  ) INTO result
  FROM public.resend_quota_snapshot snapshot
  WHERE snapshot.provider_name='resend';
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.axora_record_resend_quota_snapshot(
  text,bigint,bigint,bigint,bigint,text,smallint,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_current_resend_quota_snapshot() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.resend_quota_snapshot FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_record_resend_quota_snapshot(
      text,bigint,bigint,bigint,bigint,text,smallint,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_current_resend_quota_snapshot()
      TO axora_app;
  END IF;
END $$;

COMMIT;
