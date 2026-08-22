BEGIN;

-- Recipient units are fixed when an outbox record is created. Today each Axora
-- delivery has one recipient; keeping the unit on the durable logical delivery
-- makes future multi-recipient messages countable without counting attempts.
ALTER TABLE public.account_setup_invitations
  ADD COLUMN recipient_units integer NOT NULL DEFAULT 1
    CHECK (recipient_units BETWEEN 1 AND 1000),
  ADD COLUMN accepted_provider_name text CHECK (
    accepted_provider_name IS NULL OR accepted_provider_name IN (
      'resend','zeptomail','cloudflare-email-service','test','unconfigured'
    )
  ),
  ADD CHECK (accepted_provider_name IS NULL OR delivery_status='SENT');
ALTER TABLE public.transactional_email_outbox
  ADD COLUMN recipient_units integer NOT NULL DEFAULT 1
    CHECK (recipient_units BETWEEN 1 AND 1000);
ALTER TABLE public.workflow_email_outbox
  ADD COLUMN recipient_units integer NOT NULL DEFAULT 1
    CHECK (recipient_units BETWEEN 1 AND 1000);

CREATE FUNCTION public.axora_reject_recipient_unit_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF NEW.recipient_units IS DISTINCT FROM OLD.recipient_units THEN
    RAISE EXCEPTION 'Email recipient units are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_setup_recipient_units_are_immutable
BEFORE UPDATE OF recipient_units ON public.account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_recipient_unit_change();

CREATE FUNCTION public.axora_protect_account_setup_acceptance_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF OLD.delivery_status NOT IN ('PENDING','SENDING')
    AND NEW.accepted_provider_name IS DISTINCT FROM OLD.accepted_provider_name THEN
    RAISE EXCEPTION 'Account setup provider acceptance evidence is final';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_setup_acceptance_evidence_is_final
BEFORE UPDATE OF accepted_provider_name ON public.account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_account_setup_acceptance_evidence();
CREATE TRIGGER transactional_recipient_units_are_immutable
BEFORE UPDATE OF recipient_units ON public.transactional_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_recipient_unit_change();
CREATE TRIGGER workflow_recipient_units_are_immutable
BEFORE UPDATE OF recipient_units ON public.workflow_email_outbox
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_recipient_unit_change();

-- This is a single operational cutover baseline, not an editable application
-- setting. It is initialized separately after deployment and never seeded by
-- the migration or demo fixtures.
CREATE TABLE public.email_usage_opening_baselines (
  provider_name text PRIMARY KEY CHECK (provider_name='resend'),
  baseline_at timestamptz NOT NULL,
  period_timezone text NOT NULL CHECK (period_timezone='UTC'),
  month_start date NOT NULL,
  monthly_opening_used bigint NOT NULL
    CHECK (monthly_opening_used BETWEEN 0 AND 1000000000),
  day_start date NOT NULL,
  daily_opening_used bigint NOT NULL
    CHECK (daily_opening_used BETWEEN 0 AND 1000000000),
  source text NOT NULL CHECK (source='USER_CONFIRMED_RESEND_DASHBOARD'),
  operator_reference text NOT NULL CHECK (
    char_length(operator_reference) BETWEEN 3 AND 120
    AND operator_reference ~ '^[A-Za-z0-9_.:@-]+$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (month_start=date_trunc('month',baseline_at AT TIME ZONE 'UTC')::date),
  CHECK (day_start=(baseline_at AT TIME ZONE 'UTC')::date)
);

COMMENT ON TABLE public.email_usage_opening_baselines IS
  'Immutable operator-confirmed opening usage for the Axora Resend cutover.';

CREATE TRIGGER email_usage_opening_baselines_are_append_only
BEFORE UPDATE OR DELETE ON public.email_usage_opening_baselines
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

ALTER TABLE public.email_usage_opening_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_usage_opening_baselines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_usage_opening_baselines FROM PUBLIC;

-- One row per successful logical delivery. Provider attempts establish Resend
-- acceptance for retryable outboxes; account invitations are one-shot and their
-- canonical SENT transition is recorded only after a successful provider result.
CREATE VIEW public.axora_resend_accepted_email_usage
WITH (security_barrier=true)
AS
SELECT 'ACCOUNT_SETUP'::text AS delivery_kind,
  invitation.id AS delivery_id,
  invitation.sent_at AS accepted_at,
  invitation.recipient_units::bigint AS recipient_units
FROM public.account_setup_invitations invitation
WHERE invitation.delivery_status='SENT' AND invitation.sent_at IS NOT NULL
  AND COALESCE(invitation.accepted_provider_name,'resend')='resend'
UNION ALL
SELECT 'TRANSACTIONAL'::text,outbox.id,outbox.sent_at,
  outbox.recipient_units::bigint
FROM public.transactional_email_outbox outbox
WHERE outbox.delivery_status='SENT' AND outbox.sent_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.email_delivery_attempts attempt
    WHERE attempt.delivery_kind='TRANSACTIONAL'
      AND attempt.delivery_id=outbox.id
      AND attempt.provider_name='resend'
      AND attempt.outcome='sent'
  )
UNION ALL
SELECT 'WORKFLOW'::text,outbox.id,outbox.sent_at,
  outbox.recipient_units::bigint
FROM public.workflow_email_outbox outbox
WHERE outbox.delivery_status='SENT' AND outbox.sent_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.email_delivery_attempts attempt
    WHERE attempt.delivery_kind='WORKFLOW'
      AND attempt.delivery_id=outbox.id
      AND attempt.provider_name='resend'
      AND attempt.outcome='sent'
  );

REVOKE ALL ON public.axora_resend_accepted_email_usage FROM PUBLIC;

CREATE FUNCTION public.axora_current_email_usage(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_id uuid:=public.axora_context_user_id();
  actor_snapshot jsonb;
  baseline public.email_usage_opening_baselines%ROWTYPE;
  current_day date;
  current_month date;
  daily_floor timestamptz;
  monthly_floor timestamptz;
  daily_opening bigint:=0;
  monthly_opening bigint:=0;
  daily_units bigint:=0;
  monthly_units bigint:=0;
  last_counted_at timestamptz;
BEGIN
  IF p_at IS NULL THEN RAISE EXCEPTION 'Email usage time is required'; END IF;
  actor_snapshot:=public.axora_email_operations_actor_snapshot(p_at);
  IF actor_snapshot IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users account
    WHERE account.id=actor_id
      AND account.is_owner=true
      AND account.account_kind='PLATFORM'
      AND account.account_status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Email usage is unavailable';
  END IF;

  current_day:=(p_at AT TIME ZONE 'UTC')::date;
  current_month:=date_trunc('month',p_at AT TIME ZONE 'UTC')::date;
  daily_floor:=(current_day::timestamp AT TIME ZONE 'UTC')-interval '1 microsecond';
  monthly_floor:=(current_month::timestamp AT TIME ZONE 'UTC')-interval '1 microsecond';

  SELECT * INTO baseline FROM public.email_usage_opening_baselines
  WHERE provider_name='resend';

  IF FOUND AND baseline.month_start=current_month THEN
    monthly_opening:=baseline.monthly_opening_used;
    monthly_floor:=GREATEST(monthly_floor,baseline.baseline_at);
  END IF;
  IF FOUND AND baseline.day_start=current_day THEN
    daily_opening:=baseline.daily_opening_used;
    daily_floor:=GREATEST(daily_floor,baseline.baseline_at);
  END IF;

  SELECT COALESCE(sum(usage.recipient_units),0),max(usage.accepted_at)
    INTO monthly_units,last_counted_at
  FROM public.axora_resend_accepted_email_usage usage
  WHERE usage.accepted_at>monthly_floor AND usage.accepted_at<=p_at;

  SELECT COALESCE(sum(usage.recipient_units),0)
    INTO daily_units
  FROM public.axora_resend_accepted_email_usage usage
  WHERE usage.accepted_at>daily_floor AND usage.accepted_at<=p_at;

  RETURN jsonb_build_object(
    'provider','resend',
    'initialized',baseline.provider_name IS NOT NULL,
    'openingApplies',COALESCE(baseline.month_start=current_month,false),
    'periodTimezone','UTC',
    'monthStart',current_month,
    'dayStart',current_day,
    'monthlyUsed',monthly_opening+monthly_units,
    'dailyUsed',daily_opening+daily_units,
    'monthlyOpeningUsed',monthly_opening,
    'dailyOpeningUsed',daily_opening,
    'baselineAt',baseline.baseline_at,
    'baselineSource',baseline.source,
    'lastCountedAt',last_counted_at,
    'lastRecordedAt',GREATEST(
      CASE WHEN baseline.month_start=current_month THEN baseline.baseline_at END,
      last_counted_at
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.axora_reject_recipient_unit_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_account_setup_acceptance_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_current_email_usage(timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.email_usage_opening_baselines FROM axora_app;
    REVOKE ALL ON public.axora_resend_accepted_email_usage FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_current_email_usage(timestamptz)
      TO axora_app;
  END IF;
END $$;

COMMIT;
